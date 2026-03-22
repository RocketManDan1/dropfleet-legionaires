// ============================================================================
// EFFECT MANAGER — top-level VFX orchestrator for all combat visual effects
// Milestone: 3 ("Playable Mission")
// Source: VISUAL_EFFECTS.md, AUTHORITATIVE_CONTRACTS.md section 11
//
// Singleton manager that owns all 17 particle pools, converts incoming game
// events (shot_fired, shot_impact, unit_destroyed, suppression, smoke_deployed)
// into visual effect spawns, manages ground decals (crater, scorch), applies
// LOD culling based on camera distance, and handles screen-level effects
// (camera shake, impact flash).
// ============================================================================

import * as THREE from 'three';
import type {
  EffectType,
  EffectSpawnRequest,
  GroundDecal,
  Vec2,
} from '@legionaires/shared';
import {
  POOL_BUDGETS,
  MAX_GROUND_DECALS,
  VFX_LOD_THRESHOLD,
} from '@legionaires/shared';
import type {
  GameEvent,
  ShotFiredEvent,
  ShotImpactEvent,
  UnitDestroyedEvent,
  SuppressionEvent,
  SmokeDeployedEvent,
} from '@legionaires/shared';

import { ParticlePool, buildPoolConfig } from './particles.js';

// ---------------------------------------------------------------------------
// Sustained emitter — for effects that emit particles over a duration
// (smoke screens, burning wrecks, fire_sustained)
// ---------------------------------------------------------------------------

interface Emitter {
  id: string;
  type: EffectType;
  pos: Vec2;
  posY: number;
  emitRate: number;          // particles per second
  remainingDuration: number; // seconds until auto-stop (-1 = manual stop)
  accumulator: number;       // fractional particle carry between frames
  active: boolean;
}

// ---------------------------------------------------------------------------
// Screen shake state
// ---------------------------------------------------------------------------

interface ScreenShake {
  intensity: number;  // max offset in world units
  decay: number;      // exponential decay constant
  remaining: number;  // seconds
}

// ---------------------------------------------------------------------------
// Ground decal mesh — a flat disc projected onto terrain
// ---------------------------------------------------------------------------

interface DecalEntry {
  decal: GroundDecal;
  mesh: THREE.Mesh;
}

// ---------------------------------------------------------------------------
// Decal color palette
// ---------------------------------------------------------------------------

const DECAL_COLORS: Record<GroundDecal['type'], THREE.Color> = {
  crater: new THREE.Color(0x252525),
  scorch: new THREE.Color(0x1A1A1A),
  track:  new THREE.Color(0x303020),
};

// ---------------------------------------------------------------------------
// All 17 effect types, in the canonical order from AUTHORITATIVE_CONTRACTS.md
// ---------------------------------------------------------------------------

const ALL_EFFECT_TYPES: EffectType[] = [
  'muzzle_flash',
  'tracer',
  'tracer_burst',
  'impact_spark',
  'explosion_small',
  'explosion_medium',
  'explosion_large',
  'explosion_orbital',
  'smoke_puff',
  'smoke_screen',
  'dust_cloud',
  'fire_sustained',
  'debris',
  'suppression_ring',
  'rocket_trail',
  'illumination_flare',
  'artillery_whistle',
];

// ---------------------------------------------------------------------------
// EffectManager
// ---------------------------------------------------------------------------

export class EffectManager {
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  /** One pool per effect type, keyed by EffectType string */
  private pools: Map<EffectType, ParticlePool>;

  /** Sustained / looping emitters (smoke screens, burning wrecks) */
  private emitters: Emitter[];
  private nextEmitterId: number;

  /** Ground decals (craters, scorch marks) — ring buffer */
  private decals: DecalEntry[];
  private decalGroup: THREE.Group;

  /** Screen shake state (additive across concurrent sources) */
  private shakes: ScreenShake[];

  /** Impact flash overlay (additive full-screen white quad) */
  private flashOpacity: number;
  private flashDecayRate: number;
  private flashMesh: THREE.Mesh;

