import * as THREE from 'three';
import type { TerrainData, TownAnchor } from './terrain';

type DistrictType = 'residential' | 'industrial';
type RoofType = 'flat' | 'shed' | 'sawtooth';

interface IntRange {
  min: number;
  max: number;
}

interface FloatRange {
  min: number;
  max: number;
}

interface RoofWeights {
  flat: number;
  shed: number;
  sawtooth: number;
}

type IndustrialThemeId = 'steelworks' | 'refinery' | 'brickworks';

interface IndustrialThemeProfile {
  id: IndustrialThemeId;
  siloChance: number;
  stackChance: number;
  towerChance: number;
  pipeChance: number;
  shedChance: number;
  utilityScale: number;
  moduleScale: number;
  pipeColor: number;
  towerColor: number;
}

export interface DistrictGrammar {
  id: string;
  districtType: DistrictType;
  color: {
    wall: number;
    roof: number;
    edge: number;
    emissiveAccent: number;
  };
  buildingCount: IntRange;
  footprintWidth: IntRange;
  footprintDepth: IntRange;
  floors: IntRange;
  floorHeight: FloatRange;
  roofWeights: RoofWeights;
  rooftopModuleDensity: FloatRange;
  utilityDensity: FloatRange;
  clusterRadius: FloatRange;
}

const TERRAIN_HEIGHT_SCALE = 52;
const CURVATURE_RADIUS = 4000;

const INDUSTRIAL_THEME_PROFILES: Record<IndustrialThemeId, IndustrialThemeProfile> = {
  steelworks: {
    id: 'steelworks',
    siloChance: 0.5,
    stackChance: 0.92,
    towerChance: 0.68,
    pipeChance: 0.78,
    shedChance: 0.52,
    utilityScale: 1.3,
    moduleScale: 1.1,
    pipeColor: 0x875f42,
    towerColor: 0x3f4549,
  },
  refinery: {
    id: 'refinery',
    siloChance: 0.88,
    stackChance: 0.58,
    towerChance: 0.44,
    pipeChance: 0.94,
    shedChance: 0.42,
    utilityScale: 1.24,
    moduleScale: 1.2,
    pipeColor: 0x8d6649,
    towerColor: 0x4b5154,
  },
  brickworks: {
    id: 'brickworks',
    siloChance: 0.42,
    stackChance: 0.86,
    towerChance: 0.36,
    pipeChance: 0.48,
    shedChance: 0.76,
    utilityScale: 0.92,
    moduleScale: 0.85,
    pipeColor: 0x8a6d51,
    towerColor: 0x4b4a46,
  },
};

