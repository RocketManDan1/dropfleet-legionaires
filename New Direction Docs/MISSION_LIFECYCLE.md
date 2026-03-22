# Mission Lifecycle
*Federation Legionaires — authoritative spec*
*Last updated: 2026-03-21*

This document defines how missions are created, joined, played, and resolved. It covers the full state machine from creation through closure, join-in-progress rules, disconnect/reconnect behavior, victory conditions, AAR processing, and all timing contracts. Every other system doc that touches mission flow defers to the lifecycle semantics defined here.

**Companion documents:**
- *SERVER_GAME_LOOP.md* — tick loop, session states, crash recovery snapshots
- *NETWORK_PROTOCOL.md* — wire messages (JOIN_MISSION, MISSION_PHASE, MISSION_STATE_FULL, PLAYER_STATUS)
- *RUNTIME_UNIT_STATE.md* — MissionState container, PlayerMissionState, UnitInstance
- *CAMPAIGN_PERSISTENCE.md* — MissionInstanceRecord, MissionParticipant, PlanetState influence
- *CAMPAIGN_OVERVIEW.md* — sector map, planet influence 0-100%, 30min campaign ticks
- *REPLACEMENT_AND_REINFORCEMENT.md* — SP economy, post-mission replacement flow
- *AUTHORITATIVE_CONTRACTS.md* — canonical enums, timers, phase mappings, and joinability rules

**Alignment notice:** `NETWORK_PROTOCOL.md` and this document use the same disconnect contract from `AUTHORITATIVE_CONTRACTS.md`: a **5-minute** grace window (`DISCONNECT_GRACE_TICKS = 6000`) with frozen/invincible units, followed by removal without casualty attribution if no reconnect occurs.

---

## 1. Mission State Machine

### State Diagram

```
                         player selects difficulty
                         on contested planet
                                  │
                                  ▼
                            ┌──────────┐
                            │ CREATED  │  mission instance allocated server-side
                            └────┬─────┘
                                 │ first player finishes loading
                                 ▼
                            ┌──────────┐
           other players ──►│DEPLOYMENT│  placement phase, combat disabled
           can join here    └────┬─────┘
                                 │ timer expires OR all current players ready-up
                                 ▼
                            ┌──────────┐
           other players ──►│   LIVE   │  tick loop running, full simulation
           can STILL join   └────┬─────┘
                                 │
                    ┌────────────┼─────────────┐
                    │            │             │
               all players   victory/      time limit
               disconnect    defeat         expired
                    │         condition        │
                    │            │             │
                    │            ▼             │
                    │      ┌────────────┐      │
                    │      │ EXTRACTION │◄─────┘
                    │      └─────┬──────┘
                    │            │ 60-second window expires
                    │            ▼
                    │      ┌──────────┐
                    └─────►│   AAR    │  stats displayed, SP awarded
                           └────┬─────┘
                                │ all players continue or disconnect
                                ▼
                           ┌──────────┐
                           │  CLOSED  │  results committed, instance destroyed
                           └──────────┘
```

### Transition Table

| From | To | Trigger | Who | State Changes | Messages Sent |
|---|---|---|---|---|---|
| *(none)* | `CREATED` | Player selects difficulty on planet | Client (via server) | `MissionInstance` allocated, enemy force generated, map seed set | — |
| `CREATED` | `DEPLOYMENT` | First player finishes loading terrain + assets | Server | Deployment timer starts (180s), deployment zones calculated | `DEPLOYMENT_ZONE`, `MISSION_STATE_FULL`, `MISSION_PHASE(deployment)` |
| `DEPLOYMENT` | `LIVE` | Deployment timer expires OR all currently-connected players send `DEPLOY_READY` | Server | Tick loop starts, unplaced units auto-deployed (see section 8), mission clock begins | `MISSION_PHASE(live)` with timer |
| `LIVE` | `EXTRACTION` | Primary objective met, primary objective failed, or mission time limit reached | Server | Combat continues but extraction timer (60s) starts, extraction points marked | `MISSION_PHASE(extraction)` with 60s timer, `OBJECTIVE_UPDATE` |
| `LIVE` | `AAR` | All players disconnected and all 5-minute grace timers expired (see section 4) | Server | Tick loop stops, result = `DEFEAT`; pre-disconnect casualties are committed; units removed by grace expiry are not casualties | `AAR_DATA` (to any future reconnect) |
| `EXTRACTION` | `AAR` | 60-second extraction timer expires | Server | Tick loop stops, final result calculated, SP computed | `MISSION_PHASE(ended)`, `AAR_DATA` |
| `AAR` | `CLOSED` | All players click "Continue" or disconnect, or 10-minute AAR timeout | Server | `MissionInstanceRecord` finalized, influence deltas applied to `PlanetState`, `BattalionRecord` updated, SP credited | — (session destroyed) |

