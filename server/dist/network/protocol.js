// ============================================================================
// NETWORK PROTOCOL — Message parsing, serialization, fog-of-war filtering
// Milestone 2
// Source: NETWORK_PROTOCOL.md
// ============================================================================
import { TIER_DETECTED_MIN, TIER_CONFIRMED_MIN, } from '@legionaires/shared';
/**
 * Parse a raw WebSocket message string into a typed ClientMessage.
 * Returns null if the message is malformed.
 */
export function parseClientMessage(raw) {
    try {
        const envelope = JSON.parse(raw);
        if (!envelope.type || typeof envelope.type !== 'string')
            return null;
        // Validate known message types
        const validTypes = [
            'AUTH', 'JOIN_MISSION', 'PING', 'ORDER', 'DEPLOY_UNIT',
            'DEPLOY_READY', 'THEATER_SUPPORT', 'CHAT', 'DISCONNECT_GRACEFUL',
        ];
        if (!validTypes.includes(envelope.type))
            return null;
        return { type: envelope.type, payload: envelope.payload };
    }
    catch {
        return null;
    }
}
/**
 * Serialize a server message to JSON string for WebSocket send.
 */
export function serializeServerMessage(msg, tick) {
    const envelope = {
        type: msg.type,
        seq: 0, // server always sends seq 0
        tick,
        payload: msg.payload,
    };
    return JSON.stringify(envelope);
}
/**
 * Create a fog-of-war filtered unit snapshot for a specific player.
 * Players see full state for their own units, filtered state for contacts.
 */
export function filterUnitsForPlayer(playerId, units, contacts) {
    const snapshots = [];
    for (const [_id, unit] of units) {
        if (unit.ownerId === playerId) {
            // Full state for own units
            snapshots.push(unitToFullSnapshot(unit));
        }
        // Enemy units are NOT sent as UnitSnapshots — they come via ContactSnapshots
    }
    return snapshots;
}
/**
 * Create fog-filtered contact snapshots for a specific player.
 */
export function filterContactsForPlayer(contacts) {
    const snapshots = [];
    for (const [_id, contact] of contacts) {
        if (contact.detectionValue <= 0)
            continue;
        snapshots.push({
            contactId: contact.observedUnitId,
            tier: contact.detectionValue,
            tierLabel: contact.detectionTier === 'LOST' ? 'SUSPECTED' : contact.detectionTier,
            posX: contact.estimatedPos.x,
            posZ: contact.estimatedPos.z,
            unitClass: contact.detectionValue >= TIER_DETECTED_MIN
                ? (contact.estimatedCategory ?? undefined)
                : undefined,
            heading: contact.detectionValue >= TIER_CONFIRMED_MIN
                ? undefined // TODO: get actual heading
                : undefined,
            lastSeenTick: contact.lastSeenTick,
        });
    }
    return snapshots;
}
/**
 * Convert a full UnitInstance to a UnitSnapshot for the owning player.
 */
function unitToFullSnapshot(unit) {
    return {
        unitId: unit.instanceId,
        unitTypeId: unit.unitTypeId,
        ownerId: unit.ownerId,
        posX: unit.posX,
        posZ: unit.posZ,
        heading: unit.heading,
        turretHeading: unit.turretHeading ?? undefined,
        crewCurrent: unit.crewCurrent,
        crewMax: unit.crewMax,
        suppression: unit.suppressionLevel,
        moraleState: unit.moraleState,
        speedState: unit.speedState,
        firePosture: unit.firePosture,
        ammo: [...unit.ammo],
        isDestroyed: unit.isDestroyed,
        isEntrenched: unit.isEntrenched,
    };
}
