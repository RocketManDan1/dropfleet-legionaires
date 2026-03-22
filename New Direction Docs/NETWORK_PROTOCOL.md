# Network Protocol Specification
*Federation Legionaires — authoritative wire format reference*
*Last updated: 2026-03-21*

This document defines the network protocol between the game server and browser clients. It specifies every message type, the envelope format, delta encoding strategy, and bandwidth expectations. All message types are defined as TypeScript interfaces — these types are shared between server and client packages.

**Companion documents:**
- *Orders and C2 Interaction.md* — order vocabulary and validation rules
- *Simulation Time Model.md* — tick rate (20 Hz), update frequencies, state broadcast cadence
- *Spotting and Contact Model.md* — fog of war, contact tiers, per-player filtering
- *THEATER_SUPPORT.md* — strike/fire mission types and calling procedure
- *Unit Schema Spec.md* — UnitType, UnitInstance, WeaponSlot definitions
- *AUTHORITATIVE_CONTRACTS.md* — canonical mission enums, lifecycle/wire phase mapping, and timing contracts

**Current implementation status:** WebSocket on port 3000, JSON messages, only `ping`/`pong`/`generate`/`terrain` exist. This document specifies the target protocol.

---

## 1. Transport Layer

### 1.1 WebSocket over JSON

All messages are UTF-8 JSON over a single WebSocket connection per client. No binary framing in v1.

```
Client  ───  WSS (TLS in production)  ───  Server
              JSON text frames only
              Port 3000 (dev) / 443 (prod, nginx proxy)
```

**Why JSON for v1:** With 4 players at tactical pace (not twitch), the bottleneck is never serialization. JSON is debuggable with browser devtools, greppable in logs, and eliminates a class of desync bugs caused by schema version mismatches in binary formats. If profiling shows JSON parse time exceeding 2ms per tick on the client, upgrade to MessagePack (same envelope, binary encoding, ~40% size reduction).

### 1.2 Connection Lifecycle

```
Client                                Server
  │                                     │
  │─── WebSocket CONNECT ──────────────►│
  │◄── WebSocket ACCEPT ───────────────│
  │                                     │
  │─── AUTH { token } ────────────────►│
  │◄── AUTH_RESULT { playerId } ───────│
  │                                     │
  │─── JOIN_MISSION { missionId } ────►│
  │◄── DEPLOYMENT_ZONE { zones } ──────│  (if deployment phase)
  │◄── MISSION_STATE_FULL { ... } ─────│
  │                                     │
  │    ════ GAMEPLAY LOOP ════          │
  │─── ORDER / CHAT / PING ──────────►│
  │◄── TICK_UPDATE / events ───────────│
  │    ════════════════════            │
  │                                     │
  │─── DISCONNECT_GRACEFUL ───────────►│
  │◄── WebSocket CLOSE ────────────────│
```

States:

| State | Description | Valid client messages |
|---|---|---|
| `CONNECTED` | WebSocket open, not authenticated | `AUTH` only |
| `AUTHENTICATED` | Auth accepted, not in a mission | `JOIN_MISSION`, `PING`, `DISCONNECT_GRACEFUL` |
| `IN_MISSION` | Active gameplay | All gameplay messages |
| `DISCONNECTED` | WebSocket closed | None (server holds slot) |

The server drops the WebSocket immediately if the client sends a message invalid for its current state.

### 1.3 Heartbeat

- Client sends `PING` every **5 seconds**.
- Server responds with `PONG` including server tick for clock sync.
- If the server receives no message from a client for **15 seconds**, it force-closes the WebSocket and transitions the player to `DISCONNECTED` state.
- The client is responsible for the ping cadence. The server never initiates pings.

### 1.4 Reconnection

- Client auto-reconnects on WebSocket close (current implementation: 2s delay, will remain).
- On reconnect, the client must re-send `AUTH` and `JOIN_MISSION`. The server detects the returning player by `playerId` from the auth token.
- Disconnected player handling follows `AUTHORITATIVE_CONTRACTS.md` and `MISSION_LIFECYCLE.md`:
  - Tactical grace window: **5 minutes** (`DISCONNECT_GRACE_TICKS = 6000` at 20 Hz).
  - During grace, the player's units are frozen + invincible and cannot be targeted.
  - On grace expiry without reconnect, those units are removed from the battlefield and are not counted as casualties.
  - Other players see the disconnected player's status as `disconnected` via `PLAYER_STATUS`.
  - The player's fog-of-war state (last-sent deltas) is preserved so reconnect can send a correct full snapshot.
- On successful reconnect, the server sends a fresh `MISSION_STATE_FULL` snapshot. The client discards all local state and rebuilds from the snapshot.

---

## 2. Message Envelope

Every message — client-to-server and server-to-client — is wrapped in a standard envelope:

```typescript
interface MessageEnvelope<T = unknown> {
  type:     string;       // message type identifier (e.g. "ORDER", "TICK_UPDATE")
  seq:      number;       // sequence number (see below)
  tick:     number;       // server tick at time of send (server msgs) or last-known tick (client msgs)
  payload:  T;            // type-specific payload
}
```

