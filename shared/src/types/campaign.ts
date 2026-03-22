// ============================================================================
// CAMPAIGN — persistent world state, planets, battalions, SP economy
// Source: CAMPAIGN_PERSISTENCE.md, BATTALION_CREATION.md, POST_MISSION_RESOLUTION.md
// ============================================================================

import type { FactionId, MissionType, DifficultyTier } from './core.js';

// --- Planet state ---

export interface PlanetRecord {
  planetId: string;
  name: string;
  systemId: string;
  sectorPositionX: number;
  sectorPositionY: number;

  influenceFederation: number; // 0–100
  influenceAtaxian: number;    // 0–100
  influenceKhroshi: number;    // 0–100
  // Sum always = 100

  controllingFaction: FactionId | null; // whichever exceeds 50%, or null
  strategicValueTier: 1 | 2 | 3;
  garrisonStrength: number;    // 0–100
  planetTraits: string[];      // JSON array of trait identifiers

  missionGenerationSeed: number;
  lastMissionGeneratedAt: number; // Unix timestamp
  connectedPlanetIds: string[];
}

// --- Influence state labels ---

export type InfluenceState = 'secure' | 'contested' | 'falling' | 'critical' | 'fallen';

// --- Battalion record ---

export type BattalionType =
  | 'armored'
  | 'mechanized'
  | 'light_infantry'
  | 'airborne'
  | 'support';

export type BattalionStatus =
  | 'available'
  | 'in_transit'
  | 'in_mission'
  | 'destroyed';

export interface BattalionRecord {
  battalionId: string;
  playerId: string;
  name: string;
  type: BattalionType;
  sectorOrigin: string;       // which sector the battalion was raised in
  status: BattalionStatus;

  currentPlanetId: string | null;
  transitDestinationId: string | null;
  transitDepartedAt: number | null;
  transitArrivesAt: number | null;

  supplyPoints: number;       // current SP balance
  missionsCompleted: number;
  missionsWon: number;

  unitSlots: UnitSlot[];      // the Order of Battle
  createdAt: number;
  lastMissionAt: number | null;
}

// --- Unit slot in OOB ---

export interface UnitSlot {
  slotId: string;
  unitTypeId: string;
  crewCurrent: number;
  crewMax: number;
  isReserve: boolean;         // flagged for reserve deployment
  upgradeTier: number;        // 0 = base, 1+ = upgraded
  status: 'active' | 'damaged' | 'destroyed' | 'combat_ineffective';
}

// --- Influence delta (applied after a mission) ---

export interface InfluenceDelta {
  planetId: string;
  enemyFaction: FactionId;
  previousInfluence: number;
  influenceReduction: number;
  newInfluence: number;
  planetLiberated: boolean;
  controlFlipped: boolean;
}

// --- SP reward calculation ---

export interface SPRewardBreakdown {
  missionType: MissionType;
  difficulty: DifficultyTier;
  outcome: string;            // MissionOutcome
  baseSP: number;
  difficultyMultiplier: number;
  scaledSP: number;
  bonusZeroKIA: number;
  bonusSecondary: number;
  bonusSpeed: number;
  totalSP: number;
  participationPct: number;
  finalSP: number;            // after participation scaling, min 10
}

// --- Player account ---

export interface PlayerAccount {
  playerId: string;
  playerName: string;
  createdAt: number;
  lastLoginAt: number;
  battalionIds: string[];
}

// --- Campaign tick state ---

export interface CampaignTickState {
  tickNumber: number;
  tickInterval: number;       // 30 minutes in ms
  lastTickAt: number;         // Unix timestamp
}
