// ============================================================================
// UNIT TYPE — static unit definition (loaded from CSV, immutable at runtime)
// Source: Unit Schema Spec.md, AUTHORITATIVE_CONTRACTS.md
// ============================================================================

import type { MoveClass, UnitClass, TraverseType } from './core.js';

// --- Armour facings (shared by steel, HEAT, and ERA) ---

export interface ArmourFacings {
  hullFront: number;
  hullSide: number;
  hullRear: number;
  turretFront: number;
  turretSide: number;
  turretRear: number;
  top: number;
}

// --- Weapon slot (up to 4 per unit) ---

export interface WeaponSlot {
  weaponId: number;       // ordinal weapon type ID from CSV
  weaponName: string;     // display name
  acc: number;            // 0–30; accuracy rating
  warheadSize: number;    // 0–30; for suppression calc
  rangeM: number;         // max effective range in metres
  minRangeM: number;      // minimum range (mortars, ATGMs)
  ammoHE: number;         // starting HE rounds
  ammoAP: number;         // starting AP rounds
  ammoHEAT: number;       // starting HEAT rounds
  ammoSabot: number;      // starting Sabot rounds
  penAP: number;          // AP penetration value
  penSabot: number;       // Sabot penetration value
  penHEAT: number;        // HEAT penetration value
  heKill: number;         // HE anti-personnel effectiveness
  rof: number;            // rate of fire (rounds per minute)
  traverseType: TraverseType;
  sound: number;          // audio cue ID
}

// --- Unit type (one per unit definition, read from CSV) ---

export interface UnitType {
  id: string;               // unique type identifier
  name: string;             // display name
  nationId: number;         // 15=Terran, 14=Ataxian, 11=Khroshi
  obSlot: number;           // Order of Battle slot number
  unitClass: UnitClass;
  classId: number;          // raw class ID from CSV
  cost: number;             // SP cost

  // --- Mobility ---
  maxSpeedM: number;        // max speed in metres/sec (CSV value × 50 / 300)
  swimSpeedM: number;       // swim speed in metres/sec (0 = cannot swim)
  moveClass: MoveClass;
  moveClassId: number;      // raw move class ID from CSV

  // --- Sensors & electronics ---
  visionM: number;          // vision range in metres (CSV value × 50)
  fc: number;               // 0–140; fire control; >=100 = radar AA
  rf: number;               // 0–23; range finder; >=20 = laser RF
  stabilizer: number;       // 0–5; gyro stabilizer
  ew: number;               // 0–4; EW / active protection type
  radioChance: number;      // 0–99; percent chance radio contact succeeds per rally

  // --- Defence ---
  smokeDischargers: number; // number of smoke discharger salvos
  steelArmour: ArmourFacings;
  heatArmour: ArmourFacings;
  eraLevel: Partial<ArmourFacings>;

  // --- Survivability ---
  maxCrew: number;          // 1–12; crew/strength (hit points)
  survivability: number;    // 0–6; post-penetration crew survival odds
  size: number;             // 0–6; spotting and to-hit modifier

  // --- Transport ---
  transportCapacity: number; // 0 = not a transport; >0 = can carry infantry
  liftCapacity: number;     // helicopter lift capacity
  loadCost: number;         // space this unit uses in a transport

  // --- Weapons (4 slots, null if empty) ---
  weapons: [WeaponSlot | null, WeaponSlot | null, WeaponSlot | null, WeaponSlot | null];

  // --- Metadata ---
  rof: number;              // base rate of fire modifier
  sound: number;            // unit movement sound ID
  graphicId: number;        // icon graphic ID
  pictureId: number;        // detail picture ID
  firstAvailMonth: number;
  firstAvailYear: number;
  lastAvailMonth: number;
  lastAvailYear: number;
}