### 2.1 Sequence Numbers

**Client → Server:** Each message gets a monotonically increasing `seq` starting from 1 per connection. The server uses `seq` to:
- Acknowledge order acceptance/rejection (`ORDER_ACK.seq` references the original)
- Report errors against specific requests (`ERROR.seq`)
- Detect duplicate messages after reconnect (server ignores `seq` values it has already processed for a given player)

**Server → Client:** The server sets `seq` to 0 on all outbound messages (server does not need acknowledgment from clients — it is authoritative). The `tick` field on server messages is the current simulation tick, used by the client for ordering and interpolation.

### 2.2 Error Referencing

When the server rejects a client message, the `ERROR` response includes the `seq` of the failed request:

```typescript
// Client sends:
{ type: "ORDER", seq: 42, tick: 18400, payload: { ... } }

// Server responds:
{ type: "ERROR", seq: 0, tick: 18405, payload: { refSeq: 42, code: "UNIT_NOT_OWNED", message: "Unit bmp2_04 is not under your command" } }
```

---

## 3. Client → Server Messages

All payloads below are the `payload` field inside the `MessageEnvelope`.

| Type | Payload Interface | Frequency | Description |
|---|---|---|---|
| `AUTH` | `AuthPayload` | Once per connect | Authenticate on WebSocket open |
| `JOIN_MISSION` | `JoinMissionPayload` | Once per session | Join or rejoin a mission |
| `PING` | `PingPayload` | Every 5s | Heartbeat / latency probe |
| `ORDER` | `OrderPayload` | Player-driven | Issue a unit order (all types) |
| `DEPLOY_UNIT` | `DeployUnitPayload` | Deployment phase only | Place a unit during deployment |
| `DEPLOY_READY` | `DeployReadyPayload` | Once per deployment | Signal deployment complete |
| `THEATER_SUPPORT` | `TheaterSupportPayload` | Player-driven | Call air strike or fire mission |
| `CHAT` | `ChatPayload` | Player-driven | Send chat message |
| `READY_CHECK_RESPONSE` | `ReadyCheckResponsePayload` | On prompt | Respond to server ready check |
| `DISCONNECT_GRACEFUL` | `DisconnectGracefulPayload` | Once | Intentional leave |

### 3.1 Type Definitions

```typescript
// ── AUTH ──────────────────────────────────────────────────────────────────────
interface AuthPayload {
  token: string;          // JWT or session token from login
}

// ── JOIN_MISSION ─────────────────────────────────────────────────────────────
interface JoinMissionPayload {
  missionId: string;      // mission to join or rejoin
}

// ── PING ─────────────────────────────────────────────────────────────────────
interface PingPayload {
  clientTime: number;     // client timestamp (ms) for RTT calculation
}

// ── ORDER ────────────────────────────────────────────────────────────────────
// This is the primary gameplay message. orderType maps 1:1 to the order
// vocabulary in Orders and C2 Interaction.md.

type OrderType =
  | 'MOVE'
  | 'FACE'
  | 'REVERSE'
  | 'ENGAGE'
  | 'SUPPRESS'
  | 'SMOKE'
  | 'SET_POSTURE'
  | 'SET_MAX_RANGE'
  | 'DEPLOY_SMOKE'
  | 'ACTIVATE_EW'
  | 'CALL_ARTY'
  | 'CALL_AIR'
  | 'COUNTER_BATTERY'
  | 'EMBARK'
  | 'DISMOUNT'
  | 'RALLY'
  | 'ALTITUDE'
  | 'LAND'
  | 'PICKUP'
  | 'INSERT'
  | 'ENTRENCH'
  | 'CANCEL';

interface OrderPayload {
  unitIds:    string[];         // one or more units receiving this order
  orderType:  OrderType;
  params:     OrderParams;      // type-specific parameters
  append:     boolean;          // true = shift-click append to waypoint queue
}

// OrderParams is a discriminated union keyed by orderType.
// Only the fields relevant to the order type are present.
type OrderParams =
  | { orderType: 'MOVE';          mode: 'advance' | 'march'; waypoints: Vec2[] }
  | { orderType: 'FACE';          bearingDeg: number }
  | { orderType: 'REVERSE';       targetPos: Vec2 }
  | { orderType: 'ENGAGE';        contactId: string; slotOverride?: number }
  | { orderType: 'SUPPRESS';      targetPos: Vec2 }
  | { orderType: 'SMOKE';         targetPos: Vec2 }
  | { orderType: 'SET_POSTURE';   posture: 'free_fire' | 'return_fire' | 'hold_fire' }
  | { orderType: 'SET_MAX_RANGE'; rangeM: number }
  | { orderType: 'DEPLOY_SMOKE' }
  | { orderType: 'ACTIVATE_EW' }
  | { orderType: 'CALL_ARTY';     targetPos: Vec2; contactId?: string }
  | { orderType: 'CALL_AIR';      strikeType: AirStrikeType; targetPos: Vec2 }
  | { orderType: 'COUNTER_BATTERY'; targetBatteryId: string }
  | { orderType: 'EMBARK';        transportId: string }
  | { orderType: 'DISMOUNT' }
  | { orderType: 'RALLY';         targetUnitId: string }
  | { orderType: 'ALTITUDE';      state: 'low' | 'high' }
  | { orderType: 'LAND';          targetPos: Vec2 }
  | { orderType: 'PICKUP';        targetUnitId: string }
  | { orderType: 'INSERT';        targetPos: Vec2 }
  | { orderType: 'ENTRENCH' }
  | { orderType: 'CANCEL' };

type AirStrikeType =
  | 'FIGHTER_BOMBER'
  | 'ATTACK_HELO_LOITER'
  | 'LEVEL_BOMBER'
  | 'SEAD'
  | 'ORBITAL_PRECISION';

interface Vec2 {
  x: number;    // metres from map origin
  z: number;    // metres from map origin (Z = forward axis in Three.js)
}

// ── DEPLOY_UNIT ──────────────────────────────────────────────────────────────
interface DeployUnitPayload {
  unitId:     string;           // unit to place
  position:   Vec2;             // placement position within deployment zone
  facing:     number;           // initial heading in degrees (0 = north)
}

// ── DEPLOY_READY ─────────────────────────────────────────────────────────────
interface DeployReadyPayload {}  // empty — presence is the signal

// ── THEATER_SUPPORT ──────────────────────────────────────────────────────────
// Separated from ORDER because theater support has its own resource pool
// (SP-AIR / FM) and different validation logic.
type FireMissionType =
  | 'HE_CONCENTRATION'
  | 'SMOKE_SCREEN'
  | 'ILLUMINATION'
  | 'SUSTAINED_BARRAGE'
  | 'PRECISION_STRIKE'
  | 'ROCKET_SALVO';

interface TheaterSupportPayload {
  supportType:  'AIR' | 'ARTY';
  // For AIR:
  strikeType?:  AirStrikeType;
  // For ARTY:
  missionType?: FireMissionType;
  // Common:
  callerUnitId: string;         // unit issuing the call (any unit; FO preferred for arty)
  target:       Vec2;           // impact point
  contactId?:   string;         // optional: target a specific contact (for precision strike)
}

// ── CHAT ─────────────────────────────────────────────────────────────────────
interface ChatPayload {
  channel:  'team' | 'all';
  message:  string;             // max 500 chars, server-enforced
}

// ── READY_CHECK_RESPONSE ─────────────────────────────────────────────────────
interface ReadyCheckResponsePayload {
  ready: boolean;
}

// ── DISCONNECT_GRACEFUL ──────────────────────────────────────────────────────
interface DisconnectGracefulPayload {}  // empty — server closes the socket
```

