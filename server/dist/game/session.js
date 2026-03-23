// ============================================================================
// GAME SESSION — container for all state associated with a live mission
// Source: SERVER_GAME_LOOP.md §6 (GameSession interface)
// Milestone 2 scaffold
// ============================================================================
import { DISCONNECT_GRACE_TICKS, TICKS_PER_SEC, IMPASSABLE_THRESHOLD, } from '@legionaires/shared';
import { TickLoop } from './tick-loop.js';
import { SpatialHash } from './spatial-hash.js';
import { TERRAIN_MOVE_COST } from '../terrain-types.js';
/**
 * Create a default PlayerConnection for a newly joining player.
 */
export function createPlayerConnection(playerId, playerName, battalionId, ws) {
    const orderBuffer = [];
    return {
        playerId,
        playerName,
        battalionId,
        ws,
        isConnected: true,
        disconnectedAtTick: null,
        graceExpiresAtTick: null,
        frozenUnitIds: [],
        readyForDeployment: false,
        orderBuffer,
        drainOrderBuffer() {
            const orders = [...orderBuffer];
            orderBuffer.length = 0;
            return orders;
        },
    };
}
// ============================================================================
// CLASS: GameSession
// ============================================================================
/**
 * Top-level container for a single mission instance.
 *
 * Holds:
 *   - TickLoop (the 20 Hz game loop)
 *   - Unit registry (Map<instanceId, UnitInstance>)
 *   - Terrain data
 *   - SpatialHash (grid-based spatial index, 500 m cells)
 *   - Player connections + disconnect timers
 *   - Contact map (playerId -> unitId -> ContactEntry)
 *   - Objective state, score, map effects
 *
 * Usage:
 *   const session = new GameSession(sessionId, terrain, scenario);
 *   session.addPlayer(conn);
 *   session.getTickLoop().start();
 */
