import type { FactionId, MissionType, DifficultyTier } from './core.js';
export interface PlanetRecord {
    planetId: string;
    name: string;
    systemId: string;
    sectorPositionX: number;
    sectorPositionY: number;
    influenceFederation: number;
    influenceAtaxian: number;
    influenceKhroshi: number;
    controllingFaction: FactionId | null;
    strategicValueTier: 1 | 2 | 3;
    garrisonStrength: number;
    planetTraits: string[];
    missionGenerationSeed: number;
    lastMissionGeneratedAt: number;
    connectedPlanetIds: string[];
}
export type InfluenceState = 'secure' | 'contested' | 'falling' | 'critical' | 'fallen';
export type BattalionType = 'armored' | 'mechanized' | 'light_infantry' | 'airborne' | 'support';
export type BattalionStatus = 'available' | 'in_transit' | 'in_mission' | 'destroyed';
export interface BattalionRecord {
    battalionId: string;
    playerId: string;
    name: string;
    type: BattalionType;
    sectorOrigin: string;
    status: BattalionStatus;
    currentPlanetId: string | null;
    transitDestinationId: string | null;
    transitDepartedAt: number | null;
    transitArrivesAt: number | null;
    supplyPoints: number;
    missionsCompleted: number;
    missionsWon: number;
    unitSlots: UnitSlot[];
    createdAt: number;
    lastMissionAt: number | null;
}
export interface UnitSlot {
    slotId: string;
    unitTypeId: string;
    crewCurrent: number;
    crewMax: number;
    isReserve: boolean;
    upgradeTier: number;
    status: 'active' | 'damaged' | 'destroyed' | 'combat_ineffective';
}
export interface InfluenceDelta {
    planetId: string;
    enemyFaction: FactionId;
    previousInfluence: number;
    influenceReduction: number;
    newInfluence: number;
    planetLiberated: boolean;
    controlFlipped: boolean;
}
export interface SPRewardBreakdown {
    missionType: MissionType;
    difficulty: DifficultyTier;
    outcome: string;
    baseSP: number;
    difficultyMultiplier: number;
    scaledSP: number;
    bonusZeroKIA: number;
    bonusSecondary: number;
    bonusSpeed: number;
    totalSP: number;
    participationPct: number;
    finalSP: number;
}
export interface PlayerAccount {
    playerId: string;
    playerName: string;
    createdAt: number;
    lastLoginAt: number;
    battalionIds: string[];
}
export interface CampaignTickState {
    tickNumber: number;
    tickInterval: number;
    lastTickAt: number;
}
