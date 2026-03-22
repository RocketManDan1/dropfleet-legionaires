import type { MissionType, DifficultyTier, MissionPhaseInternal, Vec2 } from './core.js';
export interface MissionRecord {
    missionId: string;
    planetId: string;
    missionType: MissionType;
    difficulty: DifficultyTier;
    state: MissionPhaseInternal;
    createdAt: number;
    startedAt: number | null;
    endedAt: number | null;
    expiresAt: number;
    result: 'victory' | 'defeat' | 'draw' | 'expired' | null;
    playerIds: string[];
    mapSeed: number;
    mapWidth: number;
    mapHeight: number;
}
export interface DifficultyProfile {
    tier: DifficultyTier;
    tunedForPlayers: number;
    maxPlayers: 4;
    enemyPlatoonRange: [number, number];
    enemyQualityWeights: {
        baseline: number;
        veteran: number;
        elite: number;
    };
    supportAssets: {
        mortars: boolean;
        artillery: boolean;
        airSupport: boolean;
    };
    timeLimitSeconds: number;
    spMultiplier: number;
    influenceImpact: 'small' | 'medium' | 'large';
    secondaryObjectiveRange: [number, number];
}
export interface DeploymentZone {
    vertices: Vec2[];
    areaM2: number;
    centerX: number;
    centerZ: number;
}
export interface ObjectiveDefinition {
    objectiveId: string;
    name: string;
    type: 'capture' | 'destroy' | 'escort' | 'hold' | 'extract';
    isPrimary: boolean;
    posX: number;
    posZ: number;
    radius: number;
    captureTimeSec?: number;
    targetUnitTypeId?: string;
}
export interface MissionGenRequest {
    planetId: string;
    difficulty: DifficultyTier;
    requestingPlayerId: string;
    battalionId: string;
}
export interface MissionArchetype {
    missionType: MissionType;
    displayName: string;
    description: string;
    objectiveTemplates: ObjectiveDefinition[];
    enemyDisposition: 'defensive' | 'offensive' | 'patrol' | 'mixed';
    hasExtractionPhase: boolean;
    timeLimitMultiplier: number;
}
