// ============================================================================
// PARTICLE POOL — GPU-efficient instanced particle rendering for all VFX
// Milestone: 3 ("Playable Mission")
// Source: VISUAL_EFFECTS.md, AUTHORITATIVE_CONTRACTS.md section 11
//
// Each ParticlePool manages a single EffectType backed by a THREE.InstancedMesh.
// Particles are stored in a ring buffer and recycled via a free-list. The vertex
// shader handles camera-facing billboard orientation, and the fragment shader
// draws procedural SDF shapes (soft circle, starburst, streak, ring) so no
// bitmap textures are needed — consistent with the DRONECOM aesthetic.
// ============================================================================

import * as THREE from 'three';
import type {
  EffectType,
  PoolConfig,
  ParticleState,
  Vec2,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// DRONECOM palette constants (from VISUAL_EFFECTS.md section 1.1)
// ---------------------------------------------------------------------------

const COLOR_MUZZLE_FLASH  = { r: 1.0,  g: 0.816, b: 0.502 }; // #FFD080
const COLOR_TRACER         = { r: 0.8,  g: 1.0,   b: 0.267 }; // #CCFF44
const COLOR_IMPACT_SPARK   = { r: 1.0,  g: 0.8,   b: 0.251 }; // #FFCC40
const COLOR_EXPLOSION_CORE = { r: 1.0,  g: 1.0,   b: 1.0   }; // #FFFFFF
const COLOR_FIREBALL       = { r: 1.0,  g: 0.502, b: 0.188 }; // #FF8030
const COLOR_SMOKE          = { r: 0.251, g: 0.251, b: 0.251 }; // #404040
const COLOR_DUST           = { r: 0.376, g: 0.345, b: 0.314 }; // #605850
const COLOR_DEBRIS         = { r: 0.188, g: 0.188, b: 0.188 }; // #303030
const COLOR_SUPPRESSION    = { r: 1.0,  g: 0.251, b: 0.125 }; // #FF4020
const COLOR_ROCKET_HEAD    = { r: 1.0,  g: 0.502, b: 0.188 }; // #FF8030
const COLOR_ROCKET_TRAIL   = { r: 0.502, g: 0.502, b: 0.502 }; // #808080
const COLOR_FLARE          = { r: 1.0,  g: 1.0,   b: 0.8   }; // #FFFFCC
const COLOR_ORBITAL_CYAN   = { r: 0.502, g: 1.0,   b: 0.847 }; // #80FFD8
const COLOR_FIRE_SUSTAINED = { r: 0.502, g: 0.125, b: 0.063 }; // #802010
const COLOR_SMOKE_SCREEN   = { r: 0.376, g: 0.376, b: 0.376 }; // #606060

// ---------------------------------------------------------------------------
// SDF shape enum used by the fragment shader
// ---------------------------------------------------------------------------

const SHAPE_SOFT_CIRCLE = 0;
const SHAPE_STARBURST   = 1;
const SHAPE_STREAK      = 2;
const SHAPE_RING        = 3;

// ---------------------------------------------------------------------------
// Per-effect-type spawn configuration
// ---------------------------------------------------------------------------

interface EffectSpawnConfig {
  /** SDF shape index for the fragment shader */
  shape: number;
  /** Base lifetime range [min, max] in seconds */
  lifetimeMin: number;
  lifetimeMax: number;
  /** Base particle size (world units) */
  sizeStart: number;
  sizeEnd: number;
  /** Starting opacity */
  opacityStart: number;
  opacityEnd: number;
  /** RGB color */
  colorR: number;
  colorG: number;
  colorB: number;
  /** Base velocity ranges */
  velXRange: [number, number];
  velYRange: [number, number];
  velZRange: [number, number];
  /** Gravity multiplier (0 = none, 1 = full 9.81) */
  gravity: number;
  /** Number of particles per spawn call */
  countMin: number;
  countMax: number;
  /** Particle speed in direction (for directed effects like tracers), m/s */
  directionSpeed: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const SPAWN_CONFIGS: Record<EffectType, EffectSpawnConfig> = {
  muzzle_flash: {
    shape: SHAPE_STARBURST,
    lifetimeMin: 0.04, lifetimeMax: 0.10,
    sizeStart: 2.0, sizeEnd: 4.0,
    opacityStart: 1.0, opacityEnd: 0.0,
    colorR: COLOR_MUZZLE_FLASH.r, colorG: COLOR_MUZZLE_FLASH.g, colorB: COLOR_MUZZLE_FLASH.b,
    velXRange: [0, 0], velYRange: [0.5, 1.0], velZRange: [0, 0],
    gravity: 0, countMin: 1, countMax: 1, directionSpeed: 0,
  },
  tracer: {
    shape: SHAPE_STREAK,
    lifetimeMin: 0.15, lifetimeMax: 0.30,
    sizeStart: 0.4, sizeEnd: 0.25,
    opacityStart: 1.0, opacityEnd: 0.3,
    colorR: COLOR_TRACER.r, colorG: COLOR_TRACER.g, colorB: COLOR_TRACER.b,
    velXRange: [0, 0], velYRange: [0, 0], velZRange: [0, 0],
    gravity: 0, countMin: 1, countMax: 1, directionSpeed: 800,
  },
  tracer_burst: {
    shape: SHAPE_STREAK,
    lifetimeMin: 0.15, lifetimeMax: 0.30,
    sizeStart: 0.35, sizeEnd: 0.2,
    opacityStart: 1.0, opacityEnd: 0.3,
    colorR: COLOR_TRACER.r, colorG: COLOR_TRACER.g, colorB: COLOR_TRACER.b,
    velXRange: [-1, 1], velYRange: [0, 0], velZRange: [-1, 1],
    gravity: 0, countMin: 3, countMax: 5, directionSpeed: 800,
  },
  impact_spark: {
    shape: SHAPE_STARBURST,
    lifetimeMin: 0.06, lifetimeMax: 0.15,
    sizeStart: 0.5, sizeEnd: 0.15,
    opacityStart: 1.0, opacityEnd: 0.0,
    colorR: COLOR_IMPACT_SPARK.r, colorG: COLOR_IMPACT_SPARK.g, colorB: COLOR_IMPACT_SPARK.b,
    velXRange: [-5, 5], velYRange: [2, 8], velZRange: [-5, 5],
    gravity: 0.3, countMin: 3, countMax: 6, directionSpeed: 0,
  },
  explosion_small: {
    shape: SHAPE_STARBURST,
    lifetimeMin: 0.3, lifetimeMax: 0.5,
    sizeStart: 2.0, sizeEnd: 5.0,
    opacityStart: 1.0, opacityEnd: 0.0,
    colorR: COLOR_FIREBALL.r, colorG: COLOR_FIREBALL.g, colorB: COLOR_FIREBALL.b,
    velXRange: [-2, 2], velYRange: [3, 6], velZRange: [-2, 2],
    gravity: 0.1, countMin: 3, countMax: 5, directionSpeed: 0,
  },
  explosion_medium: {
    shape: SHAPE_STARBURST,
    lifetimeMin: 0.5, lifetimeMax: 0.8,
    sizeStart: 4.0, sizeEnd: 9.0,
    opacityStart: 1.0, opacityEnd: 0.0,
    colorR: COLOR_FIREBALL.r, colorG: COLOR_FIREBALL.g, colorB: COLOR_FIREBALL.b,
    velXRange: [-3, 3], velYRange: [4, 9], velZRange: [-3, 3],
    gravity: 0.1, countMin: 5, countMax: 8, directionSpeed: 0,
  },
  explosion_large: {
    shape: SHAPE_SOFT_CIRCLE,
    lifetimeMin: 0.8, lifetimeMax: 1.2,
    sizeStart: 6.0, sizeEnd: 16.0,
    opacityStart: 1.0, opacityEnd: 0.0,
    colorR: COLOR_EXPLOSION_CORE.r, colorG: COLOR_EXPLOSION_CORE.g, colorB: COLOR_EXPLOSION_CORE.b,
    velXRange: [-4, 4], velYRange: [5, 12], velZRange: [-4, 4],
    gravity: 0.05, countMin: 8, countMax: 12, directionSpeed: 0,
  },
  explosion_orbital: {
    shape: SHAPE_RING,
    lifetimeMin: 1.5, lifetimeMax: 2.0,
    sizeStart: 2.0, sizeEnd: 30.0,
    opacityStart: 1.0, opacityEnd: 0.0,
    colorR: COLOR_ORBITAL_CYAN.r, colorG: COLOR_ORBITAL_CYAN.g, colorB: COLOR_ORBITAL_CYAN.b,
    velXRange: [0, 0], velYRange: [0, 1], velZRange: [0, 0],
    gravity: 0, countMin: 1, countMax: 2, directionSpeed: 0,
  },
  smoke_puff: {
    shape: SHAPE_SOFT_CIRCLE,
    lifetimeMin: 1.5, lifetimeMax: 2.5,
    sizeStart: 1.5, sizeEnd: 5.0,
    opacityStart: 0.6, opacityEnd: 0.0,
    colorR: COLOR_SMOKE.r, colorG: COLOR_SMOKE.g, colorB: COLOR_SMOKE.b,
    velXRange: [-0.5, 0.5], velYRange: [0.8, 2.0], velZRange: [-0.5, 0.5],
    gravity: 0, countMin: 2, countMax: 4, directionSpeed: 0,
  },
  smoke_screen: {
    shape: SHAPE_SOFT_CIRCLE,
    lifetimeMin: 3.0, lifetimeMax: 5.0,
    sizeStart: 5.0, sizeEnd: 15.0,
    opacityStart: 0.6, opacityEnd: 0.0,
    colorR: COLOR_SMOKE_SCREEN.r, colorG: COLOR_SMOKE_SCREEN.g, colorB: COLOR_SMOKE_SCREEN.b,
    velXRange: [-0.5, 0.5], velYRange: [0.3, 0.8], velZRange: [-0.5, 0.5],
    gravity: 0, countMin: 1, countMax: 2, directionSpeed: 0,
  },
  dust_cloud: {
    shape: SHAPE_SOFT_CIRCLE,
    lifetimeMin: 0.5, lifetimeMax: 1.5,
    sizeStart: 1.0, sizeEnd: 4.0,
    opacityStart: 0.5, opacityEnd: 0.0,
    colorR: COLOR_DUST.r, colorG: COLOR_DUST.g, colorB: COLOR_DUST.b,
    velXRange: [-2, 2], velYRange: [0.5, 2], velZRange: [-2, 2],
    gravity: 0, countMin: 3, countMax: 5, directionSpeed: 0,
  },
  fire_sustained: {
    shape: SHAPE_SOFT_CIRCLE,
    lifetimeMin: 0.8, lifetimeMax: 1.5,
    sizeStart: 1.0, sizeEnd: 2.5,
    opacityStart: 0.7, opacityEnd: 0.0,
    colorR: COLOR_FIRE_SUSTAINED.r, colorG: COLOR_FIRE_SUSTAINED.g, colorB: COLOR_FIRE_SUSTAINED.b,
    velXRange: [-0.3, 0.3], velYRange: [1, 3], velZRange: [-0.3, 0.3],
    gravity: 0, countMin: 1, countMax: 2, directionSpeed: 0,
  },
  debris: {
    shape: SHAPE_SOFT_CIRCLE,
    lifetimeMin: 0.5, lifetimeMax: 1.5,
    sizeStart: 0.2, sizeEnd: 0.1,
    opacityStart: 1.0, opacityEnd: 0.4,
    colorR: COLOR_DEBRIS.r, colorG: COLOR_DEBRIS.g, colorB: COLOR_DEBRIS.b,
    velXRange: [-8, 8], velYRange: [5, 15], velZRange: [-8, 8],
    gravity: 1.0, countMin: 4, countMax: 12, directionSpeed: 0,
  },
  suppression_ring: {
    shape: SHAPE_RING,
    lifetimeMin: 0.3, lifetimeMax: 0.5,
    sizeStart: 0.5, sizeEnd: 4.0,
    opacityStart: 0.7, opacityEnd: 0.0,
    colorR: COLOR_SUPPRESSION.r, colorG: COLOR_SUPPRESSION.g, colorB: COLOR_SUPPRESSION.b,
    velXRange: [0, 0], velYRange: [0, 0], velZRange: [0, 0],
    gravity: 0, countMin: 1, countMax: 1, directionSpeed: 0,
  },
  rocket_trail: {
    shape: SHAPE_STREAK,
    lifetimeMin: 1.0, lifetimeMax: 3.0,
    sizeStart: 0.3, sizeEnd: 0.6,
    opacityStart: 0.8, opacityEnd: 0.0,
    colorR: COLOR_ROCKET_TRAIL.r, colorG: COLOR_ROCKET_TRAIL.g, colorB: COLOR_ROCKET_TRAIL.b,
    velXRange: [0, 0], velYRange: [0, 0], velZRange: [0, 0],
    gravity: 0, countMin: 1, countMax: 1, directionSpeed: 200,
  },
  illumination_flare: {
    shape: SHAPE_SOFT_CIRCLE,
    lifetimeMin: 30, lifetimeMax: 45,
    sizeStart: 1.5, sizeEnd: 0.6,
    opacityStart: 1.0, opacityEnd: 0.0,
    colorR: COLOR_FLARE.r, colorG: COLOR_FLARE.g, colorB: COLOR_FLARE.b,
    velXRange: [0, 0], velYRange: [-1.5, -1.5], velZRange: [0, 0],
    gravity: 0, countMin: 1, countMax: 1, directionSpeed: 0,
  },
  artillery_whistle: {
    shape: SHAPE_RING,
    lifetimeMin: 1.0, lifetimeMax: 2.0,
    sizeStart: 10.0, sizeEnd: 0.8,
    opacityStart: 0.3, opacityEnd: 0.9,
    colorR: COLOR_SUPPRESSION.r, colorG: COLOR_SUPPRESSION.g, colorB: COLOR_SUPPRESSION.b,
    velXRange: [0, 0], velYRange: [0, 0], velZRange: [0, 0],
    gravity: 0, countMin: 1, countMax: 1, directionSpeed: 0,
  },
};

// ---------------------------------------------------------------------------
// Vertex shader — billboard orientation from view matrix
// Uses instance attributes for position, scale, opacity, color, shape, rotation
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 instancePos;
  attribute float instanceScale;
  attribute float instanceOpacity;
  attribute vec3 instanceColor;
  attribute float instanceShape;
  attribute float instanceRotation;

  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vColor;
  varying float vShape;

  void main() {
    vUv = uv;
    vOpacity = instanceOpacity;
    vColor = instanceColor;
    vShape = instanceShape;

    // Extract camera right/up from view matrix for billboard orientation
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

    // Apply per-particle rotation around the view axis
    float c = cos(instanceRotation);
    float s = sin(instanceRotation);
    vec3 right = camRight * c + camUp * s;
    vec3 up    = -camRight * s + camUp * c;

    vec3 worldPos = instancePos
                  + right * position.x * instanceScale
                  + up * position.y * instanceScale;

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Fragment shader — procedural SDF shapes (no textures)
// ---------------------------------------------------------------------------

const FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vColor;
  varying float vShape;

  float softCircle(vec2 uv) {
    float d = length(uv - 0.5) * 2.0;
    return 1.0 - smoothstep(0.6, 1.0, d);
  }

  float starburst(vec2 uv) {
    vec2 centered = uv - 0.5;
    float angle = atan(centered.y, centered.x);
    float radius = length(centered) * 2.0;
    float ray = abs(sin(angle * 6.0)) * 0.5;
    float glow = 1.0 - smoothstep(0.0, 0.5 + ray * 0.3, radius);
    return glow;
  }

  float streak(vec2 uv) {
    float dx = abs(uv.x - 0.5);
    float dy = abs(uv.y - 0.5) * 2.0;
    return (1.0 - smoothstep(0.0, 0.15, dx)) * (1.0 - dy * dy);
  }

  float ring(vec2 uv) {
    float d = length(uv - 0.5) * 2.0;
    return smoothstep(0.8, 0.85, d) * (1.0 - smoothstep(0.95, 1.0, d));
  }

  void main() {
    float alpha = 0.0;
    int shape = int(vShape + 0.5);

    if (shape == 0) {
      alpha = softCircle(vUv);
    } else if (shape == 1) {
      alpha = starburst(vUv);
    } else if (shape == 2) {
      alpha = streak(vUv);
    } else {
      alpha = ring(vUv);
    }

    alpha *= vOpacity;
    if (alpha < 0.005) discard;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

// ---------------------------------------------------------------------------
// ParticlePool class
// ---------------------------------------------------------------------------

export class ParticlePool {
  readonly effectType: EffectType;
  readonly maxParticles: number;

  private particles: ParticleState[];
  private freeList: number[];
  private nextIndex: number;

  private mesh: THREE.Mesh;
  private baseGeometry: THREE.PlaneGeometry;
  private material: THREE.ShaderMaterial;

  // Per-instance attribute buffers
  private instancePosArray: Float32Array;
  private instanceScaleArray: Float32Array;
  private instanceOpacityArray: Float32Array;
  private instanceColorArray: Float32Array;
  private instanceShapeArray: Float32Array;
  private instanceRotationArray: Float32Array;

  // THREE.js buffer attributes
  private posAttr: THREE.InstancedBufferAttribute;
  private scaleAttr: THREE.InstancedBufferAttribute;
  private opacityAttr: THREE.InstancedBufferAttribute;
  private colorAttr: THREE.InstancedBufferAttribute;
  private shapeAttr: THREE.InstancedBufferAttribute;
  private rotationAttr: THREE.InstancedBufferAttribute;

  private config: EffectSpawnConfig;
  private geometry: THREE.InstancedBufferGeometry;

  constructor(poolConfig: PoolConfig, scene: THREE.Scene) {
    this.effectType = poolConfig.effectType;
    this.maxParticles = poolConfig.maxParticles;
    this.config = SPAWN_CONFIGS[poolConfig.effectType];
    this.nextIndex = 0;

    // Initialize particle state array
    this.particles = [];
    this.freeList = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        active: false,
        posX: 0, posY: 0, posZ: 0,
        velX: 0, velY: 0, velZ: 0,
        age: 0, maxAge: 1,
        size: 1, opacity: 0,
        colorR: 0, colorG: 0, colorB: 0,
      });
      this.freeList.push(i);
    }

    // Build instanced geometry from a single billboard quad
    this.baseGeometry = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = this.baseGeometry.index;
    this.geometry.attributes.position = this.baseGeometry.attributes.position;
    this.geometry.attributes.uv = this.baseGeometry.attributes.uv;
    this.geometry.instanceCount = this.maxParticles;

    // Allocate per-instance attribute buffers
    this.instancePosArray = new Float32Array(this.maxParticles * 3);
    this.instanceScaleArray = new Float32Array(this.maxParticles);
    this.instanceOpacityArray = new Float32Array(this.maxParticles);
    this.instanceColorArray = new Float32Array(this.maxParticles * 3);
    this.instanceShapeArray = new Float32Array(this.maxParticles);
    this.instanceRotationArray = new Float32Array(this.maxParticles);

    this.posAttr = new THREE.InstancedBufferAttribute(this.instancePosArray, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instancePos', this.posAttr);

    this.scaleAttr = new THREE.InstancedBufferAttribute(this.instanceScaleArray, 1);
    this.scaleAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceScale', this.scaleAttr);

    this.opacityAttr = new THREE.InstancedBufferAttribute(this.instanceOpacityArray, 1);
    this.opacityAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceOpacity', this.opacityAttr);

    this.colorAttr = new THREE.InstancedBufferAttribute(this.instanceColorArray, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceColor', this.colorAttr);

    this.shapeAttr = new THREE.InstancedBufferAttribute(this.instanceShapeArray, 1);
    this.shapeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceShape', this.shapeAttr);

    this.rotationAttr = new THREE.InstancedBufferAttribute(this.instanceRotationArray, 1);
    this.rotationAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceRotation', this.rotationAttr);

    // Determine blending mode
    const isAdditive = poolConfig.blending === 'additive';

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // Render order: particles at layer 5 (above terrain/water/grid, below UI)
    this.mesh.renderOrder = 5;

    scene.add(this.mesh);
  }

  /**
   * Activate one or more particles from the pool at the given position.
   * Uses ring-buffer reuse: if the free list is empty, the oldest particle
   * (by nextIndex wrap-around) is overwritten.
   */
  spawn(
    pos: Vec2,
    direction?: Vec2,
    scale?: number,
    intensity?: number,
  ): void {
    const cfg = this.config;
    const scaleMul = scale ?? 1;
    const count = Math.round(rand(cfg.countMin, cfg.countMax));

    for (let n = 0; n < count; n++) {
      // Acquire a slot: prefer free list, otherwise recycle via ring buffer
      let idx: number;
      if (this.freeList.length > 0) {
        idx = this.freeList.pop()!;
      } else {
        idx = this.nextIndex;
        this.nextIndex = (this.nextIndex + 1) % this.maxParticles;
      }

      const p = this.particles[idx];
      p.active = true;
      p.age = 0;
      p.maxAge = rand(cfg.lifetimeMin, cfg.lifetimeMax);
      p.size = cfg.sizeStart * scaleMul;
      p.opacity = cfg.opacityStart;
      p.colorR = cfg.colorR;
      p.colorG = cfg.colorG;
      p.colorB = cfg.colorB;

      // Position: use the provided world pos. Y defaults to 1.0 (above ground).
      p.posX = pos.x + rand(-0.3, 0.3) * scaleMul;
      p.posY = (intensity ?? 1.0);
      p.posZ = pos.z + rand(-0.3, 0.3) * scaleMul;

      // Velocity: if a direction is supplied and the effect has directionSpeed,
      // use the direction vector. Otherwise use the random velocity ranges.
      if (direction && cfg.directionSpeed > 0) {
        const dirLen = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        const nx = dirLen > 0.001 ? direction.x / dirLen : 0;
        const nz = dirLen > 0.001 ? direction.z / dirLen : 0;
        // Add slight random spread (cone of +/- 2 degrees)
        const spreadRad = rand(-0.035, 0.035);
        const cosS = Math.cos(spreadRad);
        const sinS = Math.sin(spreadRad);
        const sx = nx * cosS - nz * sinS;
        const sz = nx * sinS + nz * cosS;
        p.velX = sx * cfg.directionSpeed;
        p.velY = rand(0, 2);
        p.velZ = sz * cfg.directionSpeed;
      } else {
        p.velX = rand(cfg.velXRange[0], cfg.velXRange[1]) * scaleMul;
        p.velY = rand(cfg.velYRange[0], cfg.velYRange[1]) * scaleMul;
        p.velZ = rand(cfg.velZRange[0], cfg.velZRange[1]) * scaleMul;
      }

      // Write initial GPU state for this slot
      this._writeInstanceData(idx, p);
    }
  }

  /**
   * Advance all active particles: integrate velocity, apply gravity, age,
   * interpolate size and opacity, recycle dead particles.
   */
  update(dt: number): void {
    const cfg = this.config;
    let needsUpdate = false;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      needsUpdate = true;
      p.age += dt;

      // Recycle dead particle
      if (p.age >= p.maxAge) {
        p.active = false;
        this.freeList.push(i);
        // Hide by setting scale/opacity to zero
        this.instanceScaleArray[i] = 0;
        this.instanceOpacityArray[i] = 0;
        continue;
      }

      // Normalized age 0..1
      const t = p.age / p.maxAge;

      // Integrate position
      p.posX += p.velX * dt;
      p.posY += p.velY * dt;
      p.posZ += p.velZ * dt;

      // Gravity (debris gets full, others get gentle or none)
      p.velY -= 9.81 * cfg.gravity * dt;

      // Floor clamp: particles don't go below y=0.05
      if (p.posY < 0.05) {
        p.posY = 0.05;
        p.velY = Math.abs(p.velY) * 0.3; // weak bounce
        p.velX *= 0.7;
        p.velZ *= 0.7;
      }

      // Interpolate size from start to end
      const currentSize = cfg.sizeStart + (cfg.sizeEnd - cfg.sizeStart) * t;
      p.size = currentSize * (p.size / Math.max(cfg.sizeStart, 0.001));

      // Interpolate opacity from start to end
      p.opacity = cfg.opacityStart + (cfg.opacityEnd - cfg.opacityStart) * t;

      // Color shift for multi-phase explosions: white -> orange -> gray
      if (this.effectType === 'explosion_large' || this.effectType === 'explosion_medium') {
        if (t < 0.15) {
          // Core flash: white
          p.colorR = 1.0;
          p.colorG = 1.0;
          p.colorB = 1.0;
        } else if (t < 0.5) {
          // Fireball: orange
          const blend = (t - 0.15) / 0.35;
          p.colorR = 1.0;
          p.colorG = 1.0 - blend * 0.5;
          p.colorB = 1.0 - blend * 0.8;
        } else {
          // Smoke: dark gray
          const blend = (t - 0.5) / 0.5;
          p.colorR = COLOR_FIREBALL.r * (1 - blend) + COLOR_SMOKE.r * blend;
          p.colorG = COLOR_FIREBALL.g * (1 - blend) + COLOR_SMOKE.g * blend;
          p.colorB = COLOR_FIREBALL.b * (1 - blend) + COLOR_SMOKE.b * blend;
        }
      }

      // Flare pendulum sway
      if (this.effectType === 'illumination_flare') {
        const swayX = Math.sin(p.age * 0.3 * Math.PI * 2) * 2.0;
        p.posX += swayX * dt;
      }

      // Artillery whistle: pulse opacity
      if (this.effectType === 'artillery_whistle') {
        const pulse = 0.5 + 0.5 * Math.sin(p.age * 4.0 * Math.PI * 2);
        p.opacity *= pulse;
      }

      // Write updated data to GPU buffers
      this._writeInstanceData(i, p);
    }

    if (needsUpdate) {
      this.posAttr.needsUpdate = true;
      this.scaleAttr.needsUpdate = true;
      this.opacityAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.rotationAttr.needsUpdate = true;
    }
  }

  /**
   * Returns the number of currently active particles in this pool.
   */
  getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particles[i].active) count++;
    }
    return count;
  }

  /**
   * Remove all particles (mark inactive, zero GPU data).
   */
  clear(): void {
    this.freeList.length = 0;
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i].active = false;
      this.freeList.push(i);
      this.instanceScaleArray[i] = 0;
      this.instanceOpacityArray[i] = 0;
    }
    this.posAttr.needsUpdate = true;
    this.scaleAttr.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;
    this.nextIndex = 0;
  }

  /**
   * Dispose all Three.js resources (geometry, material, mesh).
   * Must be called when the pool is no longer needed.
   */
  dispose(): void {
    this.geometry.dispose();
    this.baseGeometry.dispose();
    this.material.dispose();
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }

  /**
   * Write a single particle's state into the GPU instance attribute buffers.
   */
  private _writeInstanceData(idx: number, p: ParticleState): void {
    const i3 = idx * 3;
    this.instancePosArray[i3]     = p.posX;
    this.instancePosArray[i3 + 1] = p.posY;
    this.instancePosArray[i3 + 2] = p.posZ;

    // Interpolate size over lifetime
    const t = clamp(p.age / p.maxAge, 0, 1);
    const cfg = this.config;
    const lerpedSize = cfg.sizeStart + (cfg.sizeEnd - cfg.sizeStart) * t;
    this.instanceScaleArray[idx] = lerpedSize;

    this.instanceOpacityArray[idx] = p.opacity;

    this.instanceColorArray[i3]     = p.colorR;
    this.instanceColorArray[i3 + 1] = p.colorG;
    this.instanceColorArray[i3 + 2] = p.colorB;

    this.instanceShapeArray[idx] = cfg.shape;

    // Simple rotation: accumulate over time for a spinning effect on debris/smoke
    this.instanceRotationArray[idx] = p.age * (idx % 2 === 0 ? 1.5 : -1.5);
  }
}

