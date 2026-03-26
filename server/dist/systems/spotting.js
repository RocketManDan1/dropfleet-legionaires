// ============================================================================
// SPOTTING UPDATES — Phase 4 of the tick loop
// Source: Spotting and Contact Model.md, AUTHORITATIVE_CONTRACTS.md §5
// Runs every second (tick % 20 === 0). Pairwise LOS and accumulator updates.
// Milestone 2 scaffold
// ============================================================================
import { BASE_ACCUMULATION_RATE, DECAY_RATE_PER_SEC, TIER_SUSPECTED_MIN, TIER_SUSPECTED_MAX, TIER_DETECTED_MIN, TIER_DETECTED_MAX, TIER_CONFIRMED_MIN, SIZE_ZERO_VISION_CAP, LOST_DISPLAY_FADE_SEC, THERMAL_VISION_THRESHOLD, RADAR_VISION_THRESHOLD, LOS_FOREST_OPTICAL, LOS_FOREST_THERMAL, LOS_ORCHARD_OPTICAL, LOS_ORCHARD_THERMAL, LOS_SMOKE_OPTICAL, LOS_SMOKE_THERMAL, LOS_SMOKE_BLOCK_COUNT, TICKS_PER_SEC, CELL_REAL_M, } from '@legionaires/shared';
// ---------------------------------------------------------------------------
// Sensor tier classification
// ---------------------------------------------------------------------------
/**
 * Determine the sensor tier based on the observer's visionM value.
 * See Spotting and Contact Model §Sensor Tiers.
 */
function getSensorTier(visionM) {
    if (visionM >= RADAR_VISION_THRESHOLD)
        return 'radar';
    if (visionM >= THERMAL_VISION_THRESHOLD)
        return 'thermal';
    return 'optical';
}
// ---------------------------------------------------------------------------
// Detection tier from accumulator value
// ---------------------------------------------------------------------------
/**
 * Map a raw detection accumulator value (0–100) to a contact tier label.
 * See Spotting and Contact Model §Contact Tiers.
 */
