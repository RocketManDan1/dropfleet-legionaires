// ============================================================================
// SP ECONOMY — Supply Point reward calculation
// Milestone 5: Campaign
// Source: POST_MISSION_RESOLUTION.md, AUTHORITATIVE_CONTRACTS.md
// ============================================================================

import type {
  MissionType,
  DifficultyTier,
  MissionOutcome,
  SPRewardBreakdown,
} from '@legionaires/shared';

import {
  SP_MINIMUM_FLOOR,
  SP_DIFFICULTY_MULTIPLIERS,
  SP_BONUS_ZERO_KIA,
  SP_BONUS_SECONDARY,
  SP_BONUS_SPEED,
  SP_BASE_TABLE,
  SP_MIN_COMBAT_TIME_SEC,
} from '@legionaires/shared/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input bonuses determined by mission performance. */
export interface SPBonuses {
  /** True if the player suffered zero KIA during the mission. */
  zeroKIA: boolean;
  /** True if all secondary objectives were completed. */
  allSecondaryComplete: boolean;
  /** True if the mission was completed under the speed threshold. */
  speedBonus: boolean;
}

/**
 * Replacement cost lookup table.
 * Maps unitTypeId → SP cost to fully replace a destroyed unit.
 * Loaded from the unit CSV data at startup.
 */
export interface ReplacementCostTable {
  /** Look up the SP cost to replace a unit type. */
  getCost(unitTypeId: string): number;
}

/**
 * Per-crew replacement cost.
 * The cost to restore one crew member is:
 *   floor(unitFullCost / crewMax)
 * So restoring 3 crew on a unit that costs 200 SP with crewMax 4:
 *   floor(200/4) * 3 = 150 SP
 */
export function calculateCrewReplacementCost(
  unitFullCost: number,
  crewMax: number,
  crewToRestore: number,
): number {
  if (crewMax <= 0) return 0;
  const perCrewCost = Math.floor(unitFullCost / crewMax);
  return perCrewCost * crewToRestore;
}

// ---------------------------------------------------------------------------
// Main reward calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the SP reward for a player after a mission.
 *
 * Formula (from AUTHORITATIVE_CONTRACTS.md):
 *
 *   baseSP = SP_BASE_TABLE[missionType][outcome]
 *   scaledSP = baseSP * SP_DIFFICULTY_MULTIPLIERS[difficulty]
 *   totalSP = scaledSP + bonuses
 *   finalSP = max(SP_MINIMUM_FLOOR, floor(totalSP * participationPct))
 *
 * Bonuses:
 *   - Zero KIA:         +100 SP (if no friendly units destroyed)
 *   - All secondaries:  +150 SP (if all secondary objectives completed)
 *   - Speed:            +50 SP  (if mission completed quickly)
 *
 * Participation scaling:
 *   - Players who join late receive a proportional share based on the
 *     fraction of mission time they were present.
 *   - participationPct = timePresent / totalMissionTime, clamped to [0, 1].
 *   - The result is always at least SP_MINIMUM_FLOOR (10 SP).
 *
 * @param missionType      - One of the 10 canonical mission types.
 * @param difficulty       - easy / medium / hard.
 * @param outcome          - victory / defeat / draw.
 * @param bonuses          - Performance bonuses earned during the mission.
 * @param participationPct - Fraction of mission time the player was present (0–1).
 * @returns Complete SP reward breakdown with all intermediate values.
 */
