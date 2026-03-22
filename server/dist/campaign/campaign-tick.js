// ============================================================================
// CAMPAIGN TICKER — 30-minute real-time campaign tick processor
// Milestone 5: Campaign
// Source: CAMPAIGN_OVERVIEW.md, CAMPAIGN_PERSISTENCE.md, FACTIONS.md
// ============================================================================
import { CAMPAIGN_TICK_INTERVAL_MS, } from '@legionaires/shared/constants';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Base influence growth per tick for enemy factions on undefended planets.
 * Scaled by the planet's strategic value tier (1/2/3).
 */
const BASE_INFLUENCE_GROWTH = 2.0;
/**
 * Maximum influence any single enemy faction can hold.
 * (At 100% the planet is "fallen".)
 */
const MAX_FACTION_INFLUENCE = 100;
/**
 * How long a mission can sit in 'created' state before being expired (ms).
 * 2 hours — if nobody joins, it goes away.
 */
const MISSION_STALE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
// ---------------------------------------------------------------------------
// CampaignTicker
// ---------------------------------------------------------------------------
/**
 * Processes one campaign tick every 30 real-time minutes. The campaign tick
 * is the heartbeat of the persistent sector map, handling:
 *
 * 1. **Enemy influence growth** — undefended planets slowly fall to enemy
 *    factions. Ataxian Hive grows on ODD ticks, Khroshi Syndicalists on
 *    EVEN ticks (multi-faction alternating growth).
 *
 * 2. **Federation influence recovery** — when enemy influence is reduced
 *    (via missions), the freed points go back to the Federation.
 *
 * 3. **Battalion transits** — move battalions between planets. Travel takes
 *    ~24 real hours. Completed transits update the battalion's location.
 *
 * 4. **Stale mission expiry** — missions in 'created' state that nobody has
 *    joined for too long are cleaned up.
 *
 * 5. **Faction AI strategy** — high-level evaluation of where each enemy
 *    faction should expand, reinforce, or consolidate.
 */
