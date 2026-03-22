// ============================================================================
// PHASE 7: SUPPRESSION & MORALE — Milestone 2
// Source: Combat Formula Spec.md §2-3, SERVER_GAME_LOOP.md
//
// Suppression accumulates from hits and near-misses (event-driven).
// Decay and morale transitions run every second (tick % 20 === 0).
// ============================================================================
import { SUPPRESSION_PIN_THRESHOLD, SUPPRESSION_ROUTE_THRESHOLD, SUPPRESSION_SURRENDER_THRESHOLD, RALLY_COOLDOWN_SEC, TICKS_PER_SEC, } from '@legionaires/shared';
/**
 * Phase 7: Suppression & Morale.
 *
 * Called every tick for event-driven accumulation (impacts this tick),
 * and every second for decay + morale state transitions.
 */
export function updateSuppression(units, impacts, tick, isSecondTick) {
    const moraleChanges = [];
    const routingUnitIds = [];
    const surrenderedUnitIds = [];
    // --- Step 1: Accumulate suppression from impacts ---
    for (const impact of impacts) {
        const unit = units.get(impact.targetId);
        if (!unit || unit.isDestroyed)
            continue;
        const delta = calculateSuppressionDelta(impact);
        unit.suppressionLevel = Math.min(100, unit.suppressionLevel + delta);
    }
    // --- Step 2: Decay and morale transitions (every second) ---
    if (isSecondTick) {
        for (const [_id, unit] of units) {
            if (unit.isDestroyed || unit.moraleState === 'surrendered')
                continue;
            // Decay suppression
            const decayRate = getDecayRate(unit.moraleState);
            unit.suppressionLevel = Math.max(0, unit.suppressionLevel - decayRate);
            // Evaluate morale state transitions
            const oldState = unit.moraleState;
            const newState = evaluateMoraleState(unit, tick);
            if (newState !== oldState) {
                unit.moraleState = newState;
                moraleChanges.push({ unitId: unit.instanceId, oldState, newState });
                if (newState === 'routing')
                    routingUnitIds.push(unit.instanceId);
                if (newState === 'surrendered')
                    surrenderedUnitIds.push(unit.instanceId);
            }
        }
    }
    return { moraleChanges, routingUnitIds, surrenderedUnitIds };
}
// --- Suppression delta calculation ---
function calculateSuppressionDelta(impact) {
    // TODO: Full formula from Combat Formula Spec §2
    // Base suppression = warheadSize × hitTypeMod × rangeMod
    // Direct hit: ×2.0
    // Near miss: ×1.0 × (1 - nearMissDistance/50)  (falls off with distance)
    if (impact.isDirectHit) {
        return Math.min(30, impact.warheadSize * 2.0);
    }
    if (impact.isNearMiss) {
        const falloff = Math.max(0, 1 - impact.nearMissDistanceM / 50);
        return Math.min(20, impact.warheadSize * falloff);
    }
    return 0;
}
// --- Suppression decay rates (Combat Formula Spec §3) ---
function getDecayRate(moraleState) {
    switch (moraleState) {
        case 'normal': return 5; // 5 points/sec — fast recovery when calm
        case 'pinned': return 3; // 3 points/sec — slower under pressure
        case 'routing': return 1; // 1 point/sec — very slow while fleeing
        default: return 0; // surrendered units don't decay
    }
}
// --- Morale state machine ---
function evaluateMoraleState(unit, tick) {
    const sup = unit.suppressionLevel;
    // Escalation: check from highest to lowest
    if (sup >= SUPPRESSION_SURRENDER_THRESHOLD) {
        return 'surrendered';
    }
    if (sup >= SUPPRESSION_ROUTE_THRESHOLD) {
        return 'routing';
    }
    if (sup >= SUPPRESSION_PIN_THRESHOLD) {
        return 'pinned';
    }
    // De-escalation: can only rally if suppression dropped below pin threshold
    // and rally cooldown has elapsed
    if (unit.moraleState === 'pinned' && sup < SUPPRESSION_PIN_THRESHOLD) {
        return 'normal';
    }
    if (unit.moraleState === 'routing' && sup < SUPPRESSION_PIN_THRESHOLD) {
        const cooldownTicks = RALLY_COOLDOWN_SEC * TICKS_PER_SEC;
        if (tick - unit.lastRalliedAtTick >= cooldownTicks) {
            // TODO: Rally check — requires C2 range and radio roll
            return 'normal';
        }
        return 'routing'; // still routing, cooldown not elapsed
    }
    return unit.moraleState;
}
/**
 * Apply rally to a unit (called from order processing when RALLY order accepted).
 */
export function attemptRally(unit, tick) {
    const cooldownTicks = RALLY_COOLDOWN_SEC * TICKS_PER_SEC;
    if (tick - unit.lastRalliedAtTick < cooldownTicks)
        return false;
    if (unit.moraleState !== 'routing' && unit.moraleState !== 'pinned')
        return false;
    // TODO: C2 radio range check, radio chance roll
    unit.lastRalliedAtTick = tick;
    unit.suppressionLevel = Math.max(0, unit.suppressionLevel - 30);
    unit.moraleState = 'normal';
    return true;
}
