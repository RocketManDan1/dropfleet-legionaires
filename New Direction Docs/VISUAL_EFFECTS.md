# Visual Effects System
*Federation Legionaires — authoritative VFX specification*
*Last updated: 2026-03-22*

---

## 1. Overview

The VFX system renders combat events — explosions, gunfire, smoke, tracers,
debris — on top of the 3D terrain scene. All effects use **geometry and shader
math only**. No bitmap textures, no PBR materials, no volumetric rendering.
This is consistent with the DRONECOM aesthetic where everything is computed,
not photographed.

### 1.1 Design Principles

1. **Tactical readability first.** No effect may obscure unit NATO symbols,
   health bars, or contact tier indicators. Effects render *below* the UI
   overlay layer and auto-fade when a unit icon overlaps.

2. **DRONECOM palette.** Effects use the monochromatic gray terrain as
   contrast. The only chromatic colors permitted in effects are:
   - **Orange-white** `#FF8030`–`#FFFFFF` for fire and explosions (hot = bright)
   - **Gray-black** `#404040`–`#0A0A0A` for smoke and dust
   - **Yellow-green** `#CCFF44` for tracer rounds (not unit-green `#40C040`)
   - **Cyan-white** `#80FFD8` for orbital/energy strikes only (matches world rim)
   - **Dull red** `#802010` for sustained fires / burning wrecks

3. **Terminal display feel.** Effects should read as sensor returns on a
   command display, not cinematic renderings. Sharp edges, additive glow,
   fast fade. Think radar scope artifacts, not Michael Bay.

4. **Performance ceiling.** Max 512 concurrent particles across all effects.
   Total GPU time for effects ≤ 0.5 ms/frame. Total CPU update ≤ 0.3 ms/frame.

---

## 2. Architecture

### 2.1 Effect Manager

A singleton `EffectManager` owns all particle pools, manages spawn/update/
recycle, and integrates with the render loop.

```typescript
class EffectManager {
  private pools: Map<EffectType, ParticlePool>;
  private activeEffects: Effect[];

  constructor(scene: THREE.Scene) { ... }

  /** Called by combat event handler when server broadcasts a game event. */
  spawn(type: EffectType, params: EffectParams): void;

  /** Called every frame from the render loop, after camera update. */
  update(dt: number, camera: THREE.Camera): void;

  /** Remove all active effects (mission end / scene reset). */
  clear(): void;
}
```

### 2.2 Effect Types

```typescript
type EffectType =
  | 'muzzle_flash'
  | 'tracer'
  | 'impact_spark'
  | 'explosion_small'    // autocannon, RPG
  | 'explosion_medium'   // tank gun, mortar
  | 'explosion_large'    // artillery, bomb
  | 'explosion_orbital'  // kinetic rod
  | 'smoke_puff'         // single impact smoke
  | 'smoke_screen'       // deliberate smoke deployment
  | 'dust_cloud'         // movement dust, near-miss debris
  | 'fire_sustained'     // burning wreck
  | 'debris'             // scattered fragments
  | 'suppression_ring'   // visual feedback for suppression event
  | 'tracer_burst'       // multi-round burst (autocannon)
  | 'rocket_trail'       // missile/rocket flight path
  | 'illumination_flare' // illumination round
  | 'artillery_whistle'; // incoming indicator (audio cue + brief visual)
```

### 2.3 Render Order

```
1. Terrain (opaque)             ← existing
2. Water (transparent)          ← existing
3. Grid overlay                 ← existing
4. ▶ GROUND EFFECTS (craters, scorch marks, sustained fire)
5. ▶ PARTICLE EFFECTS (explosions, smoke, dust, debris)
6. ▶ LINE EFFECTS (tracers, rocket trails)
7. World-edge rim glow          ← existing
8. Unit NATO icons + UI         ← existing (always on top)
```

Effects at layers 4–6 use `depthWrite: false` and appropriate blending to
composite correctly against terrain without z-fighting.

---

## 3. Particle Pool System

### 3.1 Pool Structure

Each `EffectType` has a dedicated pool backed by a single `InstancedMesh` (for
billboard particles) or `InstancedBufferGeometry` (for line effects).

```typescript
interface ParticlePool {
  type: EffectType;
  mesh: THREE.InstancedMesh;
  maxCount: number;
  activeCount: number;
  particles: ParticleState[];
  freeList: number[];           // indices of available slots
}

interface ParticleState {
  alive: boolean;
  age: number;                  // seconds since spawn
  lifetime: number;             // total seconds before recycle
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  scale: number;
  scaleEnd: number;             // lerp target over lifetime
  opacity: number;
  opacityEnd: number;
  rotation: number;             // billboard rotation (radians)
  rotationSpeed: number;
}
```

### 3.2 Pool Budgets

