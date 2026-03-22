# Server Game Loop
*Federation Legionaires — authoritative spec*
*Last updated: 2026-03-21*

This document defines the server-side tick loop: what runs, in what order, what each phase reads and writes, and how clients stay synchronized. It is the central nervous system of the game — every other system doc describes a subsystem that plugs into this loop.

Cross-document enum/timer/phase contracts are centralized in AUTHORITATIVE_CONTRACTS.md.

---

## 1. Tick Loop Architecture

The server runs a fixed-rate loop at **20 Hz (50 ms per tick)**. Each tick executes 9 phases in strict order. No phase may run concurrently with another — the loop is single-threaded and deterministic within a tick.

```
TICK N (50ms budget)
  ┌─ Phase 1: Input Processing
  │   Read:  inbound order queue (WebSocket buffer)
  │   Write: per-unit order state, order ack/reject messages
  │
  ├─ Phase 2: Command Propagation
  │   Read:  accepted orders, unit C2 chain
  │   Write: unit intent fields (destination, engage target, posture)
  │
  ├─ Phase 3: Movement Resolution
  │   Read:  unit intent, terrain mesh, navmesh, pathfinding cache
  │   Write: unit position, heading, velocity, movement state flags
  │
  ├─ Phase 4: Spotting Updates
  │   Read:  unit positions, sensor stats, LOS raycasts, heightmap
  │   Write: per-observer detection accumulators, contact list, contact tiers
  │
  ├─ Phase 5: Fire Resolution
  │   Read:  fire orders, contact tiers (DETECTED gate), weapon cooldowns, ammo counts
  │   Write: shot records, cooldown timers, ammo decrements, projectile-in-flight list
  │
  ├─ Phase 6: Damage Application
  │   Read:  shot records, armour values, penetration tables, ERA state
  │   Write: unit HP, crew count, system damage flags, ERA charges, destroyed flag
  │
  ├─ Phase 7: Suppression / Morale
  │   Read:  shot impacts (near-miss + hit), suppression values, morale thresholds
  │   Write: suppression values, morale state (OK / pinned / routing / surrendered)
  │
  ├─ Phase 8: Supply Tick
  │   Read:  unit positions, supply truck capacity, ammo slot states
  │   Write: ammo slot values, supply truck remaining capacity
  │
  └─ Phase 9: State Broadcast
      Read:  all changed state since last broadcast
      Write: outbound WebSocket messages (delta or snapshot), tick counter
```

### Phase Ordering Rationale

| Ordering decision | Reason |
|---|---|
| Input before Movement | Orders must be applied before units act on them. A MOVE order received this tick takes effect this tick. |
| Movement before Spotting | Units must be in their new positions before LOS is evaluated. Otherwise spotting would lag one tick behind movement. |
| Spotting before Fire | The DETECTED gate (Spotting and Contact Model §Combat Gate) must be evaluated with current-tick positions. A unit that just gained LOS on a target can fire in the same tick. |
| Fire before Damage | Shots are resolved first, producing shot records. Damage is then applied from those records. This separation allows multiple shots to resolve independently before any state changes from damage. |
| Damage before Suppression | A unit destroyed by damage in Phase 6 is flagged dead before Phase 7. Dead units do not accumulate suppression or trigger morale checks on themselves. They do trigger morale checks on nearby friendlies. |
| Suppression before Supply | A unit suppressed ≥ 40 cannot receive resupply (see Game Systems Overview §7). Suppression must be current before supply eligibility is checked. |
| Supply before Broadcast | Ammo state must be final before the client receives the delta. |

### Tick-Frequency vs Second-Frequency

Not all phases do full work every tick. Per the Simulation Time Model:

| Phase | Every tick (50ms) | Every second (tick % 20 === 0) |
|---|---|---|
| Input Processing | Yes | — |
| Command Propagation | Yes | — |
| Movement Resolution | Yes — position integration | — |
| Spotting Updates | — | Yes — full pairwise LOS + accumulator update |
| Fire Resolution | Yes — cooldown countdown, shot dispatch | — |
| Damage Application | Yes — projectile impact checks | — |
| Suppression / Morale | — (accumulation is event-driven) | Yes — decay + morale state transitions |
| Supply Tick | — | Yes — trickle resupply |
| State Broadcast | — | Yes — delta broadcast (events sent immediately) |

