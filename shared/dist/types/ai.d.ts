import type { FactionId, Vec2 } from './core.js';
export type PlatoonIntent = 'attack' | 'defend' | 'reinforce' | 'retreat' | 'patrol';
export interface InfluenceMapGrid {
    data: Float32Array;
    width: number;
    height: number;
    cellSizeM: number;
}
export interface InfluenceMaps {
    threat: InfluenceMapGrid;
    control: InfluenceMapGrid;
}
export interface FactionAIWeights {
    retreatThreshold: number;
    threatAversion: number;
    aggressionBias: number;
    defensiveTerrainBonus: number;
}
export interface StrategicDecision {
    faction: FactionId;
    assignedIntents: Map<string, PlatoonIntent>;
    reinforcementTarget: Vec2 | null;
    retreatRoute: Vec2[] | null;
}
export interface PlatoonBTContext {
    platoonId: string;
    faction: FactionId;
    intent: PlatoonIntent;
    unitIds: string[];
    commandUnitAlive: boolean;
    platoonStrengthPct: number;
    nearestThreat: Vec2 | null;
    nearestObjective: Vec2 | null;
    influenceMaps: InfluenceMaps;
}
export type BTStatus = 'success' | 'failure' | 'running';
export interface BTResult {
    status: BTStatus;
    orders: PlatoonOrder[];
}
export interface PlatoonOrder {
    unitId: string;
    orderType: string;
    targetPos?: Vec2;
    targetUnitId?: string;
}
export interface DifficultyAIConfig {
    platoonRange: [number, number];
    strategicUpdateSec: number;
    qualityWeights: {
        baseline: number;
        veteran: number;
        elite: number;
    };
}
