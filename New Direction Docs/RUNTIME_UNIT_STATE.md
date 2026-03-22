# Runtime Unit State Model
*Federation Legionaires — authoritative spec*
*Last updated: 2026-03-21*

This document defines every in-memory data structure the server holds during a live mission. It bridges the static unit database (Unit Schema Spec) and the game loop (Game Systems Overview, Combat Formula Spec, Simulation Time Model). Everything here is mutable, server-authoritative, and tick-driven.

**Canonical references:**
- Static data: Unit Schema Spec (`UnitType`, `WeaponSlot`, `ArmourFacings`)
- Combat: Combat Formula Spec (Formulas 1–10)
- Detection: Spotting and Contact Model (`Contact`, detection tiers)
- Time: Simulation Time Model (20 Hz tick, `ROF_REALTIME_MULTIPLIER = 5`)
- Orders: Orders and C2 Interaction (`OrderMessage`)
- Rosters: FORCE_ROSTERS.md (battalion TOEs)
- Theater support: THEATER_SUPPORT.md (SP-AIR, FM allocations)
- Shared contracts: AUTHORITATIVE_CONTRACTS.md (mission enums, phase mapping, disconnect timers)

---

## 1. UnitInstance — The Runtime Object

One per deployed unit. The server holds these in a `Map<string, UnitInstance>` keyed by `instanceId`. Static data is looked up via `unitTypeId` against the read-only `UnitType` registry — it is never copied into `UnitInstance` except for values that can be mutated at runtime (armour facings, ERA).

