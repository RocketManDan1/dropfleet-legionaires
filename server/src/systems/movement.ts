// ============================================================================
// MOVEMENT RESOLUTION — Phase 3 of the tick loop
// Source: SERVER_GAME_LOOP.md §1, PATHFINDING.md, Game Systems Overview.md
// Runs every tick (50 ms). Integrates unit positions along their active path.
// Milestone 2 scaffold
// ============================================================================

import type {
  UnitInstance,
  Vec2,
  SpeedState,
  MoveMode,
  CostGrid,
  MoveClass,
} from '@legionaires/shared';
import {
  MOVE_MULT_MARCH,
  MOVE_MULT_ADVANCE,
  MOVE_MULT_REVERSE,
  TICKS_PER_SEC,
} from '@legionaires/shared';

import type { TerrainData } from '../game/session.js';
import type { UnitRegistry } from '../data/unit-registry.js';

// ---------------------------------------------------------------------------
// Movement mode multiplier lookup
// ---------------------------------------------------------------------------

const MODE_MULTIPLIERS: Record<MoveMode, number> = {
  march: MOVE_MULT_MARCH,       // 1.0
  advance: MOVE_MULT_ADVANCE,   // 0.5
  reverse: MOVE_MULT_REVERSE,   // 0.33
};

// ---------------------------------------------------------------------------
// Speed state classification — 10-second rolling window
// ---------------------------------------------------------------------------

/** Distance thresholds for speed state classification (metres in 10 seconds). */
const SPEED_THRESHOLD_FAST = 50;   // > 50m in 10s = fast
const SPEED_THRESHOLD_SLOW = 5;    // > 5m in 10s = slow
const SHORT_HALT_THRESHOLD_SEC = 2; // stopped 2-10s = short_halt
const FULL_HALT_THRESHOLD_SEC = 10; // stopped 10s+ = full_halt

/**
 * Classify the speed state based on the 10-second rolling distance and
 * how long the unit has been stationary. This drives to-hit modifiers
 * (Combat Formula Spec §1) and spotting signature (Spotting and Contact Model).
 */
function classifySpeedState(recentDistanceM: number, stoppedForSec: number): SpeedState {
  if (recentDistanceM > SPEED_THRESHOLD_FAST) return 'fast';
  if (recentDistanceM > SPEED_THRESHOLD_SLOW) return 'slow';
  if (stoppedForSec >= FULL_HALT_THRESHOLD_SEC) return 'full_halt';
  return 'short_halt';
}

// ---------------------------------------------------------------------------
// Core movement integration
// ---------------------------------------------------------------------------

/**
 * Compute the effective speed for a unit at its current position.
 *
 * Formula from PATHFINDING.md:
 *   effectiveSpeed = (maxSpeedM / 300) * modeMultiplier / cellCost
 *
 * - maxSpeedM is the UnitType's max speed (CSV Speed × 50 / 300, already
 *   stored as metres/sec in UnitType.maxSpeedM)
 * - modeMultiplier: march=1.0, advance=0.5, reverse=0.33
 * - cellCost: terrain cost at unit position from the MoveClass cost grid
 *
 * @param maxSpeedM   Unit's base max speed in m/s (from UnitType)
 * @param moveMode    Current movement mode
 * @param cellCost    Terrain cost multiplier at unit position (1.0 = road)
 * @returns Speed in metres per second
 */
function effectiveSpeed(
  maxSpeedM: number,
  moveMode: MoveMode,
  cellCost: number,
): number {
  const modeMultiplier = MODE_MULTIPLIERS[moveMode] ?? MOVE_MULT_ADVANCE;

  // Avoid division by zero for impassable terrain
  const safeCost = Math.max(cellCost, 0.01);

  return maxSpeedM * modeMultiplier / safeCost;
}

/**
 * Compute the bearing (heading) in degrees from one point toward another.
 * 0 = north (+Z), 90 = east (+X), 180 = south, 270 = west.
 * Matches the heading convention used by UnitInstance.heading.
 */
function bearingToward(from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  // atan2(dx, dz) gives angle from +Z axis (north)
  const radians = Math.atan2(dx, dz);
  return ((radians * 180) / Math.PI + 360) % 360;
}

/**
 * Distance between two points in metres.
 */
