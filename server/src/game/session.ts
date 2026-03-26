// ============================================================================
// GAME SESSION — container for all state associated with a live mission
// Source: SERVER_GAME_LOOP.md §6 (GameSession interface)
// Milestone 2 scaffold
// ============================================================================

import type {
  UnitInstance,
  MissionState,
  PlatoonState,
  PlayerMissionState,
  ContactEntry,
  ObjectiveState,
  MapEffect,
  ScoreState,
  MissionPhaseInternal,
  ShotRecord,
  DamageResult,
  Vec2,
  ResolvedOrder,
  CostGrid,
  MoveClass,
} from '@legionaires/shared';
import type {
  InfluenceMaps,
  MissionPhaseWire,
  AARPayload,
  AARPlayerResult,
  MissionType,
  DifficultyTier,
  DeploymentZonePayload,
} from '@legionaires/shared';
import {
  DISCONNECT_GRACE_SEC,
  DISCONNECT_GRACE_TICKS,
  TICKS_PER_SEC,
  SNAPSHOT_INTERVAL_TICKS,
  IMPASSABLE_THRESHOLD,
  DEPLOYMENT_TIMER_SEC,
  SPATIAL_HASH_CELL_SIZE,
  CELL_REAL_M,
} from '@legionaires/shared';

import { TickLoop, type LoopState } from './tick-loop.js';
import { SpatialHash } from './spatial-hash.js';
import type { UnitRegistry } from '../data/unit-registry.js';
import type { TerrainData } from '../terrain.js';
import { TerrainType, TERRAIN_MOVE_COST } from '../terrain-types.js';
import { MissionLifecycle } from '../mission/lifecycle.js';
import { DeploymentManager } from '../mission/deployment.js';
import { ObjectiveTracker } from '../mission/objectives.js';
import { StrategicAI } from '../ai/strategic.js';
import { PlatoonBehaviorTree } from '../ai/platoon-bt.js';
import { InfluenceMapManager } from '../ai/influence-map.js';
import { serializeServerMessage } from '../network/protocol.js';

// ---------------------------------------------------------------------------
// Player connection wrapper — holds the WebSocket and order buffer
// ---------------------------------------------------------------------------

export interface PlayerConnection {
  playerId: string;
  playerName: string;
  battalionId: string;
  ws: any; // WebSocket instance — typed as `any` to avoid coupling to ws lib here
  isConnected: boolean;
  disconnectedAtTick: number | null;
  graceExpiresAtTick: number | null;
  frozenUnitIds: string[];
  readyForDeployment: boolean;
  acknowledgedAAR: boolean;

  /** Inbound order buffer — filled by the WS message handler, drained each tick. */
  orderBuffer: ResolvedOrder[];

  /** Drain and return all buffered orders since last call. */
  drainOrderBuffer(): ResolvedOrder[];
}

/**
 * Create a default PlayerConnection for a newly joining player.
 */
export function createPlayerConnection(
  playerId: string,
  playerName: string,
  battalionId: string,
  ws: any,
): PlayerConnection {
  const orderBuffer: ResolvedOrder[] = [];
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
    acknowledgedAAR: false,
    orderBuffer,
    drainOrderBuffer(): ResolvedOrder[] {
      const orders = [...orderBuffer];
      orderBuffer.length = 0;
      return orders;
    },
  };
}

// ---------------------------------------------------------------------------
// Terrain placeholder — will be expanded when the terrain system is built
// ---------------------------------------------------------------------------

// TerrainData is imported from ../terrain.js — re-export for consumers
export type { TerrainData } from '../terrain.js';

// ---------------------------------------------------------------------------
// Scenario settings — per-mission configuration
// ---------------------------------------------------------------------------

export interface ScenarioSettings {
  opticalVisibilityM: number;
  thermalVisibilityM: number;
  missionType: string;
  timeLimitSec: number;
  mapSeed: number;
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
  readonly sessionId: string;

  // --- Phase ----------------------------------------------------------------
  private phase: MissionPhaseInternal = 'created';

  // --- Core systems ---------------------------------------------------------
  private tickLoop: TickLoop;
  private spatialHash: SpatialHash;
  private terrain: TerrainData;
  private scenario: ScenarioSettings;
  private unitTypes: UnitRegistry | null;

  // --- Unit state -----------------------------------------------------------
  private unitRegistry: Map<string, UnitInstance> = new Map();

  // --- Player connections ---------------------------------------------------
  private players: Map<string, PlayerConnection> = new Map();

  // --- Platoons -------------------------------------------------------------
  private platoons: Map<string, PlatoonState> = new Map();

  // --- Contact state --------------------------------------------------------
  /**
   * Per-player contact map: playerId -> targetUnitId -> ContactEntry.
   * Each player (and the AI faction) maintains independent detection data.
   */
  private contacts: Map<string, Map<string, ContactEntry>> = new Map();

