// ============================================================================
// CSV LOADER — Parse faction unit CSV files into UnitType records
// Milestone 2
// Source: Unit Schema Spec.md, CLAUDE.md (known CSV bug — columns 49-50 fixed)
// ============================================================================

import type { UnitType, WeaponSlot, ArmourFacings, MoveClass, UnitClass } from '@legionaires/shared';
import { readFile } from 'fs/promises';

// ---------------------------------------------------------------------------
// Weapon lookup — parsed from the WinSPMBT weapon CSVs
// ---------------------------------------------------------------------------

interface WeaponStats {
  weaponId: number;
  name: string;
  weaponClass: number;
  weaponSize: number;
  warheadSize: number;
  hePen: number;
  heKill: number;
  apPen: number;
  apKill: number;
  accuracy: number;
  range: number;       // hexes
  sabotRange: number;  // hexes
  sabotPen: number;
  heatPen: number;
}

/**
 * Parse a weapon CSV into a weapon-ID → WeaponStats map.
 */
export async function loadWeaponTable(csvPath: string): Promise<Map<number, WeaponStats>> {
  const raw = await readFile(csvPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const table = new Map<number, WeaponStats>();

  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    const int = (idx: number) => parseInt(c[idx] || '0', 10) || 0;
    const id = int(2); // OB Slot No = weapon ID
    if (id === 0) continue;
    table.set(id, {
      weaponId: id,
      name: (c[3] || '').trim(),
      weaponClass: int(4),
      weaponSize: int(5),
      warheadSize: int(6),
      hePen: int(7),
      heKill: int(8),
      apPen: int(9),
      apKill: int(10),
      accuracy: int(11),
      range: int(12),
      sabotRange: int(13),
      sabotPen: int(14),
      heatPen: int(15),
    });
  }
  return table;
}

/**
 * Load and parse a unit CSV file into an array of UnitType records.
 * Handles all 3 faction CSVs (Terran, Ataxian, Khroshi).
 *
 * @param weaponTable  Optional weapon lookup (weapon ID → stats). If provided,
 *                     weapon accuracy, range, penetration, etc. are filled in.
 */
export async function loadUnitTypes(
  csvPath: string,
  weaponTable?: Map<number, WeaponStats>,
): Promise<UnitType[]> {
  const raw = await readFile(csvPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const units: UnitType[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < headers.length) continue;

    const unit = parseUnitRow(cols, weaponTable);
    if (unit) units.push(unit);
  }

  return units;
}

/**
 * Load all 3 faction CSVs + their weapon tables from a directory.
 *
 * @param docsDir     Path to 'New Direction Docs/' (contains unit CSVs)
 * @param weaponsDir  Path to 'Unit Testing/' (contains weapon CSVs)
 */
export async function loadAllFactions(
  docsDir: string,
  weaponsDir: string,
): Promise<UnitType[]> {
  // Faction unit CSV → weapon CSV mapping
  const factions: { unitFile: string; weaponFile: string }[] = [
    { unitFile: 'Terran_Federation_Units.csv', weaponFile: 'USA Weapons.csv' },
    { unitFile: 'Ataxian_Hive_Units.csv', weaponFile: 'China Weapons.csv' },
    { unitFile: 'Khroshi_Syndicalist_Units.csv', weaponFile: 'Russia Weapons.csv' },
  ];

  const all: UnitType[] = [];
  for (const { unitFile, weaponFile } of factions) {
    const weapons = await loadWeaponTable(`${weaponsDir}/${weaponFile}`);
    const units = await loadUnitTypes(`${docsDir}/${unitFile}`, weapons);
    all.push(...units);
  }
  return all;
}

// --- Column index mapping (0-based) ---
// Based on CSV headers after C01 fix

const COL = {
  NATION_ID: 0, NATIONALITY: 1, OB_SLOT: 2, NAME: 3, NATION: 4,
  CLASS_ID: 5, CLASS: 6, COST: 7, SIZE: 8, CREW: 9,
  SPEED: 10, SWIM_SPD: 11, MOVE_CLASS_ID: 12, MOVE_CLASS: 13,
  RADIO: 14, SURVIVABILITY: 15, LIFT_CAP: 16, LOAD_COST: 17,
  FIRST_MONTH: 18, FIRST_YEAR: 19, LAST_MONTH: 20, LAST_YEAR: 21,
  FC: 22, STABILISER: 23, VISION: 24, NR_SD: 25, ROF: 26, EW: 27, RF: 28,
  // Weapon 1
  WPN1_ID: 29, WPN1_NAME: 30, WPN1_HE: 31, WPN1_AP: 32,
  WPN1_HEAT: 33, WPN1_SABOT: 34, WPN1_SOUND: 35,
  // Weapon 2
  WPN2_ID: 36, WPN2_NAME: 37, WPN2_HE: 38, WPN2_AP: 39, WPN2_SOUND: 40,
  // Weapon 3
  WPN3_ID: 41, WPN3_NAME: 42, WPN3_HE: 43, WPN3_AP: 44, WPN3_SOUND: 45,
  // Weapon 4 (columns 49-50 fixed: Wpn4 HE Rds / Wpn4 AP Rds)
  WPN4_ID: 46, WPN4_NAME: 47, WPN4_HE: 48, WPN4_AP: 49, WPN4_SOUND: 50,
  // Armour — Steel
  STEEL_HF: 51, STEEL_HS: 52, STEEL_HR: 53,
  STEEL_TF: 54, STEEL_TS: 55, STEEL_TR: 56, STEEL_TOP: 57,
  // Armour — HEAT
  HEAT_HF: 58, HEAT_HS: 59, HEAT_HR: 60,
  HEAT_TF: 61, HEAT_TS: 62, HEAT_TR: 63, HEAT_TOP: 64,
  // ERA
  ERA_HF: 65, ERA_HS: 66, ERA_HR: 67,
  ERA_TF: 68, ERA_TS: 69, ERA_TR: 70, ERA_TOP: 71,
  // Misc
  UNIT_SOUND: 72, GRAPHIC_ID: 73, PICTURE_ID: 74,
} as const;

