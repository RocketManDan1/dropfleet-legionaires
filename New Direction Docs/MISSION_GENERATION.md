# Mission Generation
*Federation Legionaires — authoritative mission creation specification*
*Last updated: 2026-03-21*

---

## Overview

Missions do not pre-exist. They are created on demand when a player arrives at a contested planet and selects a difficulty. The server either joins the player into an active compatible mission or generates a fresh one. Every mission is a self-contained tactical engagement with procedurally generated terrain, enemies, and objectives.

This document is the authoritative reference for:
- How missions are created, joined, and instanced
- What each difficulty tier means for enemy composition, rewards, and tuning
- The complete catalog of mission archetypes
- How mission type selection works
- How enemy forces are generated
- How map generation is constrained per mission type
- Objective definitions
- Cross-document contract source: AUTHORITATIVE_CONTRACTS.md

---

## 1. Mission Creation Flow

### Player-Initiated

Missions are triggered by player action, not spawned on a timer.

```
Player arrives at contested planet (influence 21-99% enemy)
  └── Player selects difficulty: Easy | Medium | Hard
        └── Server queries: active mission at this planet + difficulty?
              ├── YES, joinable (state = DEPLOYMENT or LIVE, participants < 4)
              │     └── Join existing mission instance
              └── NO (none exists, or all are full / past LIVE)
                    └── Create new mission instance
                          ├── Select mission type (weighted random, see §4)
                          ├── Generate missionId (UUID v4)
                          ├── Derive mapSeed from missionId
                          ├── Generate enemy force (see §5)
                          ├── Generate map from seed + mission constraints (see §6)
                          └── Transition to DEPLOYMENT state
```

### Instance Limits

- **Maximum 4 players per mission instance.** A 5th player requesting the same planet + difficulty creates a new instance.
- **No party system.** Players coordinate out of band.

---

## 2. Difficulty Tiers

Three difficulty levels. Each is tuned for a target player count but does not enforce it. Enemy forces are fixed at generation time and do not scale with the number of players who join.

| Aspect | Easy | Medium | Hard |
|---|---|---|---|
| **Tuned for** | 1 player | 2 players | 3 players |
| **Enemy platoons** | 2–3 | 4–6 | 7–10 |
| **Enemy quality** | Mostly baseline | Mix baseline / veteran | Veteran and elite |
| **Enemy support assets** | None | Light (mortars) | Heavy (artillery, air) |
| **Time limit** | 45 min | 40 min | 35 min |
| **SP multiplier** | x1.0 | x1.5 | x2.0 |
| **Influence impact** | Small | Medium | Large |
| **Secondary objectives** | 0–1 | 1–2 | 2–3 |

*All values are initial tuning targets, subject to playtesting.*

### Design Rationale

- **More players on Hard = easier.** Enemy count is locked at generation. Bringing a 4th player to a Hard mission designed for 3 gives a genuine advantage.
- **No scaling means no gaming the system.** A solo player on Easy faces 2–3 platoons. A solo player on Hard faces 7–10.
- **Time limit decreases with difficulty.** Hard missions demand faster execution.

### TypeScript Interface

