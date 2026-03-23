// ============================================================================
// PHASE 5: FIRE RESOLUTION — Milestone 2
// Source: SERVER_GAME_LOOP.md, Combat Formula Spec.md
//
// Sub-phase ordering (from C10 fix):
//   5a. Auto-fire checks (FREE_FIRE posture, autonomous engagement)
//   5b. Player ENGAGE orders (explicit fire commands)
//   A unit cannot fire twice in the same tick regardless of source.
// ============================================================================
import { TIER_DETECTED_MIN, } from '@legionaires/shared';
// --- Main phase entry point ---
/**
 * Phase 5: Fire Resolution.
 * Processes auto-fire and player engage orders, produces ShotRecord array
 * for Phase 6 (Damage Application).
 */
export function resolveFire(units, contacts, playerFireOrders, tick, unitTypes) {
    const shotRecords = [];
    const rejectedOrders = [];
    // --- 5a: Auto-fire (FREE_FIRE posture units) ---
    for (const [_id, unit] of units) {
        if (unit.isDestroyed || unit.moraleState === 'surrendered')
            continue;
        if (unit.firePosture !== 'free_fire')
            continue;
        if (unit.firedThisTick)
            continue;
        const target = selectAutoFireTarget(unit, units, contacts);
        if (!target)
            continue;
        const shot = attemptFire(unit, target, units, contacts, tick, undefined, unitTypes ?? null);
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
        const shot = attemptFire(unit, targetUnit, units, contacts, tick, order.weaponSlot, unitTypes ?? null);
        if (shot) {
            shotRecords.push(shot);
            unit.firedThisTick = true;
        }
        else {
            rejectedOrders.push({ unitId: order.unitId, reason: 'FIRE_FAILED' });
        }
    }
    return { shotRecords, rejectedOrders };
}
// --- Helper: attempt to fire one shot ---
function attemptFire(firer, target, units, contacts, tick, preferredSlot, unitTypes) {
    // 1. DETECTED gate: firer must have target at DETECTED+ in own accumulator
    const firerContacts = contacts.get(firer.ownerId);
    const contact = firerContacts?.get(target.instanceId);
    if (!contact || contact.detectionValue < TIER_DETECTED_MIN)
        return null;
    // 2. Select weapon slot
    const slot = preferredSlot ?? selectBestWeaponSlot(firer, target);
    if (slot === null)
        return null;
    // 3. Check ammo
    const ammo = firer.ammo[slot];
    if (!ammo || (ammo.he + ammo.ap + ammo.heat + ammo.sabot) <= 0)
        return null;
    // 4. Check cooldown
    if (firer.weaponCooldowns[slot] > 0)
        return null;
    // 5. Check range
    const range = distance(firer, target);
    const firerType = unitTypes?.get(firer.unitTypeId);
    const weapon = firerType?.weapons[slot] ?? null;
    const weaponMaxRange = weapon?.rangeM ?? 2000;
    if (range > weaponMaxRange)
        return null;
    // 6. Check suppression threshold
    if (firer.suppressionLevel >= 40 && firer.moraleState === 'pinned')
        return null;
    // 7. Select ammo type
    const ammoType = selectAmmoType(ammo, target);
    // 8. Consume ammo and apply cooldown
    if (ammoType === 'HE')
        ammo.he = Math.max(0, ammo.he - 1);
    if (ammoType === 'AP')
        ammo.ap = Math.max(0, ammo.ap - 1);
    if (ammoType === 'HEAT')
        ammo.heat = Math.max(0, ammo.heat - 1);
    if (ammoType === 'Sabot')
        ammo.sabot = Math.max(0, ammo.sabot - 1);
    firer.weaponCooldowns[slot] = 10;
    firer.lastFireTick = tick;
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
function selectAutoFireTarget(firer, units, contacts) {
    const firerContacts = contacts.get(firer.ownerId);
    if (!firerContacts)
        return null;
    let best = null;
    let bestRange = Number.POSITIVE_INFINITY;
    for (const [contactId, contact] of firerContacts) {
        if (contact.detectionValue < TIER_DETECTED_MIN)
            continue;
        const target = units.get(contactId);
        if (!target || target.isDestroyed || target.ownerId === firer.ownerId)
            continue;
        const range = distance(firer, target);
        if (range < bestRange) {
            best = target;
            bestRange = range;
        }
    }
    return best;
}
// --- Helper: weapon slot selection ---
function selectBestWeaponSlot(firer, target) {
    const targetLooksArmored = target.steelArmour.hullFront > 20 || target.steelArmour.turretFront > 20;
    const preferredOrder = targetLooksArmored
        ? ['sabot', 'ap', 'heat', 'he']
        : ['he', 'ap', 'heat', 'sabot'];
    for (const ammoType of preferredOrder) {
        for (let slot = 0; slot < firer.ammo.length; slot++) {
            const ammo = firer.ammo[slot];
            if (!ammo)
                continue;
            if (firer.weaponCooldowns[slot] > 0)
                continue;
            if (ammo[ammoType] > 0)
                return slot;
        }
    }
    return null;
}
// --- Helper: ammo type selection ---
function selectAmmoType(ammo, _target) {
    // TODO: Select based on target armour type
    // Sabot > AP > HEAT for armoured; HE for infantry
    if (ammo.sabot > 0)
        return 'Sabot';
    if (ammo.ap > 0)
        return 'AP';
    if (ammo.heat > 0)
        return 'HEAT';
    return 'HE';
}
// --- Utility ---
function distance(a, b) {
    const dx = a.posX - b.posX;
    const dz = a.posZ - b.posZ;
    return Math.sqrt(dx * dx + dz * dz);
}