export const DISTRICT_GRAMMARS: DistrictGrammar[] = [
  {
    id: 'residential-blocks',
    districtType: 'residential',
    color: {
      wall: 0x6a6a66,
      roof: 0x8a8a84,
      edge: 0xb8c7c2,
      emissiveAccent: 0x4bcf97,
    },
    buildingCount: { min: 12, max: 22 },
    footprintWidth: { min: 2, max: 6 },
    footprintDepth: { min: 2, max: 6 },
    floors: { min: 1, max: 2 },
    floorHeight: { min: 1.1, max: 1.5 },
    roofWeights: { flat: 0.72, shed: 0.25, sawtooth: 0.03 },
    rooftopModuleDensity: { min: 0.08, max: 0.24 },
    utilityDensity: { min: 0.06, max: 0.2 },
    clusterRadius: { min: 20, max: 34 },
  },
  {
    id: 'industrial-compound',
    districtType: 'industrial',
    color: {
      wall: 0x575c5d,
      roof: 0x707677,
      edge: 0xc5d2ce,
      emissiveAccent: 0xe0a83a,
    },
    buildingCount: { min: 7, max: 13 },
    footprintWidth: { min: 4, max: 10 },
    footprintDepth: { min: 3, max: 8 },
    floors: { min: 1, max: 2 },
    floorHeight: { min: 1.4, max: 2.1 },
    roofWeights: { flat: 0.28, shed: 0.2, sawtooth: 0.52 },
    rooftopModuleDensity: { min: 0.25, max: 0.5 },
    utilityDensity: { min: 0.26, max: 0.55 },
    clusterRadius: { min: 24, max: 40 },
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashTerrain(data: TerrainData): number {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(data.heightmap.length / 128));
  for (let i = 0; i < data.heightmap.length; i += step) {
    const v = Math.floor(data.heightmap[i] * 10000);
    hash ^= v;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= data.width;
  hash = Math.imul(hash, 16777619);
  hash ^= data.height;
  hash = Math.imul(hash, 16777619);
  return hash >>> 0;
}

function randFloat(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randFloat(rng, min, max + 1));
}

function sampleMapBilinear(values: number[] | undefined, width: number, height: number, x: number, z: number, fallback: number): number {
  if (!values || values.length !== width * height) return fallback;

  const sx = clamp(x, 0, width - 1.001);
  const sz = clamp(z, 0, height - 1.001);
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

function sampleHeightmapBilinear(heightmap: number[], width: number, height: number, x: number, z: number, fallback: number): number {
  return sampleMapBilinear(heightmap, width, height, x, z, fallback);
}

function terrainHeightAt(data: TerrainData, x: number, z: number): number {
  const centerX = data.width / 2;
  const centerZ = data.height / 2;
  const discRadius = Math.min(data.width, data.height) / 2;
  const seaLevelWorld = data.seaLevel * TERRAIN_HEIGHT_SCALE;
  const heightNorm = sampleHeightmapBilinear(data.heightmap, data.width, data.height, x, z, data.seaLevel);
  let y = heightNorm * TERRAIN_HEIGHT_SCALE;

  const dx = x - centerX;
  const dz = z - centerZ;
  const dist = Math.sqrt(dx * dx + dz * dz);

  const edgeFade = smoothstep(discRadius, discRadius * 0.88, dist);
  y = seaLevelWorld + (y - seaLevelWorld) * edgeFade;

  const drop = (dist * dist) / (2 * CURVATURE_RADIUS);
  y -= drop;
  return y;
}

function sampleSlope(data: TerrainData, x: number, z: number): number {
  return sampleMapBilinear(data.slopeMap, data.width, data.height, x, z, 0.4);
}

interface FootprintTerrainStats {
  minY: number;
  maxY: number;
  avgY: number;
}

function sampleFootprintTerrain(data: TerrainData, x: number, z: number, width: number, depth: number): FootprintTerrainStats {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const points: Array<[number, number]> = [
    [x, z],
    [x - halfW, z - halfD],
    [x + halfW, z - halfD],
    [x - halfW, z + halfD],
    [x + halfW, z + halfD],
    [x, z - halfD],
    [x, z + halfD],
    [x - halfW, z],
    [x + halfW, z],
  ];

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sumY = 0;

  for (let i = 0; i < points.length; i++) {
    const y = terrainHeightAt(data, points[i][0], points[i][1]);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sumY += y;
  }

  return {
    minY,
    maxY,
    avgY: sumY / points.length,
  };
}

function pickRoofType(rng: () => number, weights: RoofWeights): RoofType {
  const total = weights.flat + weights.shed + weights.sawtooth;
  const r = rng() * total;
  if (r < weights.flat) return 'flat';
  if (r < weights.flat + weights.shed) return 'shed';
  return 'sawtooth';
}

function addEdgeLines(group: THREE.Group, geometry: THREE.BufferGeometry, color: number): void {
  const edges = new THREE.EdgesGeometry(geometry, 28);
  const edgeLines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }),
  );
  group.add(edgeLines);
}

function makeEmissiveStrip(width: number, depth: number, color: number): THREE.Mesh {
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.26, width * 0.18), 0.08, Math.max(0.14, depth * 0.16)),
    new THREE.MeshBasicMaterial({ color }),
  );
  return strip;
}

