// ============================================================================
// UNIT INSTANCE — mutable runtime state for a single unit on the battlefield
// Source: RUNTIME_UNIT_STATE.md (~50 fields)
// ============================================================================

import type {
  Vec2, MoveMode, SpeedState, MoraleState, FirePosture,
  ContactTier, AltitudeState,
} from './core.js';
import type { ArmourFacings } from './unit-type.js';

// --- Order types ---

export type OrderType =
  | 'move'
  | 'move_fast'
  | 'reverse'
  | 'engage'
  | 'area_fire'
  | 'set_posture'
  | 'rally'
  | 'entrench'
  | 'mount'
  | 'dismount'
  | 'deploy_smoke'
  | 'cancel'
  | 'altitude_change'
  | 'hold_position'
  | 'retreat';

export interface ResolvedOrder {
  type: OrderType;
  targetPos?: Vec2;
  targetUnitId?: string;
  weaponSlot?: number;
  posture?: FirePosture;
  moveMode?: MoveMode;
}

export interface QueuedWaypoint {
  pos: Vec2;
  moveMode: MoveMode;
}

// --- Contact entry (per-observer detection of an enemy unit) ---

export interface ContactEntry {
  observedUnitId: string;
  detectionValue: number;     // 0–100 raw accumulator
  detectionTier: ContactTier;
  estimatedPos: Vec2;         // jittered ±50m at SUSPECTED, exact at DETECTED+
  estimatedCategory: string | null;  // known if DETECTED+
  estimatedTypeId: string | null;    // known if CONFIRMED
  lastSeenTick: number;
  lostAt: number | null;      // tick when contact entered LOST state
}

// --- Per-weapon ammo state ---

export interface AmmoState {
  he: number;
  ap: number;
  heat: number;
  sabot: number;
}

// --- The big one: runtime state for every unit on the map ---

export interface UnitInstance {
  // --- Identity ---
  instanceId: string;         // UUID, unique per spawned unit
  unitTypeId: string;         // references UnitType.id
  ownerId: string;            // player ID who owns this unit
  platoonId: string;          // which platoon this unit belongs to
  callsign: string;           // display name (e.g. "Alpha 1-1")

  // --- Position & heading ---
  posX: number;               // metres from map origin
  posZ: number;               // metres from map origin (Z = forward in Three.js)
  heading: number;            // degrees, 0 = north, clockwise
  turretHeading: number | null; // null for units without turrets

  // --- Movement ---
  speedState: SpeedState;
  moveMode: MoveMode;
  currentPath: Vec2[] | null; // active A* path waypoints
  pathIndex: number;          // index into currentPath
  recentDistanceM: number;    // distance moved in rolling 10s window (for speedState)
  stoppedForSec: number;      // seconds stationary (for full_halt detection)

  // --- Orders ---
  currentOrder: ResolvedOrder | null;
  orderQueue: QueuedWaypoint[];  // max 4
  isOrderComplete: boolean;

  // --- Health ---
  crewCurrent: number;        // remaining crew/strength (0 = destroyed)
  crewMax: number;            // max crew (from UnitType.maxCrew)
  isDestroyed: boolean;
  isBailedOut: boolean;
  isImmobilized: boolean;

  // --- Armour (mutable copies from UnitType, decremented by ERA depletion) ---
  steelArmour: ArmourFacings;
  heatArmour: ArmourFacings;
  eraRemaining: Partial<ArmourFacings>;

  // --- Weapons ---
  ammo: [AmmoState, AmmoState, AmmoState, AmmoState]; // per-slot
  weaponCooldowns: [number, number, number, number];   // ticks remaining per slot
  lastFireTick: number;
  firedThisTick: boolean;     // for size-0 detection cap

  // --- Fire control ---
  firePosture: FirePosture;
  maxEngageRangeM: number;    // player-set max engage range (default = weapon max)
  currentTargetId: string | null;
  engageSlotOverride: number | null; // force a specific weapon slot

  // --- Suppression & morale ---
  suppressionLevel: number;   // 0–100
  moraleState: MoraleState;
  lastRalliedAtTick: number;  // 15-second cooldown between rally attempts

  // --- Transport ---
  transportedBy: string | null; // instanceId of transport carrying this unit
  passengers: string[];         // instanceIds of units inside this transport

  // --- Helicopter ---
  altitudeState: AltitudeState | null; // null for ground units
  altitudeTransitioning: boolean;
  altitudeTransitionTimer: number;     // seconds remaining in transition

  // --- Entrenchment ---
  isEntrenched: boolean;
  entrenchProgress: number;   // 0–120 seconds to full entrenchment

  // --- Supply ---
  ewCharges: number;          // Arena/VIRSS charges remaining
  smokeRemaining: number;     // smoke discharger salvos remaining
  supplyCheckTimer: number;   // seconds since last supply range check
  isBeingResupplied: boolean;

  // --- Detection (this unit as observer) ---
  detectionAccumulators: Map<string, number>; // targetUnitId → accumulator value

  // --- Experience ---
  experience: number;         // 0–100, default 70

  // --- Camouflage ---
  camouflageModifier: number; // multiplier on detection rate (1.0 = normal)

  // --- Timing ---
  spawnTick: number;
  lastMoveTick: number;
  destroyedAtTick: number | null;
}

// --- Platoon grouping ---

export interface PlatoonState {
  platoonId: string;
  factionId: string;
  intent: string;             // PlatoonIntent from AI layer
  unitIds: string[];
  commandUnitId: string | null;
  isRoutingAsGroup: boolean;
}

// --- Per-player state within a mission ---

export interface PlayerMissionState {
  playerId: string;
  playerName: string;
  battalionId: string;
  unitIds: string[];          // instanceIds of all player units
  isConnected: boolean;
  disconnectedAtTick: number | null;
  joinedAtTick: number;
  readyForDeployment: boolean;
}

// --- Root mission state container ---

export interface MissionState {
  missionId: string;
  tick: number;
  missionTimeSec: number;
  phase: string;              // MissionPhaseInternal
  units: Map<string, UnitInstance>;
  platoons: Map<string, PlatoonState>;
  players: Map<string, PlayerMissionState>;
  contacts: Map<string, Map<string, ContactEntry>>; // playerId → unitId → contact
  objectives: ObjectiveState[];
  mapEffects: MapEffect[];
  score: ScoreState;
}

export interface ObjectiveState {
  objectiveId: string;
  name: string;
  type: 'capture' | 'destroy' | 'escort' | 'hold' | 'extract';
  posX: number;
  posZ: number;
  radius: number;
  isCompleted: boolean;
  completedAtTick: number | null;
  progress: number;           // 0–100 for gradual objectives
}

export interface MapEffect {
  effectId: string;
  type: 'smoke' | 'fire' | 'crater';
  posX: number;
  posZ: number;
  radius: number;
  createdAtTick: number;
  expiresAtTick: number;
}

export interface ScoreState {
  enemiesDestroyed: number;
  friendlyCasualties: number;
  objectivesCompleted: number;
  objectivesTotal: number;
  missionOutcome: string | null;
}