// ---------------------------------------------------------------------------
// Helper: build a PoolConfig for a given effect type
// ---------------------------------------------------------------------------

const GEOMETRY_MAP: Record<EffectType, PoolConfig['geometry']> = {
  muzzle_flash:      'quad',
  tracer:            'stretched_quad',
  tracer_burst:      'stretched_quad',
  impact_spark:      'tiny_quad',
  explosion_small:   'quad',
  explosion_medium:  'quad',
  explosion_large:   'quad',
  explosion_orbital: 'quad_light',
  smoke_puff:        'quad',
  smoke_screen:      'quad',
  dust_cloud:        'quad',
  fire_sustained:    'quad',
  debris:            'tiny_cube',
  suppression_ring:  'ring',
  rocket_trail:      'ribbon',
  illumination_flare:'quad_light',
  artillery_whistle: 'ring',
};

const BLENDING_MAP: Record<EffectType, PoolConfig['blending']> = {
  muzzle_flash:      'additive',
  tracer:            'additive',
  tracer_burst:      'additive',
  impact_spark:      'additive',
  explosion_small:   'additive',
  explosion_medium:  'additive',
  explosion_large:   'additive',
  explosion_orbital: 'additive',
  smoke_puff:        'normal',
  smoke_screen:      'normal',
  dust_cloud:        'normal',
  fire_sustained:    'additive',
  debris:            'normal',
  suppression_ring:  'additive',
  rocket_trail:      'additive',
  illumination_flare:'additive',
  artillery_whistle: 'additive',
};

/**
 * Build a PoolConfig for the given effect type and max particle count.
 * Used by EffectManager to initialize all 17 pools.
 */
export function buildPoolConfig(
  effectType: EffectType,
  maxParticles: number,
): PoolConfig {
  return {
    effectType,
    maxParticles,
    geometry: GEOMETRY_MAP[effectType],
    blending: BLENDING_MAP[effectType],
  };
}