function addRooftopModules(group: THREE.Group, rng: () => number, width: number, depth: number, roofY: number, density: number, wallColor: number, edgeColor: number): void {
  const moduleCount = Math.max(0, Math.floor((width * depth * density) / 8));
  for (let i = 0; i < moduleCount; i++) {
    const mw = randFloat(rng, 0.45, 1.2);
    const md = randFloat(rng, 0.45, 1.2);
    const mh = randFloat(rng, 0.25, 0.75);
    const mx = randFloat(rng, -width * 0.34, width * 0.34);
    const mz = randFloat(rng, -depth * 0.34, depth * 0.34);

    const moduleGeom = new THREE.BoxGeometry(mw, mh, md);
    const moduleMesh = new THREE.Mesh(
      moduleGeom,
      new THREE.MeshBasicMaterial({ color: wallColor }),
    );
    moduleMesh.position.set(mx, roofY + mh * 0.5 + 0.02, mz);
    group.add(moduleMesh);

    const moduleEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(moduleGeom, 25),
      new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.6 }),
    );
    moduleEdges.position.copy(moduleMesh.position);
    group.add(moduleEdges);
  }
}

function addIndustrialUtilities(group: THREE.Group, rng: () => number, width: number, depth: number, roofY: number, density: number, wallColor: number): void {
  const stacks = Math.max(1, Math.floor(density * 5));
  for (let i = 0; i < stacks; i++) {
    const radius = randFloat(rng, 0.13, 0.3);
    const h = randFloat(rng, 1.2, 2.8);
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, h, 8),
      new THREE.MeshBasicMaterial({ color: wallColor }),
    );
    stack.position.set(
      randFloat(rng, -width * 0.3, width * 0.3),
      roofY + h * 0.5,
      randFloat(rng, -depth * 0.3, depth * 0.3),
    );
    group.add(stack);
  }
}

function addIndustrialSilhouetteKit(
  group: THREE.Group,
  rng: () => number,
  width: number,
  depth: number,
  wallHeight: number,
  roofY: number,
  wallColor: number,
  roofColor: number,
  edgeColor: number,
  theme: IndustrialThemeProfile,
): void {
  const side = rng() < 0.5 ? -1 : 1;

  // Vertical process silo on one side of the main mass.
  if (rng() < theme.siloChance) {
    const siloRadius = randFloat(rng, 0.35, 0.75);
    const siloHeight = wallHeight * randFloat(rng, 1.15, 1.85);
    const siloX = side * (width * 0.5 + siloRadius * 1.15);
    const siloZ = randFloat(rng, -depth * 0.24, depth * 0.24);

    const siloGeom = new THREE.CylinderGeometry(siloRadius, siloRadius * 1.05, siloHeight, 10);
    const silo = new THREE.Mesh(siloGeom, new THREE.MeshBasicMaterial({ color: roofColor }));
    silo.position.set(siloX, siloHeight * 0.5, siloZ);
    group.add(silo);
    addEdgeLines(group, siloGeom, edgeColor);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(siloRadius * 1.04, siloRadius * 0.96, 0.15, 10),
      new THREE.MeshBasicMaterial({ color: wallColor }),
    );
    cap.position.set(siloX, siloHeight + 0.07, siloZ);
    group.add(cap);
  }

  // Tall smoke stack / chimney.
  if (rng() < theme.stackChance) {
    const stackRadius = randFloat(rng, 0.12, 0.28);
    const stackHeight = wallHeight * randFloat(rng, 1.6, 2.7);
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(stackRadius * 0.92, stackRadius, stackHeight, 9),
      new THREE.MeshBasicMaterial({ color: wallColor }),
    );
    stack.position.set(
      randFloat(rng, -width * 0.3, width * 0.3),
      roofY + stackHeight * 0.45,
      randFloat(rng, -depth * 0.3, depth * 0.3),
    );
    group.add(stack);
  }

  // Lightweight utility frame tower silhouette.
  if (rng() < theme.towerChance) {
    const towerW = randFloat(rng, 0.45, 0.85);
    const towerH = wallHeight * randFloat(rng, 1.2, 1.9);
    const towerX = -side * (width * 0.5 + towerW * 0.8);
    const towerZ = randFloat(rng, -depth * 0.32, depth * 0.32);

    const towerBody = new THREE.Mesh(
      new THREE.BoxGeometry(towerW, towerH, towerW),
      new THREE.MeshBasicMaterial({ color: theme.towerColor }),
    );
    towerBody.position.set(towerX, towerH * 0.5, towerZ);
    group.add(towerBody);

    const towerTop = new THREE.Mesh(
      new THREE.BoxGeometry(towerW * 1.4, 0.12, towerW * 1.4),
      new THREE.MeshBasicMaterial({ color: roofColor }),
    );
    towerTop.position.set(towerX, towerH + 0.06, towerZ);
    group.add(towerTop);
  }

  // Horizontal process pipe run across facade.
  if (rng() < theme.pipeChance) {
    const pipeRadius = randFloat(rng, 0.07, 0.14);
    const pipeLength = width * randFloat(rng, 0.7, 1.15);
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(pipeRadius, pipeRadius, pipeLength, 8),
      new THREE.MeshBasicMaterial({ color: theme.pipeColor }),
    );
    pipe.rotation.z = Math.PI * 0.5;
    pipe.position.set(0, wallHeight * randFloat(rng, 0.28, 0.52), depth * 0.54);
    group.add(pipe);

    const manifoldCount = randInt(rng, 1, 3);
    for (let i = 0; i < manifoldCount; i++) {
      const manifold = new THREE.Mesh(
        new THREE.BoxGeometry(randFloat(rng, 0.18, 0.35), randFloat(rng, 0.18, 0.32), randFloat(rng, 0.22, 0.35)),
        new THREE.MeshBasicMaterial({ color: wallColor }),
      );
      manifold.position.set(
        randFloat(rng, -pipeLength * 0.45, pipeLength * 0.45),
        pipe.position.y + randFloat(rng, -0.12, 0.12),
        depth * 0.54,
      );
      group.add(manifold);
    }
  }

  // Small attached shed to break pure rectangle silhouette.
  if (rng() < theme.shedChance) {
    const annexW = width * randFloat(rng, 0.28, 0.42);
    const annexD = depth * randFloat(rng, 0.28, 0.45);
    const annexH = wallHeight * randFloat(rng, 0.38, 0.62);
    const annex = new THREE.Mesh(
      new THREE.BoxGeometry(annexW, annexH, annexD),
      new THREE.MeshBasicMaterial({ color: wallColor }),
    );
    annex.position.set(side * (width * 0.5 + annexW * 0.45), annexH * 0.5, -depth * 0.18);
    group.add(annex);
  }
}

