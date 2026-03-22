# Line of Sight Raycasting
*Federation Legionaires — authoritative LOS implementation spec*
*Last updated: 2026-03-22*

---

## 1. Purpose

This document specifies the server-side LOS (Line of Sight) raycast algorithm
used by the Spotting system (Phase 4 of the tick loop). It determines whether
an observer unit can see a target unit through the 3D terrain, and computes the
cumulative range reduction from intervening obstructions (woodland, smoke,
buildings).

The LOS result feeds into the detection accumulator. If LOS is blocked, the
observer's accumulator for that target decays. If LOS is clear (or partially
reduced), the observer accumulates detection points at a range-modified rate.

---

## 2. Eye Height Model

Units are not point sources. Each unit has an **eye height** (observer) and a
**target height** (what is being observed), both in metres above ground level.

```typescript
function eyeHeight(unit: UnitInstance): number {
  if (unit.type.moveClass === 'air') return 100;  // helicopter / fixed-wing
  if (unit.type.moveClass === 'leg') return 1.5;  // infantry standing
  return 2.0 + unit.type.size * 0.3;              // vehicle: 2.0m–3.8m
}

function targetHeight(unit: UnitInstance): number {
  // Target profile is slightly lower — you see the top of the turret, not the cupola
  if (unit.type.moveClass === 'air') return 80;
  if (unit.type.moveClass === 'leg') return 1.2;
  return 1.5 + unit.type.size * 0.3;
}
```

Hull-down units have their `targetHeight` halved (turret exposure only).

---

## 3. Heightmap Elevation Query

### 3.1 Bilinear Interpolation

The heightmap is a regular grid (row-major `Float32Array`). Continuous
world-space positions require interpolation between the four surrounding cells.

```typescript
function getElevation(
  x: number, z: number,
  heightmap: number[], width: number, height: number,
  resolution: number, maxElevation: number
): number {
  // Grid coordinates (fractional)
  const gx = x / resolution;
  const gz = z / resolution;

  // Corner indices (clamped to grid bounds)
  const x0 = Math.max(0, Math.min(width - 2, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(height - 2, Math.floor(gz)));
  const x1 = x0 + 1;
  const z1 = z0 + 1;

  // Fractional position within the cell
  const fx = gx - x0;
  const fz = gz - z0;

  // Four corner heights (normalised 0–1 in the heightmap → scale to metres)
  const h00 = heightmap[z0 * width + x0] * maxElevation;
  const h10 = heightmap[z0 * width + x1] * maxElevation;
  const h01 = heightmap[z1 * width + x0] * maxElevation;
  const h11 = heightmap[z1 * width + x1] * maxElevation;

  // Bilinear blend
  const top    = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  return top + (bottom - top) * fz;
}
```

`maxElevation` is a mission constant (typical: 200 m for flatlands, 600 m for
mountains). The heightmap stores normalised 0–1 values.

### 3.2 Sea Level

Cells below `seaLevel` are underwater. Their effective elevation for LOS
purposes is `seaLevel * maxElevation` (water surface), not the seafloor depth.

---

## 4. Raycast Algorithm

### 4.1 Overview

The LOS check walks a ray from observer eye-point to target profile-point,
stepping through the terrain grid cell by cell. At each cell it:

1. Checks whether the terrain elevation blocks the ray
2. Records any partial obstructions (woodland, smoke) for range penalty
3. Short-circuits if the ray is fully blocked

### 4.2 Ray Setup

```typescript
interface LOSResult {
  clear: boolean;              // true if any view exists (may be partially degraded)
  blocked: boolean;            // true if terrain or buildings fully block
  woodlandCells: number;       // count of woodland cells traversed (Forest, Jungle)
  partialCoverCells: number;   // count of partial-cover cells (Orchard, Crops, HighGrass)
  smokeSources: number;        // count of smoke effects on the ray
  buildingBlocked: boolean;    // true if a building cell fully blocks
}

function castLOS(
  observer: UnitInstance,
  target: UnitInstance,
  terrain: TerrainData,
  terrainTypeMap: TerrainType[],
  smokeLayer: SmokeSource[],
  maxElevation: number
): LOSResult {
  const result: LOSResult = {
    clear: true, blocked: false,
    woodlandCells: 0, partialCoverCells: 0, smokeSources: 0,
    buildingBlocked: false,
  };

  const ox = observer.posX;
  const oz = observer.posZ;
  const oElev = getElevation(ox, oz, terrain.heightmap, terrain.width,
                             terrain.height, terrain.resolution, maxElevation);
  const oEye = oElev + eyeHeight(observer);

  const tx = target.posX;
  const tz = target.posZ;
  const tElev = getElevation(tx, tz, terrain.heightmap, terrain.width,
                             terrain.height, terrain.resolution, maxElevation);
  const tTop = tElev + targetHeight(target);

  // ... Bresenham walk (§4.3) ...
  return result;
}
```

