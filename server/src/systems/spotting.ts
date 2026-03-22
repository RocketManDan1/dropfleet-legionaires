// ============================================================================
// SPOTTING UPDATES — Phase 4 of the tick loop
// Source: Spotting and Contact Model.md, AUTHORITATIVE_CONTRACTS.md §5
// Runs every second (tick % 20 === 0). Pairwise LOS and accumulator updates.
// Milestone 2 scaffold
// ============================================================================

import type {
  UnitInstance,
  ContactEntry,
  Vec2,
  ContactTier,
  FactionId,
  UnitClass,
  SensorTier,
} from '@legionaires/shared';
import {
  BASE_ACCUMULATION_RATE,
  DECAY_RATE_PER_SEC,
  TIER_SUSPECTED_MIN,
  TIER_SUSPECTED_MAX,
  TIER_DETECTED_MIN,
  TIER_DETECTED_MAX,
  TIER_CONFIRMED_MIN,
  TIER_CONFIRMED_MAX,
  SIZE_ZERO_VISION_CAP,
  LOST_DISPLAY_FADE_SEC,
  SPATIAL_HASH_CELL_SIZE,
  THERMAL_VISION_THRESHOLD,
  RADAR_VISION_THRESHOLD,
  LOS_FOREST_OPTICAL,
  LOS_FOREST_THERMAL,
  LOS_ORCHARD_OPTICAL,
  LOS_ORCHARD_THERMAL,
  LOS_SMOKE_OPTICAL,
  LOS_SMOKE_THERMAL,
  LOS_SMOKE_BLOCK_COUNT,
  TICKS_PER_SEC,
} from '@legionaires/shared';

import type { SpatialHash } from '../game/spatial-hash.js';
import type { TerrainData } from '../game/session.js';

// ---------------------------------------------------------------------------
// Sensor tier classification
// ---------------------------------------------------------------------------

/**
 * Determine the sensor tier based on the observer's visionM value.
 * See Spotting and Contact Model §Sensor Tiers.
 */
function getSensorTier(visionM: number): SensorTier {
  if (visionM >= RADAR_VISION_THRESHOLD) return 'radar';
  if (visionM >= THERMAL_VISION_THRESHOLD) return 'thermal';
  return 'optical';
}

// ---------------------------------------------------------------------------
// Detection tier from accumulator value
// ---------------------------------------------------------------------------

/**
 * Map a raw detection accumulator value (0–100) to a contact tier label.
 * See Spotting and Contact Model §Contact Tiers.
 */
function detectionValueToTier(value: number): ContactTier {
  if (value >= TIER_CONFIRMED_MIN) return 'CONFIRMED';
  if (value >= TIER_DETECTED_MIN) return 'DETECTED';
  if (value >= TIER_SUSPECTED_MIN) return 'SUSPECTED';
  return 'LOST';
}

// ---------------------------------------------------------------------------
// Target signature multipliers
// ---------------------------------------------------------------------------

/**
 * Compute the target's signature multiplier based on its current state.
 * Applied to the observer's base detection range.
 * See Spotting and Contact Model §Signature Multipliers.
 *
 * @param target  The unit being observed
 * @returns Range multiplier (0.5 to 2.0)
 */
function targetSignatureMultiplier(target: UnitInstance): number {
  // Main gun firing signature: 2.0x for 1 second
  if (target.firedThisTick) return 2.0;

  // Smoke: own smoke partially obscures
  // TODO: Check if target has active smoke discharger effect
  // if (target.hasActiveSmoke) return 0.5;

  switch (target.speedState) {
    case 'fast': return 1.5;
    case 'slow': return 1.0;
    case 'short_halt':
    case 'full_halt': return 0.8;
    default: return 1.0;
  }
}

// ---------------------------------------------------------------------------
// Observer quality modifiers
// ---------------------------------------------------------------------------

/**
 * Compute the observer's quality modifier based on its state.
 * See Spotting and Contact Model §Observer Quality Modifiers.
 *
 * @param observer The observing unit
 * @returns Range modifier (0.7 to 1.2)
 */
function observerQualityMod(observer: UnitInstance): number {
  // TODO: Look up unitClass from UnitType — for now treat all as baseline
  // Scout units can spot while moving fast without penalty
  // const isScout = observerType.unitClass === 'scout';

  switch (observer.speedState) {
    case 'full_halt':
    case 'short_halt':
      // Stationary infantry: +20%, stationary vehicle: baseline
      // TODO: Check if observer is infantry (moveClass === 'leg')
      return 1.0; // TODO: Return 1.2 for infantry
    case 'slow': return 0.9;
    case 'fast': return 0.7;
    default: return 1.0;
  }
}

// ---------------------------------------------------------------------------
// Accumulation rate (points per second)
// ---------------------------------------------------------------------------

