// ============================================================================
// PATHFINDING — A* search, cost grids, movement integration
// Source: PATHFINDING.md, AUTHORITATIVE_CONTRACTS.md §8
// ============================================================================

import type { Vec2, MoveClass, SpeedState, MoveMode } from './core.js';

// --- Cost grid (one per MoveClass, built at mission start) ---

export interface CostGrid {
  data: Float32Array;         // row-major, width × height
  width: number;
  height: number;
  cellSizeM: number;          // metres per cell (derived from map size / grid dims)
}

// --- A* search result ---

export type PathStatus = 'FOUND' | 'NOT_FOUND' | 'PARTIAL';

export interface PathResult {
  status: PathStatus;
  path: Vec2[];               // world-space waypoints (smoothed)
  rawPath: Vec2[];            // unsmoothed grid cells
  nodesExpanded: number;
  costTotal: number;
}

// --- Movement integration state (per-unit, updated every tick) ---

export interface UnitMovementState {
  currentPath: Vec2[] | null;
  pathIndex: number;
  moveMode: MoveMode;
  speedState: SpeedState;
  recentDistanceM: number;    // rolling 10s distance for speedState calculation
  stoppedForSec: number;      // seconds fully stationary
}

// --- Queued waypoint (max 4 per unit) ---

export interface QueuedWaypoint {
  pos: Vec2;
  moveMode: MoveMode;
}

// --- Terrain cost table entry ---

export interface TerrainCostEntry {
  terrainType: string;
  track: number;
  wheel: number;
  leg: number;
  hover: number;
  air: number;
}

// --- Pathfinding request (submitted to the pathfinder) ---

export interface PathRequest {
  unitId: string;
  from: Vec2;
  to: Vec2;
  moveClass: MoveClass;
  costGrid: CostGrid;
}

// --- Pathfinding config ---

export interface PathfindingConfig {
  epsilon: number;            // A* weight (1.2 = weighted, 1.0 = optimal)
  maxOpenNodes: number;       // early-termination cap (50,000)
  maxStaggerTicks: number;    // max ticks to spread search across (3)
  smoothingLookahead: number; // greedy line-of-walk lookahead (32 cells)
}
