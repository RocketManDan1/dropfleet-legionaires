// ============================================================================
// THEATER SUPPORT MANAGER — Artillery, air strikes, orbital bombardment
// Milestone 6: Full Alpha
// Source: THEATER_SUPPORT.md, AUTHORITATIVE_CONTRACTS.md
// ============================================================================
import { TICKS_PER_SEC, } from '@legionaires/shared/constants';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Strike types and their properties. */
const STRIKE_CONFIGS = {
    artillery: {
        /** Delay from request to impact, in seconds. */
        delaySeconds: 30,
        /** Blast radius in metres. */
        blastRadiusM: 75,
        /** Base damage (HE-equivalent warhead size). */
        warheadSize: 20,
        /** Number of rounds in the barrage. */
        roundCount: 6,
        /** Spread within the blast radius (metres). */
        spreadM: 40,
        /** Can be intercepted by AA? */
        aaInterceptable: false,
        /** Suppression added to units in the blast radius. */
        baseSuppression: 35,
    },
    air_strike: {
        delaySeconds: 45,
        blastRadiusM: 100,
        warheadSize: 25,
        roundCount: 2, // two bomb drops
        spreadM: 30,
        aaInterceptable: true,
        baseSuppression: 45,
    },
    orbital: {
        delaySeconds: 60,
        blastRadiusM: 150,
        warheadSize: 30,
        roundCount: 1, // single devastating impact
        spreadM: 10,
        aaInterceptable: false,
        baseSuppression: 60,
    },
};
/**
 * AA interception chance per AA unit within range.
 * 30% per AA unit within 500m of the flight path.
 */
const AA_INTERCEPT_CHANCE_PER_UNIT = 0.30;
const AA_INTERCEPT_RANGE_M = 500;
/**
 * Khroshi EW delay extension: when fighting Khroshi, strikes take longer
 * due to electronic warfare interference. Multiplier on base delay.
 */
const KHROSHI_EW_DELAY_MULTIPLIER = 1.5;
/**
 * Forward Observer (FO) bonus: if an FO unit has LOS to the target,
 * the delay is reduced by this fraction.
 */
const FO_DELAY_REDUCTION = 0.5;
// ---------------------------------------------------------------------------
// TheaterSupportManager
// ---------------------------------------------------------------------------
/**
 * Manages all off-map support assets: artillery barrages, air strikes, and
 * orbital bombardment.
 *
 * Lifecycle of a strike:
 *
 * 1. **Request** — Player sends THEATER_SUPPORT message with target position
 *    and optional FO (Forward Observer) unit ID.
 *
 * 2. **Validation** — Check:
 *    - Strike type is available (not exhausted).
 *    - If FO specified: FO must have LOS to target and not be suppressed.
 *    - If no FO: strike still works, but with full delay (no reduction).
 *
 * 3. **Delay** — Strike enters the delay queue:
 *    - Base delay depends on type (arty=30s, air=45s, orbital=60s).
 *    - FO bonus: delay * 0.5 if FO has LOS.
 *    - Khroshi EW: delay * 1.5 when fighting Khroshi (electronic warfare).
 *
 * 4. **AA interception** (air strikes only) — At impact time, check for
 *    enemy AA units within 500m of the target. Each AA unit has a 30%
 *    chance to intercept. If intercepted, the strike is cancelled.
 *
 * 5. **Impact** — Apply blast damage to all units within the blast radius.
 *    Damage falls off linearly with distance from impact center.
 *    All affected units receive suppression.
 */
