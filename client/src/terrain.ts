import * as THREE from 'three';

export type TownType = 'village' | 'town' | 'industrial';

export interface TownAnchor {
  id: string;
  type: TownType;
  x: number;
  z: number;
  radius: number;
}

export interface TerrainData {
  width: number;
  height: number;
  resolution: number;
  heightmap: number[];
  slopeMap?: number[];
  curvatureMap?: number[];
  wetnessMap?: number[];
  coverMap?: number[];
  visibilityMap?: number[];
  mountainWeightMap?: number[];
  hillWeightMap?: number[];
  flatlandWeightMap?: number[];
  towns?: TownAnchor[];
  seaLevel: number;
  biome?: string;
}

const TERRAIN_HEIGHT_SCALE = 52;

/**
 * Terrain vertex shader — spherical curvature + edge taper.
 */
const terrainVertexShader = `
  uniform vec3 terrainCenter;
  uniform float curvatureRadius;
  uniform float discRadius;
  uniform float seaLevel;

  attribute float aSlope;
  attribute float aCurvature;
  attribute float aWetness;
  attribute float aCover;
  attribute float aVisibility;
  attribute float aForest;
  attribute float aMountainWeight;
  attribute float aHillWeight;
  attribute float aFlatlandWeight;

  varying float vHeight;
  varying vec3 vWorldPos;
  varying float vDistFromCenter;
  varying float vSlope;
  varying float vCurvature;
  varying float vWetness;
  varying float vCover;
  varying float vVisibility;
  varying float vForest;
  varying vec3 vBiomeWeights;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    float dx = worldPos.x - terrainCenter.x;
    float dz = worldPos.z - terrainCenter.z;
    float dist = sqrt(dx * dx + dz * dz);
    vDistFromCenter = dist;

    // Taper terrain to sea level at disc edge
    float edgeFade = smoothstep(discRadius, discRadius * 0.88, dist);
    float tapered = mix(seaLevel, worldPos.y, edgeFade);
    worldPos.y = tapered;

    // Spherical curvature
    float drop = (dist * dist) / (2.0 * curvatureRadius);
    worldPos.y -= drop;

    vHeight = tapered;
    vWorldPos = worldPos.xyz;
    vSlope = aSlope;
    vCurvature = aCurvature;
    vWetness = aWetness;
    vCover = aCover;
    vVisibility = aVisibility;
    vForest = aForest;
    vBiomeWeights = vec3(aMountainWeight, aHillWeight, aFlatlandWeight);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/**
 * Terrain fragment shader — dark satellite/radar look with high contrast.
 * Neutral gray palette. Dark valleys, bright ridges. Visible water.
 */
const terrainFragmentShader = `
  uniform float seaLevel;
  uniform float maxHeight;
  uniform float discRadius;
  uniform float fadeStart;
  uniform float fadeEnd;

  varying float vHeight;
  varying vec3 vWorldPos;
  varying float vDistFromCenter;
  varying float vSlope;
  varying float vCurvature;
  varying float vWetness;
  varying float vCover;
  varying float vVisibility;
  varying float vForest;
  varying vec3 vBiomeWeights;

  void main() {
    if (vDistFromCenter > discRadius) discard;

    // Rebuild the normal from the final deformed world-space surface so
    // lighting remains consistent across camera angles.
    vec3 dpdx = dFdx(vWorldPos);
    vec3 dpdy = dFdy(vWorldPos);
    vec3 surfaceNormal = normalize(cross(dpdx, dpdy));
    if (!gl_FrontFacing) surfaceNormal *= -1.0;

    float h = clamp(vHeight / maxHeight, 0.0, 1.0);
    float seaH = seaLevel / maxHeight;

    // Strong key light — steep angle for dramatic shadows
    vec3 lightDir = normalize(vec3(0.3, 0.8, 0.25));
    float diffuse = max(dot(surfaceNormal, lightDir), 0.0);
    // Boost contrast: steepen the light falloff
    diffuse = pow(diffuse, 0.7);

    // Subtle fill from opposite side
    vec3 fillDir = normalize(vec3(-0.4, 0.3, -0.3));
    float fill = max(dot(surfaceNormal, fillDir), 0.0) * 0.15;

    float ambient = 0.32;
    float lighting = ambient + diffuse * 0.72 + fill;

    vec3 color;

    if (h < seaH) {
      // Seafloor: render as dark terrain visible through the water plane above
      float depth = clamp(h / max(seaH, 0.0001), 0.0, 1.0); // 0 = deepest, 1 = shore
      vec3 deepFloor    = vec3(0.06, 0.08, 0.12);
      vec3 shallowFloor = vec3(0.13, 0.15, 0.20);
      color = mix(deepFloor, shallowFloor, depth);
      color = mix(color, vec3(0.12, 0.17, 0.24), vWetness * 0.30);
      color *= (0.55 + 0.45 * lighting);
    } else {
      // Land: neutral gray satellite look — darker base, bright highlights
      float landH = (h - seaH) / (1.0 - seaH);

      // Neutral gray ramp (no warm tint)
      vec3 lowland  = vec3(0.22, 0.22, 0.22);
      vec3 midland  = vec3(0.38, 0.37, 0.36);
      vec3 highland = vec3(0.52, 0.51, 0.50);
      vec3 peak     = vec3(0.68, 0.67, 0.65);

      if (landH < 0.3) {
        color = mix(lowland, midland, landH / 0.3);
      } else if (landH < 0.6) {
        color = mix(midland, highland, (landH - 0.3) / 0.3);
      } else {
        color = mix(highland, peak, (landH - 0.6) / 0.4);
      }

      // Biome-aware tone response: mountain areas get brighter high-contrast ridges,
      // flatland areas stay smoother/darker, hills sit in between.
      float mountainBias = vBiomeWeights.x;
      float flatBias = vBiomeWeights.z;
      color = mix(color, color * 1.15 + vec3(0.03), mountainBias * 0.35);
      color = mix(color, color * 0.85, flatBias * 0.25);

      color *= lighting;

      // Slope darkening — makes ravines and cliff faces darker
      float slope = 1.0 - abs(dot(surfaceNormal, vec3(0.0, 1.0, 0.0)));
      color *= mix(1.0, 0.55, slope);

      // Derived-map shaping for tactical readability.
      color *= mix(1.0, 0.72, vSlope * 0.45);
      color *= mix(1.0, 1.15, (1.0 - vCurvature) * 0.35);
      color = mix(color, color * 0.9 + vec3(0.02, 0.03, 0.03), vWetness * 0.2);

      // Thin neutral shoreline highlight.
      float shoreBand = 1.0 - smoothstep(0.0, 0.012, abs(h - seaH));
      color += vec3(0.70, 0.73, 0.74) * shoreBand * 0.22;

      // Tactical readability overlays:
      // 1) subtle contour lines for shape readability
      float contourFreq = 36.0;
      float contourPhase = fract(h * contourFreq);
      float contourDist = abs(contourPhase - 0.5);
      float contourWidth = fwidth(h * contourFreq) * 0.9;
      float contourLine = 1.0 - smoothstep(0.0, contourWidth, contourDist);
      color = mix(color, color * 0.82, contourLine * 0.14);

      // 2) high-visibility ridges: gentle bright lift
      float visBoost = smoothstep(0.62, 0.92, vVisibility);
      color += vec3(0.16) * visBoost * 0.18;

      // 3) high-cover zones: fine hatch darkening for instant recognition
      float hatch1 = step(0.84, fract((vWorldPos.x + vWorldPos.z) * 0.11));
      float hatch2 = step(0.88, fract((vWorldPos.x - vWorldPos.z) * 0.09));
      float hatch = max(hatch1, hatch2);
      float coverMask = smoothstep(0.58, 0.9, vCover);
      color *= (1.0 - hatch * coverMask * 0.16);

      // (Forest regions are rendered via instanced tree meshes, no ground tint needed)
    }

    // Edge fade
    float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistFromCenter);
    color *= fadeFactor;

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Grid vertex shader — matches terrain curvature + taper.
 */