| Pool | Max Particles | Geometry | Blending |
|------|--------------|----------|----------|
| `muzzle_flash` | 32 | Quad billboard | Additive |
| `tracer` | 64 | Stretched quad | Additive |
| `tracer_burst` | 48 | Stretched quad | Additive |
| `impact_spark` | 48 | Tiny quad | Additive |
| `explosion_small` | 32 | Quad billboard | Additive |
| `explosion_medium` | 24 | Quad billboard | Additive |
| `explosion_large` | 16 | Quad billboard | Additive |
| `explosion_orbital` | 4 | Quad billboard | Additive |
| `smoke_puff` | 48 | Quad billboard | Normal alpha |
| `smoke_screen` | 64 | Quad billboard | Normal alpha |
| `dust_cloud` | 48 | Quad billboard | Normal alpha |
| `fire_sustained` | 24 | Quad billboard | Additive |
| `debris` | 64 | Tiny cube instanced | Normal alpha |
| `suppression_ring` | 16 | Ring geometry | Additive |
| `rocket_trail` | 16 | Ribbon geometry | Additive |
| `illumination_flare` | 4 | Quad + point light | Additive |
| `artillery_whistle` | 8 | Expanding ring | Additive |
| **Total** | **560** | | |

560 max slots, but typical active count during a heavy firefight is 200–300.

### 3.3 Billboard Geometry

All billboard particles use a single reusable `PlaneGeometry(1, 1)` instance
matrix. The vertex shader handles camera-facing orientation:

```glsl
// Billboard vertex shader
uniform mat4 viewMatrix;

void main() {
  // Extract camera right and up from view matrix
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

  // Rotate billboard around view axis
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec3 right = camRight * c + camUp * s;
  vec3 up    = -camRight * s + camUp * c;

  vec3 worldPos = instancePosition + right * position.x * instanceScale
                                   + up * position.y * instanceScale;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
```

### 3.4 Procedural Sprite Shapes

Instead of texture atlases, particle shapes are generated in the fragment
shader using SDF (signed distance field) math:

```glsl
// Soft circle (smoke, dust, generic puff)
float softCircle(vec2 uv) {
  float d = length(uv - 0.5) * 2.0;
  return 1.0 - smoothstep(0.6, 1.0, d);
}

// Starburst (explosion flash, muzzle flash)
float starburst(vec2 uv, float rays, float sharpness) {
  vec2 centered = uv - 0.5;
  float angle = atan(centered.y, centered.x);
  float radius = length(centered) * 2.0;
  float ray = abs(sin(angle * rays)) * sharpness;
  float glow = 1.0 - smoothstep(0.0, 0.5 + ray * 0.3, radius);
  return glow;
}

// Ring (suppression pulse, artillery incoming)
float ring(vec2 uv, float innerRadius, float outerRadius) {
  float d = length(uv - 0.5) * 2.0;
  return smoothstep(innerRadius - 0.05, innerRadius, d)
       * (1.0 - smoothstep(outerRadius, outerRadius + 0.05, d));
}

// Streak (tracer, fast-moving particle)
float streak(vec2 uv, float width) {
  float dx = abs(uv.x - 0.5);
  float dy = abs(uv.y - 0.5) * 2.0;
  return (1.0 - smoothstep(0.0, width, dx)) * (1.0 - dy * dy);
}
```

### 3.5 Update Loop

```typescript
function updateParticles(pool: ParticlePool, dt: number): void {
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  for (let i = 0; i < pool.maxCount; i++) {
    const p = pool.particles[i];
    if (!p.alive) continue;

    p.age += dt;
    if (p.age >= p.lifetime) {
      p.alive = false;
      pool.freeList.push(i);
      pool.activeCount--;
      // Hide: scale to 0
      matrix.makeScale(0, 0, 0);
      pool.mesh.setMatrixAt(i, matrix);
      continue;
    }

    const t = p.age / p.lifetime;  // 0→1 normalized age

    // Physics
    p.posX += p.velX * dt;
    p.posY += p.velY * dt;
    p.posZ += p.velZ * dt;
    p.velY -= 9.81 * dt * 0.3;   // gentle gravity (effects, not physics sim)
    p.rotation += p.rotationSpeed * dt;

    // Interpolate scale and opacity
    const scale = THREE.MathUtils.lerp(p.scale, p.scaleEnd, t);
    const opacity = THREE.MathUtils.lerp(p.opacity, p.opacityEnd, t);

    // Write instance matrix
    matrix.makeTranslation(p.posX, p.posY, p.posZ);
    matrix.scale(new THREE.Vector3(scale, scale, scale));
    pool.mesh.setMatrixAt(i, matrix);

    // Write instance color (opacity baked into alpha via custom attribute)
    pool.mesh.setColorAt(i, color.setRGB(opacity, opacity, opacity));
  }

  pool.mesh.instanceMatrix.needsUpdate = true;
  if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
}
```

---

## 4. Effect Definitions

Each effect definition specifies how to spawn particles when a game event
arrives.

### 4.1 Muzzle Flash

**Trigger:** `SHOT_FIRED` event
**Source:** Firing unit position

```typescript
const MUZZLE_FLASH: EffectDef = {
  type: 'muzzle_flash',
  shape: 'starburst',
  count: 1,
  lifetime: [0.06, 0.10],        // 1–2 frames at 60fps
  scale: [1.5, 3.0],             // world units — varies by weapon caliber
  scaleEnd: [2.0, 4.0],
  opacity: [1.0, 1.0],
  opacityEnd: [0.0, 0.0],
  velocity: { x: 0, y: [0.5, 1], z: 0 },
  color: '#FFD080',               // warm white-orange
  blending: 'additive',
  rays: 6,                        // starburst ray count
};
```

**Caliber scaling:** `scale *= clamp(caliber / 60, 0.5, 3.0)`

Small arms (5.56mm): tiny flash, barely visible at RTS zoom.
Tank gun (120mm): prominent flash, 2× scale.
Artillery muzzle: not visible (off-map).

