# Deployment Phase
*Federation Legionaires — authoritative spec*
*Last updated: 2026-03-21*

This document defines the deployment phase: how players place their units on the map before combat begins, how shared deployment works in co-op, how late-joiners deploy during live combat, and how the server validates every placement. It bridges the force selection layer (BATTALION_CREATION.md, FORCE_ROSTERS.md) and the live game loop (SERVER_GAME_LOOP.md).

**Canonical references:**
- Unit runtime model: RUNTIME_UNIT_STATE.md (`UnitInstance`, `MissionState`, `PlayerMissionState`)
- Wire format: NETWORK_PROTOCOL.md (`DEPLOY_UNIT`, `DEPLOY_READY`, `DEPLOYMENT_ZONE`)
- Server tick loop: SERVER_GAME_LOOP.md (tick loop is suspended during deployment)
- Rosters: FORCE_ROSTERS.md (battalion TOEs, platoon groupings)
- Battalion management: BATTALION_CREATION.md (reserve flagging on OOB screen)
- Terrain: BUILDING_GRAMMARS.md (procedural buildings, district footprints)
- Persistence: CAMPAIGN_PERSISTENCE.md (`PersistentUnitRecord`, slot-based tracking)
- Shared contracts: AUTHORITATIVE_CONTRACTS.md (joinability, disconnect timers, grid authority model)

---

## 1. Deployment Zone Generation

The server generates a single shared deployment zone when the mission is created. All players deploy into the same zone. There are no per-player sub-zones — this is co-op, not competitive. Players see each other's placements in real time and coordinate freely.

### 1.1 Zone Shape

The zone is a **convex polygon** defined as an ordered array of `Vec2` vertices in world-space metres. Convexity is enforced at generation time — the server computes a convex hull from candidate positions and discards concavities. This guarantees that any point inside the polygon is reachable from any other point inside it without crossing the boundary, which simplifies both placement validation and pathfinding.

### 1.2 Zone Sizing

The zone is sized to accommodate **4 players' worth of units with spacing**. This is the maximum co-op team size. With fewer players, the zone feels spacious — this is intentional. Extra room gives players tactical flexibility in how they arrange their forces.

| Parameter | Value | Rationale |
|---|---|---|
| Minimum zone area | 250,000 m² (~500m x 500m) | Fits a full Mechanized battalion (110 units) at 25m spacing |
| Maximum zone area | 1,000,000 m² (~1km x 1km) | 4 full battalions with room for tactical grouping |
| Target area per player | 250,000 m² | Scales linearly with expected player count for the mission |
| Minimum edge length | 200m | Prevents degenerate thin slivers |

### 1.3 Mission-Type Placement

The zone's position on the map depends on the mission type. The server selects the zone origin, then grows the convex polygon from candidate grid points around that origin, excluding invalid terrain.

| Mission Type | Zone Origin | Zone Shape Tendency |
|---|---|---|
| **Defend** | Centered on the primary objective | Roughly circular, wrapping around the defensive position |
| **Seize** | Friendly map edge, facing the objective | Wide rectangle along the edge, 200–400m deep |
| **Raid** | Infiltration point (flank or designated LZ) | Compact cluster near cover, away from enemy concentration |
| **Patrol** | Friendly map edge, centered | Wide arc along the edge |
| **Logistics** | Friendly map edge near route entry/exit corridor | Broad frontage, moderate depth |

```
DEFEND — zone wraps around objective
                    ┌──────────────┐
                    │   ZONE       │
                    │      ★       │  ★ = objective
                    │   ZONE       │
                    └──────────────┘

SEIZE — zone at friendly edge
    ═══════════════════════════════  ← friendly map edge
    ┌─────────────────────────────┐
    │         ZONE (200-400m)     │
    └─────────────────────────────┘
                  ↓
              toward objective

RAID — compact zone at infiltration point
                         ┌────┐
                         │ZONE│
                         │    │
                         └────┘ ← flank entry, near tree line
```

### 1.4 Terrain Restrictions

The zone polygon is the outer boundary. Within it, individual hex cells are classified as **valid** or **blocked** for placement. The zone polygon itself excludes large invalid regions, but fine-grained checks happen at placement time (see Section 8).

Compatibility note: references to "hex" in this document mean logical overlay cells used for placement and validation. Movement and LOS remain authoritative in continuous world-space.

