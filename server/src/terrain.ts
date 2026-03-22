import { createNoise2D } from 'simplex-noise';
import { getPreset, normalizeSeed, type BatLocParams } from './batloc.js';
import { TerrainType } from './terrain-types.js';

type NoiseFunction2D = (x: number, y: number) => number;

export type BiomeType = 'mountains' | 'hills' | 'flatlands' | 'mixed';

export type TownType = 'village' | 'town' | 'industrial';

export interface TownAnchor {
  id: string;
  type: TownType;
  x: number;
  z: number;
  radius: number;
}

export interface RiverFeature {
  path: Array<{ x: number; z: number }>;
  width: 'stream' | 'river' | 'wide';
}

export interface RoadFeature {
  path: Array<{ x: number; z: number }>;
  type: 'primary' | 'secondary' | 'dirt' | 'track';
}

export interface BridgeFeature {
  x: number;
  z: number;
  roadType: string;
  maxWeightClass: number;
}

export interface PointFeature {
  x: number;
  z: number;
}

export interface SpawnZone {
  side: 'attacker' | 'defender';
  cells: Array<{ x: number; z: number }>;
}

export interface Objective {
  id: string;
  label: string;
  x: number;
  z: number;
  type: 'bridge' | 'ford' | 'hilltop' | 'crossroads' | 'town' | 'industrial';
}

export interface TerrainData {
  width: number;
  height: number;
  resolution: number;
  heightmap: number[];  // flat array, row-major
  slopeMap: number[];
  curvatureMap: number[];
  wetnessMap: number[];
  coverMap: number[];
  visibilityMap: number[];
  mountainWeightMap: number[];
  hillWeightMap: number[];
  flatlandWeightMap: number[];
  terrainTypeMap: number[];
  towns: TownAnchor[];
  rivers: RiverFeature[];
  roads: RoadFeature[];
  bridges: BridgeFeature[];
  fords: PointFeature[];
  spawnZones: SpawnZone[];
  objectives: Objective[];
  batloc: BatLocParams;
  seaLevel: number;
  biome: string;
}

export interface GenerateTerrainOptions {
  seed?: number;
  batloc?: BatLocParams;
}

// ── Biome parameter sets ────────────────────────────────────────────────────

interface BiomeParams {
  octaves: number;
  lacunarity: number;
  persistence: number;
  baseFrequency: number;

  continentWeight: number;
  detailWeight: number;
  ridgeWeight: number;

  continentScale: number;
  continentPower: number;

  ridgeOctaves: number;
  ridgeFrequency: number;

  splitPoint: number;
  lowScale: number;
  splitBase: number;
  highScale: number;

  contrastPower: number;
  seaLevel: number;
}

const BIOME_PARAMS: Record<'mountains' | 'hills' | 'flatlands', BiomeParams> = {
  mountains: {
    octaves: 8,
    lacunarity: 2.0,
    persistence: 0.52,
    baseFrequency: 0.007,
    continentWeight: 0.50,
    detailWeight: 0.25,
    ridgeWeight: 0.25,
    continentScale: 0.0025,
    continentPower: 0.8,
    ridgeOctaves: 6,
    ridgeFrequency: 0.005,
    splitPoint: 0.45,
    lowScale: 0.6,
    splitBase: 0.27,
    highScale: 1.3,
    contrastPower: 0.92,
    seaLevel: 0.42,
  },

  hills: {
    octaves: 7,
    lacunarity: 2.0,
    persistence: 0.60,
    baseFrequency: 0.005,
    continentWeight: 0.55,
    detailWeight: 0.38,
    ridgeWeight: 0.07,
    continentScale: 0.003,
    continentPower: 0.7,
    ridgeOctaves: 4,
    ridgeFrequency: 0.004,
    splitPoint: 0.50,
    lowScale: 0.72,
    splitBase: 0.36,
    highScale: 0.90,
    contrastPower: 0.88,
    seaLevel: 0.38,
  },

  flatlands: {
    octaves: 5,
    lacunarity: 2.0,
    persistence: 0.42,
    baseFrequency: 0.004,
    continentWeight: 0.70,
    detailWeight: 0.26,
    ridgeWeight: 0.04,
    continentScale: 0.004,
    continentPower: 0.55,
    ridgeOctaves: 3,
    ridgeFrequency: 0.003,
    splitPoint: 0.52,
    lowScale: 0.78,
    splitBase: 0.40,
    highScale: 0.65,
    contrastPower: 0.82,
    seaLevel: 0.34,
  },
};

