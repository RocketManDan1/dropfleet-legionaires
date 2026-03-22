// ============================================================================
// DEPLOYMENT PHASE — Zone generation, unit placement, reserve system
// Milestone 3
// Source: DEPLOYMENT_PHASE.md, AUTHORITATIVE_CONTRACTS.md
// ============================================================================
import { MAX_AUTO_DEPLOY_ATTEMPTS } from '@legionaires/shared';
/**
 * Manages the deployment phase for a mission.
 */
export class DeploymentManager {
    zone = null;
    placedUnits = new Map();
    reserveUnits = new Set();
    /**
     * Generate the deployment zone based on map terrain and mission type.
     * Zone is a convex hull of candidate positions.
     */
    generateZone(mapWidth, mapHeight, playerCount) {
        // TODO: Implement zone generation per DEPLOYMENT_PHASE.md
        // 1. Select candidate positions based on mission type
        // 2. Compute convex hull
        // 3. Ensure area >= MIN_DEPLOYMENT_ZONE_AREA * playerCount
        const halfW = mapWidth / 4;
        const halfH = mapHeight / 4;
        const cx = mapWidth / 2;
        const cz = mapHeight * 0.1; // player spawn near south edge
        this.zone = {
            vertices: [
                { x: cx - halfW, z: cz - halfH },
                { x: cx + halfW, z: cz - halfH },
                { x: cx + halfW, z: cz + halfH },
                { x: cx - halfW, z: cz + halfH },
            ],
            areaM2: halfW * 2 * halfH * 2,
            centerX: cx,
            centerZ: cz,
        };
        return this.zone;
    }
    /**
     * Place a unit at a position within the deployment zone.
     */
    placeUnit(unitId, pos) {
        if (!this.zone)
            return { success: false, unitId, position: pos, reason: 'NO_ZONE' };
        if (!this.isInsideZone(pos))
            return { success: false, unitId, position: pos, reason: 'OUTSIDE_ZONE' };
        if (this.isPositionOccupied(pos))
            return { success: false, unitId, position: pos, reason: 'POSITION_OCCUPIED' };
        this.placedUnits.set(unitId, pos);
        this.reserveUnits.delete(unitId);
        return { success: true, unitId, position: pos };
    }
    /**
     * Auto-deploy a unit (for late joiners or unplaced units when timer expires).
     * Spiral outward from zone center to find a free position.
     */
    autoDeploy(unitId) {
        if (!this.zone)
            return { success: false, unitId, position: { x: 0, z: 0 }, reason: 'NO_ZONE' };
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
    setReserve(unitId) { this.reserveUnits.add(unitId); }
    /** Check if a point is inside the convex hull zone. */
    isInsideZone(pos) {
        if (!this.zone)
            return false;
        return pointInConvexHull(pos, this.zone.vertices);
    }
    /** Check if a position is too close to an already-placed unit. */
    isPositionOccupied(pos, minDist = 15) {
        for (const [, placed] of this.placedUnits) {
            const dx = pos.x - placed.x;
            const dz = pos.z - placed.z;
            if (dx * dx + dz * dz < minDist * minDist)
                return true;
        }
        return false;
    }
}
/** Point-in-convex-hull test using cross products (clockwise vertex ordering). */
function pointInConvexHull(point, vertices) {
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
        if (cross < 0)
            return false; // outside (assumes clockwise winding)
    }
    return true;
}