function parseUnitRow(cols: string[], weaponTable?: Map<number, WeaponStats>): UnitType | null {
  const int = (i: number) => parseInt(cols[i] || '0', 10) || 0;
  const str = (i: number) => (cols[i] || '').trim();

  const nationId = int(COL.NATION_ID);
  const name = str(COL.NAME);
  if (!name) return null;

  return {
    id: `${nationId}_${int(COL.OB_SLOT)}`,
    name,
    nationId,
    obSlot: int(COL.OB_SLOT),
    unitClass: mapUnitClass(int(COL.CLASS_ID)),
    classId: int(COL.CLASS_ID),
    cost: int(COL.COST),
    maxSpeedM: int(COL.SPEED) * 50 / 300,  // CSV Speed × 50 = m/turn, ÷ 300s = m/s
    swimSpeedM: int(COL.SWIM_SPD) * 50 / 300,
    moveClass: mapMoveClass(int(COL.MOVE_CLASS_ID)),
    moveClassId: int(COL.MOVE_CLASS_ID),
    visionM: 500 + int(COL.VISION) * 50,   // 500 m baseline + CSV value × 50
    fc: int(COL.FC),
    rf: int(COL.RF),
    stabilizer: int(COL.STABILISER),
    ew: int(COL.EW),
    radioChance: int(COL.RADIO),
    smokeDischargers: int(COL.NR_SD),
    maxCrew: int(COL.CREW),
    survivability: int(COL.SURVIVABILITY),
    size: int(COL.SIZE),
    transportCapacity: 0,
    liftCapacity: int(COL.LIFT_CAP),
    loadCost: int(COL.LOAD_COST),
    rof: int(COL.ROF),
    sound: int(COL.UNIT_SOUND),
    graphicId: int(COL.GRAPHIC_ID),
    pictureId: int(COL.PICTURE_ID),
    firstAvailMonth: int(COL.FIRST_MONTH),
    firstAvailYear: int(COL.FIRST_YEAR),
    lastAvailMonth: int(COL.LAST_MONTH),
    lastAvailYear: int(COL.LAST_YEAR),
    steelArmour: parseArmourFacings(cols, COL.STEEL_HF),
    heatArmour: parseArmourFacings(cols, COL.HEAT_HF),
    eraLevel: parseArmourFacings(cols, COL.ERA_HF),
    weapons: [
      parseWeaponSlot1(cols, weaponTable),
      parseWeaponSlot234(cols, COL.WPN2_ID, COL.WPN2_NAME, COL.WPN2_HE, COL.WPN2_AP, COL.WPN2_SOUND, weaponTable),
      parseWeaponSlot234(cols, COL.WPN3_ID, COL.WPN3_NAME, COL.WPN3_HE, COL.WPN3_AP, COL.WPN3_SOUND, weaponTable),
      parseWeaponSlot234(cols, COL.WPN4_ID, COL.WPN4_NAME, COL.WPN4_HE, COL.WPN4_AP, COL.WPN4_SOUND, weaponTable),
    ],
  };
}

function parseArmourFacings(cols: string[], startCol: number): ArmourFacings {
  const int = (i: number) => parseInt(cols[i] || '0', 10) || 0;
  return {
    hullFront: int(startCol),
    hullSide: int(startCol + 1),
    hullRear: int(startCol + 2),
    turretFront: int(startCol + 3),
    turretSide: int(startCol + 4),
    turretRear: int(startCol + 5),
    top: int(startCol + 6),
  };
}