/**
 * Compute the accumulation rate for an observer/target pair.
 * Modifiers stack multiplicatively in fixed order per Spotting spec §Modifier Stacking Order:
 *   finalRate = BASE_RATE × sensorTierMod × observerRoleMod × targetConcealmentMod × targetStateMod
 *
 * @param observerVisionM Observer's visionM (from UnitType)
 * @param observerClass   Observer's unit class
 * @param observerMoveClass Observer's move class
 * @param targetSize      Target's size (0–6)
 * @param targetSpeedState Target's speed state
 * @returns Accumulation rate in points per second
 */
function accumulationRate(
  observerVisionM: number,
  observerClass: UnitClass,
  observerMoveClass: string,
  targetSize: number,
  targetSpeedState: string,
): number {
  let rate = BASE_ACCUMULATION_RATE; // 10 pts/sec

  // 1. Sensor tier modifier
  if (observerVisionM >= RADAR_VISION_THRESHOLD) {
    // Radar: handled separately (instant set to 25), not via accumulation
    return 0;
  }
  if (observerVisionM >= THERMAL_VISION_THRESHOLD) {
    rate *= 1.3; // TI bonus
  }

  // 2. Observer role modifier
  switch (observerClass) {
    case 'scout':   rate *= 1.4; break;
    case 'sniper':  rate *= 1.3; break;
    case 'hq':      rate *= 1.1; break;
    default:
      // Generic infantry: moveClass 'leg' -> +20%
      if (observerMoveClass === 'leg') rate *= 1.2;
      break;
  }

  // 3. Target concealment modifier (from size)
  //    concealmentMod = 1 - (6 - target.size) * 0.05
  //    size 6 = 1.0 (no bonus), size 0 = 0.7 (30% slower)
  const concealmentMod = 1 - (6 - targetSize) * 0.05;
  rate *= concealmentMod;

  // 4. Target state modifier
  //    Stationary + small (size ≤ 1): 0.5x
  if (
    (targetSpeedState === 'full_halt' || targetSpeedState === 'short_halt') &&
    targetSize <= 1
  ) {
    rate *= 0.5;
  }

  return rate;
}

// ---------------------------------------------------------------------------
// LOS check placeholder
// ---------------------------------------------------------------------------

/**
 * Perform a line-of-sight raycast from observer to target.
 * Returns true if LOS exists, false if blocked.
 *
 * TODO: Implement Bresenham grid walk with bilinear heightmap interpolation
 *       per LOS_RAYCASTING.md. For now, returns true (unobstructed).
 *
 * @param observer  Observer position
 * @param target    Target position
 * @param terrain   Terrain data (heightmap, building grid, etc.)
 * @returns Whether LOS exists between observer and target
 */
function hasLineOfSight(
  observer: Vec2,
  target: Vec2,
  terrain: TerrainData,
): boolean {
  // TODO: Implement full LOS raycast per LOS_RAYCASTING.md:
  //   1. Bresenham grid walk from observer to target
  //   2. At each cell, bilinear interpolation on heightmap
  //   3. Check if terrain elevation exceeds the LOS ray height
  //   4. Check for building obstruction
  //   5. Check for woodland/smoke and apply range reduction multipliers
  //      (not blocking, but range penalties per §LOS Reduction Rules)
  return true;
}

/**
 * Compute LOS obstruction factors (woodland, smoke).
 * Returns multiplicative range reduction factors.
 *
 * TODO: Walk the LOS ray and count obstruction cells.
 */
function losObstructionFactors(
  observer: Vec2,
  target: Vec2,
  sensorTier: SensorTier,
  terrain: TerrainData,
): { woodlandFactor: number; smokeFactor: number; isBlocked: boolean } {
  // TODO: Walk ray, count forest cells, orchard cells, smoke sources
  //       Apply per-sensor-tier reduction multipliers:
  //         Forest:  optical=0.30, thermal=0.50, radar=unaffected
  //         Orchard: optical=0.50, thermal=0.70, radar=unaffected
  //         Smoke:   optical=0.30, thermal=0.70, radar=unaffected
  //                  3+ smoke sources = blocked for optical and thermal
  return { woodlandFactor: 1.0, smokeFactor: 1.0, isBlocked: false };
}

// ============================================================================
// EXPORTED: updateSpotting
// ============================================================================

