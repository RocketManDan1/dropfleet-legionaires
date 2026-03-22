// ============================================================================
// COMBAT — shot records, damage resolution, suppression
// Source: Combat Formula Spec.md, SERVER_GAME_LOOP.md
// ============================================================================

import type { Vec2 } from './core.js';

// --- Shot record (produced by Phase 5: Fire Resolution) ---

export interface ShotRecord {
  shotId: string;
  firerId: string;            // UnitInstance.instanceId
  targetId: string;
  weaponSlot: number;         // 0–3
  ammoType: 'HE' | 'AP' | 'HEAT' | 'Sabot';
  fromPos: Vec2;
  toPos: Vec2;
  range: number;              // metres
  tick: number;
}

// --- To-hit calculation inputs ---

export interface ToHitInputs {
  baseAcc: number;            // weapon accuracy (0–30)
  firerFC: number;            // fire control
  firerStabilizer: number;
  firerSpeedState: string;    // SpeedState
  targetSize: number;         // 0–6
  targetSpeedState: string;
  range: number;
  isEntrenched: boolean;
  isHullDown: boolean;
  weatherModifier: number;    // 1.0 normal
}

export interface ToHitResult {
  hitChance: number;          // 0–1 probability
  roll: number;               // random roll 0–1
  isHit: boolean;
}

// --- Penetration calculation ---

export interface PenInputs {
  penValue: number;           // weapon pen rating
  armourValue: number;        // facing armour at impact angle
  eraValue: number;           // ERA protection (if any)
  range: number;
  ammoType: string;
}

export interface PenResult {
  penChance: number;
  roll: number;
  isPenetration: boolean;
  eraConsumed: boolean;       // true if ERA charge was used
}

// --- Damage result (produced by Phase 6: Damage Application) ---

export interface DamageResult {
  targetId: string;
  crewLost: number;           // how many crew/strength were killed
  systemDamage: SystemDamage[];
  isDestroyed: boolean;       // crewCurrent reached 0
  isBailedOut: boolean;
  isImmobilized: boolean;
}

export type SystemDamageType = 'gun_damaged' | 'turret_jammed' | 'engine_hit' | 'optics_damaged' | 'ammo_cook_off';

export interface SystemDamage {
  type: SystemDamageType;
  weaponSlot?: number;        // for gun_damaged
}

// --- Suppression inputs ---

export interface SuppressionInputs {
  targetId: string;
  warheadSize: number;        // from weapon
  range: number;
  isDirectHit: boolean;
  isNearMiss: boolean;
  nearMissDistance: number;    // metres
  targetCurrentSuppression: number;
  targetMoraleState: string;
  factionSuppressionFloor: number; // e.g. Ataxian floor = 70
  qualityModifier: number;    // elite = +30
}

export interface SuppressionResult {
  suppressionDelta: number;   // points added this event
  newSuppression: number;     // clamped 0–100
  newMoraleState: string;     // MoraleState after threshold checks
  triggersMoraleCheck: boolean;
}

// --- Morale thresholds ---

export interface MoraleThresholds {
  pinThreshold: number;       // suppression >= this → pinned
  routeThreshold: number;     // suppression >= this → routing
  surrenderThreshold: number; // suppression >= this → surrendered
  rallyThreshold: number;     // suppression must drop below this to rally
}
