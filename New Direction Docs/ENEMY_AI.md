# Enemy AI
*Federation Legionaires — authoritative enemy AI specification*
*Last updated: 2026-03-22*

---

## 1. Overview

Enemy forces are commanded by a server-side AI that uses the same game systems
as player units — pathfinding, LOS, spotting accumulators, suppression, morale,
and fire postures. The AI does **not** cheat: it has no omniscient vision, no
instant reactions, and no access to player orders. Its advantage comes from
numbers, doctrine, and faction-specific special rules.

The AI is a **3-layer architecture**:

| Layer | Scope | Update Rate | Method |
|-------|-------|-------------|--------|
| **Strategic** | Faction-wide | Every 5 seconds | Utility scoring + influence maps |
| **Platoon** | Per platoon (3–6 units) | Every 1–2 seconds | Behavior trees |
| **Unit** | Per unit | Every tick (20 Hz) | Existing fire posture + morale state machine |

Layer 3 already exists in the game design (FREE_FIRE / RETURN_FIRE / HOLD_FIRE +
NORMAL / PINNED / ROUTING / SURRENDERED). The AI spec adds Layers 1 and 2.

---

## 2. Tick Loop Integration

AI decision-making runs at the **start of Phase 2 (Command Propagation)**, before
player orders are propagated. This gives AI access to the previous second's
spotting data and morale state.

```
Phase 1: Input Processing     ← player orders only
Phase 2: Command Propagation  ← AI DECISIONS INJECTED HERE, then player orders
Phase 3: Movement Resolution  ← AI units pathfind + move like player units
Phase 4: Spotting Updates     ← AI units detect via same LOS/accumulator system
Phase 5: Fire Resolution      ← AI units fire via same fire posture logic
Phase 6: Damage Application
Phase 7: Suppression / Morale ← AI units pin/rout/surrender identically
Phase 8: Supply Tick
Phase 9: State Broadcast      ← AI unit state sent to clients normally
```

### 2.1 Update Cadence

Not all layers run every tick:

| Layer | Runs On | Condition |
|-------|---------|-----------|
| Strategic | `tick % 100 === 0` | Every 5 seconds |
| Platoon BT | `tick % 20 === 0` | Every 1 second (same frame as spotting) |
| Unit (posture) | Every tick | Handled by existing fire resolution |

Strategic and platoon decisions are staggered by 10 ticks (`strategic` at tick
0, 100, 200…; `platoon BTs` at tick 0, 20, 40…) to avoid cost spikes.

---

## 3. Layer 1 — Strategic AI

### 3.1 Influence Maps

Two `Float32Array` grids overlaid on the terrain, same resolution as the cost
grid. Updated every 5 seconds.

```typescript
interface InfluenceMaps {
  threat: Float32Array;    // how dangerous each cell is to AI units
  control: Float32Array;   // who dominates each area (+AI / −player)
}
```

#### 3.1.1 Threat Map

For each player unit known to the AI (contact tier ≥ SUSPECTED):

```typescript
function updateThreatMap(
  maps: InfluenceMaps,
  playerContacts: Contact[],
  grid: CostGrid
): void {
  maps.threat.fill(0);

  for (const contact of playerContacts) {
    const [col, row] = worldToCell(contact.lastKnownPosX,
                                    contact.lastKnownPosZ,
                                    grid.resolution);

    // Stamp a falloff kernel around the contact
    const threatRadius = estimateThreatRadius(contact);  // cells
    const maxThreat = estimateThreatLevel(contact);

    stampKernel(maps.threat, col, row, threatRadius, maxThreat, grid);
  }
}
```

`estimateThreatRadius` returns the contact's estimated weapon range in cells.
SUSPECTED contacts (position ±50 m) get a wider, softer kernel. CONFIRMED
contacts get a tight, high-intensity kernel.

`estimateThreatLevel` scores by contact category:
- Vehicle: 8
- Infantry: 3
- Air: 10
- Unknown (SUSPECTED): 5

#### 3.1.2 Control Map

For each unit (AI and player contacts):

