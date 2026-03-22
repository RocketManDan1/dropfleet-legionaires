// ============================================================================
// ENEMY AI — strategic, platoon, and unit-level AI types
// Source: ENEMY_AI.md, AUTHORITATIVE_CONTRACTS.md §10
// ============================================================================

import type { FactionId, Vec2 } from './core.js';

// --- AI architecture layers ---

export type PlatoonIntent = 'attack' | 'defend' | 'reinforce' | 'retreat' | 'patrol';

// --- Influence maps (strategic layer) ---

export interface InfluenceMapGrid {
  data: Float32Array;         // row-major, same resolution as cost grid
  width: number;
  height: number;
  cellSizeM: number;
}

export interface InfluenceMaps {
  threat: InfluenceMapGrid;   // player-force threat
  control: InfluenceMapGrid;  // AI force presence
}

// --- Faction AI weights ---

export interface FactionAIWeights {
  retreatThreshold: number;   // 0.0 = never, 0.4 = khroshi default
  threatAversion: number;     // how much AI avoids high-threat areas
  aggressionBias: number;     // how much AI prioritises attack
  defensiveTerrainBonus: number; // bonus for holding defensive terrain
}

// --- Strategic decision output ---

export interface StrategicDecision {
  faction: FactionId;
  assignedIntents: Map<string, PlatoonIntent>; // platoonId → intent
  reinforcementTarget: Vec2 | null;
  retreatRoute: Vec2[] | null;
}

// --- Platoon behavior tree context ---

export interface PlatoonBTContext {
  platoonId: string;
  faction: FactionId;
  intent: PlatoonIntent;
  unitIds: string[];
  commandUnitAlive: boolean;
  platoonStrengthPct: number; // 0–1
  nearestThreat: Vec2 | null;
  nearestObjective: Vec2 | null;
  influenceMaps: InfluenceMaps;
}

// --- BT node result ---

export type BTStatus = 'success' | 'failure' | 'running';

export interface BTResult {
  status: BTStatus;
  orders: PlatoonOrder[];     // orders to issue to units
}

export interface PlatoonOrder {
  unitId: string;
  orderType: string;          // maps to OrderType
  targetPos?: Vec2;
  targetUnitId?: string;
}

// --- Difficulty scaling ---

export interface DifficultyAIConfig {
  platoonRange: [number, number]; // e.g. [2,3] for easy
  strategicUpdateSec: number;     // 10s easy, 5s medium, 3s hard
  qualityWeights: {
    baseline: number;
    veteran: number;
    elite: number;
  };
}