### TypeScript: Mission Phase Enum

```typescript
type MissionPhase =
  | 'created'
  | 'deployment'
  | 'live'
  | 'extraction'
  | 'aar'
  | 'closed';
```

### TypeScript: Mission Difficulty

```typescript
type MissionDifficulty = 'easy' | 'medium' | 'hard';

interface DifficultyProfile {
  difficulty:       MissionDifficulty;
  tunedForPlayers:  number;       // 1, 2, or 3
  maxPlayers:       number;       // always 4
  enemyCountRange:  [number, number]; // min-max enemy units (fixed at creation)
  timeLimitMin:     number;       // real-time minutes
  spRewardRange:    [number, number]; // victory SP range
}

const DIFFICULTY_PROFILES: Record<MissionDifficulty, DifficultyProfile> = {
  easy:   { difficulty: 'easy',   tunedForPlayers: 1, maxPlayers: 4, enemyCountRange: [15, 25],  timeLimitMin: 30, spRewardRange: [200, 300] },
  medium: { difficulty: 'medium', tunedForPlayers: 2, maxPlayers: 4, enemyCountRange: [30, 50],  timeLimitMin: 45, spRewardRange: [300, 400] },
  hard:   { difficulty: 'hard',   tunedForPlayers: 3, maxPlayers: 4, enemyCountRange: [50, 80],  timeLimitMin: 60, spRewardRange: [400, 500] },
};
```

**Enemy count does NOT scale with player count.** A hard mission spawns 50-80 enemies whether one player joins or four. Difficulty was locked at creation. More players means more firepower, not more enemies.

---

## 2. Mission Creation

Missions do not pre-exist on planets. A mission is created **on demand** when a player arrives at a contested planet and selects a difficulty.

### Creation Flow

```
Player arrives at planet (battalion status: 'available')
  │
  ├── Planet enemy influence < 1%  → no missions available (planet is secure)
  │
  └── Planet enemy influence >= 1% → difficulty selection screen shown
        │
        ├── Player selects Easy / Medium / Hard
        │     │
        │     ├── Active mission at same difficulty on this planet exists
        │     │   AND player count < 4?
        │     │     └── YES → join existing mission (section 3)
        │     │     └── NO  → create new MissionInstance
        │     │
        │     └── Server generates:
        │           - Mission type (from planet influence + faction pool)
        │           - Enemy force composition (from difficulty + faction)
        │           - Map seed (procedural terrain)
        │           - Objectives (primary + optional secondary)
        │           - Time limit (from difficulty profile)
        │
        └── Player enters CREATED mission as first participant
```

### Duplicate Prevention

If an active mission already exists on the same planet at the same difficulty and has fewer than 4 players, the server routes the player into that mission instead of creating a new one. "Joinable active" means phase `DEPLOYMENT` or `LIVE` only (not `CREATED`, `EXTRACTION`, `AAR`, or `CLOSED`).

If the existing mission is full (4 players), a new instance is created at the same difficulty. Multiple concurrent missions on the same planet are allowed.

### TypeScript: Creation Request