// ── Per-point height computation for a given biome ──────────────────────────

function computeHeight(
  x: number,
  z: number,
  p: BiomeParams,
  noise2D: NoiseFunction2D,
  noise2D_b: NoiseFunction2D,
  noise2D_c: NoiseFunction2D
): number {
  let continent = (noise2D_b(x * p.continentScale, z * p.continentScale) + 1) / 2;
  continent = Math.pow(continent, p.continentPower);

  let amplitude = 1.0;
  let frequency = p.baseFrequency;
  let detail = 0;
  let maxAmp = 0;
  for (let o = 0; o < p.octaves; o++) {
    detail += amplitude * noise2D(x * frequency, z * frequency);
    maxAmp += amplitude;
    amplitude *= p.persistence;
    frequency *= p.lacunarity;
  }
  detail = (detail / maxAmp + 1) / 2;

  amplitude = 1.0;
  frequency = p.ridgeFrequency;
  let ridge = 0;
  let ridgeMax = 0;
  for (let o = 0; o < p.ridgeOctaves; o++) {
    let r = noise2D_c(x * frequency + 500, z * frequency + 500);
    r = 1.0 - Math.abs(r);
    r = r * r;
    ridge += amplitude * r;
    ridgeMax += amplitude;
    amplitude *= 0.5;
    frequency *= p.lacunarity;
  }
  ridge /= ridgeMax;

  let value = continent * p.continentWeight
            + detail    * p.detailWeight
            + ridge     * p.ridgeWeight;

  if (value < p.splitPoint) {
    value = value * p.lowScale;
  } else {
    value = p.splitBase + (value - p.splitPoint) * p.highScale;
  }

  value = Math.pow(value, p.contrastPower);
  return Math.max(0, Math.min(1, value));
}

// Smooth interpolation helpers
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function makeSeededRandom(seed: number): () => number {
  // Mulberry32: tiny deterministic PRNG suitable for procedural noise seeding.
  let t = (seed >>> 0) || 1;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function normaliseArray(input: Float32Array): Float32Array {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Float32Array(input.length);
  const span = max - min;
  if (span <= 1e-9) {
    return out;
  }
  for (let i = 0; i < input.length; i++) {
    out[i] = (input[i] - min) / span;
  }
  return out;
}

function sampleMapBilinear(values: number[], width: number, height: number, x: number, z: number): number {
  const sx = Math.max(0, Math.min(width - 1.001, x));
  const sz = Math.max(0, Math.min(height - 1.001, z));
  const x0 = Math.floor(sx);
  const z0 = Math.floor(sz);
  const x1 = Math.min(width - 1, x0 + 1);
  const z1 = Math.min(height - 1, z0 + 1);
  const fx = sx - x0;
  const fz = sz - z0;

  const h00 = values[z0 * width + x0];
  const h10 = values[z0 * width + x1];
  const h01 = values[z1 * width + x0];
  const h11 = values[z1 * width + x1];

  return h00 * (1 - fx) * (1 - fz)
    + h10 * fx * (1 - fz)
    + h01 * (1 - fx) * fz
    + h11 * fx * fz;
}

function generateTownAnchors(
  width: number,
  height: number,
  seaLevel: number,
  heightmap: number[],
  slopeMap: number[],
  wetnessMap: number[],
  coverMap: number[],
  seed: number,
): TownAnchor[] {
  const rng = makeSeededRandom(seed ^ 0x51f2a5d1);
  const centerX = width * 0.5;
  const centerZ = height * 0.5;
  const discRadius = Math.min(width, height) * 0.5;

  const areaFactor = (width * height) / (512 * 512);
  const targetCount = Math.max(3, Math.min(7, Math.round(3 + areaFactor * 2)));
  const minSpacing = Math.max(22, Math.min(width, height) * 0.12);

  const candidates: Array<{ x: number; z: number; score: number }> = [];
  const attempts = Math.max(1000, width * 5);

  for (let i = 0; i < attempts; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * discRadius * 0.86;
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;

    const distFromCenter = Math.hypot(x - centerX, z - centerZ);
    if (distFromCenter > discRadius * 0.9) continue;

    const h = sampleMapBilinear(heightmap, width, height, x, z);
    if (h <= seaLevel + 0.015) continue;

    const slope = sampleMapBilinear(slopeMap, width, height, x, z);
    if (slope > 0.32) continue;

    const wetness = sampleMapBilinear(wetnessMap, width, height, x, z);
    const cover = sampleMapBilinear(coverMap, width, height, x, z);
    const radialBand = 1 - Math.abs((distFromCenter / discRadius) - 0.55);

    const score =
      (1 - slope) * 0.55 +
      (1 - wetness) * 0.2 +
      (1 - cover) * 0.1 +
      radialBand * 0.1 +
      rng() * 0.05;

    candidates.push({ x, z, score });
  }

  candidates.sort((a, b) => b.score - a.score);

  const selected: Array<{ x: number; z: number; score: number }> = [];
  for (let i = 0; i < candidates.length && selected.length < targetCount; i++) {
    const c = candidates[i];
    let tooClose = false;
    for (let j = 0; j < selected.length; j++) {
      if (Math.hypot(selected[j].x - c.x, selected[j].z - c.z) < minSpacing) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      selected.push(c);
    }
  }

  if (selected.length === 0) {
    selected.push({ x: centerX, z: centerZ, score: 1 });
  }

  const anchors: TownAnchor[] = [];
  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    let type: TownType = 'village';
    if (i === 0) {
      type = 'town';
    } else if (i === 1 || rng() < 0.24) {
      type = 'industrial';
    }

    let radius = 10 + rng() * 6;
    if (type === 'town') radius = 14 + rng() * 7;
    if (type === 'industrial') radius = 12 + rng() * 8;

    anchors.push({
      id: `town-${i + 1}`,
      type,
      x: c.x,
      z: c.z,
      radius,
    });
  }

  return anchors;
}