  /** Saved camera base position (before shake is applied) */
  private cameraBaseX: number;
  private cameraBaseZ: number;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.pools = new Map();
    this.emitters = [];
    this.nextEmitterId = 0;
    this.decals = [];
    this.shakes = [];
    this.flashOpacity = 0;
    this.flashDecayRate = 0;
    this.cameraBaseX = 0;
    this.cameraBaseZ = 0;

    // Create all 17 particle pools with their budgets
    for (const effectType of ALL_EFFECT_TYPES) {
      const budget = POOL_BUDGETS[effectType];
      const config = buildPoolConfig(effectType, budget);
      const pool = new ParticlePool(config, scene);
      this.pools.set(effectType, pool);
    }

    // Create a group for ground decals (render order 4, below particles)
    this.decalGroup = new THREE.Group();
    this.decalGroup.renderOrder = 4;
    scene.add(this.decalGroup);

    // Create the full-screen flash overlay
    // This is a large quad positioned in front of the camera
    const flashGeo = new THREE.PlaneGeometry(2, 2);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.flashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.flashMesh.renderOrder = 100;
    this.flashMesh.frustumCulled = false;
    // Attach to camera so it always fills the view
    camera.add(this.flashMesh);
    this.flashMesh.position.set(0, 0, -1);
    // Only add camera to scene if it is not already parented
    if (!camera.parent) {
      scene.add(camera);
    }
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Spawn a visual effect by type. Delegates to the correct particle pool.
   * Respects the EffectSpawnRequest interface from shared types.
   */
  spawnEffect(request: EffectSpawnRequest): void {
    const pool = this.pools.get(request.effectType);
    if (!pool) return;

    pool.spawn(
      request.pos,
      request.direction,
      request.scale,
      request.posY ?? 1.0,
    );
  }

  /**
   * Update all pools, emitters, decals, screen shake, and flash.
   * Called every frame from the render loop.
   *
   * @param dt - delta time in seconds
   * @param cameraPos - current camera position on the XZ plane for LOD decisions
   */
  update(dt: number, cameraPos: Vec2): void {
    // --- Update all particle pools ---
    for (const [effectType, pool] of this.pools) {
      pool.update(dt);
    }

    // --- Update sustained emitters ---
    this._updateEmitters(dt);

    // --- LOD: reduce particle rendering when camera is far away ---
    // (We accomplish LOD by skipping spawn calls in emitters when camera
    // is beyond VFX_LOD_THRESHOLD from the emitter position. Active
    // particles already in-flight are allowed to finish.)

    // --- Update ground decals (fade old ones) ---
    this._updateDecals(dt);

    // --- Screen shake ---
    this._applyScreenShake(dt);

    // --- Impact flash ---
    this._updateFlash(dt);
  }

