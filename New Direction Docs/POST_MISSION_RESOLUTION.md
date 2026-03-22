# Post-Mission Resolution Pipeline
*Federation Legionaires — mission outcome, casualty commitment, SP rewards, and return to campaign*
*Last updated: 2026-03-21*

---

## Purpose

This document specifies everything that happens between the moment a tactical mission ends (`missionPhase → 'ended'`) and the moment the player returns to the sector map. It is the bridge between the runtime combat layer (RUNTIME_UNIT_STATE.md) and the persistent campaign layer (CAMPAIGN_PERSISTENCE.md).

Every step described here is **server-authoritative**. The client displays the After Action Report and the Replacement Screen, but it does not compute outcomes, award SP, or modify persistent records. Those operations happen in a single atomic database transaction on the server.

**Canonical references:**
- Runtime extraction: RUNTIME_UNIT_STATE.md (`MissionResult`, `UnitMissionResult`, `PlayerMissionResult`)
- Persistent records: CAMPAIGN_PERSISTENCE.md (`BattalionRecord`, `PersistentUnitRecord`, `TransactionRecord`, `MissionInstance`, `PlanetState`)
- SP economy: REPLACEMENT_AND_REINFORCEMENT.md (costs, repair tiers, upgrade milestones)
- Campaign structure: CAMPAIGN_OVERVIEW.md (planet influence, faction behaviour)
- Factions: FACTIONS.md (Ataxian Hive, Khroshi Syndicalists)
- Shared contracts: AUTHORITATIVE_CONTRACTS.md (mission enum taxonomy, difficulty tiers, phase mapping)

---

## Pipeline Overview

```
Mission ends (missionPhase → 'ended')
  │
  ├─ 1. Mission Result Computation
  │     └── Evaluate objectives → VICTORY / DEFEAT / DRAW
  │
  ├─ 2. Influence Resolution
  │     └── Compute and apply planet influence deltas
  │
  ├─ 3. Casualty Commitment (ATOMIC)
  │     └── MissionResult → PersistentUnitRecord updates
  │
  ├─ 4. SP Reward Calculation
  │     └── Base + bonuses → TransactionLog entries
  │
  ├─ 5. Unlock and Progression Check
  │     └── Milestone evaluation → upgrade/reinforcement unlocks
  │
  ├─ 6. AAR Data Package
  │     └── Assemble and send to all participants
  │
  ├─ 7. Replacement Screen (client-driven, server-validated)
  │     └── Player purchases → TransactionLog + PersistentUnitRecord
  │
  └─ 8. Return to Campaign
        └── Battalion status → 'available', sector map
```

---

## 1. Mission Result Computation

The server evaluates the mission outcome from `MissionState.objectiveStates` at the moment `missionPhase` transitions to `'ended'`. The result is not voteable. Players cannot override it.

### Outcome Determination

| Outcome | Condition |
|---|---|
| **VICTORY** | All primary objectives completed (`isPrimary && isComplete`) |
| **DEFEAT** | Any primary objective incomplete AND (time expired OR all-disconnect) |
| **DRAW** | At least one primary objective incomplete, but at least one secondary objective completed |

### All-Disconnect Rule

If every connected player disconnects and no player reconnects within the disconnect timeout window (5 minutes), the mission is force-ended with result `DEFEAT`. This is logged with reason `'all_disconnect'` in the mission record.

- Units that disappeared due to disconnect timeout (see section 3) are **not** treated as casualties.
- The all-disconnect defeat still awards partial SP (see section 4, DEFEAT row).

### TypeScript Interface

```typescript
type MissionOutcome = 'victory' | 'defeat' | 'draw';

/**
 * Computed server-side when missionPhase transitions to 'ended'.
 * Extends the runtime MissionResult (RUNTIME_UNIT_STATE.md) with
 * campaign-layer resolution data.
 */
interface ResolvedMissionResult {
  missionId:            string;
  outcome:              MissionOutcome;

  /** Why DEFEAT, if applicable. Null for VICTORY and DRAW. */
  defeatReason:         'objectives_failed' | 'time_expired' | 'all_disconnect' | null;

  /** Primary objectives: how many existed, how many completed. */
  primaryObjectives:    { total: number; completed: number };
  /** Secondary objectives: how many existed, how many completed. */
  secondaryObjectives:  { total: number; completed: number };

  /** Mission wall-clock duration in seconds. */
  durationSec:          number;
  /** Mission time limit in seconds. Null if untimed. */
  timeLimitSec:         number | null;

  /** True if durationSec < (timeLimitSec / 2). Used for speed bonus. */
  underHalfTime:        boolean;

  /** Per-player resolved results. */
  playerResults:        ResolvedPlayerResult[];

  /** Planet influence delta (computed in section 2). */
  influenceDelta:       InfluenceDelta;

  /** Difficulty tier selected for this mission. */
  difficultyTier:       DifficultyTier;
}
```

