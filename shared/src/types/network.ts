// ============================================================================
// NETWORK PROTOCOL — all wire message types between client and server
// Source: NETWORK_PROTOCOL.md
// ============================================================================

import type {
  Vec2, MissionPhaseWire, FirePosture, MoveMode, MoraleState,
  ContactTier, DifficultyTier, MissionType,
} from './core.js';
import type { AmmoState, OrderType } from './unit-instance.js';

// --- Message envelope ---

export interface MessageEnvelope<T = unknown> {
  type: string;
  seq: number;        // client: monotonic 1+; server: always 0
  tick: number;       // server tick (0 for pre-mission messages)
  payload: T;
}

// ============================================================================
// CLIENT → SERVER MESSAGES
// ============================================================================

export interface AuthMessage {
  type: 'AUTH';
  payload: { token: string };
}

export interface JoinMissionMessage {
  type: 'JOIN_MISSION';
  payload: {
    missionId?: string;       // join specific mission, or omit for matchmaking
    planetId?: string;        // create new mission on this planet
    difficulty?: DifficultyTier;
    battalionId: string;
  };
}

export interface PingMessage {
  type: 'PING';
  payload: { clientTime: number };
}

export interface OrderMessage {
  type: 'ORDER';
  payload: {
    unitId: string;
    orderType: OrderType;
    targetPos?: Vec2;
    targetUnitId?: string;
    weaponSlot?: number;
    posture?: FirePosture;
    moveMode?: MoveMode;
    shift?: boolean;          // true = append to queue; false = replace
  };
}

export interface DeployUnitMessage {
  type: 'DEPLOY_UNIT';
  payload: {
    unitTypeId: string;
    posX: number;
    posZ: number;
    heading: number;
  };
}

export interface DeployReadyMessage {
  type: 'DEPLOY_READY';
  payload: Record<string, never>;
}

export interface TheaterSupportMessage {
  type: 'THEATER_SUPPORT';
  payload: {
    supportType: 'artillery' | 'air_strike' | 'orbital';
    targetPos: Vec2;
    observerUnitId?: string;  // FO providing bonus
  };
}

export interface ChatMessage {
  type: 'CHAT';
  payload: { text: string };
}

export interface DisconnectGracefulMessage {
  type: 'DISCONNECT_GRACEFUL';
  payload: Record<string, never>;
}

export type ClientMessage =
  | AuthMessage
  | JoinMissionMessage
  | PingMessage
  | OrderMessage
  | DeployUnitMessage
  | DeployReadyMessage
  | TheaterSupportMessage
  | ChatMessage
  | DisconnectGracefulMessage;

// ============================================================================
// SERVER → CLIENT MESSAGES
// ============================================================================

export interface AuthResultPayload {
  success: boolean;
  playerId?: string;
  playerName?: string;
  error?: string;
}

export interface PongPayload {
  clientTime: number;
  serverTime: number;
  serverTick: number;
}

// --- Full mission snapshot (sent on join/reconnect) ---

export interface UnitSnapshot {
  unitId: string;
  unitTypeId: string;
  ownerId: string;
  posX: number;
  posZ: number;
  heading: number;
  turretHeading?: number;
  crewCurrent: number;
  crewMax: number;
  suppression: number;
  moraleState: MoraleState;
  speedState: string;
  firePosture: FirePosture;
  ammo: AmmoState[];
  isDestroyed: boolean;
  isEntrenched: boolean;
  waypoints?: Vec2[];
  targetPos?: Vec2;
  targetId?: string;
}

export interface ContactSnapshot {
  contactId: string;
  tier: number;               // raw 0–100 accumulator value
  tierLabel: ContactTier;
  posX: number;
  posZ: number;
  unitClass?: string;
  heading?: number;
  lastSeenTick: number;
}

export interface ObjectiveSnapshot {
  objectiveId: string;
  name: string;
  type: string;
  posX: number;
  posZ: number;
  radius: number;
  status: 'incomplete' | 'complete' | 'failed';
  progress: number;
}

export interface TheaterSupportState {
  artilleryRemaining: number;
  airStrikesRemaining: number;
  orbitalRemaining: number;
  activeStrikes: Array<{
    strikeId: string;
    type: string;
    targetPos: Vec2;
    impactTick: number;
  }>;
}

export interface PlayerInfo {
  playerId: string;
  playerName: string;
  battalionName: string;
  isConnected: boolean;
  unitCount: number;
}

export interface MissionStateFullPayload {
  missionId: string;
  missionType: MissionType;
  difficulty: DifficultyTier;
  phase: MissionPhaseWire;
  missionTimeSec: number;
  timeLimitSec: number;
  mapWidth: number;
  mapHeight: number;
  units: UnitSnapshot[];
  contacts: ContactSnapshot[];
  objectives: ObjectiveSnapshot[];
  theaterSupport: TheaterSupportState;
  players: PlayerInfo[];
  score: {
    enemiesDestroyed: number;
    friendlyCasualties: number;
    objectivesCompleted: number;
    objectivesTotal: number;
  };
}

// --- Delta updates (sent every second) ---