```typescript
interface CreateMissionRequest {
  playerId:     string;
  planetId:     string;
  difficulty:   MissionDifficulty;
}

interface CreateMissionResult {
  missionId:    string;
  isNewMission: boolean;    // false if player was routed to existing mission
  phase:        MissionPhase;
  playerCount:  number;     // how many players are now in this mission
}
```

---

## 3. Join-In-Progress Flow

Players can join a mission at any time during `DEPLOYMENT` or `LIVE` phases. Joins during `EXTRACTION` or `AAR` are **rejected** — the mission is wrapping up.

### Joining During DEPLOYMENT

Standard deployment experience:

1. Server sends `DEPLOYMENT_ZONE` with full deployment area.
2. Player places units normally within the zone.
3. Deployment timer **resets to 60 seconds** if a new player joins (minimum remaining — timer never increases above its current value if more than 60s remain). This gives the newcomer time to place units without rushing existing players.
4. Player sends `DEPLOY_READY` when finished, or timer expires and unplaced units are auto-deployed.

### Joining During LIVE

Reinforcement entry:

1. Server identifies **reinforcement entry points** at the map edge on the player's side. These are 2-3 predetermined positions on the friendly edge, clear of enemy units and terrain obstructions.
2. Player receives a `DEPLOYMENT_ZONE` message with these entry points (not the full original deployment area).
3. Player has a **30-second placement timer** to assign units to entry points. Units are grouped by platoon — the player picks which entry point each platoon enters from.
4. Timer expires → unplaced units auto-deploy at the nearest entry point with available space.
5. Units enter the map in march column from the entry point, under player control immediately.

### What the Late-Joiner Receives

| Data | Content |
|---|---|
| `MISSION_STATE_FULL` | Complete snapshot of current mission state (fog-filtered) |
| Contact list | **Empty** — the joining player has no intel until their own units spot enemies |
| Friendly unit positions | Full state for all friendly units (all co-op players) |
| Map effects | Current smoke, craters, fires |
| Objectives | Current objective state and progress |
| Mission clock | Time elapsed and time remaining |

The late-joiner starts blind. Their units must establish their own sensor picture. They benefit from the shared contact list only as their own units begin spotting — per the detection system rules in Spotting and Contact Model, contacts detected by other players' units are visible on the shared picture, but fire authorization still requires per-unit detection accumulator >= 25.

### Player Cap

**Maximum 4 players per mission instance.** A 5th player attempting to join the same difficulty on the same planet creates a new mission instance.

### TypeScript: Join Flow Messages

```typescript
// Client sends JOIN_MISSION (existing message from NETWORK_PROTOCOL.md)
// Server response depends on phase:

interface JoinMissionResult {
  missionId:        string;
  phase:            MissionPhase;
  playerSlot:       number;         // 0-3
  deploymentMode:   'full' | 'reinforcement' | null;
  // 'full' during DEPLOYMENT, 'reinforcement' during LIVE, null if rejected
}

// Rejection reasons (sent as ERROR message)
type JoinRejectReason =
  | 'ERR_MISSION_FULL'             // 4 players already
  | 'ERR_MISSION_ENDING'           // EXTRACTION or AAR phase
  | 'ERR_MISSION_CLOSED'           // CLOSED
  | 'ERR_BATTALION_IN_MISSION'     // player's battalion is already in another mission
  | 'ERR_PLANET_MISMATCH'         // battalion not at this planet
  | 'ERR_BATTALION_UNAVAILABLE';   // battalion in transit, destroyed, or retired
```

---

## 4. Disconnect and Reconnect

### Disconnect Detection

The server detects a disconnect when:
- The WebSocket connection closes (network failure, browser close, crash)
- The heartbeat timeout fires (no message received for 15 seconds — see NETWORK_PROTOCOL.md)
- The client sends `DISCONNECT_GRACEFUL` (intentional leave)

All three cases trigger the same server-side flow. There is no distinction between graceful and ungraceful disconnects for unit protection purposes — the player's units are always protected.

### 5-Minute Grace Timer