---

## 2. Influence Resolution

Mission outcomes affect enemy influence on the planet where the mission was fought. The influence change is computed immediately on mission close and applied atomically with the casualty commitment transaction.

### Difficulty Tiers

Players select a difficulty tier when queueing into a mission. It affects both SP rewards and influence impact.

```typescript
type DifficultyTier = 'easy' | 'medium' | 'hard';

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

const DIFFICULTY_MULTIPLIERS: Record<DifficultyTier, number> = {
  easy:   1.0,
  medium: 1.5,
  hard:   2.0,
};
```

### Mission Type Influence Modifiers

Each mission type has a base influence reduction and a modifier that scales with difficulty.

```typescript
const MISSION_TYPE_INFLUENCE: Record<MissionType, { baseReduction: number; modifier: number }> = {
  defend:             { baseReduction: 4,  modifier: 1.0 },
  seize:              { baseReduction: 8,  modifier: 1.2 },
  raid:               { baseReduction: 6,  modifier: 1.1 },
  patrol:             { baseReduction: 3,  modifier: 0.8 },
  rescue:             { baseReduction: 3,  modifier: 0.9 },
  breakthrough:       { baseReduction: 10, modifier: 1.4 },
  evacuation:         { baseReduction: 6,  modifier: 1.5 },
  hive_clear:         { baseReduction: 10, modifier: 1.3 },
  fortification_assault: { baseReduction: 10, modifier: 1.4 },
  logistics:          { baseReduction: 2,  modifier: 0.5 },
};
```

### Influence Formula

```
influence_reduction = base_reduction * modifier * difficulty_mult * outcome_factor

Where:
  base_reduction    = MISSION_TYPE_INFLUENCE[missionType].baseReduction
  modifier          = MISSION_TYPE_INFLUENCE[missionType].modifier
  difficulty_mult   = DIFFICULTY_MULTIPLIERS[difficultyTier]
  outcome_factor    = 1.0 (VICTORY) | 0.0 (DEFEAT) | 0.5 (DRAW)
```

| Outcome | Effect |
|---|---|
| **VICTORY** | Enemy influence reduced by full computed amount |
| **DEFEAT** | No influence change from this mission. Enemy influence ticks up passively per campaign tick rules (CAMPAIGN_OVERVIEW.md) |
| **DRAW** | Enemy influence reduced by 50% of victory amount |

### Influence Redistribution Rule

The three factions always sum to 100 (`federation + ataxian + khroshi = 100`). When a mission reduces enemy influence, **all freed influence points go directly to the Federation**. There is no proportional split — a win expands Terran control directly.

Example: planet is 40% Federation / 35% Ataxian / 25% Khroshi. A VICTORY reduces Ataxian influence by 10 → result is 50% Federation / 25% Ataxian / 25% Khroshi. Khroshi is unaffected by this mission.

```typescript
function applyInfluenceReduction(planet: PlanetRecord, faction: FactionId, reduction: number): void {
  const clamped = Math.min(reduction, planet[`influence_${faction}`]);
  planet[`influence_${faction}`] -= clamped;
  planet.influence_federation    += clamped;   // freed points always go to Federation
  // Sum remains 100.
}
```

### Influence Delta Interface

```typescript
interface InfluenceDelta {
  planetId:             string;
  enemyFaction:         FactionId;
  previousInfluence:    number;     // Enemy influence before this mission
  influenceReduction:   number;     // Amount reduced (0 for DEFEAT)
  newInfluence:         number;     // previousInfluence - influenceReduction (clamped 0-100)
  planetLiberated:      boolean;    // True if newInfluence == 0 for this enemy faction
  controlFlipped:       boolean;    // True if controllingFaction changed as a result
}
```

### Application

Influence changes are applied immediately when the mission closes — not deferred to the next campaign tick. The `PlanetState.influenceFederation` and the relevant enemy faction influence field are updated in the same database transaction as casualty commitment.

