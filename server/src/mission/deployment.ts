// ============================================================================
// DEPLOYMENT PHASE — Zone generation, unit placement, reserve system
// Milestone 3
// Source: DEPLOYMENT_PHASE.md, AUTHORITATIVE_CONTRACTS.md
// ============================================================================

import type { Vec2, DeploymentZone, MissionType } from '@legionaires/shared';
import { MIN_DEPLOYMENT_ZONE_AREA, MAX_AUTO_DEPLOY_ATTEMPTS } from '@legionaires/shared';

/** Per-player target area in m² (DEPLOYMENT_PHASE.md). */
const TARGET_AREA_PER_PLAYER = 250_000;
/** Maximum zone area in m². */
const MAX_ZONE_AREA = 1_000_000;
/** Minimum edge length to prevent slivers. */
const MIN_EDGE_LENGTH = 200;
/** Minimum spacing between placed units (metres). */
const MIN_UNIT_SPACING = 25;

export interface PlacementResult {
  success: boolean;
  unitId: string;
  position: Vec2;
  reason?: string;
}

/**
 * Manages the deployment phase for a mission.
 */
export class DeploymentManager {
  private zone: DeploymentZone | null = null;
  private placedUnits = new Map<string, Vec2>();
  private reserveUnits = new Set<string>();

  /**
   * Generate the deployment zone based on mission type, terrain, and player count.
   *
   * Per DEPLOYMENT_PHASE.md:
   *   - defend:  centered on primary objective (or map center)
   *   - seize/patrol/logistics: wide rectangle along the friendly (south) map edge
   *   - raid:    compact zone near a flank
   *
   * Zone is sized to TARGET_AREA_PER_PLAYER × max(playerCount, 1), clamped to
   * [MIN_DEPLOYMENT_ZONE_AREA, MAX_ZONE_AREA].
   *
   * @param mapWidth       Map width in grid cells
   * @param mapHeight      Map height in grid cells
   * @param playerCount    Current connected players
   * @param missionType    Mission archetype (default 'defend')
   * @param objectiveCenter Optional objective position to center the zone on
   * @param terrainTypeMap  Optional terrain type grid for terrain avoidance
   * @param heightmap       Optional heightmap for sea-level avoidance
   * @param seaLevel        Sea level threshold (cells below this are water)
   */
  generateZone(
    mapWidth: number,
    mapHeight: number,
    playerCount: number,
    missionType?: MissionType,
    objectiveCenter?: Vec2,
    terrainTypeMap?: number[],
    heightmap?: number[],
    seaLevel?: number,
  ): DeploymentZone {
    const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
    const mt = missionType ?? 'defend';
    const pc = Math.max(1, playerCount);
    const margin = Math.max(12, Math.min(mapWidth, mapHeight) * 0.05);

    // Target area: scale by player count, clamp to spec bounds
    const targetArea = clamp(TARGET_AREA_PER_PLAYER * pc, MIN_DEPLOYMENT_ZONE_AREA, MAX_ZONE_AREA);

    // Compute zone dimensions to hit the target area with a golden-ish aspect
    // ratio (wider than deep, min edge >= MIN_EDGE_LENGTH)
    const aspect = 2.5; // width : depth ratio
    let zoneW = Math.sqrt(targetArea * aspect);
    let zoneD = targetArea / zoneW;
    zoneW = Math.max(zoneW, MIN_EDGE_LENGTH);
    zoneD = Math.max(zoneD, MIN_EDGE_LENGTH);

    // Determine zone center based on mission type
    let cx: number;
    let cz: number;

    if (mt === 'defend' && objectiveCenter) {
      // Defend: centered on objective
      cx = objectiveCenter.x;
      cz = objectiveCenter.z;
    } else if (mt === 'raid') {
      // Raid: compact zone near a flank (west side of map)
      cx = margin + zoneW / 2;
      cz = mapHeight / 2;
      zoneW *= 0.6; // more compact
      zoneD *= 0.6;
    } else {
      // Seize, patrol, logistics, and default: friendly (south) map edge
      cx = mapWidth / 2;
      cz = margin + zoneD / 2;
    }

    // Clamp zone bounds to map boundaries
    const x1 = clamp(cx - zoneW / 2, margin, mapWidth - margin);
    const x2 = clamp(cx + zoneW / 2, margin, mapWidth - margin);
    const z1 = clamp(cz - zoneD / 2, margin, mapHeight - margin);
    const z2 = clamp(cz + zoneD / 2, margin, mapHeight - margin);

    // Build candidate vertices and filter out invalid terrain
    // Sample a grid of points within the rectangle, keep those on valid terrain
    const candidates: Vec2[] = [];
    const step = Math.max(10, Math.min(zoneW, zoneD) / 8);

    for (let x = x1; x <= x2; x += step) {
      for (let z = z1; z <= z2; z += step) {
        if (isTerrainValid(x, z, mapWidth, terrainTypeMap, heightmap, seaLevel)) {
          candidates.push({ x, z });
        }
      }
    }

    // Always include the four corners if they're on valid terrain (prevents degenerate zones)
    const corners: Vec2[] = [
      { x: x1, z: z1 }, { x: x2, z: z1 },
      { x: x2, z: z2 }, { x: x1, z: z2 },
    ];
    for (const c of corners) {
      if (isTerrainValid(c.x, c.z, mapWidth, terrainTypeMap, heightmap, seaLevel)) {
        candidates.push(c);
      }
    }

    // Compute convex hull from candidates
    let vertices: Vec2[];
    if (candidates.length >= 3) {
      vertices = convexHull(candidates);
    } else {
      // Fallback to rectangle if not enough valid terrain
      vertices = corners;
    }

    // Ensure minimum 3 vertices
    if (vertices.length < 3) {
      vertices = corners;
    }

    const area = Math.max(polygonArea(vertices), MIN_DEPLOYMENT_ZONE_AREA * pc);
    const center = polygonCentroid(vertices);

    this.zone = {
      vertices,
      areaM2: area,
      centerX: center.x,
      centerZ: center.z,
    };
    return this.zone;
  }