### 4.2 Tracers

**Trigger:** `SHOT_FIRED` event (only for projectiles with `tracer: true`)
**Source → Target:** Firer position to impact position

```typescript
const TRACER: EffectDef = {
  type: 'tracer',
  shape: 'streak',
  count: 1,
  lifetime: [0.15, 0.30],        // travel time (speed depends on range)
  scale: [0.3, 0.5],             // width
  scaleEnd: [0.2, 0.3],
  opacity: [1.0, 1.0],
  opacityEnd: [0.3, 0.5],
  color: '#CCFF44',               // yellow-green
  blending: 'additive',
  streakLength: 3.0,              // elongation along velocity vector
};
```

**Implementation:** The tracer spawns at firer position and lerps toward the
impact point over its lifetime. The streak geometry is oriented along the
velocity vector using `lookAt()`.

**Tracer burst (autocannon):** Spawns 3–5 tracers over 0.2s with slight
random spread (±2° cone) to simulate burst fire.

### 4.3 Impact Spark

**Trigger:** `SHOT_IMPACT` with `damageType: 'ricochet'` or `'partial_pen'`
**Source:** Target unit position

```typescript
const IMPACT_SPARK: EffectDef = {
  type: 'impact_spark',
  shape: 'starburst',
  count: [3, 6],
  lifetime: [0.08, 0.15],
  scale: [0.3, 0.8],
  scaleEnd: [0.1, 0.2],
  opacity: [1.0, 1.0],
  opacityEnd: [0.0, 0.0],
  velocity: { x: [-5, 5], y: [2, 8], z: [-5, 5] },
  color: '#FFCC40',               // bright orange-yellow
  blending: 'additive',
};
```

### 4.4 Explosions

**Trigger:** `SHOT_IMPACT` with `penetrated: true`, or `ARTY_IMPACT`, or
`UNIT_DESTROYED`

Three tiers tied to blast radius (from Combat Formula Spec §5):

#### 4.4.1 Small Explosion (blast radius ≤ 10m)

Autocannon hit, RPG impact, grenade.

```typescript
const EXPLOSION_SMALL: EffectDef = {
  type: 'explosion_small',
  shape: 'starburst',
  layers: [
    { // Core flash
      count: 1,
      lifetime: [0.08, 0.12],
      scale: [2.0, 3.0],
      scaleEnd: [4.0, 5.0],
      opacity: [1.0, 1.0],
      opacityEnd: [0.0, 0.0],
      color: '#FFFFFF',
      blending: 'additive',
    },
    { // Fireball
      count: [2, 3],
      lifetime: [0.2, 0.4],
      scale: [1.5, 2.5],
      scaleEnd: [3.0, 4.0],
      opacity: [0.9, 1.0],
      opacityEnd: [0.0, 0.0],
      velocity: { x: [-2, 2], y: [3, 6], z: [-2, 2] },
      color: '#FF8030',
      shape: 'softCircle',
      blending: 'additive',
    },
    { // Smoke aftermath
      count: [2, 4],
      lifetime: [0.8, 1.5],
      scale: [1.0, 2.0],
      scaleEnd: [4.0, 6.0],
      opacity: [0.6, 0.8],
      opacityEnd: [0.0, 0.0],
      velocity: { x: [-1, 1], y: [1, 3], z: [-1, 1] },
      color: '#404040',
      shape: 'softCircle',
      blending: 'normal',
    },
  ],
};
```

#### 4.4.2 Medium Explosion (blast radius 15–35m)

Tank gun, mortar, 105mm howitzer.

Same structure as small, scaled up:
- Core flash: scale ×2, lifetime +0.05s
- Fireball: count 4–6, scale ×2, velocity ×1.5
- Smoke: count 4–8, scale ×2, lifetime 1.5–3.0s
- **Debris:** 6–10 tiny cubes with ballistic velocity and gravity
- **Ground scorch:** persistent dark circle decal (see §6)

#### 4.4.3 Large Explosion (blast radius 50–90m)

155mm howitzer, carpet bomb, MLRS.

- Core flash: scale ×4, white→orange gradient
- Fireball: count 8–12, staggered spawn over 0.3s for rolling effect
- Smoke column: count 12–16, lifetime 4–8s, rise velocity 3–5 m/s
- Debris: 15–20 cubes with wide scatter (velocity 10–20 m/s)
- Ground scorch: large persistent decal
- **Screen shake:** camera position offset ±0.3 world units for 0.5s,
  exponential decay. Intensity scales with `1 / distance_to_camera`.

#### 4.4.4 Orbital Strike

Kinetic rod impact. Unique treatment:

- **Pre-impact:** Thin cyan line `#80FFD8` descends from sky (1.0s duration,
  additive, pulsing opacity)
- **Impact flash:** Full-screen white additive quad, 0.1s, sharp cutoff
- **Shockwave ring:** Expanding `ring` SDF, cyan→white, 0.5s, radius 0→30m
- **Crater smoke:** Dense dark column, 12–20 particles, lifetime 8–12s
- **Screen shake:** Strong (±1.0 unit, 1.0s decay)

### 4.5 Smoke

#### 4.5.1 Impact Smoke Puff

Brief smoke from any HE hit. Already included in explosion layers above.

#### 4.5.2 Deliberate Smoke Screen