On non-second ticks, second-frequency phases are skipped entirely (zero cost).

### Idle and Paused States

```typescript
enum LoopState {
  WAITING,    // mission not yet live — no ticks run
  RUNNING,    // normal operation
  PAUSED,     // operator/admin pause; not used by disconnect handling
  ENDED,      // mission complete — loop stopped, AAR phase active
}
```

| Condition | Behaviour |
|---|---|
| Zero players connected, mission live | Loop remains `RUNNING` while per-player disconnect grace timers are active (5 minutes each). |
| Player reconnects during grace period | Loop continues without interruption; player units are unfrozen. |
| All grace timers expire, no reconnect | Session transitions to `ENDED` with mission result = DEFEAT (all-disconnect). |
| Mission not yet started (`WAITING`) | Tick loop does not run. Server accepts connections and sends lobby state only. |

---

## 2. State Authority Model

### Server Owns Everything

The server is the sole authority for:
- **Unit state**: position, heading, HP, suppression, ammo, morale, orders, cooldowns
- **Map state**: smoke clouds, terrain damage, bridge status, minefields
- **Mission state**: objectives, score, time elapsed, victory conditions
- **Contact state**: every detection accumulator, every contact tier

The client owns nothing. It renders what the server tells it to render.

### Client as Dumb Terminal

```
┌──────────┐         ┌──────────┐
│  CLIENT  │         │  SERVER  │
│          │─orders─→│          │
│          │         │ validate │
│          │         │ simulate │
│          │←─state──│          │
│  render  │         │          │
└──────────┘         └──────────┘
```

- Client sends orders (OrderMessage — see Orders and C2 Interaction)
- Client receives state deltas and events
- Client interpolates unit positions between broadcasts for smooth rendering
- **No client-side prediction.** This is a tactical wargame with ~1 second broadcast intervals. Latency tolerance is high — a 200ms round-trip is imperceptible when orders take seconds to execute. Prediction would add complexity for no player-facing benefit.

### Order Validation

The server rejects invalid orders immediately and returns an error code. The client never assumes an order will succeed.

```typescript
interface OrderResponse {
  orderId:    string;
  status:     'ACCEPTED' | 'REJECTED';
  reason?:    OrderRejectReason;
  tick:       number;        // server tick when decision was made
}

type OrderRejectReason =
  | 'ERR_NOT_YOUR_UNIT'          // unit belongs to another player
  | 'ERR_UNIT_DEAD'              // unit is destroyed or surrendered
  | 'ERR_UNIT_SUPPRESSED'        // suppression too high for this action
  | 'ERR_TARGET_NOT_ACQUIRED'    // contact below DETECTED tier in firer's sensor
  | 'ERR_TARGET_OUT_OF_RANGE'    // target beyond weapon max range
  | 'ERR_NO_AMMO'               // weapon slot empty
  | 'ERR_NO_ARTY_AVAILABLE'     // no artillery battery has ammo/range
  | 'ERR_NO_AIR_STRIKES'        // strike points exhausted
  | 'ERR_INVALID_LANDING_ZONE'  // helicopter land order on invalid terrain
  | 'ERR_TRANSPORT_MOVING'      // dismount while transport is fast
  | 'ERR_ORDER_ILLEGAL'         // catch-all: order type not valid for this unit class
  | 'ERR_QUEUE_FULL'            // waypoint queue at max depth (4)
  | 'ERR_C2_OUT_OF_RANGE';      // rally target beyond radio/voice range after roll
```

### Anti-Cheat: Fog of War Enforcement

The server never sends enemy unit state that the player's forces have not detected. Every outbound message is filtered per-player through the contact system.