```typescript
function updateControlMap(
  maps: InfluenceMaps,
  aiUnits: UnitInstance[],
  playerContacts: Contact[],
  grid: CostGrid
): void {
  maps.control.fill(0);

  // AI presence: positive
  for (const unit of aiUnits) {
    if (unit.destroyed) continue;
    const [col, row] = worldToCell(unit.posX, unit.posZ, grid.resolution);
    stampKernel(maps.control, col, row, 20, +1.0, grid);  // 200m radius
  }

  // Player presence: negative
  for (const contact of playerContacts) {
    const [col, row] = worldToCell(contact.lastKnownPosX,
                                    contact.lastKnownPosZ,
                                    grid.resolution);
    stampKernel(maps.control, col, row, 20, -1.0, grid);
  }
}
```

#### 3.1.3 Kernel Stamping

```typescript
function stampKernel(
  map: Float32Array,
  cx: number, cz: number,
  radius: number,
  intensity: number,
  grid: CostGrid
): void {
  const r2 = radius * radius;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist2 = dx * dx + dz * dz;
      if (dist2 > r2) continue;

      const col = cx + dx;
      const row = cz + dz;
      if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) continue;

      const falloff = 1 - Math.sqrt(dist2) / radius;  // linear falloff
      map[row * grid.width + col] += intensity * falloff;
    }
  }
}
```

### 3.2 Objective Scoring

Every 5 seconds, the strategic AI evaluates each mission objective and decides
how to allocate platoons.

```typescript
interface ObjectiveAssignment {
  objectiveId: string;
  assignedPlatoons: string[];   // platoon IDs
  intent: 'attack' | 'defend' | 'reinforce' | 'retreat' | 'patrol';
}
```

#### 3.2.1 Scoring Function

```typescript
function scoreObjective(
  objective: Objective,
  platoon: Platoon,
  maps: InfluenceMaps,
  faction: 'ataxian' | 'khroshi',
  weights: FactionWeights
): number {
  const [oCol, oRow] = worldToCell(objective.x, objective.z, grid.resolution);
  const [pCol, pRow] = worldToCell(platoon.centroidX, platoon.centroidZ, grid.resolution);

  const dist = Math.sqrt((oCol - pCol) ** 2 + (oRow - pRow) ** 2);
  const threat = maps.threat[oRow * grid.width + oCol];
  const control = maps.control[oRow * grid.width + oCol];
  const strength = platoonStrength(platoon);  // 0–1 based on surviving units

  let score = objective.value * weights.objectiveValue;
  score -= dist * weights.distancePenalty;
  score -= threat * weights.threatAversion;
  score += control * weights.controlPreference;
  score += strength * weights.aggressionBias;

  // Faction-specific modifiers
  if (faction === 'ataxian') {
    // Prefer weakest flank (most negative control = player-dominated)
    if (control < -0.5) score += weights.flankBonus;
  }
  if (faction === 'khroshi') {
    // Prefer objectives with defensive terrain
    const cover = terrain.coverMap[oRow * grid.width + oCol];
    score += cover * weights.defensiveTerrainBonus;
  }

  return score;
}
```

#### 3.2.2 Faction Weight Profiles

```typescript
interface FactionWeights {
  objectiveValue: number;
  distancePenalty: number;
  threatAversion: number;
  controlPreference: number;
  aggressionBias: number;
  flankBonus: number;
  defensiveTerrainBonus: number;
  retreatThreshold: number;      // platoon strength below this → retreat
}

const ATAXIAN_WEIGHTS: FactionWeights = {
  objectiveValue:       1.0,
  distancePenalty:      0.2,     // low: willing to cross the map
  threatAversion:       2.0,     // moderate: avoids strongest point
  controlPreference:    -1.0,    // negative: prefers contested/enemy areas
  aggressionBias:       4.0,     // high: strong platoons push hard
  flankBonus:           6.0,     // loves flanking weak spots
  defensiveTerrainBonus: 0.5,    // barely cares about terrain quality
  retreatThreshold:     0.0,     // never retreats (fights to destruction)
};

const KHROSHI_WEIGHTS: FactionWeights = {
  objectiveValue:       2.0,     // values objectives highly
  distancePenalty:      0.8,     // strong: prefers nearby objectives
  threatAversion:       8.0,     // very high: avoids danger
  controlPreference:    3.0,     // prefers areas it already controls
  aggressionBias:       1.0,     // low: strength doesn't drive aggression
  flankBonus:           0.5,     // rarely flanks
  defensiveTerrainBonus: 5.0,    // strongly prefers cover/elevation
  retreatThreshold:     0.4,     // retreats at 40% strength
};
```

