// ============================================================================
// BATTALION MANAGER — CRUD, OOB management, transit orders
// Milestone 5: Campaign
// Source: BATTALION_CREATION.md, FORCE_ROSTERS.md, CAMPAIGN_PERSISTENCE.md
// ============================================================================
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Transit duration in milliseconds (~24 real hours between connected planets).
 */
const TRANSIT_DURATION_MS = 24 * 60 * 60 * 1000;
/**
 * Maximum number of battalions a single player can own.
 */
const MAX_BATTALIONS_PER_PLAYER = 5;
/**
 * Minimum number of companies (non-reserve unit groups) a battalion must
 * maintain. At least 1 company must NOT be flagged as reserve at all times.
 */
const MIN_ACTIVE_COMPANIES = 1;
// ---------------------------------------------------------------------------
// Default TOE (Table of Equipment) templates per battalion type
// ---------------------------------------------------------------------------
/**
 * Factory function that returns the default unit slot template for a
 * battalion type. These define the starting Order of Battle.
 *
 * Each battalion type has a fixed TOE from FORCE_ROSTERS.md. The actual
 * unit type IDs come from the Terran Federation CSV.
 */
function getDefaultTOE(type, generateId) {
    // TODO: Populate with real unit type IDs from Terran_Federation_Units.csv
    // These are placeholder structures showing the shape of each battalion type.
    const makeSlot = (unitTypeId, crewMax, isReserve = false) => ({
        slotId: generateId(),
        unitTypeId,
        crewCurrent: crewMax,
        crewMax,
        isReserve,
        upgradeTier: 0,
        status: 'active',
    });
    switch (type) {
        case 'armored':
            // Heavy armor battalion: MBTs + IFV escort + support
            return [
                // Company 1: MBT platoon (4 tanks)
                makeSlot('terran_mbt_1', 4),
                makeSlot('terran_mbt_1', 4),
                makeSlot('terran_mbt_1', 4),
                makeSlot('terran_mbt_1', 4),
                // Company 2: IFV platoon (4 IFVs)
                makeSlot('terran_ifv_1', 3),
                makeSlot('terran_ifv_1', 3),
                makeSlot('terran_ifv_1', 3),
                makeSlot('terran_ifv_1', 3),
                // Support: AA + supply
                makeSlot('terran_aa_1', 3),
                makeSlot('terran_supply_1', 2),
                // Reserve: additional MBT platoon
                makeSlot('terran_mbt_1', 4, true),
                makeSlot('terran_mbt_1', 4, true),
            ];
        case 'mechanized':
            // Mechanized infantry: IFVs carrying infantry + organic fire support
            return [
                makeSlot('terran_ifv_1', 3),
                makeSlot('terran_ifv_1', 3),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_ifv_1', 3),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_mortar_1', 4),
                makeSlot('terran_aa_1', 3),
                makeSlot('terran_supply_1', 2),
                makeSlot('terran_infantry_1', 8, true),
            ];
        case 'light_infantry':
            // Light infantry: lots of foot soldiers, light vehicles for support
            return [
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_at_infantry_1', 6),
                makeSlot('terran_mortar_1', 4),
                makeSlot('terran_scout_1', 2),
                makeSlot('terran_supply_1', 2),
                makeSlot('terran_infantry_1', 8, true),
                makeSlot('terran_infantry_1', 8, true),
            ];
        case 'airborne':
            // Airborne: helicopters + air-mobile infantry
            return [
                makeSlot('terran_helo_transport_1', 3),
                makeSlot('terran_helo_transport_1', 3),
                makeSlot('terran_helo_attack_1', 2),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_infantry_1', 8),
                makeSlot('terran_at_infantry_1', 6),
                makeSlot('terran_supply_1', 2),
                makeSlot('terran_helo_attack_1', 2, true),
            ];
        case 'support':
            // Support battalion: artillery, engineers, logistics
            return [
                makeSlot('terran_arty_sp_1', 3),
                makeSlot('terran_arty_sp_1', 3),
                makeSlot('terran_engineer_1', 6),
                makeSlot('terran_supply_1', 2),
                makeSlot('terran_supply_1', 2),
                makeSlot('terran_aa_1', 3),
                makeSlot('terran_scout_1', 2),
                makeSlot('terran_arty_sp_1', 3, true),
            ];
        default:
            // Exhaustive check — this should never happen
            const _exhaustive = type;
            throw new Error(`Unknown battalion type: ${_exhaustive}`);
    }
}
// ---------------------------------------------------------------------------
// BattalionManager
// ---------------------------------------------------------------------------
/**
 * Manages the full lifecycle of battalions:
 *
 * - **Create** — Player selects a battalion type, names it, and chooses a
 *   sector origin. The battalion is provisioned with a default TOE.
 * - **OOB management** — Add/remove/upgrade unit slots, flag reserves.
 * - **Transit orders** — Move a battalion between connected planets
 *   (takes ~24 real hours).
 * - **Reserve flagging** — Players can flag units as reserve (they deploy
 *   in a second wave). At least 1 company must remain non-reserve.
 * - **Status tracking** — available / in_transit / in_mission / destroyed.
 */
