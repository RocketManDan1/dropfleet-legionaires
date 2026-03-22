import type { Vec2, MoveMode, SpeedState, MoraleState, FirePosture, ContactTier, AltitudeState } from './core.js';
import type { ArmourFacings } from './unit-type.js';
export type OrderType = 'move' | 'move_fast' | 'reverse' | 'engage' | 'area_fire' | 'set_posture' | 'rally' | 'entrench' | 'mount' | 'dismount' | 'deploy_smoke' | 'cancel' | 'altitude_change' | 'hold_position' | 'retreat';
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
export interface ContactEntry {
    observedUnitId: string;
    detectionValue: number;
    detectionTier: ContactTier;
    estimatedPos: Vec2;
    estimatedCategory: string | null;
    estimatedTypeId: string | null;
    lastSeenTick: number;
    lostAt: number | null;
}
export interface AmmoState {
    he: number;
    ap: number;
    heat: number;
    sabot: number;
}
export interface UnitInstance {
    instanceId: string;
    unitTypeId: string;
    ownerId: string;
    platoonId: string;
    callsign: string;
    posX: number;
    posZ: number;
    heading: number;
    turretHeading: number | null;
    speedState: SpeedState;
    moveMode: MoveMode;
    currentPath: Vec2[] | null;
    pathIndex: number;
    recentDistanceM: number;
    stoppedForSec: number;
    currentOrder: ResolvedOrder | null;
    orderQueue: QueuedWaypoint[];
    isOrderComplete: boolean;
    crewCurrent: number;
    crewMax: number;
    isDestroyed: boolean;
    isBailedOut: boolean;
    isImmobilized: boolean;
    steelArmour: ArmourFacings;
    heatArmour: ArmourFacings;
    eraRemaining: Partial<ArmourFacings>;
    ammo: [AmmoState, AmmoState, AmmoState, AmmoState];
    weaponCooldowns: [number, number, number, number];
    lastFireTick: number;
    firedThisTick: boolean;
    firePosture: FirePosture;
    maxEngageRangeM: number;
    currentTargetId: string | null;
    engageSlotOverride: number | null;
    suppressionLevel: number;
    moraleState: MoraleState;
    lastRalliedAtTick: number;
    transportedBy: string | null;
    passengers: string[];
    altitudeState: AltitudeState | null;
    altitudeTransitioning: boolean;
    altitudeTransitionTimer: number;
    isEntrenched: boolean;
    entrenchProgress: number;
    ewCharges: number;
    smokeRemaining: number;
    supplyCheckTimer: number;
    isBeingResupplied: boolean;
    detectionAccumulators: Map<string, number>;
    experience: number;
    camouflageModifier: number;
    spawnTick: number;
    lastMoveTick: number;
    destroyedAtTick: number | null;
}
export interface PlatoonState {
    platoonId: string;
    factionId: string;
    intent: string;
    unitIds: string[];
    commandUnitId: string | null;
    isRoutingAsGroup: boolean;
}
export interface PlayerMissionState {
    playerId: string;
    playerName: string;
    battalionId: string;
    unitIds: string[];
    isConnected: boolean;
    disconnectedAtTick: number | null;
    joinedAtTick: number;
    readyForDeployment: boolean;
}
export interface MissionState {
    missionId: string;
    tick: number;
    missionTimeSec: number;
    phase: string;
    units: Map<string, UnitInstance>;
    platoons: Map<string, PlatoonState>;
    players: Map<string, PlayerMissionState>;
    contacts: Map<string, Map<string, ContactEntry>>;
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
    progress: number;
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
