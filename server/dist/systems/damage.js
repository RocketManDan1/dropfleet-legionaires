// ============================================================================
// PHASE 6: DAMAGE APPLICATION — Milestone 2
// Source: Combat Formula Spec.md §1 (To-Hit), §6-9 (Penetration), §10 (Kill)
//
// Processes ShotRecord array from Phase 5, resolves hit/pen/damage per shot.
// Dead units flagged here are skipped in Phase 7 (Suppression).
// ============================================================================
/**
 * Phase 6: Damage Application.
 * For each ShotRecord, roll to-hit, then penetration, then crew damage.
 */
export function applyDamage(shotRecords, units, tick) {
    const damageResults = [];
    const destroyedUnitIds = [];
    for (const shot of shotRecords) {
        const target = units.get(shot.targetId);
        if (!target || target.isDestroyed)
            continue;
        // --- Step 1: To-Hit roll ---
        const hitResult = rollToHit(shot, units);
        if (!hitResult.isHit)
            continue; // miss — still generates suppression (Phase 7)
        // --- Step 2: Determine impact facing ---
        const facing = determineImpactFacing(shot, target);
        // --- Step 3: Penetration roll ---
        const penResult = rollPenetration(shot, target, facing);
        if (!penResult.isPenetration) {
            // Bounce — no crew damage, but still suppression
            damageResults.push({
                targetId: target.instanceId,
                crewLost: 0,
                systemDamage: [],
                isDestroyed: false,
                isBailedOut: false,
                isImmobilized: false,
            });
            continue;
        }
        // --- Step 4: Crew damage ---
        const crewLost = rollCrewDamage(shot, target);
        target.crewCurrent = Math.max(0, target.crewCurrent - crewLost);
        // --- Step 5: System damage ---
        const systemDamage = rollSystemDamage(shot, target);
        // --- Step 6: ERA depletion ---
        if (penResult.eraConsumed) {
            depleteERA(target, facing);
        }
        // --- Step 7: Check destruction ---
        const isDestroyed = target.crewCurrent <= 0;
        if (isDestroyed) {
            target.isDestroyed = true;
            target.destroyedAtTick = tick;
            destroyedUnitIds.push(target.instanceId);
        }
        damageResults.push({
            targetId: target.instanceId,
            crewLost,
            systemDamage,
            isDestroyed,
            isBailedOut: false, // TODO: bail-out check for vehicles
            isImmobilized: systemDamage.some(d => d.type === 'engine_hit'),
        });
    }
    return { damageResults, destroyedUnitIds };
}
// --- To-Hit formula (Combat Formula Spec §1) ---
function rollToHit(shot, units) {
    const firer = units.get(shot.firerId);
    const target = units.get(shot.targetId);
    if (!firer || !target)
        return { hitChance: 0, roll: 1, isHit: false };
    // TODO: Implement full formula:
    // baseChance = weapon.acc × (fc_modifier) × (range_modifier) × (target_size_modifier)
    //            × (speed_modifier) × (stabilizer_modifier) × (entrench_modifier)
    const hitChance = 0.5; // placeholder
    const roll = Math.random();
    return { hitChance, roll, isHit: roll < hitChance };
}
function determineImpactFacing(shot, target) {
    // TODO: Calculate angle from shot.fromPos to target position relative to target.heading
    // 0-60° from front = front, 60-120° = side, 120-180° = rear
    // Turret vs hull based on shot trajectory vs turret heading
    return 'hullFront';
}
// --- Penetration formula (Combat Formula Spec §6-9) ---
function rollPenetration(shot, target, facing) {
    // TODO: Implement full penetration model:
    // penValue = weapon pen for ammo type
    // armourValue = target.steelArmour[facing] or target.heatArmour[facing]
    // eraValue = target.eraRemaining[facing] if HEAT/Sabot
    // penChance = penValue / armourValue (simplified)
    const penChance = 0.5;
    const roll = Math.random();
    return {
        penChance,
        roll,
        isPenetration: roll < penChance,
        eraConsumed: false, // TODO: ERA check for HEAT rounds
    };
}
// --- Crew damage (Combat Formula Spec §10) ---
function rollCrewDamage(_shot, target) {
    // TODO: Based on survivability rating (0-6)
    // Higher survivability = fewer crew lost per penetration
    // Base: 1-3 crew lost, modified by survivability
    const baseDamage = 1;
    return Math.min(baseDamage, target.crewCurrent);
}
// --- System damage rolls ---
function rollSystemDamage(_shot, _target) {
    // TODO: Random system damage on penetration
    // Possible: gun_damaged, turret_jammed, engine_hit, optics_damaged, ammo_cook_off
    // Probability based on shot location and target type
    return [];
}
// --- ERA depletion ---
function depleteERA(target, facing) {
    // Strip the facing component from the key (e.g. 'hullFront' → access eraRemaining.hullFront)
    const facingKey = facing;
    const current = target.eraRemaining[facingKey];
    if (current !== undefined && current > 0) {
        target.eraRemaining[facingKey] = current - 1;
    }
}
