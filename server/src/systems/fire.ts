// ============================================================================
// PHASE 5: FIRE RESOLUTION — Milestone 2
// Source: SERVER_GAME_LOOP.md, Combat Formula Spec.md
//
// Sub-phase ordering (from C10 fix):
//   5a. Auto-fire checks (FREE_FIRE posture, autonomous engagement)
//   5b. Player ENGAGE orders (explicit fire commands)
//   A unit cannot fire twice in the same tick regardless of source.
// ============================================================================

import type {
  Vec2, UnitInstance, ContactEntry, ShotRecord,
} from '@legionaires/shared';
import {
  TIER_DETECTED_MIN,
} from '@legionaires/shared';

// --- Inputs and outputs ---

export interface FireOrder {
  unitId: string;
  targetUnitId: string;
  weaponSlot?: number;        // null = auto-select best weapon
}

export interface FirePhaseResult {
  shotRecords: ShotRecord[];
  rejectedOrders: Array<{ unitId: string; reason: string }>;
}

// --- Main phase entry point ---

/**
 * Phase 5: Fire Resolution.
 * Processes auto-fire and player engage orders, produces ShotRecord array
 * for Phase 6 (Damage Application).
 */
export function resolveFire(
  units: Map<string, UnitInstance>,
  contacts: Map<string, Map<string, ContactEntry>>,
  playerFireOrders: FireOrder[],
  tick: number,
): FirePhaseResult {
  const shotRecords: ShotRecord[] = [];
  const rejectedOrders: Array<{ unitId: string; reason: string }> = [];

  // --- 5a: Auto-fire (FREE_FIRE posture units) ---
  for (const [_id, unit] of units) {
    if (unit.isDestroyed || unit.moraleState === 'surrendered') continue;
    if (unit.firePosture !== 'free_fire') continue;
    if (unit.firedThisTick) continue;

    const target = selectAutoFireTarget(unit, units, contacts);
    if (!target) continue;

    const shot = attemptFire(unit, target, units, contacts, tick);
    if (shot) {
      shotRecords.push(shot);
      unit.firedThisTick = true;
    }
  }

  // --- 5b: Player ENGAGE orders ---
  for (const order of playerFireOrders) {
    const unit = units.get(order.unitId);
    if (!unit) {
      rejectedOrders.push({ unitId: order.unitId, reason: 'UNIT_NOT_FOUND' });
      continue;
    }

    // Unit already fired this tick (auto-fire beat the order)
    if (unit.firedThisTick) {
      rejectedOrders.push({ unitId: order.unitId, reason: 'WEAPON_COOLDOWN' });
      continue;
    }

    const targetUnit = units.get(order.targetUnitId);
    if (!targetUnit) {
      rejectedOrders.push({ unitId: order.unitId, reason: 'TARGET_NOT_FOUND' });
      continue;
    }

    const shot = attemptFire(unit, targetUnit, units, contacts, tick, order.weaponSlot);
    if (shot) {
      shotRecords.push(shot);
      unit.firedThisTick = true;
    } else {
      rejectedOrders.push({ unitId: order.unitId, reason: 'FIRE_FAILED' });
    }
  }

  return { shotRecords, rejectedOrders };
}

// --- Helper: attempt to fire one shot ---

function attemptFire(
  firer: UnitInstance,
  target: UnitInstance,
  units: Map<string, UnitInstance>,
  contacts: Map<string, Map<string, ContactEntry>>,
  tick: number,
  preferredSlot?: number,
): ShotRecord | null {
  // 1. DETECTED gate: firer must have target at DETECTED+ in own accumulator
  const firerContacts = contacts.get(firer.ownerId);
  const contact = firerContacts?.get(target.instanceId);
  if (!contact || contact.detectionValue < TIER_DETECTED_MIN) return null;

  // 2. Select weapon slot
  const slot = preferredSlot ?? selectBestWeaponSlot(firer, target);
  if (slot === null) return null;

  // 3. Check ammo
  const ammo = firer.ammo[slot];
  if (!ammo || (ammo.he + ammo.ap + ammo.heat + ammo.sabot) <= 0) return null;

  // 4. Check cooldown
  if (firer.weaponCooldowns[slot] > 0) return null;

  // 5. Check range
  const range = distance(firer, target);
  // TODO: get weapon maxRange from UnitType registry lookup
  // if (range > weapon.rangeM) return null;

  // 6. Check suppression threshold
  if (firer.suppressionLevel >= 40 && firer.moraleState === 'pinned') return null;

  // 7. Select ammo type
  const ammoType = selectAmmoType(ammo, target);

  // 8. Consume ammo and apply cooldown
  // TODO: decrement ammo[slot][ammoType], set cooldown from weapon ROF

  // 9. Build shot record
  return {
    shotId: `shot_${tick}_${firer.instanceId}_${slot}`,
    firerId: firer.instanceId,
    targetId: target.instanceId,
    weaponSlot: slot,
    ammoType,
    fromPos: { x: firer.posX, z: firer.posZ },
    toPos: { x: target.posX, z: target.posZ },
    range,
    tick,
  };
}

// --- Helper: auto-fire target selection ---

function selectAutoFireTarget(
  firer: UnitInstance,
  _units: Map<string, UnitInstance>,
  _contacts: Map<string, Map<string, ContactEntry>>,
): UnitInstance | null {
  // TODO: Select highest-priority DETECTED+ enemy within weapon range
  // Priority: closest threat, then highest value
  return null;
}

// --- Helper: weapon slot selection ---

function selectBestWeaponSlot(
  _firer: UnitInstance,
  _target: UnitInstance,
): number | null {
  // TODO: Select slot with ammo, in range, best damage vs target type
  // Prefer AP/Sabot vs armoured, HE vs infantry
  return 0;
}

// --- Helper: ammo type selection ---

function selectAmmoType(
  ammo: { he: number; ap: number; heat: number; sabot: number },
  _target: UnitInstance,
): 'HE' | 'AP' | 'HEAT' | 'Sabot' {
  // TODO: Select based on target armour type
  // Sabot > AP > HEAT for armoured; HE for infantry
  if (ammo.sabot > 0) return 'Sabot';
  if (ammo.ap > 0) return 'AP';
  if (ammo.heat > 0) return 'HEAT';
  return 'HE';
}

// --- Utility ---

function distance(a: UnitInstance, b: UnitInstance): number {
  const dx = a.posX - b.posX;
  const dz = a.posZ - b.posZ;
  return Math.sqrt(dx * dx + dz * dz);
}