| Terrain | Placeable? | Notes |
|---|---|---|
| Open ground | Yes | Default valid |
| Light woods | Yes | Infantry and light vehicles |
| Dense woods | Yes (infantry only) | Vehicles rejected at placement validation |
| Road/highway | No | Units do not start on roads — they would block movement |
| Water (stream, river, lake) | No | |
| Cliff / impassable slope | No | Grade > 30 degrees |
| Inside building footprint | No | Building interiors are not deployment positions |
| Building adjacent (within 10m) | Yes | Good cover positions for infantry |
| Minefield (if pre-placed) | No | |

### 1.5 Zone Data Structure

```typescript
interface DeploymentZonePayload {
  zone:                 SharedDeploymentZone;
  reinforcementEntries: ReinforcementEntryPoint[];
  timerDurationSec:     number;            // initial deployment timer (180)
}

interface SharedDeploymentZone {
  zoneId:       string;
  polygon:      Vec2[];                    // convex hull vertices, world-space metres
  blockedCells: HexCoord[];               // hexes inside polygon that are terrain-blocked
}

interface ReinforcementEntryPoint {
  entryId:      string;
  position:     Vec2;                      // center of the entry area
  radius:       number;                    // metres — reinforcements spawn within this radius
  edgeFacing:   number;                    // degrees — default facing for units entering here
}
```

---

## 2. Unit Placement Rules

### 2.1 Placement Interaction

Players drag units from their roster panel onto the 3D map within the zone boundary. Each placement sends a `DEPLOY_UNIT` message to the server. The server validates and either accepts (unit appears on the map for all players) or rejects (unit returns to the roster panel with an error tooltip).

```
Roster Panel                   3D Map (within zone)
┌──────────────┐
│ 1st Plt, A Co│
│  ☐ T1 Abrams │──── drag ────→  ◆ (placed at cursor position)
│  ☐ T1 Abrams │                  │
│  ☐ T1 Abrams │                  server validates...
│  ☐ T1 Abrams │                  │
│  ☑ T1 Abrams │ ← placed        ✓ ACCEPTED → unit rendered for all players
│              │                  ✗ REJECTED → unit snaps back to roster + error
│ 2nd Plt, A Co│
│  ☐ T1 Abrams │
│  ...         │
└──────────────┘
```

### 2.2 Facing

After placing a unit, the player sets initial facing by dragging a facing indicator (radial arrow emanating from the placed unit). Default facing if not explicitly set: toward the map center or primary objective, computed by the server at zone generation time.

The facing value is the `heading` field on `UnitInstance` — degrees, 0 = north, clockwise. For turreted vehicles, `turretHeading` is initialized to match `heading` at deployment.

### 2.3 Spacing

No two units may occupy the same position. A minimum **25-metre spacing** is enforced between any two placed units, regardless of owner.

```typescript
const MIN_PLACEMENT_SPACING_M = 25;
```

This prevents stacking, ensures units have room to maneuver when the live phase begins, and keeps the visual display readable. The spacing check runs against all units already placed in the zone — both the current player's and all other players' units.

### 2.4 Terrain-Class Restrictions

Not all units can go on all terrain within the zone. The server checks the terrain type at the placement position against the unit's movement class.

| Unit Class | Valid Terrain | Rejected Terrain |
|---|---|---|
| **Infantry** (foot) | Open, woods (light/dense), rough, urban edge | Water, cliff, road, building interior |
| **Wheeled vehicle** | Open, road-adjacent open, light woods edge | Dense woods, water, cliff, steep slope (>15°), building interior |
| **Tracked vehicle** | Open, light woods, rough | Dense woods, water, cliff, steep slope (>25°), building interior |
| **Helicopter** | Open, road-adjacent open | Dense woods, water, cliff, building interior |
| **Artillery (SP)** | Open, light woods, road-adjacent open | Dense woods, water, cliff, building interior |
| **Towed artillery** | Open, light woods | Dense woods, water, cliff, building interior |

**Road restriction clarification:** Units cannot be placed *on* a road hex, but "road-adjacent" terrain (within 25m of a road) is valid for vehicles. This keeps roads clear for movement while letting players stage vehicles near road access.

### 2.5 Helicopters Deploy Landed

