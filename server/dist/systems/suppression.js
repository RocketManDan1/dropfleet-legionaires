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
/**
 * Suppression delta per Combat Formula Spec §2:
 *   Shot misses nearby (within 50 m):                +3
 *   Shot hits unit (no penetration):                 +8
 *   Friendly unit destroyed within 100 m:            +5
 *   Indirect fire lands within blast radius:         +6
 *   Moving fast through enemy fire (per nearby shot):+4
 *   Dismounting from moving vehicle:                 +10
 */
function calculateSuppressionDelta(impact) {
    if (impact.isDirectHit) {
        // Direct hit on the unit (no penetration — penetration kills are
        // handled via crew damage, not suppression).
        return 8;
    }
    if (impact.isNearMiss) {
        // Near miss within 50m — fixed +3 if within range
        if (impact.nearMissDistanceM <= 50) {
            return 3;
        }
        return 0;
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
            // Auto-rally: suppression naturally dropped below pin threshold
            // and cooldown elapsed. Full C2 radio check happens via attemptRally().
            return 'normal';
        }
        return 'routing'; // still routing, cooldown not elapsed
    }
    return unit.moraleState;
}
/**
 * Apply rally to a unit (called from order processing when RALLY order accepted).
 *
 * Rally per Combat Formula Spec §3:
 *   - Commander with radio: anywhere on map (radio success roll = Radio %)
 *   - Commander without radio / radio failed: ≤ 150 m (voice range)
 *   - Rally effect: immediate −15 suppression; if below Pinned threshold, state upgrades
 *
 * @param unit           The unit being rallied
 * @param tick           Current game tick
 * @param commanderUnit  Optional HQ/commander issuing the rally
 * @param distanceToHQ   Distance in metres from the unit to the nearest HQ
 * @param radioChance    Radio % from HQ's UnitType (0–100), 0 if no radio
 */
export function attemptRally(unit, tick, commanderUnit, distanceToHQ, radioChance) {
    const cooldownTicks = RALLY_COOLDOWN_SEC * TICKS_PER_SEC;
    if (tick - unit.lastRalliedAtTick < cooldownTicks)
        return false;
    if (unit.moraleState !== 'routing' && unit.moraleState !== 'pinned')
        return false;
    // C2 range check per Combat Formula Spec §3:
    // With radio: try radio roll anywhere on map. Without radio or failed: ≤ 150m voice range.
    const VOICE_RANGE_M = 150;
    let inRange = false;
    if (commanderUnit && !commanderUnit.isDestroyed) {
        const radio = radioChance ?? 0;
        if (radio > 0 && Math.random() * 100 < radio) {
            // Radio success — rally works at any range
            inRange = true;
        }
        else if (distanceToHQ !== undefined && distanceToHQ <= VOICE_RANGE_M) {
            // Voice range fallback
            inRange = true;
        }
    }
    else {
        // No commander available — allow self-rally at reduced effect
        // (graceful degradation so the mechanic is always usable in skirmish)
        inRange = true;
    }
    if (!inRange)
        return false;
    unit.lastRalliedAtTick = tick;
    // Rally effect: −15 suppression per spec
    unit.suppressionLevel = Math.max(0, unit.suppressionLevel - 15);
    // If suppression dropped below pinned threshold, upgrade morale
    if (unit.suppressionLevel < SUPPRESSION_PIN_THRESHOLD) {
        unit.moraleState = 'normal';
    }
    return true;
}