const gridVertexShader = `
  uniform vec3 terrainCenter;
  uniform float curvatureRadius;
  uniform float discRadius;
  uniform float gridHoverHeight;

  varying vec3 vWorldPos;
  varying float vDistFromCenter;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    float dx = worldPos.x - terrainCenter.x;
    float dz = worldPos.z - terrainCenter.z;
    float dist = sqrt(dx * dx + dz * dz);
    vDistFromCenter = dist;

    // Keep grid at a fixed altitude above the terrain model.
    worldPos.y = gridHoverHeight;

    float drop = (dist * dist) / (2.0 * curvatureRadius);
    worldPos.y -= drop;

    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/**
 * Grid fragment shader — clean white lines like DRONECOM.
 */
const gridFragmentShader = `
  uniform float gridSpacing;
  uniform float discRadius;
  uniform float fadeStart;
  uniform float fadeEnd;

  varying vec3 vWorldPos;
  varying float vDistFromCenter;

  void main() {
    if (vDistFromCenter > discRadius) discard;

    // Minor grid
    vec2 coord = vWorldPos.xz / gridSpacing;
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    float line = min(grid.x, grid.y);
    float minorAlpha = (1.0 - min(line, 1.0)) * 0.15;

    // Major grid every 10 cells
    vec2 majorCoord = vWorldPos.xz / (gridSpacing * 10.0);
    vec2 majorGrid = abs(fract(majorCoord - 0.5) - 0.5) / fwidth(majorCoord);
    float majorLine = min(majorGrid.x, majorGrid.y);
    float majorAlpha = (1.0 - min(majorLine, 1.0)) * 0.45;

    float finalAlpha = max(minorAlpha, majorAlpha);

    // Edge fade
    float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistFromCenter);
    finalAlpha *= fadeFactor;

    if (finalAlpha < 0.01) discard;

    // White grid lines
    gl_FragColor = vec4(vec3(0.85, 0.85, 0.82), finalAlpha);
  }
