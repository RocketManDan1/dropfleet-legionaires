import type { Vec2 } from './core.js';
export type EffectType = 'muzzle_flash' | 'tracer' | 'tracer_burst' | 'impact_spark' | 'explosion_small' | 'explosion_medium' | 'explosion_large' | 'explosion_orbital' | 'smoke_puff' | 'smoke_screen' | 'dust_cloud' | 'fire_sustained' | 'debris' | 'suppression_ring' | 'rocket_trail' | 'illumination_flare' | 'artillery_whistle';
export interface PoolConfig {
    effectType: EffectType;
    maxParticles: number;
    blending: 'additive' | 'normal';
    geometry: 'quad' | 'stretched_quad' | 'tiny_quad' | 'tiny_cube' | 'ring' | 'ribbon' | 'quad_light';
}
export interface ParticleState {
    active: boolean;
    posX: number;
    posY: number;
    posZ: number;
    velX: number;
    velY: number;
    velZ: number;
    age: number;
    maxAge: number;
    size: number;
    opacity: number;
    colorR: number;
    colorG: number;
    colorB: number;
}
export interface EffectSpawnRequest {
    effectType: EffectType;
    pos: Vec2;
    posY?: number;
    direction?: Vec2;
    scale?: number;
    intensity?: number;
}
export interface GroundDecal {
    decalId: string;
    type: 'crater' | 'scorch' | 'track';
    posX: number;
    posZ: number;
    radius: number;
    rotation: number;
    opacity: number;
    createdAt: number;
}
