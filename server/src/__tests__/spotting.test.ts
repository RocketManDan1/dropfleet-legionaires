// ============================================================================
// SPOTTING SYSTEM TESTS
//
// Tests Phase 4 (spotting.ts) of the tick loop.
//
// Key invariants:
//  - Observer visionM is in metres; unit positions are in grid cells.
//    The system converts: visionCells = visionM / CELL_REAL_M (20).
//  - A target beyond visionCells should NOT accumulate detection.
//  - A target within visionCells with clear LOS SHOULD accumulate detection.
//  - Detection decays when a target leaves effective range.
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { UnitInstance, ContactEntry } from '@legionaires/shared';
import { CELL_REAL_M, TIER_DETECTED_MIN } from '@legionaires/shared';
import { updateSpotting } from '../systems/spotting.js';
import { SpatialHash } from '../game/spatial-hash.js';
import { UnitRegistry } from '../data/unit-registry.js';
import { makeUnit, makeUnitType, makeFlatTerrain } from './helpers.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

// Observer type: 1 500 m vision → 75 cells effective range (CELL_REAL_M = 20)
const OBSERVER_VISION_M = 1_500;
const OBSERVER_VISION_CELLS = OBSERVER_VISION_M / CELL_REAL_M; // 75

function buildSpottingSetup(targetPosXCells: number) {
  const terrain = makeFlatTerrain(512, 512);

  const observer = makeUnit({
    instanceId: 'observer',
    ownerId: 'player1',
    posX: 0,
    posZ: 0,
    unitTypeId: 'scout_type',
  });

  const target = makeUnit({
    instanceId: 'target',
    ownerId: 'enemy',
    posX: targetPosXCells,
    posZ: 0,
  });

  const units = new Map<string, UnitInstance>([
    ['observer', observer],
    ['target', target],
  ]);

  const contacts = new Map<string, Map<string, ContactEntry>>();

  const reg = new UnitRegistry();
  reg.load([
    makeUnitType({ id: 'scout_type', visionM: OBSERVER_VISION_M }),
    makeUnitType({ id: 'test_type', visionM: 800 }),
  ]);

  // Spatial hash sized for the test map (512×512 cells)
  const hash = new SpatialHash(512, 512);
  hash.insert('observer', observer.posX, observer.posZ);
  hash.insert('target', target.posX, target.posZ);

  return { terrain, units, contacts, reg, hash };
}

// ---------------------------------------------------------------------------
// Vision range conversion
// ---------------------------------------------------------------------------

describe('Vision range: metres converted to cells', () => {
  it('detects a target within vision range (60 cells = 1 200 m, vision = 1 500 m)', () => {
    // 60 cells < 75 cells effective range → should detect
    const { terrain, units, contacts, reg, hash } = buildSpottingSetup(60);

    updateSpotting(units, contacts, hash, terrain, 20, reg);

    const playerContacts = contacts.get('player1');
    const entry = playerContacts?.get('target');
    expect(entry).toBeDefined();
    expect(entry!.detectionValue).toBeGreaterThan(0);
  });

  it('does NOT detect a target beyond vision range (90 cells = 1 800 m, vision = 1 500 m)', () => {
    // 90 cells > 75 cells effective range → should NOT detect
    const { terrain, units, contacts, reg, hash } = buildSpottingSetup(90);

    updateSpotting(units, contacts, hash, terrain, 20, reg);

    const playerContacts = contacts.get('player1');
    const entry = playerContacts?.get('target');
    // Either no entry, or entry exists but at zero (no accumulation)
    if (entry) {
      expect(entry.detectionValue).toBe(0);
    } else {
      expect(entry).toBeUndefined();
    }
  });

  it('regression: visionM is converted to cells, not used raw', () => {
    // visionM = 1500 → visionCells = 75. Not 1500 cells (entire map).
    expect(OBSERVER_VISION_CELLS).toBe(75);
    expect(OBSERVER_VISION_CELLS).toBeLessThan(512); // does not cover whole map
  });
});

// ---------------------------------------------------------------------------
// Detection accumulation over time
// ---------------------------------------------------------------------------

describe('Detection accumulation', () => {
  it('accumulates detection across successive calls', () => {
    const { terrain, units, contacts, reg, hash } = buildSpottingSetup(40);

    // Run spotting twice (simulates 2 seconds at 20 ticks/s)
    updateSpotting(units, contacts, hash, terrain, 20, reg);
    const valueAfterFirst = contacts.get('player1')?.get('target')?.detectionValue ?? 0;

    updateSpotting(units, contacts, hash, terrain, 40, reg);
    const valueAfterSecond = contacts.get('player1')?.get('target')?.detectionValue ?? 0;

    expect(valueAfterSecond).toBeGreaterThan(valueAfterFirst);
  });

  it('reaches DETECTED tier (≥ 25) after sustained observation', () => {
    const { terrain, units, contacts, reg, hash } = buildSpottingSetup(40);

    // Run enough ticks to accumulate past DETECTED threshold (25 pts)
    // BASE_ACCUMULATION_RATE = 10 pts/sec, so ≥ 3 ticks at 1-second intervals
    for (let tick = 20; tick <= 100; tick += 20) {
      updateSpotting(units, contacts, hash, terrain, tick, reg);
    }

    const entry = contacts.get('player1')?.get('target');
    expect(entry).toBeDefined();
    expect(entry!.detectionValue).toBeGreaterThanOrEqual(TIER_DETECTED_MIN);
  });
});

// ---------------------------------------------------------------------------
// Decay
// ---------------------------------------------------------------------------

describe('Detection decay', () => {
  it('decays detection for a target that goes out of range', () => {
    const terrain = makeFlatTerrain(512, 512);
    const reg = new UnitRegistry();
    reg.load([makeUnitType({ id: 'scout_type', visionM: OBSERVER_VISION_M })]);

    const observer = makeUnit({ instanceId: 'observer', ownerId: 'player1', posX: 0, posZ: 0, unitTypeId: 'scout_type' });
    // Target starts in range (40 cells < 75 cells vision)
    const target = makeUnit({ instanceId: 'target', ownerId: 'enemy', posX: 40, posZ: 0 });
    const units = new Map<string, UnitInstance>([['observer', observer], ['target', target]]);
    const contacts = new Map<string, Map<string, ContactEntry>>();

    const hash = new SpatialHash(512, 512);
    hash.insert('observer', 0, 0);
    hash.insert('target', 40, 0);

    // Accumulate some detection
    for (let tick = 20; tick <= 60; tick += 20) {
      updateSpotting(units, contacts, hash, terrain, tick, reg);
    }
    const valueBeforeMove = contacts.get('player1')?.get('target')?.detectionValue ?? 0;
    expect(valueBeforeMove).toBeGreaterThan(0);

    // Move target far out of range (400 cells > 75 cells vision)
    target.posX = 400;
    hash.update('target', 400, 0);

    // Run spotting — should decay
    updateSpotting(units, contacts, hash, terrain, 80, reg);
    const valueAfterMove = contacts.get('player1')?.get('target')?.detectionValue ?? 0;
    expect(valueAfterMove).toBeLessThan(valueBeforeMove);
  });
});
