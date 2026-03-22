# Authoritative Contracts
*Federation Legionaires -- cross-document canonical contract sheet*
*Last updated: 2026-03-22*

---

## Purpose

This document defines the shared contracts that must remain identical across specs.
If another document conflicts with this file, treat this file as authoritative and
update the conflicting doc in the same change.

---

## 1. Mission Taxonomy

### 1.1 MissionType

```typescript
type MissionType =
  | 'defend'
  | 'seize'
  | 'raid'
  | 'patrol'
  | 'rescue'
  | 'breakthrough'
  | 'evacuation'
  | 'hive_clear'
  | 'fortification_assault'
  | 'logistics';
```

Deprecated names (`assault`, `ambush`, `extraction`, `supply_raid`, `emergency_defense`) are migration-only aliases and must not appear in runtime contracts.

### 1.2 DifficultyTier

```typescript
type DifficultyTier = 'easy' | 'medium' | 'hard';
```

Numeric `difficultyRating` is not part of mission runtime/persistence contracts.

---

## 2. Mission Phases and Wire Mapping

### 2.1 Internal lifecycle phases

```typescript
type MissionPhaseInternal =
  | 'created'
  | 'deployment'
  | 'live'
  | 'extraction'
  | 'aar'
  | 'closed';
```

### 2.2 Wire protocol phases

```typescript
type MissionPhaseWire =
  | 'briefing'
  | 'deployment'
  | 'live'
  | 'extraction'
  | 'ended';
```

### 2.3 Required mapping

| Internal | Wire |
|---|---|
| `created` | `briefing` |
| `deployment` | `deployment` |
| `live` | `live` |
| `extraction` | `extraction` |
| `aar` | `ended` |
| `closed` | `ended` |

---

## 3. Joinability and Matchmaking

A mission is joinable only when:
- phase is `deployment` or `live`
- player count is `< 4`

`created`, `extraction`, `aar`, and `closed` are never joinable.

---

## 4. Disconnect and Tick Behavior

### 4.1 Disconnect grace

```typescript
const DISCONNECT_GRACE_TICKS = 6000; // 5 minutes at 20 Hz
```

During grace:
- disconnected player units are frozen and invincible
- mission loop continues running for connected players
- if all players are disconnected, mission clock still advances

When a player's grace expires with no reconnect:
- that player's frozen units are removed from map
- those removals do not count as casualties

When all grace timers expire with no reconnect:
- mission ends as DEFEAT (all-disconnect)

### 4.2 Loop state rule

All-disconnect does not auto-transition to a paused frozen simulation mode.
`PAUSED` is reserved for explicit operator/admin pause behavior.

---

## 5. Time and Snapshot Constants

```typescript
const TICK_RATE_HZ = 20;
const TICK_MS = 50;
const SNAPSHOT_INTERVAL_SEC = 60;
```

Deployment and late-join timers are scenario/lifecycle values and do not override
these engine constants.

---

## 6. Terrain/Grid Authority Model

Combat simulation authority:
- movement and LOS are authoritative in continuous world-space on terrain/nav data

Overlay authority:
- logical grid cells (historically called "hex") are for deployment validation,
  UI references, and coarse indexing
- overlay geometry may be square or hex without changing combat semantics

---

## 7. Air/Theater Delay Contract

Air and artillery delays are strike-type dependent per THEATER_SUPPORT.md.
Do not use a fixed global 90-second delay constant.

---

## 8. Pathfinding Contracts

Authoritative pathfinding specification: `PATHFINDING.md`.

### 8.1 Algorithm

Weighted A* (`ε = 1.2`) on an 8-connected cost grid derived from the terrain
heightmap. One `CostGrid` (Float32Array, row-major) per `MoveClass`.

### 8.2 Canonical Types

```typescript
interface Vec2 { x: number; z: number; }
type MoveClass = 'track' | 'wheel' | 'leg' | 'hover' | 'air';
type SpeedState = 'full_halt' | 'short_halt' | 'slow' | 'fast';
type MoveMode = 'advance' | 'march' | 'reverse';
```

### 8.3 Impassable Threshold

```typescript
const IMPASSABLE_THRESHOLD = 90;
```

Any cell with cost ≥ 90 is a wall. Terrain type cost 99 + slope multiplication
both use this gate.

### 8.4 Movement Integration

Runs every tick (20 Hz). Speed formula:

```
effectiveSpeed = (maxSpeedM / 300) × modeMultiplier / cellCost
```

