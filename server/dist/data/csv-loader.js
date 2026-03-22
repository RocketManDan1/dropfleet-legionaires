// ============================================================================
// CSV LOADER — Parse faction unit CSV files into UnitType records
// Milestone 2
// Source: Unit Schema Spec.md, CLAUDE.md (known CSV bug — columns 49-50 fixed)
// ============================================================================
import { readFile } from 'fs/promises';
/**
 * Load and parse a unit CSV file into an array of UnitType records.
 * Handles all 3 faction CSVs (Terran, Ataxian, Khroshi).
 */
export async function loadUnitTypes(csvPath) {
    const raw = await readFile(csvPath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2)
        return [];
    const headers = parseCSVLine(lines[0]);
    const units = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < headers.length)
            continue;
        const unit = parseUnitRow(cols);
        if (unit)
            units.push(unit);
    }
    return units;
}
/**
 * Load all 3 faction CSVs from a directory.
 */
export async function loadAllFactions(docsDir) {
    const files = [
        'Terran_Federation_Units.csv',
        'Ataxian_Hive_Units.csv',
        'Khroshi_Syndicalist_Units.csv',
    ];
    const all = [];
    for (const file of files) {
        const units = await loadUnitTypes(`${docsDir}/${file}`);
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
};
function parseUnitRow(cols) {
    const int = (i) => parseInt(cols[i] || '0', 10) || 0;
    const str = (i) => (cols[i] || '').trim();
    const nationId = int(COL.NATION_ID);
    const name = str(COL.NAME);
    if (!name)
        return null;
    return {
        id: `${nationId}_${int(COL.OB_SLOT)}`,
        name,
        nationId,
        obSlot: int(COL.OB_SLOT),
        unitClass: mapUnitClass(int(COL.CLASS_ID)),
        classId: int(COL.CLASS_ID),
        cost: int(COL.COST),
        maxSpeedM: int(COL.SPEED), // TODO: convert CSV value to m/s
        swimSpeedM: int(COL.SWIM_SPD),
        moveClass: mapMoveClass(int(COL.MOVE_CLASS_ID)),
        moveClassId: int(COL.MOVE_CLASS_ID),
        visionM: int(COL.VISION) * 50, // CSV value × 50 = metres
        fc: int(COL.FC),
        rf: int(COL.RF),
        stabilizer: int(COL.STABILISER),
        ew: int(COL.EW),
        radioChance: int(COL.RADIO),
        smokeDischargers: int(COL.NR_SD),
        maxCrew: int(COL.CREW),
        survivability: int(COL.SURVIVABILITY),
        size: int(COL.SIZE),
        transportCapacity: 0, // TODO: derive from class
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
            parseWeaponSlot1(cols),
            parseWeaponSlot234(cols, COL.WPN2_ID, COL.WPN2_NAME, COL.WPN2_HE, COL.WPN2_AP, COL.WPN2_SOUND),
            parseWeaponSlot234(cols, COL.WPN3_ID, COL.WPN3_NAME, COL.WPN3_HE, COL.WPN3_AP, COL.WPN3_SOUND),
            parseWeaponSlot234(cols, COL.WPN4_ID, COL.WPN4_NAME, COL.WPN4_HE, COL.WPN4_AP, COL.WPN4_SOUND),
        ],
    };
}
function parseArmourFacings(cols, startCol) {
    const int = (i) => parseInt(cols[i] || '0', 10) || 0;
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
function parseWeaponSlot1(cols) {
    const int = (i) => parseInt(cols[i] || '0', 10) || 0;
    const id = int(COL.WPN1_ID);
    if (id === 0)
        return null;
    return {
        weaponId: id,
        weaponName: (cols[COL.WPN1_NAME] || '').trim(),
        acc: 0, warheadSize: 0, rangeM: 0, minRangeM: 0, // TODO: weapon lookup table
        ammoHE: int(COL.WPN1_HE), ammoAP: int(COL.WPN1_AP),
        ammoHEAT: int(COL.WPN1_HEAT), ammoSabot: int(COL.WPN1_SABOT),
        penAP: 0, penSabot: 0, penHEAT: 0, heKill: 0, rof: 0, // TODO: weapon lookup
        traverseType: 'turret',
        sound: int(COL.WPN1_SOUND),
    };
}
function parseWeaponSlot234(cols, idCol, nameCol, heCol, apCol, soundCol) {
    const int = (i) => parseInt(cols[i] || '0', 10) || 0;
    const id = int(idCol);
    if (id === 0)
        return null;
    return {
        weaponId: id,
        weaponName: (cols[nameCol] || '').trim(),
        acc: 0, warheadSize: 0, rangeM: 0, minRangeM: 0,
        ammoHE: int(heCol), ammoAP: int(apCol),
        ammoHEAT: 0, ammoSabot: 0, // weapons 2-4 don't have HEAT/Sabot columns
        penAP: 0, penSabot: 0, penHEAT: 0, heKill: 0, rof: 0,
        traverseType: 'turret',
        sound: int(soundCol),
    };
}
// --- Mapping helpers ---
function mapMoveClass(id) {
    // TODO: Map CSV move class IDs to canonical MoveClass values
    const map = { 0: 'leg', 1: 'wheel', 2: 'track', 3: 'hover', 4: 'air' };
    return map[id] ?? 'leg';
}
function mapUnitClass(id) {
    // TODO: Map CSV class IDs to canonical UnitClass values
    return 'infantry';
}
// --- CSV line parser (handles quoted fields) ---
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    fields.push(current);
    return fields;
}
