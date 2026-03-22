// ============================================================================
// PHASE 9: STATE BROADCAST — Delta encoding and WebSocket send
// Milestone 2
// Source: NETWORK_PROTOCOL.md, SERVER_GAME_LOOP.md
//
// Runs every second (tick % 20 === 0). Game events are sent immediately.
// Target: < 5 KB/s per player during steady-state.
// ============================================================================

import type {
  UnitInstance, UnitDelta, ContactDelta, GameEvent,
  TickUpdatePayload, PlayerMissionState,
} from '@legionaires/shared';

// --- Previous state snapshot for delta computation ---

export interface PreviousBroadcastState {
  unitStates: Map<string, UnitBroadcastSnapshot>;
  tick: number;
}

interface UnitBroadcastSnapshot {
  posX: number;
  posZ: number;
  heading: number;
  crewCurrent: number;
  suppressionLevel: number;
  moraleState: string;
  speedState: string;
  isDestroyed: boolean;
}

/**
 * Compute unit deltas by comparing current state to previous broadcast.
 * Only include fields that have changed.
 */
export function computeUnitDeltas(
  units: Map<string, UnitInstance>,
  previousState: PreviousBroadcastState,
  playerId: string,
): UnitDelta[] {
  const deltas: UnitDelta[] = [];

  for (const [unitId, unit] of units) {
    // Only send deltas for units this player owns
    if (unit.ownerId !== playerId) continue;

    const prev = previousState.unitStates.get(unitId);
    if (!prev) {
      // New unit since last broadcast — send full delta
      deltas.push({
        unitId,
        posX: unit.posX,
        posZ: unit.posZ,
        heading: unit.heading,
        hp: unit.crewCurrent,
        suppression: unit.suppressionLevel,
        moraleState: unit.moraleState,
        speedState: unit.speedState,
        destroyed: unit.isDestroyed || undefined,
      });
      continue;
    }

    // Build delta of only changed fields
    const delta: UnitDelta = { unitId };
    let hasChanges = false;

    // Position: only send if moved more than 0.1m
    const dx = unit.posX - prev.posX;
    const dz = unit.posZ - prev.posZ;
    if (dx * dx + dz * dz > 0.01) {
      delta.posX = unit.posX;
      delta.posZ = unit.posZ;
      delta.heading = unit.heading;
      hasChanges = true;
    }

    if (unit.crewCurrent !== prev.crewCurrent) {
      delta.hp = unit.crewCurrent;
      hasChanges = true;
    }
    if (unit.suppressionLevel !== prev.suppressionLevel) {
      delta.suppression = unit.suppressionLevel;
      hasChanges = true;
    }
    if (unit.moraleState !== prev.moraleState) {
      delta.moraleState = unit.moraleState;
      hasChanges = true;
    }
    if (unit.speedState !== prev.speedState) {
      delta.speedState = unit.speedState;
      hasChanges = true;
    }
    if (unit.isDestroyed && !prev.isDestroyed) {
      delta.destroyed = true;
      hasChanges = true;
    }

    if (hasChanges) deltas.push(delta);
  }

  return deltas;
}

/**
 * Snapshot the current state for next delta comparison.
 */
export function captureStateSnapshot(
  units: Map<string, UnitInstance>,
  tick: number,
): PreviousBroadcastState {
  const unitStates = new Map<string, UnitBroadcastSnapshot>();

  for (const [unitId, unit] of units) {
    unitStates.set(unitId, {
      posX: unit.posX,
      posZ: unit.posZ,
      heading: unit.heading,
      crewCurrent: unit.crewCurrent,
      suppressionLevel: unit.suppressionLevel,
      moraleState: unit.moraleState,
      speedState: unit.speedState,
      isDestroyed: unit.isDestroyed,
    });
  }

  return { unitStates, tick };
}

/**
 * Build a TickUpdatePayload for a specific player.
 */
export function buildTickUpdate(
  unitDeltas: UnitDelta[],
  contactDeltas: ContactDelta[],
  events: GameEvent[],
  tick: number,
  missionTimeSec: number,
): TickUpdatePayload {
  return {
    tick,
    missionTimeSec,
    unitDeltas,
    contactDeltas,
    events,
  };
}