function detectionValueToTier(value) {
    if (value >= TIER_CONFIRMED_MIN)
        return 'CONFIRMED';
    if (value >= TIER_DETECTED_MIN)
        return 'DETECTED';
    if (value >= TIER_SUSPECTED_MIN)
        return 'SUSPECTED';
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
function targetSignatureMultiplier(target) {
    // Main gun firing signature: 2.0x for 1 second
    if (target.firedThisTick)
        return 2.0;
    // Smoke discharger active: halves the signature (Spotting and Contact Model §Signature)
    if (target.smokeRemaining != null && target.smokeRemaining < 0) {
        // Negative smokeRemaining is our convention for "smoke is actively deployed"
        // (set by the deploy_smoke order handler, decays over time)
        return 0.5;
    }
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
function observerQualityMod(observer, observerMoveClass, observerClass) {
    const isScout = observerClass === 'scout';
    switch (observer.speedState) {
        case 'full_halt':
        case 'short_halt':
            return observerMoveClass === 'leg' ? 1.2 : 1.0;
        case 'slow': return 0.9;
        case 'fast': return isScout ? 0.9 : 0.7;
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
function accumulationRate(observerVisionM, observerClass, observerMoveClass, targetSize, targetSpeedState) {
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
        case 'scout':
            rate *= 1.4;
            break;
        case 'sniper':
            rate *= 1.3;
            break;
        case 'hq':
            rate *= 1.1;
            break;
        default:
            // Generic infantry: moveClass 'leg' -> +20%
            if (observerMoveClass === 'leg')
                rate *= 1.2;
            break;
    }
    // 3. Target concealment modifier (from size)
    //    concealmentMod = 1 - (6 - target.size) * 0.05
    //    size 6 = 1.0 (no bonus), size 0 = 0.7 (30% slower)
    const concealmentMod = 1 - (6 - targetSize) * 0.05;
    rate *= concealmentMod;
    // 4. Target state modifier
    //    Stationary + small (size ≤ 1): 0.5x
    if ((targetSpeedState === 'full_halt' || targetSpeedState === 'short_halt') &&
        targetSize <= 1) {
        rate *= 0.5;
    }
    return rate;
}
// ---------------------------------------------------------------------------
// LOS check placeholder
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Elevation query — bilinear interpolation on heightmap
// ---------------------------------------------------------------------------
const MAX_ELEVATION_M = 300; // typical terrain elevation scale in metres
function getElevation(x, z, heightmap, width, height, resolution) {
    const gx = x / resolution;
    const gz = z / resolution;
    const x0 = Math.max(0, Math.min(width - 2, Math.floor(gx)));
    const z0 = Math.max(0, Math.min(height - 2, Math.floor(gz)));
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const fx = gx - x0;
    const fz = gz - z0;
    const h00 = heightmap[z0 * width + x0] * MAX_ELEVATION_M;
    const h10 = heightmap[z0 * width + x1] * MAX_ELEVATION_M;
    const h01 = heightmap[z1 * width + x0] * MAX_ELEVATION_M;
    const h11 = heightmap[z1 * width + x1] * MAX_ELEVATION_M;
    const top = h00 + (h10 - h00) * fx;
    const bottom = h01 + (h11 - h01) * fx;
    return top + (bottom - top) * fz;
}
// ---------------------------------------------------------------------------
// Eye height model (LOS_RAYCASTING.md §2)
// ---------------------------------------------------------------------------
function eyeHeight(moveClass, size) {
    if (moveClass === 'air')
        return 100;
    if (moveClass === 'leg')
        return 1.5;
    return 2.0 + size * 0.3;
}
function targetProfileHeight(moveClass, size, isHullDown) {
    let h;
    if (moveClass === 'air')
        h = 80;
    else if (moveClass === 'leg')
        h = 1.2;
    else
        h = 1.5 + size * 0.3;
    return isHullDown ? h * 0.5 : h;
}
function castLOS(observerPos, targetPos, observerEyeH, targetTopH, terrain) {
    const w = terrain.width;
    const h = terrain.height;
    const resolution = terrain.resolution ?? 1;
    // Grid cells for observer and target
    const x0 = Math.max(0, Math.min(w - 1, Math.round(observerPos.x / resolution)));
    const z0 = Math.max(0, Math.min(h - 1, Math.round(observerPos.z / resolution)));
    const x1 = Math.max(0, Math.min(w - 1, Math.round(targetPos.x / resolution)));
    const z1 = Math.max(0, Math.min(h - 1, Math.round(targetPos.z / resolution)));
    const oElev = getElevation(observerPos.x, observerPos.z, terrain.heightmap, w, h, resolution);
    const tElev = getElevation(targetPos.x, targetPos.z, terrain.heightmap, w, h, resolution);
    const oEye = oElev + observerEyeH;
    const tTop = tElev + targetTopH;
    const result = { blocked: false, woodlandCells: 0, partialCoverCells: 0, smokeCells: 0 };
    // Bresenham walk
    let dx = Math.abs(x1 - x0);
    let dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    const totalSteps = dx + dz;
    let step = 0;
    let cx = x0, cz = z0;
    while (true) {
        // Skip first and last cell (observer/target positions)
        if (!(cx === x0 && cz === z0) && !(cx === x1 && cz === z1)) {
            const t = totalSteps > 0 ? step / totalSteps : 0;
            const rayHeight = oEye + (tTop - oEye) * t;
            // Ground elevation at cell center
            const cellX = (cx + 0.5) * resolution;
            const cellZ = (cz + 0.5) * resolution;
            const groundElev = getElevation(cellX, cellZ, terrain.heightmap, w, h, resolution);
            if (groundElev > rayHeight) {
                result.blocked = true;
                return result;
            }
            // Check terrain type for obstructions
            const idx = cz * w + cx;
            if (idx >= 0 && idx < terrain.terrainTypeMap.length) {
                const tt = terrain.terrainTypeMap[idx];
                if (tt === 23 /* TerrainType.Urban */ || tt === 24 /* TerrainType.Industrial */) {
                    result.blocked = true;
                    return result;
                }
                if (tt === 5 /* TerrainType.Forest */ || tt === 6 /* TerrainType.Jungle */) {
                    result.woodlandCells++;
                }
                if (tt === 7 /* TerrainType.Orchard */ || tt === 9 /* TerrainType.Crops */ || tt === 1 /* TerrainType.HighGrass */) {
                    result.partialCoverCells++;
                }
            }
        }
        if (cx === x1 && cz === z1)
            break;
        const e2 = 2 * err;
        if (e2 > -dz) {
            err -= dz;
            cx += sx;
        }
        if (e2 < dx) {
            err += dx;
            cz += sz;
        }
        step++;
    }
    return result;
}
// ---------------------------------------------------------------------------
// LOS: public API for spotting
// ---------------------------------------------------------------------------
function hasLineOfSight(observer, target, terrain, observerMoveClass, observerSize, targetMoveClass, targetSize, targetIsHullDown) {
    const oEye = eyeHeight(observerMoveClass, observerSize);
    const tTop = targetProfileHeight(targetMoveClass, targetSize, targetIsHullDown);
    const losResult = castLOS(observer, target, oEye, tTop, terrain);
    return !losResult.blocked;
}
function losObstructionFactors(observer, target, sensorTier, terrain, observerMoveClass, observerSize, targetMoveClass, targetSize, targetIsHullDown) {
    if (sensorTier === 'radar')
        return { woodlandFactor: 1.0, smokeFactor: 1.0, isBlocked: false };
    const oEye = eyeHeight(observerMoveClass, observerSize);
    const tTop = targetProfileHeight(targetMoveClass, targetSize, targetIsHullDown);
    const losResult = castLOS(observer, target, oEye, tTop, terrain);
    if (losResult.blocked) {
        return { woodlandFactor: 0, smokeFactor: 0, isBlocked: true };
    }
    let woodlandFactor = 1.0;
    if (losResult.woodlandCells >= 1) {
        woodlandFactor = sensorTier === 'thermal' ? LOS_FOREST_THERMAL : LOS_FOREST_OPTICAL;
    }
    if (losResult.partialCoverCells >= 1) {
        woodlandFactor *= sensorTier === 'thermal' ? LOS_ORCHARD_THERMAL : LOS_ORCHARD_OPTICAL;
    }
    // Per-cell smoke tracking is not yet implemented (arrives with theater support
    // in M6). For now, smoke factor is driven by the target's deployed smoke
    // which is handled via targetSignatureMultiplier(). Set factor to 1.0 here.
    // When per-cell smoke lands, count smokeCells from the ray and apply:
    //   smokeFactor = sensorTier === 'thermal' ? LOS_SMOKE_THERMAL : LOS_SMOKE_OPTICAL
    //   if smokeCells >= LOS_SMOKE_BLOCK_COUNT: blocked entirely
    let smokeFactor = 1.0;
    if (losResult.smokeCells >= LOS_SMOKE_BLOCK_COUNT) {
        return { woodlandFactor: 0, smokeFactor: 0, isBlocked: true };
    }
    else if (losResult.smokeCells >= 1) {
        smokeFactor = sensorTier === 'thermal' ? LOS_SMOKE_THERMAL : LOS_SMOKE_OPTICAL;
    }
    return { woodlandFactor, smokeFactor, isBlocked: false };
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
export function updateSpotting(units, contacts, spatialHash, terrain, currentTick, unitTypes) {
    // Build lists of units by faction for pairwise checks
    // Player units observe enemy units, and vice versa
    const allUnits = [...units.values()];
    const aliveUnits = allUnits.filter((u) => !u.isDestroyed && u.moraleState !== 'surrendered');
    // Aggregate targets observed this second per owner/faction.
    // Decay should happen once per owner after all their observers have contributed.
    const observedByOwner = new Map();
    for (const observer of aliveUnits) {
        // Get or create the contact map for this observer's owner
        let ownerContacts = contacts.get(observer.ownerId);
        if (!ownerContacts) {
            ownerContacts = new Map();
            contacts.set(observer.ownerId, ownerContacts);
        }
        let ownerObservedTargets = observedByOwner.get(observer.ownerId);
        if (!ownerObservedTargets) {
            ownerObservedTargets = new Set();
            observedByOwner.set(observer.ownerId, ownerObservedTargets);
        }
        // Look up observer's UnitType for visionM, unitClass, moveClass
        const observerType = unitTypes?.get(observer.unitTypeId);
        const observerVisionM = observerType?.visionM ?? 1500;
        const observerVisionCells = observerVisionM / CELL_REAL_M;
        const observerClass = observerType?.unitClass ?? 'infantry';
        const observerMoveClass = observerType?.moveClass ?? 'leg';
        const observerSize = observerType?.size ?? 3;
        const sensorTier = getSensorTier(observerVisionM);
        // Use spatial hash to find candidate targets within max sensor range
        // Positions are in grid cells; convert vision from metres to cells
        const observerPos = { x: observer.posX, z: observer.posZ };
        const candidateIds = spatialHash.unitsInRange(observerPos, observerVisionCells);
        for (const targetId of candidateIds) {
            const target = units.get(targetId);
            if (!target)
                continue;
            if (target.isDestroyed)
                continue;
            // Skip friendly units — we don't spot our own side
            if (target.ownerId === observer.ownerId)
                continue;
            // Look up target's UnitType
            const targetType = unitTypes?.get(target.unitTypeId);
            const targetSize = targetType?.size ?? 3;
            const targetMoveClass = targetType?.moveClass ?? 'leg';
            // --- Compute effective detection range ---
            const signatureMult = targetSignatureMultiplier(target);
            const observerMod = observerQualityMod(observer, observerMoveClass, observerClass);
            let effectiveRange = observerVisionCells * signatureMult * observerMod;
            // Apply LOS obstruction factors (woodland, smoke)
            const obstruction = losObstructionFactors(observerPos, { x: target.posX, z: target.posZ }, sensorTier, terrain, observerMoveClass, observerSize, targetMoveClass, targetSize, false);
            if (obstruction.isBlocked) {
                continue;
            }
            effectiveRange *= obstruction.woodlandFactor * obstruction.smokeFactor;
            // --- Check range ---
            const actualDistance = Math.sqrt((target.posX - observer.posX) ** 2 +
                (target.posZ - observer.posZ) ** 2);
            if (actualDistance > effectiveRange) {
                continue;
            }
            // --- LOS check (terrain elevation) ---
            if (!hasLineOfSight(observerPos, { x: target.posX, z: target.posZ }, terrain, observerMoveClass, observerSize, targetMoveClass, targetSize, false)) {
                continue;
            }
            // This target is truly observed (range + LOS) by this owner this second.
            ownerObservedTargets.add(targetId);
            // --- Radar special case ---
            // Radar: moving target -> instantly set to floor of DETECTED (25)
            // Cannot accumulate above 25 via radar alone
            if (sensorTier === 'radar') {
                if (target.speedState !== 'full_halt') {
                    let contact = ownerContacts.get(targetId);
                    if (!contact) {
                        contact = createContact(targetId, target, 0, currentTick);
                        ownerContacts.set(targetId, contact);
                    }
                    contact.detectionValue = Math.max(contact.detectionValue, TIER_DETECTED_MIN);
                    // Radar cannot push above DETECTED
                    if (contact.detectionValue > TIER_DETECTED_MAX) {
                        // Only clamp if radar is the sole observer
                        // TODO: Track whether a non-radar observer also has LOS
                    }
                    contact.detectionTier = detectionValueToTier(contact.detectionValue);
                    contact.lastSeenTick = currentTick;
                    contact.lostAt = null;
                    updateContactPosition(contact, target);
                }
                continue;
            }
            // --- Standard accumulation ---
            const rate = accumulationRate(observerVisionM, observerClass, observerMoveClass, targetSize, target.speedState);
            let contact = ownerContacts.get(targetId);
            if (!contact) {
                contact = createContact(targetId, target, 0, currentTick);
                ownerContacts.set(targetId, contact);
            }
            // Accumulate (1 second worth since this runs once per second)
            contact.detectionValue = Math.min(100, contact.detectionValue + rate);
            // --- Size-0 detection cap ---
            if (targetSize === 0 &&
                observerVisionM < SIZE_ZERO_VISION_CAP &&
                !target.firedThisTick) {
                contact.detectionValue = Math.min(contact.detectionValue, TIER_SUSPECTED_MAX);
            }
            // Update tier and position
            contact.detectionTier = detectionValueToTier(contact.detectionValue);
            contact.lastSeenTick = currentTick;
            contact.lostAt = null;
            updateContactPosition(contact, target);
        }
    }
    // --- Decay contacts once per owner for targets not observed this second ---
    for (const [ownerId, ownerContacts] of contacts) {
        const observedTargets = observedByOwner.get(ownerId) ?? new Set();
        for (const [targetId] of ownerContacts) {
            if (observedTargets.has(targetId))
                continue;
            decayContact(ownerContacts, targetId, currentTick);
        }
    }
}
// ---------------------------------------------------------------------------
// Contact helpers
// ---------------------------------------------------------------------------
/**
 * Create a new ContactEntry for a target unit.
 */
function createContact(targetId, target, initialValue, currentTick) {
    return {
        observedUnitId: targetId,
        detectionValue: initialValue,
        detectionTier: detectionValueToTier(initialValue),
        estimatedPos: { x: target.posX, z: target.posZ },
        estimatedCategory: null,
        estimatedTypeId: null,
        lastSeenTick: currentTick,
        lostAt: null,
    };
}
/**
 * Update the estimated position on a contact based on the current detection tier.
 * - SUSPECTED: jitter ±50m
 * - DETECTED+: exact position
 * Also set category/type info based on tier.
 */
function updateContactPosition(contact, target) {
    if (contact.detectionTier === 'SUSPECTED') {
        const jitterX = (Math.random() - 0.5) * 100;
        const jitterZ = (Math.random() - 0.5) * 100;
        contact.estimatedPos = { x: target.posX + jitterX, z: target.posZ + jitterZ };
        contact.estimatedCategory = null;
        contact.estimatedTypeId = null;
    }
    else if (contact.detectionTier === 'DETECTED') {
        contact.estimatedPos = { x: target.posX, z: target.posZ };
        // Category known but not exact type
        contact.estimatedCategory = target.unitTypeId; // simplified — real game would map to 'vehicle'/'infantry'/'air'
        contact.estimatedTypeId = null;
    }
    else if (contact.detectionTier === 'CONFIRMED') {
        contact.estimatedPos = { x: target.posX, z: target.posZ };
        contact.estimatedCategory = target.unitTypeId;
        contact.estimatedTypeId = target.unitTypeId;
    }
}
/**
 * Decay a contact's detection value. If it reaches 0, transition to LOST.
 * LOST contacts fade over 60 seconds and are then removed.
 */
function decayContact(ownerContacts, targetId, currentTick) {
    const contact = ownerContacts.get(targetId);
    if (!contact)
        return;
    // Already lost — remove entirely after LOST_DISPLAY_FADE_SEC (60s)
    if (contact.detectionTier === 'LOST') {
        if (contact.lostAt !== null) {
            const elapsedSec = (currentTick - contact.lostAt) / TICKS_PER_SEC;
            if (elapsedSec >= LOST_DISPLAY_FADE_SEC) {
                ownerContacts.delete(targetId);
            }
        }
        return;
    }
    // Decay at 8 pts/sec
    contact.detectionValue = Math.max(0, contact.detectionValue - DECAY_RATE_PER_SEC);
    if (contact.detectionValue <= 0) {
        // Transition to LOST
        contact.detectionTier = 'LOST';
        contact.lostAt = currentTick;
    }
    else {
        contact.detectionTier = detectionValueToTier(contact.detectionValue);
    }
}