```typescript
interface UnitInstance {
  // ── Identity ────────────────────────────────────────────────────────────────
  /** Unique runtime ID for this mission (UUID v4). Not reused across missions. */
  instanceId:       string;
  /** References UnitType.id in the static registry. Immutable after spawn. */
  unitTypeId:       string;
  /** Player who owns this unit. Matches PlayerMissionState.playerId. */
  ownerId:          string;
  /** Platoon this unit belongs to. References PlatoonState.platoonId. */
  platoonId:        string;
  /** Display callsign, e.g. "ALPHA-2" or "WARHORSE-14". Set at spawn. */
  callsign:         string;

  // ── Position ────────────────────────────────────────────────────────────────
  /** X position in metres from map origin (east axis). */
  posX:             number;
  /** Z position in metres from map origin (north axis — Z-forward in Three.js). */
  posZ:             number;
  /** Heading in degrees, 0 = north, clockwise. Hull facing for vehicles, body facing for infantry. */
  heading:          number;
  /** Turret heading in degrees (vehicles with turret traverse only; null for infantry/fixed-mount). */
  turretHeading:    number | null;
  /**
   * Current logical overlay cell (derived from posX/posZ).
   * Legacy name kept for compatibility with older docs and tooling.
   * This is not authoritative for movement integration, which remains continuous.
   */
  currentHex:       HexCoord;

  // ── Movement ────────────────────────────────────────────────────────────────
  /**
   * Derived movement state. Updated every tick from the rolling 10-second
   * movement history. Feeds Formula 1 (to-hit) and fire posture logic.
   * See Simulation Time Model for derivation rules.
   */
  speedState:       'full_halt' | 'short_halt' | 'slow' | 'fast';
  /** Metres moved in the last 10 seconds (rolling sum, updated every tick). */
  recentDistanceM:  number;
  /** Seconds continuously stationary. Resets to 0 on any movement. */
  stoppedForSec:    number;
  /**
   * Server-side pathfinding result. Null when the unit has no movement order.
   * Waypoints are in world-space metres. The server walks this path each tick.
   */
  currentPath:      Vec2[] | null;
  /** Index into currentPath — the next waypoint the unit is moving toward. */
  pathIndex:        number;
  /**
   * Movement mode for the active path segment. Determines speed cap and
   * whether the unit fires en route (ADVANCE = weapons-ready, MARCH = hold fire).
   */
  moveMode:         'advance' | 'march' | 'reverse' | null;

  // ── Combat: Weapons ─────────────────────────────────────────────────────────
  /**
   * Per-weapon-slot ammunition remaining. Indexed 0–3 matching UnitType.weapons[].
   * Initialised from UnitType.weapons[slot].ammo* at spawn.
   * Decremented on each shot fired; replenished by supply trickle.
   */
  ammo:             [AmmoState, AmmoState, AmmoState, AmmoState];
  /**
   * Per-weapon-slot cooldown timer in seconds. 0 = weapon ready to fire.
   * Set to the computed cooldown on each shot (Formula 9 + Formula 2 suppression scaling).
   * Decremented every tick (by TICK_MS / 1000).
   */
  weaponCooldowns:  [number, number, number, number];
  /**
   * Server tick number when each weapon slot last fired. Used for fire-rate
   * auditing and replay. -1 = never fired this mission.
   */
  lastFireTick:     [number, number, number, number];
  /** Player-configured fire posture. Persists until explicitly changed. */
  firePosture:      'free_fire' | 'return_fire' | 'hold_fire';
  /**
   * Maximum auto-engagement range in metres. Applies to free_fire and return_fire
   * auto-targeting only; explicit ENGAGE orders ignore this cap.
   * Default: Infinity (full weapon range).
   */
  maxEngageRangeM:  number;
  /**
   * Contact ID of the current direct-fire target (from ENGAGE order or auto-fire).
   * Null when not engaging. Cleared when target enters LOST state or order is cancelled.
   */
  currentTargetId:  string | null;
  /** Weapon slot override for current engagement. Null = server auto-selects. */
  engageSlotOverride: number | null;

  // ── Health ──────────────────────────────────────────────────────────────────
  /** Current crew/strength. Decremented by damage. 0 = destroyed. */
  crewCurrent:      number;
  /** Max crew from UnitType.maxCrew. Copied at spawn; never changes. */
  crewMax:          number;
  /** True when crewCurrent reaches 0. Unit remains in the registry as destroyed. */
  isDestroyed:      boolean;
  /**
   * True when a vehicle crew abandons after a penetrating hit (survival roll passed,
   * but crew chose to bail). Bailed-out vehicles are immobile and cannot fire.
   */
  isBailedOut:      boolean;
  /**
   * True when mobility is lost (track/wheel damage) but the unit can still fight.
   * Immobilized units cannot move but retain fire capability.
   */
  isImmobilized:    boolean;

  // ── Armour (mutable copy) ───────────────────────────────────────────────────
  /**
   * Steel armour facings in cm RHA. Copied from UnitType.steelArmour at spawn.
   * Can be degraded by specific damage events (e.g. spall, repeated hits).
   * For most units these remain unchanged from static data.
   */
  steelArmour:      ArmourFacings;
  /**
   * Anti-HEAT armour facings (composite / spaced). Copied from UnitType.heatArmour.
   * Always >= steelArmour values.
   */
  heatArmour:       ArmourFacings;
  /**
   * ERA charges remaining per facing. Decremented on each ERA activation
   * (Formula 6: each activation reduces level by 1). When a facing reaches 0,
   * ERA no longer activates on that facing.
   */
  eraRemaining:     Partial<ArmourFacings>;

  // ── Suppression & Morale ───────────────────────────────────────────────────
  /**
   * Suppression level, 0–100. Accumulated by incoming fire events (Formula 2).
   * Decays per second when not under fire (rate depends on morale state).
   * Drives weapon cooldown scaling, slot lockout, and morale state.
   */
  suppressionLevel: number;
  /**
   * Current morale state, derived from suppressionLevel thresholds (Formula 3):
   *   NORMAL:      < 40
   *   PINNED:      40–64
   *   ROUTING:     65–89
   *   SURRENDERED: >= 90 AND crewCurrent <= 25% of crewMax
   */
  moraleState:      'normal' | 'pinned' | 'routing' | 'surrendered';
  /**
   * Tick at which the last rally effect was applied to this unit.
   * Used to enforce the 15-second rally cooldown per target.
   */
  lastRalliedAtTick: number;

  // ── Orders ──────────────────────────────────────────────────────────────────
  /**
   * The order currently being executed. Null when idle.
   * This is the server's internal representation, not the raw OrderMessage.
   */
  currentOrder:     ResolvedOrder | null;
  /**
   * Queued waypoints for movement orders (max 4). Each entry includes position
   * and movement mode. Shift-click appends; new order without shift clears.
   */
  orderQueue:       QueuedWaypoint[];
  /** True when the current order has completed (unit reached destination, etc.). */
  isOrderComplete:  boolean;

  // ── Transport ───────────────────────────────────────────────────────────────
  /**
   * instanceId of the vehicle/helicopter carrying this unit. Null if not embarked.
   * When embarked, posX/posZ track the transport's position.
   */
  transportedBy:    string | null;
  /**
   * instanceIds of units currently carried by this transport. Empty array if
   * not a transport or carrying no one. Length <= UnitType.transportCapacity.
   */
  passengers:       string[];

  // ── Helicopter ──────────────────────────────────────────────────────────────
  /**
   * Altitude state for helicopter units. Null for all ground units.
   * Transitions take real time (LOW->HIGH: 8s, HIGH->LOW: 5s, etc.).
   */
  altitudeState:    'landed' | 'low' | 'high' | null;
  /**
   * True during altitude transitions. Unit cannot fire or change heading
   * while transitioning. Cleared when transition completes.
   */
  altitudeTransitioning: boolean;
  /** Seconds remaining in the current altitude transition. 0 when not transitioning. */
  altitudeTransitionTimer: number;

  // ── Entrenchment ────────────────────────────────────────────────────────────
  /**
   * True when fully entrenched (120s dig-in complete). Grants 30% reduction
   * to incoming damage and suppression accumulation. Cleared on any movement.
   */
  isEntrenched:     boolean;
  /**
   * Seconds of dig-in progress (0–120). Advances while stationary (full_halt),
   * suppression < 20, and ENTRENCH order is active. Resets to 0 on movement.
   */
  entrenchProgress: number;

  // ── Supply ──────────────────────────────────────────────────────────────────
  /**
   * EW system charges remaining (Arena / VIRSS). Decremented automatically
   * by the server on each activation — no player order required.
   *
   * Initialised from UnitType.ew:
   *   ew 0 → 0 charges (no system)
   *   ew 1 → 1 charge  (Arena: intercepts one incoming HEAT/ATGM round)
   *   ew 2 → 2 charges (Arena: two intercept attempts)
   *   ew 3 → 1 charge  (VIRSS: anti-thermal smoke, activated when targeted by thermal)
   *   ew 4 → 2 charges (VIRSS: two activations)
   *
   * See Unit Schema Spec.md §EW Value Reference for full activation rules.
   */
  ewCharges:        number;
  /** Smoke discharger salvos remaining. Decremented on DEPLOY SMOKE. */
  smokeRemaining:   number;
  /**
   * Seconds since last supply range check. The server checks every second
   * whether this unit is within 150m of a friendly supply vehicle.
   */
  supplyCheckTimer: number;
  /**
   * True if a friendly supply vehicle is within 150m, both units have
   * suppression < 40, and both are moving at 'slow' or slower.
   * When true, ammo trickles in at (startingAmmo / 180) per second per type.
   */
  isBeingResupplied: boolean;

  // ── Visibility & Detection ─────────────────────────────────────────────────
  /**
   * Per-enemy-unit detection accumulator. Keys are enemy UnitInstance.instanceId.
   * Values are detection scores (0–100). Updated every second by the sensor system.
   * This is what allows THIS unit to see enemies — it drives the per-unit
   * fire authorization gate (Spotting and Contact Model: "Combat Gate").
   */
  detectionAccumulators: Map<string, number>;
  /**
   * Camouflage modifier applied to detection accumulation rate against this unit.
   * Base 1.0. Reduced by terrain (woods: 0.7, urban: 0.8). Increased by firing (2.0 spike).
   * Updated every tick based on current state and terrain.
   */
  camouflageModifier: number;

  // ── Experience ─────────────────────────────────────────────────────────────
  /**
   * Unit experience, 0–100. Default 70 (trained). Affects weapon cooldown
   * (Formula 9) and ROF. Persists to campaign layer after mission.
   */
  experience:       number;

  // ── Timing ──────────────────────────────────────────────────────────────────
  /** Server tick when this unit was spawned into the mission. */
  spawnTick:        number;
  /** Server tick when this unit last moved (posX/posZ changed). */
  lastMoveTick:     number;
  /** Server tick when this unit was destroyed. -1 if still alive. */
  destroyedAtTick:  number;
}
```