If the planet is liberated (`newInfluence == 0` for the enemy faction), a `planet_liberated` campaign event is logged and the one-time +500 SP liberation bonus is awarded to all participants.

---

## 3. Casualty Commitment Pipeline

This is the critical path: runtime mission results become permanent campaign state. The entire operation is wrapped in a single database transaction. If any step fails, the entire transaction rolls back and the server retries.

### Pipeline Steps

```
For each player in ResolvedMissionResult.playerResults:
  │
  ├─ For each UnitMissionResult in player.unitResults:
  │     │
  │     ├─ Look up PersistentUnitRecord by matching unitRecordId
  │     │
  │     ├─ IF unit.wasDestroyed:
  │     │     ├── Set status = 'destroyed'
  │     │     ├── Set crewCurrent = 0
  │     │     ├── Increment BattalionRecord.totalCasualties
  │     │     ├── Reset zeroKiaStreak = 0
  │     │     └── Clear isReserve = false
  │     │
  │     ├─ IF unit.disappearedOnDisconnect:
  │     │     └── SKIP — return unit to roster at pre-mission state (no changes)
  │     │
  │     ├─ IF unit survived with crew loss:
  │     │     ├── Update crewCurrent = crewFinal
  │     │     ├── IF crewCurrent < ceil(crewMax * 0.5):
  │     │     │     └── Set status = 'combat_ineffective'
  │     │     └── ELSE IF crewCurrent < crewMax:
  │     │           └── Apply auto-repair rules (REPLACEMENT_AND_REINFORCEMENT.md)
  │     │
  │     ├─ IF unit survived undamaged:
  │     │     └── No crew changes
  │     │
  │     ├─ Update experienceFinal → PersistentUnitRecord (future use)
  │     ├─ Increment missionsDeployed += 1
  │     └─ Add kills to killCount
  │
  ├─ Update BattalionRecord:
  │     ├── missionsPlayed += 1
  │     ├── missionsWon / missionsLost / missionsDrawn += 1 (per outcome)
  │     ├── totalKills += sum of all unit kills
  │     ├── IF zero friendly KIA this mission: zeroKiaStreak += 1
  │     └── status = 'available' (no longer 'in_mission')
  │
  └─ Write MissionParticipant record (CAMPAIGN_PERSISTENCE.md)
```

### Disconnected Unit Handling

When a player disconnects and the 5-minute timeout expires, their units are removed from the battlefield (disappear). These units are flagged in the runtime state:

```typescript
/** Added to UnitMissionResult for disconnect-removed units. */
interface UnitMissionResult {
  // ... existing fields from RUNTIME_UNIT_STATE.md ...

  /** True if this unit was removed due to owner disconnect timeout. */
  disappearedOnDisconnect: boolean;
}
```

Units with `disappearedOnDisconnect = true` are **returned to the persistent roster at their pre-mission state**. They are not casualties. They did not "die" — they were simply pulled from the simulation. This prevents punishing players for connection issues.

### Ammo Persistence

Ammunition is **not tracked between missions**. All units start every mission with full ammo loads, initialized from `UnitType.weapons[slot].ammo*`. The `ammoRemaining` field in `UnitMissionResult` is logged for AAR statistics only — it does not carry forward.

### Transaction Atomicity

The entire casualty commitment — all unit record updates, battalion stat updates, influence changes, and SP awards — executes as a **single database transaction**. If the server crashes mid-resolution:

- The transaction has not been committed. No partial state exists.
- On restart, the server detects the mission in `state = 'aar'` with no committed results.
- The resolution pipeline re-executes from the frozen `MissionResult` snapshot (which was written to disk before the `'ended'` phase transition).

This is the all-or-nothing guarantee. There is no state where casualties are applied but SP is not, or vice versa.

---

## 4. SP Reward Calculation

Supply Points are the campaign's universal currency. Rewards are computed server-side and credited atomically with casualty commitment.

### Base SP by Outcome

| Outcome | Base SP Range | Notes |
|---|---|---|
| **VICTORY** | 200–500 | Varies by mission type (table below) |
| **DEFEAT** | 50–100 | Partial credit; enough to patch one infantry squad |
| **DRAW** | 100–250 | Midpoint between victory and defeat |

### Base SP by Mission Type