Where `modeMultiplier` is 1.0 (march), 0.5 (advance), or 0.33 (reverse).

### 8.5 Waypoint Queue

Max **4** queued waypoints per unit. New order without shift clears the queue.

### 8.6 Performance Caps

| Metric | Limit |
|--------|-------|
| A* early-termination | 50,000 open-list nodes |
| Max staggered search window | 3 ticks (150 ms) |

---

## 9. Spotting and LOS Contracts

Authoritative specs: `Spotting and Contact Model.md` (detection system),
`LOS_RAYCASTING.md` (raycast algorithm).

### 9.1 Detection Constants

```typescript
const BASE_ACCUMULATION_RATE = 10;  // points per second
const DECAY_RATE_PER_SEC = 8;
```

### 9.2 Contact Tiers

| Tier | Detection Value | Fire Permission |
|------|----------------|-----------------|
| SUSPECTED | 1–24 | Indirect fire only (2× CEP) |
| DETECTED | 25–74 | Direct + indirect fire |
| CONFIRMED | 75–100 | Direct + indirect fire |
| LOST | 0 (was ≥ 1) | No fire; 60s display fade |

### 9.3 Sensor Tiers

```typescript
type SensorTier = 'optical' | 'thermal' | 'radar';
// optical:  visionM < 2000
// thermal:  visionM 2000–2499
// radar:    visionM ≥ 2500
```

### 9.4 LOS Reduction Rules (range multipliers)

| Obstruction | Optical | Thermal | Radar |
|-------------|---------|---------|-------|
| Forest / Jungle cell | × 0.30 | × 0.50 | unaffected |
| Orchard / Crops / HighGrass cell | × 0.50 | × 0.70 | unaffected |
| Smoke source (per source) | × 0.30 | × 0.70 | unaffected |
| 3+ smoke sources | **blocked** | **blocked** | unaffected |

Woodland/cover counts once regardless of depth (1 cell = same penalty as 5).
Smoke stacks multiplicatively per source.

### 9.5 Multi-Observer Rule

Each observer maintains an independent accumulator per target. The shared
contact tier equals the **highest** single observer's value. Rates do not pool.

### 9.6 LOS Algorithm

Bresenham grid walk on the terrain heightmap. Bilinear-interpolated elevation.
Full block: terrain ridge, Urban, Industrial. Partial: woodland, smoke.

### 9.7 Update Frequency

LOS/spotting runs once per second (every 20 ticks), not every tick.

### 9.8 Performance Caps

| Metric | Limit |
|--------|-------|
| Total spotting phase per second | ≤ 18 ms |
| Max raycasts per second (200 × 30 nearby) | 6000 |
| Spatial hash cell size | 500 m |

---

## 10. Enemy AI Contracts

*Source: ENEMY_AI.md*

### 10.1 Architecture

3-layer: Strategic (Utility + Influence Maps, every 5 s) → Platoon (Behavior Trees, every 1–2 s) → Unit (existing fire posture, every tick).

### 10.2 Canonical Types

```typescript
type Faction = 'ataxian' | 'khroshi';
type PlatoonIntent = 'attack' | 'defend' | 'reinforce' | 'retreat' | 'patrol';
```

### 10.3 Influence Maps

Two `Float32Array` grids at cost-grid resolution: `threat` and `control`.
Updated every 5 seconds. Linear falloff kernels.

### 10.4 Faction Weight Constants

| Weight | Ataxian | Khroshi |
|--------|---------|---------|
| `retreatThreshold` | 0.0 (never) | 0.4 |
| `threatAversion` | 2.0 | 8.0 |
| `aggressionBias` | 4.0 | 1.0 |
| `defensiveTerrainBonus` | 0.5 | 5.0 |

### 10.5 Tick Loop Slot

AI decisions inject at start of **Phase 2 (Command Propagation)**, before player orders. Strategic layer runs at `tick % 100 === 0`; platoon BTs at `tick % 20 === 0`.

### 10.6 Performance Caps

| Metric | Limit |
|--------|-------|
| Influence map update (every 5 s) | ≤ 0.6 ms |
| All platoon BT evals per second | ≤ 0.5 ms |
| Total amortised AI per tick | ≤ 0.13 ms |

### 10.7 Fog of War

AI uses the same spotting system as the player. No omniscient vision. Contact sharing requires a surviving command unit (Synaptic Brood / Broadcast Node) within doctrine range.

### 10.8 Difficulty Scaling

Difficulty changes **force composition and quality only** — not AI intelligence or information access.