**What the client receives:**
- Friendly units: full state (position, HP, ammo, suppression, orders)
- Enemy contacts at SUSPECTED: approximate position (±50m jitter), no type info
- Enemy contacts at DETECTED: precise position, category only
- Enemy contacts at CONFIRMED: precise position, full type info
- Enemy contacts at LOST: last-known position, frozen
- Undetected enemies: **nothing**. The client has zero knowledge they exist.

There is no "spectator mode" data path to exploit. Even the rendering client binary contains no enemy state that hasn't passed through the fog-of-war filter.

---

## 3. State Sync Protocol

### Connection / Reconnection: Full Snapshot

When a client connects or reconnects, the server sends a complete state snapshot:

```typescript
interface FullSnapshot {
  tick:             number;
  missionTime:      number;           // seconds elapsed since mission start
  scenario:         ScenarioSettings; // visibility, objectives, map ref
  friendlyUnits:    UnitState[];      // full state for all player's units
  contacts:         Contact[];        // fog-filtered enemy contacts
  mapEffects:       MapEffect[];      // smoke clouds, fires, craters
  orders:           ActiveOrder[];    // currently executing orders for player's units
  score:            ScoreState;
}
```

After the snapshot, the client transitions to delta mode.

### Per-Tick vs Per-Second Updates

| Data | Frequency | Condition |
|---|---|---|
| Unit positions (friendly) | Every second | Always (client interpolates between) |
| Contact positions | Every second | Only contacts with changed tier or position |
| Game events (shots, hits, explosions) | Immediate | Event-driven — sent within the tick they occur |
| Suppression / morale changes | Every second | Only changed units |
| Ammo changes | On change | Only when a shot is fired or resupply ticks |
| Score updates | On change | Objective captured, unit destroyed |
| Map effects (smoke, craters) | On change | Created or expired |
| Order acknowledgments | Immediate | Response to client order |

### Delta Message Format

```typescript
interface StateDelta {
  tick:       number;          // monotonic tick counter — client uses for ordering
  timestamp:  number;          // server epoch ms
  units:      UnitDelta[];     // only units with changed fields since last delta
  contacts:   ContactDelta[];  // added, updated, or removed contacts
  mapEffects: MapEffectDelta[];
  score?:     ScoreState;      // only if changed
}

interface UnitDelta {
  unitId:     string;
  // Only changed fields are present — undefined means "no change"
  posX?:      number;
  posZ?:      number;
  heading?:   number;
  velocityX?: number;
  velocityZ?: number;
  hp?:        number;
  suppression?: number;
  moraleState?: 'ok' | 'pinned' | 'routing' | 'surrendered';
  firerState?:  'full_halt' | 'short_halt' | 'slow' | 'fast';
  ammo?:      AmmoState[];     // per-slot current counts
  orderState?: 'idle' | 'executing' | 'queued';
  destroyed?:  boolean;
}
```

### Immediate Events

Events that affect the C2 display (shots, explosions, kills) are sent as they occur, not batched with the second-interval delta. They use the same WebSocket connection but are flagged for priority rendering.

```typescript
interface GameEvent {
  tick:      number;
  type:      'shot_fired' | 'shot_impact' | 'unit_destroyed' | 'unit_routing'
           | 'arty_impact' | 'air_strike' | 'smoke_deployed' | 'rally_attempt'
           | 'objective_captured';
  data:      Record<string, unknown>;  // event-specific payload
  priority:  true;
}
```

### Tick Numbering

Every message from the server carries a `tick` field — a monotonic counter starting at 0 when the mission goes live. The client uses this to:
- Discard out-of-order messages (stale deltas after a reconnect snapshot)
- Synchronize event playback with state deltas
- Display elapsed mission time: `missionTimeSeconds = tick / TICKS_PER_SEC`

### Bandwidth Budget

Target: **< 5 KB/s per player** during steady-state (units moving, occasional fire).

