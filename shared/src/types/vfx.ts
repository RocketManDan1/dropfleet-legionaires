// ============================================================================
// VISUAL EFFECTS — particle pools, SDF particles, effect types
// Source: VISUAL_EFFECTS.md, AUTHORITATIVE_CONTRACTS.md §11
// ============================================================================

import type { Vec2 } from './core.js';

// --- Effect types ---

export type EffectType =
  | 'muzzle_flash'
  | 'tracer'
  | 'tracer_burst'
  | 'impact_spark'
  | 'explosion_small'
  | 'explosion_medium'
  | 'explosion_large'
  | 'explosion_orbital'
  | 'smoke_puff'
  | 'smoke_screen'
  | 'dust_cloud'
  | 'fire_sustained'
  | 'debris'
  | 'suppression_ring'
  | 'rocket_trail'
  | 'illumination_flare'
  | 'artillery_whistle';

// --- Pool budget configuration ---

export interface PoolConfig {
  effectType: EffectType;
  maxParticles: number;
  blending: 'additive' | 'normal';
  geometry: 'quad' | 'stretched_quad' | 'tiny_quad' | 'tiny_cube' | 'ring' | 'ribbon' | 'quad_light';
}

// --- Particle state (per active particle) ---

export interface ParticleState {
  active: boolean;
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  age: number;                // seconds since spawn
  maxAge: number;             // lifetime in seconds
  size: number;
  opacity: number;
  colorR: number;
  colorG: number;
  colorB: number;
}

// --- Effect spawn request (from server game event) ---

export interface EffectSpawnRequest {
  effectType: EffectType;
  pos: Vec2;
  posY?: number;              // height above terrain (default 0)
  direction?: Vec2;           // for directional effects (tracers)
  scale?: number;             // size multiplier (default 1)
  intensity?: number;         // for caliber-scaled effects
}

// --- Ground decal ---

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
