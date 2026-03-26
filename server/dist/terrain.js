import { createNoise2D } from 'simplex-noise';
import { getPreset, normalizeSeed } from './batloc.js';
import { TERRAIN_MOVE_COST } from './terrain-types.js';
const BIOME_PARAMS = {
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
function computeHeight(x, z, p, noise2D, noise2D_b, noise2D_c) {
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
        + detail * p.detailWeight
        + ridge * p.ridgeWeight;
    if (value < p.splitPoint) {
        value = value * p.lowScale;
    }
    else {
        value = p.splitBase + (value - p.splitPoint) * p.highScale;
    }
    value = Math.pow(value, p.contrastPower);
    return Math.max(0, Math.min(1, value));
}
// Smooth interpolation helpers
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
function makeSeededRandom(seed) {
    // Mulberry32: tiny deterministic PRNG suitable for procedural noise seeding.
    let t = (seed >>> 0) || 1;
    return () => {
        t += 0x6D2B79F5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}
function normaliseArray(input) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < input.length; i++) {
        const v = input[i];
        if (v < min)
            min = v;
        if (v > max)
            max = v;
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
function sampleMapBilinear(values, width, height, x, z) {
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
function generateTownAnchors(width, height, seaLevel, heightmap, slopeMap, wetnessMap, coverMap, seed, urbanisation = 3) {
    const rng = makeSeededRandom(seed ^ 0x51f2a5d1);
    const centerX = width * 0.5;
    const centerZ = height * 0.5;
    const discRadius = Math.min(width, height) * 0.5;
    const areaFactor = (width * height) / (512 * 512);
    // urbanisation 0–9: 0 = 1 town (wilderness), 9 = up to 9 towns (urban)
    const urbMin = Math.max(1, Math.floor(urbanisation / 3));
    const urbMax = Math.max(urbMin + 1, Math.min(9, Math.round(urbanisation + 1)));
    const targetCount = Math.max(urbMin, Math.min(urbMax, Math.round(urbMin + areaFactor * 2)));
    const minSpacing = Math.max(22, Math.min(width, height) * 0.12);
    const candidates = [];
    const attempts = Math.max(1000, width * 5);
    for (let i = 0; i < attempts; i++) {
        const angle = rng() * Math.PI * 2;
        const radius = Math.sqrt(rng()) * discRadius * 0.86;
        const x = centerX + Math.cos(angle) * radius;
        const z = centerZ + Math.sin(angle) * radius;
        const distFromCenter = Math.hypot(x - centerX, z - centerZ);
        if (distFromCenter > discRadius * 0.9)
            continue;
        const h = sampleMapBilinear(heightmap, width, height, x, z);
        if (h <= seaLevel + 0.015)
            continue;
        const slope = sampleMapBilinear(slopeMap, width, height, x, z);
        if (slope > 0.32)
            continue;
        const wetness = sampleMapBilinear(wetnessMap, width, height, x, z);
        const cover = sampleMapBilinear(coverMap, width, height, x, z);
        const radialBand = 1 - Math.abs((distFromCenter / discRadius) - 0.55);
        const score = (1 - slope) * 0.55 +
            (1 - wetness) * 0.2 +
            (1 - cover) * 0.1 +
            radialBand * 0.1 +
            rng() * 0.05;
        candidates.push({ x, z, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = [];
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
    const anchors = [];
    for (let i = 0; i < selected.length; i++) {
        const c = selected[i];
        let type = 'village';
        if (i === 0) {
            type = 'town';
        }
        else if (i === 1 || rng() < 0.24) {
            type = 'industrial';
        }
        let radius = 10 + rng() * 6;
        if (type === 'town')
            radius = 14 + rng() * 7;
        if (type === 'industrial')
            radius = 12 + rng() * 8;
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
function buildFlowAccumulation(heightmap, width, height) {
    const flow = new Float32Array(width * height);
    for (let i = 0; i < flow.length; i++) {
        flow[i] = 1;
    }
    const order = new Array(flow.length);
    for (let i = 0; i < order.length; i++) {
        order[i] = i;
    }
    order.sort((a, b) => heightmap[b] - heightmap[a]);
    const offsets = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
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
            if (nx < 0 || nx >= width || nz < 0 || nz >= height)
                continue;
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
function buildDerivedMaps(heightmap, width, height) {
    const slope = new Float32Array(width * height);
    const curvature = new Float32Array(width * height);
    const heightValues = new Float32Array(heightmap.length);
    for (let i = 0; i < heightmap.length; i++) {
        heightValues[i] = heightmap[i];
    }
    const sample = (x, z) => {
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
function classifyTerrainTypes(width, height, heightmap, slopeMap, wetnessMap, coverMap, seaLevel, batloc, towns) {
    const terrainTypeMap = new Array(width * height).fill(0 /* TerrainType.Open */);
    for (let i = 0; i < terrainTypeMap.length; i++) {
        const h = heightmap[i];
        const s = slopeMap[i];
        const w = wetnessMap[i];
        const c = coverMap[i];
        if (h <= seaLevel) {
            terrainTypeMap[i] = 18 /* TerrainType.Water */;
            continue;
        }
        if (h <= seaLevel + 0.012) {
            terrainTypeMap[i] = 19 /* TerrainType.ShallowWater */;
            continue;
        }
        if (s > 0.78) {
            terrainTypeMap[i] = 4 /* TerrainType.Rock */;
            continue;
        }
        if (batloc.arid && h <= seaLevel + 0.03) {
            terrainTypeMap[i] = 3 /* TerrainType.Sand */;
            continue;
        }
        if (w > 0.86) {
            terrainTypeMap[i] = 14 /* TerrainType.Marsh */;
            continue;
        }
        if (w > 0.76) {
            terrainTypeMap[i] = 12 /* TerrainType.Mud */;
            continue;
        }
        if (c > 0.82) {
            terrainTypeMap[i] = batloc.treeLevel >= 8 ? 6 /* TerrainType.Jungle */ : 5 /* TerrainType.Forest */;
            continue;
        }
        if (batloc.roughLevel >= 4 && s > 0.45) {
            terrainTypeMap[i] = 2 /* TerrainType.Rough */;
            continue;
        }
        if (batloc.grassLevel >= 5 && c > 0.58) {
            terrainTypeMap[i] = 1 /* TerrainType.HighGrass */;
            continue;
        }
        if (batloc.fieldLevel >= 4 && c < 0.42 && w < 0.6) {
            terrainTypeMap[i] = 10 /* TerrainType.Fields */;
            continue;
        }
        terrainTypeMap[i] = 0 /* TerrainType.Open */;
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
                if ((dx * dx) + (dz * dz) > town.radius * town.radius)
                    continue;
                const idx = z * width + x;
                if (terrainTypeMap[idx] === 18 /* TerrainType.Water */ || terrainTypeMap[idx] === 19 /* TerrainType.ShallowWater */)
                    continue;
                terrainTypeMap[idx] = town.type === 'industrial' ? 24 /* TerrainType.Industrial */ : 23 /* TerrainType.Urban */;
            }
        }
    }
    return terrainTypeMap;
}
function buildSpawnZones(width, height, terrainTypeMap, seaLevel, heightmap) {
    const attacker = { side: 'attacker', cells: [] };
    const defender = { side: 'defender', cells: [] };
    const band = Math.max(8, Math.floor(height * 0.12));
    for (let z = 0; z < band; z++) {
        for (let x = 0; x < width; x++) {
            const idx = z * width + x;
            if (heightmap[idx] <= seaLevel)
                continue;
            if (terrainTypeMap[idx] === 18 /* TerrainType.Water */ || terrainTypeMap[idx] === 4 /* TerrainType.Rock */)
                continue;
            attacker.cells.push({ x, z });
        }
    }
    for (let z = height - band; z < height; z++) {
        for (let x = 0; x < width; x++) {
            const idx = z * width + x;
            if (heightmap[idx] <= seaLevel)
                continue;
            if (terrainTypeMap[idx] === 18 /* TerrainType.Water */ || terrainTypeMap[idx] === 4 /* TerrainType.Rock */)
                continue;
            defender.cells.push({ x, z });
        }
    }
    return [attacker, defender];
}
// ── River extraction from flow accumulation ─────────────────────────────────
function extractRivers(heightmap, width, height, seaLevel, batloc, seed) {
    // Build raw (un-normalised) flow accumulation to get absolute values
    const flow = new Float32Array(width * height);
    for (let i = 0; i < flow.length; i++)
        flow[i] = 1;
    const order = new Array(flow.length);
    for (let i = 0; i < order.length; i++)
        order[i] = i;
    order.sort((a, b) => heightmap[b] - heightmap[a]);
    const downhill = new Int32Array(width * height).fill(-1);
    const offsets = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
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
            if (nx < 0 || nx >= width || nz < 0 || nz >= height)
                continue;
            const nIdx = nz * width + nx;
            const drop = h0 - heightmap[nIdx];
            if (drop > bestDrop) {
                bestDrop = drop;
                best = nIdx;
            }
        }
        downhill[idx] = best;
        if (best >= 0)
            flow[best] += flow[idx];
    }
    // Threshold: cells with high flow AND above sea level are river candidates
    const density = batloc.streamsMarsh ?? 3;
    const flowThreshold = (width * height) * (0.005 + (10 - density) * 0.002);
    // Mark river cells
    const isRiver = new Uint8Array(width * height);
    for (let i = 0; i < flow.length; i++) {
        if (flow[i] >= flowThreshold && heightmap[i] > seaLevel) {
            isRiver[i] = 1;
        }
    }
    // Trace river paths: start from highest flow cells, follow downhill
    const visited = new Uint8Array(width * height);
    const startCells = [];
    for (let i = 0; i < flow.length; i++) {
        if (isRiver[i])
            startCells.push({ idx: i, flow: flow[i] });
    }
    startCells.sort((a, b) => b.flow - a.flow);
    const rivers = [];
    const maxRivers = Math.max(1, Math.min(5, Math.floor(density / 2)));
    for (const start of startCells) {
        if (rivers.length >= maxRivers)
            break;
        if (visited[start.idx])
            continue;
        // Walk upstream to find the headwater
        // Find highest-flow unvisited cell that flows into a chain leading here
        const path = [];
        let cur = start.idx;
        let steps = 0;
        const maxSteps = width + height;
        while (cur >= 0 && steps < maxSteps) {
            if (visited[cur])
                break;
            visited[cur] = 1;
            const cx = cur % width;
            const cz = Math.floor(cur / width);
            path.push({ x: cx, z: cz });
            // Terminate at water/edge
            if (heightmap[cur] <= seaLevel)
                break;
            const next = downhill[cur];
            if (next < 0)
                break;
            cur = next;
            steps++;
        }
        if (path.length >= 8) {
            const avgFlow = path.reduce((s, p) => s + flow[p.z * width + p.x], 0) / path.length;
            // wideRiver forces all rivers to 'wide' regardless of flow magnitude
            const w = batloc.wideRiver
                ? 'wide'
                : avgFlow > flowThreshold * 8 ? 'wide'
                    : avgFlow > flowThreshold * 3 ? 'river'
                        : 'stream';
            rivers.push({ path, width: w });
        }
    }
    return rivers;
}
// ── Stamp rivers onto terrain type map ──────────────────────────────────────
function stampRiversOnTerrain(terrainTypeMap, width, rivers) {
    for (const river of rivers) {
        const brushSize = river.width === 'wide' ? 2 : river.width === 'river' ? 1 : 0;
        for (const pt of river.path) {
            for (let dz = -brushSize; dz <= brushSize; dz++) {
                for (let dx = -brushSize; dx <= brushSize; dx++) {
                    const nx = Math.round(pt.x) + dx;
                    const nz = Math.round(pt.z) + dz;
                    if (nx < 0 || nx >= width || nz < 0 || nz >= Math.floor(terrainTypeMap.length / width))
                        continue;
                    const idx = nz * width + nx;
                    if (terrainTypeMap[idx] !== 23 /* TerrainType.Urban */ && terrainTypeMap[idx] !== 24 /* TerrainType.Industrial */) {
                        terrainTypeMap[idx] = brushSize > 0 && (Math.abs(dx) === brushSize || Math.abs(dz) === brushSize)
                            ? 19 /* TerrainType.ShallowWater */
                            : 18 /* TerrainType.Water */;
                    }
                }
            }
        }
    }
}
// ── Road network A* between towns ───────────────────────────────────────────
function buildRoadNetwork(width, height, towns, terrainTypeMap, slopeMap, heightmap, seaLevel, seed) {
    if (towns.length < 2)
        return [];
    const roads = [];
    // Connect towns using minimum spanning tree approach (Prim's)
    const connected = new Set([0]);
    const unconnected = new Set();
    for (let i = 1; i < towns.length; i++)
        unconnected.add(i);
    while (unconnected.size > 0) {
        let bestDist = Infinity;
        let bestFrom = 0;
        let bestTo = 0;
        for (const ci of connected) {
            for (const ui of unconnected) {
                const d = Math.hypot(towns[ci].x - towns[ui].x, towns[ci].z - towns[ui].z);
                if (d < bestDist) {
                    bestDist = d;
                    bestFrom = ci;
                    bestTo = ui;
                }
            }
        }
        connected.add(bestTo);
        unconnected.delete(bestTo);
        const path = roadAStar(towns[bestFrom], towns[bestTo], width, height, terrainTypeMap, slopeMap, heightmap, seaLevel);
        if (path.length >= 2) {
            const isPrimary = towns[bestFrom].type === 'town' || towns[bestTo].type === 'town';
            roads.push({
                path,
                type: isPrimary ? 'primary' : 'secondary',
            });
        }
    }
    return roads;
}
/** Simple A* for road routing between two points on the terrain grid. */
function roadAStar(from, to, width, height, terrainTypeMap, slopeMap, heightmap, seaLevel) {
    const sx = Math.round(Math.max(0, Math.min(width - 1, from.x)));
    const sz = Math.round(Math.max(0, Math.min(height - 1, from.z)));
    const gx = Math.round(Math.max(0, Math.min(width - 1, to.x)));
    const gz = Math.round(Math.max(0, Math.min(height - 1, to.z)));
    if (sx === gx && sz === gz)
        return [{ x: sx, z: sz }];
    const size = width * height;
    const gScore = new Float32Array(size).fill(Infinity);
    const parent = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    // Simple open list (not a heap — roads are infrequent, max ~7 per map)
    const open = [];
    const fScore = new Float32Array(size).fill(Infinity);
    const startIdx = sz * width + sx;
    const goalIdx = gz * width + gx;
    gScore[startIdx] = 0;
    fScore[startIdx] = Math.hypot(gx - sx, gz - sz);
    open.push(startIdx);
    const offsets = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
    ];
    let iterations = 0;
    const maxIterations = size / 2; // cap to prevent runaway
    while (open.length > 0 && iterations < maxIterations) {
        iterations++;
        // Find lowest fScore in open
        let bestI = 0;
        for (let i = 1; i < open.length; i++) {
            if (fScore[open[i]] < fScore[open[bestI]])
                bestI = i;
        }
        const current = open[bestI];
        open[bestI] = open[open.length - 1];
        open.pop();
        if (current === goalIdx)
            break;
        if (closed[current])
            continue;
        closed[current] = 1;
        const cx = current % width;
        const cz = Math.floor(current / width);
        for (const [odx, odz] of offsets) {
            const nx = cx + odx;
            const nz = cz + odz;
            if (nx < 0 || nx >= width || nz < 0 || nz >= height)
                continue;
            const nIdx = nz * width + nx;
            if (closed[nIdx])
                continue;
            // Cost: prefer flat, open terrain; avoid water
            const tt = terrainTypeMap[nIdx];
            let moveCost = TERRAIN_MOVE_COST[tt]?.wheel ?? 1.0;
            if (moveCost >= 90)
                moveCost = 20; // water crossable but expensive (bridges will be placed)
            if (heightmap[nIdx] <= seaLevel)
                moveCost = 15;
            const slopePenalty = 1.0 + (slopeMap[nIdx] ?? 0) * 3.0;
            const stepDist = (odx !== 0 && odz !== 0) ? 1.414 : 1.0;
            const tentative = gScore[current] + stepDist * moveCost * slopePenalty;
            if (tentative < gScore[nIdx]) {
                gScore[nIdx] = tentative;
                parent[nIdx] = current;
                fScore[nIdx] = tentative + Math.hypot(gx - nx, gz - nz);
                open.push(nIdx);
            }
        }
    }
    // Reconstruct path
    if (parent[goalIdx] === -1 && goalIdx !== startIdx)
        return [];
    const path = [];
    let cur = goalIdx;
    while (cur !== -1) {
        path.push({ x: cur % width, z: Math.floor(cur / width) });
        cur = parent[cur];
    }
    path.reverse();
    return path;
}
// ── Stamp roads onto terrain type map ───────────────────────────────────────
function stampRoadsOnTerrain(terrainTypeMap, width, roads) {
    for (const road of roads) {
        for (const pt of road.path) {
            const idx = Math.round(pt.z) * width + Math.round(pt.x);
            if (idx >= 0 && idx < terrainTypeMap.length) {
                const existing = terrainTypeMap[idx];
                // Don't overwrite water (bridges handle that) or urban
                if (existing !== 18 /* TerrainType.Water */ && existing !== 19 /* TerrainType.ShallowWater */ &&
                    existing !== 23 /* TerrainType.Urban */ && existing !== 24 /* TerrainType.Industrial */) {
                    terrainTypeMap[idx] = 20 /* TerrainType.Road */;
                }
            }
        }
    }
}
// ── Bridge and ford placement ───────────────────────────────────────────────
function placeBridgesAndFords(width, height, roads, rivers, terrainTypeMap, heightmap, seaLevel) {
    const bridges = [];
    const fords = [];
    // Build a set of river cells for fast lookup
    const riverCells = new Set();
    for (const river of rivers) {
        const brushSize = river.width === 'wide' ? 2 : river.width === 'river' ? 1 : 0;
        for (const pt of river.path) {
            for (let dz = -brushSize; dz <= brushSize; dz++) {
                for (let dx = -brushSize; dx <= brushSize; dx++) {
                    const nx = Math.round(pt.x) + dx;
                    const nz = Math.round(pt.z) + dz;
                    if (nx >= 0 && nx < width && nz >= 0 && nz < height) {
                        riverCells.add(nz * width + nx);
                    }
                }
            }
        }
    }
    // Find road cells that cross river cells => bridges
    const bridgeSet = new Set();
    for (const road of roads) {
        for (const pt of road.path) {
            const rx = Math.round(pt.x);
            const rz = Math.round(pt.z);
            const idx = rz * width + rx;
            if (riverCells.has(idx) && !bridgeSet.has(`${rx},${rz}`)) {
                bridgeSet.add(`${rx},${rz}`);
                bridges.push({
                    x: rx,
                    z: rz,
                    roadType: road.type,
                    maxWeightClass: road.type === 'primary' ? 60 : 30,
                });
                // Stamp bridge on terrain
                if (idx >= 0 && idx < terrainTypeMap.length) {
                    terrainTypeMap[idx] = 21 /* TerrainType.Bridge */;
                }
            }
        }
    }
    // Find shallow river crossings not already bridged => fords
    for (const river of rivers) {
        if (river.width === 'wide')
            continue; // wide rivers can't be forded
        for (let i = 0; i < river.path.length; i += 15) { // check every ~15 cells
            const pt = river.path[i];
            const rx = Math.round(pt.x);
            const rz = Math.round(pt.z);
            if (bridgeSet.has(`${rx},${rz}`))
                continue;
            // Check if area is shallow enough
            const idx = rz * width + rx;
            if (idx >= 0 && idx < heightmap.length && heightmap[idx] > seaLevel - 0.01) {
                fords.push({ x: rx, z: rz });
                if (idx < terrainTypeMap.length) {
                    terrainTypeMap[idx] = 19 /* TerrainType.ShallowWater */;
                }
            }
        }
    }
    return { bridges, fords };
}
// ── Enhanced objective generation ───────────────────────────────────────────
function buildObjectives(width, height, towns, bridges, fords, roads, heightmap) {
    const out = [];
    // Town/industrial objectives
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
    // Bridge objectives
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
    // Ford objectives
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
    // Crossroads: find road cells where 3+ road segments meet
    const roadCellCount = new Map();
    for (const road of roads) {
        const visited = new Set();
        for (const pt of road.path) {
            const key = `${Math.round(pt.x)},${Math.round(pt.z)}`;
            if (!visited.has(key)) {
                visited.add(key);
                roadCellCount.set(key, (roadCellCount.get(key) ?? 0) + 1);
            }
        }
    }
    let crossroadCount = 0;
    for (const [key, count] of roadCellCount) {
        if (count >= 2) { // cell used by 2+ different roads = junction
            const [xs, zs] = key.split(',');
            const x = parseInt(xs, 10);
            const z = parseInt(zs, 10);
            // Skip if too close to an existing objective
            const tooClose = out.some(o => Math.hypot(o.x - x, o.z - z) < 20);
            if (tooClose)
                continue;
            crossroadCount++;
            out.push({
                id: `obj-crossroads-${crossroadCount}`,
                label: 'Crossroads',
                x,
                z,
                type: 'crossroads',
            });
            if (crossroadCount >= 3)
                break; // cap at 3
        }
    }
    // Hilltop objectives: find cells in the top 1% of elevation
    const sorted = heightmap.slice().sort((a, b) => b - a);
    const hilltopThreshold = sorted[Math.max(0, Math.floor(sorted.length * 0.01))];
    let hilltopCount = 0;
    for (let i = 0; i < heightmap.length && hilltopCount < 3; i++) {
        if (heightmap[i] >= hilltopThreshold) {
            const hx = i % width;
            const hz = Math.floor(i / width);
            // Skip if too close to existing objectives
            const tooClose = out.some(o => Math.hypot(o.x - hx, o.z - hz) < 30);
            if (tooClose)
                continue;
            hilltopCount++;
            out.push({
                id: `obj-hilltop-${hilltopCount}`,
                label: 'Hilltop',
                x: hx,
                z: hz,
                type: 'hilltop',
            });
        }
    }
    // Ensure at least one hilltop
    if (hilltopCount === 0) {
        let maxIdx = 0;
        for (let i = 1; i < heightmap.length; i++) {
            if (heightmap[i] > heightmap[maxIdx])
                maxIdx = i;
        }
        out.push({
            id: 'obj-hilltop-1',
            label: 'Hilltop',
            x: maxIdx % width,
            z: Math.floor(maxIdx / width),
            type: 'hilltop',
        });
    }
    return out;
}
// ── Generator ───────────────────────────────────────────────────────────────
export function generateTerrain(width = 400, height = 400, seedOrOptions) {
    const options = typeof seedOrOptions === 'number'
        ? { seed: seedOrOptions }
        : (seedOrOptions ?? {});
    const batloc = options.batloc ?? getPreset('plains');
    const resolvedSeed = options.seed ?? Math.random();
    const baseSeed = normalizeSeed(resolvedSeed);
    // Three shared noise functions — same landmass shape across all biomes.
    // Use independent seeded PRNG streams to avoid permutation-table banding.
    const noise2D = createNoise2D(makeSeededRandom(baseSeed ^ 0xA341316C));
    const noise2D_b = createNoise2D(makeSeededRandom(baseSeed ^ 0xC8013EA4));
    const noise2D_c = createNoise2D(makeSeededRandom(baseSeed ^ 0xAD90777D));
    // Two independent low-frequency fields → 2D biome distribution space
    const noiseBiome1 = createNoise2D(makeSeededRandom(baseSeed ^ 0x7E95761E));
    const noiseBiome2 = createNoise2D(makeSeededRandom(baseSeed ^ 0x98DFB5AC));
    // Pre-compute all three biome heights in one pass each
    const hmMountain = new Float32Array(width * height);
    const hmHills = new Float32Array(width * height);
    const hmFlatlands = new Float32Array(width * height);
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            const i = z * width + x;
            hmMountain[i] = computeHeight(x, z, BIOME_PARAMS.mountains, noise2D, noise2D_b, noise2D_c);
            hmHills[i] = computeHeight(x, z, BIOME_PARAMS.hills, noise2D, noise2D_b, noise2D_c);
            hmFlatlands[i] = computeHeight(x, z, BIOME_PARAMS.flatlands, noise2D, noise2D_b, noise2D_c);
        }
    }
    // hillBaseSize 1–8 controls biome feature size.
    // Smaller hillBaseSize → tighter, more frequent terrain changes.
    // Larger hillBaseSize → broad, sweeping terrain regions.
    const sizeNorm = (Math.max(1, Math.min(8, batloc.hillBaseSize)) - 1) / 7; // 0..1
    const biomeScaleMult = 2.0 - sizeNorm * 1.5; // size=1 → 2.0×, size=8 → 0.5×
    const biomeScale1 = 0.0028 * biomeScaleMult;
    const biomeScale2 = 0.0035 * biomeScaleMult;
    // hillDensity 0–10 biases the biome blend toward more flatlands (low) or
    // more mountains/hills (high). Implemented as an additive shift on the
    // noise field b1 that drives the mountain↔flatland distribution.
    // density=0 → +0.20 bias (very flat), density=5 → 0 (balanced), density=10 → -0.20 (mountainous)
    const mountainBias = (5 - Math.max(0, Math.min(10, batloc.hillDensity))) * 0.04;
    // maxHillHeight 0–15 scales terrain amplitude above sea level.
    // Low values produce flat plains; high values produce tall dramatic peaks.
    const heightAmp = 0.45 + (Math.max(0, Math.min(15, batloc.maxHillHeight)) / 15) * 0.8;
    let seaLevel = (BIOME_PARAMS.mountains.seaLevel +
        BIOME_PARAMS.hills.seaLevel +
        BIOME_PARAMS.flatlands.seaLevel) / 3;
    if (batloc.season === 'winter')
        seaLevel -= 0.01;
    if (batloc.season === 'desert')
        seaLevel += 0.02;
    const heightmap = new Array(width * height);
    const mountainWeightMap = new Array(width * height);
    const hillWeightMap = new Array(width * height);
    const flatlandWeightMap = new Array(width * height);
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            const i = z * width + x;
            // Two independent low-frequency fields → 2D biome space.
            // mountainBias shifts b1 so hillDensity controls mountain/flatland coverage.
            const b1raw = (noiseBiome1(x * biomeScale1, z * biomeScale1) + 1) / 2;
            const b1 = Math.max(0, Math.min(1, b1raw + mountainBias));
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
            const baseHeight = lerp(lerp(hmMountain[i], hmHills[i], wHl / (wMt + wHl || 1)), hmFlatlands[i], wFl);
            // Add restrained micro-relief so terrain doesn't look muddy/over-smoothed.
            // Mountains keep more micro detail, flatlands less.
            const hf1 = noise2D(x * 0.028 + 971.0, z * 0.028 + 233.0);
            const hf2 = noise2D_c(x * 0.054 + 421.0, z * 0.054 + 811.0);
            const micro = (hf1 * 0.65 + hf2 * 0.35); // approximately -1..1
            const detailAmp = 0.018 + wMt * 0.032 + wHl * 0.015;
            // Scale terrain above seaLevel by heightAmp — low values flatten hills,
            // high values amplify them. Clamp so we don't overflow the 0–1 range.
            const raw = baseHeight + micro * detailAmp;
            heightmap[i] = clamp01(seaLevel + (raw - seaLevel) * heightAmp);
        }
    }
    const { slopeMap, curvatureMap, wetnessMap, coverMap, visibilityMap, } = buildDerivedMaps(heightmap, width, height);
    const towns = generateTownAnchors(width, height, seaLevel, heightmap, slopeMap, wetnessMap, coverMap, baseSeed, batloc.urbanisation);
    const terrainTypeMap = classifyTerrainTypes(width, height, heightmap, slopeMap, wetnessMap, coverMap, seaLevel, batloc, towns);
    // ── Feature graph layers ──────────────────────────────────────────────────
    const rivers = extractRivers(heightmap, width, height, seaLevel, batloc, baseSeed);
    stampRiversOnTerrain(terrainTypeMap, width, rivers);
    const roads = buildRoadNetwork(width, height, towns, terrainTypeMap, slopeMap, heightmap, seaLevel, baseSeed);
    stampRoadsOnTerrain(terrainTypeMap, width, roads);
    const { bridges, fords } = placeBridgesAndFords(width, height, roads, rivers, terrainTypeMap, heightmap, seaLevel);
    const spawnZones = buildSpawnZones(width, height, terrainTypeMap, seaLevel, heightmap);
    const objectives = buildObjectives(width, height, towns, bridges, fords, roads, heightmap);
    return {
        width,
        height,
        resolution: 1, // coordinate unit = 1 cell; real scale: 1 cell = 20m (CELL_REAL_M)
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