```typescript
type DifficultyTier = 'easy' | 'medium' | 'hard';

interface DifficultyProfile {
  tier: DifficultyTier;
  tunedForPlayers: number;
  enemyPlatoonRange: [min: number, max: number];
  enemyQualityWeights: {
    baseline: number;
    veteran: number;
    elite: number;
  };
  supportAssets: SupportAssetProfile;
  timeLimitSeconds: number;
  spMultiplier: number;
  influenceImpact: 'small' | 'medium' | 'large';
  secondaryObjectiveRange: [min: number, max: number];
}

interface SupportAssetProfile {
  mortars: boolean;
  artillery: boolean;
  airSupport: boolean;
}

const DIFFICULTY_PROFILES: Record<DifficultyTier, DifficultyProfile> = {
  easy: {
    tier: 'easy',
    tunedForPlayers: 1,
    enemyPlatoonRange: [2, 3],
    enemyQualityWeights: { baseline: 0.8, veteran: 0.2, elite: 0.0 },
    supportAssets: { mortars: false, artillery: false, airSupport: false },
    timeLimitSeconds: 2700,
    spMultiplier: 1.0,
    influenceImpact: 'small',
    secondaryObjectiveRange: [0, 1],
  },
  medium: {
    tier: 'medium',
    tunedForPlayers: 2,
    enemyPlatoonRange: [4, 6],
    enemyQualityWeights: { baseline: 0.5, veteran: 0.4, elite: 0.1 },
    supportAssets: { mortars: true, artillery: false, airSupport: false },
    timeLimitSeconds: 2400,
    spMultiplier: 1.5,
    influenceImpact: 'medium',
    secondaryObjectiveRange: [1, 2],
  },
  hard: {
    tier: 'hard',
    tunedForPlayers: 3,
    enemyPlatoonRange: [7, 10],
    enemyQualityWeights: { baseline: 0.1, veteran: 0.5, elite: 0.4 },
    supportAssets: { mortars: true, artillery: true, airSupport: true },
    timeLimitSeconds: 2100,
    spMultiplier: 2.0,
    influenceImpact: 'large',
    secondaryObjectiveRange: [2, 3],
  },
};
```

### Influence Impact Values

| Impact | Base Influence Reduction | Strategic Value Bonus |
|---|---|---|
| Small | 3–5 points | +1 if strategic_value_tier = 1 |
| Medium | 6–10 points | +2 if strategic_value_tier = 1 |
| Large | 11–18 points | +3 if strategic_value_tier = 1 |

---

## 3. Mission Type Catalog

Ten mission archetypes.

### 3.1 DEFEND

| Property | Value |
|---|---|
| Influence band | Any (21–99%) |
| Faction restriction | None |
| Primary objective | HOLD_POSITION (1–3 marked zones) |
| Victory condition | Hold all positions for mission duration, OR destroy 80%+ of attackers |
| Defeat condition | All held positions lost |
| Enemy disposition | Waves from 1–2 map edges. First wave at mission start, subsequent waves every 8–12 min. Each wave escalates. |
| Map characteristics | Defensive terrain around objectives. Open approaches for enemy. Deployment zone centered on objectives. |
| Secondary objectives | MINIMIZE_CASUALTIES, DESTROY_ALL |

### 3.2 SEIZE

| Property | Value |
|---|---|
| Influence band | Any (21–99%) |
| Faction restriction | None |
| Primary objective | CAPTURE_POSITION (1–3 enemy-held zones) |
| Victory condition | All primary positions captured and held for 60 seconds |
| Defeat condition | Time expires with any primary position uncaptured |
| Enemy disposition | Dug in at objective positions. Static defenses with prepared fields of fire. Reserve force for counterattack. |
| Map characteristics | Objectives on defensible terrain (hilltops, town centers, crossroads). Road network to objectives. Covered approach routes available but indirect. |
| Secondary objectives | SPEED, CAPTURE_SECONDARY, MINIMIZE_CASUALTIES |

### 3.3 RAID

| Property | Value |
|---|---|
| Influence band | Enemy > 30% |
| Faction restriction | None |
| Primary objective | DESTROY_TARGETS (2–4 marked structures or units) |
| Victory condition | All targets destroyed AND 50%+ of player forces extracted |
| Defeat condition | Time expires with targets remaining, OR player force destroyed |
| Enemy disposition | Light garrison at target. Patrols along approaches. Heavy reinforcements arrive 15–20 min in. |
| Map characteristics | Compact map. Target compound at center. Multiple approach routes. Extraction zone on entry edge. Terrain favors concealed movement. |
| Secondary objectives | SPEED, MINIMIZE_CASUALTIES |

### 3.4 PATROL