**Trigger:** `SMOKE_CREATED` event (artillery smoke mission or smoke grenade)
**Duration:** Matches server `durationSec` (typically 60s)

```typescript
const SMOKE_SCREEN: EffectDef = {
  type: 'smoke_screen',
  shape: 'softCircle',
  // Continuous emitter — spawns particles over duration, not all at once
  emitRate: 4,                    // particles per second
  emitDuration: 'event.durationSec',
  lifetime: [3.0, 5.0],          // each particle's lifespan
  scale: [5.0, 8.0],
  scaleEnd: [12.0, 18.0],
  opacity: [0.5, 0.7],
  opacityEnd: [0.0, 0.0],
  velocity: { x: [-0.5, 0.5], y: [0.3, 0.8], z: [-0.5, 0.5] },
  color: '#606060',               // neutral mid-gray
  blending: 'normal',
  // Smoke drifts with a gentle lateral wind
  windX: 0.3,
  windZ: 0.1,
};
```

The smoke screen occupies the area defined by the server event. Multiple
sources at the same location increase visual density but the particle count
is capped — extra sources reuse the same pool slots.

#### 4.5.3 Burning Wreck Smoke

**Trigger:** `UNIT_DESTROYED` event
**Duration:** 30–60 seconds

Dark smoke column rising from destroyed unit position. Uses `smoke_puff` pool
with a slow continuous emitter (2 particles/sec) and long lifetime (5–8s per
particle, rising 2–3 m/s).

### 4.6 Dust Cloud

**Trigger:** `SHOT_IMPACT` with `damageType: 'miss'` (near-miss kicking up dirt)
**Also:** Unit movement on dry terrain (Road, Sand, Open, Rough, Pavement)

```typescript
const DUST_CLOUD: EffectDef = {
  type: 'dust_cloud',
  shape: 'softCircle',
  count: [3, 5],
  lifetime: [0.5, 1.2],
  scale: [1.0, 2.0],
  scaleEnd: [3.0, 5.0],
  opacity: [0.4, 0.6],
  opacityEnd: [0.0, 0.0],
  velocity: { x: [-2, 2], y: [0.5, 2], z: [-2, 2] },
  blending: 'normal',
};
```

**Terrain-tinted color:**

| Terrain | Dust Color |
|---------|-----------|
| Road, Pavement | `#707060` (gray-tan) |
| Sand, Beach | `#908060` (sandy gray) |
| Open, Rough, Rock | `#605850` (brown-gray) |
| Mud, Swamp, Marsh | `#403830` (dark brown) |
| Snow, Ice | `#C0C0C0` (light gray) |
| Urban, Industrial | `#808080` (concrete gray) |

### 4.7 Debris

**Trigger:** `SHOT_IMPACT` with `penetrated: true`, `UNIT_DESTROYED`,
large explosions

```typescript
const DEBRIS: EffectDef = {
  type: 'debris',
  geometry: 'cube',               // tiny instanced cubes (0.1–0.3 world units)
  count: [4, 12],                 // more for bigger explosions
  lifetime: [0.5, 1.5],
  scale: [0.1, 0.3],
  scaleEnd: [0.05, 0.15],
  opacity: [1.0, 1.0],
  opacityEnd: [0.3, 0.5],
  velocity: { x: [-8, 8], y: [5, 15], z: [-8, 8] },
  gravity: 9.81,                  // full gravity for ballistic arcs
  color: '#303030',               // dark gray (metallic debris)
  blending: 'normal',
  // Spin
  rotationSpeed: [5, 15],         // radians/sec
};
```

### 4.8 Suppression Ring

**Trigger:** Suppression event (near-miss, blast within radius)
**Purpose:** Visual feedback that a unit is taking suppressive fire

```typescript
const SUPPRESSION_RING: EffectDef = {
  type: 'suppression_ring',
  shape: 'ring',
  count: 1,
  lifetime: [0.3, 0.5],
  scale: [0.5, 0.5],             // starts small
  scaleEnd: [3.0, 4.0],          // expands outward
  opacity: [0.6, 0.8],
  opacityEnd: [0.0, 0.0],
  color: '#FF4020',               // hostile red, matching faction color
  blending: 'additive',
  innerRadius: 0.7,
  outerRadius: 0.9,
};
```

Appears as a brief expanding red ring around the suppressed unit. Subtle but
readable at RTS zoom — communicates "this unit is under fire" without words.

### 4.9 Rocket / Missile Trail

**Trigger:** `SHOT_FIRED` with weapon type ATGM, SAM, or rocket
**Source → Target:** Firer to impact, with optional arc

```typescript
const ROCKET_TRAIL: EffectDef = {
  type: 'rocket_trail',
  geometry: 'ribbon',             // trail mesh appended per frame
  lifetime: [1.0, 3.0],          // flight time
  trailWidth: 0.3,
  trailFadeTime: 1.5,            // trail persists after impact
  headColor: '#FF8030',          // bright orange tip
  trailColor: '#808080',         // gray smoke trail
  headBlending: 'additive',
  trailBlending: 'normal',
  trailOpacity: 0.4,
  // Arc parameters (for indirect-fire missiles)
  arcHeight: 'caliber < 100 ? 0 : blastRadius * 0.5',
};
```

**Ribbon implementation:** Each frame, append a new vertex pair at the
projectile's current position. The ribbon fades from head (full opacity) to
tail (zero). Old vertices are discarded when their age exceeds `trailFadeTime`.

