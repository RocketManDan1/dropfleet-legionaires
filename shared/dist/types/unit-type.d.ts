import type { MoveClass, UnitClass, TraverseType } from './core.js';
export interface ArmourFacings {
    hullFront: number;
    hullSide: number;
    hullRear: number;
    turretFront: number;
    turretSide: number;
    turretRear: number;
    top: number;
}
export interface WeaponSlot {
    weaponId: number;
    weaponName: string;
    acc: number;
    warheadSize: number;
    rangeM: number;
    minRangeM: number;
    ammoHE: number;
    ammoAP: number;
    ammoHEAT: number;
    ammoSabot: number;
    penAP: number;
    penSabot: number;
    penHEAT: number;
    heKill: number;
    rof: number;
    traverseType: TraverseType;
    sound: number;
}
export interface UnitType {
    id: string;
    name: string;
    nationId: number;
    obSlot: number;
    unitClass: UnitClass;
    classId: number;
    cost: number;
    maxSpeedM: number;
    swimSpeedM: number;
    moveClass: MoveClass;
    moveClassId: number;
    visionM: number;
    fc: number;
    rf: number;
    stabilizer: number;
    ew: number;
    radioChance: number;
    smokeDischargers: number;
    steelArmour: ArmourFacings;
    heatArmour: ArmourFacings;
    eraLevel: Partial<ArmourFacings>;
    maxCrew: number;
    survivability: number;
    size: number;
    transportCapacity: number;
    liftCapacity: number;
    loadCost: number;
    weapons: [WeaponSlot | null, WeaponSlot | null, WeaponSlot | null, WeaponSlot | null];
    rof: number;
    sound: number;
    graphicId: number;
    pictureId: number;
    firstAvailMonth: number;
    firstAvailYear: number;
    lastAvailMonth: number;
    lastAvailYear: number;
}
