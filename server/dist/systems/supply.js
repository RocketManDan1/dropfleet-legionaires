// ============================================================================
// PHASE 8: SUPPLY TICK — Milestone 2
// Source: Unit Schema Spec.md §Supply Model, SERVER_GAME_LOOP.md
//
// Runs every second (tick % 20 === 0).
// Units within 150m of a supply vehicle, both below suppression 40
// and at 'slow' speed or slower, receive trickle resupply.
// ============================================================================
import { SUPPLY_RANGE_M, SUPPRESSION_PIN_THRESHOLD } from '@legionaires/shared';
/**
 * Phase 8: Supply Tick.
 * Trickle ammo resupply from nearby supply vehicles.
 */
export function tickSupply(units, spatialHash, _dt) {
    const resuppliedUnitIds = [];
    // Find all supply vehicles
    const supplyUnits = [];
    for (const [_id, unit] of units) {
        if (unit.isDestroyed)
            continue;
        // TODO: Check unit.unitTypeId against UnitRegistry to confirm unitClass === 'supply'
        // For now, placeholder check
        supplyUnits.push(unit);
    }
    for (const [_id, unit] of units) {
        if (unit.isDestroyed)
            continue;
        if (unit.suppressionLevel >= SUPPRESSION_PIN_THRESHOLD) {
            unit.isBeingResupplied = false;
            continue;
        }
        if (unit.speedState === 'fast') {
            unit.isBeingResupplied = false;
            continue;
        }
        // Check if any supply vehicle is within range
        const nearbySupply = findNearbySupplyUnit(unit, supplyUnits, spatialHash);
        if (!nearbySupply) {
            unit.isBeingResupplied = false;
            continue;
        }
        // Supply vehicle must also be below suppression threshold and slow/halted
        if (nearbySupply.suppressionLevel >= SUPPRESSION_PIN_THRESHOLD ||
            nearbySupply.speedState === 'fast') {
            unit.isBeingResupplied = false;
            continue;
        }
        // Trickle resupply: (startingAmmo / 180) per second per ammo type
        unit.isBeingResupplied = true;
        resupplyUnit(unit);
        resuppliedUnitIds.push(unit.instanceId);
    }
    return { resuppliedUnitIds };
}
function findNearbySupplyUnit(unit, supplyUnits, _spatialHash) {
    // TODO: Use spatial hash for efficient range query
    for (const supply of supplyUnits) {
        const dx = unit.posX - supply.posX;
        const dz = unit.posZ - supply.posZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= SUPPLY_RANGE_M)
            return supply;
    }
    return null;
}
function resupplyUnit(unit) {
    // TODO: Look up starting ammo from UnitType via registry
    // Trickle rate = startingAmmo / 180 per second per type
    // For each weapon slot, add trickle to current ammo (capped at starting max)
    for (let slot = 0; slot < 4; slot++) {
        const ammo = unit.ammo[slot];
        if (!ammo)
            continue;
        // Placeholder: add 1 round per type per second
        // Real impl needs starting values from UnitType.weapons[slot]
        ammo.he = Math.min(ammo.he + 1, 999); // TODO: cap at starting value
        ammo.ap = Math.min(ammo.ap + 1, 999);
    }
}