/**
 * Phase 4: Spotting Updates.
 * Runs every second (tick % 20 === 0).
 *
 * For each (observer, target) pair within detection range with LOS:
 *   1. Compute effective detection range (base × signature × observer × visibility cap)
 *   2. Apply LOS obstruction factors (woodland, smoke)
 *   3. Check if target is within final effective range
 *   4. If in range with LOS: accumulate detection at the computed rate
 *   5. If not in range or no LOS: decay detection
 *   6. Size-0 detection cap: clamp at SUSPECTED (24) for low-vision observers
 *   7. Update contact tier label based on accumulator value
 *   8. Update contact position (jittered at SUSPECTED, exact at DETECTED+)
 *
 * Spatial hash is used for range culling: only check pairs where the
 * observer's max sensor range could possibly reach the target.
 *
 * @param units        The session unit registry
 * @param contacts     Per-player/faction contact map: ownerId -> targetId -> ContactEntry
 * @param spatialHash  Grid-based spatial index
 * @param terrain      Terrain data for LOS raycasts
 */
export function updateSpotting(
  units: Map<string, UnitInstance>,
  contacts: Map<string, Map<string, ContactEntry>>,
  spatialHash: SpatialHash,
  terrain: TerrainData,
): void {
  // Build lists of units by faction for pairwise checks
  // Player units observe enemy units, and vice versa
  const allUnits = [...units.values()];
  const aliveUnits = allUnits.filter((u) => !u.isDestroyed && u.moraleState !== 'surrendered');

  for (const observer of aliveUnits) {
    // TODO: Skip frozen (disconnected player) units — accumulators frozen

    // Get or create the contact map for this observer's owner
    let ownerContacts = contacts.get(observer.ownerId);
    if (!ownerContacts) {
      ownerContacts = new Map();
      contacts.set(observer.ownerId, ownerContacts);
    }

    // TODO: Look up observer's UnitType for visionM, unitClass, moveClass
    const observerVisionM = 1500;  // TODO: Replace with UnitType lookup
    const observerClass: UnitClass = 'infantry'; // TODO: Replace
    const observerMoveClass = 'leg'; // TODO: Replace
    const sensorTier = getSensorTier(observerVisionM);

    // Use spatial hash to find candidate targets within max sensor range
    const observerPos: Vec2 = { x: observer.posX, z: observer.posZ };
    const candidateIds = spatialHash.unitsInRange(observerPos, observerVisionM);

    // Track which targets we processed this second (for decay of unobserved)
    const observedTargetIds = new Set<string>();

    for (const targetId of candidateIds) {
      const target = units.get(targetId);
      if (!target) continue;
      if (target.isDestroyed) continue;

      // Skip friendly units — we don't spot our own side
      if (target.ownerId === observer.ownerId) continue;
      // TODO: Proper faction check (player vs AI faction membership)

      observedTargetIds.add(targetId);

      // --- Compute effective detection range ---
      const signatureMult = targetSignatureMultiplier(target);
      const observerMod = observerQualityMod(observer);
      let effectiveRange = observerVisionM * signatureMult * observerMod;

      // Apply visibility cap based on sensor tier
      // TODO: Get scenario visibility settings
      // if (sensorTier === 'optical') effectiveRange = Math.min(effectiveRange, scenario.opticalVisibilityM);
      // if (sensorTier === 'thermal') effectiveRange = Math.min(effectiveRange, scenario.thermalVisibilityM);
      // Radar: no cap

      // Apply LOS obstruction factors (woodland, smoke)
      const obstruction = losObstructionFactors(
        observerPos,
        { x: target.posX, z: target.posZ },
        sensorTier,
        terrain,
      );

      if (obstruction.isBlocked) {
        // LOS completely blocked — decay this contact
        decayContact(ownerContacts, targetId);
        continue;
      }

      effectiveRange *= obstruction.woodlandFactor * obstruction.smokeFactor;

      // --- Check range ---
      const actualDistance = Math.sqrt(
        (target.posX - observer.posX) ** 2 +
        (target.posZ - observer.posZ) ** 2,
      );

      if (actualDistance > effectiveRange) {
        // Out of range — decay
        decayContact(ownerContacts, targetId);
        continue;
      }

      // --- LOS check ---
      if (!hasLineOfSight(observerPos, { x: target.posX, z: target.posZ }, terrain)) {
        decayContact(ownerContacts, targetId);
        continue;
      }

      // --- Radar special case ---
      // Radar: moving target -> instantly set to floor of DETECTED (25)
      // Cannot accumulate above 25 via radar alone
      if (sensorTier === 'radar') {
        if (target.speedState !== 'full_halt') {
          let contact = ownerContacts.get(targetId);
          if (!contact) {
            contact = createContact(targetId, target, 0);
            ownerContacts.set(targetId, contact);
          }
          contact.detectionValue = Math.max(contact.detectionValue, TIER_DETECTED_MIN);
          // Radar cannot push above DETECTED
          if (contact.detectionValue > TIER_DETECTED_MAX) {
            // Only clamp if radar is the sole observer
            // TODO: Track whether a non-radar observer also has LOS
          }
          contact.detectionTier = detectionValueToTier(contact.detectionValue);
          contact.lastSeenTick = 0; // TODO: Set current tick
          contact.lostAt = null;
          updateContactPosition(contact, target);
        }
        continue;
      }

      // --- Standard accumulation ---
      const rate = accumulationRate(
        observerVisionM,
        observerClass,
        observerMoveClass,
        6, // TODO: Replace with target.unitType.size lookup
        target.speedState,
      );

      let contact = ownerContacts.get(targetId);
      if (!contact) {
        contact = createContact(targetId, target, 0);
        ownerContacts.set(targetId, contact);
      }

      // Accumulate (1 second worth since this runs once per second)
      contact.detectionValue = Math.min(100, contact.detectionValue + rate);

      // --- Size-0 detection cap ---
      // Post-accumulation clamp: size-0 targets cannot be pushed past SUSPECTED
      // by observers with visionM < 750, unless the target fired this tick.
      // See Spotting and Contact Model §Concealment and Size.
      const targetSize: number = 3; // TODO: Replace with UnitType.size lookup
      if (
        targetSize === 0 &&
        observerVisionM < SIZE_ZERO_VISION_CAP &&
        !target.firedThisTick
      ) {
        contact.detectionValue = Math.min(contact.detectionValue, TIER_SUSPECTED_MAX);
      }

      // Update tier and position
      contact.detectionTier = detectionValueToTier(contact.detectionValue);
      contact.lastSeenTick = 0; // TODO: Set current tick
      contact.lostAt = null;
      updateContactPosition(contact, target);
    }

    // --- Decay contacts for targets NOT observed this second ---
    for (const [targetId, contact] of ownerContacts) {
      if (observedTargetIds.has(targetId)) continue;
      decayContact(ownerContacts, targetId);
    }
  }
}