### Supporting Types

```typescript
interface HexCoord {
  col: number;  // logical overlay grid column
  row: number;  // logical overlay grid row
}

interface Vec2 {
  x: number;    // metres east from map origin
  z: number;    // metres north from map origin
}

interface AmmoState {
  he:    number;  // remaining HE rounds
  ap:    number;  // remaining AP rounds
  heat:  number;  // remaining HEAT rounds
  sabot: number;  // remaining Sabot rounds
}

/**
 * Internal resolved order — the server's working representation.
 * Created from the client's OrderMessage after validation.
 */
interface ResolvedOrder {
  type:         OrderType;
  /** Tick when this order was accepted by the server. */
  issuedAtTick: number;
  /** Target position (for MOVE, SUPPRESS, SMOKE, CALL_ARTY, etc.). */
  targetPos:    Vec2 | null;
  /** Target contact or unit (for ENGAGE, RALLY, EMBARK, PICKUP). */
  targetId:     string | null;
  /** Weapon slot override (for ENGAGE WITH SLOT). */
  slotOverride: number | null;
  /** Bearing in degrees (for FACE order). */
  bearingDeg:   number | null;
  /** Strike/fire mission subtype (for CALL_AIR, CALL_ARTY). */
  subtype:      string | null;
}

type OrderType =
  | 'MOVE' | 'FACE' | 'REVERSE' | 'ENGAGE' | 'SUPPRESS' | 'SMOKE'
  | 'SET_POSTURE' | 'SET_MAX_RANGE' | 'DEPLOY_SMOKE' | 'ACTIVATE_EW'
  | 'CALL_ARTY' | 'CALL_AIR' | 'EMBARK' | 'DISMOUNT' | 'RALLY'
  | 'ALTITUDE' | 'LAND' | 'PICKUP' | 'INSERT' | 'ENTRENCH' | 'CANCEL';

interface QueuedWaypoint {
  pos:  Vec2;
  mode: 'advance' | 'march' | 'reverse';
}
```

---

## 2. ContactEntry — What Players See

Players never see raw `UnitInstance` data for enemy units. They see `ContactEntry` records, filtered through the detection system. The shared contact list lives on `PlayerMissionState` but is **unified across all co-op players** (Spotting and Contact Model Axiom 4: all players see the same contact picture).

Fire authorization is per-unit: a unit can only engage a target where its own `detectionAccumulators` entry for that enemy reaches >= 25 (DETECTED tier). The shared `ContactEntry` determines what is *displayed*; the per-unit accumulator determines what can be *fired upon*.

