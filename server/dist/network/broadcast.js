// ============================================================================
// PHASE 9: STATE BROADCAST — Delta encoding and WebSocket send
// Milestone 2
// Source: NETWORK_PROTOCOL.md, SERVER_GAME_LOOP.md
//
// Runs every second (tick % 20 === 0). Game events are sent immediately.
// Target: < 5 KB/s per player during steady-state.
// ============================================================================
/**
 * Compute unit deltas by comparing current state to previous broadcast.
 * Only include fields that have changed.
 */
export function computeUnitDeltas(units, previousState, playerId) {
    const deltas = [];
    for (const [unitId, unit] of units) {
        // Only send deltas for units this player owns
        if (unit.ownerId !== playerId)
            continue;
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
        const delta = { unitId };
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
        if (hasChanges)
            deltas.push(delta);
    }
    return deltas;
}
/**
 * Snapshot the current state for next delta comparison.
 */
export function captureStateSnapshot(units, tick) {
    const unitStates = new Map();
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
export function buildTickUpdate(unitDeltas, contactDeltas, events, tick, missionTimeSec) {
    return {
        tick,
        missionTimeSec,
        unitDeltas,
        contactDeltas,
        events,
    };
}
/**
 * Broadcast current game state delta to all connected players.
 * Milestone 2 stub — full fog-of-war filtering and compression added there.
 * @param session - The active GameSession (typed as `any` to avoid circular import).
 * @param tickEvents - Events generated this tick.
 * @param tick - Current tick number.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function broadcastGameState(_session, _tickEvents, _tick) {
    // TODO (Milestone 2): Iterate session.getConnectedPlayers(), compute per-player
    // unit/contact deltas, build TickUpdatePayload, serialise and send.
    // For now, no-op — M1 uses direct WS messages in index.ts.
}