function createBuilding(
  grammar: DistrictGrammar,
  rng: () => number,
  width: number,
  depth: number,
  floors: number,
  foundationDepth: number,
  industrialTheme?: IndustrialThemeProfile,
): THREE.Group {
  const group = new THREE.Group();
  const wallHeight = floors * randFloat(rng, grammar.floorHeight.min, grammar.floorHeight.max);
  const roofType = pickRoofType(rng, grammar.roofWeights);

  const wallGeom = new THREE.BoxGeometry(width, wallHeight, depth);
  const wallMesh = new THREE.Mesh(
    wallGeom,
    new THREE.MeshBasicMaterial({ color: grammar.color.wall }),
  );
  wallMesh.position.y = wallHeight * 0.5;
  group.add(wallMesh);
  addEdgeLines(group, wallGeom, grammar.color.edge);

  // Foundation skirt softens visual gaps on slightly uneven terrain.
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.95, foundationDepth, depth * 0.95),
    new THREE.MeshBasicMaterial({ color: 0x3f4344 }),
  );
  foundation.position.y = -foundationDepth * 0.5 + 0.01;
  group.add(foundation);

  const roofThickness = 0.16;
  const roofY = wallHeight + roofThickness * 0.5;
  const roofMat = new THREE.MeshBasicMaterial({ color: grammar.color.roof });

  if (roofType === 'flat') {
    const roofGeom = new THREE.BoxGeometry(width * 0.98, roofThickness, depth * 0.98);
    const roofMesh = new THREE.Mesh(roofGeom, roofMat);
    roofMesh.position.y = roofY;
    group.add(roofMesh);
  }

  if (roofType === 'shed') {
    const roofGeom = new THREE.BoxGeometry(width * 1.02, roofThickness, depth * 1.02);
    const roofMesh = new THREE.Mesh(roofGeom, roofMat);
    roofMesh.position.y = roofY;
    roofMesh.rotation.z = randFloat(rng, -0.12, 0.12);
    group.add(roofMesh);
  }

  if (roofType === 'sawtooth') {
    const segmentCount = Math.max(2, Math.floor(width / 2.2));
    const segmentWidth = width / segmentCount;
    for (let i = 0; i < segmentCount; i++) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(segmentWidth * 0.95, roofThickness, depth * 0.9),
        roofMat,
      );
      seg.position.set(-width * 0.5 + segmentWidth * (i + 0.5), roofY + (i % 2 === 0 ? 0.12 : 0), 0);
      group.add(seg);
    }
  }

  const moduleScale = industrialTheme ? industrialTheme.moduleScale : 1;
  const moduleDensity = randFloat(rng, grammar.rooftopModuleDensity.min, grammar.rooftopModuleDensity.max) * moduleScale;
  addRooftopModules(group, rng, width, depth, wallHeight + roofThickness, moduleDensity, grammar.color.wall, grammar.color.edge);

  const utilityScale = industrialTheme ? industrialTheme.utilityScale : 1;
  const utilityDensity = randFloat(rng, grammar.utilityDensity.min, grammar.utilityDensity.max) * utilityScale;
  if (grammar.districtType === 'industrial') {
    addIndustrialUtilities(group, rng, width, depth, wallHeight + roofThickness, utilityDensity, grammar.color.wall);
    addIndustrialSilhouetteKit(
      group,
      rng,
      width,
      depth,
      wallHeight,
      wallHeight + roofThickness,
      grammar.color.wall,
      grammar.color.roof,
      grammar.color.edge,
      industrialTheme ?? INDUSTRIAL_THEME_PROFILES.steelworks,
    );
  }

  const accent = makeEmissiveStrip(width, depth, grammar.color.emissiveAccent);
  accent.position.set(0, Math.max(0.5, wallHeight * 0.2), depth * 0.51);
  group.add(accent);

  return group;
}