```
Player disconnects
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ GRACE PERIOD (300 seconds / 6000 ticks at 20 Hz)    │
│                                                     │
│  Units: FROZEN + INVINCIBLE                         │
│  - No movement, no orders executed                  │
│  - Cannot be damaged (all incoming damage = 0)      │
│  - Cannot be targeted (removed from valid target    │
│    pool for enemy fire resolution)                  │
│  - Still block terrain (pathfinding treats them     │
│    as obstacles)                                    │
│  - Do NOT spot (detection accumulators frozen)      │
│  - Do NOT fire (weapons disabled)                   │
│  - Visual: "COMMS LOST" overlay for other players   │
│                                                     │
│  Player reconnects?                                 │
│    YES → units unfreeze, full control restored      │
│    NO  → timer expires                              │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
          RECONNECT              TIMER EXPIRES
               │                      │
               ▼                      ▼
     Full state snapshot       Units DISAPPEAR
     sent to client            (removed from map,
     Units unfreeze            NOT counted as
     Resume play               casualties)
```

### Frozen Unit Rules (Detail)

| System | Frozen unit behavior |
|---|---|
| Movement Resolution (Phase 3) | Skipped — position locked |
| Spotting Updates (Phase 4) | Skipped — detection accumulators frozen at disconnect values |
| Fire Resolution (Phase 5) | Skipped — cannot fire, cannot be targeted |
| Damage Application (Phase 6) | Skipped — invincible, all damage suppressed |
| Suppression / Morale (Phase 7) | Skipped — suppression and morale frozen |
| Supply Tick (Phase 8) | Skipped — no resupply |
| Pathfinding | Unit occupies terrain — other units path around them |
| Contact system | Frozen units remain visible to enemies as contacts but cannot be engaged |

### Reconnection

On reconnect within the 5-minute window:

1. Client re-authenticates (`AUTH`) and re-joins (`JOIN_MISSION` with same missionId).
2. Server detects returning player by `playerId` match in `MissionState.players`.
3. Server sends `MISSION_STATE_FULL` snapshot — client rebuilds all state from scratch.
4. Grace timer cancelled. Units unfreeze. All systems resume processing them.
5. `PLAYER_STATUS(connected)` broadcast to other players. "COMMS LOST" overlay removed from their units.

### Grace Timer Expiry (No Reconnect)

When the 5-minute timer expires without reconnect:

1. All of the disconnected player's units are **removed from the battlefield**. They are not destroyed — they simply disappear.
2. These units are **not counted as casualties** for the `BattalionRecord`. The player's persistent roster is unaffected by the removal.
3. Any casualties the player sustained *before* disconnecting ARE committed. Units destroyed during play stay destroyed.
4. The player's `MissionParticipant` record remains — they still get a partial SP reward based on participation time (see section 7).
5. The player can join a new mission later and deploy fresh.

### TypeScript: Disconnect State

```typescript
interface DisconnectState {
  playerId:           string;
  disconnectedAtTick: number;
  graceExpiresAtTick: number;       // disconnectedAtTick + DISCONNECT_GRACE_TICKS
  frozenUnitIds:      string[];     // units currently frozen
}

/** 5 minutes at 20 Hz = 6000 ticks */
const DISCONNECT_GRACE_TICKS = 6000;
```

### PLAYER_STATUS Messages

| Event | Message sent to other players |
|---|---|
| Player disconnects | `PLAYER_STATUS { status: 'disconnected' }` |
| Player reconnects | `PLAYER_STATUS { status: 'connected' }` |
| Grace timer expires | `PLAYER_STATUS { status: 'disconnected' }` + unit removal deltas |

---

## 5. All-Disconnect Scenario

When **all** players in a mission are disconnected simultaneously:

### Flow

```
All players disconnected
  │
  ▼
Each player's 5-minute grace timer runs independently
(tick loop continues — enemies do NOT act against frozen/invincible units,
 but the mission clock still advances)
  │
  ├── Any player reconnects within their window?
  │     └── YES → that player resumes. Other timers continue independently.
  │               Mission continues normally.
  │
  └── ALL grace timers expire with no reconnect?
        │
        ▼
  Mission auto-ends as DEFEAT
    - Result: 'defeat'
    - Casualties committed: units destroyed BEFORE disconnect are permanent losses
    - Disappeared units (removed by timer expiry): NOT casualties
    - Influence impact: treated as a loss (enemy influence unchanged or increases)
    - SP reward: failure tier (50-100 SP per participant)
```