| Mission Type | VICTORY | DEFEAT | DRAW |
|---|---|---|---|
| `defend` | 300 | 70 | 150 |
| `seize` | 350 | 80 | 175 |
| `raid` | 400 | 90 | 200 |
| `patrol` | 200 | 50 | 100 |
| `rescue` | 300 | 75 | 150 |
| `breakthrough` | 500 | 100 | 250 |
| `evacuation` | 400 | 80 | 200 |
| `hive_clear` | 500 | 100 | 250 |
| `fortification_assault` | 500 | 100 | 250 |
| `logistics` | 350 | 60 | 175 |

### Difficulty Multiplier

The base SP is multiplied by the difficulty tier:

| Difficulty | Multiplier |
|---|---|
| Easy | x1.0 |
| Medium | x1.5 |
| Hard | x2.0 |

### Bonus SP

Bonuses are additive, applied **after** the difficulty multiplier on the base.

| Bonus | Amount | Condition |
|---|---|---|
| Zero KIA | +100 SP | No friendly units destroyed during the mission |
| Secondary objective | +150 SP each | Per secondary objective completed |
| Speed bonus | +50 SP | Mission completed in under half the time limit |

### SP Formula

```
base_sp          = MISSION_TYPE_SP[missionType][outcome]
scaled_sp        = floor(base_sp * DIFFICULTY_MULTIPLIERS[difficultyTier])
bonus_sp         = (zeroKIA ? 100 : 0)
                 + (secondaryObjectivesCompleted * 150)
                 + (underHalfTime ? 50 : 0)
total_sp         = scaled_sp + bonus_sp
```

### Co-Op SP Distribution

**All players receive the same SP reward.** This is a co-op game, not a competitive one. There is no SP splitting, no performance-based weighting between players.

### Late-Joiner Scaling

Players who joined the mission after it started receive SP scaled by their participation time:

```
participation_fraction = time_in_mission / total_mission_duration
late_joiner_sp         = floor(total_sp * participation_fraction)
```

### Disconnected Player SP

Players who disconnected and whose units were removed by the 5-minute timeout still receive SP, scaled by their time before disconnect:

```
disconnect_fraction    = time_before_disconnect / total_mission_duration
disconnected_sp        = floor(total_sp * disconnect_fraction)
```

This SP is committed server-side during the resolution transaction. The disconnected player does not need to be online to receive it — it is credited to their `BattalionRecord.supplyPoints` and logged in the `TransactionLog`.

### Minimum SP Floor

No participant receives less than **10 SP**, regardless of scaling. This prevents zero-reward edge cases (e.g., a player who joined 5 seconds before mission end on a defeat).

```
final_sp = max(computed_sp, 10)
```

### SP Sharing Between Players

**No.** Each player earns independently. SP cannot be transferred, donated, or pooled between players. This was an open question in REPLACEMENT_AND_REINFORCEMENT.md — it is now resolved. The co-op dependency comes from tactical cooperation, not economic sharing.

### SP Calculation Interface

```typescript
const MISSION_TYPE_SP: Record<MissionType, Record<MissionOutcome, number>> = {
  defend:             { victory: 300, defeat: 70,  draw: 150 },
  seize:              { victory: 350, defeat: 80,  draw: 175 },
  raid:               { victory: 400, defeat: 90,  draw: 200 },
  patrol:             { victory: 200, defeat: 50,  draw: 100 },
  rescue:             { victory: 300, defeat: 75,  draw: 150 },
  breakthrough:       { victory: 500, defeat: 100, draw: 250 },
  evacuation:         { victory: 400, defeat: 80,  draw: 200 },
  hive_clear:         { victory: 500, defeat: 100, draw: 250 },
  fortification_assault: { victory: 500, defeat: 100, draw: 250 },
  logistics:          { victory: 350, defeat: 60,  draw: 175 },
};

const SP_BONUS_ZERO_KIA           = 100;
const SP_BONUS_SECONDARY_OBJ      = 150;
const SP_BONUS_SPEED               = 50;
const SP_MINIMUM_FLOOR             = 10;

interface SPBreakdown {
  baseSP:               number;   // From MISSION_TYPE_SP lookup
  difficultyMultiplier: number;   // 1.0 / 1.5 / 2.0
  scaledSP:             number;   // floor(baseSP * difficultyMultiplier)
  bonusZeroKIA:         number;   // 0 or 100
  bonusSecondary:       number;   // 0, 150, 300, ...
  bonusSpeed:           number;   // 0 or 50
  totalBonusSP:         number;   // Sum of all bonuses
  rawTotal:             number;   // scaledSP + totalBonusSP
  participationFraction: number;  // 0.0–1.0 (1.0 for full-duration players)
  finalSP:              number;   // max(floor(rawTotal * participationFraction), SP_MINIMUM_FLOOR)
}
```