function buildFlowAccumulation(heightmap: number[], width: number, height: number): Float32Array {
  const flow = new Float32Array(width * height);
  for (let i = 0; i < flow.length; i++) {
    flow[i] = 1;
  }

  const order = new Array<number>(flow.length);
  for (let i = 0; i < order.length; i++) {
    order[i] = i;
  }
  order.sort((a, b) => heightmap[b] - heightmap[a]);

  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  for (let n = 0; n < order.length; n++) {
    const idx = order[n];
    const x = idx % width;
    const z = Math.floor(idx / width);
    const h0 = heightmap[idx];

    let best = -1;
    let bestDrop = 0;
    for (let i = 0; i < offsets.length; i++) {
      const nx = x + offsets[i][0];
      const nz = z + offsets[i][1];
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      const nIdx = nz * width + nx;
      const drop = h0 - heightmap[nIdx];
      if (drop > bestDrop) {
        bestDrop = drop;
        best = nIdx;
      }
    }

    if (best >= 0) {
      flow[best] += flow[idx] * 0.92;
    }
  }

  return normaliseArray(flow);
}

function buildDerivedMaps(heightmap: number[], width: number, height: number): {
  slopeMap: number[];
  curvatureMap: number[];
  wetnessMap: number[];
  coverMap: number[];
  visibilityMap: number[];
} {
  const slope = new Float32Array(width * height);
  const curvature = new Float32Array(width * height);
  const heightValues = new Float32Array(heightmap.length);
  for (let i = 0; i < heightmap.length; i++) {
    heightValues[i] = heightmap[i];
  }

  const sample = (x: number, z: number): number => {
    const sx = Math.max(0, Math.min(width - 1, x));
    const sz = Math.max(0, Math.min(height - 1, z));
    return heightmap[sz * width + sx];
  };

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;

      const hL = sample(x - 1, z);
      const hR = sample(x + 1, z);
      const hD = sample(x, z - 1);
      const hU = sample(x, z + 1);
      const hC = sample(x, z);

      const dx = (hR - hL) * 0.5;
      const dz = (hU - hD) * 0.5;
      slope[idx] = Math.sqrt(dx * dx + dz * dz);

      const lap = (hL + hR + hD + hU) - 4 * hC;
      curvature[idx] = lap;
    }
  }

  const slopeNorm = normaliseArray(slope);
  const curvNorm = normaliseArray(curvature);
  const heightNorm = normaliseArray(heightValues);
  const flowNorm = buildFlowAccumulation(heightmap, width, height);

  const wetness = new Float32Array(width * height);
  const cover = new Float32Array(width * height);
  const visibility = new Float32Array(width * height);
  for (let i = 0; i < wetness.length; i++) {
    const concavity = 1 - curvNorm[i];
    const flatness = 1 - slopeNorm[i];
    wetness[i] = clamp01(flowNorm[i] * 0.65 + concavity * 0.2 + flatness * 0.15);

    // Cover: favor concave, wetter, lower-lying and moderately broken terrain.
    const basin = curvNorm[i];
    const lowGround = 1 - heightNorm[i];
    const broken = 1 - Math.abs(slopeNorm[i] - 0.45) * 2;
    cover[i] = clamp01(basin * 0.35 + wetness[i] * 0.25 + lowGround * 0.2 + Math.max(0, broken) * 0.2);

    // Visibility: favor elevated convex terrain with drier/open character.
    const ridge = 1 - curvNorm[i];
    visibility[i] = clamp01(heightNorm[i] * 0.45 + ridge * 0.35 + (1 - wetness[i]) * 0.2);
  }

  return {
    slopeMap: Array.from(slopeNorm),
    curvatureMap: Array.from(curvNorm),
    wetnessMap: Array.from(wetness),
    coverMap: Array.from(cover),
    visibilityMap: Array.from(visibility),
  };
}