---

## 4. Server → Client Messages

| Type | Payload Interface | Frequency | Description |
|---|---|---|---|
| `AUTH_RESULT` | `AuthResultPayload` | Once per connect | Authentication response |
| `PONG` | `PongPayload` | Every 5s (response) | Heartbeat response with server time |
| `MISSION_STATE_FULL` | `MissionStateFullPayload` | On join/reconnect | Complete mission snapshot |
| `TICK_UPDATE` | `TickUpdatePayload` | Every second (1 Hz) | State delta batch (see section 5) |
| `ORDER_ACK` | `OrderAckPayload` | Per order received | Order accepted/rejected |
| `UNIT_DESTROYED` | `UnitDestroyedPayload` | On event | Unit killed notification |
| `MISSION_PHASE` | `MissionPhasePayload` | On transition | Phase change notification |
| `THEATER_SUPPORT_RESULT` | `TheaterSupportResultPayload` | On impact | Strike/fire mission resolution |
| `OBJECTIVE_UPDATE` | `ObjectiveUpdatePayload` | On change | Objective state change |
| `PLAYER_STATUS` | `PlayerStatusPayload` | On change | Player connect/disconnect |
| `CHAT_RELAY` | `ChatRelayPayload` | On chat | Relayed chat message |
| `READY_CHECK` | `ReadyCheckPayload` | Server-initiated | Prompt all players for ready |
| `ERROR` | `ErrorPayload` | On error | Error referencing client seq |
| `DEPLOYMENT_ZONE` | `DeploymentZonePayload` | Deployment phase start | Available deployment areas |
| `AAR_DATA` | `AARDataPayload` | Mission end | After-action report data |

### 4.1 Type Definitions