```typescript
interface RibbonTrail {
  positions: Float32Array;  // ring buffer of vec3 pairs (left/right edge)
  ages: Float32Array;       // age of each segment
  head: number;             // write cursor
  maxSegments: number;      // typically 64
}
```

### 4.10 Illumination Flare

**Trigger:** `ARTY_IMPACT` with mission type `illumination`
**Duration:** 45 seconds (matches server illumination duration)

```typescript
const ILLUMINATION_FLARE: EffectDef = {
  type: 'illumination_flare',
  shape: 'softCircle',
  count: 1,
  lifetime: 45,
  scale: [1.0, 1.5],
  scaleEnd: [0.5, 0.8],          // shrinks as it burns out
  opacity: [1.0, 1.0],
  opacityEnd: [0.0, 0.0],
  color: '#FFFFCC',               // warm white-yellow
  blending: 'additive',
  // Position: high above impact point, slow descent
  spawnHeight: 80,                // world units above ground
  descentRate: 1.5,               // m/s
  // Optional: adds a subtle THREE.PointLight to brighten terrain below
  pointLight: {
    color: '#FFFFCC',
    intensity: 0.4,
    distance: 200,                // light radius in world units
    decay: 2,
  },
  // Swing: gentle pendulum sway as it descends
  swayAmplitude: 2.0,
  swayFrequency: 0.3,
};
```

Max 4 concurrent flares (pool limit). If a 5th is requested, the oldest is
recycled.

### 4.11 Artillery Incoming Indicator

**Trigger:** Artillery shell inbound (server sends impact position + ETA)
**Duration:** 1–2 seconds before impact

```typescript
const ARTILLERY_WHISTLE: EffectDef = {
  type: 'artillery_whistle',
  shape: 'ring',
  count: 1,
  lifetime: [1.0, 2.0],          // countdown to impact
  scale: [8.0, 12.0],            // starts wide
  scaleEnd: [0.5, 1.0],          // contracts to impact point
  opacity: [0.3, 0.4],
  opacityEnd: [0.8, 1.0],        // gets brighter as it closes
  color: '#FF4020',               // danger red
  blending: 'additive',
  innerRadius: 0.85,
  outerRadius: 1.0,
  // Pulse
  pulseFrequency: 4.0,           // Hz — ring flickers
};
```

Appears as a contracting red ring at the impact zone. Gives the player a
brief warning to move units out, matching the server's artillery delay timer.

---

## 5. Sustained / Looping Effects

Some effects persist beyond a single burst. These use continuous emitters
rather than one-shot spawns.

### 5.1 Emitter Interface

```typescript
interface Emitter {
  id: string;
  type: EffectType;
  posX: number;
  posY: number;
  posZ: number;
  emitRate: number;               // particles per second
  remainingDuration: number;      // seconds until auto-stop (-1 = manual stop)
  accumulator: number;            // fractional particle carry between frames
  active: boolean;
}
```

### 5.2 Active Emitters

| Effect | Rate | Duration | Notes |
|--------|------|----------|-------|
| Smoke screen | 4/s | 60s | Server-controlled duration |
| Burning wreck | 2/s | 30–60s | Starts on `UNIT_DESTROYED` |
| Sustained fire (wreck) | 1/s | 20–40s | Orange glow particles under smoke |
| Movement dust | 1/s | While moving | Only on dry terrain types |
| Illumination descent | — | 45s | Single particle, repositioned each frame |

### 5.3 Emitter Update

```typescript
function updateEmitters(
  emitters: Emitter[],
  effectManager: EffectManager,
  dt: number
): void {
  for (const emitter of emitters) {
    if (!emitter.active) continue;

    emitter.remainingDuration -= dt;
    if (emitter.remainingDuration <= 0 && emitter.remainingDuration !== -1) {
      emitter.active = false;
      continue;
    }

    emitter.accumulator += emitter.emitRate * dt;
    while (emitter.accumulator >= 1.0) {
      emitter.accumulator -= 1.0;
      effectManager.spawn(emitter.type, {
        x: emitter.posX,
        y: emitter.posY,
        z: emitter.posZ,
      });
    }
  }
}
```

---

## 6. Ground Decals

Persistent marks on the terrain surface that last for the remainder of the
mission. These are NOT particles — they are flat quads projected onto the
terrain.

### 6.1 Decal Types

| Decal | Trigger | Size | Color | Lifetime |
|-------|---------|------|-------|----------|
| Scorch mark | Medium/large explosion | 3–10m radius | `#1A1A1A` (near-black) | Mission duration |
| Crater rim | Large explosion | 5–15m radius | `#252525` ring | Mission duration |
| Burning patch | `UNIT_DESTROYED` | 2–4m | `#802010` (dull red) | 30–60s, then → scorch |

### 6.2 Decal Implementation

```typescript
interface GroundDecal {
  id: string;
  type: 'scorch' | 'crater' | 'burn';
  posX: number;
  posZ: number;
  radius: number;
  opacity: number;
  fadeStartTime: number;          // -1 = never fade
  mesh: THREE.Mesh;               // flat disc geometry, depth-biased
}
```

Decals use a simple `PlaneGeometry` positioned at terrain height + 0.05 (tiny
offset to prevent z-fighting). Material: `MeshBasicMaterial` with
`depthWrite: false`, `transparent: true`, `polygonOffset: true`.