| Property | Value |
|---|---|
| Influence band | Enemy < 50% |
| Faction restriction | None |
| Primary objective | REACH_WAYPOINTS (4–6 waypoints in sequence) |
| Victory condition | All waypoints reached |
| Defeat condition | Time expires with waypoints remaining |
| Enemy disposition | Scattered. Small enemy groups near 40–60% of waypoints. Some waypoints are clear. |
| Map characteristics | Larger map. Open terrain with concealment pockets. Waypoints distributed across the map. |
| Secondary objectives | DESTROY_ALL, MINIMIZE_CASUALTIES |

### 3.5 RESCUE

| Property | Value |
|---|---|
| Influence band | Enemy > 40% |
| Faction restriction | None |
| Primary objective | EXTRACT_UNITS (1–2 groups of friendly NPCs) |
| Victory condition | All NPC groups reach extraction zone alive |
| Defeat condition | All NPC groups destroyed, OR time expires |
| Enemy disposition | Surrounding NPC positions. Ongoing fire on NPCs. Additional enemy forces between player and NPCs. |
| Map characteristics | NPC positions deep in map. Extraction zone on player's entry edge. |
| Secondary objectives | SPEED, MINIMIZE_CASUALTIES |

**NPC Behaviour:** Rescued NPCs follow a RETREAT order toward extraction once a player unit is within 150m. They do not fight offensively.

### 3.6 BREAKTHROUGH

| Property | Value |
|---|---|
| Influence band | Enemy > 60% |
| Faction restriction | None |
| Primary objective | REACH_WAYPOINTS (exit zone on far edge) |
| Victory condition | 50%+ of deployed player units reach exit zone |
| Defeat condition | Time expires, OR player force reduced below 50% before reaching exit |
| Enemy disposition | Layered defense in depth. Multiple defensive lines. Flanking elements. Reserve at final line. |
| Map characteristics | Rectangular map, longer on advance axis. Alternating open/cover. Deployment on one edge, exit on opposite. |
| Secondary objectives | SPEED, MINIMIZE_CASUALTIES, DESTROY_ALL |

### 3.7 EVACUATION

| Property | Value |
|---|---|
| Influence band | Enemy > 50% |
| Faction restriction | None |
| Primary objective | SURVIVE (hold until evacuation timer completes — 15–25 min) |
| Victory condition | Evacuation timer completes with at least one held position intact |
| Defeat condition | All held positions overrun before evacuation completes |
| Enemy disposition | Continuous pressure from multiple directions. Waves escalate. Strongest wave at 75% of timer. |
| Map characteristics | Central compound or town. Open fields of fire in at least two directions. Player deploys around perimeter. |
| Secondary objectives | MINIMIZE_CASUALTIES, PROTECT_STRUCTURE |

### 3.8 HIVE_CLEAR

| Property | Value |
|---|---|
| Influence band | Ataxian > 40% |
| Faction restriction | **Ataxian Hive only** |
| Primary objective | DESTROY_TARGETS (2–5 hive nodes) |
| Victory condition | All hive nodes destroyed |
| Defeat condition | Time expires with nodes remaining |
| Enemy disposition | Hive nodes spawn Scurrier and Warrior castes every 90–120 seconds. Nodes defended by static Warrior guards. Synaptic Brood at deepest node. |
| Map characteristics | Heavy vegetation, irregular terrain. Nodes in low terrain or forested areas. Tunnel-like ravines. Degraded road network. |
| Secondary objectives | SPEED, DESTROY_ALL |

**Special Mechanic:** Hive nodes are destructible terrain objects (500 HP). Destroying a node stops its spawning permanently.

### 3.9 FORTIFICATION_ASSAULT

