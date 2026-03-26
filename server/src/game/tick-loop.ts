// ============================================================================
// TICK LOOP — 20 Hz fixed-rate game loop (50 ms per tick)
// Source: SERVER_GAME_LOOP.md — 9 phases in strict single-threaded order
// Milestones 2 + 3
// ============================================================================

import type {
  UnitInstance,
  MissionState,
  ContactEntry,
  ResolvedOrder,
  PlatoonIntent,
  FirePosture,
} from '@legionaires/shared';
import {
  TICK_RATE_HZ,
  TICK_MS,
  TICKS_PER_SEC,
  AI_STRATEGIC_UPDATE_TICKS,
  AI_PLATOON_BT_TICKS,
  MAX_QUEUED_WAYPOINTS,
} from '@legionaires/shared';

import type { GameSession } from './session.js';
import { resolveMovement } from '../systems/movement.js';
import { updateSpotting } from '../systems/spotting.js';
import { resolveFire, type FireOrder } from '../systems/fire.js';
import { applyDamage } from '../systems/damage.js';
import { updateSuppression } from '../systems/suppression.js';
import { tickSupply } from '../systems/supply.js';
import { broadcastGameState } from '../network/broadcast.js';

// ---------------------------------------------------------------------------
// Loop state enum — matches SERVER_GAME_LOOP.md §1
// ---------------------------------------------------------------------------

export type LoopState = 'WAITING' | 'RUNNING' | 'PAUSED' | 'ENDED';

// ---------------------------------------------------------------------------
// Phase timing telemetry — useful for profiling the 50 ms budget
// ---------------------------------------------------------------------------

export interface PhaseTimings {
  inputMs: number;
  commandMs: number;
  movementMs: number;
  spottingMs: number;
  fireMs: number;
  damageMs: number;
  suppressionMs: number;
  supplyMs: number;
  broadcastMs: number;
  totalMs: number;
}

// ---------------------------------------------------------------------------
// Intra-tick event bus — events emitted by one phase, consumed by later ones
// ---------------------------------------------------------------------------

export interface TickEvent {
  type: string;
  data: Record<string, unknown>;
}

// ============================================================================
// CLASS: TickLoop
// ============================================================================

/**
 * The 20 Hz server tick loop.
 *
 * Phases run in strict order. No phase may overlap with another — the loop
 * is single-threaded and deterministic within a tick. Second-frequency phases
 * (spotting, suppression decay, supply, broadcast) only run when
 * `tick % TICKS_PER_SEC === 0`.
 *
 * Usage:
 *   const loop = new TickLoop(session);
 *   loop.start();     // transitions WAITING → RUNNING
 *   loop.stop();      // transitions to ENDED
 *   loop.getCurrentTick(); // monotonic counter
 */
export class TickLoop {
  // --- Owning session -------------------------------------------------------
  private session: GameSession;

  // --- Tick counter ---------------------------------------------------------
  private tick: number = 0;

  // --- Loop state -----------------------------------------------------------
  private state: LoopState = 'WAITING';

  // --- setInterval handle ---------------------------------------------------
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // --- Telemetry ------------------------------------------------------------
  private lastTimings: PhaseTimings = {
    inputMs: 0,
    commandMs: 0,
    movementMs: 0,
    spottingMs: 0,
    fireMs: 0,
    damageMs: 0,
    suppressionMs: 0,
    supplyMs: 0,
    broadcastMs: 0,
    totalMs: 0,
  };

  // --- Intra-tick event buffer (cleared each tick) --------------------------
  private tickEvents: TickEvent[] = [];