export class GameSession {
    // --- Identity -------------------------------------------------------------
    sessionId;
    // --- Phase ----------------------------------------------------------------
    phase = 'created';
    // --- Core systems ---------------------------------------------------------
    tickLoop;
    spatialHash;
    terrain;
    scenario;
    unitTypes;
    // --- Unit state -----------------------------------------------------------
    unitRegistry = new Map();
    // --- Player connections ---------------------------------------------------
    players = new Map();
    // --- Platoons -------------------------------------------------------------
    platoons = new Map();
    // --- Contact state --------------------------------------------------------
    /**
     * Per-player contact map: playerId -> targetUnitId -> ContactEntry.
     * Each player (and the AI faction) maintains independent detection data.
     */
    contacts = new Map();
    // --- Objectives -----------------------------------------------------------
    objectives = [];
    // --- Map effects (smoke, craters, fire) -----------------------------------
    mapEffects = [];
    // --- Score ----------------------------------------------------------------
    score = {
        enemiesDestroyed: 0,
        friendlyCasualties: 0,
        objectivesCompleted: 0,
        objectivesTotal: 0,
        missionOutcome: null,
    };
    // --- Transient per-tick data (set by tick phases, consumed later) ----------
    pendingShotRecords = [];
    pendingDamageResults = [];
    // --- Cost grids (one per MoveClass, built at session creation) ------------
    costGrids = new Map();
    // --- Lifecycle timestamps -------------------------------------------------
    createdAt;
    missionStartTick = 0;
    lastSnapshotTick = 0;
    // --- Previous broadcast state (for delta computation) ---------------------
    previousBroadcastState = new Map();
    constructor(sessionId, terrain, scenario, unitTypes = null) {
        this.sessionId = sessionId;
        this.terrain = terrain;
        this.scenario = scenario;
        this.unitTypes = unitTypes;
        this.createdAt = Date.now();
        // Initialize spatial hash with map dimensions
        this.spatialHash = new SpatialHash(terrain.width, terrain.height);
        // Build cost grids (one per ground MoveClass)
        this.buildCostGrids();
        // Create the tick loop, passing this session as the data source
        this.tickLoop = new TickLoop(this);
    }
    // =========================================================================
    // Cost grids
    // =========================================================================
    /**
     * Build a cost grid for each ground MoveClass from the terrain type map and
     * slope map. Air units always cost 1.0 so they get a flat grid.
     *
     * Cost = terrainTypeCost × (1 + slopePenalty)
     *   slopePenalty = slope / IMPASSABLE_THRESHOLD (capped at 1.0)
     *   If terrainTypeCost >= 90 OR slope >= IMPASSABLE_THRESHOLD → cell = 99 (impassable)
     */
    buildCostGrids() {
        const { width, height, resolution, terrainTypeMap, slopeMap } = this.terrain;
        const moveClasses = ['track', 'wheel', 'leg', 'hover'];
        for (const mc of moveClasses) {
            const data = new Float32Array(width * height);
            for (let i = 0; i < width * height; i++) {
                const tt = terrainTypeMap[i];
                const cost = TERRAIN_MOVE_COST[tt]?.[mc] ?? 1.0;
                const slope = slopeMap[i] ?? 0;
                if (cost >= IMPASSABLE_THRESHOLD || slope >= IMPASSABLE_THRESHOLD) {
                    data[i] = 99;
                }
                else {
                    const slopePenalty = Math.min(slope / IMPASSABLE_THRESHOLD, 1.0);
                    data[i] = cost * (1 + slopePenalty);
                }
            }
            this.costGrids.set(mc, { data, width, height, cellSizeM: resolution });
        }
        // Air: flat cost 1.0 everywhere
        const airData = new Float32Array(width * height).fill(1.0);
        this.costGrids.set('air', { data: airData, width, height, cellSizeM: resolution });
    }
    /** Get the cost grids map (one per MoveClass). */
    getCostGrids() {
        return this.costGrids;
    }
    // =========================================================================
    // Player management
    // =========================================================================
    /**
     * Add a player to the session.
     * If the player was previously in the session and is reconnecting within
     * their grace window, unfreeze their units instead.
     */
    addPlayer(conn) {
        const existingConn = this.players.get(conn.playerId);
        if (existingConn && existingConn.graceExpiresAtTick !== null) {
            // --- Reconnection within grace window ---
            existingConn.ws = conn.ws;
            existingConn.isConnected = true;
            existingConn.disconnectedAtTick = null;
            existingConn.graceExpiresAtTick = null;
            // Unfreeze units
            for (const unitId of existingConn.frozenUnitIds) {
                // TODO: Remove frozen/invincible flags from unit
            }
            existingConn.frozenUnitIds = [];
            console.log(`[Session] Player ${conn.playerId} reconnected`);
            return;
        }
        // --- New player joining ---
        this.players.set(conn.playerId, conn);
        // Initialize empty contact map for this player
        if (!this.contacts.has(conn.playerId)) {
            this.contacts.set(conn.playerId, new Map());
        }
        console.log(`[Session] Player ${conn.playerId} joined (${this.players.size}/4)`);
        // TODO: Send MISSION_STATE_FULL snapshot to the new player
        // TODO: If in DEPLOYMENT phase, send DEPLOYMENT_ZONE
        // TODO: If in LIVE phase, send late-join deployment zone
        // TODO: Broadcast PLAYER_STATUS to other players
    }
    /**
     * Handle player disconnect. Freeze their units and start the 5-minute grace timer.
     * Per SERVER_GAME_LOOP.md — frozen units are invincible, cannot move/fire/spot,
     * but still block pathfinding.
     */
    removePlayer(playerId) {
        const conn = this.players.get(playerId);
        if (!conn)
            return;
        const currentTick = this.tickLoop.getCurrentTick();
        conn.isConnected = false;
        conn.disconnectedAtTick = currentTick;
        conn.graceExpiresAtTick = currentTick + DISCONNECT_GRACE_TICKS;
        // Freeze all units belonging to this player
        conn.frozenUnitIds = [];
        for (const [unitId, unit] of this.unitRegistry) {
            if (unit.ownerId === playerId && !unit.isDestroyed) {
                conn.frozenUnitIds.push(unitId);
                // TODO: Set frozen + invincible flags on unit
                //   - speedState = 'full_halt'
                //   - currentOrder = null, orderQueue = []
                //   - Remove from valid target pool
                //   - Freeze detection accumulators
            }
        }
        console.log(`[Session] Player ${playerId} disconnected. ` +
            `Grace expires at tick ${conn.graceExpiresAtTick}`);
        // TODO: Broadcast PLAYER_STATUS(disconnected) to remaining players
        // TODO: Check if ALL players are disconnected — if so, the all-disconnect
        //       scenario runs (mission clock continues, grace timers independent)
    }
    /**
     * Check all disconnect grace timers. Called each tick from the loop.
     * When a timer expires, remove that player's units from the battlefield.
     */
    checkDisconnectTimers(currentTick) {
        let anyActivePlayer = false;
        for (const [playerId, conn] of this.players) {
            if (conn.isConnected) {
                anyActivePlayer = true;
                continue;
            }
            if (conn.graceExpiresAtTick !== null &&
                currentTick >= conn.graceExpiresAtTick) {
                // Grace timer expired — remove player's frozen units
                for (const unitId of conn.frozenUnitIds) {
                    // Units disappear — NOT counted as casualties
                    this.unitRegistry.delete(unitId);
                    this.spatialHash.remove(unitId);
                }
                conn.frozenUnitIds = [];
                conn.graceExpiresAtTick = null;
                console.log(`[Session] Grace expired for player ${playerId}, units removed`);
                // TODO: Broadcast PLAYER_STATUS + unit removal deltas
            }
        }
        // Check all-disconnect scenario
        if (!anyActivePlayer && this.allGraceTimersExpired()) {
            // TODO: Transition to ENDED with result = DEFEAT
            //       See MISSION_LIFECYCLE.md §5
        }
    }
    // =========================================================================
    // State accessors (used by TickLoop phases)
    // =========================================================================
    getTickLoop() {
        return this.tickLoop;
    }
    getUnitRegistry() {
        return this.unitRegistry;
    }
    getTerrain() {
        return this.terrain;
    }
    getSpatialHash() {
        return this.spatialHash;
    }
    getScenario() {
        return this.scenario;
    }
    getPlayers() {
        return this.players;
    }
    getConnectedPlayers() {
        return [...this.players.values()].filter((p) => p.isConnected);
    }
    getUnitTypeRegistry() {
        return this.unitTypes;
    }
    getContactMap() {
        return this.contacts;
    }
    getMissionState() {
        return {
            missionId: this.sessionId,
            tick: this.tickLoop.getCurrentTick(),
            missionTimeSec: this.tickLoop.getCurrentTick() / TICKS_PER_SEC,
            phase: this.phase,
            units: this.unitRegistry,
            platoons: this.platoons,
            players: this.buildPlayerMissionStates(),
            contacts: this.contacts,
            objectives: this.objectives,
            mapEffects: this.mapEffects,
            score: this.score,
        };
    }
    getPhase() {
        return this.phase;
    }
    setPhase(phase) {
        console.log(`[Session] Phase transition: ${this.phase} -> ${phase}`);
        this.phase = phase;
    }
    getObjectives() {
        return this.objectives;
    }
    getScore() {
        return this.score;
    }
    // --- Transient shot/damage data ---
    setPendingShotRecords(records) {
        this.pendingShotRecords = records;
    }
    getPendingShotRecords() {
        return this.pendingShotRecords;
    }
    setPendingDamageResults(results) {
        this.pendingDamageResults = results;
    }
    getPendingDamageResults() {
        return this.pendingDamageResults;
    }
    // --- Previous broadcast state for delta computation ---
    getPreviousBroadcastState() {
        return this.previousBroadcastState;
    }
    setPreviousBroadcastState(state) {
        this.previousBroadcastState = state;
    }
    // =========================================================================
    // Unit management
    // =========================================================================
    /**
     * Spawn a unit into the session's unit registry and spatial hash.
     */
    spawnUnit(unit) {
        this.unitRegistry.set(unit.instanceId, unit);
        this.spatialHash.insert(unit.instanceId, unit.posX, unit.posZ);
    }
    /**
     * Mark a unit as destroyed and remove it from the spatial hash.
     */
    destroyUnit(unitId) {
        const unit = this.unitRegistry.get(unitId);
        if (!unit)
            return;
        unit.isDestroyed = true;
        unit.crewCurrent = 0;
        unit.destroyedAtTick = this.tickLoop.getCurrentTick();
        this.spatialHash.remove(unitId);
    }
    // =========================================================================
    // Internal helpers
    // =========================================================================
    /** Build PlayerMissionState map from player connections. */
    buildPlayerMissionStates() {
        const states = new Map();
        for (const [playerId, conn] of this.players) {
            const unitIds = [];
            for (const [unitId, unit] of this.unitRegistry) {
                if (unit.ownerId === playerId)
                    unitIds.push(unitId);
            }
            states.set(playerId, {
                playerId,
                playerName: conn.playerName,
                battalionId: conn.battalionId,
                unitIds,
                isConnected: conn.isConnected,
                disconnectedAtTick: conn.disconnectedAtTick,
                joinedAtTick: 0, // TODO: Track actual join tick
                readyForDeployment: conn.readyForDeployment,
            });
        }
        return states;
    }
    /** Check if all disconnected players' grace timers have expired. */
    allGraceTimersExpired() {
        for (const [, conn] of this.players) {
            if (conn.isConnected)
                return false;
            if (conn.graceExpiresAtTick !== null)
                return false;
        }
        return true;
    }
    /**
     * Get the current full state as a serializable snapshot for crash recovery.
     * Written every 60 seconds (SNAPSHOT_INTERVAL_TICKS).
     */
    getStateSnapshot() {
        // TODO: Serialize:
        //   - All unit state
        //   - All contact accumulators
        //   - All active orders
        //   - Map effects
        //   - Score state
        //   - Current tick number
        //   See SERVER_GAME_LOOP.md §6
        return {
            sessionId: this.sessionId,
            tick: this.tickLoop.getCurrentTick(),
            timestamp: Date.now(),
            phase: this.phase,
            // TODO: Full serialized state
        };
    }
}