### 3.3 Platoon Assignment

After scoring, a greedy assignment pass:

1. Sort all (platoon, objective) pairs by score descending
2. Assign each platoon to its highest-scoring objective
3. Cap assignments at `maxPlatoonsPerObjective` (3 for attack, 2 for defend)
4. Unassigned platoons default to `patrol` near their current position

### 3.4 Reserve Management

Each faction holds a reserve pool of platoons that arrive as reinforcements.

```typescript
interface ReinforcementWave {
  arrivalTick: number;         // scheduled arrival time
  platoons: Platoon[];
  entryEdge: 'north' | 'south' | 'east' | 'west';
}
```

The strategic AI decides when to commit reserves:

- **Ataxian**: Commits reserves immediately to the highest-scoring objective.
  Never holds back. Reserves arrive every 90–120 seconds.
- **Khroshi**: Holds reserves until a position is lost or about to fall
  (control map goes negative at a defended objective). Commits reserves for
  counterattack only. Reserves arrive every 120–180 seconds.

---

## 4. Layer 2 — Platoon AI (Behavior Trees)

### 4.1 BT Primitives

```typescript
type BTStatus = 'success' | 'failure' | 'running';

interface BTNode {
  tick(platoon: Platoon, context: AIContext): BTStatus;
}
```

**Composite nodes:**
- `Selector`: Try children left-to-right; return first `success` or `running`
- `Sequence`: Run children in order; fail on first `failure`
- `Parallel`: Run all children; succeed when N succeed, fail when M fail

**Decorator nodes:**
- `Inverter`: Flip success/failure
- `Cooldown(seconds)`: Return `failure` if re-entered within cooldown period
- `RepeatUntilFail`: Loop child until it returns `failure`

**Leaf nodes (conditions):**
- `HasContactsInRange(rangeM)`: True if any DETECTED+ contact within range
- `PlatoonStrengthAbove(ratio)`: True if surviving units / total ≥ ratio
- `ObjectiveHeld()`: True if AI controls assigned objective zone
- `ObjectiveThreatened()`: True if player contacts within 200m of objective
- `CommandUnitAlive()`: True if platoon's Brood/Node is alive
- `SuppressedUnitsAbove(ratio)`: True if PINNED+ units / total ≥ ratio
- `FlankRouteExists()`: True if influence map shows low-threat path to flank

**Leaf nodes (actions):**
- `AdvanceToObjective()`: Issue MOVE ADVANCE orders toward assigned objective
- `MarchToObjective()`: Issue MOVE MARCH orders (faster, no firing)
- `HoldPosition()`: Cancel movement; set fire posture
- `SetFirePosture(posture)`: FREE_FIRE / RETURN_FIRE / HOLD_FIRE for all units
- `ReverseToFallback()`: Issue REVERSE orders toward nearest fallback position
- `MarchToFallback()`: Full-speed retreat to fallback position
- `FlankViaLowThreat()`: Pathfind through lowest-threat corridor on influence map
- `ConcentrateFireOnTarget()`: All units ENGAGE highest-priority contact
- `ScreenCommandUnit()`: Position combat units between command unit and threat
- `RequestArtillery(target)`: Call fire mission on target position (Khroshi only)
- `SplitElement()`: Divide platoon into base-of-fire and maneuver elements

### 4.2 AIContext

Shared read-only state passed to every BT evaluation:

```typescript
interface AIContext {
  terrain: TerrainData;
  terrainTypeMap: Uint8Array;
  costGrids: Record<MoveClass, CostGrid>;
  influenceMaps: InfluenceMaps;
  contacts: Contact[];                // AI's contact picture (from spotting)
  missionObjectives: Objective[];
  currentTick: number;
  faction: 'ataxian' | 'khroshi';
  fallbackPositions: Vec2[];          // pre-computed at mission start
  missionType: MissionType;
}
```