### 4.3 Grid Walk: Bresenham's Line Algorithm

Use **integer Bresenham** on the terrain grid to enumerate every cell the ray
passes through. This is preferred over DDA for its simplicity and determinism —
both observer and target resolve identically regardless of direction.

```typescript
function bresenhamWalk(
  x0: number, z0: number,   // observer cell
  x1: number, z1: number,   // target cell
  callback: (col: number, row: number, t: number) => boolean
): void {
  let dx = Math.abs(x1 - x0);
  let dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;

  const totalSteps = dx + dz;
  let step = 0;
  let cx = x0, cz = z0;

  while (true) {
    const t = totalSteps > 0 ? step / totalSteps : 0;  // 0..1 progress along ray
    const shouldContinue = callback(cx, cz, t);
    if (!shouldContinue) return;

    if (cx === x1 && cz === z1) return;

    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; cx += sx; }
    if (e2 < dx)  { err += dx; cz += sz; }
    step++;
  }
}
```

### 4.4 Per-Cell Elevation Check

At each cell along the ray, compute where the LOS line should be at that
distance, and compare against the cell's terrain elevation.

```typescript
// Inside the Bresenham callback:
function checkCell(col: number, row: number, t: number): boolean {
  // Expected ray height at this point (linear interpolation observer→target)
  const rayHeight = oEye + (tTop - oEye) * t;

  // Ground elevation at cell centre
  const cellX = (col + 0.5) * terrain.resolution;
  const cellZ = (row + 0.5) * terrain.resolution;
  const groundElev = getElevation(cellX, cellZ, terrain.heightmap,
                                   terrain.width, terrain.height,
                                   terrain.resolution, maxElevation);

  // Terrain block: if ground exceeds ray height → fully blocked
  if (groundElev > rayHeight) {
    result.blocked = true;
    result.clear = false;
    return false;  // stop walking
  }

  // Terrain type check for partial obstructions
  const terrainType = terrainTypeMap[row * terrain.width + col];

  if (terrainType === TerrainType.Urban || terrainType === TerrainType.Industrial) {
    // Buildings block LOS completely (building height assumed > ray)
    result.buildingBlocked = true;
    result.blocked = true;
    result.clear = false;
    return false;
  }

  if (terrainType === TerrainType.Forest || terrainType === TerrainType.Jungle) {
    result.woodlandCells++;
  }
  if (terrainType === TerrainType.Orchard ||
      terrainType === TerrainType.Crops ||
      terrainType === TerrainType.HighGrass) {
    result.partialCoverCells++;
  }

  return true;  // continue walking
}
```

### 4.5 Smoke Check

After the Bresenham walk completes (if not already blocked), count smoke
sources whose radius intersects the LOS ray.

```typescript
interface SmokeSource {
  x: number;
  z: number;
  radius: number;       // metres (typically ~30 m)
  expiresAt: number;    // tick number
}

function countSmokeOnRay(
  ox: number, oz: number, tx: number, tz: number,
  smokeLayer: SmokeSource[], currentTick: number
): number {
  let count = 0;
  for (const smoke of smokeLayer) {
    if (smoke.expiresAt <= currentTick) continue;  // expired
    // Point-to-line-segment distance
    const dist = pointToSegmentDist(smoke.x, smoke.z, ox, oz, tx, tz);
    if (dist <= smoke.radius) count++;
  }
  return count;
}
```

`pointToSegmentDist` is a standard 2D point-to-segment perpendicular distance
function (see §A.1 in the appendix).

---

## 5. Range Reduction from LOS Result

After `castLOS` returns, compute the effective detection range penalty.

```typescript
function losRangeFactor(
  losResult: LOSResult,
  sensorTier: 'optical' | 'thermal' | 'radar'
): number {
  if (losResult.blocked) return 0;  // no detection possible
  if (sensorTier === 'radar') return 1.0;  // radar ignores all obstructions

  let factor = 1.0;

  // Woodland cells — only the first one counts (you can't see through
  // multiple forest hexes, but one cell of forest is a partial block)
  if (losResult.woodlandCells >= 1) {
    factor *= sensorTier === 'thermal' ? 0.50 : 0.30;
  }

  // Light cover cells — same: first one applies
  if (losResult.partialCoverCells >= 1) {
    factor *= sensorTier === 'thermal' ? 0.70 : 0.50;
  }

  // Smoke — stacks multiplicatively per source
  const smokeCount = losResult.smokeSources;
  if (smokeCount >= 3) return 0;  // fully blocked for both optical and thermal
  const smokePer = sensorTier === 'thermal' ? 0.70 : 0.30;
  factor *= Math.pow(smokePer, smokeCount);

  return factor;
}
```

