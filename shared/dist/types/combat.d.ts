import type { Vec2 } from './core.js';
export interface ShotRecord {
    shotId: string;
    firerId: string;
    targetId: string;
    weaponSlot: number;
    ammoType: 'HE' | 'AP' | 'HEAT' | 'Sabot';
    fromPos: Vec2;
    toPos: Vec2;
    range: number;
    tick: number;
}
export interface ToHitInputs {
    baseAcc: number;
    firerFC: number;
    firerStabilizer: number;
    firerSpeedState: string;
    targetSize: number;
    targetSpeedState: string;
    range: number;
    isEntrenched: boolean;
    isHullDown: boolean;
    weatherModifier: number;
}
export interface ToHitResult {
    hitChance: number;
    roll: number;
    isHit: boolean;
}
export interface PenInputs {
    penValue: number;
    armourValue: number;
    eraValue: number;
    range: number;
    ammoType: string;
}
export interface PenResult {
    penChance: number;
    roll: number;
    isPenetration: boolean;
    eraConsumed: boolean;
}
export interface DamageResult {
    targetId: string;
    crewLost: number;
    systemDamage: SystemDamage[];
    isDestroyed: boolean;
    isBailedOut: boolean;
    isImmobilized: boolean;
}
export type SystemDamageType = 'gun_damaged' | 'turret_jammed' | 'engine_hit' | 'optics_damaged' | 'ammo_cook_off';
export interface SystemDamage {
    type: SystemDamageType;
    weaponSlot?: number;
}
export interface SuppressionInputs {
    targetId: string;
    warheadSize: number;
    range: number;
    isDirectHit: boolean;
    isNearMiss: boolean;
    nearMissDistance: number;
    targetCurrentSuppression: number;
    targetMoraleState: string;
    factionSuppressionFloor: number;
    qualityModifier: number;
}
export interface SuppressionResult {
    suppressionDelta: number;
    newSuppression: number;
    newMoraleState: string;
    triggersMoraleCheck: boolean;
}
export interface MoraleThresholds {
    pinThreshold: number;
    routeThreshold: number;
    surrenderThreshold: number;
    rallyThreshold: number;
}