### 4.3 Ataxian Behavior Trees

#### 4.3.1 Ataxian Assault Platoon

```
Selector
├── Sequence [Overrun]
│   ├── HasContactsInRange(100)
│   ├── SetFirePosture(FREE_FIRE)
│   └── AdvanceToObjective()              // close to melee range
│
├── Sequence [Protect Synaptic Brood]
│   ├── Inverter → CommandUnitAlive()     // triggers if Brood taking fire
│   ├── ScreenCommandUnit()
│   └── SetFirePosture(RETURN_FIRE)
│
├── Sequence [Rush Through Gap]
│   ├── FlankRouteExists()
│   ├── FlankViaLowThreat()
│   └── SetFirePosture(HOLD_FIRE)         // silent approach
│
├── Sequence [Suppress and Advance]
│   ├── HasContactsInRange(500)
│   ├── SplitElement()
│   │   ├── BaseOfFire: SetFirePosture(FREE_FIRE) + HoldPosition()
│   │   └── Maneuver: AdvanceToObjective()
│   └── [running until maneuver element closes]
│
└── AdvanceToObjective()                  // default: always push forward
```

**Key Ataxian behaviors:**
- Never retreats (no fallback node in the tree)
- Protects Synaptic Brood reactively — Warriors screen when Brood takes fire
- Scurrier units always try to close to 30m for melee overrun
- Prefers flanking through low-threat corridors when available
- Falls back to simple advance when nothing smarter applies

#### 4.3.2 Ataxian Garrison Platoon

```
Selector
├── Sequence [Swarm Response]
│   ├── ObjectiveThreatened()
│   ├── SetFirePosture(FREE_FIRE)
│   └── AdvanceToObjective()              // move to intercept attackers
│
├── Sequence [Ambush Hold]
│   ├── Inverter → HasContactsInRange(300)
│   ├── SetFirePosture(HOLD_FIRE)         // stay hidden until close
│   └── HoldPosition()
│
└── HoldPosition() + SetFirePosture(RETURN_FIRE)
```

### 4.4 Khroshi Behavior Trees

#### 4.4.1 Khroshi Defense Platoon

```
Selector
├── Sequence [Coordinated Salvo]
│   ├── HasContactsInRange(800)
│   ├── Cooldown(15s)                     // don't spam artillery
│   ├── RequestArtillery(clusterCenter)
│   ├── SetFirePosture(HOLD_FIRE)         // wait for salvo impact
│   └── [after 3s delay] SetFirePosture(FREE_FIRE)
│
├── Sequence [Ambush]
│   ├── HasContactsInRange(400)
│   ├── Inverter → HasContactsInRange(200) // wait until they're deep in kill zone
│   ├── SetFirePosture(HOLD_FIRE)          // let them walk in
│   └── [running]
│
├── Sequence [Spring Ambush]
│   ├── HasContactsInRange(200)
│   ├── SetFirePosture(FREE_FIRE)          // open up at close range
│   └── ConcentrateFireOnTarget()
│
├── Sequence [Fallback]
│   ├── Inverter → PlatoonStrengthAbove(0.4)  // below 40% strength
│   ├── SetFirePosture(RETURN_FIRE)            // covering fire
│   └── MarchToFallback()                      // withdraw to next line
│
├── Sequence [Node Destroyed — Emergency]
│   ├── Inverter → CommandUnitAlive()
│   ├── SuppressedUnitsAbove(0.3)              // neural link lost + under fire
│   └── ReverseToFallback()                    // controlled retreat
│
└── HoldPosition() + SetFirePosture(RETURN_FIRE) // default: hold and shoot back
```

**Key Khroshi behaviors:**
- Defaults to holding position — never advances unless explicitly attacking
- Uses artillery before engaging with direct fire
- Ambush discipline: holds fire until enemy walks into kill zone at 200m
- Falls back at 40% platoon strength to next prepared position
- Broadcast Node loss triggers emergency retreat for affected units
- Coordinated Salvo has a 15-second cooldown to prevent artillery spam