```typescript
// ── AUTH_RESULT ───────────────────────────────────────────────────────────────
interface AuthResultPayload {
  success:    boolean;
  playerId?:  string;           // assigned player ID on success
  playerName?: string;
  error?:     string;           // human-readable error on failure
}

// ── PONG ─────────────────────────────────────────────────────────────────────
interface PongPayload {
  clientTime:  number;          // echoed from PING for RTT calc
  serverTime:  number;          // server timestamp (ms)
  serverTick:  number;          // current simulation tick
}

// ── MISSION_STATE_FULL ───────────────────────────────────────────────────────
// Sent on join and reconnect. Contains everything the client needs to render
// the current game state. This is the ONLY message that contains full unit
// objects — all subsequent updates are deltas.

interface MissionStateFullPayload {
  missionId:        string;
  tick:             number;
  phase:            MissionPhase;
  phaseTimer?:      number;           // seconds remaining in current phase, if applicable

  // Terrain is sent separately (existing terrain message). This payload
  // only contains mission-layer data.
  terrain?:         TerrainReference;  // { terrainId: string } — client already has terrain data

  // Full unit state for all units this player can see (fog-filtered)
  units:            UnitSnapshot[];
  // All contacts visible to this player
  contacts:         ContactSnapshot[];
  // Mission objectives
  objectives:       ObjectiveSnapshot[];
  // Theater support remaining
  theaterSupport:   TheaterSupportState;
  // Other players in this mission
  players:          PlayerInfo[];
}

type MissionPhase =
  | 'briefing'
  | 'deployment'
  | 'live'
  | 'extraction'
  | 'ended';

// Mapping note:
// - Internal lifecycle phases `created` and `deployment` are surfaced as `briefing` or `deployment`.
// - Internal `aar` and `closed` are surfaced as `ended` on the wire.

interface TerrainReference {
  terrainId: string;    // reference to previously-sent terrain data
}

interface UnitSnapshot {
  id:               string;
  typeId:           string;
  team:             number;
  ownerId:          string;     // playerId of the owning player
  posX:             number;
  posZ:             number;
  heading:          number;
  currentCrew:      number;
  suppression:      number;
  firePosture:      'free_fire' | 'return_fire' | 'hold_fire';
  moraleState:      'normal' | 'pinned' | 'routing' | 'surrendered';
  firerState:       'full_halt' | 'short_halt' | 'slow' | 'fast';
  ammo:             [AmmoState, AmmoState, AmmoState, AmmoState];
  smokeRemaining:   number;
  ewCharges:        number;
  experience:       number;
  entrenched:       boolean;
  transportedBy:    string | null;
  transportedUnits: string[];
  altitudeState:    'landed' | 'low' | 'high' | null;
  // Active order feedback (for C2 display)
  activeOrder?:     ActiveOrderInfo;
  // Movement velocity for client-side interpolation
  velocityX:        number;
  velocityZ:        number;
}

interface ActiveOrderInfo {
  orderType:    OrderType;
  state:        'queued' | 'executing' | 'done';
  waypoints?:   Vec2[];           // remaining waypoints for movement orders
  targetPos?:   Vec2;             // target position for fire/support orders
  targetId?:    string;           // target contact/unit ID for engage orders
}

interface ContactSnapshot {
  contactId:    string;
  tier:         number;           // raw detection accumulator, integer 0–100
                                  // (NOT a 0–3 index; mirrors the server accumulator value)
                                  // 1–24 = SUSPECTED, 25–74 = DETECTED, 75–100 = CONFIRMED
  tierLabel:    'SUSPECTED' | 'DETECTED' | 'CONFIRMED';
                                  // derived from tier; use tierLabel for display/logic,
                                  // tier for precision (e.g. how close to next upgrade)
  posX:         number;           // approximate (±50m jitter) at SUSPECTED, exact at DETECTED+
  posZ:         number;
  unitClass?:   string;           // known if DETECTED+
  heading?:     number;           // known if CONFIRMED
  lastSeenTick: number;
}

interface ObjectiveSnapshot {
  objectiveId:  string;
  name:         string;
  type:         'capture' | 'destroy' | 'defend' | 'extract';
  posX:         number;
  posZ:         number;
  radius:       number;
  state:        'pending' | 'in_progress' | 'completed' | 'failed';
  progress:     number;           // 0.0 - 1.0
}

interface TheaterSupportState {
  strikePointsRemaining:  number;
  strikePointsTotal:      number;
  fireMissionsRemaining:  number;
  fireMissionsTotal:      number;
  pendingStrikes:         PendingStrike[];
}

interface PendingStrike {
  supportId:    string;
  supportType:  'AIR' | 'ARTY';
  strikeType?:  AirStrikeType;
  missionType?: FireMissionType;
  targetPos:    Vec2;
  impactTick:   number;           // server tick when strike resolves
}

interface PlayerInfo {
  playerId:     string;
  playerName:   string;
  status:       'connected' | 'disconnected' | 'reconnecting';
  battalionType: string;
}

// ── TICK_UPDATE ──────────────────────────────────────────────────────────────
// See Section 5 for deep dive.
interface TickUpdatePayload {
  tick:           number;
  unitDeltas:     UnitDelta[];
  contactDeltas:  ContactDelta[];
  events:         GameEvent[];
}

// ── ORDER_ACK ────────────────────────────────────────────────────────────────
interface OrderAckPayload {
  refSeq:     number;           // seq of the ORDER message being acknowledged
  accepted:   boolean;
  reason?:    string;           // error code if rejected (see Section 7)
  unitIds:    string[];         // which units accepted/rejected (for group orders)
}

// ── UNIT_DESTROYED ───────────────────────────────────────────────────────────
interface UnitDestroyedPayload {
  unitId:       string;
  destroyedBy?: string;         // unitId of the killer (null for arty/air)
  weapon?:      string;         // weapon name that scored the kill
  causeType:    'direct_fire' | 'indirect_fire' | 'air_strike' | 'mine' | 'surrender';
}

// ── MISSION_PHASE ────────────────────────────────────────────────────────────
interface MissionPhasePayload {
  phase:    MissionPhase;
  timer?:   number;             // seconds until next phase transition (if applicable)
}

// ── THEATER_SUPPORT_RESULT ───────────────────────────────────────────────────
interface TheaterSupportResultPayload {
  supportId:    string;
  supportType:  'AIR' | 'ARTY';
  strikeType?:  AirStrikeType;
  missionType?: FireMissionType;
  impacts:      ImpactEvent[];
  intercepted:  boolean;        // true if AA shot down the aircraft / aborted
}

interface ImpactEvent {
  posX:         number;
  posZ:         number;
  radius:       number;         // effect radius in metres
  damageType:   'he' | 'ap' | 'smoke' | 'illumination';
}

// ── OBJECTIVE_UPDATE ─────────────────────────────────────────────────────────
interface ObjectiveUpdatePayload {
  objectiveId:  string;
  state:        'pending' | 'in_progress' | 'completed' | 'failed';
  progress:     number;         // 0.0 - 1.0
}

// ── PLAYER_STATUS ────────────────────────────────────────────────────────────
interface PlayerStatusPayload {
  playerId:     string;
  playerName:   string;
  status:       'connected' | 'disconnected' | 'reconnecting';
}

// ── CHAT_RELAY ───────────────────────────────────────────────────────────────
interface ChatRelayPayload {
  from:       string;           // playerId
  fromName:   string;           // display name
  channel:    'team' | 'all';
  message:    string;
  tick:       number;           // server tick when message was sent
}

// ── READY_CHECK ──────────────────────────────────────────────────────────────
interface ReadyCheckPayload {
  reason:   'mission_start' | 'phase_transition';
  timeout:  number;             // seconds to respond before auto-decline
}

// ── ERROR ────────────────────────────────────────────────────────────────────
interface ErrorPayload {
  refSeq:   number;             // seq of the client message that caused the error
  code:     ErrorCode;
  message:  string;             // human-readable description
}

// ── DEPLOYMENT_ZONE ──────────────────────────────────────────────────────────
interface DeploymentZonePayload {
  zones: DeploymentZone[];
}

interface DeploymentZone {
  zoneId:     string;
  playerId:   string;           // which player this zone belongs to
  polygon:    Vec2[];           // convex hull of the deployment area
  unitIds:    string[];         // units available for deployment in this zone
}

// ── AAR_DATA ─────────────────────────────────────────────────────────────────
interface AARDataPayload {
  missionId:        string;
  outcome:          'victory' | 'defeat' | 'draw';
  durationSeconds:  number;
  stats:            PlayerStats[];
  timeline:         TimelineEntry[];
  casualties:       CasualtyRecord[];
}

interface PlayerStats {
  playerId:       string;
  unitsDeployed:  number;
  unitsLost:      number;
  killsScored:    number;
  ordersIssued:   number;
  theaterCalls:   number;
  objectivesCompleted: number;
}

interface TimelineEntry {
  tick:       number;
  eventType:  string;
  summary:    string;
}

interface CasualtyRecord {
  unitId:       string;
  unitName:     string;
  ownerId:      string;
  destroyedAtTick: number;
  destroyedBy?: string;
  causeType:    string;
}
```