**Design decision: woodland/cover count as one penalty regardless of depth.**
Walking through 5 cells of forest is the same reduction as 1 cell — if you
can't see through one tree line, you can't see through five. This prevents
absurdly tiny detection ranges in large forests (0.30^5 = 0.2%) and keeps
woodland balanced as "hard to see through" without making it a perfect wall.

Smoke stacks because each smoke source represents a distinct obscurant cloud
(deliberate deployment), unlike natural terrain.

---

## 6. Integration with Spotting System

### 6.1 Per-Second Update Loop

LOS checks run once per second (every 20 ticks), not every tick. This is the
most expensive phase in the tick loop.

```typescript
function updateSpotting(
  friendlyUnits: UnitInstance[],
  enemyUnits: UnitInstance[],
  terrain: TerrainData,
  terrainTypeMap: TerrainType[],
  smokeLayer: SmokeSource[],
  scenario: ScenarioSettings,
  maxElevation: number,
  currentTick: number
): void {
  for (const observer of friendlyUnits) {
    if (observer.destroyed || observer.surrendered) continue;

    const sensorTier = getSensorTier(observer.type.visionM);

    for (const target of getNearbyCandidates(observer, enemyUnits)) {
      // 1. Compute base effective range (signature, observer quality, caps)
      const baseRange = effectiveDetectionRange(observer, target, scenario);

      // 2. Raycast for LOS and obstructions
      const los = castLOS(observer, target, terrain, terrainTypeMap,
                          smokeLayer, maxElevation);
      los.smokeSources = countSmokeOnRay(
        observer.posX, observer.posZ, target.posX, target.posZ,
        smokeLayer, currentTick
      );

      // 3. Apply LOS range factor
      const losFactor = losRangeFactor(los, sensorTier);
      const finalRange = baseRange * losFactor;

      // 4. Distance check
      const dx = target.posX - observer.posX;
      const dz = target.posZ - observer.posZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // 5. Update accumulator
      const key = `${observer.id}:${target.id}`;
      if (losFactor > 0 && distance <= finalRange) {
        // In range + LOS: accumulate
        const rate = accumulationRate(observer, target);
        accumulators.set(key, Math.min(100,
          (accumulators.get(key) ?? 0) + rate));
      } else {
        // Out of range or blocked: decay
        accumulators.set(key, Math.max(0,
          (accumulators.get(key) ?? 0) - DECAY_RATE_PER_SEC));
      }
    }
  }
}
```

### 6.2 Spatial Filtering: Nearby Candidates

To avoid O(n²) raycast checks for all observer-target pairs, use the spatial
hash grid (500 m cells) defined in SERVER_GAME_LOOP.md. For each observer, only
check targets in cells within `maxDetectionRange / 500` cells of the observer.

```typescript
function getNearbyCandidates(
  observer: UnitInstance,
  allEnemies: UnitInstance[]
): UnitInstance[] {
  // Use spatial hash — returns enemies within observer's max possible range
  const maxRange = observer.type.visionM * 2.0;  // worst-case: 2× for firing signature
  return spatialHash.query(observer.posX, observer.posZ, maxRange);
}
```

This reduces the average case from O(200 × 200) = 40,000 raycasts to
O(200 × k) where k ≈ 10–30 nearby enemies.

---

## 7. Hull-Down Detection

A unit is **hull-down** when terrain between it and the observer blocks the
hull but not the turret. The game approximates this with a simple rule:

```typescript
function isHullDown(
  target: UnitInstance,
  observer: UnitInstance,
  terrain: TerrainData,
  maxElevation: number
): boolean {
  if (target.type.moveClass === 'leg' || target.type.moveClass === 'air') {
    return false;  // infantry and air are never hull-down
  }

  const tElev = getElevation(target.posX, target.posZ, terrain.heightmap,
                              terrain.width, terrain.height,
                              terrain.resolution, maxElevation);
  const tHull = tElev + targetHeight(target) * 0.5;  // hull mid-point
  const tTop  = tElev + targetHeight(target);         // turret top

  // Check if terrain blocks the hull-line but clears the turret-line
  const losToHull = castLOSToHeight(observer, target.posX, target.posZ,
                                     tHull, terrain, maxElevation);
  if (losToHull.blocked) {
    const losToTurret = castLOSToHeight(observer, target.posX, target.posZ,
                                         tTop, terrain, maxElevation);
    if (!losToTurret.blocked) return true;
  }
  return false;
}
```

When hull-down:
- Target's effective `size` is reduced by 2 for detection accumulation (via
  `concealmentMod` in the spotting formula)
- Target's front armour facing is treated as hull-down for combat (turret
  armour only, hull front not exposed)

