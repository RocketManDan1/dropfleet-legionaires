import { TerrainType, isValidTerrainType } from './terrain-types.js';
import type { TerrainData } from './terrain.js';

export interface ValidationError {
  invariant: string;
  message: string;
}

export interface TerrainMetrics {
  terrainHistogram: Record<number, number>;
  riverCount: number;
  riverPathPoints: number;
  roadCount: number;
  roadPathPoints: number;
  bridgeCount: number;
  fordCount: number;
  attackerSpawnCells: number;
  defenderSpawnCells: number;
  objectiveCounts: Record<string, number>;
}

function inBounds(width: number, height: number, x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z) && x >= 0 && x < width && z >= 0 && z < height;
}

export function validateTerrainData(terrain: TerrainData): { valid: boolean; errors: ValidationError[]; metrics: TerrainMetrics } {
  const errors: ValidationError[] = [];
  const expected = terrain.width * terrain.height;

  const arraysToCheck: Array<[string, number[]]> = [
    ['heightmap', terrain.heightmap],
    ['slopeMap', terrain.slopeMap],
    ['curvatureMap', terrain.curvatureMap],
    ['wetnessMap', terrain.wetnessMap],
    ['coverMap', terrain.coverMap],
    ['visibilityMap', terrain.visibilityMap],
    ['mountainWeightMap', terrain.mountainWeightMap],
    ['hillWeightMap', terrain.hillWeightMap],
    ['flatlandWeightMap', terrain.flatlandWeightMap],
    ['terrainTypeMap', terrain.terrainTypeMap],
  ];

  for (const [name, arr] of arraysToCheck) {
    if (arr.length !== expected) {
      errors.push({
        invariant: 'array_lengths_match',
        message: `${name} length ${arr.length} does not match ${expected}`,
      });
    }
  }

  for (let i = 0; i < terrain.terrainTypeMap.length; i++) {
    if (!isValidTerrainType(terrain.terrainTypeMap[i])) {
      errors.push({
        invariant: 'terrain_type_values_valid',
        message: `terrainTypeMap[${i}] has invalid value ${terrain.terrainTypeMap[i]}`,
      });
      break;
    }
  }

  for (const river of terrain.rivers) {
    for (const p of river.path) {
      if (!inBounds(terrain.width, terrain.height, p.x, p.z)) {
        errors.push({ invariant: 'feature_paths_in_bounds', message: 'river path contains out-of-bounds point' });
        break;
      }
    }
  }

  for (const road of terrain.roads) {
    for (const p of road.path) {
      if (!inBounds(terrain.width, terrain.height, p.x, p.z)) {
        errors.push({ invariant: 'feature_paths_in_bounds', message: 'road path contains out-of-bounds point' });
        break;
      }
    }
  }

  for (const bridge of terrain.bridges) {
    if (!inBounds(terrain.width, terrain.height, bridge.x, bridge.z)) {
      errors.push({ invariant: 'bridge_on_water_crossing', message: 'bridge point out of bounds' });
      continue;
    }
    const idx = Math.floor(bridge.z) * terrain.width + Math.floor(bridge.x);
    const tt = terrain.terrainTypeMap[idx];
    if (tt !== TerrainType.Bridge && tt !== TerrainType.Road) {
      errors.push({ invariant: 'bridge_on_water_crossing', message: 'bridge does not sit on bridge/road terrain cell' });
    }
  }

  const attacker = terrain.spawnZones.find((z) => z.side === 'attacker');
  const defender = terrain.spawnZones.find((z) => z.side === 'defender');
  if (!attacker || !defender || attacker.cells.length === 0 || defender.cells.length === 0) {
    errors.push({ invariant: 'spawn_zones_non_empty', message: 'attacker/defender spawn zones must be non-empty' });
  }

  const objectiveIds = new Set<string>();
  for (const obj of terrain.objectives) {
    if (!inBounds(terrain.width, terrain.height, obj.x, obj.z)) {
      errors.push({ invariant: 'objective_points_unique', message: `objective ${obj.id} out of bounds` });
    }
    if (objectiveIds.has(obj.id)) {
      errors.push({ invariant: 'objective_points_unique', message: `duplicate objective id ${obj.id}` });
    }
    objectiveIds.add(obj.id);
  }

  const terrainHistogram: Record<number, number> = {};
  for (const t of terrain.terrainTypeMap) {
    terrainHistogram[t] = (terrainHistogram[t] ?? 0) + 1;
  }

  const objectiveCounts: Record<string, number> = {};
  for (const o of terrain.objectives) {
    objectiveCounts[o.type] = (objectiveCounts[o.type] ?? 0) + 1;
  }

  const metrics: TerrainMetrics = {
    terrainHistogram,
    riverCount: terrain.rivers.length,
    riverPathPoints: terrain.rivers.reduce((sum, r) => sum + r.path.length, 0),
    roadCount: terrain.roads.length,
    roadPathPoints: terrain.roads.reduce((sum, r) => sum + r.path.length, 0),
    bridgeCount: terrain.bridges.length,
    fordCount: terrain.fords.length,
    attackerSpawnCells: attacker?.cells.length ?? 0,
    defenderSpawnCells: defender?.cells.length ?? 0,
    objectiveCounts,
  };

  return { valid: errors.length === 0, errors, metrics };
}