```typescript
interface ContactEntry {
  /** Stable ID for this contact. Tied to the underlying enemy instanceId but not exposed to clients. */
  contactId:          string;

  // ── Detection State ─────────────────────────────────────────────────────────
  /**
   * Current detection tier. Derived from the HIGHEST detection accumulator
   * across all friendly units observing this enemy.
   */
  detectionTier:      'suspected' | 'detected' | 'confirmed' | 'lost';
  /**
   * Peak detection value (0–100) across all friendly observers.
   * Drives tier thresholds: 1–24 SUSPECTED, 25–74 DETECTED, 75–100 CONFIRMED.
   */
  detectionValue:     number;
  /**
   * Confidence score (0.0–1.0). Normalised from detectionValue for UI display.
   * 0.0 = barely glimpsed, 1.0 = fully confirmed. Drives UI element opacity
   * and label detail.
   */
  confidence:         number;

  // ── Position ────────────────────────────────────────────────────────────────
  /**
   * Estimated position shown on the C2 display. For CONFIRMED contacts, this
   * is the true position. For SUSPECTED, offset by up to 50m in a random
   * direction (re-randomised each second while SUSPECTED).
   */
  estimatedPosX:      number;
  estimatedPosZ:      number;
  /** Last known heading in degrees. Frozen when contact enters LOST. */
  estimatedHeading:   number;

  // ── Identification ──────────────────────────────────────────────────────────
  /**
   * Broad category. Null until DETECTED tier is reached.
   * At DETECTED: reveals 'vehicle', 'infantry', or 'air'.
   * Does NOT reveal specific type (tank vs APC vs SPG).
   */
  estimatedCategory:  'vehicle' | 'infantry' | 'air' | null;
  /**
   * Specific unit type ID. Null until CONFIRMED tier is reached.
   * Once set, persists even after LOST — you remember what you identified.
   * For SUSPECTED contacts, may display as "UNKNOWN VEHICLE" or "UNKNOWN CONTACT".
   */
  estimatedTypeId:    string | null;

  // ── Timing ──────────────────────────────────────────────────────────────────
  /** Server tick when this contact was first created (any observer first glimpsed it). */
  firstDetectedTick:  number;
  /** Server tick of the most recent detection value update (position refresh). */
  lastUpdateTick:     number;
  /** Server tick when contact entered LOST state. Null if still active. */
  lostAtTick:         number | null;

  // ── Observer Attribution ────────────────────────────────────────────────────
  /**
   * instanceIds of friendly units currently observing this contact (have LOS
   * and are within effective detection range). Empty when LOST.
   * Used for fire authorization: a unit can engage only if its own instanceId
   * appears in this list AND its per-unit accumulator >= 25.
   */
  detectedBy:         string[];
}
```

### Contact Lifecycle

| Phase | Trigger | detectionValue | Tier |
|---|---|---|---|
| First glimpse | Any observer gets LOS + range | 1 | SUSPECTED |
| Building | Continuous observation | 1 -> 24 | SUSPECTED |
| Category revealed | Accumulator crosses 25 | 25 | DETECTED |
| Full identification | Accumulator crosses 75 | 75 | CONFIRMED |
| LOS broken | All observers lose LOS | Decaying at 8/sec | Current tier, dropping |
| Lost | Value reaches 0 after being >= 1 | 0 | LOST |
| Faded | 60 seconds in LOST with no re-acquisition | — | Removed from contact list |

---

## 3. PlatoonState — Group Tracking

Platoons are the organizational grouping from the battalion roster. They have no tactical AI — they exist for cohesion tracking, morale modifiers, and C2 display grouping.

```typescript
interface PlatoonState {
  /** Unique platoon ID. Matches the roster definition. */
  platoonId:        string;
  /** Display name, e.g. "1st Platoon, A Company" or "Scout Plt". */
  displayName:      string;
  /** instanceIds of all units in this platoon (alive and destroyed). */
  unitInstanceIds:  string[];
  /** instanceId of the platoon leader (typically the HQ or senior vehicle). */
  leaderId:         string;
  /** The company this platoon belongs to, for organizational display. */
  companyId:        string;

  // ── Cohesion ────────────────────────────────────────────────────────────────
  /**
   * Average distance in metres between all alive, non-embarked units in the platoon.
   * Updated every second. Used for C2 display and morale modifier.
   */
  cohesionDistanceM: number;
  /**
   * Cohesion rating derived from cohesionDistanceM.
   *   TIGHT:    avg distance < 100m (mutual support)
   *   NORMAL:   100–300m
   *   SPREAD:   300–600m (reduced mutual support)
   *   SCATTERED: > 600m (no cohesion benefit)
   */
  cohesionRating:   'tight' | 'normal' | 'spread' | 'scattered';

  // ── Morale ──────────────────────────────────────────────────────────────────
  /**
   * Platoon-level morale modifier applied to suppression decay rate for all
   * units in the platoon. Computed from cohesion and casualties.
   *
   *   cohesion TIGHT + leader alive:     1.3x decay (faster recovery)
   *   cohesion NORMAL + leader alive:    1.0x (baseline)
   *   cohesion SPREAD or leader dead:    0.8x (slower recovery)
   *   cohesion SCATTERED:                0.6x (significantly slower)
   *   50%+ platoon casualties:           additional -0.2x
   */
  moraleModifier:   number;

  // ── Status ──────────────────────────────────────────────────────────────────
  /** Count of alive units (crewCurrent > 0 and not surrendered). */
  aliveCount:       number;
  /** Count of destroyed or surrendered units. */
  casualtyCount:    number;
}
```

---

## 4. PlayerMissionState — Per-Player Session

One per connected player. Holds everything specific to a single player's participation in the mission.

