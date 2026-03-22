// ============================================================================
// TICK LOOP — 20 Hz fixed-rate game loop (50 ms per tick)
// Source: SERVER_GAME_LOOP.md — 9 phases in strict single-threaded order
// Milestone 2 scaffold
// ============================================================================

import type {
  UnitInstance,
  MissionState,
  ContactEntry,
  ResolvedOrder,
} from '@legionaires/shared';
import {
  TICK_RATE_HZ,
  TICK_MS,
  TICKS_PER_SEC,
  SPOTTING_UPDATE_TICKS,
  AI_STRATEGIC_UPDATE_TICKS,
  AI_PLATOON_BT_TICKS,
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
    const isSecondTick = this.tick % TICKS_PER_SEC === 0;
    const dt = 1 / TICK_RATE_HZ; // 0.05 seconds per tick

    // Clear the intra-tick event buffer
    this.tickEvents = [];

    // Get references from the session for convenience
    const units = this.session.getUnitRegistry();
    const terrain = this.session.getTerrain();
    const spatialHash = this.session.getSpatialHash();
    const missionState = this.session.getMissionState();

    // -----------------------------------------------------------------------
    // Phase 1: Input Processing — every tick
    // Read inbound order queue, validate, write to per-unit order state
    // -----------------------------------------------------------------------
    const p1Start = performance.now();
    this.phaseInputProcessing();
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
    // Phase 3: Movement Resolution — every tick
    // Integrate unit positions along paths
    // -----------------------------------------------------------------------
    const p3Start = performance.now();
    this.phaseMovementResolution(dt);
    this.lastTimings.movementMs = performance.now() - p3Start;

    // -----------------------------------------------------------------------
    // Phase 4: Spotting Updates — every second (tick % 20 === 0)
    // Pairwise LOS checks, accumulator updates, contact tier changes
    // -----------------------------------------------------------------------
    const p4Start = performance.now();
    if (isSecondTick) {
      this.phaseSpottingUpdates();
    }
    this.lastTimings.spottingMs = performance.now() - p4Start;

    // -----------------------------------------------------------------------
    // Phase 5: Fire Resolution — every tick
    // 5a: auto-fire for FREE_FIRE units, 5b: player ENGAGE orders
    // -----------------------------------------------------------------------
    const p5Start = performance.now();
    this.phaseFireResolution(dt);
    this.lastTimings.fireMs = performance.now() - p5Start;

    // -----------------------------------------------------------------------
    // Phase 6: Damage Application — every tick
    // Process shot records, to-hit, pen, crew damage, ERA depletion
    // -----------------------------------------------------------------------
    const p6Start = performance.now();
    this.phaseDamageApplication();
    this.lastTimings.damageMs = performance.now() - p6Start;

    // -----------------------------------------------------------------------
    // Phase 7: Suppression / Morale — decay every second, accumulation
    //          is event-driven (from phases 5–6 events)
    // -----------------------------------------------------------------------
    const p7Start = performance.now();
    this.phaseSuppressionMorale(dt, isSecondTick);
    this.lastTimings.suppressionMs = performance.now() - p7Start;

    // -----------------------------------------------------------------------
    // Phase 8: Supply Tick — every second
    // Trickle resupply from supply vehicles within 150 m
    // -----------------------------------------------------------------------
    const p8Start = performance.now();
    if (isSecondTick) {
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
        // TODO: Validate order (ownership, unit alive, legal for class,
        //       contact gate, range, ammo, suppression, queue depth, C2 range)
        //       See SERVER_GAME_LOOP.md §4 for the 10-check validation sequence.

        // TODO: On accept — write ResolvedOrder to unit's currentOrder
        // TODO: On reject — send ORDER_ACK with status: 'REJECTED' and reason
        // TODO: On accept — send ORDER_ACK with status: 'ACCEPTED'
      }
    }
  }

  /**
   * Phase 2: Command Propagation
   * Propagate accepted orders to unit state fields (destination, target, posture).
   * AI decisions are injected here before player orders propagate.
   */
  private phaseCommandPropagation(): void {
    // --- AI layer injection (runs at start of Phase 2 per ENEMY_AI.md §2) ---

    // Strategic AI: every 5 seconds (100 ticks)
    if (this.tick % AI_STRATEGIC_UPDATE_TICKS === 0) {
      // TODO: Call strategicAI.evaluate(missionState, influenceMaps)
      //       Updates platoon intents (attack/defend/reinforce/retreat/patrol)
    }

    // Platoon behavior trees: every 1 second (20 ticks)
    if (this.tick % AI_PLATOON_BT_TICKS === 0) {
      // TODO: Call platoonBT.tick(platoons, aiContext)
      //       Produces per-unit movement/fire orders for AI platoons
    }

    // --- Player order propagation ---
    const units = this.session.getUnitRegistry();
    for (const [unitId, unit] of units) {
      if (unit.isDestroyed) continue;
      if (!unit.currentOrder) continue;

      // TODO: Translate ResolvedOrder into unit intent fields:
      //   - MOVE orders: compute A* path, set currentPath/pathIndex
      //   - ENGAGE orders: set currentTargetId, engageSlotOverride
      //   - SET_POSTURE: update firePosture
      //   - RALLY: apply -15 suppression with cooldown check
      //   - CANCEL: clear path queue, halt unit
      //   - Shift-queued moves: append to orderQueue (max 4)
    }
  }

  /**
   * Phase 3: Movement Resolution — runs every tick.
   * Integrates unit positions along their active path.
   */
  private phaseMovementResolution(dt: number): void {
    const units = this.session.getUnitRegistry();
    const terrain = this.session.getTerrain();
    const spatialHash = this.session.getSpatialHash();

    // TODO: Build or retrieve cost grids (one per MoveClass, built at mission start)
    const costGrids = null as any; // TODO: Replace with real cost grid map

    resolveMovement(units, dt, terrain, costGrids);

    // After positions change, update the spatial hash
    // TODO: spatialHash.rebuildFromUnits(units);
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

    updateSpotting(units, contacts, spatialHash, terrain);
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

    const fireResult = resolveFire(units, contacts, fireOrders, dt);

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
    const damagePhaseResult = applyDamage(shotRecords, units, this.tick);

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

    updateSuppression(units, impacts, dt, isSecondTick);
  }

  /**
   * Phase 8: Supply Tick — runs every second.
   * Trickle resupply for units near supply vehicles.
   */
  private phaseSupplyTick(dt: number): void {
    const units = this.session.getUnitRegistry();
    const spatialHash = this.session.getSpatialHash();

    tickSupply(units, spatialHash, dt);
  }

  /**
   * Phase 9: State Broadcast — runs every second.
   * Compute delta from previous state, fog-filter per player, send over WS.
   */
  private phaseBroadcast(): void {
    broadcastGameState(this.session, this.tickEvents, this.tick);
  }
}
