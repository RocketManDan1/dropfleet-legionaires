// ============================================================================
// TEST HELPERS — minimal factories for unit instances, contacts, and terrain
// ============================================================================

import type {
  UnitInstance, AmmoState, ContactEntry, UnitType, WeaponSlot,
} from '@legionaires/shared';
import type { TerrainData } from '../terrain.js';
import type { BatLocParams } from '../batloc.js';

// ---------------------------------------------------------------------------
// Armour / ammo defaults
// ---------------------------------------------------------------------------

const ZERO_ARMOUR = {
  hullFront: 0, hullSide: 0, hullRear: 0,
  turretFront: 0, turretSide: 0, turretRear: 0, top: 0,
};

const ZERO_AMMO: AmmoState = { he: 0, ap: 0, heat: 0, sabot: 0 };
const FULL_AMMO: AmmoState = { he: 20, ap: 20, heat: 0, sabot: 0 };

// ---------------------------------------------------------------------------
// UnitInstance factory
// ---------------------------------------------------------------------------

/**
 * Create a minimal UnitInstance for testing.
 * Provide at minimum: instanceId, ownerId, posX, posZ.
 * Override any field as needed.
 */
export function makeUnit(
  overrides: Partial<UnitInstance> & Pick<UnitInstance, 'instanceId' | 'ownerId' | 'posX' | 'posZ'>,
): UnitInstance {
  return {
    unitTypeId: 'test_type',
    platoonId: 'platoon_test',
    callsign: 'TEST 1-1',
    heading: 0,
    turretHeading: null,
    speedState: 'full_halt',
    moveMode: 'advance',
    currentPath: null,
    pathIndex: 0,
    recentDistanceM: 0,
    stoppedForSec: 0,
    currentOrder: null,
    orderQueue: [],
    isOrderComplete: true,
    crewCurrent: 3,
    crewMax: 3,
    isDestroyed: false,
    isBailedOut: false,
    isImmobilized: false,
    steelArmour: { ...ZERO_ARMOUR },
    heatArmour: { ...ZERO_ARMOUR },
    eraRemaining: {},
    ammo: [{ ...FULL_AMMO }, { ...ZERO_AMMO }, { ...ZERO_AMMO }, { ...ZERO_AMMO }],
    weaponCooldowns: [0, 0, 0, 0],
    lastFireTick: 0,
    firedThisTick: false,
    firePosture: 'free_fire',
    maxEngageRangeM: 2000,
    currentTargetId: null,
    engageSlotOverride: null,
    suppressionLevel: 0,
    moraleState: 'normal',
    lastRalliedAtTick: -999,
    transportedBy: null,
    passengers: [],
    altitudeState: null,
    altitudeTransitioning: false,
    altitudeTransitionTimer: 0,
    isEntrenched: false,
    entrenchProgress: 0,
    ewCharges: 0,
    smokeRemaining: 2,
    supplyCheckTimer: 0,
    isBeingResupplied: false,
    detectionAccumulators: new Map(),
    experience: 70,
    camouflageModifier: 1.0,
    spawnTick: 0,
    lastMoveTick: 0,
    destroyedAtTick: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ContactEntry factory
// ---------------------------------------------------------------------------

/**
 * Create a DETECTED-tier contact entry (detectionValue = 50).
 * Used to satisfy the fire system's detection gate.
 */
export function makeDetectedContact(targetId: string, posX: number, posZ: number): ContactEntry {
  return {
    observedUnitId: targetId,
    detectionValue: 50,       // DETECTED tier (25–74)
    detectionTier: 'DETECTED',
    estimatedPos: { x: posX, z: posZ },
    estimatedCategory: null,
    estimatedTypeId: null,
    lastSeenTick: 0,
    lostAt: null,
  };
}

// ---------------------------------------------------------------------------
// UnitType factory
// ---------------------------------------------------------------------------

const TEST_WEAPON: WeaponSlot = {
  weaponId: 1,
  weaponName: 'Test Rifle',
  acc: 10,
  warheadSize: 4,
  rangeM: 2000,   // 2 000 m = 100 cells at CELL_REAL_M = 20
  minRangeM: 0,
  ammoHE: 20,
  ammoAP: 20,
  ammoHEAT: 0,
  ammoSabot: 0,
  penAP: 5,
  penSabot: 0,
  penHEAT: 5,
  heKill: 3,
  rof: 3,
  traverseType: 'turret',
  sound: 1,
};

/**
 * Create a minimal UnitType for testing.
 * Defaults to an ataxian infantry unit with a 2 000 m weapon.
 */
export function makeUnitType(overrides: Partial<UnitType> & Pick<UnitType, 'id'>): UnitType {
  return {
    name: 'Test Unit',
    nationId: 14,        // ataxian nation ID
    obSlot: 1,
    unitClass: 'infantry',
    classId: 1,
    cost: 100,
    maxSpeedM: 8,
    swimSpeedM: 0,
    moveClass: 'leg',
    moveClassId: 1,
    visionM: 1500,       // 75 cells at CELL_REAL_M = 20
    fc: 50,
    rf: 10,
    stabilizer: 0,
    ew: 0,
    radioChance: 80,
    smokeDischargers: 2,
    steelArmour: { ...ZERO_ARMOUR },
    heatArmour: { ...ZERO_ARMOUR },
    eraLevel: {},
    maxCrew: 3,
    survivability: 2,
    size: 3,
    transportCapacity: 0,
    liftCapacity: 0,
    loadCost: 1,
    weapons: [{ ...TEST_WEAPON }, null, null, null],
    rof: 3,
    sound: 1,
    graphicId: 1,
    pictureId: 1,
    firstAvailMonth: 1,
    firstAvailYear: 2100,
    lastAvailMonth: 12,
    lastAvailYear: 2200,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Terrain factory — flat, all-land, no features
// ---------------------------------------------------------------------------

const STUB_BATLOC: BatLocParams = {
  name: 'test',
  id: 0,
  hillDensity: 0,
  maxHillHeight: 0,
  hillBaseSize: 0,
  streamsMarsh: 0,
  lakesSize: 0,
  marshSize: 0,
  riverTrees: 0,
  riverMarsh: 0,
  riverMud: 0,
  riverRough: 0,
  treeLevel: 0,
  orchardLevel: 0,
  grassLevel: 0,
  roughLevel: 0,
  fieldLevel: 0,
  mudLevel: 0,
  urbanisation: 0,
  roadCode: 0,
  terrainMod: 0,
  season: 'summer',
  arid: false,
  savannah: false,
};

/**
 * Create a flat, all-open-terrain map of the given cell dimensions.
 * All cells are dry land (heightmap = 0.5, seaLevel = 0.3) with no
 * forest, urban, or water tiles, so LOS raycasts always pass through.
 *
 * Useful for spotting and mission-gen tests where terrain features would
 * add noise to the result.
 */
export function makeFlatTerrain(width: number, height: number): TerrainData {
  const size = width * height;
  return {
    width,
    height,
    resolution: 1,                           // 1 coordinate unit = 1 cell
    heightmap: new Array(size).fill(0.5),    // all land (above seaLevel 0.3)
    slopeMap: new Array(size).fill(0),
    curvatureMap: new Array(size).fill(0),
    wetnessMap: new Array(size).fill(0),
    coverMap: new Array(size).fill(0),
    visibilityMap: new Array(size).fill(1),
    mountainWeightMap: new Array(size).fill(0),
    hillWeightMap: new Array(size).fill(0),
    flatlandWeightMap: new Array(size).fill(1),
    terrainTypeMap: new Array(size).fill(0), // TerrainType.Open = 0
    towns: [],
    rivers: [],
    roads: [],
    bridges: [],
    fords: [],
    spawnZones: [],
    objectives: [],
    batloc: STUB_BATLOC,
    seaLevel: 0.3,
    biome: 'flatlands',
  };
}