---

## 8. Performance Budget

### 8.1 Targets

| Metric | Budget |
|--------|--------|
| LOS raycasts per second (200 friendly × 30 nearby) | ≤ 6000 |
| Single raycast (512-cell diagonal worst case) | ≤ 3 µs |
| Total spotting phase per second | ≤ 18 ms |
| Memory for accumulator map | O(F × E) entries ≈ 40 KB |

### 8.2 Optimisations

1. **Spatial hash pre-filter**: Reduces candidate pairs from 40k to ~6k.

2. **Early exit on terrain block**: Bresenham stops the moment ground exceeds
   ray height — average ray walks ~40% of its cells before terminating.

3. **Reciprocal LOS caching**: If A→B was raycast this tick, B→A has the same
   terrain profile. Cache the obstruction result (woodland/smoke counts) and
   reuse with swapped eye/target heights. This halves the number of full
   Bresenham walks.

4. **Skip unchanged pairs**: If neither observer nor target moved since last
   tick, and no smoke was placed/expired, reuse the previous LOS result.

5. **Amortise across ticks**: If 6000 raycasts exceed budget on a low-spec
   machine, spread them across 2–4 ticks (update 1/4 of observers per tick,
   rotating). Each observer still updates at ≤ 1 Hz effective rate.

### 8.3 Complexity

| Operation | Complexity |
|-----------|-----------|
| Spatial hash query | O(1) per cell lookup × k cells |
| Bresenham walk | O(max(dx, dz)) per ray ≤ 724 steps worst case |
| Smoke intersection | O(S) per ray where S = active smoke sources |
| Accumulator update | O(1) per pair |

---

## 9. Data Structures

### 9.1 Terrain Type Map

A parallel array to the heightmap storing the `TerrainType` enum for each cell.
Generated alongside the heightmap during map creation.

```typescript
// Added to TerrainData:
terrainTypeMap: Uint8Array;   // row-major, same dimensions as heightmap
```

### 9.2 Smoke Layer

Active smoke effects maintained on the mission state.

```typescript
interface SmokeSource {
  id: string;
  x: number;         // world-space metres
  z: number;
  radius: number;    // metres (default 30)
  createdTick: number;
  expiresAt: number; // createdTick + durationTicks
}

// smokeDischargers: 45 seconds = 900 ticks
// artillery smoke: 60 seconds = 1200 ticks
```

### 9.3 Accumulator Storage

```typescript
// Map key: "observerId:targetId"
const detectionAccumulators = new Map<string, number>();
```

When an observer is destroyed, remove all its entries. When a target is
destroyed, remove all entries pointing to it.

---

## 10. Edge Cases

### 10.1 Observer and Target in Same Cell

LOS is always clear. No obstruction check needed (the Bresenham walk is
zero-length). Detection proceeds at base rate.

### 10.2 Observer Underwater / Below Sea Level

Submerged units cannot observe. They have no LOS to anything. Skip them
entirely in the spotting loop.

### 10.3 Air Units

Air units (helicopters, fixed-wing) have LOS to everything within range that
isn't behind terrain ridges higher than their flight altitude. Their high eye
height (100 m) means terrain rarely blocks them — but buildings and woodland
penalties still apply.

### 10.4 Target Behind Building Edge

If the Bresenham walk clips a single Urban/Industrial cell at the edge of
a building cluster, LOS is fully blocked. There is no "partial building
cover" — buildings are binary blockers. Players must position units to
avoid intervening structures.

### 10.5 Woodland at Observer's Own Cell

If the observer is inside a Forest/Jungle cell, they are considered to be
looking *out from* the woods. No woodland penalty is applied to the
observer's own cell — only cells between observer and target count.
Same rule applies to the target's own cell: if the target is in a forest,
only intermediate cells count as obstructions.

---

## Appendix A — Utility Functions

### A.1 Point-to-Segment Distance

```typescript
function pointToSegmentDist(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number
): number {
  const abx = bx - ax, abz = bz - az;
  const apx = px - ax, apz = pz - az;
  const ab2 = abx * abx + abz * abz;
  if (ab2 === 0) return Math.sqrt(apx * apx + apz * apz);

  let t = (apx * abx + apz * abz) / ab2;
  t = Math.max(0, Math.min(1, t));

  const nx = ax + t * abx - px;
  const nz = az + t * abz - pz;
  return Math.sqrt(nx * nx + nz * nz);
}
```

### A.2 Sensor Tier Classification

```typescript
type SensorTier = 'optical' | 'thermal' | 'radar';

function getSensorTier(visionM: number): SensorTier {
  if (visionM >= 2500) return 'radar';
  if (visionM >= 2000) return 'thermal';
  return 'optical';
}
```