export class CampaignTicker {
    deps;
    /** Handle returned by setInterval, for cleanup. */
    intervalHandle = null;
    /** Whether the ticker is currently processing (prevents re-entrancy). */
    isProcessing = false;
    constructor(deps) {
        this.deps = deps;
    }
    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    /**
     * Start the campaign tick loop. Runs every CAMPAIGN_TICK_INTERVAL_MS
     * (30 minutes). Also checks on startup if a tick was missed while the
     * server was down (crash recovery).
     */
    async start() {
        // Check if we missed any ticks while the server was offline
        await this.catchUpMissedTicks();
        this.intervalHandle = setInterval(async () => {
            if (!this.isProcessing) {
                await this.processTick();
            }
        }, CAMPAIGN_TICK_INTERVAL_MS);
    }
    /**
     * Stop the campaign tick loop.
     */
    stop() {
        if (this.intervalHandle !== null) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    // -----------------------------------------------------------------------
    // Main tick processing
    // -----------------------------------------------------------------------
    /**
     * Execute a single campaign tick. This is the core method.
     *
     * @returns A report summarizing everything that happened.
     */
    async processTick() {
        this.isProcessing = true;
        try {
            const tickState = await this.deps.loadTickState();
            const tickNumber = tickState.tickNumber + 1;
            const report = {
                tickNumber,
                processedAt: Date.now(),
                planetsProcessed: 0,
                influenceChanges: [],
                transitsCompleted: [],
                missionsExpired: [],
                factionAIActions: [],
            };
            // --- Phase 1: Load all data ---
            const [planets, transits, missions] = await Promise.all([
                this.deps.loadAllPlanets(),
                this.deps.loadBattalionsInTransit(),
                this.deps.loadActiveMissions(),
            ]);
            // --- Phase 2: Process influence growth on each planet ---
            const modifiedPlanets = [];
            for (const planet of planets) {
                const changes = this.processInfluenceGrowth(planet, tickNumber);
                if (changes.length > 0) {
                    report.influenceChanges.push(...changes);
                    modifiedPlanets.push(planet);
                }
                report.planetsProcessed++;
            }
            // --- Phase 3: Process battalion transits ---
            const completedTransits = this.processTransits(transits);
            report.transitsCompleted = completedTransits;
            // --- Phase 4: Expire stale missions ---
            const expiredMissionIds = this.findStaleMissions(missions);
            report.missionsExpired = expiredMissionIds;
            // --- Phase 5: Faction AI strategy evaluation ---
            const aiActions = this.runFactionAI(planets, tickNumber);
            report.factionAIActions = aiActions;
            // --- Phase 6: Persist all changes ---
            if (modifiedPlanets.length > 0) {
                await this.deps.savePlanets(modifiedPlanets);
            }
            for (const transit of completedTransits) {
                const battalion = transits.find(b => b.battalionId === transit.battalionId);
                if (battalion) {
                    await this.deps.saveBattalion(battalion);
                }
            }
            for (const missionId of expiredMissionIds) {
                await this.deps.expireMission(missionId);
            }
            // Update tick state
            const newTickState = {
                tickNumber,
                tickInterval: CAMPAIGN_TICK_INTERVAL_MS,
                lastTickAt: Date.now(),
            };
            await this.deps.saveTickState(newTickState);
            return report;
        }
        finally {
            this.isProcessing = false;
        }
    }
    // -----------------------------------------------------------------------
    // Phase 2: Influence growth
    // -----------------------------------------------------------------------
    /**
     * Calculate and apply enemy influence growth for a single planet.
     *
     * Rules:
     * - Ataxian grows on ODD ticks, Khroshi on EVEN ticks (alternating).
     * - Growth rate = BASE_INFLUENCE_GROWTH * strategicValueTier.
     * - Growth only happens on planets where the faction already has a foothold
     *   (influence > 0) or on planets connected to a fallen planet.
     * - Influence triplet always sums to 100; growth comes at the expense of
     *   the Federation's share.
     * - A planet at 100% enemy influence is "fallen".
     *
     * @param planet - The planet to process (modified in-place).
     * @param tickNumber - Current tick number (for alternating growth).
     * @returns Array of influence changes applied.
     */
    processInfluenceGrowth(planet, tickNumber) {
        const changes = [];
        // Skip planets that are fully secure (Federation controls 100%)
        if (planet.influenceFederation >= 100)
            return changes;
        const growthRate = BASE_INFLUENCE_GROWTH * planet.strategicValueTier;
        // Ataxian grows on odd ticks
        if (tickNumber % 2 === 1 && planet.influenceAtaxian > 0) {
            const prevAtaxian = planet.influenceAtaxian;
            const growth = Math.min(growthRate, planet.influenceFederation);
            if (growth > 0) {
                planet.influenceAtaxian = Math.min(MAX_FACTION_INFLUENCE, planet.influenceAtaxian + growth);
                planet.influenceFederation = Math.max(0, planet.influenceFederation - growth);
                this.updateControllingFaction(planet);
                changes.push({
                    planetId: planet.planetId,
                    faction: 'ataxian',
                    previousInfluence: prevAtaxian,
                    newInfluence: planet.influenceAtaxian,
                    reason: 'undefended_growth',
                });
            }
        }
        // Khroshi grows on even ticks
        if (tickNumber % 2 === 0 && planet.influenceKhroshi > 0) {
            const prevKhroshi = planet.influenceKhroshi;
            const growth = Math.min(growthRate, planet.influenceFederation);
            if (growth > 0) {
                planet.influenceKhroshi = Math.min(MAX_FACTION_INFLUENCE, planet.influenceKhroshi + growth);
                planet.influenceFederation = Math.max(0, planet.influenceFederation - growth);
                this.updateControllingFaction(planet);
                changes.push({
                    planetId: planet.planetId,
                    faction: 'khroshi',
                    previousInfluence: prevKhroshi,
                    newInfluence: planet.influenceKhroshi,
                    reason: 'undefended_growth',
                });
            }
        }
        return changes;
    }
    /**
     * Recalculate the controlling faction for a planet based on current
     * influence values. The controlling faction is whichever exceeds 50%.
     */
    updateControllingFaction(planet) {
        if (planet.influenceFederation > 50) {
            planet.controllingFaction = 'federation';
        }
        else if (planet.influenceAtaxian > 50) {
            planet.controllingFaction = 'ataxian';
        }
        else if (planet.influenceKhroshi > 50) {
            planet.controllingFaction = 'khroshi';
        }
        else {
            // No faction has majority — contested
            planet.controllingFaction = null;
        }
    }
    // -----------------------------------------------------------------------
    // Phase 3: Battalion transits
    // -----------------------------------------------------------------------
    /**
     * Check all in-transit battalions and complete those that have arrived.
     * Travel time is ~24 real hours, tracked via transitArrivesAt timestamp.
     *
     * @param transits - All battalions currently in 'in_transit' status.
     * @returns Array of completed transit summaries.
     */
    processTransits(transits) {
        const completions = [];
        const now = Date.now();
        for (const battalion of transits) {
            if (battalion.status === 'in_transit' &&
                battalion.transitArrivesAt !== null &&
                battalion.transitArrivesAt <= now) {
                const fromPlanetId = battalion.currentPlanetId ?? 'unknown';
                const toPlanetId = battalion.transitDestinationId ?? 'unknown';
                // Update the battalion: arrive at destination
                battalion.currentPlanetId = battalion.transitDestinationId;
                battalion.transitDestinationId = null;
                battalion.transitDepartedAt = null;
                battalion.transitArrivesAt = null;
                battalion.status = 'available';
                completions.push({
                    battalionId: battalion.battalionId,
                    playerId: battalion.playerId,
                    fromPlanetId,
                    toPlanetId,
                });
            }
        }
        return completions;
    }
    // -----------------------------------------------------------------------
    // Phase 4: Stale mission expiry
    // -----------------------------------------------------------------------
    /**
     * Find missions in 'created' state that have been sitting too long
     * without anyone joining. These are cleaned up to avoid clutter.
     *
     * @param missions - All active (non-closed) missions.
     * @returns Array of mission IDs to expire.
     */
    findStaleMissions(missions) {
        const now = Date.now();
        const stale = [];
        for (const mission of missions) {
            if (mission.state === 'created' && mission.expiresAt < now) {
                stale.push(mission.missionId);
            }
        }
        return stale;
    }
    // -----------------------------------------------------------------------
    // Phase 5: Faction AI strategy
    // -----------------------------------------------------------------------
    /**
     * Run the strategic-level faction AI. This determines where enemy factions
     * should focus their expansion efforts on the sector map.
     *
     * Ataxian Hive:
     *  - Spreads fast, prefers planets with low garrison strength.
     *  - Expands aggressively to adjacent planets once influence > 60%.
     *
     * Khroshi Syndicalists:
     *  - Slow to spread, prefers to consolidate (reinforce) existing holdings.
     *  - Only expands when influence > 80% on current planets.
     *
     * @param planets - All planets in the campaign.
     * @param tickNumber - Current tick (for faction alternation awareness).
     * @returns Array of strategic AI actions taken.
     */
    runFactionAI(planets, tickNumber) {
        const actions = [];
        // Build adjacency lookup
        const planetMap = new Map();
        for (const p of planets) {
            planetMap.set(p.planetId, p);
        }
        // --- Ataxian AI ---
        actions.push(...this.runAtaxianAI(planets, planetMap));
        // --- Khroshi AI ---
        actions.push(...this.runKhroshiAI(planets, planetMap));
        return actions;
    }
    /**
     * Ataxian Hive strategic AI: aggressive expansion.
     * Spreads fast but collapses under pressure.
     */
    runAtaxianAI(planets, planetMap) {
        const actions = [];
        for (const planet of planets) {
            // Skip planets with no Ataxian presence
            if (planet.influenceAtaxian <= 0)
                continue;
            // If influence is high enough, try to seed adjacent planets
            if (planet.influenceAtaxian >= 60) {
                for (const neighborId of planet.connectedPlanetIds) {
                    const neighbor = planetMap.get(neighborId);
                    if (!neighbor)
                        continue;
                    // Seed influence on uninfested neighbors
                    if (neighbor.influenceAtaxian === 0 && neighbor.influenceFederation > 20) {
                        // TODO: Apply a small initial influence seed (e.g. 5%)
                        // This would be done by modifying the neighbor's influence values
                        // and tracking it as an AI action.
                        actions.push({
                            faction: 'ataxian',
                            actionType: 'expand',
                            targetPlanetId: neighborId,
                            strength: 5,
                        });
                    }
                }
            }
            // Reinforce planets under pressure (low influence)
            if (planet.influenceAtaxian > 0 && planet.influenceAtaxian < 30) {
                actions.push({
                    faction: 'ataxian',
                    actionType: 'reinforce',
                    targetPlanetId: planet.planetId,
                    strength: 3,
                });
            }
        }
        return actions;
    }
    /**
     * Khroshi Syndicalist strategic AI: defensive consolidation.
     * Slow to spread but very hard to dislodge once established.
     */
    runKhroshiAI(planets, planetMap) {
        const actions = [];
        for (const planet of planets) {
            if (planet.influenceKhroshi <= 0)
                continue;
            // Khroshi only expands when very firmly established
            if (planet.influenceKhroshi >= 80) {
                for (const neighborId of planet.connectedPlanetIds) {
                    const neighbor = planetMap.get(neighborId);
                    if (!neighbor)
                        continue;
                    if (neighbor.influenceKhroshi === 0 && neighbor.influenceFederation > 20) {
                        actions.push({
                            faction: 'khroshi',
                            actionType: 'expand',
                            targetPlanetId: neighborId,
                            strength: 3,
                        });
                    }
                }
            }
            // Khroshi heavily reinforces existing holdings
            if (planet.influenceKhroshi > 0 && planet.influenceKhroshi < 60) {
                actions.push({
                    faction: 'khroshi',
                    actionType: 'consolidate',
                    targetPlanetId: planet.planetId,
                    strength: 5,
                });
            }
        }
        return actions;
    }
    // -----------------------------------------------------------------------
    // Crash recovery
    // -----------------------------------------------------------------------
    /**
     * On startup, check if any campaign ticks were missed while the server
     * was down. If so, process them sequentially to catch up.
     */
    async catchUpMissedTicks() {
        const tickState = await this.deps.loadTickState();
        const now = Date.now();
        const elapsed = now - tickState.lastTickAt;
        const missedTicks = Math.floor(elapsed / CAMPAIGN_TICK_INTERVAL_MS);
        if (missedTicks > 0) {
            console.log(`[CampaignTicker] Catching up ${missedTicks} missed tick(s)...`);
            // Cap catch-up to avoid processing hundreds of ticks at startup
            const maxCatchUp = 48; // 24 hours' worth at 30-min intervals
            const ticksToProcess = Math.min(missedTicks, maxCatchUp);
            for (let i = 0; i < ticksToProcess; i++) {
                await this.processTick();
            }
            console.log(`[CampaignTicker] Catch-up complete. Processed ${ticksToProcess} ticks.`);
        }
    }
}