All helicopters are placed in the `'landed'` altitude state during deployment. They occupy ground space and are subject to ground placement rules. Takeoff happens during the live phase when the player issues an `ALTITUDE` order.

```typescript
// At deployment, helicopter UnitInstance is initialized with:
// altitudeState = 'landed'
// altitudeTransitioning = false
// posX, posZ = placement position (ground level)
```

### 2.6 Repositioning

Players can pick up and reposition their own units freely during deployment. Repositioning sends a new `DEPLOY_UNIT` message for the same `unitId` — the server treats it as a move, not a duplicate. The old position is vacated and the new position is validated identically to a fresh placement.

Players **cannot** move other players' units. Ownership is checked on every `DEPLOY_UNIT` message.

---

## 3. Reserve and Off-Map Units

### 3.1 Pre-Mission Reserve Flagging

On the **Order of Battle screen** (between missions, per BATTALION_CREATION.md), players can flag individual units or entire platoons as **reserves**. Reserved units do not appear in the deployment roster — they are held off-map for later call-in.

```typescript
// On PersistentUnitRecord (CAMPAIGN_PERSISTENCE.md)
interface PersistentUnitRecord {
  // ... existing fields ...
  reserveFlag: boolean;       // true = held off-map, not in deployment roster
}
```

Reserve flagging is a strategic decision made before the mission starts. It cannot be changed during deployment — the roster the player brings to the deployment screen is final.

### 3.2 Ad-Hoc Reserves (Unplaced Units)

When the deployment timer expires, the server runs auto-deploy (Section 6) for all unplaced units. Units that auto-deploy fails to place (due to zone congestion or terrain constraints) become **ad-hoc reserves**. They join the reserve pool alongside deliberately flagged reserves.

### 3.3 Calling in Reserves During LIVE

During the live phase, players can call in reserve units at **reinforcement entry points**. These are 1–3 positions along the friendly map edge, defined at mission generation time and sent to clients in the `DeploymentZonePayload`.

```
    ═══════════════════════════════  ← friendly map edge
         ▲           ▲          ▲
        [R1]        [R2]       [R3]    R = reinforcement entry point
         │           │          │
         └───── 60-second delay from call to arrival
```

**Calling procedure:**

1. Player selects a reserve unit from the reserve panel (accessible during live phase).
2. Player selects a reinforcement entry point on the map.
3. Client sends a `CALL_RESERVES` message.
4. Server validates: unit is in reserve pool, entry point exists, no cooldown active.
5. Server starts a **60-second arrival timer**.
6. After 60 seconds, the unit spawns at the entry point facing inward.
7. Unit is immediately controllable — no deployment phase for reserves.

```typescript
interface CallReservesPayload {
  unitIds:    string[];        // one or more reserve units to call in together
  entryId:    string;          // reinforcement entry point ID
}

interface ReserveArrivalPayload {
  unitIds:    string[];
  entryId:    string;
  arrivalTick: number;         // tick when units will appear
}
```

**Arrival delay:** 60 seconds (1200 ticks at 20 Hz). Long enough to prevent instant reinforcement abuse, short enough that calling them early in a fight means they arrive before it is over.

---

## 4. Real-Time Shared Deployment

### 4.1 All Players, One Zone

All co-op players deploy into the same zone simultaneously. There is no turn order, no sub-zone assignment, no deployment priority. Every placement is broadcast to all connected players immediately upon server acceptance.

```
        Player A places            Player B places            Player C places
        T1 Abrams at (1200, 800)   Bradley at (1250, 750)     Rifle Squad at (1180, 820)
             │                          │                           │
             ▼                          ▼                           ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                     SERVER                                      │
        │  Validate → Accept → Update shared state → Broadcast to ALL    │
        └─────────────────────────────────────────────────────────────────┘
             │                          │                           │
             ▼                          ▼                           ▼
        All 3 players see all 3 units appear on the map in real time
```

### 4.2 Deployment Timer

The deployment phase runs on a countdown timer. The default duration is **180 seconds (3 minutes)**.

| Event | Timer Behavior |
|---|---|
| Deployment phase starts | Timer set to 180 seconds |
| New player joins during deployment | Timer resets to `max(currentRemaining, 60)` — minimum 60 seconds |
| Player sends `DEPLOY_READY` | That player is marked ready |
| All connected players are ready | Timer skipped — immediate transition to LIVE |
| Single player in mission sends `DEPLOY_READY` | Immediate transition to LIVE (solo fast-start) |
| Timer reaches 0 | Auto-deploy runs for unplaced units, then transition to LIVE |

