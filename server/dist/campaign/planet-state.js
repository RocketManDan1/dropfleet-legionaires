// ============================================================================
// PLANET STATE MANAGER — Planet influence tracking and state determination
// Milestone 5: Campaign
// Source: CAMPAIGN_PERSISTENCE.md, CAMPAIGN_OVERVIEW.md, POST_MISSION_RESOLUTION.md
// ============================================================================
import { INFLUENCE_SECURE_THRESHOLD, INFLUENCE_FALLEN_THRESHOLD, } from '@legionaires/shared/constants';
// ---------------------------------------------------------------------------
// Constants for influence state determination
// ---------------------------------------------------------------------------
/**
 * Thresholds for the five-state influence model.
 * These are combined enemy influence percentages (Ataxian + Khroshi).
 *
 * | State      | Combined enemy influence |
 * |------------|------------------------|
 * | secure     | 0%                     |
 * | contested  | 1–39%                  |
 * | falling    | 40–69%                 |
 * | critical   | 70–99%                 |
 * | fallen     | 100% (any one faction) |
 */
const CONTESTED_THRESHOLD = 1;
const FALLING_THRESHOLD = 40;
const CRITICAL_THRESHOLD = 70;
// ---------------------------------------------------------------------------
// PlanetStateManager
// ---------------------------------------------------------------------------
/**
 * Manages all planet influence state for the campaign layer.
 *
 * Key responsibilities:
 * - Read/write influence values while enforcing the sum-to-100 invariant.
 * - Determine the influence state label (secure/contested/falling/critical/fallen).
 * - Apply mission influence deltas (after a mission concludes).
 * - Detect planet liberation (enemy influence drops to 0) and planet fall
 *   (any enemy faction reaches 100%).
 * - Determine the controlling faction (whichever exceeds 50%).
 *
 * The manager operates on PlanetRecord objects in-place — persistence is
 * handled by the caller (PersistenceLayer / CampaignTicker).
 */
