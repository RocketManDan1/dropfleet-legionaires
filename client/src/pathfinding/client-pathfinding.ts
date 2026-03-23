// ============================================================================
// CLIENT PATHFINDING — A* path preview for click-to-move
// Milestone: 1 ("One Unit on a Map") — client-only path preview
//
// Provides a weighted A* implementation for showing movement path previews
// on the client before the server computes the authoritative path.
// In Milestone 2+, the server becomes the authority for pathfinding;
// this module then serves only for visual preview lines.
//
// Algorithm: Weighted A* with epsilon=1.2, 8-connected grid,
// octile distance heuristic, binary min-heap open list,
// greedy line-of-walk path smoothing.
// ============================================================================

import * as THREE from 'three';
import type {
  Vec2,
  MoveClass,
  CostGrid,
  PathResult,
  PathStatus,
} from '@legionaires/shared';
import {
  PATHFINDING_EPSILON,
  PATHFINDING_MAX_OPEN_NODES,
  PATHFINDING_SMOOTHING_LOOKAHEAD,
  IMPASSABLE_THRESHOLD,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal A* node stored in the open/closed sets. */
interface AStarNode {
  /** Grid X coordinate. */
  gx: number;
  /** Grid Z coordinate (row). */
  gz: number;
  /** Cost from start to this node. */
  g: number;
  /** Estimated total cost (g + h * epsilon). */
  f: number;
  /** Parent node index in closed list (for path reconstruction). */
  parentIndex: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 8-connected neighbor offsets: N, NE, E, SE, S, SW, W, NW.
 * Each entry: [dx, dz, cost_multiplier].
 * Diagonal moves cost sqrt(2) times the cell cost.
 */
const NEIGHBORS: [number, number, number][] = [
  [ 0, -1, 1.0],      // N
  [ 1, -1, 1.4142],   // NE
  [ 1,  0, 1.0],      // E
  [ 1,  1, 1.4142],   // SE
  [ 0,  1, 1.0],      // S
  [-1,  1, 1.4142],   // SW
  [-1,  0, 1.0],      // W
  [-1, -1, 1.4142],   // NW
];

// ---------------------------------------------------------------------------
// Binary Min-Heap
// ---------------------------------------------------------------------------

/**
 * Lightweight binary min-heap for the A* open list.
 * Compares by the .f field (estimated total cost).
 */
class MinHeap {
  private data: AStarNode[] = [];

  get size(): number {
    return this.data.length;
  }

  /** Inserts a node into the heap. */
  push(node: AStarNode): void {
    this.data.push(node);
    this._bubbleUp(this.data.length - 1);
  }

  /** Removes and returns the node with the smallest f value. */
  pop(): AStarNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  private _sinkDown(i: number): void {
    const len = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < len && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else {
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Heuristic
// ---------------------------------------------------------------------------

/**
 * Octile distance heuristic for 8-connected grid.
 * Returns the estimated cost from (ax, az) to (bx, bz).
 */
function octileDistance(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (1.4142 - 1.0) * Math.min(dx, dz);
}

// ---------------------------------------------------------------------------
// ClientPathfinder
// ---------------------------------------------------------------------------

/**
 * Client-side pathfinder for click-to-move preview paths.
 *
 * In Milestone 1, this is the only pathfinder — units move along
 * the paths it produces. In Milestone 2+, the server runs the
 * authoritative pathfinder and this is used solely for showing
 * the preview line before the server confirms the path.
 *
 * Usage:
 *   const pf = new ClientPathfinder();
 *   pf.setCostGrid(grid);
 *   const result = pf.findPath(from, to, 'track', terrain);
 *   if (result.status === 'FOUND') {
 *     pf.showPathPreview(scene, result.path);
 *   }
 */
export class ClientPathfinder {
  /** Active cost grid (one per move class, built from terrain). */
  private costGrid: CostGrid | null = null;

  /** Three.js line object for the path preview. */
  private previewLine: THREE.Line | null = null;

  /** Shared material for preview lines. */
  private previewMaterial: THREE.LineBasicMaterial;

  constructor() {
    this.previewMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.7,
      linewidth: 2,
    });
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Sets the cost grid for pathfinding. In a full implementation,
   * there would be one cost grid per MoveClass. For now, a single
   * grid is used for all unit types.
   *
   * @param grid - The terrain cost grid (built from heightmap + terrain types).
   */
  setCostGrid(grid: CostGrid): void {
    this.costGrid = grid;
  }

  // -------------------------------------------------------------------------
  // Path search
  // -------------------------------------------------------------------------

  /**
   * Finds a path from `from` to `to` using weighted A*.
   *
   * @param from - Start position in world space (metres).
   * @param to - Target position in world space (metres).
   * @param moveClass - Unit's movement class (affects terrain costs).
   * @param terrain - Optional terrain data; if no cost grid is set,
   *                  a flat-cost fallback grid will be used.
   * @returns A PathResult with status, smoothed path, and diagnostics.
   */
  findPath(
    from: Vec2,
    to: Vec2,
    moveClass: MoveClass,
    _terrain?: unknown,
  ): PathResult {
    if (!this.costGrid) {
      // No cost grid loaded — return a straight-line path
      return {
        status: 'FOUND' as PathStatus,
        path: [from, to],
        rawPath: [from, to],
        nodesExpanded: 0,
        costTotal: this._straightLineDistance(from, to),
      };
    }

    const grid = this.costGrid;
    const cellSize = grid.cellSizeM;

    // Convert world positions to grid coordinates
    const startGX = Math.round(from.x / cellSize);
    const startGZ = Math.round(from.z / cellSize);
    const goalGX = Math.round(to.x / cellSize);
    const goalGZ = Math.round(to.z / cellSize);

    // Clamp to grid bounds
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
    const sgx = clamp(startGX, grid.width);
    const sgz = clamp(startGZ, grid.height);
    const ggx = clamp(goalGX, grid.width);
    const ggz = clamp(goalGZ, grid.height);

    // Check if goal is impassable
    const goalCost = grid.data[ggz * grid.width + ggx];
    if (goalCost >= IMPASSABLE_THRESHOLD) {
      return {
        status: 'NOT_FOUND' as PathStatus,
        path: [],
        rawPath: [],
        nodesExpanded: 0,
        costTotal: 0,
      };
    }

    // --- A* search ---
    const epsilon = PATHFINDING_EPSILON;
    const maxOpen = PATHFINDING_MAX_OPEN_NODES;

    const openHeap = new MinHeap();
    const closed: AStarNode[] = [];
    const visited = new Set<number>(); // gx * grid.height + gz

    const keyOf = (gx: number, gz: number) => gx * grid.height + gz;

    // gCost map for tracking best-known cost to each cell
    const gCosts = new Map<number, number>();

    const startNode: AStarNode = {
      gx: sgx,
      gz: sgz,
      g: 0,
      f: epsilon * octileDistance(sgx, sgz, ggx, ggz),
      parentIndex: -1,
    };

    openHeap.push(startNode);
    gCosts.set(keyOf(sgx, sgz), 0);

    let nodesExpanded = 0;
    let goalNode: AStarNode | null = null;

    while (openHeap.size > 0 && nodesExpanded < maxOpen) {
      const current = openHeap.pop()!;
      const currentKey = keyOf(current.gx, current.gz);

      // Skip if we've already closed this cell with a better cost
      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

      // Add to closed list (for path reconstruction)
      const currentIndex = closed.length;
      closed.push(current);
      nodesExpanded++;

      // Goal check
      if (current.gx === ggx && current.gz === ggz) {
        goalNode = current;
        break;
      }

      // Expand neighbors
      for (const [dx, dz, diagMult] of NEIGHBORS) {
        const nx = current.gx + dx;
        const nz = current.gz + dz;

        // Bounds check
        if (nx < 0 || nx >= grid.width || nz < 0 || nz >= grid.height) continue;

        const nKey = keyOf(nx, nz);
        if (visited.has(nKey)) continue;

        // Terrain cost at neighbor cell
        const cellCost = grid.data[nz * grid.width + nx];
        if (cellCost >= IMPASSABLE_THRESHOLD) continue;

        const moveCost = cellCost * diagMult;
        const newG = current.g + moveCost;

        // Check if this is a better path to this cell
        const existingG = gCosts.get(nKey);
        if (existingG !== undefined && newG >= existingG) continue;

        gCosts.set(nKey, newG);

        const h = octileDistance(nx, nz, ggx, ggz);
        const neighborNode: AStarNode = {
          gx: nx,
          gz: nz,
          g: newG,
          f: newG + epsilon * h,
          parentIndex: currentIndex,
        };

        openHeap.push(neighborNode);
      }
    }

    // --- Reconstruct raw path ---
    if (!goalNode) {
      return {
        status: 'NOT_FOUND' as PathStatus,
        path: [],
        rawPath: [],
        nodesExpanded,
        costTotal: 0,
      };
    }

    const rawGridPath: Vec2[] = [];
    let traceNode: AStarNode | null = goalNode;
    while (traceNode) {
      rawGridPath.push({
        x: traceNode.gx * cellSize,
        z: traceNode.gz * cellSize,
      });
      traceNode = traceNode.parentIndex >= 0 ? closed[traceNode.parentIndex] : null;
    }
    rawGridPath.reverse();

    // --- Smooth path (greedy line-of-walk) ---
    const smoothed = this._smoothPath(rawGridPath, grid);

    return {
      status: 'FOUND' as PathStatus,
      path: smoothed,
      rawPath: rawGridPath,
      nodesExpanded,
      costTotal: goalNode.g,
    };
  }

  // -------------------------------------------------------------------------
  // Path preview rendering
  // -------------------------------------------------------------------------

  /**
   * Shows a preview line on the terrain for the given path.
   * Removes any previously displayed preview line.
   *
   * @param scene - The Three.js scene to add the line to.
   * @param path - Array of world-space waypoints.
   * @param yOffset - Height offset above terrain (default 0.5).
   * @param getTerrainHeight - Optional callback to sample terrain height at (x,z).
   */
  showPathPreview(
    scene: THREE.Scene,
    path: Vec2[],
    yOffset: number = 0.5,
    getTerrainHeight?: (x: number, z: number) => number,
  ): void {
    this.clearPathPreview(scene);

    if (path.length < 2) return;

    // Densify: sample terrain height every 1 cell along each segment so the
    // line hugs the terrain instead of cutting through hills between waypoints.
    const SAMPLE_STEP = 1.0; // cells between height samples
    const points: THREE.Vector3[] = [];

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      const steps = Math.max(1, Math.ceil(segLen / SAMPLE_STEP));

      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const px = a.x + dx * t;
        const pz = a.z + dz * t;
        const y = getTerrainHeight ? getTerrainHeight(px, pz) + yOffset : yOffset;
        points.push(new THREE.Vector3(px, y, pz));
      }
    }

    // Always include the final waypoint
    const last = path[path.length - 1];
    const lastY = getTerrainHeight ? getTerrainHeight(last.x, last.z) + yOffset : yOffset;
    points.push(new THREE.Vector3(last.x, lastY, last.z));

    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    this.previewLine = new THREE.Line(geometry, this.previewMaterial);
    this.previewLine.name = 'path-preview';
    scene.add(this.previewLine);
  }

  /**
   * Removes the current path preview line from the scene.
   */
  clearPathPreview(scene: THREE.Scene): void {
    if (this.previewLine) {
      scene.remove(this.previewLine);
      this.previewLine.geometry.dispose();
      this.previewLine = null;
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Disposes all resources.
   */
  dispose(): void {
    this.previewMaterial.dispose();
    if (this.previewLine) {
      this.previewLine.geometry.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Greedy line-of-walk path smoothing.
   * Starting from the first waypoint, repeatedly checks if a straight-line
   * walk to a waypoint further ahead clears all intermediate cells.
   * If so, skips the intermediate waypoints.
   */
  private _smoothPath(rawPath: Vec2[], grid: CostGrid): Vec2[] {
    if (rawPath.length <= 2) return [...rawPath];

    const smoothed: Vec2[] = [rawPath[0]];
    let current = 0;

    while (current < rawPath.length - 1) {
      // Look ahead up to SMOOTHING_LOOKAHEAD waypoints
      let furthest = current + 1;
      const maxLook = Math.min(
        current + PATHFINDING_SMOOTHING_LOOKAHEAD,
        rawPath.length - 1,
      );

      for (let ahead = maxLook; ahead > current + 1; ahead--) {
        if (this._lineOfWalk(rawPath[current], rawPath[ahead], grid)) {
          furthest = ahead;
          break;
        }
      }

      smoothed.push(rawPath[furthest]);
      current = furthest;
    }

    return smoothed;
  }

  /**
   * Checks whether a straight-line walk from A to B crosses
   * only passable terrain cells (no cell cost >= IMPASSABLE_THRESHOLD).
   * Uses Bresenham's line algorithm on the grid.
   */
  private _lineOfWalk(a: Vec2, b: Vec2, grid: CostGrid): boolean {
    const cellSize = grid.cellSizeM;
    let x0 = Math.round(a.x / cellSize);
    let z0 = Math.round(a.z / cellSize);
    const x1 = Math.round(b.x / cellSize);
    const z1 = Math.round(b.z / cellSize);

    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    while (true) {
      // Bounds check
      if (x0 < 0 || x0 >= grid.width || z0 < 0 || z0 >= grid.height) {
        return false;
      }

      if (grid.data[z0 * grid.width + x0] >= IMPASSABLE_THRESHOLD) {
        return false;
      }

      if (x0 === x1 && z0 === z1) break;

      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        z0 += sz;
      }
    }

    return true;
  }

  /**
   * Simple straight-line distance between two world points.
   */
  private _straightLineDistance(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