`;

/**
 * Horizon glow — tight bright ring at disc edge, not a wide wash.
 */
const glowFragmentShader = `
  uniform vec3 glowColor;
  uniform float innerRadius;
  uniform float outerRadius;

  varying vec2 vUv;

  void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered) * 2.0;

    // Tight ring glow
    float ring = smoothstep(innerRadius, innerRadius + 0.08, dist)
               * (1.0 - smoothstep(innerRadius + 0.08, outerRadius, dist));
    // Subtle outer haze
    float haze = smoothstep(innerRadius - 0.1, innerRadius + 0.04, dist)
               * (1.0 - smoothstep(outerRadius, outerRadius + 0.15, dist)) * 0.3;

    float glow = max(ring, haze);

    if (glow < 0.01) discard;

    gl_FragColor = vec4(glowColor * glow, glow);
  }
`;

const glowVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function mapOrFallback(values: number[] | undefined, count: number, fallback: number): Float32Array {
  const out = new Float32Array(count);
  if (!values || values.length !== count) {
    out.fill(fallback);
    return out;
  }
  for (let i = 0; i < count; i++) {
    const v = values[i];
    out[i] = Number.isFinite(v) ? v : fallback;
  }
  return out;
}

function makeSeededRandom(seed: number): () => number {
  let t = (seed >>> 0) || 1;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleMapBilinear(values: number[] | undefined, width: number, height: number, x: number, z: number, fallback: number): number {
  if (!values || values.length !== width * height) {
    return fallback;
  }

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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function buildForestPatchMap(data: TerrainData): Float32Array {
  const { width, height, heightmap, seaLevel } = data;
  const total = width * height;
  const forest = new Float32Array(total);

  const metersPerUnit = 20;
  const areaKm2 = (width * metersPerUnit) * (height * metersPerUnit) / 1_000_000;
  const patchCount = Math.max(12, Math.min(40, Math.floor(areaKm2 * 0.30)));

  type Patch = { x: number; z: number; radius: number; density: number };
  const patches: Patch[] = [];
  const rng = makeSeededRandom((width * 2654435761) ^ (height * 2246822519) ^ 0x5bd1e995);
  const cx = width * 0.5;
  const cz = height * 0.5;
  const discRadius = Math.min(width, height) * 0.5;

  for (let i = 0; i < patchCount * 80 && patches.length < patchCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (discRadius * 0.85);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const hNorm = sampleMapBilinear(heightmap, width, height, x, z, seaLevel);
    if (hNorm <= seaLevel + 0.02) continue;
    const slope = sampleMapBilinear(data.slopeMap, width, height, x, z, 0.4);
    if (slope > 0.82) continue;

    patches.push({
      x,
      z,
      radius: 35 + rng() * 55,
      density: 0.9 + rng() * 0.8,
    });
  }

  if (patches.length === 0) {
    patches.push({ x: cx, z: cz, radius: discRadius * 0.35, density: 1.0 });
  }

  console.log(`[Forest] ${patches.length} patches, radii: ${patches.map(p => p.radius.toFixed(0)).join(', ')}`);

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const i = z * width + x;
      const hNorm = heightmap[i];
      if (hNorm <= seaLevel + 0.01) {
        forest[i] = 0;
        continue;
      }

      const slope = data.slopeMap?.[i] ?? 0.4;
      const wet = data.wetnessMap?.[i] ?? 0.3;
      const cover = data.coverMap?.[i] ?? 0.35;
      const vis = data.visibilityMap?.[i] ?? 0.5;

      const slopeSuit = 1 - smoothstep(0.45, 0.9, slope);
      const moistureSuit = smoothstep(0.08, 0.82, wet);
      const shelterSuit = smoothstep(0.2, 0.9, cover) * (1 - smoothstep(0.75, 0.98, vis));
      const baseSuit = slopeSuit * 0.35 + moistureSuit * 0.3 + shelterSuit * 0.35;

      let patchMask = 0;
      for (let p = 0; p < patches.length; p++) {
        const dx = x - patches[p].x;
        const dz = z - patches[p].z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > patches[p].radius) continue;
        const core = 1 - smoothstep(patches[p].radius * 0.55, patches[p].radius, d);
        patchMask = Math.max(patchMask, core * patches[p].density);
      }

      forest[i] = Math.max(0, Math.min(1, baseSuit * 0.35 + patchMask * 0.9));
    }
  }

  // Diagnostics
  let nonZero = 0, above045 = 0, maxVal = 0;
  for (let i = 0; i < total; i++) {
    if (forest[i] > 0) nonZero++;
    if (forest[i] > 0.18) above045++;
    if (forest[i] > maxVal) maxVal = forest[i];
  }
  console.log(`[Forest] map stats: total=${total}, nonZero=${nonZero} (${(nonZero/total*100).toFixed(1)}%), above threshold=${above045} (${(above045/total*100).toFixed(1)}%), max=${maxVal.toFixed(3)}`);

  return forest;
}

function createProceduralForest(
  data: TerrainData,
  maxHeight: number,
  seaLevelWorld: number,
  centerX: number,
  centerZ: number,
  discRadius: number,
  curvatureRadius: number,
): THREE.Group {
  const group = new THREE.Group();

  const { width, height, heightmap } = data;
  const metersPerUnit = 20;
  const treeScaleBoost = 2.2;

  const terrainY = (x: number, z: number): number => {
    const hNorm = sampleMapBilinear(heightmap, width, height, x, z, data.seaLevel);
    const baseY = hNorm * maxHeight;
    const dx = x - centerX;
    const dz = z - centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const edgeFade = smoothstep(discRadius, discRadius * 0.88, dist);
    const tapered = seaLevelWorld + (baseY - seaLevelWorld) * edgeFade;
    const drop = (dist * dist) / (2 * curvatureRadius);
    return tapered - drop;
  };

  const areaKm2 = (width * metersPerUnit) * (height * metersPerUnit) / 1_000_000;
  const targetTrees = Math.min(9000, Math.max(1200, Math.floor(areaKm2 * 95)));

  // --- Evergreen tree: trunk cylinder + 3 stacked cones ---
  const everTrunkGeo = new THREE.CylinderGeometry(0.04, 0.06, 1, 6);
  const coneTier1 = new THREE.ConeGeometry(0.50, 0.7, 6); // bottom, widest
  const coneTier2 = new THREE.ConeGeometry(0.38, 0.6, 6); // middle
  const coneTier3 = new THREE.ConeGeometry(0.26, 0.5, 6); // top, narrowest

  const trunkMat = new THREE.MeshBasicMaterial({ color: 0x3a3a3a });
  const everCanopyMat = new THREE.MeshBasicMaterial({ color: 0x707070 });

  const everTrunkMesh = new THREE.InstancedMesh(everTrunkGeo, trunkMat, targetTrees);
  const everCone1Mesh = new THREE.InstancedMesh(coneTier1, everCanopyMat, targetTrees);
  const everCone2Mesh = new THREE.InstancedMesh(coneTier2, everCanopyMat, targetTrees);
  const everCone3Mesh = new THREE.InstancedMesh(coneTier3, everCanopyMat, targetTrees);

  for (const m of [everTrunkMesh, everCone1Mesh, everCone2Mesh, everCone3Mesh]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
  }

  const rng = makeSeededRandom((width * 73856093) ^ (height * 19349663) ^ Math.floor(data.seaLevel * 1e6));
  const temp = new THREE.Object3D();
  const occupied = new Set<string>();
  const minCell = 0.9;

  type ForestPatch = { x: number; z: number; radius: number; density: number };

  const patchCount = Math.max(10, Math.min(32, Math.floor(areaKm2 * 0.26)));
  const patches: ForestPatch[] = [];
  for (let i = 0; i < patchCount * 60 && patches.length < patchCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (discRadius * 0.9);
    const px = centerX + Math.cos(a) * r;
    const pz = centerZ + Math.sin(a) * r;
    const hNorm = sampleMapBilinear(heightmap, width, height, px, pz, data.seaLevel);
    if (hNorm <= data.seaLevel + 0.015) continue;
    const slope = sampleMapBilinear(data.slopeMap, width, height, px, pz, 0.4);
    if (slope > 0.72) continue;
    const radius = 10 + rng() * 20;
    let overlaps = false;
    for (let p = 0; p < patches.length; p++) {
      const dx = px - patches[p].x;
      const dz = pz - patches[p].z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < (radius + patches[p].radius) * 0.55) { overlaps = true; break; }
    }
    if (overlaps) continue;
    patches.push({ x: px, z: pz, radius, density: 0.9 + rng() * 0.8 });
  }
  if (patches.length === 0) {
    patches.push({ x: centerX, z: centerZ, radius: discRadius * 0.25, density: 1.0 });
  }

  let placed = 0;

  const placeTree = (x: number, z: number, y: number) => {
    if (placed >= targetTrees) return;
    const treeHeightM = 10 + rng() * 16;
    const treeHeightU = (treeHeightM / metersPerUnit) * treeScaleBoost;
    const trunkH = treeHeightU * 0.35;
    const coneScale = treeHeightU * 0.42;

    temp.position.set(x, y + trunkH * 0.5, z);
    temp.scale.set(1.0, trunkH, 1.0);
    temp.rotation.set(0, rng() * Math.PI * 2, 0);
    temp.updateMatrix();
    everTrunkMesh.setMatrixAt(placed, temp.matrix);

    const trunkTop = y + trunkH;

    const c1H = coneScale * 0.7;
    temp.position.set(x, trunkTop + c1H * 0.5, z);
    temp.scale.set(coneScale, coneScale, coneScale);
    temp.rotation.set(0, rng() * Math.PI * 2, 0);
    temp.updateMatrix();
    everCone1Mesh.setMatrixAt(placed, temp.matrix);

    const c2H = coneScale * 0.6;
    temp.position.set(x, trunkTop + c1H * 0.55 + c2H * 0.5, z);
    temp.scale.set(coneScale * 0.82, coneScale * 0.85, coneScale * 0.82);
    temp.rotation.set(0, rng() * Math.PI * 2, 0);
    temp.updateMatrix();
    everCone2Mesh.setMatrixAt(placed, temp.matrix);

    const c3H = coneScale * 0.5;
    temp.position.set(x, trunkTop + c1H * 0.55 + c2H * 0.45 + c3H * 0.5, z);
    temp.scale.set(coneScale * 0.62, coneScale * 0.7, coneScale * 0.62);
    temp.rotation.set(0, rng() * Math.PI * 2, 0);
    temp.updateMatrix();
    everCone3Mesh.setMatrixAt(placed, temp.matrix);

    placed++;
  };

  for (let p = 0; p < patches.length && placed < targetTrees; p++) {
    const patch = patches[p];
    const spacing = 1.2 + (1.0 / patch.density);
    const rMax = patch.radius;
    for (let lx = -rMax; lx <= rMax && placed < targetTrees; lx += spacing) {
      for (let lz = -rMax; lz <= rMax && placed < targetTrees; lz += spacing) {
        const d = Math.sqrt(lx * lx + lz * lz);
        if (d > rMax) continue;
        const jitterX = (rng() - 0.5) * spacing * 0.8;
        const jitterZ = (rng() - 0.5) * spacing * 0.8;
        const x = patch.x + lx + jitterX;
        const z = patch.z + lz + jitterZ;
        const distFromCenter = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
        if (distFromCenter > discRadius * 0.95) continue;
        const hNorm = sampleMapBilinear(heightmap, width, height, x, z, data.seaLevel);
        if (hNorm <= data.seaLevel + 0.01) continue;
        const slope = sampleMapBilinear(data.slopeMap, width, height, x, z, 0.4);
        const wetness = sampleMapBilinear(data.wetnessMap, width, height, x, z, 0.3);
        const cover = sampleMapBilinear(data.coverMap, width, height, x, z, 0.35);
        const visibility = sampleMapBilinear(data.visibilityMap, width, height, x, z, 0.5);
        const slopeSuit = 1 - smoothstep(0.42, 0.86, slope);
        const moistSuit = smoothstep(0.12, 0.8, wetness);
        const shelterSuit = smoothstep(0.2, 0.85, cover) * (1 - smoothstep(0.68, 0.96, visibility));
        const radialCore = 1 - smoothstep(rMax * 0.55, rMax, d);
        const suit = slopeSuit * 0.35 + moistSuit * 0.3 + shelterSuit * 0.35;
        const spawnChance = 0.3 + suit * 0.45 + radialCore * patch.density * 0.35;
        if (rng() > Math.min(1, spawnChance)) continue;
        const key = `${Math.floor(x / minCell)}:${Math.floor(z / minCell)}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        const y = terrainY(x, z);
        placeTree(x, z, y);
      }
    }
  }

  everTrunkMesh.count = placed;
  everCone1Mesh.count = placed;
  everCone2Mesh.count = placed;
  everCone3Mesh.count = placed;

  for (const m of [everTrunkMesh, everCone1Mesh, everCone2Mesh, everCone3Mesh]) {
    m.instanceMatrix.needsUpdate = true;
  }

  console.log(`Procedural forest: ${placed} evergreen trees`);
  group.add(everTrunkMesh, everCone1Mesh, everCone2Mesh, everCone3Mesh);
  return group;
}