### Timing Detail

The grace timers are **per-player, not mission-wide**. If Player A disconnects at tick 1000 and Player B disconnects at tick 2000, Player A's timer expires at tick 7000 and Player B's at tick 8000. If Player A's timer expires first, their units disappear. Player B's units remain frozen until tick 8000.

The mission only auto-ends as DEFEAT when the **last** grace timer expires and there are zero players with units on the battlefield.

### Mission Clock Interaction

The mission clock continues advancing during the all-disconnect period. If the mission time limit expires while all players are disconnected, the mission ends as DEFEAT immediately (time expiry overrides grace timers).

---

## 6. Victory and Defeat Conditions

### Outcome Determination

| Condition | Result | Influence Effect |
|---|---|---|
| Primary objective completed | `VICTORY` | Enemy influence decreases (scales with difficulty) |
| Primary objective failed or mission time expired | `DEFEAT` | No change or slight enemy influence increase |
| Secondary objective completed but primary incomplete at time expiry | `DRAW` | Minor enemy influence decrease |
| All players disconnected, no reconnect | `DEFEAT` | Treated as loss |

### Extraction Phase

When victory or defeat conditions are met (or time expires), the mission enters `EXTRACTION` phase:

1. `MISSION_PHASE(extraction)` sent to all clients with 60-second timer.
2. Combat **continues** during extraction — units can still be destroyed.
3. Casualties during extraction count normally.
4. After 60 seconds, the mission transitions to `AAR` regardless of battlefield state.
5. Purpose: gives players a brief window to pull units back, assess the situation, and process the outcome before stats freeze.

---

## 7. AAR Phase

### What Happens

1. Tick loop **stops**. No further simulation.
2. All unit state is frozen at the moment the extraction timer expired.
3. Server calculates final results and sends `AAR_DATA` to all connected clients.

### AAR Data Breakdown

```typescript
interface AARData {
  missionId:        string;
  result:           'victory' | 'defeat' | 'draw';
  missionType:      MissionType;
  difficulty:       MissionDifficulty;
  durationSec:      number;           // total mission time (LIVE + EXTRACTION)

  // Per-player breakdown
  playerResults:    PlayerAARResult[];

  // Influence
  influenceBefore:  number;           // planet enemy influence before mission
  influenceAfter:   number;           // planet enemy influence after mission

  // Aggregate stats
  totalEnemiesDestroyed:  number;
  totalFriendlyCasualties: number;
}

interface PlayerAARResult {
  playerId:         string;
  playerName:       string;
  battalionName:    string;

  // Participation
  joinedAtSec:      number;           // seconds into mission when player joined
  participationPct: number;           // % of mission duration player was active

  // Combat stats
  unitsDeployed:    number;
  unitsDestroyed:   number;           // friendly casualties
  killsScored:      number;

  // SP breakdown
  spBase:           number;           // from mission result (victory/defeat/draw)
  spBonusZeroKIA:   number;           // +100 if zero friendly KIA
  spBonusSecondary: number;           // +150 per secondary objective completed
  spBonusSpeed:     number;           // +50 if completed under half time limit
  spParticipation:  number;           // scaled by participation %
  spTotal:          number;           // sum of all SP components
}
```

### SP Calculation

```
Base SP = difficulty reward range (see DIFFICULTY_PROFILES)
  - VICTORY: full range (200-500 depending on difficulty)
  - DEFEAT:  failure tier (50-100)
  - DRAW:    50% of victory range

Bonuses (applied only on VICTORY or DRAW):
  + 100 SP if zero friendly KIA (this player's units only)
  + 150 SP per secondary objective completed
  + 50 SP if completed under half the time limit

Participation scaling:
  Final SP = (Base + Bonuses) * participationPct

  participationPct = activeTicks / totalMissionTicks
    where activeTicks = ticks the player was connected and had units on field
```

