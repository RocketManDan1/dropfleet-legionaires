// ============================================================================
// INFLUENCE MAP MANAGER — strategic-layer influence maps for AI decisions
// Source: ENEMY_AI.md §3.1 — threat + control grids with Gaussian falloff
// Milestone 3 — Playable Mission (enemy AI, one faction)
//
// Performance budget: ≤ 0.6 ms per rebuild (runs every 5 s / 100 ticks)
// Grid resolution: cellSizeM = SPATIAL_HASH_CELL_SIZE (500 m)
// ============================================================================

import type {
  UnitInstance,
  Vec2,
  FactionId,
  InfluenceMapGrid,
  InfluenceMaps,
} from '@legionaires/shared';
import { SPATIAL_HASH_CELL_SIZE } from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Gaussian falloff sigma values (in metres) by unit category
// Infantry-class units have a tighter influence radius; vehicles project
// force further. These translate to grid-cell sigma at runtime.
// ---------------------------------------------------------------------------

const SIGMA_INFANTRY_M = 200;
const SIGMA_VEHICLE_M = 400;
const SIGMA_DEFAULT_M = 300;

// Threat level scores per unit category (ENEMY_AI.md §3.1.1)
const THREAT_LEVEL_VEHICLE = 8;
const THREAT_LEVEL_INFANTRY = 3;
const THREAT_LEVEL_AIR = 10;
const THREAT_LEVEL_UNKNOWN = 5;

// Control map intensity: positive for AI units, negative for player units
const CONTROL_INTENSITY_AI = 1.0;
const CONTROL_INTENSITY_PLAYER = -1.0;

// Kernel cutoff: cells beyond 3*sigma contribute negligibly; clamping avoids
// wasted iteration and keeps us inside the 0.6 ms budget.
const KERNEL_SIGMA_CUTOFF = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a world-space position (metres) to grid-cell coordinates.
 */
function worldToCell(
  worldX: number,
  worldZ: number,
  cellSizeM: number,
): [col: number, row: number] {
  return [
    Math.floor(worldX / cellSizeM),
    Math.floor(worldZ / cellSizeM),
  ];
}

/**
 * Gaussian falloff: intensity * exp(-dist^2 / (2*sigma^2))
 * Inlined as a simple exponential decay per-cell to avoid Math.exp per cell.
 * We pre-compute the coefficient once per kernel stamp.
 */
function gaussianValue(distSq: number, twoSigmaSq: number, intensity: number): number {
  return intensity * Math.exp(-distSq / twoSigmaSq);
}

/**
 * Estimate the sigma (in metres) for a given unit based on move class / crew size.
 * Infantry-scale units use a tighter sigma; vehicles and aircraft project further.
 */
function sigmaForUnit(unit: UnitInstance): number {
  // Use crewMax as a rough proxy: vehicles tend to have smaller crews (2-4)
  // relative to their firepower. Infantry squads have larger crews (6-12).
  // This avoids needing moveClass which may not be populated on all instances.
  if (unit.crewMax <= 4) {
    return SIGMA_VEHICLE_M;
  }
  return SIGMA_INFANTRY_M;
}

/**
 * Estimate threat level for an AI-observed player unit.
 * Uses crew size as a heuristic proxy for unit category when full type
 * data is not available to the AI (fog of war).
 */
function threatLevelForUnit(unit: UnitInstance): number {
  // crewMax <= 2 is likely a light vehicle or recon
  // crewMax <= 4 is likely an armoured vehicle
  // crewMax >= 8 is infantry
  if (unit.crewMax <= 4) {
    return THREAT_LEVEL_VEHICLE;
  }
  if (unit.crewMax >= 8) {
    return THREAT_LEVEL_INFANTRY;
  }
  return THREAT_LEVEL_UNKNOWN;
}

// ============================================================================
// CLASS: InfluenceMapManager
// ============================================================================

/**
 * Manages the two influence-map grids (threat and control) used by the
 * strategic AI layer.
 *
 * Usage:
 *   const mgr = new InfluenceMapManager(5000, 5000);
 *   mgr.rebuild(allUnits, aiFactionId);
 *   const values = mgr.query({ x: 2500, z: 1200 });
 *   const safest = mgr.findLowestThreat(candidatePositions);
 */
export class InfluenceMapManager {
  /** Grid cell size in metres. */
  readonly cellSizeM: number;

  /** Number of grid columns. */
  readonly gridWidth: number;

  /** Number of grid rows. */
  readonly gridHeight: number;

  /** Threat grid — how dangerous each cell is for AI units. */
  private threatGrid: Float32Array;