### TransactionLog Entries

SP rewards generate one or more `TransactionRecord` entries per player:

| Transaction Type | Amount | When |
|---|---|---|
| `mission_reward` | `scaledSP` (after difficulty mult, before bonuses) | Always |
| `bonus_zero_kia` | +100 | If no friendly units destroyed |
| `bonus_secondary_objective` | +150 | Per secondary objective completed |
| `bonus_speed` | +50 | If completed under half time limit |
| `bonus_planet_liberated` | +500 | If this mission reduced enemy influence to 0% |

Each entry records the `missionId`, `balanceAfter`, and a human-readable `note`. The `mission_reward` entry's `amount` reflects any participation scaling. Bonuses are only awarded to players present when the bonus condition was met.

---

## 5. Unlock and Progression

After SP is credited, the server checks whether any upgrade milestones have been newly met.

### Milestone Check

The server evaluates all milestone conditions against the updated `BattalionRecord`:

```typescript
interface UpgradeMilestone {
  milestoneId:    string;
  description:    string;
  condition:      MilestoneCondition;
  reward:         MilestoneReward;
}

type MilestoneCondition =
  | { type: 'missions_completed';  threshold: number }
  | { type: 'missions_won';       threshold: number }
  | { type: 'planets_liberated';  threshold: number }
  | { type: 'zero_kia_streak';    threshold: number }
  | { type: 'total_kills';        threshold: number };

type MilestoneReward =
  | { type: 'unit_upgrade';         unitTypeId: string; availableTo: BattalionType[] }
  | { type: 'reinforcement_slot';   count: number }
  | { type: 'sp_bonus';             amount: number };
```

### Evaluation Order

1. Update `BattalionRecord` stats (missions, wins, kills, etc.).
2. Credit SP to `BattalionRecord.supplyPoints`.
3. For each milestone NOT already in `BattalionRecord.unlockedUpgrades`:
   - Evaluate condition against updated stats.
   - If met: add `milestoneId` to `unlockedUpgrades`, apply reward.
4. If any new milestones were unlocked, include them in the AAR data package.

### Notification

New unlocks are surfaced in the AAR screen:

```
NEW UNLOCK: T1A1 Abrams now available as replacement option
  Milestone: "Liberate first planet"
  Available to: Armored, Mechanized battalions
```

---

## 6. AAR Data Package

The After Action Report is assembled server-side and sent to all participants (including disconnected players — it is stored for retrieval on their next login).

### Interface

```typescript
interface AARPackage {
  missionId:          string;
  missionType:        MissionType;
  enemyFaction:       FactionId;
  difficultyTier:     DifficultyTier;
  outcome:            MissionOutcome;
  defeatReason:       string | null;

  // Timing
  durationSec:        number;
  timeLimitSec:       number | null;

  // Per-player stats
  playerStats:        AARPlayerStats[];

  // SP breakdown (same for all full-duration players; scaled for late/disconnected)
  spBreakdown:        SPBreakdown;

  // Influence
  influenceDelta:     InfluenceDelta;

  // Highlights
  highlights:         AARHighlight[];

  // New unlocks (if any)
  newUnlocks:         UpgradeMilestone[];

  // Event log reference (for detailed replay — not sent inline, fetched on demand)
  eventLogAvailable:  boolean;
}

interface AARPlayerStats {
  playerId:           string;
  displayName:        string;
  battalionName:      string;

  // Combat stats
  killsScored:        number;
  unitsLost:          number;
  unitsDamaged:       number;
  shotsFired:         number;
  shotsHit:           number;
  accuracy:           number;        // shotsHit / shotsFired, 0.0–1.0

  // Objective contribution
  objectivesCompleted: number;

  // SP (may differ from global if late-joiner or disconnected)
  personalSPBreakdown: SPBreakdown;

  // Theater support usage
  strikePointsUsed:   number;
  fireMissionsUsed:   number;
}

interface AARHighlight {
  type:               AARHighlightType;
  playerId:           string;
  unitCallsign:       string;
  unitTypeId:         string;
  description:        string;
  tick:               number;
}

type AARHighlightType =
  | 'first_kill'
  | 'most_kills'
  | 'survived_most_damage'
  | 'longest_shot'
  | 'ace'
  | 'last_stand';
```

### Highlight Selection

Highlights are computed from the mission event log. The server selects up to 5 highlights, prioritizing:

1. **First kill** — always included if any kill occurred.
2. **Most kills** — unit with the highest kill count across all players.
3. **Survived most damage** — unit that lost the most crew and was not destroyed.
4. **Ace** — any unit with 5+ kills (may overlap with most kills).
5. **Last stand** — any unit that was the sole survivor of its platoon and scored at least one kill.

---

## 7. Replacement Screen Flow

After the AAR is dismissed, the player enters the Replacement Screen. This screen is **optional** — players can skip it and return to the campaign with empty slots.

### Screen Layout

```
REPLACEMENT & REPAIR — "Hellraisers" 1st Armored
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUPPLY BALANCE: 1,240 SP

DESTROYED (2 slots):
  ┌─────────────────────────────────────────────────────────┐
  │ T1 Abrams (Company A, 2nd Plt)                         │
  │   [1] T1 Abrams .............. 353 SP  (like-for-like)  │
  │   [2] T60A3 Patton ........... 209 SP  (downgrade)      │
  │   [3] Leave vacant ........... 0 SP                     │
  └─────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────┐
  │ Rifle Squad (Company C, 1st Plt)                        │
  │   [1] Rifle Squad ............ 21 SP   (like-for-like)  │
  │   [2] Leave vacant ........... 0 SP                     │
  └─────────────────────────────────────────────────────────┘

COMBAT INEFFECTIVE (1 unit):
  ┌─────────────────────────────────────────────────────────┐
  │ T2A1 Bradley (Company C, 2nd Plt) — Crew: 1/3          │
  │   [1] Full repair to 3/3 ..... 135 SP  (50% of 270 SP) │
  │   [2] Partial repair to 2/3 .. 68 SP   (25% of 270 SP) │
  │   [3] Leave as-is ............ 0 SP    (deploys at 1/3) │
  └─────────────────────────────────────────────────────────┘

REINFORCEMENT AVAILABLE (1 slot):
  ┌─────────────────────────────────────────────────────────┐
  │ Add to roster (150% cost):                              │
  │   [1] T1 Abrams .............. 530 SP                   │
  │   [2] HMMWV-HMG .............. 30 SP                    │
  │   [3] Stinger Team ........... 129 SP                   │
  │   [4] Skip for now ........... 0 SP                     │
  └─────────────────────────────────────────────────────────┘

RUNNING TOTAL: -374 SP     BALANCE AFTER: 866 SP

                    [CONFIRM]     [SKIP — RETURN TO CAMPAIGN]
```

### Replacement Rules

These are unchanged from REPLACEMENT_AND_REINFORCEMENT.md, consolidated here for completeness:

1. **Like-for-like** replacement: always available at full unit SP cost.
2. **Downgrade** replacement: next step down the upgrade ladder (FORCE_ROSTERS.md). Cheaper, weaker.
3. **Upgrade** replacement: available only if the player has unlocked the upgrade milestone. Costs more than like-for-like.
4. **Leave vacant**: slot stays empty. The platoon deploys short-handed.
5. **No cross-type**: a tank slot cannot be filled with infantry. Replacements must match the slot's role.
6. **Repair costs**: 50% of unit cost for full repair, 25% for partial repair (REPLACEMENT_AND_REINFORCEMENT.md).
7. **Reinforcement**: 150% of unit base cost. Only available if reinforcement slots are unlocked and unused.

### Deferral

Players **can skip the Replacement Screen entirely**. Pressing "Skip — Return to Campaign" returns them to the sector map with:

- All destroyed slots still empty (`status = 'destroyed'`).
- All combat-ineffective units still flagged.
- SP balance unchanged (no purchases made).

The player can access the same replacement options later from the **OOB (Order of Battle) screen** on the sector map. There is no time pressure or penalty for deferring.

### Server Validation

All replacement purchases are validated server-side:

1. Player has enough SP for the total cost.
2. Replacement unit is on the battalion's access list (REPLACEMENT_AND_REINFORCEMENT.md).
3. Upgrade variant is unlocked in `BattalionRecord.unlockedUpgrades`.
4. Reinforcement slot is available (`reinforcementSlotsUsed < reinforcementSlotsMax`).
5. Slot is in a valid state for the requested operation (destroyed for replacement, combat_ineffective for repair).

If validation fails, the server rejects the purchase and the client displays an error. Each purchase is independently validated.

### Transaction Recording

Each purchase generates a `TransactionRecord`:

| Action | Transaction Type | Amount | Note |
|---|---|---|---|
| Like-for-like replacement | `replacement_purchase` | -(unit cost) | "Replaced T1 Abrams (A Co, 2nd Plt)" |
| Downgrade replacement | `replacement_purchase` | -(downgrade cost) | "Replaced T1 Abrams with T60A3 Patton (A Co, 2nd Plt)" |
| Upgrade replacement | `upgrade_purchase` | -(upgrade cost) | "Replaced T1 Abrams with T1A1 Abrams (A Co, 2nd Plt)" |
| Full repair | `repair_full` | -(50% unit cost) | "Full repair T2A1 Bradley (C Co, 2nd Plt) 1/3 → 3/3" |
| Partial repair | `repair_partial` | -(25% unit cost) | "Partial repair T2A1 Bradley (C Co, 2nd Plt) 1/3 → 2/3" |
| Reinforcement | `reinforcement_purchase` | -(150% unit cost) | "Reinforcement: T1 Abrams added to roster" |

### PersistentUnitRecord Updates on Purchase

| Action | Fields Changed |
|---|---|
| Replacement (any) | `unitTypeId` → new type, `crewCurrent` → new `crewMax`, `crewMax` → from new UnitType, `status` → `'active'`, `killCount` → 0, `replacementCount` += 1, `lastReplacedAt` → now, `lastReplacedFrom` → old unitTypeId |
| Full repair | `crewCurrent` → `crewMax`, `status` → `'active'` |
| Partial repair | `crewCurrent` → `ceil(crewMax * 0.75)`, `status` → `'active'` (if now >= 50%) or `'combat_ineffective'` (if still below) |
| Reinforcement | New `PersistentUnitRecord` created with next available `slotIndex`, `status` = `'active'`, `reinforcementSlotsUsed` += 1 on `BattalionRecord` |

---

## 8. Return to Campaign

After the player confirms replacements (or skips), they return to the campaign layer.

### State Transitions

| Field | Value |
|---|---|
| `BattalionRecord.status` | `'available'` |
| `BattalionRecord.currentPlanetId` | Unchanged (same planet where the mission was fought) |
| `MissionInstance.state` | `'closed'` |

### Planet Control Notification

If the mission caused a planet control flip (enemy influence dropped below 50%, or Federation influence exceeded 50%), the player sees a notification on the sector map:

```
PLANET CONTROL CHANGE
Kepler-4 is now under Federation control.
Enemy influence: 18% Ataxian (was 55%)
```

### Battalion Availability

The battalion is immediately available for another mission on the same planet, or the player can issue a transit order to move to another system. There is no mandatory cooldown between missions.

---

## 9. Edge Cases

### Zero Participation

A player who joined a mission but contributed no combat actions (0 shots fired, 0 kills, 0 objectives) still receives SP. The minimum floor of 10 SP applies.

### Total Battalion Wipe

If every unit in a player's battalion is destroyed in a single mission:

- The battalion is **not deleted**. The `BattalionRecord` persists with `status = 'available'`.
- All unit slots have `status = 'destroyed'`.
- The player's roster is completely empty.
- The player receives their SP reward as normal.
- They must earn enough SP through future missions to purchase at least one replacement before they can deploy again.
- The battalion is not auto-retired. The player can choose to retire it voluntarily and create a new one, or grind back from nothing.

### Multiple Rapid Missions

Each mission resolves independently. A player who completes three missions in quick succession gets three separate resolution pipelines, three SP awards, and three sets of casualties applied sequentially. There is no batching or aggregation.

The server serializes resolution for the same battalion — if two missions involving the same battalion somehow end simultaneously, the second resolution waits for the first transaction to commit.

### Server Crash During Resolution

Covered by the atomic transaction guarantee (section 3). The database transaction either commits fully or not at all. On restart:

1. The server scans for missions in `state = 'aar'` that have no committed results.
2. It reloads the `MissionResult` snapshot from the recovery store.
3. It re-executes the resolution pipeline.
4. The pipeline is idempotent — running it twice on the same data produces the same result because it checks for existing `TransactionLog` entries before crediting SP.

### Disconnected Players During AAR

If a player disconnects during the AAR screen, their rewards are **already committed**. The resolution transaction runs before the AAR is displayed. The AAR is purely informational — dismissing it (or never seeing it) has no effect on rewards.

### SP Sharing

**No.** Confirmed as a design decision. Each player earns SP independently. Rationale: SP sharing would allow exploitation (alt accounts funneling SP) and undermine the attrition pressure that drives meaningful replacement decisions.