#### 4.4.2 Khroshi Counterattack Platoon

```
Selector
├── Sequence [Counterattack Lost Position]
│   ├── Inverter → ObjectiveHeld()         // objective was lost
│   ├── PlatoonStrengthAbove(0.6)          // only attack if strong enough
│   ├── SetFirePosture(FREE_FIRE)
│   └── AdvanceToObjective()
│
├── Sequence [Reinforce Threatened Position]
│   ├── ObjectiveThreatened()
│   ├── MarchToObjective()
│   └── SetFirePosture(RETURN_FIRE)
│
└── HoldPosition() + SetFirePosture(RETURN_FIRE)
```

### 4.5 Mission-Type BT Modifiers

The platoon BT is selected based on the platoon's assigned intent from the
strategic layer:

| Intent | Ataxian BT | Khroshi BT |
|--------|-----------|------------|
| `attack` | Assault Platoon | Counterattack Platoon |
| `defend` | Garrison Platoon | Defense Platoon |
| `reinforce` | Assault Platoon | Counterattack Platoon |
| `retreat` | *(not used)* | Defense Platoon (with forced fallback) |
| `patrol` | Garrison Platoon | Defense Platoon |

---

## 5. Layer 3 — Unit AI

This layer is the existing game system. No new code required — the AI sets
fire postures and movement orders at Layer 2, and the simulation handles the
rest.

### 5.1 Fire Posture Behavior (existing)

| Posture | Behavior |
|---------|----------|
| `FREE_FIRE` | Auto-engage closest DETECTED+ contact in range using optimal weapon/ammo |
| `RETURN_FIRE` | Fire only at contacts that have fired on this unit |
| `HOLD_FIRE` | Never auto-engage; explicit ENGAGE orders only |

### 5.2 Weapon Slot Selection (existing)

The server auto-selects the optimal weapon slot and ammo type:

1. Use lowest-numbered available slot (suppression lockout gates higher slots)
2. AP/Sabot versus armored targets (highest penetration first)
3. HEAT as AP fallback
4. HE versus soft targets

### 5.3 Morale State Changes (existing)

| State | Trigger | Effect |
|-------|---------|--------|
| NORMAL | suppression < 40 | Full capability |
| PINNED | 40 ≤ suppression < 65 | Cannot move; fire at −15%; 50% opportunity fire |
| ROUTING | 65 ≤ suppression < 90 | Forced retreat toward friendly edge; slot 1 only, −30% |
| SURRENDERED | suppression ≥ 90 AND crew ≤ 25% | Removed from play |

ROUTING units auto-retreat using A* toward the nearest friendly map edge at
50% maxSpeedM. This is handled by the movement system, not the AI layer.

### 5.4 Faction-Specific Unit Rules

**Ataxian:**
- Suppression floor of 70 (cannot exceed unless Synaptic Brood destroyed)
- Synaptic Brood death → +5 suppression to all Ataxian units within 300m,
  suppression cap removed for 60 seconds
- Scurrier melee overrun at ≤ 30m and `full_halt`: 1 crew/sec, bypasses armour
- Bio-regeneration: `survivability ≥ 4` units regain 1 crew/60s when not under fire

**Khroshi:**
- Syndicate units (not Conscripts) have suppression floor of 20
- Broadcast Node provides suppression resistance aura; destruction removes
  floor for 60 seconds for all units within aura radius
- Automaton Walkers: no crew, no suppression, no morale states — destroyed
  or fully functional
- Coordinated Battery: fires 2–3 rounds with 3-second spacing on same target

---

## 6. Prepared Positions

### 6.1 Generation

At mission start, the AI pre-computes defensive positions based on objectives,
terrain, and faction doctrine. These are stored as `FallbackPosition` entries.

```typescript
interface FallbackPosition {
  id: string;
  x: number;
  z: number;
  facing: number;           // degrees, toward expected threat axis
  coverLevel: number;       // from terrain coverMap, 0–1
  elevation: number;        // height advantage
  lineIndex: number;        // 0 = forward, 1 = main, 2 = final
  objectiveId: string;      // which objective this position supports
}
```

### 6.2 Position Selection Algorithm

