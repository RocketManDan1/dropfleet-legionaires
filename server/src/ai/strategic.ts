// ============================================================================
// STRATEGIC AI — faction-wide decision layer (Layer 1)
// Source: ENEMY_AI.md §3 — utility scoring + influence maps, runs every 5 s
// Milestone 3 — Playable Mission (enemy AI, one faction)
//
// Runs at: tick % AI_STRATEGIC_UPDATE_TICKS === 0 (every 100 ticks / 5 s)
// Injects at: start of Phase 2 (Command Propagation), before player orders
// Performance budget: ≤ 0.1 ms per evaluation
// ============================================================================

import type {
  UnitInstance,
  PlatoonState,
  ObjectiveState,
  Vec2,
  FactionId,
  PlatoonIntent,
  InfluenceMaps,
  FactionAIWeights,
  StrategicDecision,
} from '@legionaires/shared';
import { FACTION_AI_WEIGHTS } from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Internal scoring types
// ---------------------------------------------------------------------------

interface PlatoonObjectiveScore {
  platoonId: string;
  objectiveId: string;
  score: number;
  suggestedIntent: PlatoonIntent;
}

// ---------------------------------------------------------------------------
// Faction weight profiles (ENEMY_AI.md §3.2.2)
// Extended from the shared FACTION_AI_WEIGHTS with objective-scoring fields
// that the strategic layer needs but are not part of the shared contract.
// ---------------------------------------------------------------------------

interface FullFactionWeights extends FactionAIWeights {
  objectiveValue: number;
  distancePenalty: number;
  controlPreference: number;
  flankBonus: number;
}

const ATAXIAN_FULL_WEIGHTS: FullFactionWeights = {
  // From shared FACTION_AI_WEIGHTS
  retreatThreshold: 0.0,
  threatAversion: 2.0,
  aggressionBias: 4.0,
  defensiveTerrainBonus: 0.5,
  // Strategic-layer scoring weights
  objectiveValue: 1.0,
  distancePenalty: 0.2,
  controlPreference: -1.0,   // Negative: prefers contested/enemy-held areas
  flankBonus: 6.0,
};

const KHROSHI_FULL_WEIGHTS: FullFactionWeights = {
  // From shared FACTION_AI_WEIGHTS
  retreatThreshold: 0.4,
  threatAversion: 8.0,
  aggressionBias: 1.0,
  defensiveTerrainBonus: 5.0,
  // Strategic-layer scoring weights
  objectiveValue: 2.0,
  distancePenalty: 0.8,
  controlPreference: 3.0,    // Positive: prefers areas it already controls
  flankBonus: 0.5,
};

// Max platoons that can be assigned to a single objective by intent
const MAX_ATTACK_PLATOONS_PER_OBJECTIVE = 3;
const MAX_DEFEND_PLATOONS_PER_OBJECTIVE = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the centroid (average position) of all living units in a platoon.
 */
function computePlatoonCentroid(
  platoon: PlatoonState,
  units: Map<string, UnitInstance>,
): Vec2 {
  let sumX = 0;
  let sumZ = 0;
  let count = 0;

  for (const unitId of platoon.unitIds) {
    const unit = units.get(unitId);
    if (!unit || unit.isDestroyed) continue;
    sumX += unit.posX;
    sumZ += unit.posZ;
    count++;
  }

  if (count === 0) {
    // All units destroyed — return origin as a fallback
    return { x: 0, z: 0 };
  }

  return { x: sumX / count, z: sumZ / count };
}

/**
 * Compute platoon strength as the ratio of surviving crew to total max crew.
 * This is more granular than unit count — a platoon with wounded units reads
 * as weaker than one at full strength.
 */
function computePlatoonStrength(
  platoon: PlatoonState,
  units: Map<string, UnitInstance>,
): number {
  let currentCrew = 0;
  let maxCrew = 0;

  for (const unitId of platoon.unitIds) {
    const unit = units.get(unitId);
    if (!unit) continue;
    maxCrew += unit.crewMax;
    if (!unit.isDestroyed) {
      currentCrew += unit.crewCurrent;
    }
  }

  if (maxCrew === 0) return 0;
  return currentCrew / maxCrew;
}

/**
 * Check if the platoon's command unit (Synaptic Brood / Broadcast Node)
 * is still alive.
 */