```typescript
interface PlayerMissionState {
  /** Unique player ID (persistent account ID, not session-specific). */
  playerId:             string;
  /** Battalion ID from the campaign layer. References the player's persistent roster. */
  battalionId:          string;
  /** Battalion type for quick lookup of theater support allocations. */
  battalionType:        'armored' | 'mechanized' | 'motorized' | 'support' | 'droptroops';

  // ── Units ───────────────────────────────────────────────────────────────────
  /** instanceIds of all units this player owns in the mission (alive and destroyed). */
  unitInstanceIds:      string[];

  // ── Contact Picture ─────────────────────────────────────────────────────────
  /**
   * Shared contact list. All co-op players reference the same contact entries
   * (Axiom 4). This is a reference to the mission-wide contact map, not a copy.
   * Keyed by contactId.
   */
  contactList:          Map<string, ContactEntry>;

  // ── Theater Support ─────────────────────────────────────────────────────────
  /**
   * Remaining strike points for air support.
   * Initialised from: base(battalion_type) + difficulty_bonus + support_bonus.
   * Decremented when CALL AIR orders are confirmed.
   */
  strikePointsRemaining: number;
  /**
   * Remaining fire missions for off-map artillery / orbital fire.
   * Initialised from: base(battalion_type) + difficulty_bonus + support_bonus.
   * Decremented when CALL ARTY orders are confirmed.
   */
  fireMissionsRemaining: number;
  /**
   * Currently pending theater support calls (in-flight, not yet resolved).
   * Used for C2 display countdown timers and friendly-fire warnings.
   */
  pendingTheaterCalls:   PendingTheaterCall[];

  // ── Connection ──────────────────────────────────────────────────────────────
  /** True if the player's WebSocket is currently connected. */
  isConnected:          boolean;
  /** Server tick of the last received ping/message from this client. */
  lastPingTick:         number;
  /**
   * Ticks remaining in disconnect protection window.
   * Starts at DISCONNECT_GRACE_TICKS (default: 6000 = 5 minutes at 20Hz).
   * Counts down each tick while isConnected is false. At 0, units are removed
   * from the map without being counted as casualties.
   */
  disconnectGraceTicks: number;
}

interface PendingTheaterCall {
  /** 'air' or 'arty' — determines which pool was charged. */
  pool:           'air' | 'arty';
  /** Strike/mission subtype (e.g. 'fighter_bomber', 'he_concentration'). */
  subtype:        string;
  /** Target position in world space. */
  targetPos:      Vec2;
  /** Target area dimensions if applicable (for line/rectangle strikes). */
  targetArea:     { widthM: number; depthM: number } | null;
  /** Server tick when the call was confirmed. */
  calledAtTick:   number;
  /** Server tick when the strike/mission will resolve (calledAtTick + delay). */
  resolvesAtTick: number;
  /** instanceId of the unit that called it (for FO accuracy check on arty). */
  callerUnitId:   string;
}

const DISCONNECT_GRACE_TICKS = 6000; // 5 minutes at 20 Hz
```

---

## 5. MissionState — The Top-Level Container

The single root object for an active mission. Everything is reachable from here.

```typescript
interface MissionState {
  // ── Identity ────────────────────────────────────────────────────────────────
  /** Unique mission ID (UUID v4). Used for crash recovery and AAR lookup. */
  missionId:        string;
  /** Seed used to generate the procedural map. Deterministic replay requires this. */
  mapSeed:          number;
  /** Reference to the loaded terrain data (heightmap, nav mesh, terrain types). */
  terrainData:      TerrainDataRef;

  // ── Units ───────────────────────────────────────────────────────────────────
  /**
   * ALL units in the mission — friendly, enemy, destroyed, surrendered.
   * Destroyed units are never removed; they remain with isDestroyed = true.
   * Keyed by instanceId.
   */
  allUnits:         Map<string, UnitInstance>;

  // ── Players ─────────────────────────────────────────────────────────────────
  /** Per-player session state. Keyed by playerId. */
  players:          Map<string, PlayerMissionState>;

  // ── Contacts ────────────────────────────────────────────────────────────────
  /**
   * Unified contact list shared across all friendly players.
   * PlayerMissionState.contactList references this same map.
   * Keyed by contactId.
   */
  sharedContacts:   Map<string, ContactEntry>;

  // ── Time ────────────────────────────────────────────────────────────────────
  /** Current server tick counter. Monotonically increasing, starts at 0. */
  currentTick:      number;
  /** Wall-clock epoch ms when the mission started (tick 0). */
  missionStartTime: number;
  /** Mission time limit in ticks. Null for untimed missions. */
  timeLimitTicks:   number | null;

  // ── Phase ───────────────────────────────────────────────────────────────────
  /**
   * Current mission phase. Transitions are one-way (left to right).
   *   DEPLOYMENT:  Players position units on their start zones. No combat.
   *   LIVE:        Mission is active. Full simulation.
   *   EXTRACTION:  Objectives met or time expired. Units moving to extract points.
   *   ENDED:       Mission complete. No further simulation. State frozen for AAR.
   */
  missionPhase:     'deployment' | 'live' | 'extraction' | 'ended';

  // ── Enemy AI ────────────────────────────────────────────────────────────────
  /**
   * Reference to the enemy AI controller state. Opaque to this spec — defined
   * in the AI system doc. Contains enemy force goals, threat assessment,
   * reinforcement timers, and per-unit AI state.
   */
  enemyAI:          EnemyAIStateRef;

  // ── Objectives ──────────────────────────────────────────────────────────────
  /**
   * Mission objectives and their completion state. Order matters — primary
   * objectives are listed first. All primaries must be complete for mission success.
   */
  objectiveStates:  ObjectiveState[];

  // ── Event Log ───────────────────────────────────────────────────────────────
  /**
   * Chronological log of all significant events during the mission.
   * Written to during play; read post-mission for AAR replay.
   * Events are append-only — never modified or deleted.
   */
  eventLog:         MissionEvent[];

  // ── Scenario Settings ───────────────────────────────────────────────────────
  /** Optical visibility cap in metres (weather/time of day). */
  opticalVisibilityM: number;
  /** Thermal visibility cap in metres. */
  thermalVisibilityM: number;
}
```