```typescript
function generateFallbackPositions(
  objectives: Objective[],
  terrain: TerrainData,
  playerEntryEdge: 'north' | 'south' | 'east' | 'west',
  faction: 'ataxian' | 'khroshi'
): FallbackPosition[] {
  const positions: FallbackPosition[] = [];

  for (const obj of objectives) {
    // Compute retreat axis: from objective toward AI-friendly edge
    const retreatAxis = oppositeEdge(playerEntryEdge);

    // Line 1 (forward): 200–400m toward player from objective
    // Line 2 (main):     at objective
    // Line 3 (final):    200–400m toward AI edge from objective
    const lines = [
      { offset: -300, index: 0, strengthRatio: 0.25 },
      { offset:    0, index: 1, strengthRatio: 0.50 },
      { offset:  300, index: 2, strengthRatio: 0.25 },
    ];

    for (const line of lines) {
      const candidatePos = offsetAlongAxis(obj.x, obj.z, retreatAxis, line.offset);

      // Score nearby cells for cover, elevation, LOS toward player edge
      const bestCell = findBestDefensiveCell(
        candidatePos, terrain, playerEntryEdge, 100  // 100m search radius
      );

      positions.push({
        id: `${obj.id}-L${line.index}`,
        x: bestCell.x,
        z: bestCell.z,
        facing: bearingToward(playerEntryEdge),
        coverLevel: terrain.coverMap[bestCell.row * terrain.width + bestCell.col],
        elevation: getElevation(bestCell.x, bestCell.z, ...),
        lineIndex: line.index,
        objectiveId: obj.id,
      });
    }
  }

  return positions;
}
```

### 6.3 Khroshi Kill Zones

Khroshi defense platoons compute **kill zone arcs** from their prepared
positions at mission start:

```typescript
interface KillZone {
  origin: Vec2;               // the defensive position
  bearing: number;            // center of the arc, degrees
  arcWidth: number;           // total arc width (typically 60–90°)
  maxRange: number;           // maximum effective engagement range
  minEngageRange: number;     // hold fire until target is within this range
}
```

The `minEngageRange` feeds into the ambush behavior tree — the platoon holds
fire until a contact enters the kill zone's inner range, maximising the
ambush's lethality.

### 6.4 Ataxian Assembly Areas

Ataxian assault platoons designate **assembly areas** — covered positions where
Scurriers mass before a charge. These are automatically selected from the
nearest forest or urban cell within 200m of the assigned objective.

```typescript
interface AssemblyArea {
  position: Vec2;
  coverType: TerrainType;     // Forest, Jungle, Urban
  capacityUnits: number;      // how many units can mass here
  distanceToObjective: number;
}
```

---

## 7. AI Fog of War

The AI uses the **same spotting system** as the player. AI units maintain
detection accumulators via the standard `updateSpotting()` function.

### 7.1 What the AI Knows

- Only contacts detected by AI units at SUSPECTED tier or higher
- SUSPECTED contacts: position ±50m, no type → AI treats as "something is there"
- DETECTED contacts: category known → AI can select weapon type
- CONFIRMED contacts: full type → AI can prioritise high-value targets

### 7.2 What the AI Does Not Know

- Player unit positions not detected by any AI observer
- Player orders, waypoints, or queued commands
- Player fire posture settings
- Exact player ammo or crew counts (unless CONFIRMED)

### 7.3 Information Sharing

AI units share contacts through the same C2 system as players:

- **Ataxian**: Units within 300m of a Synaptic Brood share contacts instantly
  (pheromone network). Units outside this range have independent accumulators.
- **Khroshi**: Broadcast Node provides instant sharing within aura radius.
  Without a Node, units share contacts at standard C2 radio range.

If the command unit is destroyed, information sharing degrades — isolated
platoons fight with only their own sensor data.

---

## 8. Mission-Type Specific AI Plans

### 8.1 Defend (AI is defender)

Used when AI holds objectives that players must seize.

**Disposition:**
- 60% of force at prepared positions around objectives (Line 2)
- 25% at forward positions (Line 1) as early warning / delay
- 15% mobile reserve behind objectives (Line 3)

