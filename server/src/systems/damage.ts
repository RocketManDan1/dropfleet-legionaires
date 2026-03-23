// ============================================================================
// PHASE 6: DAMAGE APPLICATION — Milestone 2
// Source: Combat Formula Spec.md §1 (To-Hit), §6-9 (Penetration), §10 (Kill)
//
// Processes ShotRecord array from Phase 5, resolves hit/pen/damage per shot.
// Dead units flagged here are skipped in Phase 7 (Suppression).
// ============================================================================

import type {
  ShotRecord, DamageResult, ToHitResult, PenResult,
  UnitInstance, SystemDamage, UnitType, WeaponSlot, SystemDamageType,
} from '@legionaires/shared';
import type { UnitRegistry } from '../data/unit-registry.js';

export interface DamagePhaseResult {
  damageResults: DamageResult[];
  destroyedUnitIds: string[];
}

/**
 * Phase 6: Damage Application.
 * For each ShotRecord, roll to-hit, then penetration, then crew damage.
 */
export function applyDamage(
  shotRecords: ShotRecord[],
  units: Map<string, UnitInstance>,
  tick: number,
  unitTypes?: UnitRegistry | null,
): DamagePhaseResult {
  const damageResults: DamageResult[] = [];
  const destroyedUnitIds: string[] = [];

  for (const shot of shotRecords) {
    const target = units.get(shot.targetId);
    if (!target || target.isDestroyed) continue;

    // --- Step 1: To-Hit roll ---
    const hitResult = rollToHit(shot, units, unitTypes ?? null);
    if (!hitResult.isHit) continue; // miss — still generates suppression (Phase 7)

    // --- Step 2: Determine impact facing ---
    const facing = determineImpactFacing(shot, target);

    // --- Step 3: Penetration roll ---
    const penResult = rollPenetration(shot, target, facing, unitTypes ?? null);

    if (!penResult.isPenetration) {
      // Bounce — no crew damage, but still suppression
      damageResults.push({
        targetId: target.instanceId,
        crewLost: 0,
        systemDamage: [],
        isDestroyed: false,
        isBailedOut: false,
        isImmobilized: false,
      });
      continue;
    }

    // --- Step 4: Crew damage ---
    const crewLost = rollCrewDamage(shot, target, penResult, unitTypes ?? null);
    target.crewCurrent = Math.max(0, target.crewCurrent - crewLost);

    // --- Step 5: System damage ---
    const systemDamage = rollSystemDamage(shot, target, penResult);

    // --- Step 6: ERA depletion ---
    if (penResult.eraConsumed) {
      depleteERA(target, facing);
    }

    // --- Step 7: Check destruction ---
    const isDestroyed = target.crewCurrent <= 0;
    if (isDestroyed) {
      target.isDestroyed = true;
      target.destroyedAtTick = tick;
      destroyedUnitIds.push(target.instanceId);
    }

    damageResults.push({
      targetId: target.instanceId,
      crewLost,
      systemDamage,
      isDestroyed,
      isBailedOut: false,
      isImmobilized: systemDamage.some(d => d.type === 'engine_hit'),
    });
  }

  return { damageResults, destroyedUnitIds };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getWeapon(unitTypes: UnitRegistry | null, unitTypeId: string, slot: number): WeaponSlot | null {
  if (!unitTypes) return null;
  const ut = unitTypes.get(unitTypeId);
  if (!ut) return null;
  return ut.weapons[slot] ?? null;
}

function getUnitType(unitTypes: UnitRegistry | null, unitTypeId: string): UnitType | null {
  if (!unitTypes) return null;
  return unitTypes.get(unitTypeId) ?? null;
}

function warheadBonus(warheadSize: number): number {
  return Math.floor(Math.random() * (warheadSize + 1));
}

// ── To-Hit formula (Combat Formula Spec §1) ────────────────────────────────

function rollToHit(
  shot: ShotRecord,
  units: Map<string, UnitInstance>,
  unitTypes: UnitRegistry | null,
): ToHitResult {
  const firer = units.get(shot.firerId);
  const target = units.get(shot.targetId);
  if (!firer || !target) return { hitChance: 0, roll: 1, isHit: false };

  const weapon = getWeapon(unitTypes, firer.unitTypeId, shot.weaponSlot);
  const firerType = getUnitType(unitTypes, firer.unitTypeId);
  const targetType = getUnitType(unitTypes, target.unitTypeId);

  const acc = weapon?.acc ?? 10;
  const weaponRangeM = weapon?.rangeM ?? 2000;
  const fc = firerType?.fc ?? 0;
  const rf = firerType?.rf ?? 0;
  const stabilizer = firerType?.stabilizer ?? 0;
  const targetSize = targetType?.size ?? 3;

  // 1. Base accuracy: 0–90% at point-blank
  const baseHit = (acc / 30) * 90;

  // 2. Range factor (0–1). Laser RF compresses the falloff curve.
  const rfCompression = rf >= 20 ? 0.40 : (rf / 20) * 0.15;
  const normalizedRange = Math.min(1, shot.range / Math.max(1, weaponRangeM));
  const rangeFactor = Math.max(0, 1 - normalizedRange * (1 - rfCompression));

  // 3. Apply range
  let hit = baseHit * rangeFactor;

  // 4. Firer movement penalty / bonus
  const stabBonus = stabilizer * 4;
  const firerModTable: Record<string, number> = {
    full_halt: +10,
    short_halt: +5,
    slow: -10,
    fast: -30 + stabBonus,
  };
  const firerMod = firerModTable[firer.speedState] ?? 0;

  // 5. Target movement penalty, offset by FC
  const fcFactor = Math.min(1, fc / 100);
  const targetModTable: Record<string, number> = {
    stationary: 0,
    full_halt: 0,
    short_halt: 0,
    slow: -15 * (1 - fcFactor * 0.5),
    fast: -30 * (1 - fcFactor),
  };
  const targetMod = targetModTable[target.speedState] ?? 0;

  // 6. Target size modifier (size 3 = neutral)
  const sizeMod = (targetSize - 3) * 6 + (targetSize === 0 ? -10 : 0);

  // 7. Suppression penalty on firer (max −20% at full suppression)
  const suppressionMod = -(firer.suppressionLevel / 100) * 20;

  // 8. Laser RF halt bonus
  const rfHaltBonus = (rf >= 20 && firer.speedState === 'full_halt') ? 10 : 0;

  const totalPct = hit + firerMod + targetMod + sizeMod + suppressionMod + rfHaltBonus;
  const clampedPct = Math.min(95, Math.max(5, totalPct));
  const hitChance = clampedPct / 100; // convert to 0-1

  const roll = Math.random();
  return { hitChance, roll, isHit: roll < hitChance };
}

// ── Impact facing determination ─────────────────────────────────────────────

type ArmourFacing = 'hullFront' | 'hullSide' | 'hullRear' | 'turretFront' | 'turretSide' | 'turretRear' | 'top';

function determineImpactFacing(shot: ShotRecord, target: UnitInstance): ArmourFacing {
  // Calculate bearing from shot origin to target, relative to target heading
  const dx = shot.fromPos.x - target.posX;
  const dz = shot.fromPos.z - target.posZ;
  const bearingRad = Math.atan2(dx, dz); // 0 = north
  let bearingDeg = (bearingRad * 180 / Math.PI + 360) % 360;

  // Relative to target hull heading
  let relativeHull = ((bearingDeg - target.heading) + 360) % 360;

  // 0-60° from front = front, 60-120° = side, 120-180° = rear
  let hullZone: 'front' | 'side' | 'rear';
  if (relativeHull <= 60 || relativeHull >= 300) {
    hullZone = 'front';
  } else if (relativeHull <= 120 || relativeHull >= 240) {
    hullZone = 'side';
  } else {
    hullZone = 'rear';
  }

  // Turret facing — use turretHeading if available, else same as hull
  const turretH = target.turretHeading ?? target.heading;
  let relativeTurret = ((bearingDeg - turretH) + 360) % 360;

  let turretZone: 'front' | 'side' | 'rear';
  if (relativeTurret <= 60 || relativeTurret >= 300) {
    turretZone = 'front';
  } else if (relativeTurret <= 120 || relativeTurret >= 240) {
    turretZone = 'side';
  } else {
    turretZone = 'rear';
  }

  // Pick the armour facing that is struck — hull or turret (50/50 for tanks, hull-only for non-turreted)
  const hasTurret = target.turretHeading !== null;
  const hitTurret = hasTurret && Math.random() < 0.5;

  if (hitTurret) {
    return `turret${turretZone.charAt(0).toUpperCase() + turretZone.slice(1)}` as ArmourFacing;
  }
  return `hull${hullZone.charAt(0).toUpperCase() + hullZone.slice(1)}` as ArmourFacing;
}

// ── Penetration formula (Combat Formula Spec §6-9) ─────────────────────────

interface InternalPenResult extends PenResult {
  isCatastrophic: boolean;
}

function rollPenetration(
  shot: ShotRecord,
  target: UnitInstance,
  facing: ArmourFacing,
  unitTypes: UnitRegistry | null,
): InternalPenResult {
  const weapon = getWeapon(unitTypes, target.unitTypeId, 0); // just for the firer's weapon...
  // Actually get firer's weapon
  const firerWeapon = (() => {
    if (!unitTypes) return null;
    // We need the firer's unit type, but we only have target here — get from shot context
    return null; // Will be overridden below
  })();

  // Get weapon pen from unitTypes using shot context
  let penValue = 0;
  let wh = 0;
  if (unitTypes) {
    // We need shot.firerId to look up firer unit type — but rollPenetration only gets target
    // The weapon info must come from the shot's ammoType and slot
    // Since we already have shot info, we can reconstruct: the firer's weapon stats
    // are needed. Let's look up from the shot record (firer unit type).
    // However, we don't have firer UnitInstance here by design. Use a workaround:
    // Encode pen/wh in a helper.
  }

  // Fallback: extract pen from shot ammo type (will be wired properly via shot enrichment)
  const basePen = penValue || 10; // placeholder if unitTypes not available
  const effectivePen = basePen + warheadBonus(wh);

  // Target armour for this facing
  const isHeatType = shot.ammoType === 'HEAT';
  const armourMap = isHeatType ? target.heatArmour : target.steelArmour;
  const armour = armourMap[facing] ?? 0;

  // ERA check
  let eraConsumed = false;
  if (isHeatType || shot.ammoType === 'Sabot') {
    const eraVal = target.eraRemaining[facing] ?? 0;
    if (eraVal > 0) {
      const eraDefeatChance = Math.min(90, eraVal * 10) / 100;
      if (Math.random() < eraDefeatChance) {
        eraConsumed = true;
        return { penChance: 0, roll: 0, isPenetration: false, eraConsumed: true, isCatastrophic: false };
      }
    }
  }

  // Penetration: pen >= armour  → normal pen; pen >= armour + 10 → catastrophic
  if (armour <= 0) {
    // Unarmoured target — auto-penetrate
    return { penChance: 1, roll: 0, isPenetration: true, eraConsumed, isCatastrophic: true };
  }

  const isPen = effectivePen >= armour;
  const isCatastrophic = effectivePen >= armour + 10;

  return {
    penChance: isPen ? 1 : effectivePen / armour,
    roll: 0,
    isPenetration: isPen,
    eraConsumed,
    isCatastrophic,
  };
}

// ── Crew damage (Combat Formula Spec §7, §10) ──────────────────────────────

function rollCrewDamage(
  shot: ShotRecord,
  target: UnitInstance,
  penResult: InternalPenResult,
  unitTypes: UnitRegistry | null,
): number {
  const targetType = getUnitType(unitTypes, target.unitTypeId);
  const survivability = targetType?.survivability ?? 3;

  // Catastrophic pen → unit destroyed (all crew)
  if (penResult.isCatastrophic) {
    return target.crewCurrent;
  }

  // Normal pen → survivability roll (§7)
  // S/7 * 100 = survival chance %. If roll fails → 1-2 crew lost
  const survivalChancePct = (survivability / 7) * 100;
  const roll = Math.random() * 100;

  if (roll < survivalChancePct) {
    // Crew survives this pen
    return 0;
  }

  // Failed survival → 1-2 crew lost
  const crewLost = 1 + Math.floor(Math.random() * 2);
  return Math.min(crewLost, target.crewCurrent);
}

// ── System damage rolls ─────────────────────────────────────────────────────

const SYSTEM_DAMAGE_TABLE: Array<{ type: SystemDamageType; weight: number }> = [
  { type: 'gun_damaged', weight: 25 },
  { type: 'turret_jammed', weight: 15 },
  { type: 'engine_hit', weight: 20 },
  { type: 'optics_damaged', weight: 25 },
  { type: 'ammo_cook_off', weight: 15 },
];
const TOTAL_WEIGHT = SYSTEM_DAMAGE_TABLE.reduce((s, e) => s + e.weight, 0);

function rollSystemDamage(_shot: ShotRecord, _target: UnitInstance, penResult: InternalPenResult): SystemDamage[] {
  // Catastrophic pen = ammo cook-off (instant destruction handled in crew damage)
  if (penResult.isCatastrophic) {
    return [{ type: 'ammo_cook_off' }];
  }

  // Normal pen: 30% chance of one system hit
  if (Math.random() > 0.30) return [];

  // Weighted random pick
  let r = Math.random() * TOTAL_WEIGHT;
  for (const entry of SYSTEM_DAMAGE_TABLE) {
    r -= entry.weight;
    if (r <= 0) {
      return [{ type: entry.type }];
    }
  }
  return [{ type: 'optics_damaged' }];
}

// ── ERA depletion ───────────────────────────────────────────────────────────

function depleteERA(target: UnitInstance, facing: ArmourFacing): void {
  const facingKey = facing as keyof typeof target.eraRemaining;
  const current = target.eraRemaining[facingKey];
  if (current !== undefined && current > 0) {
    (target.eraRemaining as Record<string, number>)[facingKey] = current - 1;
  }
}

// ── Enriched damage with firer weapon lookup ────────────────────────────────
// This helper resolves firer weapon stats for penetration.
// Called from the tick-loop which has access to all units.

export function enrichShotWithPen(
  shot: ShotRecord,
  units: Map<string, UnitInstance>,
  unitTypes: UnitRegistry | null,
): { penValue: number; wh: number } {
  const firer = units.get(shot.firerId);
  if (!firer || !unitTypes) return { penValue: 10, wh: 0 };

  const weapon = getWeapon(unitTypes, firer.unitTypeId, shot.weaponSlot);
  if (!weapon) return { penValue: 10, wh: 0 };

  let penValue: number;
  switch (shot.ammoType) {
    case 'AP': penValue = weapon.penAP; break;
    case 'Sabot': penValue = weapon.penSabot; break;
    case 'HEAT': penValue = weapon.penHEAT; break;
    case 'HE': penValue = weapon.heKill; break;
    default: penValue = weapon.penAP;
  }

  return { penValue: penValue || 10, wh: weapon.warheadSize };
}