function parseWeaponSlot1(cols: string[], weaponTable?: Map<number, WeaponStats>): WeaponSlot | null {
  const int = (i: number) => parseInt(cols[i] || '0', 10) || 0;
  const id = int(COL.WPN1_ID);
  if (id === 0) return null;
  const w = weaponTable?.get(id);
  return {
    weaponId: id,
    weaponName: (cols[COL.WPN1_NAME] || '').trim(),
    acc: w?.accuracy ?? 0,
    warheadSize: w?.warheadSize ?? 0,
    rangeM: (w?.range ?? 0) * 50,     // hexes × 50 = metres
    minRangeM: 0,
    ammoHE: int(COL.WPN1_HE), ammoAP: int(COL.WPN1_AP),
    ammoHEAT: int(COL.WPN1_HEAT), ammoSabot: int(COL.WPN1_SABOT),
    penAP: w?.apPen ?? 0,
    penSabot: w?.sabotPen ?? 0,
    penHEAT: w?.heatPen ?? 0,
    heKill: w?.heKill ?? 0,
    rof: 0,
    traverseType: 'turret',
    sound: int(COL.WPN1_SOUND),
  };
}

function parseWeaponSlot234(
  cols: string[], idCol: number, nameCol: number,
  heCol: number, apCol: number, soundCol: number,
  weaponTable?: Map<number, WeaponStats>,
): WeaponSlot | null {
  const int = (i: number) => parseInt(cols[i] || '0', 10) || 0;
  const id = int(idCol);
  if (id === 0) return null;
  const w = weaponTable?.get(id);
  return {
    weaponId: id,
    weaponName: (cols[nameCol] || '').trim(),
    acc: w?.accuracy ?? 0,
    warheadSize: w?.warheadSize ?? 0,
    rangeM: (w?.range ?? 0) * 50,
    minRangeM: 0,
    ammoHE: int(heCol), ammoAP: int(apCol),
    ammoHEAT: 0, ammoSabot: 0,  // weapons 2-4 don't have HEAT/Sabot columns
    penAP: w?.apPen ?? 0,
    penSabot: w?.sabotPen ?? 0,
    penHEAT: w?.heatPen ?? 0,
    heKill: w?.heKill ?? 0,
    rof: 0,
    traverseType: 'turret',
    sound: int(soundCol),
  };
}

// --- Mapping helpers ---

function mapMoveClass(id: number): MoveClass {
  // TODO: Map CSV move class IDs to canonical MoveClass values
  const map: Record<number, MoveClass> = { 0: 'leg', 1: 'wheel', 2: 'track', 3: 'hover', 4: 'air' };
  return map[id] ?? 'leg';
}

function mapUnitClass(id: number): UnitClass {
  // WinSPMBT CLASS_ID → game UnitClass
  // Grouped by combat role; unmapped IDs fall through to 'support'
  switch (id) {
    // MBTs
    case 13: case 14: case 59: case 102: case 104: case 106: case 107:
    case 131: case 132: case 175:
      return 'mbt';
    // IFVs
    case 237: case 238:
      return 'ifv';
    // APCs
    case 23: case 24: case 25: case 120: case 121: case 122: case 123:
    case 125: case 126: case 127: case 136: case 219: case 251:
      return 'apc';
    // Scouts
    case 11: case 32: case 58: case 101: case 108: case 248:
      return 'scout';
    // AT vehicles
    case 12: case 15: case 17: case 19: case 33: case 34: case 35:
    case 39: case 52:
      return 'at_vehicle';
    // AA vehicles
    case 22: case 30: case 128: case 181:
      return 'aa_vehicle';
    // SP Artillery
    case 21: case 130: case 155: case 156:
      return 'arty_sp';
    // Towed artillery / field guns
    case 6: case 9: case 10: case 31: case 157: case 158: case 184:
    case 211:
      return 'arty_towed';
    // Mortars
    case 5: case 38: case 133: case 152: case 153: case 173:
    case 200: case 202:
      return 'mortar';
    // Supply / logistics
    case 26: case 27: case 28: case 56: case 138: case 167: case 180:
    case 183:
      return 'supply';
    // Infantry
    case 1: case 4: case 7: case 64: case 65: case 68: case 69: case 70:
    case 160: case 161: case 176: case 177: case 178: case 186: case 193:
    case 226: case 254:
      return 'infantry';
    // AT infantry
    case 2: case 142: case 146: case 206: case 207: case 208: case 209:
    case 212: case 213:
      return 'at_infantry';
    // AA infantry (MANPADS / SAMs)
    case 8: case 16: case 29:
      return 'aa_infantry';
    // Engineers
    case 20: case 36: case 37: case 140: case 141: case 195:
      return 'engineer';
    // Snipers
    case 45: case 143: case 144:
      return 'sniper';
    // HQ / command
    case 54: case 55: case 57: case 63: case 229:
      return 'hq';
    // Attack helicopters
    case 203: case 221: case 222:
      return 'helicopter_attack';
    // Transport / utility helicopters
    case 53: case 204: case 205:
      return 'helicopter_transport';
    // Fixed wing
    case 44: case 50: case 60: case 62: case 214: case 215: case 223: case 253:
      return 'fixed_wing';
    // Default: support (fortifications, boats, misc)
    default:
      return 'support';
  }
}

// --- CSV line parser (handles quoted fields) ---

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
    current += ch;
  }
  fields.push(current);
  return fields;
}