function classifyTerrainTypes(
  width: number,
  height: number,
  heightmap: number[],
  slopeMap: number[],
  wetnessMap: number[],
  coverMap: number[],
  seaLevel: number,
  batloc: BatLocParams,
  towns: TownAnchor[],
): number[] {
  const terrainTypeMap = new Array<number>(width * height).fill(TerrainType.Open);

  for (let i = 0; i < terrainTypeMap.length; i++) {
    const h = heightmap[i];
    const s = slopeMap[i];
    const w = wetnessMap[i];
    const c = coverMap[i];

    if (h <= seaLevel) {
      terrainTypeMap[i] = TerrainType.Water;
      continue;
    }
    if (h <= seaLevel + 0.012) {
      terrainTypeMap[i] = TerrainType.ShallowWater;
      continue;
    }
    if (s > 0.78) {
      terrainTypeMap[i] = TerrainType.Rock;
      continue;
    }
    if (batloc.arid && h <= seaLevel + 0.03) {
      terrainTypeMap[i] = TerrainType.Sand;
      continue;
    }
    if (w > 0.86) {
      terrainTypeMap[i] = TerrainType.Marsh;
      continue;
    }
    if (w > 0.76) {
      terrainTypeMap[i] = TerrainType.Mud;
      continue;
    }
    if (c > 0.82) {
      terrainTypeMap[i] = batloc.treeLevel >= 8 ? TerrainType.Jungle : TerrainType.Forest;
      continue;
    }
    if (batloc.roughLevel >= 4 && s > 0.45) {
      terrainTypeMap[i] = TerrainType.Rough;
      continue;
    }
    if (batloc.grassLevel >= 5 && c > 0.58) {
      terrainTypeMap[i] = TerrainType.HighGrass;
      continue;
    }
    if (batloc.fieldLevel >= 4 && c < 0.42 && w < 0.6) {
      terrainTypeMap[i] = TerrainType.Fields;
      continue;
    }

    terrainTypeMap[i] = TerrainType.Open;
  }

  // Stamp urban footprint from town anchors as a simple MVP classifier.
  for (const town of towns) {
    const minX = Math.max(0, Math.floor(town.x - town.radius));
    const maxX = Math.min(width - 1, Math.ceil(town.x + town.radius));
    const minZ = Math.max(0, Math.floor(town.z - town.radius));
    const maxZ = Math.min(height - 1, Math.ceil(town.z + town.radius));

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - town.x;
        const dz = z - town.z;
        if ((dx * dx) + (dz * dz) > town.radius * town.radius) continue;
        const idx = z * width + x;
        if (terrainTypeMap[idx] === TerrainType.Water || terrainTypeMap[idx] === TerrainType.ShallowWater) continue;
        terrainTypeMap[idx] = town.type === 'industrial' ? TerrainType.Industrial : TerrainType.Urban;
      }
    }
  }

  return terrainTypeMap;
}