| Component | Estimated size per second |
|---|---|
| Unit deltas (50 friendly units, positions only) | ~1.2 KB |
| Contact deltas (20 active contacts) | ~0.8 KB |
| Game events (5 shots/sec peak) | ~0.5 KB |
| Map effects | ~0.1 KB |
| Overhead (framing, headers) | ~0.2 KB |
| **Total** | **~2.8 KB typical, ~5 KB peak** |

Peaks occur during heavy combat. The one-second broadcast interval is the primary bandwidth lever — it can be raised to 2 seconds if needed, at the cost of slightly jerkier interpolation.

---

## 4. Order Processing Pipeline

### Flow

```
Client                         Server
  │                              │
  ├── OrderMessage ──────────────▶ WebSocket receive
  │                              │ Enqueue in per-player order buffer
  │                              │
  │                              ├── Next tick, Phase 1: Input Processing
  │                              │   Dequeue all buffered orders
  │                              │   Validate each order (see checks below)
  │                              │   Accept → write to unit intent
  │                              │   Reject → enqueue OrderResponse
  │                              │
  │◀── OrderResponse ───────────┤   Send ack/reject immediately
  │                              │
  │                              ├── Phase 2: Command Propagation
  │                              │   Accepted orders propagate to unit state
  │                              │
```

### Validation Checks (Phase 1)

Orders are validated in this sequence. First failing check produces the rejection.

| # | Check | Reject reason |
|---|---|---|
| 1 | Unit exists and belongs to this player | `ERR_NOT_YOUR_UNIT` |
| 2 | Unit is alive (not destroyed, not surrendered) | `ERR_UNIT_DEAD` |
| 3 | Order type is legal for unit class (e.g., REVERSE not valid for infantry) | `ERR_ORDER_ILLEGAL` |
| 4 | Target contact exists and meets tier gate (DETECTED+ for ENGAGE) | `ERR_TARGET_NOT_ACQUIRED` |
| 5 | Target is within weapon range (for fire orders) | `ERR_TARGET_OUT_OF_RANGE` |
| 6 | Unit has ammo for the requested action | `ERR_NO_AMMO` |
| 7 | Unit suppression is below threshold for the action (< 40 for EMBARK) | `ERR_UNIT_SUPPRESSED` |
| 8 | Waypoint queue has room (max 4) | `ERR_QUEUE_FULL` |
| 9 | C2 range check for RALLY (radio roll, then voice fallback) | `ERR_C2_OUT_OF_RANGE` |
| 10 | Landing zone validity for helicopter LAND/INSERT | `ERR_INVALID_LANDING_ZONE` |

### Order Queue Semantics

- **New movement order without Shift**: replaces the entire waypoint queue. Unit begins executing immediately.
- **New movement order with Shift**: appends to the queue (up to 4 waypoints). Each waypoint can independently be ADVANCE or MARCH.
- **ENGAGE, RALLY, SET_POSTURE**: execute immediately. Do not enter the waypoint queue.
- **CANCEL**: clears the waypoint queue. Unit halts.

### Multiple Orders Per Tick

If a player sends multiple orders in the same tick (possible at high input rate), they are processed in receive order. A later order to the same unit within the same tick overwrites the earlier one (last-writer-wins for the same unit).

---

## 5. Performance Budget

### Target

**50 ms per tick** for a mission with **200 units** across **4 players** on a 5 km × 5 km map.

### Per-Phase Cost Estimates

| Phase | Complexity | Estimated cost (200 units) | Notes |
|---|---|---|---|
| Input Processing | O(orders) | < 0.5 ms | Bounded by player input rate |
| Command Propagation | O(units with new orders) | < 0.5 ms | Subset of units |
| Movement Resolution | O(n) | ~2 ms | Position integration + pathfinding cache lookup |
| Spotting Updates | O(n²) worst case | ~8 ms (with spatial hash) | Most expensive phase — see optimizations below |
| Fire Resolution | O(active firers) | ~3 ms | Typically 10–30 units actively firing |
| Damage Application | O(shots this tick) | ~1 ms | Per-shot arithmetic |
| Suppression / Morale | O(n) | ~1 ms | Per-unit threshold checks |
| Supply Tick | O(supply pairs) | < 0.5 ms | Spatial query for nearby supply |
| State Broadcast | O(n × players) | ~3 ms | Serialization + fog filter + WebSocket send |
| **Total** | | **~20 ms typical** | **30 ms headroom** |