function isCommandUnitAlive(
  platoon: PlatoonState,
  units: Map<string, UnitInstance>,
): boolean {
  if (!platoon.commandUnitId) return false;
  const cmd = units.get(platoon.commandUnitId);
  return cmd !== undefined && !cmd.isDestroyed;
}

/**
 * Euclidean distance between two Vec2 positions.
 */
function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Sample the influence map value at a world position.
 * Clamps to grid boundaries.
 */
function sampleGrid(
  grid: { data: Float32Array; width: number; height: number; cellSizeM: number },
  pos: Vec2,
): number {
  const col = Math.floor(pos.x / grid.cellSizeM);
  const row = Math.floor(pos.z / grid.cellSizeM);
  const clampedCol = Math.max(0, Math.min(grid.width - 1, col));
  const clampedRow = Math.max(0, Math.min(grid.height - 1, row));
  return grid.data[clampedRow * grid.width + clampedCol];
}

/**
 * Get the full weight profile for a faction.
 */
function getWeights(faction: FactionId): FullFactionWeights {
  if (faction === 'ataxian') return ATAXIAN_FULL_WEIGHTS;
  return KHROSHI_FULL_WEIGHTS;
}

// ============================================================================
// CLASS: StrategicAI
// ============================================================================

/**
 * The strategic AI layer. Evaluates the battlefield every 5 seconds and
 * assigns platoon intents (attack/defend/reinforce/retreat/patrol) based
 * on influence maps, objective proximity, platoon strength, and faction
 * doctrine weights.
 *
 * Usage (called from TickLoop.phaseCommandPropagation):
 *   const strat = new StrategicAI('ataxian');
 *   if (tick % AI_STRATEGIC_UPDATE_TICKS === 0) {
 *     const decision = strat.update(tick, units, platoons, objectives, influenceMaps);
 *     // Apply decision.assignedIntents to platoon states
 *   }
 */
export class StrategicAI {
  /** Which enemy faction this AI controls. */
  readonly faction: FactionId;

  /** Cached weights for this faction. */
  private readonly weights: FullFactionWeights;

  /** Last strategic decision (available for debugging / telemetry). */
  private lastDecision: StrategicDecision | null = null;

  constructor(faction: FactionId) {
    this.faction = faction;
    this.weights = getWeights(faction);
  }

  // =========================================================================
  // Main update — called every AI_STRATEGIC_UPDATE_TICKS
  // =========================================================================

