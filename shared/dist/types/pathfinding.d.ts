import type { Vec2, MoveClass, SpeedState, MoveMode } from './core.js';
export interface CostGrid {
    data: Float32Array;
    width: number;
    height: number;
    cellSizeM: number;
}
export type PathStatus = 'FOUND' | 'NOT_FOUND' | 'PARTIAL';
export interface PathResult {
    status: PathStatus;
    path: Vec2[];
    rawPath: Vec2[];
    nodesExpanded: number;
    costTotal: number;
}
export interface UnitMovementState {
    currentPath: Vec2[] | null;
    pathIndex: number;
    moveMode: MoveMode;
    speedState: SpeedState;
    recentDistanceM: number;
    stoppedForSec: number;
}
export interface TerrainCostEntry {
    terrainType: string;
    track: number;
    wheel: number;
    leg: number;
    hover: number;
    air: number;
}
export interface PathRequest {
    unitId: string;
    from: Vec2;
    to: Vec2;
    moveClass: MoveClass;
    costGrid: CostGrid;
}
export interface PathfindingConfig {
    epsilon: number;
    maxOpenNodes: number;
    maxStaggerTicks: number;
    smoothingLookahead: number;
}