### Spatial Indexing

A **grid-based spatial hash** partitions the map into cells. Cell size = 500 m (covers max ground sensor range with one-ring neighbour lookup for most queries).

```typescript
interface SpatialHash {
  cellSize:  number;                        // 500m
  cells:     Map<string, Set<string>>;      // "cellX,cellZ" → set of unitIds
}

function unitsInRange(pos: Vec2, rangeM: number, hash: SpatialHash): string[] {
  // Return unitIds from cells overlapping the query circle
  // Actual range check is a second pass on the candidate set
}
```

All range queries (spotting, fire range, supply range, rally voice range) use the spatial hash instead of iterating all units.

### Early-Out Optimizations

| Optimization | Phase | Effect |
|---|---|---|
| Skip pairs beyond max sensor range | Spotting | Reduces O(n²) to O(n × k) where k = nearby units |
| Skip dead/surrendered units | All phases | Removes ~10–20% of units from processing |
| Skip units with no fire order and `hold_fire` posture | Fire Resolution | Most units are not firing at any given moment |
| Skip ammo-full units | Supply Tick | Only process units with depleted ammo near supply |
| Delta-only broadcast | State Broadcast | Only serialize changed fields |
| Spotting runs every second, not every tick | Spotting | 20× reduction in spotting cost |

### Worst Case

200 units all within mutual sensor range (unlikely — requires a 200-unit brawl in a 2 km radius). Spotting phase would hit ~20 ms. Total tick could approach 40 ms. Still within budget.

If profiling shows the budget is tight, the first lever is to stagger spotting across two ticks (even units on tick N, odd units on tick N+1).

---

## 6. Session Lifecycle

```
                    ┌─────────┐
         create ──→ │ LOADING │ ← mission selected, players joining
                    └────┬────┘
                         │ all players report "ready"
                         ▼
                    ┌─────────┐
                    │  LIVE   │ ← tick loop running
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         all players   victory   server
         disconnect   condition   crash
              │          │          │
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌──────────┐
         │ PAUSED │ │  AAR   │ │ RECOVERY │
         └───┬────┘ └───┬────┘ └────┬─────┘
             │          │           │
        grace period    │     restore from
        expires or      │     snapshot
        player returns  │           │
             │          │           │
             ▼          ▼           ▼
         ┌────────┐  destroy    resume as
         │  LIVE  │  session    LIVE or AAR
         │ or AAR │
         └────────┘
```

### GameSession Object

```typescript
interface GameSession {
  sessionId:      string;
  state:          'loading' | 'live' | 'paused' | 'aar' | 'recovery';

  // Core references
  tickLoop:       TickLoop;
  unitRegistry:   Map<string, UnitInstance>;
  terrain:        TerrainMesh;
  spatialHash:    SpatialHash;
  scenario:       ScenarioSettings;

  // Player connections
  players:        Map<string, PlayerConnection>;
  disconnectTime: Map<string, number>;    // epoch ms when player disconnected

  // Lifecycle
  createdAt:      number;
  missionStartTick: number;               // tick when state transitioned to LIVE
  lastSnapshotTick: number;               // tick of most recent crash-recovery snapshot
}
```

### Crash Recovery

The server writes a **full state snapshot** to persistent storage every **60 seconds** (1200 ticks). The snapshot includes:
- All unit state
- All contact accumulators
- All active orders
- Map effects
- Score state
- Current tick number

On server restart, if a session snapshot exists and is less than 5 minutes old, the session is restored to `recovery` state. When players reconnect, they receive the snapshot and play resumes from the saved tick. Up to 60 seconds of game time may be lost — acceptable for a tactical wargame.