| Property | Value |
|---|---|
| Influence band | Khroshi > 40% |
| Faction restriction | **Khroshi Syndicalists only** |
| Primary objective | CAPTURE_POSITION (fortified compound, 1–2 zones) |
| Victory condition | All positions captured and held for 120 seconds |
| Defeat condition | Time expires with positions uncaptured |
| Enemy disposition | Entrenched. Overlapping fields of fire. Automaton Walkers hull-down. Broadcast Node providing suppression resistance. Coordinated Battery in depth. Conscript Mobs as forward screen. |
| Map characteristics | Fortified compound with defensive berms and clear fields of fire. Multiple approach axes. At least one covered approach. Deployment 800–1200m from fortification. |
| Secondary objectives | SPEED, MINIMIZE_CASUALTIES, DESTROY_ALL |

**Special Mechanic:** Khroshi fortifications include structures providing armor and concealment bonuses. Must be suppressed or destroyed before engaging units inside.

### 3.10 LOGISTICS

| Property | Value |
|---|---|
| Influence band | Any (21–99%) |
| Faction restriction | None |
| Primary objective | ESCORT (convoy of 4–6 NPC trucks) OR HOLD_POSITION (supply depot, 20 min) |
| Victory condition | Convoy: 50%+ trucks reach exit. Depot: supply point held for duration. |
| Defeat condition | Convoy: 50%+ trucks destroyed. Depot: supply point captured. |
| Enemy disposition | Convoy: ambush forces at 1–2 chokepoints. Depot: assault from 1–2 directions (lower intensity than DEFEND). |
| Map characteristics | Convoy: road-centric with ambush terrain. Depot: small map centered on supply compound. |
| Secondary objectives | MINIMIZE_CASUALTIES, SPEED, PROTECT_STRUCTURE |

**Special Mechanic:** LOGISTICS missions appear with elevated weight when the requesting player's battalion is below 60% strength. Completing one grants a 25% bonus to SP earned.

---

## 4. Mission Type Selection Logic

### Step 1: Filter Available Types

A mission type is available if: planet enemy influence falls within its band, faction restriction matches (if any), and planet is contested (21–99%).

### Step 2: Assign Weights

| Mission Type | Base Weight | Modifier Conditions |
|---|---|---|
| DEFEND | 15 | +5 if influence > 70% |
| SEIZE | 15 | +5 if influence < 40% |
| RAID | 10 | +5 if strategic_value_tier >= 2 |
| PATROL | 10 | — |
| RESCUE | 8 | +5 if influence > 60% |
| BREAKTHROUGH | 8 | +3 if influence > 80% |
| EVACUATION | 8 | +5 if influence > 70% |
| HIVE_CLEAR | 10 | Ataxian only. +5 if Ataxian > 60% |
| FORTIFICATION_ASSAULT | 10 | Khroshi only. +5 if Khroshi > 60% |
| LOGISTICS | 5 | +15 if battalion strength < 60%. +5 if < 40%. |

### Step 3: Roll

Select one type from the weighted pool. Seeded by `hash(planetId + difficultyTier + timestamp_bucket)` where `timestamp_bucket` = current time floored to 5-minute intervals. This ensures two players selecting the same planet + difficulty within 5 minutes generate the same mission type and are matched into the same instance.

```typescript
interface MissionTypeWeight {
  type: MissionType;
  baseWeight: number;
  influenceBand: { min: number; max: number };
  factionRestriction: FactionId | null;
}

const MISSION_TYPE_WEIGHTS: MissionTypeWeight[] = [
  { type: 'defend',                baseWeight: 15, influenceBand: { min: 21, max: 99 }, factionRestriction: null },
  { type: 'seize',                 baseWeight: 15, influenceBand: { min: 21, max: 99 }, factionRestriction: null },
  { type: 'raid',                  baseWeight: 10, influenceBand: { min: 30, max: 99 }, factionRestriction: null },
  { type: 'patrol',               baseWeight: 10, influenceBand: { min: 21, max: 50 }, factionRestriction: null },
  { type: 'rescue',               baseWeight:  8, influenceBand: { min: 40, max: 99 }, factionRestriction: null },
  { type: 'breakthrough',         baseWeight:  8, influenceBand: { min: 60, max: 99 }, factionRestriction: null },
  { type: 'evacuation',           baseWeight:  8, influenceBand: { min: 50, max: 99 }, factionRestriction: null },
  { type: 'hive_clear',           baseWeight: 10, influenceBand: { min: 40, max: 99 }, factionRestriction: 'ataxian' },
  { type: 'fortification_assault', baseWeight: 10, influenceBand: { min: 40, max: 99 }, factionRestriction: 'khroshi' },
  { type: 'logistics',            baseWeight:  5, influenceBand: { min: 21, max: 99 }, factionRestriction: null },
];
```