### Supporting Types

```typescript
interface TerrainDataRef {
  /** Identifier for the loaded terrain dataset. */
  terrainId:    string;
  /** Width of the map in metres. */
  mapWidthM:    number;
  /** Depth of the map in metres. */
  mapDepthM:    number;
}

interface ObjectiveState {
  objectiveId:    string;
  description:    string;
  type:           'capture_zone' | 'destroy_target' | 'survive_duration' | 'extract_units';
  isPrimary:      boolean;
  isComplete:     boolean;
  /** Progress 0.0–1.0 for objectives that have partial completion. */
  progress:       number;
  /** World-space position of the objective marker (for zone/target types). */
  markerPos:      Vec2 | null;
}

interface MissionEvent {
  /** Server tick when the event occurred. */
  tick:           number;
  /** Event type tag for filtering and replay. */
  type:           MissionEventType;
  /** Structured payload — varies by event type. */
  data:           Record<string, unknown>;
}

type MissionEventType =
  | 'unit_spawned'
  | 'unit_destroyed'
  | 'unit_damaged'
  | 'unit_surrendered'
  | 'shot_fired'
  | 'shot_hit'
  | 'shot_missed'
  | 'era_activated'
  | 'suppression_applied'
  | 'morale_changed'
  | 'order_issued'
  | 'order_completed'
  | 'rally_attempted'
  | 'contact_created'
  | 'contact_tier_changed'
  | 'contact_lost'
  | 'theater_call_issued'
  | 'theater_call_resolved'
  | 'objective_updated'
  | 'phase_changed'
  | 'player_connected'
  | 'player_disconnected'
  | 'embark'
  | 'dismount'
  | 'altitude_changed'
  | 'entrenchment_complete'
  | 'resupply_started'
  | 'resupply_completed';

/** Opaque reference — AI system defines internals. */
type EnemyAIStateRef = unknown;
```

---

## 6. State Lifecycle

### 6.1 Mission Load: UnitInstance Creation

```
Static Data                  Battalion Roster              Runtime
┌──────────────┐            ┌──────────────────┐          ┌──────────────┐
│  UnitType    │            │  RosterEntry     │          │ UnitInstance  │
│  (read-only) │──lookup──→ │  unitTypeId      │──spawn──→│ (mutable)    │
│              │            │  platoonId       │          │              │
│              │            │  callsign        │          │              │
└──────────────┘            └──────────────────┘          └──────────────┘
```