export class BattalionManager {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    // -----------------------------------------------------------------------
    // Create a new battalion
    // -----------------------------------------------------------------------
    /**
     * Create a new battalion for a player.
     *
     * @param playerId     - The owning player.
     * @param name         - Display name for the battalion.
     * @param type         - Battalion type (armored, mechanized, etc.).
     * @param sectorOrigin - The sector where the battalion is raised (flavour + home planet).
     * @param startPlanetId - The planet where the battalion appears.
     * @returns CreateBattalionResult with the new record on success.
     */
    async createBattalion(playerId, name, type, sectorOrigin, startPlanetId) {
        // Validate player exists
        const player = await this.deps.loadPlayer(playerId);
        if (!player) {
            return { success: false, error: 'Player account not found' };
        }
        // Check battalion cap
        const existing = await this.deps.loadPlayerBattalions(playerId);
        if (existing.length >= MAX_BATTALIONS_PER_PLAYER) {
            return {
                success: false,
                error: `Maximum ${MAX_BATTALIONS_PER_PLAYER} battalions per player`,
            };
        }
        // Validate name (non-empty, reasonable length)
        const trimmedName = name.trim();
        if (trimmedName.length === 0 || trimmedName.length > 40) {
            return { success: false, error: 'Battalion name must be 1–40 characters' };
        }
        // Check for duplicate names within this player's battalions
        if (existing.some(b => b.name.toLowerCase() === trimmedName.toLowerCase())) {
            return { success: false, error: 'You already have a battalion with that name' };
        }
        // Build the default TOE
        const unitSlots = getDefaultTOE(type, () => this.deps.generateId());
        const battalionId = this.deps.generateId();
        const now = Date.now();
        const battalion = {
            battalionId,
            playerId,
            name: trimmedName,
            type,
            sectorOrigin,
            status: 'available',
            currentPlanetId: startPlanetId,
            transitDestinationId: null,
            transitDepartedAt: null,
            transitArrivesAt: null,
            supplyPoints: 0,
            missionsCompleted: 0,
            missionsWon: 0,
            unitSlots,
            createdAt: now,
            lastMissionAt: null,
        };
        // Persist
        await this.deps.saveBattalion(battalion);
        // Update the player's battalion list
        const updatedIds = [...player.battalionIds, battalionId];
        await this.deps.updatePlayerBattalionIds(playerId, updatedIds);
        return { success: true, battalion };
    }
    // -----------------------------------------------------------------------
    // Transit orders
    // -----------------------------------------------------------------------
    /**
     * Issue a transit order to move a battalion to a connected planet.
     * Travel takes ~24 real hours.
     *
     * @param battalionId  - The battalion to move.
     * @param targetPlanetId - The destination planet.
     * @returns TransitOrderResult with departure/arrival times on success.
     */
    async orderTransit(battalionId, targetPlanetId) {
        const battalion = await this.deps.loadBattalion(battalionId);
        if (!battalion) {
            return { success: false, error: 'Battalion not found' };
        }
        // Can only transit if currently available (not in mission, not already moving)
        if (battalion.status !== 'available') {
            return {
                success: false,
                error: `Battalion is '${battalion.status}', must be 'available' to transit`,
            };
        }
        if (!battalion.currentPlanetId) {
            return { success: false, error: 'Battalion has no current planet' };
        }
        // Verify the destination is connected
        const connected = await this.deps.isPlanetConnected(battalion.currentPlanetId, targetPlanetId);
        if (!connected) {
            return {
                success: false,
                error: 'Destination planet is not connected to current planet',
            };
        }
        // Already there?
        if (battalion.currentPlanetId === targetPlanetId) {
            return { success: false, error: 'Battalion is already on that planet' };
        }
        // Issue the transit order
        const now = Date.now();
        battalion.status = 'in_transit';
        battalion.transitDestinationId = targetPlanetId;
        battalion.transitDepartedAt = now;
        battalion.transitArrivesAt = now + TRANSIT_DURATION_MS;
        await this.deps.saveBattalion(battalion);
        return {
            success: true,
            departsAt: battalion.transitDepartedAt,
            arrivesAt: battalion.transitArrivesAt,
        };
    }
    // -----------------------------------------------------------------------
    // OOB (Order of Battle) management
    // -----------------------------------------------------------------------
    /**
     * Flag a unit slot as reserve or active.
     * Reserve units deploy in a second wave during the deployment phase.
     * At least MIN_ACTIVE_COMPANIES (1) non-reserve slots must remain.
     *
     * @param battalionId - The battalion to modify.
     * @param slotId      - The unit slot to toggle.
     * @param isReserve   - Whether to flag as reserve.
     * @returns OOBModifyResult.
     */
    async setReserveFlag(battalionId, slotId, isReserve) {
        const battalion = await this.deps.loadBattalion(battalionId);
        if (!battalion) {
            return { success: false, error: 'Battalion not found' };
        }
        // Cannot modify OOB while in transit or mission
        if (battalion.status !== 'available') {
            return { success: false, error: 'Cannot modify OOB while battalion is not available' };
        }
        const slot = battalion.unitSlots.find(s => s.slotId === slotId);
        if (!slot) {
            return { success: false, error: 'Unit slot not found' };
        }
        // If setting to reserve, check we'd still have enough active slots
        if (isReserve) {
            const activeAfter = battalion.unitSlots.filter(s => s.slotId !== slotId && !s.isReserve && s.status === 'active').length;
            if (activeAfter < MIN_ACTIVE_COMPANIES) {
                return {
                    success: false,
                    error: `At least ${MIN_ACTIVE_COMPANIES} active (non-reserve) unit(s) required`,
                };
            }
        }
        slot.isReserve = isReserve;
        await this.deps.saveBattalion(battalion);
        return { success: true };
    }
    /**
     * Apply battle damage to a unit slot after a mission.
     * Updates crew count and status based on casualties suffered.
     *
     * @param battalionId - The battalion.
     * @param slotId      - The unit slot.
     * @param crewLost    - Number of crew/strength lost.
     */
    async applyCasualties(battalionId, slotId, crewLost) {
        const battalion = await this.deps.loadBattalion(battalionId);
        if (!battalion)
            return;
        const slot = battalion.unitSlots.find(s => s.slotId === slotId);
        if (!slot)
            return;
        slot.crewCurrent = Math.max(0, slot.crewCurrent - crewLost);
        // Update status based on remaining crew
        if (slot.crewCurrent === 0) {
            slot.status = 'destroyed';
        }
        else if (slot.crewCurrent <= slot.crewMax * 0.5) {
            slot.status = 'combat_ineffective';
        }
        else if (slot.crewCurrent < slot.crewMax) {
            slot.status = 'damaged';
        }
        await this.deps.saveBattalion(battalion);
    }
    /**
     * Repair/reinforce a unit slot by spending SP (Supply Points).
     * Restores crew up to crewMax.
     *
     * @param battalionId - The battalion.
     * @param slotId      - The unit slot to reinforce.
     * @param crewToRestore - Number of crew to restore.
     * @param spCost      - SP cost of the reinforcement.
     * @returns OOBModifyResult.
     */
    async reinforceSlot(battalionId, slotId, crewToRestore, spCost) {
        const battalion = await this.deps.loadBattalion(battalionId);
        if (!battalion) {
            return { success: false, error: 'Battalion not found' };
        }
        if (battalion.status !== 'available') {
            return { success: false, error: 'Cannot reinforce while battalion is not available' };
        }
        if (battalion.supplyPoints < spCost) {
            return {
                success: false,
                error: `Insufficient SP: have ${battalion.supplyPoints}, need ${spCost}`,
            };
        }
        const slot = battalion.unitSlots.find(s => s.slotId === slotId);
        if (!slot) {
            return { success: false, error: 'Unit slot not found' };
        }
        if (slot.status === 'destroyed') {
            return { success: false, error: 'Cannot reinforce a destroyed unit; purchase a replacement' };
        }
        // Apply the reinforcement
        slot.crewCurrent = Math.min(slot.crewMax, slot.crewCurrent + crewToRestore);
        battalion.supplyPoints -= spCost;
        // Update status
        if (slot.crewCurrent === slot.crewMax) {
            slot.status = 'active';
        }
        else if (slot.crewCurrent > slot.crewMax * 0.5) {
            slot.status = 'damaged';
        }
        await this.deps.saveBattalion(battalion);
        return { success: true };
    }
    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------
    /**
     * Get all battalions for a player.
     */
    async getPlayerBattalions(playerId) {
        return this.deps.loadPlayerBattalions(playerId);
    }
    /**
     * Get a single battalion by ID.
     */
    async getBattalion(battalionId) {
        return this.deps.loadBattalion(battalionId);
    }
    /**
     * Get all deployable (non-reserve, active/damaged) unit slots for a battalion.
     */
    async getDeployableSlots(battalionId) {
        const battalion = await this.deps.loadBattalion(battalionId);
        if (!battalion)
            return [];
        return battalion.unitSlots.filter(slot => !slot.isReserve &&
            (slot.status === 'active' || slot.status === 'damaged'));
    }
    /**
     * Get reserve slots for a battalion (deployed in second wave).
     */
    async getReserveSlots(battalionId) {
        const battalion = await this.deps.loadBattalion(battalionId);
        if (!battalion)
            return [];
        return battalion.unitSlots.filter(slot => slot.isReserve &&
            (slot.status === 'active' || slot.status === 'damaged'));
    }
}