---

## 5. TICK_UPDATE Deep Dive

`TICK_UPDATE` is the primary state-sync message. It is sent **every second (1 Hz)** to each connected player. Each player receives a **different** `TICK_UPDATE` because fog of war is enforced server-side.

### 5.1 Structure

```typescript
interface TickUpdatePayload {
  tick:           number;         // monotonically increasing server tick
  unitDeltas:     UnitDelta[];    // units whose state changed since the previous TICK_UPDATE
  contactDeltas:  ContactDelta[];  // contacts added/updated/removed for this player
  events:         GameEvent[];    // combat events since the previous TICK_UPDATE
}
```

### 5.2 Unit Deltas

A `UnitDelta` contains **only the fields that changed** since the previous `TICK_UPDATE` sent to this specific client. It is not a full `UnitSnapshot`.

```typescript
interface UnitDelta {
  id:               string;                         // always present — identifies the unit
  // All remaining fields are OPTIONAL — only present when changed
  posX?:            number;
  posZ?:            number;
  heading?:         number;
  velocityX?:       number;                         // for client-side interpolation
  velocityZ?:       number;
  currentCrew?:     number;
  suppression?:     number;
  firePosture?:     'free_fire' | 'return_fire' | 'hold_fire';
  moraleState?:     'normal' | 'pinned' | 'routing' | 'surrendered';
  firerState?:      'full_halt' | 'short_halt' | 'slow' | 'fast';
  ammo?:            Partial<[Partial<AmmoState>, Partial<AmmoState>, Partial<AmmoState>, Partial<AmmoState>]>;
  smokeRemaining?:  number;
  ewCharges?:       number;
  entrenched?:      boolean;
  transportedBy?:   string | null;
  transportedUnits?: string[];
  altitudeState?:   'landed' | 'low' | 'high' | null;
  activeOrder?:     ActiveOrderInfo | null;          // null = order cleared
  removed?:         boolean;                         // true = unit left player's fog-of-war
}
```