---

## Full Resolution Pipeline — TypeScript

```typescript
/**
 * Executes the full post-mission resolution pipeline.
 * Called once when missionPhase transitions to 'ended'.
 * All database mutations happen inside a single transaction.
 */
async function resolvePostMission(
  missionState: MissionState,
  missionResult: MissionResult,
  db: DatabaseConnection,
): Promise<Map<string, AARPackage>> {

  // 1. Compute outcome
  const outcome = computeOutcome(missionState.objectiveStates);

  // 2. Compute influence delta
  const mission = await db.getMissionInstance(missionState.missionId);
  const planet = await db.getPlanetState(mission.planetId);
  const influenceDelta = computeInfluenceDelta(
    outcome, mission.missionType, mission.difficultyTier,
    planet, mission.enemyFaction,
  );

  // 3–4–5. Atomic transaction: casualties + SP + unlocks
  const playerAARs = await db.transaction(async (tx) => {
    for (const playerResult of missionResult.playerResults) {
      await commitCasualties(tx, playerResult);
    }
    await applyInfluenceDelta(tx, influenceDelta);

    const spResults = new Map<string, SPBreakdown>();
    for (const playerResult of missionResult.playerResults) {
      const breakdown = calculateSP(
        outcome, mission.missionType, mission.difficultyTier,
        playerResult, missionResult, missionState,
      );
      await creditSP(tx, playerResult.battalionId, breakdown, missionState.missionId);
      spResults.set(playerResult.playerId, breakdown);
    }

    const newUnlocks = new Map<string, UpgradeMilestone[]>();
    for (const playerResult of missionResult.playerResults) {
      const battalion = await tx.getBattalionRecord(playerResult.battalionId);
      const unlocked = evaluateMilestones(battalion);
      if (unlocked.length > 0) {
        await applyMilestones(tx, battalion, unlocked);
        newUnlocks.set(playerResult.playerId, unlocked);
      }
    }

    await tx.updateMissionInstance(missionState.missionId, {
      state: 'closed', result: outcome, endedAt: Date.now(),
    });

    for (const playerResult of missionResult.playerResults) {
      await tx.updateBattalionRecord(playerResult.battalionId, { status: 'available' });
    }

    return { spResults, newUnlocks };
  });

  // 6. Assemble AAR packages (outside transaction — read-only)
  const aarPackages = new Map<string, AARPackage>();
  for (const playerResult of missionResult.playerResults) {
    const aar = assembleAAR(
      missionState, missionResult, outcome, influenceDelta,
      playerAARs.spResults.get(playerResult.playerId)!,
      playerAARs.newUnlocks.get(playerResult.playerId) ?? [],
      mission,
    );
    aarPackages.set(playerResult.playerId, aar);
  }

  return aarPackages;
}

function computeOutcome(objectives: ObjectiveState[]): MissionOutcome {
  const primaries = objectives.filter(o => o.isPrimary);
  const secondaries = objectives.filter(o => !o.isPrimary);
  const allPrimariesComplete = primaries.every(o => o.isComplete);
  const anySecondaryComplete = secondaries.some(o => o.isComplete);

  if (allPrimariesComplete) return 'victory';
  if (anySecondaryComplete) return 'draw';
  return 'defeat';
}
```

---

## Summary of Resolved Open Questions

| Question | Source | Resolution |
|---|---|---|
| SP sharing between players? | REPLACEMENT_AND_REINFORCEMENT.md | **No.** Each player earns independently. |
| What happens on total battalion wipe? | REPLACEMENT_AND_REINFORCEMENT.md | Battalion persists with empty roster. Must earn SP to rebuild. |
| How are disconnected players handled? | CAMPAIGN_OVERVIEW.md | Disconnected units returned at pre-mission state. SP scaled by time. |
| Is mission result voteable? | New question | **No.** Server-computed from objective states. |
| Can players defer replacement? | REPLACEMENT_AND_REINFORCEMENT.md | **Yes.** Skip replacement screen, access later from OOB. |

---

*Runtime data extraction: RUNTIME_UNIT_STATE.md*
*Persistent data model: CAMPAIGN_PERSISTENCE.md*
*SP economy and replacement rules: REPLACEMENT_AND_REINFORCEMENT.md*
*Campaign structure: CAMPAIGN_OVERVIEW.md*
*Force rosters and access lists: FORCE_ROSTERS.md*