The fragment shader draws a soft circle:

```glsl
varying vec2 vUv;
uniform float uOpacity;
uniform vec3 uColor;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  float alpha = (1.0 - smoothstep(0.7, 1.0, d)) * uOpacity;
  gl_FragColor = vec4(uColor, alpha);
}
```

### 6.3 Decal Budget

Max 64 ground decals. When the cap is reached, the oldest decal is recycled.
At typical mission pace (30–40 minutes), this accommodates roughly 1 decal
per 30 seconds of combat, which is more than enough for all but the most
intense exchanges.

---

## 7. Screen Effects

Post-processing effects that apply to the entire frame. These overlay the
final render, not the 3D scene.

### 7.1 Screen Shake

**Trigger:** Large explosions near camera

```typescript
interface ScreenShake {
  intensity: number;    // max offset in world units
  decay: number;        // exponential decay constant
  remaining: number;    // seconds
}

function applyScreenShake(
  camera: THREE.Camera,
  shake: ScreenShake,
  dt: number
): void {
  if (shake.remaining <= 0) return;

  shake.remaining -= dt;
  const t = shake.remaining * shake.decay;
  const offset = shake.intensity * Math.exp(-t);

  camera.position.x += (Math.random() - 0.5) * offset * 2;
  camera.position.z += (Math.random() - 0.5) * offset * 2;
  // No Y shake — keeps the tactical view stable
}
```

**Intensity by source:**

| Source | Intensity | Duration | Max Range |
|--------|-----------|----------|-----------|
| Small explosion | 0.1 | 0.2s | 100m |
| Medium explosion | 0.3 | 0.4s | 200m |
| Large explosion | 0.6 | 0.6s | 500m |
| Orbital strike | 1.5 | 1.0s | Entire map |

Shake intensity fades with distance: `intensity *= 1 - clamp(dist / maxRange, 0, 1)`

### 7.2 Impact Flash

**Trigger:** `UNIT_DESTROYED` or orbital strike
**Implementation:** Brief white additive full-screen quad

```typescript
interface ImpactFlash {
  opacity: number;     // starts at 0.3–0.8 depending on source
  decayRate: number;   // opacity per second (typically 4.0 = gone in 0.1s)
}
```

Subtle for unit destruction (0.3 opacity, fast). Dramatic for orbital
strike (0.8 opacity, slightly slower decay). Renders as a full-viewport
`PlaneGeometry` in screen space with additive blending.

---

## 8. Event → Effect Mapping

Complete mapping from server game events to visual effects:

### 8.1 `SHOT_FIRED`

```typescript
function onShotFired(event: ShotFiredEvent): void {
  const firer = getUnit(event.firerId);
  const weapon = firer.weapons[event.weaponSlot];

  // Muzzle flash at firer position
  effects.spawn('muzzle_flash', {
    x: firer.posX, y: firer.posY + 1.0, z: firer.posZ,
    scale: clamp(weapon.caliber / 60, 0.5, 3.0),
  });

  // Tracer (if applicable)
  if (weapon.tracerRounds) {
    const target = getUnit(event.targetId);
    effects.spawn('tracer', {
      startX: firer.posX, startY: firer.posY + 1.0, startZ: firer.posZ,
      endX: target.posX, endY: target.posY + 0.5, endZ: target.posZ,
      flightTime: distanceBetween(firer, target) / weapon.muzzleVelocity,
    });
  }

  // Autocannon burst
  if (weapon.burstSize > 1) {
    for (let i = 1; i < weapon.burstSize; i++) {
      effects.spawnDelayed('tracer', 0.04 * i, {
        startX: firer.posX, startY: firer.posY + 1.0, startZ: firer.posZ,
        endX: target.posX + (Math.random() - 0.5) * 2,
        endY: target.posY + 0.5,
        endZ: target.posZ + (Math.random() - 0.5) * 2,
        flightTime: distanceBetween(firer, target) / weapon.muzzleVelocity,
      });
    }
  }
}
```

### 8.2 `SHOT_IMPACT`

```typescript
function onShotImpact(event: ShotImpactEvent): void {
  const target = getUnit(event.targetId);
  const pos = { x: target.posX, y: target.posY, z: target.posZ };

  switch (event.damageType) {
    case 'penetration':
      effects.spawn('explosion_small', pos);
      effects.spawn('debris', { ...pos, count: 6 });
      break;

    case 'partial_pen':
      effects.spawn('impact_spark', pos);
      effects.spawn('debris', { ...pos, count: 3 });
      break;

    case 'ricochet':
      effects.spawn('impact_spark', pos);
      break;

    case 'miss':
      effects.spawn('dust_cloud', {
        ...pos, terrainType: getTerrainAt(pos.x, pos.z),
      });
      break;

    case 'suppression_only':
      effects.spawn('dust_cloud', pos);
      effects.spawn('suppression_ring', pos);
      break;
  }
}
```

### 8.3 `UNIT_DESTROYED`

