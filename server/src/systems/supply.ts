// ============================================================================
// PHASE 8: SUPPLY TICK — Milestone 2
// Source: Unit Schema Spec.md §Supply Model, SERVER_GAME_LOOP.md
//
// Runs every second (tick % 20 === 0).
// Units within 150m of a supply vehicle, both below suppression 40
// and at 'slow' speed or slower, receive trickle resupply.
// ============================================================================

import type { UnitInstance } from '@legionaires/shared';
import { SUPPLY_RANGE_M, SUPPRESSION_PIN_THRESHOLD } from '@legionaires/shared';
import type { SpatialHash } from '../game/spatial-hash.js';
import type { UnitRegistry } from '../data/unit-registry.js';

export interface SupplyPhaseResult {
  resuppliedUnitIds: string[];
}

/**
 * Phase 8: Supply Tick.
 * Trickle ammo resupply from nearby supply vehicles.
 */
export function tickSupply(
  units: Map<string, UnitInstance>,
  spatialHash: SpatialHash,
  _dt: number,
  unitTypes?: UnitRegistry | null,
): SupplyPhaseResult {
  const resuppliedUnitIds: string[] = [];

  // Find all supply vehicles (unitClass === 'supply')
  const supplyUnits: UnitInstance[] = [];
  for (const [_id, unit] of units) {
    if (unit.isDestroyed) continue;
    const ut = unitTypes?.get(unit.unitTypeId);
    if (ut?.unitClass === 'supply') {
      supplyUnits.push(unit);
    }
  }

  for (const [_id, unit] of units) {
    if (unit.isDestroyed) continue;
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
    resupplyUnit(unit, unitTypes ?? null);
    resuppliedUnitIds.push(unit.instanceId);
  }

  return { resuppliedUnitIds };
}

function findNearbySupplyUnit(
  unit: UnitInstance,
  supplyUnits: UnitInstance[],
  _spatialHash: SpatialHash,
): UnitInstance | null {
  // TODO: Use spatial hash for efficient range query
  for (const supply of supplyUnits) {
    const dx = unit.posX - supply.posX;
    const dz = unit.posZ - supply.posZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= SUPPLY_RANGE_M) return supply;
  }
  return null;
}

function resupplyUnit(unit: UnitInstance, unitTypes: UnitRegistry | null): void {
  const ut = unitTypes?.get(unit.unitTypeId);
  for (let slot = 0; slot < 4; slot++) {
    const ammo = unit.ammo[slot];
    if (!ammo) continue;
    const wpn = ut?.weapons[slot];
    const startHE = wpn?.ammoHE ?? 50;
    const startAP = wpn?.ammoAP ?? 20;
    const startHEAT = wpn?.ammoHEAT ?? 0;
    const startSabot = wpn?.ammoSabot ?? 0;
    // Trickle rate: startingAmmo / 180 per second
    ammo.he = Math.min(ammo.he + startHE / 180, startHE);
    ammo.ap = Math.min(ammo.ap + startAP / 180, startAP);
    ammo.heat = Math.min(ammo.heat + startHEAT / 180, startHEAT);
    ammo.sabot = Math.min(ammo.sabot + startSabot / 180, startSabot);
  }
}
