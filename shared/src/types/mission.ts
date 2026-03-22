// ============================================================================
// MISSION — lifecycle, deployment, difficulty profiles, objectives
// Source: MISSION_LIFECYCLE.md, MISSION_GENERATION.md, DEPLOYMENT_PHASE.md
// ============================================================================

import type {
  MissionType, DifficultyTier, MissionPhaseInternal, Vec2,
} from './core.js';

// --- Mission record (persisted) ---

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

// --- Difficulty profiles ---

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
  spMultiplier: number;       // 1.0 / 1.5 / 2.0
  influenceImpact: 'small' | 'medium' | 'large';
  secondaryObjectiveRange: [number, number];
}

// --- Deployment zone ---

export interface DeploymentZone {
  vertices: Vec2[];           // convex hull
  areaM2: number;
  centerX: number;
  centerZ: number;
}

// --- Objective definition (generated per mission) ---

export interface ObjectiveDefinition {
  objectiveId: string;
  name: string;
  type: 'capture' | 'destroy' | 'escort' | 'hold' | 'extract';
  isPrimary: boolean;
  posX: number;
  posZ: number;
  radius: number;
  captureTimeSec?: number;    // for 'capture' and 'hold' types
  targetUnitTypeId?: string;  // for 'destroy' type
}

// --- Mission generation request ---

export interface MissionGenRequest {
  planetId: string;
  difficulty: DifficultyTier;
  requestingPlayerId: string;
  battalionId: string;
}

// --- Mission archetype (one of the 10 canonical types) ---

export interface MissionArchetype {
  missionType: MissionType;
  displayName: string;
  description: string;
  objectiveTemplates: ObjectiveDefinition[];
  enemyDisposition: 'defensive' | 'offensive' | 'patrol' | 'mixed';
  hasExtractionPhase: boolean;
  timeLimitMultiplier: number;
}