```typescript
function onUnitDestroyed(event: UnitDestroyedEvent): void {
  const unit = getUnit(event.unitId);
  const pos = { x: unit.posX, y: unit.posY, z: unit.posZ };

  // Destruction explosion (size based on unit category)
  const size = unit.category === 'vehicle' ? 'explosion_medium' : 'explosion_small';
  effects.spawn(size, pos);
  effects.spawn('debris', { ...pos, count: unit.category === 'vehicle' ? 12 : 4 });

  // Sustained burning wreck
  effects.startEmitter('fire_sustained', pos, { rate: 1, duration: 30 });
  effects.startEmitter('smoke_puff', pos, { rate: 2, duration: 45 });

  // Ground scorch decal
  effects.addDecal('scorch', pos, { radius: unit.category === 'vehicle' ? 4 : 2 });

  // Screen effects
  const dist = distanceToCamera(pos);
  if (dist < 200) {
    effects.screenShake(0.3, 0.4);
  }
  if (dist < 100) {
    effects.impactFlash(0.2);
  }
}
```

### 8.4 `ARTY_IMPACT`

```typescript
function onArtyImpact(event: ArtyImpactEvent): void {
  const pos = { x: event.posX, y: getTerrainHeight(event.posX, event.posZ), z: event.posZ };
  const radius = event.blastRadius;

  // Select explosion tier
  if (radius <= 15) {
    effects.spawn('explosion_small', pos);
  } else if (radius <= 50) {
    effects.spawn('explosion_medium', pos);
    effects.addDecal('crater', pos, { radius: radius * 0.3 });
  } else {
    effects.spawn('explosion_large', pos);
    effects.addDecal('crater', pos, { radius: radius * 0.3 });
    effects.screenShake(0.6, 0.6);
    effects.impactFlash(0.3);
  }

  effects.spawn('debris', { ...pos, count: Math.min(radius / 5, 15) });
}
```

### 8.5 `SMOKE_CREATED`

```typescript
function onSmokeCreated(event: SmokeCreatedEvent): void {
  effects.startEmitter('smoke_screen', {
    x: event.posX,
    y: getTerrainHeight(event.posX, event.posZ),
    z: event.posZ,
  }, {
    rate: 4,
    duration: event.durationSec,
  });
}
```

### 8.6 `AIR_STRIKE`

```typescript
function onAirStrike(event: AirStrikeEvent): void {
  // Strafing run: chain of small explosions along the attack vector
  const stepCount = 8;
  for (let i = 0; i < stepCount; i++) {
    const t = i / (stepCount - 1);
    const x = lerp(event.startX, event.endX, t);
    const z = lerp(event.startZ, event.endZ, t);
    const delay = i * 0.15;  // 0.15s spacing between impacts

    effects.spawnDelayed('explosion_medium', delay, {
      x, y: getTerrainHeight(x, z), z,
    });
    effects.spawnDelayed('debris', delay, {
      x, y: getTerrainHeight(x, z), z, count: 6,
    });
  }

  effects.screenShake(0.5, 0.8);
}
```

---

## 9. Terrain-Contextual Effects

Effects respond to the terrain type at their spawn location.

### 9.1 Movement Dust

Units in motion on dry terrain emit low-rate dust. This is a continuous
emitter attached to the unit, not triggered by a game event.

```typescript
const DUSTY_TERRAIN = new Set([
  'Road', 'Pavement', 'Sand', 'Open', 'Rough', 'Rock', 'Beach',
]);

function updateMovementDust(unit: ClientUnit, terrainType: string): void {
  if (!DUSTY_TERRAIN.has(terrainType) || unit.speedState === 'full_halt') {
    effects.stopEmitter(`dust-${unit.id}`);
    return;
  }

  effects.ensureEmitter(`dust-${unit.id}`, 'dust_cloud', {
    x: unit.posX, y: unit.posY, z: unit.posZ,
    rate: unit.speedState === 'advance' ? 0.5 : 1.0,
    duration: -1,  // manual stop
    terrainTint: DUST_COLORS[terrainType],
  });
}
```

### 9.2 Water Splash

Explosions or impacts on ShallowWater or near water edges spawn splash
particles instead of dust:

```typescript
const WATER_SPLASH: EffectDef = {
  type: 'dust_cloud',               // reuses dust pool
  shape: 'softCircle',
  count: [4, 8],
  lifetime: [0.4, 0.8],
  scale: [1.0, 2.0],
  scaleEnd: [3.0, 5.0],
  opacity: [0.5, 0.7],
  opacityEnd: [0.0, 0.0],
  velocity: { x: [-3, 3], y: [4, 8], z: [-3, 3] },
  color: '#8090A0',                  // blue-gray
  blending: 'normal',
};
```

### 9.3 Snow Puff

Impacts on Snow or Ice terrain use white-gray particles instead of brown dust.

### 9.4 Urban Rubble

Explosions in Urban or Industrial terrain spawn additional concrete-gray
debris cubes and a denser dust cloud (`#808080`).

---

## 10. Performance Budget

### 10.1 Per-Frame Costs

| Component | Budget | Notes |
|-----------|--------|-------|
| Particle update (CPU) | ≤ 0.3 ms | 512 particles, simple lerp + gravity |
| Instance matrix upload | ≤ 0.1 ms | One `needsUpdate` per pool |
| Particle draw calls | ≤ 0.3 ms GPU | 1 draw call per pool (instanced) |
| Ground decals | ≤ 0.1 ms GPU | 64 flat quads, depth-biased |
| Screen effects | ≤ 0.05 ms | Full-screen quad, trivial shader |
| **Total VFX** | **≤ 0.85 ms/frame** | At 60 fps = ~5% of frame budget |

### 10.2 Particle Count Limits