**Behavior:**
- Forward elements engage at maximum range, fall back to Line 2 when
  strength drops below 50%
- Main defense holds until overrun
- Reserve commits when main position is threatened (Khroshi) or immediately
  when contact is made (Ataxian)

### 8.2 Seize (AI is attacker)

Used for Ataxian surge attacks and Khroshi offensive operations.

**Disposition:**
- 70% assault force advancing toward objective
- 20% support (artillery, overwatch)
- 10% flanking element using low-threat corridors

**Behavior:**
- Ataxian: Rush forward in waves, Scurriers lead, Warriors follow
- Khroshi: Methodical advance with artillery preparation, halt and engage
  at each contact, advance only when opposition suppressed

### 8.3 Breakthrough (AI is defender, layered)

**Disposition:**
- Line 1 (forward, 800–1000m from player entry): 25% of force, delay and harass
- Line 2 (main, 1500–2000m): 50% of force, primary defensive line
- Line 3 (final, 2500–3500m): 20% of force, last stand
- Flanking elements: 5% positioned perpendicular to advance axis

**Behavior:**
- Each line fights independently
- Khroshi: Lines hold until 40% strength, then fall back to next line
- Ataxian: Lines fight to destruction; no fallback

### 8.4 Evacuation / Survive (AI is attacker, waves)

**Disposition:**
- Reinforcement waves from 2–3 map edges
- Wave intensity escalates: 60% of total force arrives in last 1/3 of timer
- Strongest wave at 75% of mission timer

**Behavior:**
- Continuous pressure, rotating attack axes
- Ataxian: All-axis swarm, concentrating on weakest flank
- Khroshi: Methodical axis rotation, concentrating artillery on defender positions
  between waves

### 8.5 Raid / Rescue (AI is patrol + garrison)

**Disposition:**
- 30% garrison at target / NPC positions
- 30% patrols on predetermined routes
- 40% reinforcements arriving 15–20 minutes into mission

**Behavior:**
- Garrison units hold position until attacked
- Patrol units investigate contacts (move toward SUSPECTED blips)
- Reinforcements commit to the engagement point when garrison is attacked

### 8.6 Patrol (AI is scattered)

**Disposition:**
- Small groups (2–4 units) positioned near 40–60% of waypoints
- No coordinated defense; each group is independent

**Behavior:**
- Groups hold position until contact, then engage
- No reinforcement logic — what's there is what players face

---

## 9. Patrol Routes

AI patrol units follow pre-computed waypoint loops.

```typescript
interface PatrolRoute {
  waypoints: Vec2[];        // closed loop
  currentIndex: number;
  pauseAtWaypointSec: number;  // time to hold at each point (10–30s)
  moveMode: MoveMode;          // typically 'advance'
}
```

Patrol routes are generated at mission start by placing 3–5 waypoints in a
loop connecting the patrol group's start position to nearby objectives,
roads, or terrain features. Units ADVANCE between waypoints, pause for
10–30 seconds at each, then continue.

When a patrol group detects a contact:
1. Patrol loop is suspended
2. Group moves to investigate the contact position
3. If contact is CONFIRMED: engage per fire posture
4. If contact is LOST after 30 seconds: resume patrol loop

---

## 10. Difficulty Scaling

AI behavior is the same across difficulties. What changes is **force
composition**, not intelligence.

| Aspect | Easy | Medium | Hard |
|--------|------|--------|------|
| Enemy platoons | 2–3 | 4–6 | 7–10 |
| Unit quality | 80% baseline, 20% veteran | 50% baseline, 40% veteran, 10% elite | 10% baseline, 50% veteran, 40% elite |
| Support assets | None | Mortars | Mortars + artillery + air denial |
| Reinforcement waves | 1 wave | 2 waves | 3+ waves |
| Strategic AI update rate | Every 10s | Every 5s | Every 3s |

**Quality effects on AI units:**

| Quality | Accuracy | Crew | Suppression Threshold |
|---------|----------|------|----------------------|
| Baseline | ×1.0 | base | standard |
| Veteran | ×1.1 | +1 | +20 (harder to pin) |
| Elite | ×1.2 | +2 | +30 (nearly impossible to suppress) |

