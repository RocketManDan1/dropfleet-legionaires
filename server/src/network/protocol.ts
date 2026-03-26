// ============================================================================
// NETWORK PROTOCOL — Message parsing, serialization, fog-of-war filtering
// Milestone 2
// Source: NETWORK_PROTOCOL.md
// ============================================================================

import type {
  ClientMessage, ServerMessage, MessageEnvelope,
  UnitInstance, ContactEntry, UnitSnapshot, ContactSnapshot,
} from '@legionaires/shared';
import {
  TIER_SUSPECTED_MAX, TIER_DETECTED_MIN, TIER_CONFIRMED_MIN,
} from '@legionaires/shared';
import type { UnitRegistry } from '../data/unit-registry.js';

/**
 * Parse a raw WebSocket message string into a typed ClientMessage.
 * Returns null if the message is malformed.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const envelope = JSON.parse(raw) as MessageEnvelope;
    if (!envelope.type || typeof envelope.type !== 'string') return null;

    // Validate known message types
    const validTypes = [
      'AUTH', 'JOIN_MISSION', 'PING', 'ORDER', 'DEPLOY_UNIT',
      'DEPLOY_READY', 'AAR_ACK', 'THEATER_SUPPORT', 'CHAT', 'DISCONNECT_GRACEFUL',
    ];
    if (!validTypes.includes(envelope.type)) return null;

    return { type: envelope.type, payload: envelope.payload } as ClientMessage;
  } catch {
    return null;
  }
}

/**
 * Serialize a server message to JSON string for WebSocket send.
 */
export function serializeServerMessage(msg: ServerMessage, tick: number): string {
  const envelope: MessageEnvelope = {
    type: msg.type,
    seq: 0,           // server always sends seq 0
    tick,
    payload: msg.payload,
  };
  return JSON.stringify(envelope);
}

/**
 * Create a fog-of-war filtered unit snapshot for a specific player.
 * Players see full state for their own units, filtered state for contacts.
 */
export function filterUnitsForPlayer(
  playerId: string,
  units: Map<string, UnitInstance>,
  contacts: Map<string, ContactEntry>,
  registry?: UnitRegistry,
): UnitSnapshot[] {
  const snapshots: UnitSnapshot[] = [];

  for (const [_id, unit] of units) {
    if (unit.ownerId === playerId) {
      // Full state for own units
      snapshots.push(unitToFullSnapshot(unit, registry));
    }
    // Enemy units are NOT sent as UnitSnapshots — they come via ContactSnapshots
  }

  return snapshots;
}

/**
 * Create fog-filtered contact snapshots for a specific player.
 */
export function filterContactsForPlayer(
  contacts: Map<string, ContactEntry>,
): ContactSnapshot[] {
  const snapshots: ContactSnapshot[] = [];

  for (const [_id, contact] of contacts) {
    if (contact.detectionValue <= 0) continue;

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
function unitToFullSnapshot(unit: UnitInstance, registry?: UnitRegistry): UnitSnapshot {
  const unitType = registry?.get(unit.unitTypeId);
  return {
    unitId: unit.instanceId,
    unitTypeId: unit.unitTypeId,
    unitName: unitType?.name,
    unitClass: unitType?.unitClass,
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
