// ============================================================================
// PHASE 9: STATE BROADCAST — Delta encoding and WebSocket send
// Milestone 2
// Source: NETWORK_PROTOCOL.md, SERVER_GAME_LOOP.md
//
// Runs every second (tick % 20 === 0). Game events are sent immediately.
// Target: < 5 KB/s per player during steady-state.
// ============================================================================
import { serializeServerMessage } from './protocol.js';
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
const previousContactsBySession = new WeakMap();
function cloneContactState(contacts) {
    const perPlayer = new Map();
    for (const [playerId, contactMap] of contacts) {
        const values = new Map();
        for (const [contactId, entry] of contactMap) {
            values.set(contactId, entry.detectionValue);
        }
        perPlayer.set(playerId, values);
    }
    return perPlayer;
}
function computeContactDeltas(playerContacts, previousPlayerContacts) {
    const deltas = [];
    for (const [contactId, contact] of playerContacts) {
        if (contact.detectionValue <= 0)
            continue;
        const prev = previousPlayerContacts?.get(contactId);
        deltas.push({
            contactId,
            action: prev === undefined ? 'add' : 'update',
            tier: contact.detectionValue,
            tierLabel: contact.detectionTier === 'LOST' ? 'SUSPECTED' : contact.detectionTier,
            posX: contact.estimatedPos.x,
            posZ: contact.estimatedPos.z,
            unitClass: contact.estimatedCategory ?? undefined,
            lastSeenTick: contact.lastSeenTick,
        });
    }
    if (previousPlayerContacts) {
        for (const [contactId] of previousPlayerContacts) {
            if (!playerContacts.has(contactId)) {
                deltas.push({
                    contactId,
                    action: 'remove',
                });
            }
        }
    }
    return deltas;
}
function mapTickEventsToGameEvents(tickEvents) {
    const events = [];
    for (const event of tickEvents) {
        const typed = event;
        if (!typed.type || !typed.data)
            continue;
        if (typed.type === 'SHOT_FIRED') {
            events.push({
                type: 'shot_fired',
                firerId: String(typed.data.firerId ?? ''),
                targetId: String(typed.data.targetId ?? ''),
                weaponSlot: Number(typed.data.weaponSlot ?? 0),
                fromPos: { x: 0, z: 0 },
                toPos: { x: 0, z: 0 },
            });
        }
        if (typed.type === 'SHOT_IMPACT') {
            events.push({
                type: 'shot_impact',
                targetId: String(typed.data.targetId ?? ''),
                pos: { x: 0, z: 0 },
                penetrated: Boolean(typed.data.penetrated),
                damage: Number(typed.data.damage ?? 0),
            });
        }
        if (typed.type === 'UNIT_DESTROYED') {
            events.push({
                type: 'unit_destroyed',
                unitId: String(typed.data.unitId ?? ''),
                killerUnitId: '',
                pos: { x: 0, z: 0 },
            });
        }
    }
    return events;
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
    const session = _session;
    const units = session.getUnitRegistry();
    const contacts = session.getContactMap();
    const connectedPlayers = session.getConnectedPlayers();
    const previousUnits = session.getPreviousBroadcastState();
    const previousUnitSnapshot = {
        unitStates: new Map([...previousUnits.entries()].map(([unitId, prev]) => [
            unitId,
            {
                posX: prev.posX ?? 0,
                posZ: prev.posZ ?? 0,
                heading: prev.heading ?? 0,
                crewCurrent: prev.crewCurrent ?? 0,
                suppressionLevel: prev.suppressionLevel ?? 0,
                moraleState: String(prev.moraleState ?? 'normal'),
                speedState: String(prev.speedState ?? 'full_halt'),
                isDestroyed: Boolean(prev.isDestroyed),
            },
        ])),
        tick: _tick,
    };
    const previousContacts = previousContactsBySession.get(_session) ?? new Map();
    const gameEvents = mapTickEventsToGameEvents(_tickEvents);
    for (const player of connectedPlayers) {
        const unitDeltas = computeUnitDeltas(units, previousUnitSnapshot, player.playerId);
        const playerContacts = contacts.get(player.playerId) ?? new Map();
        const contactDeltas = computeContactDeltas(playerContacts, previousContacts.get(player.playerId));
        const payload = buildTickUpdate(unitDeltas, contactDeltas, gameEvents, _tick, _tick / 20);
        const wireMessage = serializeServerMessage({ type: 'TICK_UPDATE', payload }, _tick);
        try {
            const socket = player.ws;
            if (socket.readyState === 1 && socket.send) {
                socket.send(wireMessage);
            }
        }
        catch {
            // Ignore transient socket errors; disconnect lifecycle is handled elsewhere.
        }
    }
    const newPrev = new Map();
    for (const [unitId, unit] of units) {
        newPrev.set(unitId, {
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
    session.setPreviousBroadcastState(newPrev);
    previousContactsBySession.set(_session, cloneContactState(contacts));
}