```typescript
const DEPLOYMENT_TIMER_DEFAULT_SEC = 180;
const DEPLOYMENT_TIMER_MIN_SEC     = 60;

interface DeploymentTimerState {
  remainingSec:   number;
  playerReady:    Map<string, boolean>;
  autoDeployAt:   number;                   // server tick when timer expires
}
```

### 4.3 Deployment State Broadcast

During the deployment phase, the server broadcasts placement events to all clients in real time. These are deployment-specific updates (same envelope as `TICK_UPDATE`), but they are produced by deployment handlers, not by the full combat tick pipeline.

### 4.4 Player Color Coding

Each player is assigned a distinct color at mission join time.

| Player Slot | Color | Hex |
|---|---|---|
| Player 1 | Blue | `#4A90D9` |
| Player 2 | Green | `#5BAA4A` |
| Player 3 | Orange | `#D98C4A` |
| Player 4 | Purple | `#9B59B6` |

Colors persist into the live phase for the C2 display but become subtler (thin outline rather than full border) to avoid visual noise during combat.

### 4.5 Ready System

Players signal readiness by sending `DEPLOY_READY`. The server tracks ready state per player and broadcasts it to all clients.

```typescript
interface DeploymentReadyUpdate {
  playerStates: { playerId: string; ready: boolean }[];
  allReady:     boolean;
}
```

**Undo ready:** A player who has sent `DEPLOY_READY` can undo it by sending another `DEPLOY_UNIT` message (placing or repositioning a unit). This automatically clears their ready flag.

**Transition to LIVE:** When all connected players are ready OR the timer expires:

1. Server runs auto-deploy for any remaining unplaced units (Section 6).
2. Server transitions `missionPhase` from `'deployment'` to `'live'`.
3. Server sends `MISSION_PHASE { phase: 'live' }` to all clients.
4. Tick loop begins running combat phases (SERVER_GAME_LOOP.md phases 1–9).
5. All deployed units initialize with `speedState = 'full_halt'`, `stoppedForSec = 10`.

---

## 5. Late-Joiner Deployment (During LIVE)

### 5.1 Late-Joiner Deployment Zone

A late-joiner does not deploy into the original deployment zone. Instead, they receive a **reduced deployment zone** at the friendly map edge, centered on a reinforcement entry point.

```typescript
interface LateJoinDeploymentZone {
  zoneId:       string;
  polygon:      Vec2[];              // small zone at map edge
  entryId:      string;              // which reinforcement entry point this is near
  timerSec:     number;              // 30 seconds
  blockedCells: HexCoord[];
}
```

| Parameter | Value |
|---|---|
| Zone size | ~100m x 200m at the map edge |
| Timer | 30 seconds |
| Auto-deploy on expiry | Yes |
| Zone position | Centered on a reinforcement entry point |

### 5.2 Late-Joiner Flow

```
Late-joiner connects during LIVE phase
  │
  ├── Server sends MISSION_STATE_FULL (current battlefield state, fog-filtered)
  ├── Server sends DEPLOYMENT_ZONE (late-join zone at friendly edge)
  │
  ├── 30-second timer starts
  │   Player places units within the small zone
  │   Existing players see "Player D is deploying" notification
  │
  ├── Timer expires OR player sends DEPLOY_READY
  │   Auto-deploy remaining units
  │   Late-joiner's units are now LIVE — controllable immediately
  │
  └── No special protection: units are visible to enemies immediately
      No enemy scaling: mission difficulty does not change
```

### 5.3 No Enemy Scaling

When a late-joiner's units enter the battle, the enemy force does not scale up. The mission was generated for a specific difficulty level; adding more friendly forces makes it easier. This is intentional — co-op games should reward teamwork, not punish it.

---

## 6. Auto-Deployment Algorithm

When the deployment timer expires with unplaced units remaining, or when a player uses the "Quick Deploy" button, the server runs the auto-deployment algorithm.

### 6.1 Algorithm Steps