  // --- Objectives -----------------------------------------------------------
  private objectives: ObjectiveState[] = [];

  // --- Map effects (smoke, craters, fire) -----------------------------------
  private mapEffects: MapEffect[] = [];

  // --- Score ----------------------------------------------------------------
  private score: ScoreState = {
    enemiesDestroyed: 0,
    friendlyCasualties: 0,
    objectivesCompleted: 0,
    objectivesTotal: 0,
    missionOutcome: null,
  };

  // --- Transient per-tick data (set by tick phases, consumed later) ----------
  private pendingShotRecords: ShotRecord[] = [];
  private pendingDamageResults: DamageResult[] = [];

  // --- Cost grids (one per MoveClass, built at session creation) ------------
  private costGrids: Map<MoveClass, CostGrid> = new Map();

  // --- M3: Mission systems --------------------------------------------------
  private lifecycle: MissionLifecycle | null = null;
  private deploymentMgr: DeploymentManager | null = null;
  private objectiveTracker: ObjectiveTracker | null = null;
  private strategicAI: StrategicAI | null = null;
  private platoonBT: PlatoonBehaviorTree | null = null;
  private influenceMapMgr: InfluenceMapManager | null = null;
  private cachedInfluenceMaps: InfluenceMaps | null = null;
  private aiFactionId: string = 'ai';
  private missionType: MissionType = 'defend';
  private missionDifficulty: DifficultyTier = 'easy';

  // --- Lifecycle timestamps -------------------------------------------------
  readonly createdAt: number;
  private missionStartTick: number = 0;
  private lastSnapshotTick: number = 0;

  // --- Previous broadcast state (for delta computation) ---------------------
  private previousBroadcastState: Map<string, Partial<UnitInstance>> = new Map();