  /**
   * Place a unit at a position within the deployment zone.
   */
  placeUnit(unitId: string, pos: Vec2): PlacementResult {
    if (!this.zone) return { success: false, unitId, position: pos, reason: 'NO_ZONE' };
    if (!this.isInsideZone(pos)) return { success: false, unitId, position: pos, reason: 'OUTSIDE_ZONE' };
    if (this.isPositionOccupied(pos)) return { success: false, unitId, position: pos, reason: 'POSITION_OCCUPIED' };

    this.placedUnits.set(unitId, pos);
    this.reserveUnits.delete(unitId);
    return { success: true, unitId, position: pos };
  }

  /**
   * Auto-deploy a unit (for late joiners or unplaced units when timer expires).
   * Spiral outward from zone center to find a free position.
   */
  autoDeploy(unitId: string): PlacementResult {
    if (!this.zone) return { success: false, unitId, position: { x: 0, z: 0 }, reason: 'NO_ZONE' };

    // Spiral search from zone center
    const center = { x: this.zone.centerX, z: this.zone.centerZ };
    const spacing = 20; // metres between auto-placed units

    for (let attempt = 0; attempt < MAX_AUTO_DEPLOY_ATTEMPTS; attempt++) {
      // Simple spiral: angle increases, radius increases
      const angle = attempt * 2.399; // golden angle
      const radius = spacing * Math.sqrt(attempt);
      const pos = {
        x: center.x + Math.cos(angle) * radius,
        z: center.z + Math.sin(angle) * radius,
      };

      if (this.isInsideZone(pos) && !this.isPositionOccupied(pos)) {
        this.placedUnits.set(unitId, pos);
        return { success: true, unitId, position: pos };
      }
    }

    // Failed to place — add to reserve
    this.reserveUnits.add(unitId);
    return { success: false, unitId, position: center, reason: 'AUTO_DEPLOY_FAILED_RESERVE' };
  }

  /** Flag a unit as reserve (will deploy later via reserve system). */
  setReserve(unitId: string): void { this.reserveUnits.add(unitId); }

  /** Remove a placed unit back to unplaced state. */
  removeUnit(unitId: string): boolean {
    const removed = this.placedUnits.delete(unitId);
    if (removed) {
      this.reserveUnits.add(unitId);
    }
    return removed;
  }

  /** Whether a unit has been explicitly placed in the deployment zone. */
  hasPlacedUnit(unitId: string): boolean {
    return this.placedUnits.has(unitId);
  }

  /** Check if a point is inside the convex hull zone. */
  private isInsideZone(pos: Vec2): boolean {
    if (!this.zone) return false;
    return pointInConvexHull(pos, this.zone.vertices);
  }

  /** Check if a position is too close to an already-placed unit. */
  private isPositionOccupied(pos: Vec2, minDist = MIN_UNIT_SPACING): boolean {
    for (const [, placed] of this.placedUnits) {
      const dx = pos.x - placed.x;
      const dz = pos.z - placed.z;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
  }
}

/** Point-in-convex-hull test using cross products (clockwise vertex ordering). */
function pointInConvexHull(point: Vec2, vertices: Vec2[]): boolean {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (cross < 0) return false; // outside (assumes clockwise winding)
  }
  return true;
}

// --- Terrain validation for candidate zone positions ---

/** Terrain types that are invalid for deployment (DEPLOYMENT_PHASE.md). */
const INVALID_DEPLOY_TERRAIN = new Set([
  18, // Water
  20, // Road
  21, // Bridge
  23, // Urban (building interiors)
  24, // Industrial
]);

function isTerrainValid(
  x: number, z: number,
  mapWidth: number,
  terrainTypeMap?: number[],
  heightmap?: number[],
  seaLevel?: number,
): boolean {
  const col = Math.floor(x);
  const row = Math.floor(z);
  if (col < 0 || row < 0) return false;
  const idx = row * mapWidth + col;

  // Check terrain type
  if (terrainTypeMap && idx < terrainTypeMap.length) {
    if (INVALID_DEPLOY_TERRAIN.has(terrainTypeMap[idx])) return false;
  }

  // Check below sea level (water)
  if (heightmap && seaLevel !== undefined && idx < heightmap.length) {
    if (heightmap[idx] <= seaLevel) return false;
  }

  return true;
}

// --- Convex hull (Andrew's monotone chain) ---

function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length <= 2) return pts;

  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  // Lower hull
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Upper hull
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// --- Polygon area (shoelace formula) ---

function polygonArea(vertices: Vec2[]): number {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

// --- Polygon centroid ---

function polygonCentroid(vertices: Vec2[]): Vec2 {
  let cx = 0, cz = 0;
  for (const v of vertices) { cx += v.x; cz += v.z; }
  const n = vertices.length || 1;
  return { x: cx / n, z: cz / n };
}