```
AUTO-DEPLOY(unplacedUnits[], zone, alreadyPlacedUnits[])
  │
  ├── 1. Group unplaced units by platoon
  │
  ├── 2. Sort platoons by placement priority:
  │      HQ units first → Vehicles → Infantry → Artillery → Support
  │
  ├── 3. For each platoon:
  │   │
  │   ├── 3a. Select a platoon anchor point within the zone:
  │   │      - Away from already-placed units (maximize spacing)
  │   │      - Vehicles: prefer open ground cells
  │   │      - Infantry: prefer cells with adjacent cover (woods, buildings)
  │   │      - Artillery: prefer rear of zone (furthest from expected enemy)
  │   │
  │   ├── 3b. Place platoon units in a cluster around the anchor:
  │   │      - 25m minimum spacing enforced
  │   │      - Spiral outward from anchor if positions are taken
  │   │      - Terrain-class check per unit (Section 2.4)
  │   │
  │   └── 3c. Set facing:
  │          - Toward primary objective (defend/seize missions)
  │          - Toward map center (patrol/logistics)
  │
  ├── 4. Units that cannot be placed (zone full, all valid cells taken):
  │      → Added to ad-hoc reserve pool
  │
  └── 5. Broadcast all auto-placed units in next TICK_UPDATE
```

### 6.2 Placement Heuristics

| Unit Category | Anchor Preference | Spacing Pattern |
|---|---|---|
| **MBT / IFV / APC** | Open ground, slight elevation preferred | Line formation, 30–50m between vehicles |
| **Infantry squads** | Adjacent to woods, buildings, rough terrain | Cluster, 25–35m spacing |
| **Artillery (SP/towed)** | Rear of zone, open ground for fields of fire | Spread, 50–75m between guns |
| **Helicopters** | Open ground, away from trees | Dispersed, 40–60m spacing |
| **HQ / Support** | Center-rear of zone | Near other units for C2 range |
| **Scout** | Forward edge of zone | Spread along the forward boundary |

### 6.3 Facing Defaults

```typescript
function computeAutoFacing(unitPos: Vec2, mission: MissionState): number {
  const target = mission.primaryObjective?.position ?? mapCenter(mission);
  const dx = target.x - unitPos.x;
  const dz = target.z - unitPos.z;
  return (Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360;
}
```

---

## 7. Deployment UI Elements

### 7.1 Screen Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DEPLOYMENT PHASE                               │
│                           ┌──────────────────┐                              │
│                           │   TIMER  2:47    │                              │
│                           └──────────────────┘                              │
│                                                                             │
│  ┌──────────────┐   ┌──────────────────────────────────────────────┐        │
│  │ ROSTER PANEL │   │                                              │        │
│  │              │   │              3D MAP VIEW                     │        │
│  │ ▸ A Company  │   │                                              │        │
│  │   ☐ T1 #1   │   │    ╔══════════════════════╗                  │        │
│  │   ☐ T1 #2   │   │    ║  DEPLOYMENT ZONE     ║                  │        │
│  │   ☑ T1 #3   │   │    ║                      ║                  │        │
│  │   ☐ T1 #4   │   │    ║   ◆P1  ◆P1          ║                  │        │
│  │              │   │    ║        ◆P2   ◆P1    ║                  │        │
│  │ ▸ B Company  │   │    ║   ◆P2       ◆P3    ║                  │        │
│  │   ☐ T1 #5   │   │    ║                      ║                  │        │
│  │   ...        │   │    ╚══════════════════════╝                  │        │
│  │              │   │                                              │        │
│  │──────────────│   │                                              │        │
│  │[QUICK DEPLOY]│   └──────────────────────────────────────────────┘        │
│  └──────────────┘                                                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────┐  ┌──────────────┐  │
│  │ PLAYER READY STATES                                 │  │              │  │
│  │  ● Player 1 (you): NOT READY    ● Player 2: READY  │  │ [  READY  ]  │  │
│  │  ● Player 3: PLACING            ● Player 4: —      │  │              │  │
│  └─────────────────────────────────────────────────────┘  └──────────────┘  │
│                                                                             │
│  ┌──────────────────────┐                                                   │
│  │     MINIMAP          │  Shows: zone boundary, placed units (color-coded),│
│  │   ┌────────────┐     │  reinforcement entry points, terrain overview     │
│  │   │ ·  ·  ·    │     │                                                   │
│  │   │    [ZONE]  │     │                                                   │
│  │   │  ·    ·    │     │                                                   │
│  │   └────────────┘     │                                                   │
│  └──────────────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Roster Panel