export class PlanetStateManager {
    // -----------------------------------------------------------------------
    // Influence state queries
    // -----------------------------------------------------------------------
    /**
     * Determine the influence state label for a planet.
     *
     * @param planet - The planet to evaluate.
     * @returns The InfluenceState label.
     */
    getInfluenceState(planet) {
        const combinedEnemyInfluence = planet.influenceAtaxian + planet.influenceKhroshi;
        // Fallen: any single enemy faction has reached 100%
        if (planet.influenceAtaxian >= INFLUENCE_FALLEN_THRESHOLD ||
            planet.influenceKhroshi >= INFLUENCE_FALLEN_THRESHOLD) {
            return 'fallen';
        }
        // Secure: no enemy influence at all
        if (combinedEnemyInfluence <= INFLUENCE_SECURE_THRESHOLD) {
            return 'secure';
        }
        // Critical: 70–99% combined enemy influence
        if (combinedEnemyInfluence >= CRITICAL_THRESHOLD) {
            return 'critical';
        }
        // Falling: 40–69% combined enemy influence
        if (combinedEnemyInfluence >= FALLING_THRESHOLD) {
            return 'falling';
        }
        // Contested: 1–39% combined enemy influence
        return 'contested';
    }
    /**
     * Get the controlling faction for a planet (whichever exceeds 50%).
     * Returns null if no faction has majority control.
     *
     * @param planet - The planet to check.
     * @returns The controlling FactionId, or null if contested.
     */
    getControllingFaction(planet) {
        if (planet.influenceFederation > 50)
            return 'federation';
        if (planet.influenceAtaxian > 50)
            return 'ataxian';
        if (planet.influenceKhroshi > 50)
            return 'khroshi';
        return null;
    }
    /**
     * Check if a planet has been liberated (all enemy influence removed).
     */
    isPlanetLiberated(planet) {
        return planet.influenceAtaxian === 0 && planet.influenceKhroshi === 0;
    }
    /**
     * Check if a planet has fallen (any enemy faction at 100%).
     */
    isPlanetFallen(planet) {
        return (planet.influenceAtaxian >= INFLUENCE_FALLEN_THRESHOLD ||
            planet.influenceKhroshi >= INFLUENCE_FALLEN_THRESHOLD);
    }
    /**
     * Check if missions are available on a planet.
     * Missions are available when the planet is not secure (has enemy presence)
     * and is not fully fallen.
     */
    areMissionsAvailable(planet) {
        const state = this.getInfluenceState(planet);
        return state !== 'secure' && state !== 'fallen';
    }
    // -----------------------------------------------------------------------
    // Influence modification
    // -----------------------------------------------------------------------
    /**
     * Apply an influence delta from a completed mission.
     *
     * After a successful mission, the enemy faction's influence on the planet
     * is reduced. The freed influence points go back to the Federation.
     * The influence triplet (Federation + Ataxian + Khroshi) always sums to 100.
     *
     * @param planet - The planet to modify (in-place).
     * @param enemyFaction - Which enemy faction's influence to reduce.
     * @param reduction - How many influence points to remove from the enemy.
     * @returns An InfluenceDelta record documenting the change.
     */
    applyMissionDelta(planet, enemyFaction, reduction) {
        if (enemyFaction === 'federation') {
            throw new Error('Cannot reduce Federation influence via mission delta');
        }
        // Clamp reduction to the faction's current influence
        let previousInfluence;
        if (enemyFaction === 'ataxian') {
            previousInfluence = planet.influenceAtaxian;
            const actualReduction = Math.min(reduction, planet.influenceAtaxian);
            planet.influenceAtaxian = Math.max(0, planet.influenceAtaxian - actualReduction);
            planet.influenceFederation = Math.min(100, planet.influenceFederation + actualReduction);
        }
        else {
            previousInfluence = planet.influenceKhroshi;
            const actualReduction = Math.min(reduction, planet.influenceKhroshi);
            planet.influenceKhroshi = Math.max(0, planet.influenceKhroshi - actualReduction);
            planet.influenceFederation = Math.min(100, planet.influenceFederation + actualReduction);
        }
        // Enforce the sum-to-100 invariant
        this.enforceInfluenceInvariant(planet);
        // Update controlling faction
        planet.controllingFaction = this.getControllingFaction(planet);
        const newInfluence = enemyFaction === 'ataxian'
            ? planet.influenceAtaxian
            : planet.influenceKhroshi;
        const delta = {
            planetId: planet.planetId,
            enemyFaction,
            previousInfluence,
            influenceReduction: previousInfluence - newInfluence,
            newInfluence,
            planetLiberated: this.isPlanetLiberated(planet),
            controlFlipped: planet.controllingFaction === 'federation' && previousInfluence > 50,
        };
        return delta;
    }
    /**
     * Increase enemy influence on a planet (called by the campaign ticker
     * for undefended planets).
     *
     * @param planet - The planet to modify (in-place).
     * @param faction - Which enemy faction is growing.
     * @param amount - Influence points to add.
     */
    increaseEnemyInfluence(planet, faction, amount) {
        if (faction === 'federation') {
            throw new Error('Use applyMissionDelta to increase Federation influence');
        }
        // Growth comes at the expense of the Federation
        const maxGrowth = planet.influenceFederation;
        const actualGrowth = Math.min(amount, maxGrowth);
        if (actualGrowth <= 0)
            return;
        if (faction === 'ataxian') {
            planet.influenceAtaxian += actualGrowth;
        }
        else {
            planet.influenceKhroshi += actualGrowth;
        }
        planet.influenceFederation -= actualGrowth;
        this.enforceInfluenceInvariant(planet);
        planet.controllingFaction = this.getControllingFaction(planet);
    }
    /**
     * Set influence values directly (for initialization or admin tools).
     * Validates that the sum equals 100.
     *
     * @throws Error if the values don't sum to 100.
     */
    setInfluence(planet, federation, ataxian, khroshi) {
        const sum = federation + ataxian + khroshi;
        if (Math.abs(sum - 100) > 0.01) {
            throw new Error(`Influence values must sum to 100, got ${sum} ` +
                `(fed=${federation}, atx=${ataxian}, khr=${khroshi})`);
        }
        planet.influenceFederation = Math.round(federation * 100) / 100;
        planet.influenceAtaxian = Math.round(ataxian * 100) / 100;
        planet.influenceKhroshi = Math.round(khroshi * 100) / 100;
        // Snap to exact 100 after rounding
        this.enforceInfluenceInvariant(planet);
        planet.controllingFaction = this.getControllingFaction(planet);
    }
    // -----------------------------------------------------------------------
    // Batch operations
    // -----------------------------------------------------------------------
    /**
     * Get a summary of all planets' influence states.
     * Useful for the sector map display and campaign overview.
     *
     * @param planets - All planet records.
     * @returns Map of planetId → InfluenceState.
     */
    getAllInfluenceStates(planets) {
        const result = new Map();
        for (const planet of planets) {
            result.set(planet.planetId, this.getInfluenceState(planet));
        }
        return result;
    }
    /**
     * Find all planets in danger (falling or critical state).
     */
    getPlanetsInDanger(planets) {
        return planets.filter(p => {
            const state = this.getInfluenceState(p);
            return state === 'falling' || state === 'critical';
        });
    }
    /**
     * Find all fallen planets.
     */
    getFallenPlanets(planets) {
        return planets.filter(p => this.isPlanetFallen(p));
    }
    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------
    /**
     * Enforce the invariant that Federation + Ataxian + Khroshi = 100.
     * After any modification, rounding errors or bugs might break this.
     * We adjust Federation to be the residual.
     */
    enforceInfluenceInvariant(planet) {
        // Clamp all values to [0, 100]
        planet.influenceAtaxian = Math.max(0, Math.min(100, planet.influenceAtaxian));
        planet.influenceKhroshi = Math.max(0, Math.min(100, planet.influenceKhroshi));
        // Federation is the residual so the sum is always exactly 100
        planet.influenceFederation = 100 - planet.influenceAtaxian - planet.influenceKhroshi;
        // Clamp Federation too (in case both enemies somehow exceed 100 combined)
        planet.influenceFederation = Math.max(0, planet.influenceFederation);
    }
}