export function calculateSPReward(
  missionType: MissionType,
  difficulty: DifficultyTier,
  outcome: MissionOutcome,
  bonuses: SPBonuses,
  participationPct: number,
): SPRewardBreakdown {
  // --- Step 1: Look up base SP from the canonical table ---
  const baseEntry = SP_BASE_TABLE[missionType];
  if (!baseEntry) {
    throw new Error(`Unknown mission type in SP table: ${missionType}`);
  }
  const baseSP = baseEntry[outcome];

  // --- Step 2: Apply difficulty multiplier ---
  const difficultyMultiplier = SP_DIFFICULTY_MULTIPLIERS[difficulty];
  const scaledSP = Math.floor(baseSP * difficultyMultiplier);

  // --- Step 3: Calculate bonuses ---
  // Bonuses only apply on victory (defeats/draws don't get bonus SP)
  const bonusZeroKIA = (outcome === 'victory' && bonuses.zeroKIA) ? SP_BONUS_ZERO_KIA : 0;
  const bonusSecondary = (outcome === 'victory' && bonuses.allSecondaryComplete) ? SP_BONUS_SECONDARY : 0;
  const bonusSpeed = (outcome === 'victory' && bonuses.speedBonus) ? SP_BONUS_SPEED : 0;

  // --- Step 4: Sum total before participation scaling ---
  const totalSP = scaledSP + bonusZeroKIA + bonusSecondary + bonusSpeed;

  // --- Step 5: Apply participation scaling ---
  const clampedParticipation = Math.max(0, Math.min(1, participationPct));
  const participationScaled = Math.floor(totalSP * clampedParticipation);

  // --- Step 6: Enforce minimum floor ---
  const finalSP = Math.max(SP_MINIMUM_FLOOR, participationScaled);

  return {
    missionType,
    difficulty,
    outcome,
    baseSP,
    difficultyMultiplier,
    scaledSP,
    bonusZeroKIA,
    bonusSecondary,
    bonusSpeed,
    totalSP,
    participationPct: clampedParticipation,
    finalSP,
  };
}

// ---------------------------------------------------------------------------
// Batch calculation for all players in a mission
// ---------------------------------------------------------------------------

/** Input for a single player's reward calculation. */
export interface PlayerRewardInput {
  playerId: string;
  /** Time in seconds the player was present in the mission. */
  timeInMissionSec: number;
  /** Total mission duration in seconds. */
  totalMissionDurationSec: number;
  /** Whether this player had zero friendly KIA. */
  zeroKIA: boolean;
  /** Whether all secondary objectives were completed (shared across team). */
  allSecondaryComplete: boolean;
  /** Whether the mission was completed under the speed threshold (shared). */
  speedBonus: boolean;
}

/** Output for a single player's reward. */
export interface PlayerRewardResult {
  playerId: string;
  breakdown: SPRewardBreakdown;
}

/**
 * Calculate SP rewards for all players in a completed mission.
 *
 * @param missionType - The mission type.
 * @param difficulty  - The difficulty tier.
 * @param outcome     - The mission outcome.
 * @param players     - Per-player input data.
 * @returns Array of per-player reward results.
 */
export function calculateAllPlayerRewards(
  missionType: MissionType,
  difficulty: DifficultyTier,
  outcome: MissionOutcome,
  players: PlayerRewardInput[],
): PlayerRewardResult[] {
  return players.map(player => {
    // Calculate participation percentage
    let participationPct = 1.0;
    if (player.totalMissionDurationSec > 0) {
      participationPct = player.timeInMissionSec / player.totalMissionDurationSec;
    }

    // Players who were present for less than SP_MIN_COMBAT_TIME_SEC
    // get zero reward (prevents join-and-leave abuse)
    if (player.timeInMissionSec < SP_MIN_COMBAT_TIME_SEC) {
      return {
        playerId: player.playerId,
        breakdown: {
          missionType,
          difficulty,
          outcome,
          baseSP: 0,
          difficultyMultiplier: 0,
          scaledSP: 0,
          bonusZeroKIA: 0,
          bonusSecondary: 0,
          bonusSpeed: 0,
          totalSP: 0,
          participationPct: 0,
          finalSP: 0,
        },
      };
    }

    const bonuses: SPBonuses = {
      zeroKIA: player.zeroKIA,
      allSecondaryComplete: player.allSecondaryComplete,
      speedBonus: player.speedBonus,
    };

    return {
      playerId: player.playerId,
      breakdown: calculateSPReward(missionType, difficulty, outcome, bonuses, participationPct),
    };
  });
}