A player who joins at the halfway mark of a victorious hard mission and takes no casualties earns roughly: `(450 + 100) * 0.50 = 275 SP`. Fair reward for showing up, but less than someone who fought the whole battle.

### Free Camera

During AAR, clients can freely move the camera across the battlefield. All fog of war is lifted — the full enemy disposition is revealed. This lets players see where enemies were hiding, review their approach, and learn from the engagement.

### Leaving AAR

- Player clicks "Continue" → routed to replacement screen (if casualties) or campaign map.
- Player disconnects during AAR → **rewards are still committed server-side**. The player receives their SP and the `MissionParticipant` record is finalized. They see the results when they next log in.

---

## 8. Mission Timing

### Timer Summary

| Phase | Duration | Reset Rule | On Expiry |
|---|---|---|---|
| `DEPLOYMENT` | 180 seconds (3 minutes) | Resets to 60s if new player joins (only if current timer < 60s) | Unplaced units auto-deployed; transition to `LIVE` |
| `LIVE` | 30-60 minutes (by mission type) | No resets | Transition to `EXTRACTION` (result based on objective state) |
| `EXTRACTION` | 60 seconds | No resets | Transition to `AAR` |
| `AAR` | No gameplay timer; 10-minute idle timeout | — | Auto-close if all players idle/disconnected |
| Disconnect grace | 300 seconds (5 minutes) per player | Resets on reconnect (timer cancelled) | Units disappear |
| Late-join deployment | 30 seconds | No resets | Unplaced units auto-deployed at nearest entry point |

### Auto-Deploy Logic

When the deployment timer expires, any units the player has not manually placed are deployed automatically:

1. Server identifies all unplaced units for the player.
2. Units are placed in their platoon groupings within the deployment zone (or at reinforcement entry points for late joiners).
3. Placement avoids stacking — minimum 20m spacing between auto-placed units.
4. Infantry is placed in cover terrain where available. Vehicles are placed on open/road terrain.
5. All auto-placed units face the enemy-side map edge.
6. `MISSION_STATE_FULL` update includes the auto-placed unit positions.

### Deployment Timer Reset on Join

When a new player joins during `DEPLOYMENT`:

```
if (currentTimerRemaining < 60) {
  currentTimerRemaining = 60;  // give newcomer at least 60 seconds
}
// If timer > 60s already, do not reset — plenty of time left
```

This prevents griefing by rapid join/leave cycling (timer can only go up to 60, never back to 180). It also avoids penalizing existing players who have already placed their units.

---

## 9. Edge Cases

### Join During EXTRACTION or AAR

**Rejected.** Server returns `ERR_MISSION_ENDING`. The player can create or join a different mission.

### Duplicate Mission at Same Difficulty

Player selects a difficulty that already has an active mission (phases `CREATED` through `LIVE`) with fewer than 4 players on the same planet. The server silently routes the player into the existing mission. The client receives the same `MISSION_STATE_FULL` as any other joiner.

If the existing mission is full (4 players), a new instance is created. The player never sees the routing logic — from their perspective they selected a difficulty and entered a mission.

### Zero Players for 5+ Minutes

If all players disconnect and all grace timers expire, the mission result is `DEFEAT` (see section 5). If the mission was in `CREATED` phase and the only player disconnects before even loading in, the mission is **silently destroyed** with no influence impact and no SP awarded. This prevents abandoned lobby missions from affecting the campaign.

```typescript
// Cleanup rule for CREATED-phase abandonment
if (mission.phase === 'created' && allGraceTimersExpired) {
  // No participants loaded in — no combat occurred
  mission.state = 'closed';
  mission.result = 'expired';
  // No influence change, no SP, no casualty records
  destroyMissionInstance(mission.missionId);
}
```

### Server Crash

Per SERVER_GAME_LOOP.md, the server writes full state snapshots every 60 seconds. On crash recovery:

1. If a snapshot exists and is less than 5 minutes old, the session is restored to `RECOVERY` state.
2. Players reconnect and receive the snapshot. Mission resumes from the saved tick.
3. Up to 60 seconds of game time may be lost.
4. If the snapshot is older than 5 minutes, the mission is treated as abandoned — result is `DEFEAT`, same as all-disconnect.
5. Disconnect grace timers are **not preserved** across crashes. On recovery, all disconnected players get a fresh 5-minute grace timer starting from the recovery tick.

### Player Rejoins After Grace Expiry

A player whose units disappeared (grace timer expired) can rejoin the **same mission** if it is still in `LIVE` phase and has fewer than 4 active players. They go through the late-join reinforcement flow (section 3) with a fresh deployment of their battalion's available units.

### Intentional Leave vs Disconnect

Both are treated identically for unit protection. A player who clicks "Leave Mission" gets the same 5-minute frozen/invincible window as one who loses connection. This prevents punishing players who need to leave briefly. The cost is participation-scaled SP — they earn less by being absent.

---

## 10. Integration Points

### Messages Used (from NETWORK_PROTOCOL.md)

| Message | Direction | Used In |
|---|---|---|
| `JOIN_MISSION` | C→S | Sections 2, 3 — joining or creating a mission |
| `DEPLOY_UNIT` | C→S | Sections 3, 8 — placing units during deployment |
| `DEPLOY_READY` | C→S | Section 1 — signaling deployment complete |
| `MISSION_STATE_FULL` | S→C | Sections 3, 4 — full snapshot on join/reconnect |
| `MISSION_PHASE` | S→C | Section 1 — phase transition notifications |
| `PLAYER_STATUS` | S→C | Section 4 — connect/disconnect broadcasts |
| `DEPLOYMENT_ZONE` | S→C | Section 3 — deployment areas for new/late joiners |
| `AAR_DATA` | S→C | Section 7 — after-action report payload |
| `ERROR` | S→C | Section 3 — join rejection reasons |

### Data Written (to CAMPAIGN_PERSISTENCE.md models)

| Record | When Written | Fields Affected |
|---|---|---|
| `MissionInstanceRecord` | `AAR` → `CLOSED` transition | `result`, `endedAt`, `influenceChange*` |
| `MissionParticipant` | `AAR` → `CLOSED` transition | `unitsDestroyed`, `killsScored`, `spEarned`, `influenceContribution` |
| `PlanetState` | `AAR` → `CLOSED` transition | `influenceFederation`, `influenceAtaxian` or `influenceKhroshi` |
| `BattalionRecord` | `AAR` → `CLOSED` transition | `supplyPoints`, `missionsPlayed`, `missionsWon/Lost/Drawn`, `totalKills`, `totalCasualties`, `zeroKiaStreak` |
| `PersistentUnitRecord` | `AAR` → `CLOSED` transition | `crewCurrent`, `status`, `killCount`, `missionsDeployed` |

### Tick Loop Integration (from SERVER_GAME_LOOP.md)

| Lifecycle event | Tick loop state |
|---|---|
| `CREATED` | `WAITING` — no ticks run |
| `DEPLOYMENT` | `WAITING` — no combat ticks, but server processes `DEPLOY_UNIT` messages |
| `LIVE` | `RUNNING` — full 20 Hz tick loop |
| `EXTRACTION` | `RUNNING` — full tick loop continues |
| `AAR` | `ENDED` — tick loop stopped |
| `CLOSED` | Session destroyed |
| Player disconnects (not all) | `RUNNING` — loop continues, disconnected player's units frozen |
| All players disconnect | `RUNNING` — loop continues (mission clock advances, enemy AI paused against invincible targets) |
| All grace timers expire | `ENDED` — tick loop stops, mission auto-closes as DEFEAT |

---

*This document is the authoritative reference for mission lifecycle. SERVER_GAME_LOOP.md governs the tick loop internals. NETWORK_PROTOCOL.md governs wire format. This document governs when missions exist, who can join them, and what happens when players come and go.*