  /**
   * Evaluate the current battlefield state and produce a StrategicDecision
   * containing platoon intent assignments, a reinforcement target, and
   * retreat routes for any retreating platoons.
   */
  update(
    tick: number,
    units: Map<string, UnitInstance>,
    platoons: Map<string, PlatoonState>,
    objectives: ObjectiveState[],
    influenceMaps: InfluenceMaps,
  ): StrategicDecision {
    const assignedIntents = new Map<string, PlatoonIntent>();

    // Collect only AI-owned platoons
    const aiPlatoons: PlatoonState[] = [];
    for (const [, platoon] of platoons) {
      if (platoon.factionId === this.faction) {
        aiPlatoons.push(platoon);
      }
    }

    // Filter to incomplete objectives only — no point assigning platoons to
    // objectives that are already done
    const activeObjectives = objectives.filter((o) => !o.isCompleted);

    // If there are no active objectives, all platoons default to patrol
    if (activeObjectives.length === 0) {
      for (const platoon of aiPlatoons) {
        assignedIntents.set(platoon.platoonId, 'patrol');
      }
      this.lastDecision = {
        faction: this.faction,
        assignedIntents,
        reinforcementTarget: null,
        retreatRoute: null,
      };
      return this.lastDecision;
    }

    // -----------------------------------------------------------------
    // Step 1: Score every (platoon, objective) pair
    // -----------------------------------------------------------------
    const scores: PlatoonObjectiveScore[] = [];

    for (const platoon of aiPlatoons) {
      const strength = computePlatoonStrength(platoon, units);
      const centroid = computePlatoonCentroid(platoon, units);

      // If platoon strength is below the faction's retreat threshold,
      // force retreat intent immediately — skip objective scoring.
      if (strength > 0 && strength < this.weights.retreatThreshold) {
        assignedIntents.set(platoon.platoonId, 'retreat');
        continue;
      }

      // If the platoon is completely destroyed, skip it
      if (strength === 0) {
        continue;
      }

      for (const objective of activeObjectives) {
        const objPos: Vec2 = { x: objective.posX, z: objective.posZ };
        const dist = distance(centroid, objPos);

        const threat = sampleGrid(influenceMaps.threat, objPos);
        const control = sampleGrid(influenceMaps.control, objPos);

        let score = objective.progress * this.weights.objectiveValue;
        // Higher base score for objectives with less progress (more
        // valuable to contest)
        score += (1 - objective.progress) * this.weights.objectiveValue;
        score -= dist * this.weights.distancePenalty / 1000; // Normalise distance to km
        score -= threat * this.weights.threatAversion;
        score += control * this.weights.controlPreference;
        score += strength * this.weights.aggressionBias;

        // Faction-specific modifiers (ENEMY_AI.md §3.2.1)
        if (this.faction === 'ataxian') {
          // Ataxian prefers the weakest flank — most negative control
          // means player-dominated, which is where the zerg rush hits
          if (control < -0.5) {
            score += this.weights.flankBonus;
          }
        }

        if (this.faction === 'khroshi') {
          // Khroshi prefers objectives where it already has control
          // The defensiveTerrainBonus is applied as a flat bonus when
          // the AI already holds the area (positive control)
          if (control > 0.3) {
            score += this.weights.defensiveTerrainBonus;
          }
        }

        // Determine suggested intent based on control balance at objective
        let suggestedIntent: PlatoonIntent;
        if (control >= 0.5) {
          // AI controls this area — defend it
          suggestedIntent = 'defend';
        } else if (control <= -0.3) {
          // Player controls — need to attack
          suggestedIntent = 'attack';
        } else {
          // Contested — attack to seize
          suggestedIntent = 'attack';
        }

        scores.push({
          platoonId: platoon.platoonId,
          objectiveId: objective.objectiveId,
          score,
          suggestedIntent,
        });
      }
    }

    // -----------------------------------------------------------------
    // Step 2: Greedy assignment — highest score first (ENEMY_AI.md §3.3)
    // -----------------------------------------------------------------
    scores.sort((a, b) => b.score - a.score);

    // Track how many platoons are assigned to each objective by intent
    const objectiveAttackCount = new Map<string, number>();
    const objectiveDefendCount = new Map<string, number>();
    const assignedPlatoons = new Set<string>();

    for (const entry of scores) {
      // Skip platoons that already got an intent (retreat or prior assignment)
      if (assignedIntents.has(entry.platoonId)) continue;
      if (assignedPlatoons.has(entry.platoonId)) continue;

      // Enforce per-objective caps
      const attackCount = objectiveAttackCount.get(entry.objectiveId) ?? 0;
      const defendCount = objectiveDefendCount.get(entry.objectiveId) ?? 0;

      if (entry.suggestedIntent === 'attack' && attackCount >= MAX_ATTACK_PLATOONS_PER_OBJECTIVE) {
        continue;
      }
      if (entry.suggestedIntent === 'defend' && defendCount >= MAX_DEFEND_PLATOONS_PER_OBJECTIVE) {
        continue;
      }

      // Assign
      assignedIntents.set(entry.platoonId, entry.suggestedIntent);
      assignedPlatoons.add(entry.platoonId);

      if (entry.suggestedIntent === 'attack') {
        objectiveAttackCount.set(entry.objectiveId, attackCount + 1);
      } else if (entry.suggestedIntent === 'defend') {
        objectiveDefendCount.set(entry.objectiveId, defendCount + 1);
      }
    }

    // -----------------------------------------------------------------
    // Step 3: Unassigned platoons default to patrol (ENEMY_AI.md §3.3)
    // -----------------------------------------------------------------
    for (const platoon of aiPlatoons) {
      if (!assignedIntents.has(platoon.platoonId)) {
        assignedIntents.set(platoon.platoonId, 'patrol');
      }
    }

    // -----------------------------------------------------------------
    // Step 4: Select reinforcement target — lowest-control objective
    // The strategic AI picks the objective where AI control is weakest
    // so reinforcements go where they are needed most.
    // -----------------------------------------------------------------
    const reinforcementTarget = this.selectReinforcementTarget(
      activeObjectives,
      influenceMaps,
    );

    // -----------------------------------------------------------------
    // Step 5: Build retreat route for any retreating platoons
    // Route goes from platoon centroid away from highest threat,
    // stepping through lowest-threat neighbours.
    // -----------------------------------------------------------------
    const retreatingPlatoons = aiPlatoons.filter(
      (p) => assignedIntents.get(p.platoonId) === 'retreat',
    );

    let retreatRoute: Vec2[] | null = null;
    if (retreatingPlatoons.length > 0) {
      // Build a shared retreat route from the centroid of all retreating
      // platoons toward the lowest-threat map edge
      retreatRoute = this.buildRetreatRoute(
        retreatingPlatoons,
        units,
        influenceMaps,
      );
    }

    // -----------------------------------------------------------------
    // Cache and return
    // -----------------------------------------------------------------
    this.lastDecision = {
      faction: this.faction,
      assignedIntents,
      reinforcementTarget,
      retreatRoute,
    };

    return this.lastDecision;
  }