---

## 5. Enemy Force Generation

Enemy forces are generated deterministically from the mission parameters. The same `missionId` always produces the same enemy composition.

### Generation Steps

**Step 1: Determine platoon count.** Roll within `difficulty.enemyPlatoonRange`. Garrison strength modifies: `garrisonStrength > 70` adds 1 platoon, `> 90` adds 2.

**Step 2: Determine platoon composition.** Each platoon generated from the faction's unit pool:

| Faction | Primary Infantry | Primary Vehicle | Heavy | Support | Command |
|---|---|---|---|---|---|
| Ataxian | Scurrier | Warrior | Siege Walker | Burrow Engine | Synaptic Brood |
| Khroshi | Syndicate Infantry, Conscript Mob | Syndicate IFV | Automaton Walker | Coordinated Battery | Broadcast Node |

**Step 3: Assign quality tier.** Each platoon rolls against `difficulty.enemyQualityWeights`:

| Quality | Stat Modifier | Behaviour |
|---|---|---|
| Baseline | No modifier | Standard AI: engages at medium range, retreats when suppressed |
| Veteran | +10% accuracy, +1 crew, +20 suppression threshold | Holds position longer, better target selection |
| Elite | +20% accuracy, +2 crew, +30 suppression threshold | Aggressive flanking, coordinated fire, will counterattack |

**Step 4: Add support assets.** Based on `difficulty.supportAssets`:

| Asset | Units Added |
|---|---|
| Mortars | 1–2 mortar units |
| Artillery | 2–4 artillery units, positioned deep behind lines |
| Air support | 1–2 air strikes available to the AI at scripted intervals |

**Step 5: Add command units.** One command unit per 3 platoons, minimum 1.

**Step 6: Assign disposition.** Mission type determines arrangement:

| Mission Type | Disposition |
|---|---|
| DEFEND | Waves from edges. Force divided into 2–4 waves at intervals. |
| SEIZE | Dug in at objectives. 60% static, 40% mobile reserve. |
| RAID | Light garrison (30%) at target, patrols (30%), reinforcements (40%) arriving later. |
| PATROL | Scattered in small groups near waypoints. |
| RESCUE | 40% surrounding NPCs, 30% between player and NPCs, 30% reserve. |
| BREAKTHROUGH | Layered lines. 3–4 defensive lines along advance axis. |
| EVACUATION | Multi-directional assault waves from 3+ vectors. |
| HIVE_CLEAR | Distributed around hive nodes. Each node has guard force. |
| FORTIFICATION_ASSAULT | 70% in prepared positions, 20% in depth, 10% flanking. |
| LOGISTICS | Ambush groups (convoy) or assault force (depot) at chokepoints. |

### Determinism

The entire pipeline uses a seeded PRNG initialized with `hash(missionId)`. Given the same `missionId`, the same force is generated every time.

---

## 6. Map Generation Constraints per Mission Type

```typescript
interface MapGenerationConstraints {
  missionType: MissionType;
  mapScaleMultiplier: number;        // 1.0 = ~3km x 3km. Range 0.6-1.5.
  deploymentZones: DeploymentZone[];
  objectivePlacement: ObjectivePlacement;
  terrainBias: {
    openFieldWeight: number;
    forestWeight: number;
    urbanWeight: number;
    elevationVariance: number;
  };
  roadNetworkRequired: boolean;
  roadConnectsDeploymentToObjective: boolean;
  fortificationStructures: boolean;
  hiveNodePlacements: number;
}
```