function findDistrictCenter(
  data: TerrainData,
  grammar: DistrictGrammar,
  rng: () => number,
  usedCenters: THREE.Vector2[],
): THREE.Vector2 {
  const center = new THREE.Vector2(data.width * 0.5, data.height * 0.5);
  const discRadius = Math.min(data.width, data.height) * 0.5;

  let best = center.clone();
  let bestScore = -Infinity;

  for (let i = 0; i < 220; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * discRadius * 0.68;
    const x = center.x + Math.cos(angle) * radius;
    const z = center.y + Math.sin(angle) * radius;

    const terrainY = terrainHeightAt(data, x, z);
    const seaY = data.seaLevel * TERRAIN_HEIGHT_SCALE;
    if (terrainY < seaY + 0.8) continue;

    const slope = sampleSlope(data, x, z);
    const wetness = sampleMapBilinear(data.wetnessMap, data.width, data.height, x, z, 0.3);
    const cover = sampleMapBilinear(data.coverMap, data.width, data.height, x, z, 0.4);

    let score = 0;
    if (grammar.districtType === 'residential') {
      score += (1 - slope) * 0.58;
      score += (1 - wetness) * 0.18;
      score += cover * 0.14;
      score += (terrainY - seaY) * 0.01;
    } else {
      const seaProximity = 1 - clamp(Math.abs(terrainY - seaY) / 12, 0, 1);
      score += (1 - slope) * 0.64;
      score += seaProximity * 0.16;
      score += wetness * 0.08;
      score += (1 - cover) * 0.12;
    }

    for (const existing of usedCenters) {
      const d = Math.hypot(existing.x - x, existing.y - z);
      score -= smoothstep(0, 42, 42 - d) * 0.85;
    }

    if (score > bestScore) {
      bestScore = score;
      best.set(x, z);
    }
  }

  return best;
}