The AI does **not** get perfect information, faster reactions, or extra resources
at higher difficulties. Elite units are simply better soldiers — more accurate,
tougher, harder to suppress. This preserves the pseudo-realistic feel: hard
missions are hard because the *enemy* is better, not because the rules change.

---

## 11. Performance Budget

| Layer | Frequency | Per-Update Cost | Amortised Per-Tick |
|-------|-----------|-----------------|-------------------|
| Influence map update | Every 5s (100 ticks) | ≤ 0.6 ms | 0.006 ms |
| Objective scoring | Every 5s | ≤ 0.1 ms | 0.001 ms |
| Platoon BT eval (×10) | Every 1s (20 ticks) | ≤ 0.5 ms total | 0.025 ms |
| Patrol route advancement | Every tick | ≤ 0.1 ms | 0.1 ms |
| **Total AI overhead** | | | **~0.13 ms / tick** |

The AI's own pathfinding requests (MOVE orders) feed into the existing A*
pipeline and are subject to the same staggered-search cap (§9.2 of
PATHFINDING.md). A strategic redeployment of 15 units spreads across 3 ticks.

---

## 12. Canonical Types

```typescript
type Faction = 'ataxian' | 'khroshi';

type PlatoonIntent = 'attack' | 'defend' | 'reinforce' | 'retreat' | 'patrol';

interface Platoon {
  id: string;
  faction: Faction;
  units: string[];           // unit IDs
  commandUnitId: string | null;  // Synaptic Brood or Broadcast Node
  intent: PlatoonIntent;
  assignedObjectiveId: string | null;
  centroidX: number;
  centroidZ: number;
  strength: number;          // 0–1, surviving units / total
}

interface InfluenceMaps {
  threat: Float32Array;
  control: Float32Array;
}

interface FallbackPosition {
  id: string;
  x: number;
  z: number;
  facing: number;
  coverLevel: number;
  elevation: number;
  lineIndex: number;         // 0 = forward, 1 = main, 2 = final
  objectiveId: string;
}

interface KillZone {
  origin: Vec2;
  bearing: number;
  arcWidth: number;
  maxRange: number;
  minEngageRange: number;
}

interface AssemblyArea {
  position: Vec2;
  coverType: number;         // TerrainType enum
  capacityUnits: number;
  distanceToObjective: number;
}

interface PatrolRoute {
  waypoints: Vec2[];
  currentIndex: number;
  pauseAtWaypointSec: number;
  moveMode: MoveMode;
}

interface ReinforcementWave {
  arrivalTick: number;
  platoons: Platoon[];
  entryEdge: 'north' | 'south' | 'east' | 'west';
}

interface FactionWeights {
  objectiveValue: number;
  distancePenalty: number;
  threatAversion: number;
  controlPreference: number;
  aggressionBias: number;
  flankBonus: number;
  defensiveTerrainBonus: number;
  retreatThreshold: number;
}

interface ObjectiveAssignment {
  objectiveId: string;
  assignedPlatoons: string[];
  intent: PlatoonIntent;
}
```

---

## 13. Design Principles

1. **Same rules, different doctrine.** The AI plays by the same mechanics as
   the player. Its personality comes from weight tuning and BT structure, not
   from rule exceptions.

2. **Readable behavior.** Players should be able to observe and predict AI
   actions. Ataxians mass before they charge. Khroshi hold fire until you're
   in the kill zone. Both are dangerous, both are counterable.

3. **Kill the commander.** Both factions have a critical vulnerability — the
   Synaptic Brood (Ataxian) and the Broadcast Node (Khroshi). Destroying
   these units degrades the AI dramatically. This is the designed counterplay
   moment and the reason players bring scouts and snipers.

4. **Escalation, not omniscience.** Hard mode means better troops, not smarter
   AI. The decision-making is identical across difficulties. A veteran player
   can read the AI on hard the same way they read it on easy — the enemy just
   hits harder and pins less easily.

5. **No micromanagement.** The AI issues platoon-level orders. Individual units
   execute via fire posture and the simulation. This matches the game's
   design philosophy — the player is a commander, and so is the AI.