| Mission Type | Map Scale | Deployment Zone | Objective Placement | Special |
|---|---|---|---|---|
| DEFEND | 1.0 | Center/near objectives | Center, defensible | Defensive terrain at objectives |
| SEIZE | 1.0 | One edge, full width | Offset far side, defensible | Road to objective |
| RAID | 0.7 | One edge, narrow | Center | Extraction zone at deploy edge |
| PATROL | 1.3 | One edge, full width | Distributed (4–6 points) | Waypoints spaced across map |
| RESCUE | 1.0 | One edge, full width | Far side, 2 clusters | NPC positions marked |
| BREAKTHROUGH | 1.2 | One short edge | Far edge (exit zone) | Linear map, depth > width |
| EVACUATION | 0.9 | Around center compound | Center, urban | Perimeter defense layout |
| HIVE_CLEAR | 1.1 | One edge, full width | Distributed (2–5 nodes) | Hive nodes in low/forested areas |
| FORTIFICATION_ASSAULT | 1.0 | One edge, full width | Offset center, urban | Fortification structures |
| LOGISTICS (convoy) | 1.2 | One short edge | Along route to exit | Road is primary feature |
| LOGISTICS (depot) | 0.7 | One edge, half width | Center, urban | Supply compound at center |

---

## 7. Objective Definitions

### Primary Objective Types

```typescript
type PrimaryObjectiveType =
  | 'HOLD_POSITION'
  | 'CAPTURE_POSITION'
  | 'DESTROY_TARGETS'
  | 'EXTRACT_UNITS'
  | 'REACH_WAYPOINTS'
  | 'ESCORT'
  | 'SURVIVE';
```

| Type | Zone Radius | Hold Time | Notes |
|---|---|---|---|
| HOLD_POSITION | 80m | Full mission duration | Lost if no player units present for 30 consecutive seconds |
| CAPTURE_POSITION | 80m | 60–120s | Must contain player units and no enemy units |
| DESTROY_TARGETS | N/A | N/A | Targets must reach 0 HP |
| EXTRACT_UNITS | 100m | N/A | NPC units must enter extraction zone |
| REACH_WAYPOINTS | 50m | 5s (touch) | At least one player unit per waypoint |
| ESCORT | 30m proximity | N/A | Convoy halts if no escort within 200m |
| SURVIVE | N/A | Mission-defined | At least one held position must remain |

### Secondary Objective Types

```typescript
type SecondaryObjectiveType =
  | 'MINIMIZE_CASUALTIES'
  | 'SPEED'
  | 'DESTROY_ALL'
  | 'CAPTURE_SECONDARY'
  | 'PROTECT_STRUCTURE';
```

| Type | Threshold | SP Bonus | Condition |
|---|---|---|---|
| MINIMIZE_CASUALTIES | Max 10% KIA | 150 | Fewer than threshold% destroyed |
| SPEED | 60% of time limit | 100 | Primary met before threshold% elapsed |
| DESTROY_ALL | 100% | 200 | Every enemy unit destroyed |
| CAPTURE_SECONDARY | Hold 60s | 100 | Optional zone captured |
| PROTECT_STRUCTURE | 50%+ HP | 100 | Designated structure survives |

---

## 8. Replayability

### No Two Missions Alike

Same planet + same difficulty generates different missions each time (outside the 5-minute timestamp bucket). Variation: random mission type, random map seed (from UUID), random enemy composition within ranges.

### Diminishing Influence Returns

| Enemy Influence | Influence Reduction Modifier |
|---|---|
| 50–99% | x1.0 (full impact) |
| 30–49% | x0.75 |
| 21–29% | x0.5 |
| < 21% | Planet becomes Secure. No further missions. |