**Key rules:**

- A stationary unit generates **zero** deltas (no position echo every second).
- Velocity is sent alongside position changes so the client can interpolate between snapshot intervals.
- `ammo` uses nested partials: `{ ammo: [{ he: 4 }] }` means slot 0 HE count changed; all other slots and ammo types unchanged.
- `removed: true` means the unit is no longer visible to this player (fog of war). The client should remove it from the rendered scene. It may reappear later as a new delta if the unit is re-spotted.

### 5.3 Contact Deltas

```typescript
interface ContactDelta {
  contactId:    string;
  action:       'add' | 'update' | 'remove';
  // Present on 'add' and 'update':
  tier?:        number;
  tierLabel?:   'SUSPECTED' | 'DETECTED' | 'CONFIRMED';
  posX?:        number;
  posZ?:        number;
  unitClass?:   string;
  heading?:     number;
  lastSeenTick?: number;
}
```

- `add`: new contact detected this tick. All fields present.
- `update`: existing contact changed tier, position, or classification. Only changed fields present.
- `remove`: contact decayed below detection threshold or was destroyed. Only `contactId` and `action` present.

Contact positions for `SUSPECTED` and `DETECTED` tiers include server-applied jitter (the position is approximate). `CONFIRMED` contacts send true position. The client does **not** add its own jitter.

### 5.4 Game Events

Events are things that happened since the previous `TICK_UPDATE` that the client needs to render (audio, visual effects, combat log). They are not state changes — they are fire-and-forget notifications.

```typescript
type GameEvent =
  | ShotFiredEvent
  | ShotImpactEvent
  | SuppressionEvent
  | SmokeDeployedEvent
  | RallyEvent
  | AltitudeChangeEvent;

interface ShotFiredEvent {
  event:      'shot_fired';
  shooterId:  string;
  targetPos:  Vec2;
  weaponSlot: number;
  ammoType:   'he' | 'ap' | 'heat' | 'sabot';
}

interface ShotImpactEvent {
  event:      'shot_impact';
  posX:       number;
  posZ:       number;
  hit:        boolean;
  targetId?:  string;           // unit hit (if any)
  damageType: 'penetration' | 'partial_pen' | 'ricochet' | 'miss' | 'suppression_only';
  crewLoss?:  number;           // crew/strength lost on this hit
}

interface SuppressionEvent {
  event:      'suppression';
  unitId:     string;
  delta:      number;           // suppression points added
  newTotal:   number;
}

interface SmokeDeployedEvent {
  event:      'smoke_deployed';
  posX:       number;
  posZ:       number;
  radius:     number;           // metres
  source:     'discharger' | 'round' | 'fire_mission';
}

interface RallyEvent {
  event:      'rally';
  commanderId: string;
  targetId:   string;
  success:    boolean;
  suppressionReduced: number;
}

interface AltitudeChangeEvent {
  event:      'altitude_change';
  unitId:     string;
  from:       'landed' | 'low' | 'high';
  to:         'landed' | 'low' | 'high';
}
```

### 5.5 Fog of War Filtering

The server maintains a **per-player last-sent state** for every unit. Each tick:

1. The server computes which units are visible to this player (union of all the player's units' sensor arcs, per Spotting and Contact Model).
2. For each visible unit, the server diffs the current state against the last-sent state for this player.
3. Only changed fields are included in `unitDeltas`.
4. Units that were visible last tick but are no longer visible get a `{ id, removed: true }` delta.
5. Units that become visible again get a full set of fields (equivalent to a mini-snapshot for that unit).

Contacts follow the same pattern: each player's `contactDeltas` reflect only the contacts that player's forces have contributed to or that teammates have shared (per the shared contact picture rule).

### 5.6 Size Budget

| Scenario | unitDeltas | contactDeltas | events | Estimated Size |
|---|---|---|---|---|
| **Quiet tick** (no movement, no combat) | 0 units | 0 contacts | 0 events | ~50 bytes (envelope only) |
| **Normal tick** (10 units moving, no combat) | 10 deltas (pos+vel) | 1-2 updates | 0 events | ~600 bytes |
| **Active combat** (20 units moving, 5 shots/tick) | 20 deltas | 5 updates | 5 events | ~2 KB |
| **Heavy combat** (50 units, 15 shots/tick) | 50 deltas | 10 updates | 15 events | ~5 KB |
| **Worst case** (100 visible units, all moving, 30 shots) | 100 deltas | 20 updates | 30 events | ~10 KB |

**Target:** < 2 KB average per tick. Spikes to 10 KB acceptable during heavy combat.

**Per-second bandwidth at 20 Hz:**

| Scenario | Per-tick | Per-second (x20) |
|---|---|---|
| Quiet | 50 B | 1 KB/s |
| Normal | 600 B | 12 KB/s |
| Active combat | 2 KB | 40 KB/s |
| Worst case | 10 KB | 200 KB/s |