  constructor(session: GameSession) {
    this.session = session;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Transition from WAITING to RUNNING and begin the interval. */
  start(): void {
    if (this.state !== 'WAITING' && this.state !== 'PAUSED') {
      console.warn(`[TickLoop] Cannot start from state ${this.state}`);
      return;
    }
    this.state = 'RUNNING';
    this.intervalHandle = setInterval(() => this.executeTick(), TICK_MS);
    console.log(`[TickLoop] Started at ${TICK_RATE_HZ} Hz`);
  }

  /** Stop the loop and transition to ENDED. */
  stop(): void {
    this.state = 'ENDED';
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log(`[TickLoop] Stopped at tick ${this.tick}`);
  }

  /** Pause the loop (admin only — not used by disconnect handling). */
  pause(): void {
    if (this.state !== 'RUNNING') return;
    this.state = 'PAUSED';
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Resume from PAUSED to RUNNING. */
  resume(): void {
    if (this.state !== 'PAUSED') return;
    this.start();
  }

  /** Return the current monotonic tick counter. */
  getCurrentTick(): number {
    return this.tick;
  }

  /** Return the current loop state. */
  getState(): LoopState {
    return this.state;
  }

  /** Return phase timing data from the most recent tick. */
  getLastTimings(): PhaseTimings {
    return { ...this.lastTimings };
  }

  // -------------------------------------------------------------------------
  // Core tick execution — called every 50 ms by setInterval
  // -------------------------------------------------------------------------

  private executeTick(): void {
    if (this.state !== 'RUNNING') return;

    const tickStart = performance.now();
    const isSecondTick = this.tick > 0 && this.tick % TICKS_PER_SEC === 0;
    const dt = 1 / TICK_RATE_HZ; // 0.05 seconds per tick

    // Clear the intra-tick event buffer
    this.tickEvents = [];

    // Get references from the session for convenience
    const units = this.session.getUnitRegistry();
    const terrain = this.session.getTerrain();
    const spatialHash = this.session.getSpatialHash();

    for (const [, unit] of units) {
      unit.firedThisTick = false;
      for (let i = 0; i < unit.weaponCooldowns.length; i++) {
        if (unit.weaponCooldowns[i] > 0) {
          unit.weaponCooldowns[i] -= 1;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Phase 0: Mission Lifecycle — every tick
    // Check mission phase transitions (M3)
    // -----------------------------------------------------------------------
    this.phaseMissionLifecycle();

    // Skip combat phases if not in LIVE phase
    const phase = this.session.getPhase();
    const isLive = phase === 'live';
    const isDeploymentOrLive = phase === 'deployment' || isLive;

    // -----------------------------------------------------------------------
    // Phase 0b: Objective Updates — every tick during LIVE phase (M3)
    // -----------------------------------------------------------------------
    if (isLive) {
      this.phaseObjectiveUpdates();
    }

    // -----------------------------------------------------------------------
    // Phase 1: Input Processing — every tick
    // Read inbound order queue, validate, write to per-unit order state
    // -----------------------------------------------------------------------
    const p1Start = performance.now();
    if (isDeploymentOrLive) {
      this.phaseInputProcessing();
    }
    this.lastTimings.inputMs = performance.now() - p1Start;

    // -----------------------------------------------------------------------
    // Phase 2: Command Propagation — every tick
    // Propagate accepted orders to unit intent fields
    // AI decisions injected here before player orders propagate
    // -----------------------------------------------------------------------
    const p2Start = performance.now();
    this.phaseCommandPropagation();
    this.lastTimings.commandMs = performance.now() - p2Start;

    // -----------------------------------------------------------------------
    // Phase 3: Movement Resolution — every tick (LIVE only)
    // Integrate unit positions along paths
    // -----------------------------------------------------------------------
    const p3Start = performance.now();
    if (isLive) {
      this.phaseMovementResolution(dt);
    }
    this.lastTimings.movementMs = performance.now() - p3Start;

    // -----------------------------------------------------------------------
    // Phase 4: Spotting Updates — every second (tick % 20 === 0), LIVE only
    // Pairwise LOS checks, accumulator updates, contact tier changes
    // -----------------------------------------------------------------------
    const p4Start = performance.now();
    if (isSecondTick && isLive) {
      this.phaseSpottingUpdates();
    }
    this.lastTimings.spottingMs = performance.now() - p4Start;

    // -----------------------------------------------------------------------
    // Phase 5: Fire Resolution — every tick (LIVE only)
    // 5a: auto-fire for FREE_FIRE units, 5b: player ENGAGE orders
    // -----------------------------------------------------------------------
    const p5Start = performance.now();
    if (isLive) {
      this.phaseFireResolution(dt);
    }
    this.lastTimings.fireMs = performance.now() - p5Start;

    // -----------------------------------------------------------------------
    // Phase 6: Damage Application — every tick (LIVE only)
    // Process shot records, to-hit, pen, crew damage, ERA depletion
    // -----------------------------------------------------------------------
    const p6Start = performance.now();
    if (isLive) {
      this.phaseDamageApplication();
    }
    this.lastTimings.damageMs = performance.now() - p6Start;

    // -----------------------------------------------------------------------
    // Phase 7: Suppression / Morale — decay every second, accumulation
    //          is event-driven (from phases 5–6 events)
    // -----------------------------------------------------------------------
    const p7Start = performance.now();
    this.phaseSuppressionMorale(dt, isSecondTick);
    this.lastTimings.suppressionMs = performance.now() - p7Start;

    // -----------------------------------------------------------------------
    // Phase 8: Supply Tick — every second (LIVE only)
    // Trickle resupply from supply vehicles within 150 m
    // -----------------------------------------------------------------------
    const p8Start = performance.now();
    if (isSecondTick && isLive) {
      this.phaseSupplyTick(dt);
    }
    this.lastTimings.supplyMs = performance.now() - p8Start;

    // -----------------------------------------------------------------------
    // Phase 9: State Broadcast — every second
    // Delta-encoded state sent to each player, fog-of-war filtered
    // -----------------------------------------------------------------------
    const p9Start = performance.now();
    if (isSecondTick) {
      this.phaseBroadcast();
    }
    this.lastTimings.broadcastMs = performance.now() - p9Start;

    this.session.checkDisconnectTimers(this.tick);

    // -----------------------------------------------------------------------
    // Advance tick counter and measure total
    // -----------------------------------------------------------------------
    this.tick++;
    this.lastTimings.totalMs = performance.now() - tickStart;

    // Warn if the tick exceeded its 50 ms budget
    if (this.lastTimings.totalMs > TICK_MS) {
      console.warn(
        `[TickLoop] Tick ${this.tick - 1} exceeded budget: ` +
        `${this.lastTimings.totalMs.toFixed(1)} ms`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Phase implementations (delegate to subsystem modules)
  // -------------------------------------------------------------------------

  /**
   * Phase 1: Input Processing
   * Dequeue all buffered orders from player connections.
   * Validate each order. Accept -> write to unit intent. Reject -> enqueue ack.
   */
  private phaseInputProcessing(): void {
    const players = this.session.getPlayers();

    for (const [playerId, playerConn] of players) {
      // Drain the inbound order buffer for this player
      const pendingOrders = playerConn.drainOrderBuffer();

      for (const orderMsg of pendingOrders) {
        const unitId = (orderMsg as ResolvedOrder & { unitId?: string }).unitId;
        if (!unitId) {
          continue;
        }

        const unit = this.session.getUnitRegistry().get(unitId);
        if (!unit || unit.ownerId !== playerId || unit.isDestroyed) {
          continue;
        }

        if (orderMsg.type === 'move' || orderMsg.type === 'move_fast' || orderMsg.type === 'reverse') {
          if (orderMsg.targetPos) {
            const moveMode =
              orderMsg.type === 'move_fast'
                ? 'march'
                : orderMsg.type === 'reverse'
                  ? 'reverse'
                  : 'advance';

            if (unit.orderQueue.length < MAX_QUEUED_WAYPOINTS) {
              unit.orderQueue.push({ pos: orderMsg.targetPos, moveMode });
            }
            if (!unit.currentOrder) {
              unit.currentOrder = {
                type: 'move',
                targetPos: orderMsg.targetPos,
                moveMode,
              };
            }
          }
          continue;
        }

        unit.currentOrder = orderMsg;
      }
    }
  }

  /**
   * Phase 2: Command Propagation
   * Propagate accepted orders to unit state fields (destination, target, posture).
   * AI decisions are injected here before player orders propagate.
   */
  private phaseCommandPropagation(): void {
    const units = this.session.getUnitRegistry();

    // --- AI layer injection (runs at start of Phase 2 per ENEMY_AI.md §2) ---
    const strategicAI = this.session.getStrategicAI();
    const platoonBT = this.session.getPlatoonBT();
    const influenceMapMgr = this.session.getInfluenceMapManager();
    const platoons = this.session.getPlatoons();
    const objectives = this.session.getObjectives();

    // Strategic AI: every 5 seconds (100 ticks)
    if (strategicAI && influenceMapMgr && this.tick % AI_STRATEGIC_UPDATE_TICKS === 0) {
      // Rebuild influence maps from current unit positions
      influenceMapMgr.rebuild(units, strategicAI.faction);

      // Build InfluenceMaps view for the strategic + BT layers
      const influenceMaps = {
        threat: {
          data: (influenceMapMgr as any).threatGrid as Float32Array,
          width: influenceMapMgr.gridWidth,
          height: influenceMapMgr.gridHeight,
          cellSizeM: influenceMapMgr.cellSizeM,
        },
        control: {
          data: (influenceMapMgr as any).controlGrid as Float32Array,
          width: influenceMapMgr.gridWidth,
          height: influenceMapMgr.gridHeight,
          cellSizeM: influenceMapMgr.cellSizeM,
        },
      };
      this.session.setInfluenceMaps(influenceMaps);

      // Run strategic evaluation
      const decision = strategicAI.update(
        this.tick, units, platoons, objectives, influenceMaps,
      );

      // Apply strategic intents to platoons
      for (const [platoonId, intent] of decision.assignedIntents) {
        const platoon = platoons.get(platoonId);
        if (platoon) platoon.intent = intent;
      }
    }

    // Platoon behavior trees: every 1 second (20 ticks)
    if (platoonBT && this.tick % AI_PLATOON_BT_TICKS === 0) {
      const cachedMaps = this.session.getInfluenceMaps();
      if (cachedMaps) {
        for (const [, platoon] of platoons) {
          // Only run BTs for AI-owned platoons
          if (platoon.factionId === 'federation') continue;

          // Find nearest detected enemy for this platoon
          let nearestEnemy: { x: number; z: number } | null = null;
          let nearestDist = Infinity;
          for (const uid of platoon.unitIds) {
            const u = units.get(uid);
            if (!u || u.isDestroyed) continue;
            for (const [, otherUnit] of units) {
              if (otherUnit.isDestroyed || otherUnit.ownerId === u.ownerId) continue;
              const dx = otherUnit.posX - u.posX;
              const dz = otherUnit.posZ - u.posZ;
              const d = dx * dx + dz * dz;
              if (d < nearestDist) {
                nearestDist = d;
                nearestEnemy = { x: otherUnit.posX, z: otherUnit.posZ };
              }
            }
          }

          const ctx = platoonBT.buildContext(
            platoon.platoonId,
            platoon.factionId as any,
            platoon.intent as PlatoonIntent,
            platoon.unitIds,
            platoon.commandUnitId,
            units,
            cachedMaps,
            objectives,
            nearestEnemy,
          );

          const btResult = platoonBT.tick(ctx, units);

          // Convert BT orders into unit orders
          for (const order of btResult.orders) {
            const unit = units.get(order.unitId);
            if (!unit || unit.isDestroyed) continue;
            const normalized = this.normalizeAIOrder(order.orderType, order.targetPos, order.targetUnitId);
            if (!normalized) continue;
            unit.currentOrder = normalized;
          }
        }
      }
    }

    // --- Player order propagation ---
    for (const [unitId, unit] of units) {
      void unitId;
      if (unit.isDestroyed) continue;
      if (!unit.currentOrder) continue;

      if (unit.currentOrder.type === 'set_posture' && unit.currentOrder.posture) {
        unit.firePosture = unit.currentOrder.posture;
        unit.currentOrder = null;
        continue;
      }

      if (unit.currentOrder.type === 'cancel') {
        unit.currentPath = null;
        unit.pathIndex = 0;
        unit.orderQueue.length = 0;
        unit.currentTargetId = null;
        unit.currentOrder = null;
        continue;
      }

      if (unit.currentOrder.type === 'engage' || unit.currentOrder.type === 'area_fire') {
        unit.currentTargetId = unit.currentOrder.targetUnitId ?? null;
        unit.engageSlotOverride = unit.currentOrder.weaponSlot ?? null;
      }

      if (unit.currentOrder.type === 'move' && unit.currentOrder.targetPos) {
        unit.currentPath = [
          { x: unit.posX, z: unit.posZ },
          unit.currentOrder.targetPos,
        ];
        unit.pathIndex = 1;
        unit.moveMode = unit.currentOrder.moveMode ?? 'advance';
      }

      unit.currentOrder = null;
    }
  }

  /**
   * Maps platoon-BT order strings to canonical runtime order types.
   * This keeps AI orders compatible with the existing command propagation path.
   */
  private normalizeAIOrder(
    orderType: string,
    targetPos?: { x: number; z: number },
    targetUnitId?: string,
  ): ResolvedOrder | null {
    if (orderType === 'move_advance') {
      return { type: 'move', targetPos, moveMode: 'advance' };
    }
    if (orderType === 'move_march') {
      return { type: 'move', targetPos, moveMode: 'march' };
    }
    if (orderType === 'move_reverse') {
      return { type: 'move', targetPos, moveMode: 'reverse' };
    }
    if (orderType === 'engage_pos') {
      return { type: 'area_fire', targetPos };
    }
    if (orderType === 'set_posture') {
      const posture = targetUnitId as FirePosture | undefined;
      if (posture === 'free_fire' || posture === 'return_fire' || posture === 'hold_fire') {
        return { type: 'set_posture', posture };
      }
      return null;
    }
    if (orderType === 'hold_position') {
      return { type: 'cancel' };
    }
    if (orderType === 'cancel') {
      return { type: 'cancel' };
    }
    return null;
  }

  /**
   * Phase 3: Movement Resolution — runs every tick.
   * Integrates unit positions along their active path.
   */
  private phaseMovementResolution(dt: number): void {
    const units = this.session.getUnitRegistry();
    const terrain = this.session.getTerrain();
    const spatialHash = this.session.getSpatialHash();
    const costGrids = this.session.getCostGrids();

    resolveMovement(units, dt, terrain, costGrids, this.session.getUnitTypeRegistry(), this.tick);

    // After positions change, update the spatial hash
    spatialHash.rebuildFromUnits(units);
  }

  /**
   * Phase 4: Spotting Updates — runs every second.
   * Pairwise LOS checks with spatial hash culling. Accumulator updates.
   */
  private phaseSpottingUpdates(): void {
    const units = this.session.getUnitRegistry();
    const contacts = this.session.getContactMap();
    const spatialHash = this.session.getSpatialHash();
    const terrain = this.session.getTerrain();

    updateSpotting(units, contacts, spatialHash, terrain, this.tick, this.session.getUnitTypeRegistry());
  }

  /**
   * Phase 5: Fire Resolution — runs every tick.
   * 5a: Auto-fire for FREE_FIRE posture units.
   * 5b: Player ENGAGE orders.
   */
  private phaseFireResolution(dt: number): void {
    const units = this.session.getUnitRegistry();
    const contacts = this.session.getContactMap();

    // Gather pending fire orders from unit intents
    const fireOrders: FireOrder[] = [];
    for (const [id, unit] of units) {
      if (unit.isDestroyed) continue;
      if (
        (unit.currentOrder?.type === 'engage' ||
         unit.currentOrder?.type === 'area_fire') &&
        unit.currentOrder.targetUnitId
      ) {
        fireOrders.push({
          unitId: id,
          targetUnitId: unit.currentOrder.targetUnitId,
          weaponSlot: unit.currentOrder.weaponSlot,
        });
      }
    }

    const fireResult = resolveFire(units, contacts, fireOrders, this.tick, this.session.getUnitTypeRegistry());

    // Store shot records on the session for Phase 6
    this.session.setPendingShotRecords(fireResult.shotRecords);

    // Emit shot-fired events for the intra-tick bus
    for (const shot of fireResult.shotRecords) {
      this.tickEvents.push({
        type: 'SHOT_FIRED',
        data: { firerId: shot.firerId, targetId: shot.targetId, weaponSlot: shot.weaponSlot },
      });
    }
  }

  /**
   * Phase 6: Damage Application — runs every tick.
   * Processes shot records, performs hit/pen/kill rolls.
   */
  private phaseDamageApplication(): void {
    const shotRecords = this.session.getPendingShotRecords();
    if (shotRecords.length === 0) return;

    const units = this.session.getUnitRegistry();
    const unitTypes = this.session.getUnitTypeRegistry();
    const damagePhaseResult = applyDamage(shotRecords, units, this.tick, unitTypes);

    // Emit destruction and impact events for Phase 7 (suppression)
    for (const result of damagePhaseResult.damageResults) {
      this.tickEvents.push({
        type: 'SHOT_IMPACT',
        data: {
          targetId: result.targetId,
          damage: result.crewLost,
          penetrated: result.crewLost > 0,
        },
      });

      if (result.isDestroyed) {
        this.tickEvents.push({
          type: 'UNIT_DESTROYED',
          data: { unitId: result.targetId },
        });
      }
    }

    // Store damage results on session for broadcast
    this.session.setPendingDamageResults(damagePhaseResult.damageResults);
  }

  /**
   * Phase 7: Suppression / Morale
   * Accumulation is event-driven (from Phase 5-6 impacts).
   * Decay + morale state transitions run every second.
   */
  private phaseSuppressionMorale(dt: number, isSecondTick: boolean): void {
    const units = this.session.getUnitRegistry();

    // Collect impact events from this tick, convert to SuppressionImpact
    const impacts = this.tickEvents
      .filter((e) => e.type === 'SHOT_IMPACT')
      .map((e) => ({
        targetId: (e.data as { targetId: string }).targetId,
        warheadSize: (e.data as { damage?: number }).damage ?? 1,
        isDirectHit: true,
        isNearMiss: false,
        nearMissDistanceM: 0,
      }));

    updateSuppression(units, impacts, this.tick, isSecondTick);
  }

  /**
   * Phase 8: Supply Tick — runs every second.
   * Trickle resupply for units near supply vehicles.
   */
  private phaseSupplyTick(dt: number): void {
    const units = this.session.getUnitRegistry();
    const spatialHash = this.session.getSpatialHash();

    tickSupply(units, spatialHash, dt, this.session.getUnitTypeRegistry());
  }

  /**
   * Phase 9: State Broadcast — runs every second.
   * Compute delta from previous state, fog-filter per player, send over WS.
   */
  private phaseBroadcast(): void {
    broadcastGameState(this.session, this.tickEvents, this.tick);
  }

  // -------------------------------------------------------------------------
  // M3: Mission Lifecycle phase
  // -------------------------------------------------------------------------

  /**
   * Phase 0: Mission Lifecycle — runs every tick.
   * Checks the mission state machine for phase transitions.
   */
  private phaseMissionLifecycle(): void {
    const lifecycle = this.session.getLifecycle();
    if (!lifecycle) return;

    const units = this.session.getUnitRegistry();
    const players = this.session.getPlayers();
    const objTracker = this.session.getObjectiveTracker();

    // Build lifecycle context
    let playerCount = 0;
    let allReady = true;
    let allAckedAAR = true;

    for (const [, conn] of players) {
      if (conn.isConnected) {
        playerCount++;
        if (!conn.readyForDeployment) allReady = false;
        if (!conn.acknowledgedAAR) allAckedAAR = false;
      }
    }
    // For "all players ready" to be meaningful, need at least 1 player
    if (playerCount === 0) allReady = false;

    // Check if all player units are destroyed
    let anyPlayerUnitAlive = false;
    for (const [, unit] of units) {
      if (unit.isDestroyed) continue;
      if (unit.ownerId !== this.session.getAiFactionId()) {
        anyPlayerUnitAlive = true;
        break;
      }
    }

    const context = {
      playerCount,
      allPlayersReady: allReady,
      allObjectivesComplete: objTracker?.allPrimaryComplete() ?? false,
      allPlayerUnitsDestroyed: playerCount > 0 && !anyPlayerUnitAlive,
      allPlayersAcknowledgedAAR: playerCount > 0 && allAckedAAR,
    };

    const transition = lifecycle.tick(this.tick, context);
    if (transition) {
      console.log(`[TickLoop] Mission phase: ${transition.fromPhase} -> ${transition.toPhase} (${transition.reason})`);
      this.session.setPhase(transition.toPhase);
      this.session.onPhaseTransition(transition.toPhase, transition.reason, this.tick);
    }
  }

  // -------------------------------------------------------------------------
  // M3: Objective Updates phase
  // -------------------------------------------------------------------------

  /**
   * Phase 0b: Objective Updates — runs every tick during LIVE phase.
   */
  private phaseObjectiveUpdates(): void {
    const objTracker = this.session.getObjectiveTracker();
    if (!objTracker) return;

    const units = this.session.getUnitRegistry();
    const updates = objTracker.update(units, this.tick);

    // Push objective update events for broadcast
    for (const update of updates) {
      this.tickEvents.push({
        type: 'OBJECTIVE_UPDATE',
        data: {
          objectiveId: update.objectiveId,
          progress: update.progress,
          isCompleted: update.isCompleted,
        },
      });
    }
  }
}