function buildSpawnZones(width: number, height: number, terrainTypeMap: number[], seaLevel: number, heightmap: number[]): SpawnZone[] {
  const attacker: SpawnZone = { side: 'attacker', cells: [] };
  const defender: SpawnZone = { side: 'defender', cells: [] };

  const band = Math.max(8, Math.floor(height * 0.12));
  for (let z = 0; z < band; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      if (heightmap[idx] <= seaLevel) continue;
      if (terrainTypeMap[idx] === TerrainType.Water || terrainTypeMap[idx] === TerrainType.Rock) continue;
      attacker.cells.push({ x, z });
    }
  }

  for (let z = height - band; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const idx = z * width + x;
      if (heightmap[idx] <= seaLevel) continue;
      if (terrainTypeMap[idx] === TerrainType.Water || terrainTypeMap[idx] === TerrainType.Rock) continue;
      defender.cells.push({ x, z });
    }
  }

  return [attacker, defender];
}

function buildObjectives(
  width: number,
  height: number,
  towns: TownAnchor[],
  bridges: BridgeFeature[],
  fords: PointFeature[],
  heightmap: number[],
): Objective[] {
  const out: Objective[] = [];

  for (let i = 0; i < towns.length; i++) {
    const t = towns[i];
    out.push({
      id: `obj-town-${i + 1}`,
      label: t.type === 'industrial' ? 'Industrial Node' : 'Town Center',
      x: t.x,
      z: t.z,
      type: t.type === 'industrial' ? 'industrial' : 'town',
    });
  }

  for (let i = 0; i < bridges.length; i++) {
    const b = bridges[i];
    out.push({
      id: `obj-bridge-${i + 1}`,
      label: 'Bridge Crossing',
      x: b.x,
      z: b.z,
      type: 'bridge',
    });
  }

  for (let i = 0; i < fords.length; i++) {
    const f = fords[i];
    out.push({
      id: `obj-ford-${i + 1}`,
      label: 'Ford Crossing',
      x: f.x,
      z: f.z,
      type: 'ford',
    });
  }

  // Add one simple hilltop objective at the highest cell.
  let maxIdx = 0;
  for (let i = 1; i < heightmap.length; i++) {
    if (heightmap[i] > heightmap[maxIdx]) maxIdx = i;
  }
  out.push({
    id: 'obj-hilltop-1',
    label: 'Hilltop',
    x: maxIdx % width,
    z: Math.floor(maxIdx / width),
    type: 'hilltop',
  });

  return out;
}

// ── Generator ───────────────────────────────────────────────────────────────