200 KB/s worst case is well within any broadband connection. With 4 players, server outbound peaks at 800 KB/s — trivial.

---

## 6. Delta Encoding Strategy

### 6.1 Per-Client State Tracking

The server maintains a `lastSentState: Map<string, UnitSnapshot>` for each connected player. This map is keyed by unit ID and stores the last values sent to that player for each field. On each tick:

```
for each unit visible to this player:
    diff = computeDelta(unit.currentState, player.lastSentState[unit.id])
    if diff is not empty:
        append diff to unitDeltas
        update player.lastSentState[unit.id] with current values
```

On reconnect, `lastSentState` is cleared, forcing the next `MISSION_STATE_FULL` to contain everything.

### 6.2 Position Updates

- Position is only sent when the unit **moves** (delta from last-sent position exceeds 0.1m).
- Stationary units produce zero position deltas regardless of how many ticks pass.
- Velocity (`velocityX`, `velocityZ`) is sent alongside position so the client can interpolate between 1 Hz snapshots at 60 fps.
- When a unit stops, a final delta is sent with exact position and velocity `(0, 0)`.

### 6.3 Fields Not Sent as Deltas

Some values are **computable client-side** from events and do not need explicit deltas:

| Field | Strategy |
|---|---|
| `weaponCooldowns` | Not sent. Client computes locally from `shot_fired` events + known cooldown formula from Unit Schema. Visual-only; server is authoritative on actual fire timing. |
| `recentDistanceM` | Not sent. Client computes from position deltas over a 10s window. |
| `stoppedForSec` | Not sent. Client computes from absence of position deltas. |
| `eraRemaining` | Sent only on ERA depletion event, not per-tick. |

### 6.4 Contact Position Smoothing

The client receives contact position updates at detection-check frequency (every second per Simulation Time Model, not every tick). Between updates, the client **linearly interpolates** contact positions using the last-known velocity estimate. This prevents contacts from teleporting on the C2 display.

For `SUSPECTED` contacts (low tier), the server applies random jitter to the position on each update. The client must **not** smooth between jittered positions — it should snap to the new position on each update to preserve the uncertainty aesthetic.

---

## 7. Error Codes

```typescript
type ErrorCode =
  // Order validation
  | 'INVALID_ORDER'           // malformed order payload
  | 'UNIT_NOT_OWNED'          // player does not control this unit
  | 'UNIT_DESTROYED'          // unit is dead
  | 'UNIT_SUPPRESSED'         // unit suppression too high for this action
  | 'UNIT_ROUTING'            // unit is routing, cannot accept orders
  | 'UNIT_SURRENDERED'        // unit has surrendered
  | 'OUT_OF_RANGE'            // target beyond weapon/sensor range
  | 'NO_AMMO'                 // no ammo of required type
  | 'NO_LOS'                  // no line of sight to target
  | 'TARGET_NOT_ACQUIRED'     // contact below DETECTED tier for this unit
  | 'INVALID_TARGET'          // target does not exist or is friendly

  // Movement
  | 'IMPASSABLE_TERRAIN'      // destination is impassable for this move class
  | 'QUEUE_FULL'              // waypoint queue at max depth (4)
  | 'CANNOT_REVERSE'          // unit class does not support reverse (leg, hover)

  // Transport
  | 'TRANSPORT_FULL'          // transport at capacity
  | 'TRANSPORT_MOVING'        // transport must be stationary for embark/dismount
  | 'NOT_INFANTRY'            // only infantry can embark
  | 'TOO_FAR'                 // infantry not within 50m of transport

  // Theater support
  | 'NO_STRIKE_POINTS'        // SP-AIR pool exhausted
  | 'NO_FIRE_MISSIONS'        // FM pool exhausted
  | 'CONTACT_NOT_CONFIRMED'   // precision strike requires CONFIRMED contact

  // Helicopter
  | 'INVALID_LANDING_ZONE'    // terrain not suitable for landing
  | 'ALTITUDE_TRANSITIONING'  // already changing altitude

  // Fortification
  | 'CANNOT_ENTRENCH'         // vehicle, or unit is moving / under fire

  // Session
  | 'AUTH_FAILED'             // invalid or expired token
  | 'SESSION_FULL'            // mission at max 4 players
  | 'MISSION_NOT_FOUND'       // missionId does not exist
  | 'PHASE_WRONG'             // action not valid in current mission phase
  | 'NOT_IN_MISSION'          // player not joined to any mission

  // Generic
  | 'RATE_LIMITED'            // too many messages per second
  | 'INTERNAL_ERROR';         // server bug — log and report
```

---

## 8. Bandwidth Analysis

### 8.1 Message Size Estimates

All sizes are JSON UTF-8 encoded, including envelope overhead (~60 bytes for `{ type, seq, tick, payload }`).