```typescript
interface SessionSnapshot {
  sessionId:    string;
  tick:         number;
  timestamp:    number;
  units:        UnitState[];
  contacts:     Map<string, Contact[]>;   // per-player contact lists
  mapEffects:   MapEffect[];
  score:        ScoreState;
  orders:       ActiveOrder[];
  scenario:     ScenarioSettings;
}
```

Snapshots are written asynchronously between ticks (serialized during Phase 9, flushed to disk outside the tick budget).

---

## 7. Integration Points

### Subsystem Modules

The tick loop does not contain game logic directly. Each phase calls into a subsystem module that encapsulates the relevant rules.

```typescript
// Each subsystem is a pure function:
//   (currentState, deltaTime, context) → stateChanges
//
// This makes subsystems independently testable.

interface SubsystemResult {
  unitChanges:   Map<string, Partial<UnitState>>;
  events:        GameEvent[];
}

// Phase 3
function resolveMovement(units: UnitState[], dt: number, terrain: TerrainMesh): SubsystemResult;

// Phase 4
function updateSpotting(units: UnitState[], contacts: ContactMap, scenario: ScenarioSettings): SubsystemResult;

// Phase 5
function resolveFire(units: UnitState[], contacts: ContactMap, dt: number): SubsystemResult;

// Phase 6
function applyDamage(shotRecords: ShotRecord[], units: UnitState[]): SubsystemResult;

// Phase 7
function updateSuppression(units: UnitState[], recentImpacts: Impact[], dt: number): SubsystemResult;

// Phase 8
function tickSupply(units: UnitState[], spatialHash: SpatialHash, dt: number): SubsystemResult;
```

### Event Bus

Cross-system communication uses a typed event bus within the tick. Events emitted by one phase are consumed by later phases in the same tick.

```typescript
type TickEvent =
  | { type: 'UNIT_DESTROYED';     unitId: string; killerUnitId: string }
  | { type: 'UNIT_ROUTING';       unitId: string }
  | { type: 'UNIT_SURRENDERED';   unitId: string }
  | { type: 'SHOT_FIRED';        firerId: string; targetId: string; weaponSlot: number }
  | { type: 'SHOT_IMPACT';       targetId: string; damage: number; penetrated: boolean }
  | { type: 'ARTY_IMPACT';       posX: number; posZ: number; blastRadius: number }
  | { type: 'SMOKE_CREATED';     posX: number; posZ: number; durationSec: number }
  | { type: 'OBJECTIVE_CAPTURED'; objectiveId: string; playerId: string };
```

**Event flow within a tick:**

| Emitting phase | Event | Consuming phase |
|---|---|---|
| Fire Resolution (5) | `SHOT_FIRED` | Damage Application (6) — creates shot record |
| Damage Application (6) | `UNIT_DESTROYED` | Suppression/Morale (7) — triggers morale check on nearby friendlies |
| Damage Application (6) | `SHOT_IMPACT` | Suppression/Morale (7) — near-miss suppression accumulation |
| Suppression/Morale (7) | `UNIT_ROUTING` | State Broadcast (9) — immediate event to client |
| Any phase | `SMOKE_CREATED` | Spotting Updates (4, next tick) — smoke affects LOS |

Events are also forwarded to State Broadcast (Phase 9) for delivery to clients as `GameEvent` messages.

### Cross-Reference Table

| System doc | Governs phase(s) | Key interface |
|---|---|---|
| Simulation Time Model | Tick rate, update frequencies | `TICK_RATE_HZ`, `TICKS_PER_SEC` |
| Game Systems Overview | All phases (summary) | Phase ordering, system interactions |
| Orders and C2 Interaction | Phase 1–2 | `OrderMessage`, `OrderResponse` |
| Combat Formula Spec | Phase 5–7 | To-hit (§1), suppression (§2), penetration (§6–9) |
| Spotting and Contact Model | Phase 4 | `Contact`, detection accumulator, tier gates |
| Unit Schema Spec | All phases | `UnitType`, `WeaponSlot`, `UnitInstance` |

---

*This document is the authoritative reference for the server tick loop. Any system doc that describes tick-level behaviour defers to the ordering and semantics defined here.*