**Spawn procedure** (per unit in the player's deployed roster):

1. Generate `instanceId` (UUID v4).
2. Look up `UnitType` by `unitTypeId` from the static registry.
3. Copy mutable fields from static data:
   - `crewCurrent = crewMax = UnitType.maxCrew`
   - `steelArmour = UnitType.steelArmour` (deep copy)
   - `heatArmour = UnitType.heatArmour` (deep copy)
   - `eraRemaining = UnitType.eraLevel` (deep copy)
   - `ewCharges` = derived from `UnitType.ew` (see EW table)
   - `smokeRemaining = UnitType.smokeDischargers`
   - `ammo[slot] = { he: weapon.ammoHE, ap: weapon.ammoAP, heat: weapon.ammoHEAT, sabot: weapon.ammoSabot }` for each weapon slot
4. Set position from deployment zone placement (posX, posZ, heading).
5. Initialise all timers to zero / -1 as appropriate.
6. Set `experience` from campaign layer (persisted per-unit, default 70).
7. Set `firePosture = 'return_fire'` (default).
8. Set `speedState = 'full_halt'`, `stoppedForSec = 10` (deployed units start halted).
9. Set `spawnTick = currentTick`, `destroyedAtTick = -1`.
10. If helicopter: set `altitudeState = 'landed'`, `altitudeTransitioning = false`.
11. Insert into `MissionState.allUnits`.
12. Add `instanceId` to the owning `PlayerMissionState.unitInstanceIds`.
13. Add `instanceId` to the appropriate `PlatoonState.unitInstanceIds`.

### 6.2 Tick-by-Tick Mutation

Each server tick (50ms), systems mutate `UnitInstance` fields in a fixed order:

| Step | System | Fields Mutated |
|---|---|---|
| 1 | Movement integration | `posX`, `posZ`, `heading`, `currentHex`, `pathIndex`, `recentDistanceM`, `lastMoveTick` |
| 2 | Movement state | `speedState`, `stoppedForSec` |
| 3 | Weapon cooldowns | `weaponCooldowns[*]` (decrement by tick delta) |
| 4 | Auto-fire check | `currentTargetId`, `lastFireTick[*]`, `ammo[*]` (on shot) |
| 5 | Projectile resolution | (target unit) `crewCurrent`, `suppressionLevel`, `eraRemaining`, `isDestroyed`, `isBailedOut`, `isImmobilized`, `steelArmour`/`heatArmour` |
| 6 | Altitude transitions | `altitudeState`, `altitudeTransitioning`, `altitudeTransitionTimer` |
| 7 | Entrenchment | `entrenchProgress`, `isEntrenched` |

Each second (every 20th tick), additional systems run:

| Step | System | Fields Mutated |
|---|---|---|
| 8 | Suppression decay | `suppressionLevel` |
| 9 | Morale check | `moraleState` |
| 10 | Sensor/detection | `detectionAccumulators`, `camouflageModifier` |
| 11 | Contact update | `ContactEntry.*` (shared contacts) |
| 12 | Resupply trickle | `ammo[*]`, `isBeingResupplied`, `supplyCheckTimer` |
| 13 | Platoon cohesion | `PlatoonState.cohesionDistanceM`, `cohesionRating`, `moraleModifier` |
| 14 | State broadcast | (no mutation — serialise and send delta) |

### 6.3 Destroyed Unit Handling

Destroyed units (`crewCurrent == 0` or explicit destruction event) are **never removed** from `MissionState.allUnits`. This is critical for:

- **AAR replay:** the event log references instanceIds that must remain resolvable.
- **Wreck rendering:** the client needs the position and type of destroyed units to render wrecks on the battlefield.
- **Suppression events:** "friendly unit destroyed within 100m" (Formula 2) requires checking recently destroyed units.
- **Post-mission accounting:** the campaign layer needs the full list of what was destroyed and when.

On destruction:
1. Set `isDestroyed = true`.
2. Set `destroyedAtTick = currentTick`.
3. Clear `currentOrder`, `orderQueue`, `currentTargetId`.
4. Set `speedState = 'full_halt'`.
5. If carrying passengers: force immediate dismount at current position.
6. If embarked in a transport: remove from transport's `passengers[]`, set `transportedBy = null`.
7. Log `unit_destroyed` event.
8. Increment `PlatoonState.casualtyCount`, decrement `aliveCount`.
9. Recalculate `PlatoonState.moraleModifier`.

### 6.4 Post-Mission Extraction

When `missionPhase` transitions to `'ended'`, the server extracts a `MissionResult` from the frozen state:

```typescript
interface MissionResult {
  missionId:          string;
  /** Was the mission successful (all primary objectives complete)? */
  success:            boolean;
  /** Duration in seconds. */
  durationSec:        number;

  /** Per-player results for campaign layer processing. */
  playerResults:      PlayerMissionResult[];

  /** Full event log for AAR replay. */
  eventLog:           MissionEvent[];
  /** Map seed for replay rendering. */
  mapSeed:            number;
}

interface PlayerMissionResult {
  playerId:           string;
  battalionId:        string;

  /** Per-unit final state, sent to the campaign layer. */
  unitResults:        UnitMissionResult[];

  /** Theater support calls made (for stats/AAR). */
  theaterCallsMade:   { pool: 'air' | 'arty'; subtype: string; tick: number }[];
}

interface UnitMissionResult {
  instanceId:         string;
  unitTypeId:         string;
  platoonId:          string;

  /** Final crew count. 0 = destroyed. */
  crewFinal:          number;
  /** Crew lost during the mission (crewMax - crewFinal for destroyed; crewStart - crewFinal for damaged). */
  crewLost:           number;
  /** Was this unit destroyed? */
  wasDestroyed:       boolean;
  /** Was this unit immobilized at mission end? */
  wasImmobilized:     boolean;

  /** Ammo remaining per slot at mission end. */
  ammoRemaining:      [AmmoState, AmmoState, AmmoState, AmmoState];
  /** Total rounds fired per slot (all types summed). */
  roundsFired:        [number, number, number, number];

  /** Experience at mission end (may have increased during mission for kills). */
  experienceFinal:    number;

  /** Kills attributed to this unit (instanceIds of destroyed enemies). */
  kills:              string[];
}
```

The campaign layer uses `UnitMissionResult` to:
- Update the persistent battalion roster (casualties, ammo expenditure).
- Flag units below 50% crew as combat ineffective.
- Award experience gains.
- Calculate supply point costs for replacements.

---

## 7. Serialization

### 7.1 State Snapshots (Crash Recovery)

The server writes a full state snapshot to persistent storage at a configurable interval (default: every 60 seconds). On crash, the server reloads the most recent snapshot and resumes from that tick.

**What is serialized:**

| Data | Included | Notes |
|---|---|---|
| `MissionState` (complete) | Yes | Full object graph |
| All `UnitInstance` fields | Yes | Including destroyed units |
| All `ContactEntry` records | Yes | Including LOST contacts |
| All `PlatoonState` records | Yes | |
| All `PlayerMissionState` records | Yes | Including pending theater calls |
| `ObjectiveState[]` | Yes | |
| `eventLog` | Yes | Full log to snapshot point |
| Enemy AI state | Yes | Opaque blob, AI system handles serialization |
| Terrain data | No | Regenerated from `mapSeed` |
| Navigation mesh | No | Regenerated from terrain |
| `detectionAccumulators` | Yes | Map<string, number> per unit |

**Format:** JSON with `Map` objects serialized as `[key, value][]` arrays. Compressed with zstd before writing to disk/Redis.

```typescript
interface StateSnapshot {
  /** Schema version for forward compatibility. */
  schemaVersion:  number;
  /** Server tick at time of snapshot. */
  tick:           number;
  /** Wall-clock epoch ms. */
  timestamp:      number;
  /** The full MissionState, serialized. */
  state:          SerializedMissionState;
}
```

### 7.2 Client State Broadcast (Fog-of-War Filtered)

The server broadcasts a `StateDelta` every second. Clients receive **only what they are allowed to see**. Enemy `UnitInstance` data is never sent — only `ContactEntry` records that have passed the detection gate.

| Data | Sent to client | Filtering |
|---|---|---|
| Friendly `UnitInstance` fields | Yes (own units) | All fields for own units |
| Allied `UnitInstance` fields | Yes (co-op partners) | All fields for allied units |
| Enemy `UnitInstance` | **Never** | Replaced by ContactEntry |
| `ContactEntry` (shared) | Yes | All contacts visible to any friendly observer |
| Own `PlayerMissionState` | Yes | Theater support counts, pending calls |
| `ObjectiveState[]` | Yes | All objectives visible |
| `MissionEvent[]` (since last broadcast) | Yes | Filtered: no enemy-internal events |
| `PlatoonState` (own) | Yes | Cohesion, morale modifier |
| `PlatoonState` (allied) | Yes | Same as own |
| Enemy AI state | **Never** | |

```typescript
interface ClientStateDelta {
  /** Server tick for ordering and interpolation. */
  tick:             number;
  /** Epoch ms. */
  timestamp:        number;
  /** Friendly/allied unit updates (only changed fields since last delta). */
  unitDeltas:       UnitDelta[];
  /** Updated contact entries (new, changed tier, position update, or removed). */
  contactDeltas:    ContactDelta[];
  /** Game events since last broadcast (shots, hits, explosions, etc.). */
  events:           MissionEvent[];
  /** Objective state changes. */
  objectiveDeltas:  ObjectiveState[];
  /** Current mission phase (if changed). */
  phase:            'deployment' | 'live' | 'extraction' | 'ended' | null;
}

interface UnitDelta {
  instanceId:   string;
  /** Only fields that changed. Partial<UnitInstance> minus server-only fields. */
  changes:      Partial<ClientUnitView>;
}

/** Fields of UnitInstance that are safe to send to the owning/allied client. */
type ClientUnitView = Omit<UnitInstance,
  | 'detectionAccumulators'  // server-only bookkeeping
  | 'supplyCheckTimer'       // internal timer
  | 'camouflageModifier'     // server-only computation
>;

interface ContactDelta {
  contactId:    string;
  /** 'update' for new/changed contacts, 'remove' for faded LOST contacts. */
  action:       'update' | 'remove';
  /** Full contact entry on update; null on remove. */
  entry:        ContactEntry | null;
}
```

**Priority events** (shots fired, explosions, rallies, air strikes) are sent immediately via the WebSocket as they occur, not batched with the 1-second delta. They are tagged `priority: true` in the wire format.

### 7.3 Post-Mission Save (Campaign Layer)

After `missionPhase` transitions to `'ended'`, the server writes:

| Data | Destination | Purpose |
|---|---|---|
| `MissionResult` | Campaign database | Update battalion rosters, casualties, experience |
| `eventLog` | AAR storage | Full replay data for after-action review |
| `mapSeed` | AAR storage | Terrain reconstruction for replay |
| Final `ObjectiveState[]` | Campaign database | Planet influence update |
| Player theater support usage | Campaign database | Stats tracking |

The raw `MissionState` is **not** persisted post-mission. Only the extracted `MissionResult` and event log survive. This keeps storage bounded.

---

## Cross-Reference: Field Origins

| UnitInstance field | Source at spawn | Mutated by |
|---|---|---|
| `instanceId` | Generated (UUID) | Never |
| `unitTypeId` | Battalion roster | Never |
| `ownerId` | Player session | Never |
| `platoonId` | Battalion roster | Never |
| `callsign` | Battalion roster | Never |
| `posX`, `posZ`, `heading` | Deployment placement | Movement system (every tick) |
| `crewCurrent` | `UnitType.maxCrew` | Damage events |
| `ammo[*]` | `UnitType.weapons[*].ammo*` | Shot fired / resupply trickle |
| `steelArmour`, `heatArmour` | `UnitType.steelArmour/heatArmour` | Rarely (spall damage) |
| `eraRemaining` | `UnitType.eraLevel` | ERA activation (Formula 6) |
| `ewCharges` | `UnitType.ew` | ACTIVATE EW order |
| `smokeRemaining` | `UnitType.smokeDischargers` | DEPLOY SMOKE order |
| `experience` | Campaign layer (default 70) | Kill events (small increments) |
| `suppressionLevel` | 0 | Incoming fire / decay |
| `firePosture` | `'return_fire'` (default) | SET POSTURE order |
| `speedState` | `'full_halt'` | Movement state system (every tick) |

---

*This document is the canonical runtime state reference. Any system that adds a new runtime field to a unit, contact, or mission must add it here. Static data definitions live in Unit Schema Spec. Combat resolution logic lives in Combat Formula Spec.*