| Difficulty | Platoons | Strategic Update |
|------------|----------|-----------------|
| Easy | 2–3 | 10 s |
| Medium | 4–6 | 5 s |
| Hard | 7–10 | 3 s |

---

## 11. Visual Effects Contracts

*Source: VISUAL_EFFECTS.md*

### 11.1 Architecture

Client-side only. `EffectManager` singleton owns instanced particle pools.
All effects triggered by server game events — no cosmetic-only animations.

### 11.2 Canonical Effect Types

```typescript
type EffectType =
  | 'muzzle_flash' | 'tracer' | 'tracer_burst'
  | 'impact_spark' | 'explosion_small' | 'explosion_medium'
  | 'explosion_large' | 'explosion_orbital'
  | 'smoke_puff' | 'smoke_screen' | 'dust_cloud'
  | 'fire_sustained' | 'debris' | 'suppression_ring'
  | 'rocket_trail' | 'illumination_flare' | 'artillery_whistle';
```

### 11.3 Rendering Method

All particles use procedural SDF fragment shaders (no textures). Billboards
via `InstancedMesh`. Additive blending for energy (fire, tracers, flashes);
normal alpha blending for mass (smoke, dust, debris).

### 11.4 Palette Constraints

| Use | Color | Blending |
|-----|-------|----------|
| Fire / explosion | `#FF8030`–`#FFFFFF` | Additive |
| Smoke / dust | `#404040`–`#0A0A0A` | Normal |
| Tracers | `#CCFF44` | Additive |
| Orbital / energy | `#80FFD8` | Additive |
| Suppression ring | `#FF4020` | Additive |

### 11.5 Performance Caps

| Metric | Limit |
|--------|-------|
| Max concurrent particles | 512 |
| Particle pools (draw calls) | 17 |
| Max ground decals | 64 |
| Total VFX per frame | ≤ 0.85 ms |
| LOD threshold (reduced particles) | Camera distance > 200 |

### 11.6 Render Order

Ground effects → Particle effects → Line effects → (existing) World rim → Unit UI. Effects always render below NATO icons and health bars.

---

## 12. NATO Icon Contracts

*Source: NATO_ICONS.md*

### 12.1 Faction Frame Shapes

| Faction | Frame | Color (Frame) | Color (Fill) |
|---------|-------|--------------|-------------|
| Terran (Friendly) | Rectangle | `#4080FF` | `#203060` |
| Khroshi Syndicalists | Diamond | `#C03050` | `#601828` |
| Ataxian Hive | **Hexagon** | `#E04020` | `#702010` |
| Unknown | Quatrefoil | `#D09020` | `#685010` |

### 12.2 Detection Tier Display

| Tier | Detection Value | Renders |
|------|----------------|---------|
| SUSPECTED | 1–24 | Faction-tinted blip, `?` symbol, ±50m jitter |
| DETECTED | 25–74 | Faction frame + standard category symbol |
| CONFIRMED | 75–100 | Faction frame + full type symbol (custom glyphs for Ataxian) |
| LOST | 0 (post-acq) | Dashed frame, fading over 60s |

### 12.3 Icon Library

`milsymbol` (npm, MIT license). Canvas2D rendering → `THREE.CanvasTexture` → `THREE.Sprite` with `sizeAttenuation: false`.

### 12.4 Command Unit Auras

- **Synaptic Brood** (Ataxian HQ): 3 concentric pulsing rings at 100/200/300m, `#E04020`, 12% opacity
- **Broadcast Node** (Khroshi HQ): Neural link lines to nearby units, `#C03050`, 15% opacity with data-pulse dot

### 12.5 Performance Caps

| Metric | Limit |
|--------|-------|
| Canvas renders per frame | ≤ 5 (cached) |
| Icon cache memory | < 1.5 MB |
| Total icon system per frame | ≤ 0.3 ms |

---

## 13. Persistence Guardrails

Mission table must enforce:
- `mission_type` CHECK constraint matching Section 1.1
- `difficulty_tier` CHECK constraint matching Section 1.2
- `state` CHECK constraint matching Section 2.1

---

## 14. Change Control

When changing any contract in this file:
1. Update all impacted docs in the same commit.
2. Include a short migration note if names/fields changed.
3. Search for old tokens across `New Direction Docs/*.md` and remove stale usage.

## 15. Automation

Run the contract linter locally:

```bash
cd server
npm run lint:docs:contracts
```

Recommended CI gate:

```bash
npm --prefix server run lint:docs:contracts
```