| Element | Behavior |
|---|---|
| Company headers | Collapsible. Show unit count: "A Company (4/15 placed)" |
| Unit entries | Checkbox icon: ☐ = unplaced, ☑ = placed. Unit type name + callsign. |
| Drag source | Click and drag a unit entry to begin placement on the 3D map. |
| Click on placed unit | Camera pans to that unit's position on the map. |
| Platoon grouping | Units within a platoon are visually grouped with an indent. |
| Reserve units | Not shown in roster panel — separate "Reserves" tab (read-only during deployment). |

### 7.3 Zone Boundary Overlay

| Visual Element | Specification |
|---|---|
| Fill | Team color, 15% opacity |
| Border | Team color, 80% opacity, 2px dashed line |
| Blocked cells | Red-tinted, 30% opacity, no-entry icon on hover |
| Cursor inside zone | Green placement ghost of the selected unit |
| Cursor outside zone | Red placement ghost + "Outside deployment zone" tooltip |

### 7.4 Quick Deploy Button

Bottom of the roster panel. Triggers auto-deploy (Section 6) for all of the current player's unplaced units. Does not affect other players' units. Does not automatically set the player as ready.

---

## 8. Server Validation

Every `DEPLOY_UNIT` message is validated by the server before the placement is accepted. The client displays placements optimistically but rolls back if the server rejects.

### 8.1 Validation Sequence

| # | Check | Error Code | Description |
|---|---|---|---|
| 1 | Unit exists | `ERR_UNIT_NOT_FOUND` | The `unitId` does not match any unit in the mission |
| 2 | Unit belongs to this player | `ERR_NOT_YOUR_UNIT` | Player cannot place another player's unit |
| 3 | Unit is not already deployed (unless repositioning) | `ERR_ALREADY_DEPLOYED` | Duplicate placement without explicit reposition intent |
| 4 | Mission is in deployment phase | `ERR_WRONG_PHASE` | Cannot deploy during live phase (except late-joiner) |
| 5 | Position is within zone polygon | `ERR_OUTSIDE_ZONE` | Point-in-convex-polygon test |
| 6 | Position hex is not terrain-blocked | `ERR_TERRAIN_BLOCKED` | Water, cliff, building interior, road |
| 7 | Unit class is compatible with terrain | `ERR_TERRAIN_MISMATCH` | Vehicle on dense woods, etc. (Section 2.4) |
| 8 | Minimum spacing (25m) from all other units | `ERR_TOO_CLOSE` | Distance check against all placed units |
| 9 | Facing is valid (0–360 degrees) | `ERR_INVALID_FACING` | Sanity check on heading value |
| 10 | Unit is not flagged as reserve | `ERR_UNIT_IS_RESERVE` | Reserve units cannot be deployed during initial deployment |

### 8.2 Point-in-Polygon Test

```typescript
function isInsideConvexPolygon(point: Vec2, polygon: Vec2[]): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (cross < 0) return false;
  }
  return true;
}
```

### 8.3 Spacing Check

```typescript
function checkSpacing(
  position: Vec2,
  unitId: string,
  allPlacedUnits: Map<string, UnitInstance>
): boolean {
  for (const [id, unit] of allPlacedUnits) {
    if (id === unitId) continue;
    const dx = position.x - unit.posX;
    const dz = position.z - unit.posZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < MIN_PLACEMENT_SPACING_M * MIN_PLACEMENT_SPACING_M) {
      return false;
    }
  }
  return true;
}
```

### 8.4 Rejection Response

```typescript
type DeployRejectCode =
  | 'ERR_UNIT_NOT_FOUND'
  | 'ERR_NOT_YOUR_UNIT'
  | 'ERR_ALREADY_DEPLOYED'
  | 'ERR_WRONG_PHASE'
  | 'ERR_OUTSIDE_ZONE'
  | 'ERR_TERRAIN_BLOCKED'
  | 'ERR_TERRAIN_MISMATCH'
  | 'ERR_TOO_CLOSE'
  | 'ERR_INVALID_FACING'
  | 'ERR_UNIT_IS_RESERVE';

interface DeployRejectPayload {
  refSeq:   number;
  unitId:   string;
  code:     DeployRejectCode;
  message:  string;              // "Vehicle cannot be placed in dense woods"
}
```