  // =========================================================================
  // Reinforcement target selection
  // =========================================================================

  /**
   * Find the objective with the lowest AI control value — this is where
   * the AI is weakest and reinforcements should be directed.
   *
   * Returns the objective position as a Vec2, or null if there are no
   * active objectives.
   */
  private selectReinforcementTarget(
    objectives: ObjectiveState[],
    influenceMaps: InfluenceMaps,
  ): Vec2 | null {
    if (objectives.length === 0) return null;

    let lowestControl = Infinity;
    let target: Vec2 | null = null;

    for (const obj of objectives) {
      const pos: Vec2 = { x: obj.posX, z: obj.posZ };
      const control = sampleGrid(influenceMaps.control, pos);

      if (control < lowestControl) {
        lowestControl = control;
        target = pos;
      }
    }

    return target;
  }

  // =========================================================================
  // Retreat route building
  // =========================================================================

  /**
   * Build a retreat route by stepping away from the highest-threat direction.
   * The route is a series of waypoints (up to 5) from the retreating platoons'
   * average centroid toward the map edge with the lowest threat.
   *
   * This is a simple greedy approach: at each step, pick the 8-neighbour grid
   * cell with the lowest threat value and move there.
   */
  private buildRetreatRoute(
    retreatingPlatoons: PlatoonState[],
    units: Map<string, UnitInstance>,
    influenceMaps: InfluenceMaps,
  ): Vec2[] {
    // Compute average centroid of all retreating platoons
    let totalX = 0;
    let totalZ = 0;
    let count = 0;

    for (const platoon of retreatingPlatoons) {
      const centroid = computePlatoonCentroid(platoon, units);
      if (centroid.x !== 0 || centroid.z !== 0) {
        totalX += centroid.x;
        totalZ += centroid.z;
        count++;
      }
    }

    if (count === 0) return [];

    const startPos: Vec2 = { x: totalX / count, z: totalZ / count };
    const route: Vec2[] = [startPos];

    const grid = influenceMaps.threat;
    const cellSize = grid.cellSizeM;
    const gridW = grid.width;
    const gridH = grid.height;

    let currentCol = Math.floor(startPos.x / cellSize);
    let currentRow = Math.floor(startPos.z / cellSize);

    // Greedily step toward lowest-threat neighbours (max 5 steps)
    const MAX_RETREAT_STEPS = 5;
    for (let step = 0; step < MAX_RETREAT_STEPS; step++) {
      let bestCol = currentCol;
      let bestRow = currentRow;
      let bestThreat = Infinity;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nc = currentCol + dx;
          const nr = currentRow + dz;
          if (nc < 0 || nc >= gridW || nr < 0 || nr >= gridH) {
            // Map edge — treat as zero threat (escape)
            bestCol = nc;
            bestRow = nr;
            bestThreat = -1;
            continue;
          }

          const threat = grid.data[nr * gridW + nc];
          if (threat < bestThreat) {
            bestThreat = threat;
            bestCol = nc;
            bestRow = nr;
          }
        }
      }

      // If we didn't move (stuck or at edge), stop building the route
      if (bestCol === currentCol && bestRow === currentRow) break;

      currentCol = bestCol;
      currentRow = bestRow;

      route.push({
        x: (currentCol + 0.5) * cellSize,
        z: (currentRow + 0.5) * cellSize,
      });

      // If we reached the map edge, stop
      if (currentCol <= 0 || currentCol >= gridW - 1 ||
          currentRow <= 0 || currentRow >= gridH - 1) {
        break;
      }
    }

    return route;
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  /**
   * Return the last computed strategic decision (for debugging / telemetry).
   */
  getLastDecision(): StrategicDecision | null {
    return this.lastDecision;
  }

  /**
   * Return the faction's retreat threshold for external queries.
   */
  getRetreatThreshold(): number {
    return this.weights.retreatThreshold;
  }
}