### SP Incentive Curve

| Scenario | Approximate SP per Mission |
|---|---|
| Easy solo, victory, no secondary | ~200 SP |
| Easy solo, victory, 1 secondary | ~350 SP |
| Medium duo, victory, 1 secondary | ~525 SP |
| Hard trio, victory, 2 secondary | ~900 SP |
| Hard quad, victory, 3 secondary | ~1100 SP |

---

## 9. Mission Template Interface

```typescript
type MissionType =
  | 'defend'
  | 'seize'
  | 'raid'
  | 'patrol'
  | 'rescue'
  | 'breakthrough'
  | 'evacuation'
  | 'hive_clear'
  | 'fortification_assault'
  | 'logistics';

interface MissionTemplate {
  missionId: string;
  planetId: string;
  enemyFaction: FactionId;
  difficulty: DifficultyTier;
  missionType: MissionType;
  timeLimitSeconds: number;
  deploymentDurationSeconds: number;
  extractionDurationSeconds: number;
  primaryObjective: PrimaryObjective;
  secondaryObjectives: SecondaryObjective[];
  enemyForce: GeneratedEnemyForce;
  mapSeed: number;
  mapConstraints: MapGenerationConstraints;
  spMultiplier: number;
  influenceImpactBase: number;
  influenceImpactModifier: number;
  maxParticipants: 4;
}

interface GeneratedEnemyForce {
  seed: number;
  totalPlatoons: number;
  platoons: EnemyPlatoon[];
  supportAssets: SupportAsset[];
  commandUnits: EnemyUnit[];
  disposition: EnemyDisposition;
}

interface EnemyPlatoon {
  platoonId: string;
  quality: 'baseline' | 'veteran' | 'elite';
  units: EnemyUnit[];
  assignedZone: string;
}

interface EnemyUnit {
  unitId: string;
  unitTypeId: string;
  quality: 'baseline' | 'veteran' | 'elite';
  statModifiers: {
    accuracyBonus: number;
    crewBonus: number;
    suppressionThresholdBonus: number;
  };
  initialPosition: Vec3;
  initialFacing: number;
}

interface EnemyDisposition {
  type: 'waves' | 'static_defense' | 'garrison_plus_reinforcement'
      | 'scattered' | 'surrounding' | 'layered_defense'
      | 'multi_directional_assault' | 'distributed_nodes'
      | 'concentrated_fortification' | 'ambush';
  zones: DispositionZone[];
}

interface DispositionZone {
  zoneId: string;
  position: Vec3;
  radius: number;
  role: 'defend' | 'patrol' | 'reserve' | 'ambush' | 'assault' | 'guard';
  activationTrigger: 'mission_start' | 'timed' | 'player_proximity' | 'objective_state';
  activationDelaySeconds: number;
}
```

---

## 10. Alignment with CAMPAIGN_PERSISTENCE.md

This document supersedes the `MissionType` enum in CAMPAIGN_PERSISTENCE.md. Updates needed:

| Old Type (CAMPAIGN_PERSISTENCE.md) | New Type (this document) |
|---|---|
| `assault` | `seize` |
| `defend` | `defend` |
| `patrol` | `patrol` |
| `ambush` | Removed (ambush is a disposition, not a mission type) |
| `extraction` | `rescue` |
| `raid` | `raid` |
| `breakthrough` | `breakthrough` |
| `hive_clear` | `hive_clear` |
| `supply_raid` | `logistics` |
| `emergency_defense` | `evacuation` |

New: `fortification_assault`.

The `MissionInstance` interface should replace `difficultyRating: number` with `difficulty: DifficultyTier` to align with the three-tier system.

---

*This document is the authoritative mission generation specification. Enemy faction rosters: FACTIONS.md. Persistence schemas: CAMPAIGN_PERSISTENCE.md. Tactical combat rules: Game Systems Overview.md. Force rosters: FORCE_ROSTERS.md.*