  /** Control grid — positive = AI dominance, negative = player dominance. */
  private controlGrid: Float32Array;

  constructor(
    mapWidthM: number,
    mapHeightM: number,
    cellSizeM: number = SPATIAL_HASH_CELL_SIZE,
  ) {
    this.cellSizeM = cellSizeM;
    this.gridWidth = Math.ceil(mapWidthM / cellSizeM);
    this.gridHeight = Math.ceil(mapHeightM / cellSizeM);

    const totalCells = this.gridWidth * this.gridHeight;
    this.threatGrid = new Float32Array(totalCells);
    this.controlGrid = new Float32Array(totalCells);
  }

  // =========================================================================
  // Rebuild — called every 5 seconds (AI_STRATEGIC_UPDATE_TICKS = 100)
  // =========================================================================

  /**
   * Rebuild both influence grids from scratch using current unit positions.
   *
   * The `units` map contains ALL units on the battlefield (player and AI).
   * `aiFactionId` determines which side gets positive control values.
   *
   * Performance: iterates units once, stamps a bounded kernel per unit.
   * For 60 units on a 10x10 grid this is well under the 0.6 ms budget.
   */
  rebuild(
    units: Map<string, UnitInstance>,
    aiFactionId: FactionId,
  ): void {
    // Zero both grids
    this.threatGrid.fill(0);
    this.controlGrid.fill(0);

    for (const [, unit] of units) {
      if (unit.isDestroyed) continue;

      const isAIUnit = unit.ownerId === aiFactionId;
      const [col, row] = worldToCell(unit.posX, unit.posZ, this.cellSizeM);

      // Determine sigma in grid cells
      const sigmaM = sigmaForUnit(unit);
      const sigmaCells = sigmaM / this.cellSizeM;
      const radiusCells = Math.ceil(sigmaCells * KERNEL_SIGMA_CUTOFF);
      const twoSigmaSq = 2 * sigmaCells * sigmaCells;

      if (isAIUnit) {
        // AI units contribute positive control only (no threat to themselves)
        this.stampKernel(this.controlGrid, col, row, radiusCells, twoSigmaSq, CONTROL_INTENSITY_AI);
      } else {
        // Player units contribute threat AND negative control
        const threat = threatLevelForUnit(unit);
        this.stampKernel(this.threatGrid, col, row, radiusCells, twoSigmaSq, threat);
        this.stampKernel(this.controlGrid, col, row, radiusCells, twoSigmaSq, CONTROL_INTENSITY_PLAYER);
      }
    }
  }

  // =========================================================================
  // Kernel stamping — Gaussian falloff around a cell
  // =========================================================================

  /**
   * Stamp a Gaussian kernel onto a grid centered at (cx, cz).
   * Bounded by `radiusCells` to keep cost proportional to kernel area,
   * not total grid size.
   */
  private stampKernel(
    grid: Float32Array,
    cx: number,
    cz: number,
    radiusCells: number,
    twoSigmaSq: number,
    intensity: number,
  ): void {
    const w = this.gridWidth;
    const h = this.gridHeight;

    // Clamp iteration bounds to grid edges
    const minRow = Math.max(0, cz - radiusCells);
    const maxRow = Math.min(h - 1, cz + radiusCells);
    const minCol = Math.max(0, cx - radiusCells);
    const maxCol = Math.min(w - 1, cx + radiusCells);

    for (let row = minRow; row <= maxRow; row++) {
      const dz = row - cz;
      const dzSq = dz * dz;
      const rowOffset = row * w;

      for (let col = minCol; col <= maxCol; col++) {
        const dx = col - cx;
        const distSq = dx * dx + dzSq;

        // Skip cells outside the circular kernel
        if (distSq > radiusCells * radiusCells) continue;

        grid[rowOffset + col] += gaussianValue(distSq, twoSigmaSq, intensity);
      }
    }
  }

  // =========================================================================
  // Point queries
  // =========================================================================

  /**
   * Query the threat and control values at a world-space position.
   * Returns { threat, control } with interpolation to the nearest cell.
   */
  query(pos: Vec2): { threat: number; control: number } {
    const [col, row] = worldToCell(pos.x, pos.z, this.cellSizeM);

    // Clamp to grid bounds
    const clampedCol = Math.max(0, Math.min(this.gridWidth - 1, col));
    const clampedRow = Math.max(0, Math.min(this.gridHeight - 1, row));
    const idx = clampedRow * this.gridWidth + clampedCol;

    return {
      threat: this.threatGrid[idx],
      control: this.controlGrid[idx],
    };
  }

