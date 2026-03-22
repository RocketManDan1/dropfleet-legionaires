// ============================================================================
// SPATIAL HASH — grid-based spatial indexing for range queries
// Source: SERVER_GAME_LOOP.md §5 (Spatial Indexing)
// Cell size: 500 m (covers max ground sensor range with one-ring neighbour lookup)
// Milestone 2 scaffold
// ============================================================================
import { SPATIAL_HASH_CELL_SIZE } from '@legionaires/shared';
/**
 * Grid-based spatial hash for efficient range queries.
 *
 * All spotting, fire range, supply range, and rally voice range queries
 * use this instead of iterating all units. Expected unit counts are
 * 50–200 across a 5 km x 5 km map; the hash reduces pairwise checks
 * from O(n^2) to O(n * k) where k = nearby units per cell ring.
 *
 * Usage:
 *   const hash = new SpatialHash(5000, 5000);
 *   hash.insert(unitId, posX, posZ);
 *   hash.update(unitId, newPosX, newPosZ);
 *   const nearby = hash.unitsInRange({ x: 1000, z: 1000 }, 800);
 *   hash.remove(unitId);
 */
export class SpatialHash {
    /** Cell size in metres (default 500 m). */
    cellSize;
    /** Map width in metres (for bounds checking). */
    mapWidthM;
    /** Map height in metres (for bounds checking). */
    mapHeightM;
    /** Grid cells: cellKey -> Set of unitIds. */
    cells = new Map();
    /**
     * Reverse lookup: unitId -> { cellKey, x, z }.
     * Allows O(1) removal and update without scanning all cells.
     */
    unitPositions = new Map();
    constructor(mapWidthM, mapHeightM, cellSize = SPATIAL_HASH_CELL_SIZE) {
        this.mapWidthM = mapWidthM;
        this.mapHeightM = mapHeightM;
        this.cellSize = cellSize;
    }
    // =========================================================================
    // Cell key helpers
    // =========================================================================
    /** Convert world-space position to cell coordinates. */
    worldToCell(x, z) {
        const cellX = Math.floor(x / this.cellSize);
        const cellZ = Math.floor(z / this.cellSize);
        return [cellX, cellZ];
    }
    /** Create a string key from cell coordinates. */
    cellKey(cellX, cellZ) {
        return `${cellX},${cellZ}`;
    }
    /** Get or create the cell set for a given key. */
    getOrCreateCell(key) {
        let cell = this.cells.get(key);
        if (!cell) {
            cell = new Set();
            this.cells.set(key, cell);
        }
        return cell;
    }
    // =========================================================================
    // Insert / Remove / Update
    // =========================================================================
    /**
     * Insert a unit into the spatial hash at the given world position.
     * If the unit already exists, it is updated instead.
     */
    insert(unitId, x, z) {
        // If already present, update instead
        if (this.unitPositions.has(unitId)) {
            this.update(unitId, x, z);
            return;
        }
        const [cellX, cellZ] = this.worldToCell(x, z);
        const key = this.cellKey(cellX, cellZ);
        this.getOrCreateCell(key).add(unitId);
        this.unitPositions.set(unitId, { cellKey: key, x, z });
    }
    /**
     * Remove a unit from the spatial hash entirely.
     */
    remove(unitId) {
        const entry = this.unitPositions.get(unitId);
        if (!entry)
            return;
        const cell = this.cells.get(entry.cellKey);
        if (cell) {
            cell.delete(unitId);
            // Clean up empty cells to prevent memory leaks
            if (cell.size === 0) {
                this.cells.delete(entry.cellKey);
            }
        }
        this.unitPositions.delete(unitId);
    }
    /**
     * Update a unit's position. If the unit moved to a different cell,
     * migrate it. Otherwise just update the stored coordinates.
     */
    update(unitId, x, z) {
        const entry = this.unitPositions.get(unitId);
        if (!entry) {
            // Not in the hash yet — insert fresh
            this.insert(unitId, x, z);
            return;
        }
        const [newCellX, newCellZ] = this.worldToCell(x, z);
        const newKey = this.cellKey(newCellX, newCellZ);
        if (newKey !== entry.cellKey) {
            // Unit moved to a different cell — migrate
            const oldCell = this.cells.get(entry.cellKey);
            if (oldCell) {
                oldCell.delete(unitId);
                if (oldCell.size === 0) {
                    this.cells.delete(entry.cellKey);
                }
            }
            this.getOrCreateCell(newKey).add(unitId);
        }
        // Update stored position regardless of cell change
        entry.cellKey = newKey;
        entry.x = x;
        entry.z = z;
    }
    // =========================================================================
    // Range queries
    // =========================================================================
    /**
     * Return all unitIds within `rangeM` metres of `pos`.
     *
     * Two-pass approach:
     *   1. Collect candidates from cells that overlap the query circle.
     *   2. Exact distance check on each candidate.
     *
     * This is the primary query used by spotting (Phase 4), fire range (Phase 5),
     * supply range (Phase 8), and rally voice range.
     */
    unitsInRange(pos, rangeM) {
        const results = [];
        // How many cells the query circle spans in each direction
        const cellRadius = Math.ceil(rangeM / this.cellSize);
        const [centerCellX, centerCellZ] = this.worldToCell(pos.x, pos.z);
        const rangeSq = rangeM * rangeM;
        // Scan cells within the bounding box of the query circle
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                const key = this.cellKey(centerCellX + dx, centerCellZ + dz);
                const cell = this.cells.get(key);
                if (!cell)
                    continue;
                // Second pass: exact distance check per unit
                for (const unitId of cell) {
                    const entry = this.unitPositions.get(unitId);
                    if (!entry)
                        continue;
                    const distX = entry.x - pos.x;
                    const distZ = entry.z - pos.z;
                    const distSq = distX * distX + distZ * distZ;
                    if (distSq <= rangeSq) {
                        results.push(unitId);
                    }
                }
            }
        }
        return results;
    }
    /**
     * Return all unitIds in a specific cell (useful for local checks).
     */
    unitsInCell(cellX, cellZ) {
        const key = this.cellKey(cellX, cellZ);
        const cell = this.cells.get(key);
        return cell ? [...cell] : [];
    }
    /**
     * Get the stored position of a unit (if present).
     */
    getUnitPosition(unitId) {
        const entry = this.unitPositions.get(unitId);
        if (!entry)
            return null;
        return { x: entry.x, z: entry.z };
    }
    /**
     * Return the total number of units tracked.
     */
    getUnitCount() {
        return this.unitPositions.size;
    }
    /**
     * Clear all units from the hash (e.g. on session teardown).
     */
    clear() {
        this.cells.clear();
        this.unitPositions.clear();
    }
    /**
     * Rebuild the entire hash from a unit registry map.
     * Useful after loading a crash-recovery snapshot.
     */
    rebuildFromUnits(units) {
        this.clear();
        for (const [unitId, unit] of units) {
            if (!unit.isDestroyed) {
                this.insert(unitId, unit.posX, unit.posZ);
            }
        }
    }
}