export interface UnitDelta {
  unitId: string;
  posX?: number;
  posZ?: number;
  heading?: number;
  velocityX?: number;
  velocityZ?: number;
  hp?: number;
  suppression?: number;
  moraleState?: MoraleState;
  speedState?: string;
  ammo?: AmmoState[];
  orderState?: 'idle' | 'executing' | 'queued';
  destroyed?: boolean;
}

export interface ContactDelta {
  contactId: string;
  action: 'add' | 'update' | 'remove';
  tier?: number;
  tierLabel?: ContactTier;
  posX?: number;
  posZ?: number;
  unitClass?: string;
  heading?: number;
  lastSeenTick?: number;
}

// --- Game events (sent immediately within the tick they occur) ---

export interface ShotFiredEvent {
  type: 'shot_fired';
  firerId: string;
  targetId: string;
  weaponSlot: number;
  fromPos: Vec2;
  toPos: Vec2;
}

export interface ShotImpactEvent {
  type: 'shot_impact';
  targetId: string;
  pos: Vec2;
  penetrated: boolean;
  damage: number;
}

export interface UnitDestroyedEvent {
  type: 'unit_destroyed';
  unitId: string;
  killerUnitId: string;
  pos: Vec2;
}

export interface SuppressionEvent {
  type: 'suppression';
  unitId: string;
  newLevel: number;
  source: 'near_miss' | 'hit' | 'explosion';
}

export interface SmokeDeployedEvent {
  type: 'smoke_deployed';
  pos: Vec2;
  radius: number;
  durationSec: number;
}

export type GameEvent =
  | ShotFiredEvent
  | ShotImpactEvent
  | UnitDestroyedEvent
  | SuppressionEvent
  | SmokeDeployedEvent;

export interface TickUpdatePayload {
  tick: number;
  missionTimeSec: number;
  unitDeltas: UnitDelta[];
  contactDeltas: ContactDelta[];
  events: GameEvent[];
  score?: MissionStateFullPayload['score'];
}

// --- Order acknowledgement ---

export interface OrderAckPayload {
  orderId: string;
  unitId: string;
  status: 'ACCEPTED' | 'REJECTED';
  reason?: string;
}

// --- Phase change ---

export interface MissionPhasePayload {
  phase: MissionPhaseWire;
  missionTimeSec: number;
  message?: string;
}

// --- Deployment zone ---

export interface DeploymentZonePayload {
  vertices: Vec2[];           // convex hull of deployment zone
  timeRemainingSec: number;
  reserveSlots: number;
}

// --- After Action Report ---

export interface AARPlayerResult {
  playerId: string;
  playerName: string;
  battalionName: string;
  joinedAtSec: number;
  participationPct: number;
  unitsDeployed: number;
  unitsDestroyed: number;
  killsScored: number;
  spBase: number;
  spBonusZeroKIA: number;
  spBonusSecondary: number;
  spBonusSpeed: number;
  spTotal: number;
}

export interface AARPayload {
  missionId: string;
  result: 'victory' | 'defeat' | 'draw';
  missionType: MissionType;
  difficulty: DifficultyTier;
  durationSec: number;
  playerResults: AARPlayerResult[];
  totalEnemiesDestroyed: number;
  totalFriendlyCasualties: number;
  influenceBefore: number;
  influenceAfter: number;
}

// --- Error ---

export type ServerErrorCode =
  | 'INVALID_ORDER'
  | 'UNIT_NOT_OWNED'
  | 'UNIT_DESTROYED'
  | 'UNIT_SUPPRESSED'
  | 'UNIT_ROUTING'
  | 'OUT_OF_RANGE'
  | 'NO_AMMO'
  | 'NO_LOS'
  | 'TARGET_NOT_ACQUIRED'
  | 'WEAPON_COOLDOWN'
  | 'QUEUE_FULL'
  | 'TRANSPORT_MOVING'
  | 'AUTH_FAILED'
  | 'SESSION_FULL'
  | 'MISSION_NOT_FOUND'
  | 'PHASE_WRONG'
  | 'NOT_IN_MISSION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ErrorPayload {
  code: ServerErrorCode;
  message: string;
  refSeq?: number;            // client seq this error is in response to
}

// --- Discriminated server message union ---

export type ServerMessage =
  | { type: 'AUTH_RESULT';        payload: AuthResultPayload }
  | { type: 'PONG';              payload: PongPayload }
  | { type: 'MISSION_STATE_FULL'; payload: MissionStateFullPayload }
  | { type: 'TICK_UPDATE';       payload: TickUpdatePayload }
  | { type: 'ORDER_ACK';         payload: OrderAckPayload }
  | { type: 'MISSION_PHASE';     payload: MissionPhasePayload }
  | { type: 'DEPLOYMENT_ZONE';   payload: DeploymentZonePayload }
  | { type: 'AAR_DATA';          payload: AARPayload }
  | { type: 'ERROR';             payload: ErrorPayload }
  | { type: 'PLAYER_STATUS';     payload: PlayerInfo }
  | { type: 'CHAT_RELAY';        payload: { playerId: string; playerName: string; text: string } };