function createDistrict(
  data: TerrainData,
  grammar: DistrictGrammar,
  rng: () => number,
  center: THREE.Vector2,
  industrialTheme?: IndustrialThemeProfile,
): THREE.Group {
  const districtGroup = new THREE.Group();
  districtGroup.name = grammar.id;

  const discRadius = Math.min(data.width, data.height) * 0.5;
  const clusterRadius = randFloat(rng, grammar.clusterRadius.min, grammar.clusterRadius.max);
  const count = randInt(rng, grammar.buildingCount.min, grammar.buildingCount.max);
  const occupied: THREE.Vector2[] = [];

  for (let i = 0; i < count; i++) {
    let placed = false;

    for (let attempt = 0; attempt < 48 && !placed; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * clusterRadius;
      const x = center.x + Math.cos(a) * r;
      const z = center.y + Math.sin(a) * r;

      const fromWorldCenter = Math.hypot(x - data.width * 0.5, z - data.height * 0.5);
      if (fromWorldCenter > discRadius * 0.9) continue;

      const width = randInt(rng, grammar.footprintWidth.min, grammar.footprintWidth.max);
      const depth = randInt(rng, grammar.footprintDepth.min, grammar.footprintDepth.max);

      const slope = sampleSlope(data, x, z);
      if (slope > 0.36) continue;

      const terrain = sampleFootprintTerrain(data, x, z, width, depth);
      const seaY = data.seaLevel * TERRAIN_HEIGHT_SCALE;
      if (terrain.minY < seaY + 0.45) continue;

      const footprintRelief = terrain.maxY - terrain.minY;
      const reliefLimit = 0.32 + (width + depth) * 0.045;
      if (footprintRelief > reliefLimit) continue;

      let intersects = false;
      const spacing = (width + depth) * 0.62 + 3.2;
      for (const p of occupied) {
        if (Math.hypot(p.x - x, p.y - z) < spacing) {
          intersects = true;
          break;
        }
      }
      if (intersects) continue;

      const floors = randInt(rng, grammar.floors.min, grammar.floors.max);
  const foundationDepth = clamp(0.18 + footprintRelief * 0.9, 0.2, 0.85);
  const building = createBuilding(grammar, rng, width, depth, floors, foundationDepth, industrialTheme);
  // Slightly bury the base and anchor to footprint-averaged terrain height.
  building.position.set(x, terrain.avgY - 0.03, z);
      building.rotation.y = Math.round(rng() * 3) * (Math.PI * 0.5);
      districtGroup.add(building);

      occupied.push(new THREE.Vector2(x, z));
      placed = true;
    }
  }

  return districtGroup;
}

function getGrammarById(id: string): DistrictGrammar {
  const grammar = DISTRICT_GRAMMARS.find((g) => g.id === id);
  if (!grammar) {
    return DISTRICT_GRAMMARS[0];
  }
  return grammar;
}

function pickIndustrialThemeForTown(town: TownAnchor, rng: () => number): IndustrialThemeProfile {
  const roll = rng();
  if (town.type === 'industrial') {
    if (roll < 0.46) return INDUSTRIAL_THEME_PROFILES.refinery;
    if (roll < 0.84) return INDUSTRIAL_THEME_PROFILES.steelworks;
    return INDUSTRIAL_THEME_PROFILES.brickworks;
  }
  if (town.type === 'town') {
    if (roll < 0.52) return INDUSTRIAL_THEME_PROFILES.brickworks;
    if (roll < 0.8) return INDUSTRIAL_THEME_PROFILES.steelworks;
    return INDUSTRIAL_THEME_PROFILES.refinery;
  }
  if (roll < 0.58) return INDUSTRIAL_THEME_PROFILES.brickworks;
  if (roll < 0.86) return INDUSTRIAL_THEME_PROFILES.steelworks;
  return INDUSTRIAL_THEME_PROFILES.refinery;
}