  /**
   * Convert an array of server game events into visual effect spawns.
   * This is the primary integration point between the network layer and VFX.
   */
  processGameEvents(events: GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'shot_fired':
          this._onShotFired(event);
          break;
        case 'shot_impact':
          this._onShotImpact(event);
          break;
        case 'unit_destroyed':
          this._onUnitDestroyed(event);
          break;
        case 'suppression':
          this._onSuppression(event);
          break;
        case 'smoke_deployed':
          this._onSmokeDeployed(event);
          break;
      }
    }
  }

  /**
   * Add a ground decal (crater, scorch mark, track mark).
   * Manages a ring buffer of MAX_GROUND_DECALS entries.
   */
  addGroundDecal(decal: GroundDecal): void {
    // If we are at capacity, remove the oldest decal
    if (this.decals.length >= MAX_GROUND_DECALS) {
      const oldest = this.decals.shift()!;
      this.decalGroup.remove(oldest.mesh);
      oldest.mesh.geometry.dispose();
      (oldest.mesh.material as THREE.Material).dispose();
    }

    // Create the decal mesh: flat circle on the terrain
    const geo = new THREE.CircleGeometry(decal.radius, 24);
    const color = DECAL_COLORS[decal.type] ?? new THREE.Color(0x1A1A1A);

    const mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: decal.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const mesh = new THREE.Mesh(geo, mat);
    // Position at ground level + tiny offset to avoid z-fighting
    mesh.position.set(decal.posX, 0.05, decal.posZ);
    // Rotate to lie flat on the XZ plane
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = decal.rotation;
    mesh.renderOrder = 4;

    this.decalGroup.add(mesh);
    this.decals.push({ decal, mesh });
  }

  /**
   * Clear all effects — all pools, emitters, decals, shakes.
   * Called on mission end or scene reset.
   */
  clear(): void {
    for (const pool of this.pools.values()) {
      pool.clear();
    }
    this.emitters.length = 0;
    for (const entry of this.decals) {
      this.decalGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
    this.decals.length = 0;
    this.shakes.length = 0;
    this.flashOpacity = 0;
    this._setFlashOpacity(0);
  }

  /**
   * Dispose all Three.js resources. Call when EffectManager is no longer needed.
   */
  dispose(): void {
    this.clear();

    for (const pool of this.pools.values()) {
      pool.dispose();
    }
    this.pools.clear();

    this.scene.remove(this.decalGroup);
    this.decalGroup.clear();

    this.flashMesh.geometry.dispose();
    (this.flashMesh.material as THREE.Material).dispose();
    if (this.flashMesh.parent) {
      this.flashMesh.parent.remove(this.flashMesh);
    }
  }

  /**
   * Get the total number of active particles across all pools.
   * Useful for performance monitoring / debug HUD.
   */
  getActiveParticleCount(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      total += pool.getActiveCount();
    }
    return total;
  }

  /**
   * Get the number of active sustained emitters.
   */
  getActiveEmitterCount(): number {
    return this.emitters.filter(e => e.active).length;
  }

  // =========================================================================
  // Game event handlers (VISUAL_EFFECTS.md section 8)
  // =========================================================================

  /**
   * SHOT_FIRED -> muzzle_flash at firer position + tracer toward target.
   */
  private _onShotFired(event: ShotFiredEvent): void {
    // Muzzle flash at the firer's position
    this.spawnEffect({
      effectType: 'muzzle_flash',
      pos: event.fromPos,
      posY: 1.0,
      scale: 1.0,
    });

    // Tracer from firer to target
    const dx = event.toPos.x - event.fromPos.x;
    const dz = event.toPos.z - event.fromPos.z;
    const direction: Vec2 = { x: dx, z: dz };

    this.spawnEffect({
      effectType: 'tracer',
      pos: event.fromPos,
      posY: 1.0,
      direction,
      scale: 1.0,
    });
  }

  /**
   * SHOT_IMPACT -> impact_spark at target. If penetrated, also explosion_small + debris.
   */
  private _onShotImpact(event: ShotImpactEvent): void {
    // Always spawn impact sparks
    this.spawnEffect({
      effectType: 'impact_spark',
      pos: event.pos,
      posY: 0.5,
    });

    // Dust cloud on every impact (near-miss debris)
    this.spawnEffect({
      effectType: 'dust_cloud',
      pos: event.pos,
      posY: 0.1,
      scale: 0.5,
    });

    if (event.penetrated) {
      // Penetrating hit: small explosion + debris
      this.spawnEffect({
        effectType: 'explosion_small',
        pos: event.pos,
        posY: 0.8,
      });

      this.spawnEffect({
        effectType: 'debris',
        pos: event.pos,
        posY: 1.0,
        scale: 0.7,
      });

      // Add a scorch mark decal at impact point
      this.addGroundDecal({
        decalId: `scorch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'scorch',
        posX: event.pos.x,
        posZ: event.pos.z,
        radius: 1.5 + Math.random() * 1.5,
        rotation: Math.random() * Math.PI * 2,
        opacity: 0.6 + Math.random() * 0.3,
        createdAt: Date.now(),
      });
    }
  }

  /**
   * UNIT_DESTROYED -> explosion_large + debris + fire_sustained emitter + smoke.
   * Also triggers screen shake and impact flash.
   */
  private _onUnitDestroyed(event: UnitDestroyedEvent): void {
    // Large explosion at unit position
    this.spawnEffect({
      effectType: 'explosion_large',
      pos: event.pos,
      posY: 1.5,
      scale: 1.5,
    });

    // Debris shower
    this.spawnEffect({
      effectType: 'debris',
      pos: event.pos,
      posY: 2.0,
      scale: 1.5,
    });

    // Smoke puff (immediate)
    this.spawnEffect({
      effectType: 'smoke_puff',
      pos: event.pos,
      posY: 2.0,
      scale: 2.0,
    });

    // Start a sustained fire emitter at the wreck location (20-40 seconds)
    this._startEmitter(
      'fire_sustained',
      event.pos,
      0.5,
      1.0,
      20 + Math.random() * 20,
    );

    // Start a sustained smoke column emitter (30-60 seconds)
    this._startEmitter(
      'smoke_puff',
      event.pos,
      1.0,
      2.0,
      30 + Math.random() * 30,
    );

    // Add a large crater decal
    this.addGroundDecal({
      decalId: `crater_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'crater',
      posX: event.pos.x,
      posZ: event.pos.z,
      radius: 3.0 + Math.random() * 3.0,
      rotation: Math.random() * Math.PI * 2,
      opacity: 0.8,
      createdAt: Date.now(),
    });

    // Screen shake (intensity 0.6, duration 0.6s, decay 3.0)
    this.shakes.push({
      intensity: 0.6,
      decay: 3.0,
      remaining: 0.6,
    });

    // Brief impact flash
    this.flashOpacity = 0.3;
    this.flashDecayRate = 4.0;
  }

  /**
   * SUPPRESSION -> suppression_ring at the suppressed unit's position.
   * We don't have the unit's position in the event directly, so we look it
   * up via the unitId. For now, we use a fallback: if pos data were on the
   * event we'd use it. Since SuppressionEvent only has unitId + newLevel,
   * the caller should inject pos. We handle this by spawning at origin as
   * fallback and providing a public method for pos-aware suppression.
   */
  private _onSuppression(event: SuppressionEvent): void {
    // SuppressionEvent only carries unitId + newLevel, not world position.
    // The effect manager cannot resolve unitId -> position on its own (that
    // data lives in the unit manager). Instead, the integration layer should
    // look up the unit's position and call spawnSuppressionAt(pos) directly.
    //
    // We store the suppression level in case a future integration wants to
    // scale the ring intensity based on suppression severity:
    //   newLevel < 40  -> no visual
    //   40..70         -> single ring
    //   70+            -> double ring (heavier suppression)
    if (event.newLevel >= 40) {
      // A real integration layer would resolve event.unitId to a Vec2 here.
      // Without that mapping, we cannot spawn a positioned effect, so this
      // is a no-op until the unit manager provides the bridge. See
      // spawnSuppressionAt() for the ready-to-call public method.
      void event.unitId;
    }
  }

  /**
   * Spawn a suppression ring at a known world position.
   * Called by the integration layer which resolves the unit's position.
   */
  spawnSuppressionAt(pos: Vec2): void {
    this.spawnEffect({
      effectType: 'suppression_ring',
      pos,
      posY: 0.3,
    });
  }

  /**
   * SMOKE_DEPLOYED -> sustained smoke_screen emitter.
   */
  private _onSmokeDeployed(event: SmokeDeployedEvent): void {
    // Start a sustained smoke screen emitter at the deployment point
    this._startEmitter(
      'smoke_screen',
      event.pos,
      0.5,
      4.0, // 4 particles per second
      event.durationSec,
    );

    // Also spawn an immediate burst of smoke to give instant visual feedback
    this.spawnEffect({
      effectType: 'smoke_puff',
      pos: event.pos,
      posY: 0.5,
      scale: 2.0,
    });
  }

  // =========================================================================
  // Additional public spawn helpers
  // =========================================================================

  /**
   * Spawn an artillery incoming indicator (contracting red ring).
   * Called when the server notifies of an incoming artillery shell.
   */
  spawnArtilleryIncoming(pos: Vec2, etaSeconds: number): void {
    this.spawnEffect({
      effectType: 'artillery_whistle',
      pos,
      posY: 0.3,
      scale: 1.0,
    });
  }

  /**
   * Spawn an illumination flare high above a position.
   */
  spawnIlluminationFlare(pos: Vec2): void {
    this.spawnEffect({
      effectType: 'illumination_flare',
      pos,
      posY: 80.0,  // spawn high above ground per VISUAL_EFFECTS.md
    });
  }

  /**
   * Spawn an orbital strike effect: cyan ring + large explosion + heavy shake.
   */
  spawnOrbitalStrike(pos: Vec2): void {
    // Expanding shockwave ring (cyan-white)
    this.spawnEffect({
      effectType: 'explosion_orbital',
      pos,
      posY: 0.5,
      scale: 2.0,
    });

    // Large explosion for the impact itself
    this.spawnEffect({
      effectType: 'explosion_large',
      pos,
      posY: 3.0,
      scale: 3.0,
    });

    // Massive debris shower
    this.spawnEffect({
      effectType: 'debris',
      pos,
      posY: 3.0,
      scale: 3.0,
    });

    // Dense smoke column emitter (8-12 seconds)
    this._startEmitter(
      'smoke_puff',
      pos,
      2.0,
      4.0,
      8 + Math.random() * 4,
    );

    // Heavy screen shake
    this.shakes.push({
      intensity: 1.5,
      decay: 2.0,
      remaining: 1.0,
    });

    // Full-screen flash
    this.flashOpacity = 0.8;
    this.flashDecayRate = 3.0;

    // Large crater decal
    this.addGroundDecal({
      decalId: `crater_orbital_${Date.now()}`,
      type: 'crater',
      posX: pos.x,
      posZ: pos.z,
      radius: 10 + Math.random() * 5,
      rotation: Math.random() * Math.PI * 2,
      opacity: 0.9,
      createdAt: Date.now(),
    });
  }

  /**
   * Spawn a rocket/missile trail from origin toward target.
   */
  spawnRocketTrail(fromPos: Vec2, toPos: Vec2): void {
    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    this.spawnEffect({
      effectType: 'rocket_trail',
      pos: fromPos,
      posY: 1.5,
      direction: { x: dx, z: dz },
    });
  }

  // =========================================================================
  // Internal: sustained emitter management
  // =========================================================================

  /**
   * Create and register a new sustained emitter.
   */
  private _startEmitter(
    type: EffectType,
    pos: Vec2,
    posY: number,
    emitRate: number,
    durationSec: number,
  ): void {
    const emitter: Emitter = {
      id: `emitter_${this.nextEmitterId++}`,
      type,
      pos: { x: pos.x, z: pos.z },
      posY,
      emitRate,
      remainingDuration: durationSec,
      accumulator: 0,
      active: true,
    };
    this.emitters.push(emitter);
  }

  /**
   * Tick all active emitters. Each accumulates fractional particle spawns
   * and emits when the accumulator crosses 1.0.
   */
  private _updateEmitters(dt: number): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const emitter = this.emitters[i];
      if (!emitter.active) {
        this.emitters.splice(i, 1);
        continue;
      }

      // Count down remaining duration
      emitter.remainingDuration -= dt;
      if (emitter.remainingDuration <= 0) {
        emitter.active = false;
        this.emitters.splice(i, 1);
        continue;
      }

      // LOD check: skip emission if the emitter is far from the camera
      const camX = this.camera.position.x;
      const camZ = this.camera.position.z;
      const distSq =
        (emitter.pos.x - camX) * (emitter.pos.x - camX) +
        (emitter.pos.z - camZ) * (emitter.pos.z - camZ);
      if (distSq > VFX_LOD_THRESHOLD * VFX_LOD_THRESHOLD) {
        // Beyond LOD threshold: reduce emit rate by 75%
        emitter.accumulator += emitter.emitRate * 0.25 * dt;
      } else {
        emitter.accumulator += emitter.emitRate * dt;
      }

      // Spawn particles as the accumulator permits
      while (emitter.accumulator >= 1.0) {
        emitter.accumulator -= 1.0;
        this.spawnEffect({
          effectType: emitter.type,
          pos: {
            x: emitter.pos.x + (Math.random() - 0.5) * 1.0,
            z: emitter.pos.z + (Math.random() - 0.5) * 1.0,
          },
          posY: emitter.posY,
          scale: 0.8 + Math.random() * 0.4,
        });
      }
    }
  }

  // =========================================================================
  // Internal: ground decal management
  // =========================================================================

  /**
   * Slowly fade old decals. Decals older than 120 seconds begin fading.
   * Track-type decals fade faster (30 seconds).
   */
  private _updateDecals(dt: number): void {
    const now = Date.now();

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const entry = this.decals[i];
      const ageSec = (now - entry.decal.createdAt) / 1000;
      const fadeStart = entry.decal.type === 'track' ? 30 : 120;
      const fadeDuration = entry.decal.type === 'track' ? 15 : 60;

      if (ageSec > fadeStart) {
        const fadeT = Math.min((ageSec - fadeStart) / fadeDuration, 1.0);
        const newOpacity = entry.decal.opacity * (1 - fadeT);
        (entry.mesh.material as THREE.MeshBasicMaterial).opacity = newOpacity;

        // Remove fully faded decals
        if (newOpacity < 0.01) {
          this.decalGroup.remove(entry.mesh);
          entry.mesh.geometry.dispose();
          (entry.mesh.material as THREE.Material).dispose();
          this.decals.splice(i, 1);
        }
      }
    }
  }

  // =========================================================================
  // Internal: screen shake
  // =========================================================================

  /**
   * Apply accumulated screen shake to the camera position.
   * Shake is computed as random XZ offset with exponential decay.
   * No Y shake to keep the tactical overhead view stable.
   */
  private _applyScreenShake(dt: number): void {
    // Restore camera to its base position from last frame's shake
    this.camera.position.x -= this.cameraBaseX;
    this.camera.position.z -= this.cameraBaseZ;
    this.cameraBaseX = 0;
    this.cameraBaseZ = 0;

    // Sum up all active shakes
    let totalOffsetX = 0;
    let totalOffsetZ = 0;

    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const shake = this.shakes[i];
      shake.remaining -= dt;

      if (shake.remaining <= 0) {
        this.shakes.splice(i, 1);
        continue;
      }

      // Exponential decay: intensity drops off as remaining decreases
      const envelope = shake.intensity * Math.exp(-shake.decay * (1 - shake.remaining));
      totalOffsetX += (Math.random() - 0.5) * 2 * envelope;
      totalOffsetZ += (Math.random() - 0.5) * 2 * envelope;
    }

    // Apply the combined offset
    this.cameraBaseX = totalOffsetX;
    this.cameraBaseZ = totalOffsetZ;
    this.camera.position.x += totalOffsetX;
    this.camera.position.z += totalOffsetZ;
  }

  // =========================================================================
  // Internal: impact flash
  // =========================================================================

  /**
   * Fade the full-screen additive flash toward zero.
   */
  private _updateFlash(dt: number): void {
    if (this.flashOpacity <= 0) return;

    this.flashOpacity -= this.flashDecayRate * dt;
    if (this.flashOpacity < 0) this.flashOpacity = 0;

    this._setFlashOpacity(this.flashOpacity);
  }

  /**
   * Set the flash mesh opacity (updating the Three.js material).
   */
  private _setFlashOpacity(opacity: number): void {
    const mat = this.flashMesh.material as THREE.MeshBasicMaterial;
    mat.opacity = opacity;
    this.flashMesh.visible = opacity > 0.001;
  }
}