function distanceBetween(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ---------------------------------------------------------------------------
// Terrain cost lookup helper
// ---------------------------------------------------------------------------

/**
 * Look up the terrain cost at a world position for a given move class.
 * Returns 1.0 (road/open) if no cost grid is available.
 *
 * @param costGrids  Map of MoveClass -> CostGrid
 * @param moveClass  The unit's move class
 * @param x          World X position (metres)
 * @param z          World Z position (metres)
 */
function getTerrainCost(
  costGrids: Map<MoveClass, CostGrid> | null,
  moveClass: MoveClass,
  x: number,
  z: number,
): number {
  if (!costGrids) return 1.0;

  const grid = costGrids.get(moveClass);
  if (!grid) return 1.0;

  const col = Math.floor(x / grid.cellSizeM);
  const row = Math.floor(z / grid.cellSizeM);

  // Bounds check
  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return 1.0;

  return grid.data[row * grid.width + col];
}

// ============================================================================
// EXPORTED: resolveMovement
// ============================================================================

/**
 * Phase 3: Movement Resolution.
 * Runs every tick. Integrates unit positions along their active path.
 *
 * For each alive, non-frozen unit with a currentPath:
 *   1. Compute effective speed at current position
 *   2. Move toward the next waypoint
 *   3. If waypoint reached, advance pathIndex; if path exhausted, check orderQueue
 *   4. Update heading toward waypoint
 *   5. Update recentDistanceM (rolling 10s window) and stoppedForSec
 *   6. Classify speedState
 *
 * Routing units auto-retreat toward the friendly edge at 50% maxSpeedM
 * (see ENEMY_AI.md §5.3).
 *
 * @param units      The session unit registry (mutated in-place)
 * @param dt         Delta time in seconds (0.05 for 20 Hz)
 * @param terrain    Terrain data (heightmap, etc.)
 * @param costGrids  Cost grids keyed by MoveClass (built at mission start)
 */
export function resolveMovement(
  units: Map<string, UnitInstance>,
  dt: number,
  terrain: TerrainData,
  costGrids: Map<MoveClass, CostGrid> | null,
  unitTypes?: UnitRegistry | null,
  currentTick?: number,
): void {
  const tick = currentTick ?? 0;

  for (const [unitId, unit] of units) {
    // Skip dead, surrendered, or frozen units
    if (unit.isDestroyed) continue;
    if (unit.moraleState === 'surrendered') continue;
    // Skip frozen (disconnected player) units — indicated by a freeze timestamp
    if ((unit as any).frozenAtTick != null) continue;

    // --- Routing units: override path to retreat toward friendly edge ---
    if (unit.moraleState === 'routing') {
      // If no retreat path set, give the unit a straight-line retreat toward
      // the nearest map edge at 50% maxSpeedM (ENEMY_AI.md §5.3).
      if (!unit.currentPath || unit.currentPath.length === 0) {
        const mapW = terrain.width;
        const mapH = terrain.height;
        // Pick the nearest edge center as retreat target
        const edgeCandidates: Vec2[] = [
          { x: unit.posX, z: 0 },          // south
          { x: unit.posX, z: mapH },        // north
          { x: 0,         z: unit.posZ },   // west
          { x: mapW,      z: unit.posZ },   // east
        ];
        let nearest = edgeCandidates[0];
        let nearestDist = Infinity;
        for (const c of edgeCandidates) {
          const d = distanceBetween({ x: unit.posX, z: unit.posZ }, c);
          if (d < nearestDist) { nearestDist = d; nearest = c; }
        }
        unit.currentPath = [{ x: unit.posX, z: unit.posZ }, nearest];
        unit.pathIndex = 1;
        unit.moveMode = 'march'; // routing units flee at full speed
      }
    }

    // --- Pinned units: cannot advance (but can stay in place) ---
    if (unit.moraleState === 'pinned') {
      unit.currentPath = null;
      unit.pathIndex = 0;
    }

    // --- No active path: unit is stationary ---
    if (!unit.currentPath || unit.currentPath.length === 0) {
      unit.stoppedForSec += dt;
      unit.recentDistanceM = Math.max(0, unit.recentDistanceM - (unit.recentDistanceM * dt / 10));
      unit.speedState = classifySpeedState(unit.recentDistanceM, unit.stoppedForSec);
      continue;
    }

    // --- Get current waypoint ---
    if (unit.pathIndex >= unit.currentPath.length) {
      // Path exhausted — check order queue for next waypoint
      if (unit.orderQueue.length > 0) {
        const nextWaypoint = unit.orderQueue.shift()!;
        // Use a straight-line path from current position to the queued waypoint.
        // (Full A* would require injecting the pathfinder here; straight-line
        // is sufficient for queued waypoints that are already close-range.)
        unit.moveMode = nextWaypoint.moveMode;
        unit.currentPath = [
          { x: unit.posX, z: unit.posZ },
          nextWaypoint.pos,
        ];
        unit.pathIndex = 1;
      } else {
        // No more waypoints — halt
        unit.currentPath = null;
        unit.pathIndex = 0;
        unit.isOrderComplete = true;
        unit.stoppedForSec += dt;
        unit.recentDistanceM = Math.max(0, unit.recentDistanceM - (unit.recentDistanceM * dt / 10));
        unit.speedState = classifySpeedState(unit.recentDistanceM, unit.stoppedForSec);
        continue;
      }
    }

    const waypoint = unit.currentPath[unit.pathIndex];
    const unitPos: Vec2 = { x: unit.posX, z: unit.posZ };

    // --- Compute effective speed at current position ---
    const ut = unitTypes?.get(unit.unitTypeId);
    const moveClass: MoveClass = ut?.moveClass ?? 'track';
    const cellCost = getTerrainCost(costGrids, moveClass, unit.posX, unit.posZ);
    let maxSpeedM = ut?.maxSpeedM ?? 10;
    // Routing units retreat at 50% speed (ENEMY_AI.md §5.3)
    if (unit.moraleState === 'routing') maxSpeedM *= 0.5;
    const speed = effectiveSpeed(maxSpeedM, unit.moveMode, cellCost);

    // --- Move toward waypoint ---
    const CELL_REAL_M = 20;
    const distToWaypoint = distanceBetween(unitPos, waypoint);
    const stepDistance = (speed / CELL_REAL_M) * dt;

    if (stepDistance >= distToWaypoint) {
      unit.posX = waypoint.x;
      unit.posZ = waypoint.z;
      unit.pathIndex++;
      unit.recentDistanceM += distToWaypoint;
    } else {
      const ratio = stepDistance / distToWaypoint;
      unit.posX += (waypoint.x - unit.posX) * ratio;
      unit.posZ += (waypoint.z - unit.posZ) * ratio;
      unit.recentDistanceM += stepDistance;
    }

    // --- Update heading toward waypoint ---
    unit.heading = bearingToward(unitPos, waypoint);
    if (unit.moveMode === 'reverse') {
      unit.heading = (unit.heading + 180) % 360;
    }

    // --- Reset stationary counters since we moved ---
    unit.stoppedForSec = 0;
    unit.lastMoveTick = tick;

    // --- Classify speed state based on 10-second rolling window ---
    unit.speedState = classifySpeedState(unit.recentDistanceM, unit.stoppedForSec);
  }
}