function scaleForTown(base: DistrictGrammar, town: TownAnchor, rng: () => number): DistrictGrammar {
  const sizeScale = clamp(town.radius / 14, 0.68, 1.35);
  const jitter = 0.9 + rng() * 0.2;
  const scale = sizeScale * jitter;

  const floors = { ...base.floors };
  let roofWeights = { ...base.roofWeights };

  if (town.type === 'village') {
    floors.max = Math.max(1, Math.min(floors.max, 2));
  }

  if (town.type === 'industrial') {
    roofWeights = { flat: 0.22, shed: 0.2, sawtooth: 0.58 };
  }

  return {
    ...base,
    id: `${base.id}-${town.id}`,
    buildingCount: {
      min: Math.max(4, Math.floor(base.buildingCount.min * scale * 0.55)),
      max: Math.max(6, Math.floor(base.buildingCount.max * scale * 0.8)),
    },
    footprintWidth: {
      min: Math.max(2, Math.floor(base.footprintWidth.min * (0.82 + scale * 0.08))),
      max: Math.max(3, Math.floor(base.footprintWidth.max * (0.8 + scale * 0.12))),
    },
    footprintDepth: {
      min: Math.max(2, Math.floor(base.footprintDepth.min * (0.82 + scale * 0.08))),
      max: Math.max(3, Math.floor(base.footprintDepth.max * (0.8 + scale * 0.12))),
    },
    floors,
    roofWeights,
    rooftopModuleDensity: {
      min: clamp(base.rooftopModuleDensity.min * (0.8 + scale * 0.1), 0.04, 0.65),
      max: clamp(base.rooftopModuleDensity.max * (0.9 + scale * 0.15), 0.1, 0.9),
    },
    utilityDensity: {
      min: clamp(base.utilityDensity.min * (0.85 + scale * 0.12), 0.03, 0.8),
      max: clamp(base.utilityDensity.max * (0.95 + scale * 0.2), 0.08, 1.2),
    },
    clusterRadius: {
      min: clamp(town.radius * 1.1, 14, 42),
      max: clamp(town.radius * 1.75, 20, 58),
    },
  };
}

function createDistrictsFromTowns(data: TerrainData, rng: () => number): THREE.Group {
  const root = new THREE.Group();
  const residential = getGrammarById('residential-blocks');
  const industrial = getGrammarById('industrial-compound');

  const towns = data.towns ?? [];
  for (let i = 0; i < towns.length; i++) {
    const town = towns[i];

    const primaryBase = town.type === 'industrial' ? industrial : residential;
    const primaryGrammar = scaleForTown(primaryBase, town, rng);
    const primaryTheme = primaryGrammar.districtType === 'industrial'
      ? pickIndustrialThemeForTown(town, rng)
      : undefined;
    const center = new THREE.Vector2(town.x, town.z);
    const district = createDistrict(data, primaryGrammar, rng, center, primaryTheme);
    district.name = `town-${town.id}-${town.type}-primary`;
    district.userData.theme = primaryTheme?.id ?? 'residential';
    root.add(district);

    // Larger town centers may include a secondary annex district for mixed-use look.
    const shouldAddAnnex = town.type === 'town' || (town.type === 'industrial' && rng() < 0.45);
    if (!shouldAddAnnex) continue;

    const annexBase = town.type === 'industrial' ? residential : industrial;
    const annexTown: TownAnchor = {
      ...town,
      id: `${town.id}-annex`,
      radius: town.radius * 0.62,
    };
    const annexGrammar = scaleForTown(annexBase, annexTown, rng);
    const annexTheme = annexGrammar.districtType === 'industrial'
      ? pickIndustrialThemeForTown(annexTown, rng)
      : undefined;
    const offsetAngle = rng() * Math.PI * 2;
    const offsetDist = town.radius * (0.65 + rng() * 0.45);
    const annexCenter = new THREE.Vector2(
      town.x + Math.cos(offsetAngle) * offsetDist,
      town.z + Math.sin(offsetAngle) * offsetDist,
    );
    const annexDistrict = createDistrict(data, annexGrammar, rng, annexCenter, annexTheme);
    annexDistrict.name = `town-${town.id}-${town.type}-annex`;
    annexDistrict.userData.theme = annexTheme?.id ?? 'residential';
    root.add(annexDistrict);
  }

  return root;
}

export function createProceduralBuildingDistricts(data: TerrainData): THREE.Group {
  const root = new THREE.Group();
  root.name = 'procedural-building-districts';

  const seed = hashTerrain(data) ^ 0xb1d2a33;
  const rng = mulberry32(seed);

  if (data.towns && data.towns.length > 0) {
    root.add(createDistrictsFromTowns(data, rng));
    return root;
  }

  const usedCenters: THREE.Vector2[] = [];

  for (const grammar of DISTRICT_GRAMMARS) {
    const center = findDistrictCenter(data, grammar, rng, usedCenters);
    usedCenters.push(center);
    const district = createDistrict(data, grammar, rng, center);
    root.add(district);
  }

  return root;
}