export class TheaterSupportManager {
    /** All currently in-flight strikes. */
    activeStrikes = new Map();
    /** Remaining strike counts per type for this mission. */
    remaining = {
        artillery: 3, // TODO: Load from mission/difficulty config
        air_strike: 2,
        orbital: 1,
    };
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------
    /**
     * Set the available strike counts for a mission.
     * Called during mission setup based on difficulty profile.
     */
    setAvailableStrikes(artillery, airStrikes, orbital) {
        this.remaining.artillery = artillery;
        this.remaining.air_strike = airStrikes;
        this.remaining.orbital = orbital;
    }
    /**
     * Get the current remaining strike counts.
     */
    getRemainingStrikes() {
        return { ...this.remaining };
    }
    // -----------------------------------------------------------------------
    // Request a strike
    // -----------------------------------------------------------------------
    /**
     * Request a new theater support strike.
     *
     * @param type            - Type of strike (artillery / air_strike / orbital).
     * @param targetPos       - World-space position to hit.
     * @param requestingPlayerId - The player making the request.
     * @param currentTick     - The current server tick.
     * @param observerUnitId  - Optional FO unit providing targeting bonus.
     * @returns StrikeRequestResult with the strike ID and ETA on success.
     */
    requestStrike(type, targetPos, requestingPlayerId, currentTick, observerUnitId) {
        // --- Check availability ---
        if (this.remaining[type] <= 0) {
            return { success: false, error: `No ${type} strikes remaining` };
        }
        // --- Validate FO if specified ---
        let foValid = false;
        if (observerUnitId) {
            const foUnit = this.deps.getUnit(observerUnitId);
            if (!foUnit) {
                return { success: false, error: 'Observer unit not found' };
            }
            if (foUnit.isDestroyed) {
                return { success: false, error: 'Observer unit is destroyed' };
            }
            // FO must not be suppressed beyond PIN threshold (40)
            if (foUnit.suppressionLevel >= 40) {
                return {
                    success: false,
                    error: 'Observer unit is too suppressed to call in support',
                };
            }
            // FO must have LOS to target
            if (!this.deps.hasLOS(observerUnitId, targetPos)) {
                return { success: false, error: 'Observer unit has no LOS to target' };
            }
            foValid = true;
        }
        // --- Calculate delay ---
        const config = STRIKE_CONFIGS[type];
        let delaySec = config.delaySeconds;
        // FO bonus: halve the delay
        if (foValid) {
            delaySec *= FO_DELAY_REDUCTION;
        }
        // Khroshi EW penalty: multiply delay by 1.5
        if (this.deps.getEnemyFaction() === 'khroshi') {
            delaySec *= KHROSHI_EW_DELAY_MULTIPLIER;
        }
        const delayTicks = Math.ceil(delaySec * TICKS_PER_SEC);
        const impactTick = currentTick + delayTicks;
        // --- Create the active strike ---
        const strikeId = this.deps.generateId();
        const strike = {
            strikeId,
            type,
            requestingPlayerId,
            targetPos: { ...targetPos },
            observerUnitId: observerUnitId ?? null,
            requestedAtTick: currentTick,
            impactTick,
            intercepted: false,
            resolved: false,
        };
        this.activeStrikes.set(strikeId, strike);
        this.remaining[type]--;
        return {
            success: true,
            strikeId,
            impactTick,
        };
    }
    // -----------------------------------------------------------------------
    // Tick processing
    // -----------------------------------------------------------------------
    /**
     * Process all active strikes. Called once per tick from the game loop.
     * Checks for strikes that have reached their impact tick and resolves them.
     *
     * @param currentTick - The current server tick.
     * @returns Array of impact results for strikes that resolved this tick.
     */
    tick(currentTick) {
        const results = [];
        for (const [strikeId, strike] of this.activeStrikes) {
            if (strike.resolved)
                continue;
            if (currentTick < strike.impactTick)
                continue;
            // Time to resolve this strike
            const result = this.resolveStrike(strike);
            results.push(result);
            strike.resolved = true;
            this.activeStrikes.delete(strikeId);
        }
        return results;
    }
    // -----------------------------------------------------------------------
    // Strike resolution
    // -----------------------------------------------------------------------
    /**
     * Resolve a strike at impact time.
     *
     * 1. For air strikes: roll AA interception.
     * 2. If not intercepted: apply blast damage to all units in radius.
     */
    resolveStrike(strike) {
        const config = STRIKE_CONFIGS[strike.type];
        // --- AA interception (air strikes only) ---
        if (config.aaInterceptable) {
            const intercepted = this.rollAAInterception(strike.targetPos);
            if (intercepted) {
                strike.intercepted = true;
                return {
                    strikeId: strike.strikeId,
                    type: strike.type,
                    targetPos: strike.targetPos,
                    wasIntercepted: true,
                    damageResults: [],
                };
            }
        }
        // --- Apply blast damage ---
        const damageResults = this.applyBlastDamage(strike.targetPos, config);
        return {
            strikeId: strike.strikeId,
            type: strike.type,
            targetPos: strike.targetPos,
            wasIntercepted: false,
            damageResults,
        };
    }
    /**
     * Roll AA interception for an air strike.
     *
     * Each enemy AA unit within AA_INTERCEPT_RANGE_M (500m) of the target
     * position has an AA_INTERCEPT_CHANCE_PER_UNIT (30%) chance to intercept.
     * Multiple AA units stack independently (each gets its own roll).
     *
     * @param targetPos - The strike target position.
     * @returns True if the strike was intercepted.
     */
    rollAAInterception(targetPos) {
        const nearbyUnits = this.deps.getUnitsInRadius(targetPos, AA_INTERCEPT_RANGE_M);
        // Filter to only enemy AA units that are alive and not suppressed
        const aaUnits = nearbyUnits.filter(unit => {
            if (unit.isDestroyed)
                return false;
            // Check if this is an AA unit class
            // TODO: Use a lookup from the UnitType data rather than hardcoding
            const aaClasses = ['aa_vehicle', 'aa_infantry'];
            // We'd need access to the unit's class, which isn't directly on UnitInstance.
            // For now, check via unitTypeId naming convention.
            // TODO: Proper lookup via UnitType registry
            return unit.unitTypeId.includes('aa');
        });
        // Each AA unit rolls independently
        for (const aaUnit of aaUnits) {
            if (Math.random() < AA_INTERCEPT_CHANCE_PER_UNIT) {
                return true; // Intercepted!
            }
        }
        return false; // Not intercepted
    }
    /**
     * Apply blast radius damage to all units near the impact point.
     *
     * Damage model:
     * - Full damage at center, linear falloff to zero at blast radius edge.
     * - Each round in the barrage hits independently (with spread).
     * - Suppression is applied to all units in the radius regardless of damage.
     *
     * @param impactPos - Center of the blast.
     * @param config    - Strike configuration.
     * @returns Array of per-unit damage results.
     */
    applyBlastDamage(impactPos, config) {
        const results = new Map();
        // Get all units in the expanded blast radius (account for spread)
        const searchRadius = config.blastRadiusM + config.spreadM;
        const nearbyUnits = this.deps.getUnitsInRadius(impactPos, searchRadius);
        // Process each round in the barrage
        for (let round = 0; round < config.roundCount; round++) {
            // Each round has some random spread from the target center
            const spreadAngle = Math.random() * Math.PI * 2;
            const spreadDist = Math.random() * config.spreadM;
            const roundImpact = {
                x: impactPos.x + Math.cos(spreadAngle) * spreadDist,
                z: impactPos.z + Math.sin(spreadAngle) * spreadDist,
            };
            for (const unit of nearbyUnits) {
                if (unit.isDestroyed)
                    continue;
                // Calculate distance from this round's impact point
                const dx = unit.posX - roundImpact.x;
                const dz = unit.posZ - roundImpact.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                if (distance > config.blastRadiusM)
                    continue;
                // Linear damage falloff: full damage at center, zero at edge
                const falloff = 1 - (distance / config.blastRadiusM);
                const damage = Math.ceil(config.warheadSize * falloff);
                // Apply damage
                const destroyed = this.deps.applyDamage(unit.instanceId, damage);
                // Apply suppression (full amount regardless of distance within radius)
                const suppressionAmount = Math.ceil(config.baseSuppression * falloff);
                this.deps.applySuppression(unit.instanceId, suppressionAmount);
                // Accumulate results per unit
                const existing = results.get(unit.instanceId);
                if (existing) {
                    existing.damageApplied += damage;
                    existing.suppressionApplied += suppressionAmount;
                    existing.wasDestroyed = existing.wasDestroyed || destroyed;
                    // Keep the closest distance
                    existing.distanceFromImpact = Math.min(existing.distanceFromImpact, distance);
                }
                else {
                    results.set(unit.instanceId, {
                        targetUnitId: unit.instanceId,
                        distanceFromImpact: distance,
                        damageApplied: damage,
                        suppressionApplied: suppressionAmount,
                        wasDestroyed: destroyed,
                    });
                }
            }
        }
        return Array.from(results.values());
    }
    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------
    /**
     * Get all currently in-flight (pending) strikes.
     */
    getActiveStrikes() {
        return Array.from(this.activeStrikes.values()).filter(s => !s.resolved);
    }
    /**
     * Get a specific active strike by ID.
     */
    getStrike(strikeId) {
        return this.activeStrikes.get(strikeId) ?? null;
    }
    /**
     * Cancel all active strikes (e.g. when mission ends).
     */
    clearAllStrikes() {
        this.activeStrikes.clear();
    }
    /**
     * Get the estimated time-to-impact in seconds for a strike.
     */
    getTimeToImpactSec(strikeId, currentTick) {
        const strike = this.activeStrikes.get(strikeId);
        if (!strike)
            return 0;
        const remainingTicks = Math.max(0, strike.impactTick - currentTick);
        return remainingTicks / TICKS_PER_SEC;
    }
}