### 8.5 Server Authority

The server is the sole authority on deployment state. The client renders placement ghosts optimistically for responsiveness, but a ghost is not "real" until the server confirms it. If a confirmation does not arrive within 500ms, the client rolls back the ghost.

All placed unit positions are part of the `MissionState` and are included in crash-recovery snapshots (SERVER_GAME_LOOP.md Section 6).

---

## 9. Phase Transitions

### 9.1 Entering Deployment

```
CREATED → DEPLOYMENT
  │
  ├── Server generates deployment zone (Section 1)
  ├── Server generates reinforcement entry points
  ├── Server creates UnitInstance objects for all deployed units
  │   └── posX = posZ = -1 (sentinel: not yet placed)
  ├── Server starts deployment timer (180 seconds)
  ├── Server sends DEPLOYMENT_ZONE to all connected clients
  └── Server sends MissionStateFullPayload with DeploymentRoster per player
```

### 9.2 Exiting Deployment

```
DEPLOYMENT → LIVE
  │
  ├── Trigger: all players ready OR timer expires
  ├── Auto-deploy runs for unplaced units (Section 6)
  ├── Units that cannot be placed → reserve pool
  ├── All placed units initialized:
  │   ├── speedState = 'full_halt'
  │   ├── stoppedForSec = 10
  │   ├── firePosture = 'return_fire'
  │   └── all weapon cooldowns = 0
  ├── Server transitions missionPhase to 'live'
  ├── Server sends MISSION_PHASE { phase: 'live' } to all clients
  └── Tick loop begins running all 9 phases
```

### 9.3 Late-Joiner During LIVE

```
Player joins during LIVE phase
  │
  ├── Server creates UnitInstance objects for joiner's deployed units
  ├── Server generates late-join zone at reinforcement entry point (Section 5)
  ├── Server sends MISSION_STATE_FULL (full battlefield snapshot, fog-filtered)
  ├── Server sends DEPLOYMENT_ZONE (late-join zone, 30-second timer)
  ├── Existing players receive PLAYER_STATUS { joined, deploying }
  │
  ├── 30-second timer runs (tick loop continues for existing players)
  │
  ├── Timer expires OR joiner sends DEPLOY_READY
  │   ├── Auto-deploy remaining units
  │   ├── Joiner's units become live — included in all tick phases
  │   └── Existing players receive PLAYER_STATUS { joined, live }
  │
  └── Deployment timer for existing players is NOT affected
```

---

## 10. Integration Points

### 10.1 Cross-Reference Table

| System Doc | Integration | Direction |
|---|---|---|
| NETWORK_PROTOCOL.md | `DEPLOY_UNIT`, `DEPLOY_READY`, `DEPLOYMENT_ZONE` messages | This doc extends those types |
| SERVER_GAME_LOOP.md | Tick loop suspended during deployment (Phase 9 only) | Game loop defers to this doc |
| RUNTIME_UNIT_STATE.md | `UnitInstance` created at deployment with sentinel position | This doc defines initialization values |
| BATTALION_CREATION.md | Reserve flagging on OOB screen | Reserve flag feeds into Section 3 |
| FORCE_ROSTERS.md | Platoon/company groupings for roster panel and auto-deploy | Platoon structure drives Section 6 |
| CAMPAIGN_PERSISTENCE.md | `PersistentUnitRecord.reserveFlag` | This doc adds the `reserveFlag` field |
| BUILDING_GRAMMARS.md | Building footprints excluded from valid placement cells | Terrain restriction in Section 1.4 |

### 10.2 New Message Types

| Direction | Type | Payload | Purpose |
|---|---|---|---|
| Client → Server | `CALL_RESERVES` | `CallReservesPayload` | Request reserve unit arrival during LIVE |
| Server → Client | `RESERVE_ARRIVAL` | `ReserveArrivalPayload` | Notify players of incoming reserves |
| Server → Client | `DEPLOY_REJECT` | `DeployRejectPayload` | Placement validation failure |
| Server → Client | `DEPLOYMENT_READY_UPDATE` | `DeploymentReadyUpdate` | Broadcast player ready states |

---

*This document is the authoritative reference for the deployment phase. NETWORK_PROTOCOL.md defines the wire format for deployment messages; this document defines their semantics, validation rules, and the deployment lifecycle.*