// ---------------------------------------------------------------------------
// Contact helpers
// ---------------------------------------------------------------------------

/**
 * Create a new ContactEntry for a target unit.
 */
function createContact(
  targetId: string,
  target: UnitInstance,
  initialValue: number,
): ContactEntry {
  return {
    observedUnitId: targetId,
    detectionValue: initialValue,
    detectionTier: detectionValueToTier(initialValue),
    estimatedPos: { x: target.posX, z: target.posZ },
    estimatedCategory: null,
    estimatedTypeId: null,
    lastSeenTick: 0, // TODO: Set current tick
    lostAt: null,
  };
}

/**
 * Update the estimated position on a contact based on the current detection tier.
 * - SUSPECTED: jitter ±50m
 * - DETECTED+: exact position
 * Also set category/type info based on tier.
 */
function updateContactPosition(contact: ContactEntry, target: UnitInstance): void {
  if (contact.detectionTier === 'SUSPECTED') {
    // Jitter position ±50m
    const jitterX = (Math.random() - 0.5) * 100;
    const jitterZ = (Math.random() - 0.5) * 100;
    contact.estimatedPos = { x: target.posX + jitterX, z: target.posZ + jitterZ };
    contact.estimatedCategory = null;
    contact.estimatedTypeId = null;
  } else if (contact.detectionTier === 'DETECTED') {
    // Exact position, category known
    contact.estimatedPos = { x: target.posX, z: target.posZ };
    // TODO: Look up UnitType to determine category (vehicle/infantry/air)
    contact.estimatedCategory = 'vehicle'; // TODO: Replace with actual category
    contact.estimatedTypeId = null; // Not known until CONFIRMED
  } else if (contact.detectionTier === 'CONFIRMED') {
    // Exact position, full type known
    contact.estimatedPos = { x: target.posX, z: target.posZ };
    // TODO: Look up UnitType
    contact.estimatedCategory = 'vehicle'; // TODO: Replace
    contact.estimatedTypeId = target.unitTypeId;
  }
}

/**
 * Decay a contact's detection value. If it reaches 0, transition to LOST.
 * LOST contacts fade over 60 seconds and are then removed.
 */
function decayContact(
  ownerContacts: Map<string, ContactEntry>,
  targetId: string,
): void {
  const contact = ownerContacts.get(targetId);
  if (!contact) return;

  // Already lost — check if it should be removed entirely
  if (contact.detectionTier === 'LOST') {
    // TODO: Check if LOST_DISPLAY_FADE_SEC (60s) has elapsed since lostAt
    //       If so, remove the contact from the map entirely.
    return;
  }

  // Decay at 8 pts/sec
  contact.detectionValue = Math.max(0, contact.detectionValue - DECAY_RATE_PER_SEC);

  if (contact.detectionValue <= 0) {
    // Transition to LOST
    contact.detectionTier = 'LOST';
    contact.lostAt = Date.now(); // TODO: Use tick-based timing
  } else {
    contact.detectionTier = detectionValueToTier(contact.detectionValue);
  }
}