export function generateTerrain(
  width: number = 400,
  height: number = 400,
  seedOrOptions?: number | GenerateTerrainOptions,
): TerrainData {
  const options: GenerateTerrainOptions = typeof seedOrOptions === 'number'
    ? { seed: seedOrOptions }
    : (seedOrOptions ?? {});

  const batloc = options.batloc ?? getPreset('plains');
  const resolvedSeed = options.seed ?? Math.random();
  const baseSeed = normalizeSeed(resolvedSeed);

  // Three shared noise functions — same landmass shape across all biomes.
  // Use independent seeded PRNG streams to avoid permutation-table banding.
  const noise2D   = createNoise2D(makeSeededRandom(baseSeed ^ 0xA341316C));
  const noise2D_b = createNoise2D(makeSeededRandom(baseSeed ^ 0xC8013EA4));
  const noise2D_c = createNoise2D(makeSeededRandom(baseSeed ^ 0xAD90777D));

  // Two independent low-frequency fields → 2D biome distribution space
  const noiseBiome1 = createNoise2D(makeSeededRandom(baseSeed ^ 0x7E95761E));
  const noiseBiome2 = createNoise2D(makeSeededRandom(baseSeed ^ 0x98DFB5AC));

  // Pre-compute all three biome heights in one pass each
  const hmMountain  = new Float32Array(width * height);
  const hmHills     = new Float32Array(width * height);
  const hmFlatlands = new Float32Array(width * height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x;
      hmMountain[i]  = computeHeight(x, z, BIOME_PARAMS.mountains,  noise2D, noise2D_b, noise2D_c);
      hmHills[i]     = computeHeight(x, z, BIOME_PARAMS.hills,      noise2D, noise2D_b, noise2D_c);
      hmFlatlands[i] = computeHeight(x, z, BIOME_PARAMS.flatlands,  noise2D, noise2D_b, noise2D_c);
    }
  }

  // Blend scale: large organic regions (~30% of map width)
  const biomeScale1 = 0.0028;
  const biomeScale2 = 0.0035;

  let seaLevel = (
    BIOME_PARAMS.mountains.seaLevel +
    BIOME_PARAMS.hills.seaLevel +
    BIOME_PARAMS.flatlands.seaLevel
  ) / 3;

  if (batloc.season === 'winter') seaLevel -= 0.01;
  if (batloc.season === 'desert') seaLevel += 0.02;

  const heightmap: number[] = new Array(width * height);
  const mountainWeightMap: number[] = new Array(width * height);
  const hillWeightMap: number[] = new Array(width * height);
  const flatlandWeightMap: number[] = new Array(width * height);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x;

      // Two independent low-frequency fields → 2D biome space
      const b1 = (noiseBiome1(x * biomeScale1, z * biomeScale1) + 1) / 2;
      const b2 = (noiseBiome2(x * biomeScale2, z * biomeScale2) + 1) / 2;

      // Mountains: dominant where b1 is low
      const mt = smoothstep(0.45, 0.15, b1);

      // Flatlands: dominant where b1 is high AND b2 is high
      const fl = smoothstep(0.55, 0.85, b1) * smoothstep(0.3, 0.7, b2);

      // Hills: fills the middle — whatever is neither mountains nor flatlands
      const hl = Math.max(0, 1 - mt - fl);

      // Renormalise weights (can exceed 1 in transition zones)
      const total = mt + hl + fl;
      const wMt = mt / total;
      const wHl = hl / total;
      const wFl = fl / total;

      mountainWeightMap[i] = wMt;
      hillWeightMap[i] = wHl;
      flatlandWeightMap[i] = wFl;

      const baseHeight = lerp(
        lerp(hmMountain[i], hmHills[i], wHl / (wMt + wHl || 1)),
        hmFlatlands[i],
        wFl
      );

      // Add restrained micro-relief so terrain doesn't look muddy/over-smoothed.
      // Mountains keep more micro detail, flatlands less.
      const hf1 = noise2D(x * 0.028 + 971.0, z * 0.028 + 233.0);
      const hf2 = noise2D_c(x * 0.054 + 421.0, z * 0.054 + 811.0);
      const micro = (hf1 * 0.65 + hf2 * 0.35); // approximately -1..1
      const detailAmp = 0.018 + wMt * 0.032 + wHl * 0.015;
      heightmap[i] = clamp01(baseHeight + micro * detailAmp);
    }
  }

  const {
    slopeMap,
    curvatureMap,
    wetnessMap,
    coverMap,
    visibilityMap,
  } = buildDerivedMaps(heightmap, width, height);

  const towns = generateTownAnchors(
    width,
    height,
    seaLevel,
    heightmap,
    slopeMap,
    wetnessMap,
    coverMap,
    baseSeed,
  );

  const terrainTypeMap = classifyTerrainTypes(
    width,
    height,
    heightmap,
    slopeMap,
    wetnessMap,
    coverMap,
    seaLevel,
    batloc,
    towns,
  );

  // MVP scaffolding for feature graph layers. Later milestones fill these in.
  const rivers: RiverFeature[] = [];
  const roads: RoadFeature[] = [];
  const bridges: BridgeFeature[] = [];
  const fords: PointFeature[] = [];
  const spawnZones = buildSpawnZones(width, height, terrainTypeMap, seaLevel, heightmap);
  const objectives = buildObjectives(width, height, towns, bridges, fords, heightmap);

  return {
    width,
    height,
    resolution: 1,
    heightmap,
    slopeMap,
    curvatureMap,
    wetnessMap,
    coverMap,
    visibilityMap,
    mountainWeightMap,
    hillWeightMap,
    flatlandWeightMap,
    terrainTypeMap,
    towns,
    rivers,
    roads,
    bridges,
    fords,
    spawnZones,
    objectives,
    batloc,
    seaLevel,
    biome: batloc.name,
  };
}