export function createTerrainMesh(data: TerrainData): THREE.Group {
  const group = new THREE.Group();

  const { width, height, heightmap, seaLevel } = data;
  const maxHeight = TERRAIN_HEIGHT_SCALE;
  const seaLevelWorld = seaLevel * maxHeight;

  const centerX = width / 2;
  const centerZ = height / 2;
  const terrainCenter = new THREE.Vector3(centerX, 0, centerZ);

  const discRadius = Math.min(width, height) / 2;
  const curvatureRadius = 4000;
  const fadeStart = discRadius * 0.88;
  const fadeEnd = discRadius * 1.0;

  // Build geometry
  const geometry = new THREE.PlaneGeometry(width, height, width - 1, height - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, heightmap[i] * maxHeight);
  }

  const slopeAttr = mapOrFallback(data.slopeMap, positions.count, 0.5);
  const curvatureAttr = mapOrFallback(data.curvatureMap, positions.count, 0.5);
  const wetnessAttr = mapOrFallback(data.wetnessMap, positions.count, 0.25);
  const coverAttr = mapOrFallback(data.coverMap, positions.count, 0.35);
  const visibilityAttr = mapOrFallback(data.visibilityMap, positions.count, 0.5);
  const forestAttr = buildForestPatchMap(data);
  const mountainWeightAttr = mapOrFallback(data.mountainWeightMap, positions.count, 0.33);
  const hillWeightAttr = mapOrFallback(data.hillWeightMap, positions.count, 0.34);
  const flatlandWeightAttr = mapOrFallback(data.flatlandWeightMap, positions.count, 0.33);

  geometry.setAttribute('aSlope', new THREE.Float32BufferAttribute(slopeAttr, 1));
  geometry.setAttribute('aCurvature', new THREE.Float32BufferAttribute(curvatureAttr, 1));
  geometry.setAttribute('aWetness', new THREE.Float32BufferAttribute(wetnessAttr, 1));
  geometry.setAttribute('aCover', new THREE.Float32BufferAttribute(coverAttr, 1));
  geometry.setAttribute('aVisibility', new THREE.Float32BufferAttribute(visibilityAttr, 1));
  geometry.setAttribute('aForest', new THREE.Float32BufferAttribute(forestAttr, 1));
  geometry.setAttribute('aMountainWeight', new THREE.Float32BufferAttribute(mountainWeightAttr, 1));
  geometry.setAttribute('aHillWeight', new THREE.Float32BufferAttribute(hillWeightAttr, 1));
  geometry.setAttribute('aFlatlandWeight', new THREE.Float32BufferAttribute(flatlandWeightAttr, 1));

  geometry.computeVertexNormals();

  const sharedUniforms = {
    terrainCenter: { value: terrainCenter },
    curvatureRadius: { value: curvatureRadius },
    discRadius: { value: discRadius },
    fadeStart: { value: fadeStart },
    fadeEnd: { value: fadeEnd },
    seaLevel: { value: seaLevelWorld },
  };

  // --- Terrain surface ---
  const terrainMaterial = new THREE.ShaderMaterial({
    vertexShader: terrainVertexShader,
    fragmentShader: terrainFragmentShader,
    uniforms: {
      maxHeight: { value: maxHeight },
      ...sharedUniforms,
    },
    extensions: { derivatives: true },
    side: THREE.FrontSide,
  });
  const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  terrainMesh.name = 'terrain-surface';
  terrainMesh.position.set(centerX, 0, centerZ);
  group.add(terrainMesh);

  // --- Grid overlay ---
  const gridHoverHeight = maxHeight + 3.0;
  const gridGeometry = new THREE.CircleGeometry(discRadius, 256);
  gridGeometry.rotateX(-Math.PI / 2);

  const gridMaterial = new THREE.ShaderMaterial({
    vertexShader: gridVertexShader,
    fragmentShader: gridFragmentShader,
    uniforms: {
      gridSpacing: { value: 5.0 },
      gridHoverHeight: { value: gridHoverHeight },
      ...sharedUniforms,
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const gridMesh = new THREE.Mesh(gridGeometry, gridMaterial);
  gridMesh.position.set(centerX, 0, centerZ);
  group.add(gridMesh);

  // --- Flat transparent water surface ---
  const waterSegments = 128;
  const waterGeometry = new THREE.CircleGeometry(discRadius, waterSegments);
  waterGeometry.rotateX(-Math.PI / 2);

  const waterVertShader = `
    uniform vec3 terrainCenter;
    uniform float curvatureRadius;
    uniform float discRadius;

    varying float vDistFromCenter;
    varying vec3 vWorldPos;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);

      float dx = worldPos.x - terrainCenter.x;
      float dz = worldPos.z - terrainCenter.z;
      float dist = sqrt(dx * dx + dz * dz);
      vDistFromCenter = dist;

      // Same curvature as terrain
      float drop = (dist * dist) / (2.0 * curvatureRadius);
      worldPos.y -= drop;

      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const waterFragShader = `
    uniform float discRadius;
    uniform float fadeStart;
    uniform float fadeEnd;

    varying float vDistFromCenter;
    varying vec3 vWorldPos;

    void main() {
      if (vDistFromCenter > discRadius) discard;

      // Minimal dark glass water (neutral, not saturated blue).
      vec3 deepWater = vec3(0.09, 0.10, 0.12);
      vec3 shoreWater = vec3(0.12, 0.13, 0.15);
      float depthBlend = smoothstep(0.0, discRadius * 0.62, vDistFromCenter);
      vec3 waterColor = mix(deepWater, shoreWater, depthBlend * 0.35);

      // Subtle glassy sheen using a simple fresnel term.
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 2.2);
      waterColor += vec3(0.20) * fresnel * 0.16;

      float alpha = 0.62;

      // Edge fade
      float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistFromCenter);
      alpha *= fadeFactor;

      gl_FragColor = vec4(waterColor, alpha);
    }
  `;

  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterVertShader,
    fragmentShader: waterFragShader,
    uniforms: {
      terrainCenter: { value: terrainCenter },
      curvatureRadius: { value: curvatureRadius },
      discRadius: { value: discRadius },
      fadeStart: { value: fadeStart },
      fadeEnd: { value: fadeEnd },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
  waterMesh.position.set(centerX, seaLevelWorld, centerZ);
  group.add(waterMesh);

  // --- Disc underside ---
  const rimSegments = 128;
  const rimDepth = 6;
  const bottomY = seaLevelWorld - rimDepth;

  // Rim wall
  const rimGeometry = new THREE.CylinderGeometry(
    discRadius, discRadius, rimDepth, rimSegments, 1, true
  );
  const rimMaterial = new THREE.MeshBasicMaterial({
    color: 0x080a08,
    side: THREE.FrontSide,
  });
  const rimMesh = new THREE.Mesh(rimGeometry, rimMaterial);
  rimMesh.position.set(centerX, seaLevelWorld - rimDepth / 2, centerZ);
  group.add(rimMesh);

  // Bottom cap
  const capGeometry = new THREE.CircleGeometry(discRadius, rimSegments);
  capGeometry.rotateX(Math.PI / 2);
  const capMaterial = new THREE.MeshBasicMaterial({
    color: 0x040504,
    side: THREE.FrontSide,
  });
  const capMesh = new THREE.Mesh(capGeometry, capMaterial);
  capMesh.position.set(centerX, bottomY, centerZ);
  group.add(capMesh);

  // Bright edge ring — thin cyan/green line at disc rim
  const edgeRingGeometry = new THREE.RingGeometry(
    discRadius - 0.5, discRadius + 0.5, rimSegments
  );
  edgeRingGeometry.rotateX(-Math.PI / 2);
  const edgeRingMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.15, 0.5, 0.35),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const edgeRingMesh = new THREE.Mesh(edgeRingGeometry, edgeRingMaterial);
  edgeRingMesh.position.set(centerX, seaLevelWorld + 0.1, centerZ);
  group.add(edgeRingMesh);

  // --- Horizon glow ---
  // Sized so the ring aligns with disc edge
  const glowSize = discRadius * 2.4;
  const glowGeometry = new THREE.PlaneGeometry(glowSize, glowSize);
  glowGeometry.rotateX(-Math.PI / 2);
  // Ratio: disc edge is at discRadius / (glowSize/2) = 1/1.2 ≈ 0.833 in UV space
  const glowMaterial = new THREE.ShaderMaterial({
    vertexShader: glowVertexShader,
    fragmentShader: glowFragmentShader,
    uniforms: {
      glowColor: { value: new THREE.Color(0.0, 0.9, 0.5) },
      innerRadius: { value: 0.80 },
      outerRadius: { value: 0.95 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.position.set(centerX, bottomY - 0.5, centerZ);
  group.add(glowMesh);

  // --- Procedural low-poly forests ---
  group.add(createProceduralForest(
    data,
    maxHeight,
    seaLevelWorld,
    centerX,
    centerZ,
    discRadius,
    curvatureRadius,
  ));

  return group;
}