  constructor(
    sessionId: string,
    terrain: TerrainData,
    scenario: ScenarioSettings,
    unitTypes: UnitRegistry | null = null,
  ) {
    this.sessionId = sessionId;
    this.terrain = terrain;
    this.scenario = scenario;
    this.unitTypes = unitTypes;
    this.createdAt = Date.now();

    // Initialize spatial hash with map dimensions
    this.spatialHash = new SpatialHash(terrain.width, terrain.height, SPATIAL_HASH_CELL_SIZE / CELL_REAL_M);

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
  private buildCostGrids(): void {
    const { width, height, resolution, terrainTypeMap, slopeMap } = this.terrain;
    const moveClasses = ['track', 'wheel', 'leg', 'hover'] as const;

    for (const mc of moveClasses) {
      const data = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const tt = terrainTypeMap[i] as TerrainType;
        const cost = TERRAIN_MOVE_COST[tt]?.[mc] ?? 1.0;
        const slope = slopeMap[i] ?? 0;

        if (cost >= IMPASSABLE_THRESHOLD || slope >= IMPASSABLE_THRESHOLD) {
          data[i] = 99;
        } else {
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
  getCostGrids(): Map<MoveClass, CostGrid> {
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
  addPlayer(conn: PlayerConnection): void {
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
  removePlayer(playerId: string): void {
    const conn = this.players.get(playerId);
    if (!conn) return;

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

    console.log(
      `[Session] Player ${playerId} disconnected. ` +
      `Grace expires at tick ${conn.graceExpiresAtTick}`
    );

    // TODO: Broadcast PLAYER_STATUS(disconnected) to remaining players
    // TODO: Check if ALL players are disconnected — if so, the all-disconnect
    //       scenario runs (mission clock continues, grace timers independent)
  }

  /**
   * Check all disconnect grace timers. Called each tick from the loop.
   * When a timer expires, remove that player's units from the battlefield.
   */
  checkDisconnectTimers(currentTick: number): void {
    let anyActivePlayer = false;

    for (const [playerId, conn] of this.players) {
      if (conn.isConnected) {
        anyActivePlayer = true;
        continue;
      }

      if (
        conn.graceExpiresAtTick !== null &&
        currentTick >= conn.graceExpiresAtTick
      ) {
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

  getTickLoop(): TickLoop {
    return this.tickLoop;
  }

  getUnitRegistry(): Map<string, UnitInstance> {
    return this.unitRegistry;
  }

  getTerrain(): TerrainData {
    return this.terrain;
  }

  getSpatialHash(): SpatialHash {
    return this.spatialHash;
  }

  getScenario(): ScenarioSettings {
    return this.scenario;
  }

  getPlayers(): Map<string, PlayerConnection> {
    return this.players;
  }

  getConnectedPlayers(): PlayerConnection[] {
    return [...this.players.values()].filter((p) => p.isConnected);
  }

  getUnitTypeRegistry(): UnitRegistry | null {
    return this.unitTypes;
  }

  getContactMap(): Map<string, Map<string, ContactEntry>> {
    return this.contacts;
  }

  getMissionState(): MissionState {
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

  getPhase(): MissionPhaseInternal {
    return this.phase;
  }

  setPhase(phase: MissionPhaseInternal): void {
    console.log(`[Session] Phase transition: ${this.phase} -> ${phase}`);
    this.phase = phase;
  }

  getObjectives(): ObjectiveState[] {
    return this.objectives;
  }

  getScore(): ScoreState {
    return this.score;
  }

  // =========================================================================
  // M3: Mission system accessors (used by TickLoop, server index)
  // =========================================================================

  getLifecycle(): MissionLifecycle | null { return this.lifecycle; }
  setLifecycle(lc: MissionLifecycle): void { this.lifecycle = lc; }

  getDeploymentManager(): DeploymentManager | null { return this.deploymentMgr; }
  setDeploymentManager(dm: DeploymentManager): void { this.deploymentMgr = dm; }

  getObjectiveTracker(): ObjectiveTracker | null { return this.objectiveTracker; }
  setObjectiveTracker(ot: ObjectiveTracker): void {
    this.objectiveTracker = ot;
    // Keep mission snapshot/objective totals in sync with the active tracker.
    this.objectives = ot.getAll();
    this.score.objectivesTotal = this.objectives.length;
  }

  getStrategicAI(): StrategicAI | null { return this.strategicAI; }
  setStrategicAI(ai: StrategicAI): void { this.strategicAI = ai; }

  getPlatoonBT(): PlatoonBehaviorTree | null { return this.platoonBT; }
  setPlatoonBT(bt: PlatoonBehaviorTree): void { this.platoonBT = bt; }

  getInfluenceMapManager(): InfluenceMapManager | null { return this.influenceMapMgr; }
  setInfluenceMapManager(mgr: InfluenceMapManager): void { this.influenceMapMgr = mgr; }

  getPlatoons(): Map<string, PlatoonState> { return this.platoons; }

  getAiFactionId(): string { return this.aiFactionId; }
  setAiFactionId(id: string): void { this.aiFactionId = id; }

  getMissionType(): MissionType { return this.missionType; }
  setMissionType(mt: MissionType): void { this.missionType = mt; }

  getMissionDifficulty(): DifficultyTier { return this.missionDifficulty; }
  setMissionDifficulty(d: DifficultyTier): void { this.missionDifficulty = d; }

  getInfluenceMaps(): InfluenceMaps | null { return this.cachedInfluenceMaps; }
  setInfluenceMaps(maps: InfluenceMaps): void { this.cachedInfluenceMaps = maps; }

  /**
   * Called by the tick loop when the lifecycle state machine fires a transition.
   * Broadcasts MISSION_PHASE to all connected players and handles phase-specific
   * side effects (e.g. generating AAR data on transition to 'aar').
   */
  onPhaseTransition(newPhase: MissionPhaseInternal, reason: string, tick: number): void {
    const PHASE_TO_WIRE: Record<MissionPhaseInternal, MissionPhaseWire> = {
      created: 'briefing',
      deployment: 'deployment',
      live: 'live',
      extraction: 'extraction',
      aar: 'ended',
      closed: 'ended',
    };
    const wirePhase = PHASE_TO_WIRE[newPhase];
    const missionTimeSec = tick / TICKS_PER_SEC;

    // Broadcast phase change to all connected players
    for (const [, conn] of this.players) {
      if (!conn.isConnected || !conn.ws) continue;
      try {
        conn.ws.send(serializeServerMessage(
          { type: 'MISSION_PHASE', payload: { phase: wirePhase, missionTimeSec, message: reason } },
          tick,
        ));
      } catch { /* socket may be closing */ }
    }

    // Phase-specific side effects
    if (newPhase === 'live') {
      this.missionStartTick = tick;
      // Auto-deploy any unplaced units when deployment ends
      if (this.deploymentMgr) {
        for (const [, unit] of this.unitRegistry) {
          if (unit.ownerId === this.aiFactionId) continue;
          if (!this.deploymentMgr.hasPlacedUnit(unit.instanceId)) {
            const result = this.deploymentMgr.autoDeploy(unit.instanceId);
            if (result.success) {
              unit.posX = result.position.x;
              unit.posZ = result.position.z;
              this.spatialHash.insert(unit.instanceId, unit.posX, unit.posZ);
            }
          }
        }
      }
    }

    if (newPhase === 'aar') {
      for (const [, conn] of this.players) {
        conn.acknowledgedAAR = false;
      }
      this.broadcastAAR(tick);
    }

    if (newPhase === 'closed') {
      this.tickLoop.stop();
    }
  }

  /**
   * Build and broadcast the After Action Report to all connected players.
   */
  private broadcastAAR(tick: number): void {
    const durationSec = (tick - this.missionStartTick) / TICKS_PER_SEC;
    const score = this.score;

    // Determine result
    let result: 'victory' | 'defeat' | 'draw' = 'draw';
    const objTracker = this.objectiveTracker;
    if (objTracker && objTracker.allPrimaryComplete()) {
      result = 'victory';
    } else {
      // Check if all player units destroyed
      let anyAlive = false;
      for (const [, unit] of this.unitRegistry) {
        if (!unit.isDestroyed && unit.ownerId !== this.aiFactionId) {
          anyAlive = true;
          break;
        }
      }
      if (!anyAlive) result = 'defeat';
    }

    // Build per-player results
    const playerResults: AARPlayerResult[] = [];
    for (const [playerId, conn] of this.players) {
      let unitsDeployed = 0;
      let unitsDestroyed = 0;
      let killsScored = 0;

      for (const [, unit] of this.unitRegistry) {
        if (unit.ownerId === playerId) {
          unitsDeployed++;
          if (unit.isDestroyed) unitsDestroyed++;
        }
      }

      // SP computation (simplified — proper version in campaign layer)
      const spBase = result === 'victory' ? 100 : result === 'draw' ? 50 : 25;
      const spBonusZeroKIA = unitsDestroyed === 0 ? 25 : 0;

      playerResults.push({
        playerId,
        playerName: conn.playerName,
        battalionName: conn.battalionId,
        joinedAtSec: 0,
        participationPct: 100 / Math.max(1, this.players.size),
        unitsDeployed,
        unitsDestroyed,
        killsScored,
        spBase,
        spBonusZeroKIA,
        spBonusSecondary: 0,
        spBonusSpeed: 0,
        spTotal: spBase + spBonusZeroKIA,
      });
    }

    const aarPayload: AARPayload = {
      missionId: this.sessionId,
      result,
      missionType: this.missionType,
      difficulty: this.missionDifficulty,
      durationSec,
      playerResults,
      totalEnemiesDestroyed: score.enemiesDestroyed,
      totalFriendlyCasualties: score.friendlyCasualties,
      influenceBefore: 50,
      influenceAfter: result === 'victory' ? 65 : result === 'defeat' ? 35 : 50,
    };

    for (const [, conn] of this.players) {
      if (!conn.isConnected || !conn.ws) continue;
      try {
        conn.ws.send(serializeServerMessage(
          { type: 'AAR_DATA', payload: aarPayload },
          tick,
        ));
      } catch { /* socket may be closing */ }
    }
  }

  // --- Transient shot/damage data ---

  setPendingShotRecords(records: ShotRecord[]): void {
    this.pendingShotRecords = records;
  }

  getPendingShotRecords(): ShotRecord[] {
    return this.pendingShotRecords;
  }

  setPendingDamageResults(results: DamageResult[]): void {
    this.pendingDamageResults = results;
  }

  getPendingDamageResults(): DamageResult[] {
    return this.pendingDamageResults;
  }

  // --- Previous broadcast state for delta computation ---

  getPreviousBroadcastState(): Map<string, Partial<UnitInstance>> {
    return this.previousBroadcastState;
  }

  setPreviousBroadcastState(state: Map<string, Partial<UnitInstance>>): void {
    this.previousBroadcastState = state;
  }

  // =========================================================================
  // Unit management
  // =========================================================================

  /**
   * Spawn a unit into the session's unit registry and spatial hash.
   */
  spawnUnit(unit: UnitInstance): void {
    this.unitRegistry.set(unit.instanceId, unit);
    this.spatialHash.insert(unit.instanceId, unit.posX, unit.posZ);
  }

  /**
   * Mark a unit as destroyed and remove it from the spatial hash.
   */
  destroyUnit(unitId: string): void {
    const unit = this.unitRegistry.get(unitId);
    if (!unit) return;

    unit.isDestroyed = true;
    unit.crewCurrent = 0;
    unit.destroyedAtTick = this.tickLoop.getCurrentTick();
    this.spatialHash.remove(unitId);
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /** Build PlayerMissionState map from player connections. */
  private buildPlayerMissionStates(): Map<string, PlayerMissionState> {
    const states = new Map<string, PlayerMissionState>();
    for (const [playerId, conn] of this.players) {
      const unitIds: string[] = [];
      for (const [unitId, unit] of this.unitRegistry) {
        if (unit.ownerId === playerId) unitIds.push(unitId);
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
  private allGraceTimersExpired(): boolean {
    for (const [, conn] of this.players) {
      if (conn.isConnected) return false;
      if (conn.graceExpiresAtTick !== null) return false;
    }
    return true;
  }

  /**
   * Get the current full state as a serializable snapshot for crash recovery.
   * Written every 60 seconds (SNAPSHOT_INTERVAL_TICKS).
   */
  getStateSnapshot(): object {
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