| Scenario | Expected Active Particles |
|----------|-------------------------|
| Idle (no combat) | 0–10 (movement dust) |
| Light skirmish | 30–80 |
| Heavy firefight | 150–250 |
| Artillery barrage | 300–400 |
| Absolute max (all pools full) | 560 |

### 10.3 LOD Strategy

At extreme zoom-out (camera distance > 200 units), reduce particle counts by
50% (every other spawn is skipped). Muzzle flashes and impact sparks are
dropped entirely — at that distance they're subpixel. Explosions and smoke
remain visible.

### 10.4 Draw Call Budget

Each particle pool = 1 instanced draw call. With 17 pools, that's 17 draw
calls for particles + up to 64 for decals (though decals could be batched
into 1 instanced call). Target: ≤ 20 total VFX draw calls.

---

## 11. Integration Points

### 11.1 Client Architecture

```
GameConnection (WebSocket)
  └── onGameEvent(event)
        └── EffectManager.handleEvent(event)
              ├── maps event → effect spawns (§8)
              ├── terrain lookup for context (§9)
              └── screen effects (§7)

RenderLoop
  └── animate()
        ├── cameraController.update(dt)
        ├── effectManager.update(dt, camera)  ← NEW
        ├── emitterManager.update(dt)         ← NEW
        └── renderer.render(scene, camera)
```

### 11.2 Server Events Required

The VFX system is purely client-side. It requires NO server changes beyond the
game events already defined in SERVER_GAME_LOOP.md:

| Event | Already Defined | Extra Fields Needed |
|-------|----------------|-------------------|
| `SHOT_FIRED` | Yes | None (firer/target/slot sufficient) |
| `SHOT_IMPACT` | Yes | `damageType` field (add if missing) |
| `UNIT_DESTROYED` | Yes | None |
| `ARTY_IMPACT` | Yes | `blastRadius` already included |
| `SMOKE_CREATED` | Yes | `durationSec` already included |
| `AIR_STRIKE` | Yes | Add `startX/Z, endX/Z` for strafing line |

### 11.3 Cleanup

On mission end or scene reset, `effectManager.clear()` recycles all particles,
stops all emitters, and removes all decals. Pool meshes remain in the scene
graph (hidden at scale 0) for reuse in the next mission.

---

## 12. Canonical Types

```typescript
type EffectType =
  | 'muzzle_flash' | 'tracer' | 'tracer_burst'
  | 'impact_spark' | 'explosion_small' | 'explosion_medium'
  | 'explosion_large' | 'explosion_orbital'
  | 'smoke_puff' | 'smoke_screen' | 'dust_cloud'
  | 'fire_sustained' | 'debris' | 'suppression_ring'
  | 'rocket_trail' | 'illumination_flare' | 'artillery_whistle';

type ParticleShape = 'softCircle' | 'starburst' | 'ring' | 'streak';

type DecalType = 'scorch' | 'crater' | 'burn';

type BlendMode = 'additive' | 'normal';

interface ParticleState {
  alive: boolean;
  age: number;
  lifetime: number;
  posX: number; posY: number; posZ: number;
  velX: number; velY: number; velZ: number;
  scale: number; scaleEnd: number;
  opacity: number; opacityEnd: number;
  rotation: number; rotationSpeed: number;
}

interface ParticlePool {
  type: EffectType;
  mesh: THREE.InstancedMesh;
  maxCount: number;
  activeCount: number;
  particles: ParticleState[];
  freeList: number[];
}

interface Emitter {
  id: string;
  type: EffectType;
  posX: number; posY: number; posZ: number;
  emitRate: number;
  remainingDuration: number;
  accumulator: number;
  active: boolean;
}

interface GroundDecal {
  id: string;
  type: DecalType;
  posX: number; posZ: number;
  radius: number;
  opacity: number;
  fadeStartTime: number;
  mesh: THREE.Mesh;
}

interface ScreenShake {
  intensity: number;
  decay: number;
  remaining: number;
}
```

---

## 13. Design Rationale

1. **Procedural over textured.** SDF fragment shaders generate every particle
   shape. This means zero texture loading, zero atlas management, and the
   particles scale perfectly at any camera distance. It also matches the
   DRONECOM philosophy: everything is computed.

2. **Instanced over individual.** Each particle type is one `InstancedMesh`
   with one draw call. 512 particles across 17 pools = 17 draw calls total.
   A naive approach (one mesh per particle) would be 512 draw calls — an
   order of magnitude more expensive.

3. **Additive blending for energy, normal for mass.** Fire, tracers, and
   flashes glow brighter when overlapping (additive). Smoke and dust
   occlude what's behind them (normal alpha). This two-mode split handles
   every visual case without custom blending equations.

4. **Ground decals as persistent memory.** Scorch marks and craters
   accumulate over the mission, telling a story of where the fighting was
   heaviest. This is cheap (flat quads, no particles) and adds enormous
   atmospheric value to late-mission scenes.

5. **Terrain-aware effects.** Sand → sandy dust. Concrete → gray debris.
   Water → splash. Snow → white puff. These contextual touches make the
   battlefield feel coherent without adding any gameplay complexity.

6. **Effects never lie.** Every visual effect is triggered by a real server
   event. There are no cosmetic-only animations. If you see an explosion,
   something was hit. If you see a tracer, a weapon fired. This maintains
   the tactical integrity of the display.