| Message | Direction | Estimated Size | Notes |
|---|---|---|---|
| `AUTH` | C→S | 120 B | JWT token |
| `PING` | C→S | 80 B | |
| `PONG` | S→C | 100 B | |
| `ORDER` (simple) | C→S | 150 B | FACE, SET_POSTURE |
| `ORDER` (movement) | C→S | 250 B | MOVE with 2 waypoints |
| `ORDER` (group, 4 units) | C→S | 300 B | Same order, 4 unitIds |
| `THEATER_SUPPORT` | C→S | 200 B | |
| `CHAT` | C→S | 200 B | Average message |
| `ORDER_ACK` | S→C | 120 B | |
| `TICK_UPDATE` (quiet) | S→C | 50 B | Empty deltas |
| `TICK_UPDATE` (normal) | S→C | 600 B | 10 moving units |
| `TICK_UPDATE` (combat) | S→C | 2 KB | 20 units + 5-15 events |
| `TICK_UPDATE` (worst) | S→C | 10 KB | 100 units + dense event batch |
| `MISSION_STATE_FULL` | S→C | 15-50 KB | Depends on unit count |
| `AAR_DATA` | S→C | 5-20 KB | Depends on mission length |

### 8.2 Message Rates

| Message | Rate per player | Direction |
|---|---|---|
| `TICK_UPDATE` | 1/sec (every second) | S→C |
| `PING` / `PONG` | 0.2/sec | Both |
| `ORDER` | 0.5-2/sec during active play, 0 when watching | C→S |
| `CHAT` | < 0.1/sec | C→S |
| `ORDER_ACK` | matches ORDER rate | S→C |
| `PLAYER_STATUS` | rare (connect/disconnect events) | S→C |
| Events within TICK_UPDATE | 0-30/sec during combat (batched per second) | S→C |

### 8.3 Bandwidth Summary Per Player

| Scenario | Client → Server | Server → Client | Total |
|---|---|---|---|
| **Idle** (connected, no orders) | 0.2 KB/s (pings) | 0.2 KB/s (quiet deltas + pongs) | 0.4 KB/s |
| **Normal gameplay** | 0.5 KB/s | 0.8 KB/s | 1.3 KB/s |
| **Active combat** | 1 KB/s | 2.2 KB/s | 3.2 KB/s |
| **Worst case spike** | 2 KB/s | 10.2 KB/s | 12.2 KB/s |

### 8.4 Server Total (4 Players)

| Scenario | Server outbound | Server inbound |
|---|---|---|
| Normal | 3.2 KB/s | 2 KB/s |
| Active combat | 8.8 KB/s | 4 KB/s |
| Worst case | 40.8 KB/s | 8 KB/s |

### 8.5 Why JSON Is Acceptable for v1

1. **4 players, not 64.** The player count caps total bandwidth at levels that are trivial for any server.
2. **Tactical pace, not twitch.** Players issue orders at human decision speed (seconds between inputs), not 60+ inputs/sec.
3. **Delta encoding dominates.** Most ticks are nearly empty (quiet map). JSON overhead on a 50-byte empty delta is negligible.
4. **Debuggability.** During development, being able to read messages in browser devtools and server logs is worth more than a 40% size reduction from binary encoding.
5. **Upgrade path is clear.** The envelope format is encoding-agnostic. Switching to MessagePack requires changing the serialize/deserialize layer only — no message structure changes.

**When to upgrade:** If profiling shows JSON `parse()` exceeding 2ms per tick on the client, or if the game is ported to mobile where bandwidth matters, switch the transport to MessagePack. The message types and envelope structure defined in this document remain unchanged.

---

## Appendix A: Shared Type Imports

Types referenced but defined in other specs:

| Type | Defined In |
|---|---|
| `AmmoState` | Unit Schema Spec.md |
| `UnitClass` | Unit Schema Spec.md |
| `MoveClass` | Unit Schema Spec.md |
| `ArmourFacings` | Unit Schema Spec.md |
| `AirStrikeType` | This document (section 3.1), mirrors THEATER_SUPPORT.md |
| `FireMissionType` | This document (section 3.1), mirrors THEATER_SUPPORT.md |

---

## Appendix B: Migration from Current Implementation

The current server (`server/src/index.ts`) uses bare JSON messages without envelopes:

```typescript
// CURRENT (v0):
{ type: 'ping' }
{ type: 'pong', timestamp: 12345 }
{ type: 'generate', width: 512, height: 512 }
{ type: 'terrain', data: { ... } }

// TARGET (v1):
{ type: 'PING', seq: 1, tick: 0, payload: { clientTime: 12345 } }
{ type: 'PONG', seq: 0, tick: 1840, payload: { clientTime: 12345, serverTime: 12350, serverTick: 1840 } }
```

Migration steps:
1. Add `MessageEnvelope` wrapper to both server and client serialization.
2. Add sequence counter to client-side `GameConnection.send()`.
3. Add tick counter to server-side message construction.
4. Replace `ping`/`pong` with `PING`/`PONG` + payload structure.
5. Keep `terrain` message as a separate pre-game data channel until terrain loading is refactored.
6. Add `AUTH` flow (currently no authentication — direct WebSocket connect).

---

*This document is the canonical wire format reference. Any system that adds a new message type must define it here with TypeScript interface, size estimate, and expected frequency.*

*Cross-references: Orders and C2 Interaction.md, Simulation Time Model.md, Spotting and Contact Model.md, THEATER_SUPPORT.md, Unit Schema Spec.md*