  /**
   * Query threat value at a grid cell index directly (for bulk lookups).
   */
  queryThreatAtCell(col: number, row: number): number {
    if (col < 0 || col >= this.gridWidth || row < 0 || row >= this.gridHeight) {
      return 0;
    }
    return this.threatGrid[row * this.gridWidth + col];
  }

  /**
   * Query control value at a grid cell index directly.
   */
  queryControlAtCell(col: number, row: number): number {
    if (col < 0 || col >= this.gridWidth || row < 0 || row >= this.gridHeight) {
      return 0;
    }
    return this.controlGrid[row * this.gridWidth + col];
  }

  // =========================================================================
  // Tactical queries — used by strategic + platoon AI
  // =========================================================================

  /**
   * From a list of candidate positions, return the one with the lowest
   * threat value. Used by the platoon BT to pick safe approach routes
   * and by the strategic AI to choose retreat paths.
   *
   * Returns null only if `candidates` is empty.
   */
  findLowestThreat(candidates: Vec2[]): Vec2 | null {
    if (candidates.length === 0) return null;

    let bestPos = candidates[0];
    let bestThreat = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const pos = candidates[i];
      const [col, row] = worldToCell(pos.x, pos.z, this.cellSizeM);
      const clampedCol = Math.max(0, Math.min(this.gridWidth - 1, col));
      const clampedRow = Math.max(0, Math.min(this.gridHeight - 1, row));
      const threat = this.threatGrid[clampedRow * this.gridWidth + clampedCol];

      if (threat < bestThreat) {
        bestThreat = threat;
        bestPos = pos;
      }
    }

    return bestPos;
  }

  /**
   * From a list of candidate positions, return the one with the highest
   * AI control value. Used to find the strongest AI-held position for
   * reinforcement or fallback.
   *
   * Returns null only if `candidates` is empty.
   */
  findHighestControl(candidates: Vec2[]): Vec2 | null {
    if (candidates.length === 0) return null;

    let bestPos = candidates[0];
    let bestControl = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const pos = candidates[i];
      const [col, row] = worldToCell(pos.x, pos.z, this.cellSizeM);
      const clampedCol = Math.max(0, Math.min(this.gridWidth - 1, col));
      const clampedRow = Math.max(0, Math.min(this.gridHeight - 1, row));
      const control = this.controlGrid[clampedRow * this.gridWidth + clampedCol];

      if (control > bestControl) {
        bestControl = control;
        bestPos = pos;
      }
    }

    return bestPos;
  }

  /**
   * Find the lowest-threat path step from `origin` among its 8 grid
   * neighbours. Returns the neighbour cell center in world-space.
   * Used by platoon BTs for one-step threat-avoidant movement.
   */
  findLowestThreatNeighbour(origin: Vec2): Vec2 {
    const [cx, cz] = worldToCell(origin.x, origin.z, this.cellSizeM);

    let bestCol = cx;
    let bestRow = cz;
    let bestThreat = Infinity;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = cx + dx;
        const row = cz + dz;
        if (col < 0 || col >= this.gridWidth || row < 0 || row >= this.gridHeight) continue;

        const threat = this.threatGrid[row * this.gridWidth + col];
        if (threat < bestThreat) {
          bestThreat = threat;
          bestCol = col;
          bestRow = row;
        }
      }
    }

    // Return the center of the best cell in world-space
    return {
      x: (bestCol + 0.5) * this.cellSizeM,
      z: (bestRow + 0.5) * this.cellSizeM,
    };
  }

  // =========================================================================
  // Structured grid accessors (for passing to shared types)
  // =========================================================================

  /**
   * Return the full InfluenceMaps object used by the strategic and platoon
   * AI layers. The returned object shares the underlying Float32Arrays
   * (no copy) for zero-alloc reads.
   */
  getMaps(): InfluenceMaps {
    return {
      threat: {
        data: this.threatGrid,
        width: this.gridWidth,
        height: this.gridHeight,
        cellSizeM: this.cellSizeM,
      },
      control: {
        data: this.controlGrid,
        width: this.gridWidth,
        height: this.gridHeight,
        cellSizeM: this.cellSizeM,
      },
    };
  }

  /**
   * Return the raw threat grid (read-only intent — callers should not mutate).
   */
  getThreatGrid(): Float32Array {
    return this.threatGrid;
  }

  /**
   * Return the raw control grid (read-only intent).
   */
  getControlGrid(): Float32Array {
    return this.controlGrid;
  }

  /**
   * Convert a world-space Vec2 to grid cell indices.
   * Exposed for external callers that need cell-level access.
   */
  worldToCell(pos: Vec2): [col: number, row: number] {
    return worldToCell(pos.x, pos.z, this.cellSizeM);
  }
}
