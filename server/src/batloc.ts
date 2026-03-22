export type Season = 'summer' | 'winter' | 'desert';

export type RoadCode = 0 | 1 | 2 | 3 | 4 | 5 | 255;

export type TerrainMod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface BatLocParams {
  name: string;
  id: number;
  hillDensity: number;
  maxHillHeight: number;
  hillBaseSize: number;
  streamsMarsh: number;
  lakesSize: number;
  marshSize: number;
  riverTrees: number;
  riverMarsh: number;
  riverMud: number;
  riverRough: number;
  treeLevel: number;
  orchardLevel: number;
  grassLevel: number;
  roughLevel: number;
  fieldLevel: number;
  mudLevel: number;
  urbanisation: number;
  roadCode: RoadCode;
  terrainMod: TerrainMod;
  season: Season;
  arid: boolean;
  savannah: boolean;
  coastalEdge?: 'north' | 'south' | 'east' | 'west' | null;
  wideRiver?: boolean;
}

export const BATLOC_PRESETS: Record<string, BatLocParams> = {
  plains: {
    name: 'Plains', id: 126,
    hillDensity: 3, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 2, orchardLevel: 1, grassLevel: 5, roughLevel: 1,
    fieldLevel: 4, mudLevel: 0,
    urbanisation: 3, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },
  forest: {
    name: 'Forest', id: 127,
    hillDensity: 4, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 3, lakesSize: 0, marshSize: 1,
    riverTrees: 3, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 8, orchardLevel: 0, grassLevel: 2, roughLevel: 2,
    fieldLevel: 1, mudLevel: 1,
    urbanisation: 2, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },
  mountains: {
    name: 'Mountains', id: 128,
    hillDensity: 8, maxHillHeight: 10, hillBaseSize: 2,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 30,
    treeLevel: 4, orchardLevel: 0, grassLevel: 1, roughLevel: 5,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 1, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },
  jungle: {
    name: 'Jungle', id: 129,
    hillDensity: 3, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 5, lakesSize: 1, marshSize: 2,
    riverTrees: 4, riverMarsh: 2, riverMud: 0, riverRough: 0,
    treeLevel: 9, orchardLevel: 0, grassLevel: 2, roughLevel: 1,
    fieldLevel: 1, mudLevel: 2,
    urbanisation: 1, roadCode: 5, terrainMod: 2,
    season: 'summer', arid: false, savannah: false,
  },
  desert: {
    name: 'Desert', id: 130,
    hillDensity: 3, maxHillHeight: 5, hillBaseSize: 4,
    streamsMarsh: 0, lakesSize: 0, marshSize: 0,
    riverTrees: 0, riverMarsh: 0, riverMud: 0, riverRough: 110,
    treeLevel: 0, orchardLevel: 0, grassLevel: 0, roughLevel: 4,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 1, roadCode: 4, terrainMod: 0,
    season: 'desert', arid: true, savannah: false,
  },
  beach: {
    name: 'Beach', id: 146,
    hillDensity: 2, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 1, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 2, orchardLevel: 0, grassLevel: 2, roughLevel: 2,
    fieldLevel: 1, mudLevel: 0,
    urbanisation: 2, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
    coastalEdge: 'south',
  },
  'river-crossing': {
    name: 'River Crossing', id: 147,
    hillDensity: 2, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 6, lakesSize: 0, marshSize: 1,
    riverTrees: 3, riverMarsh: 2, riverMud: 1, riverRough: 0,
    treeLevel: 3, orchardLevel: 1, grassLevel: 3, roughLevel: 1,
    fieldLevel: 3, mudLevel: 0,
    urbanisation: 2, roadCode: 2, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
    wideRiver: true,
  },
  stalingrad: {
    name: 'Stalingrad', id: 42,
    hillDensity: 2, maxHillHeight: 2, hillBaseSize: 4,
    streamsMarsh: 1, lakesSize: 0, marshSize: 0,
    riverTrees: 0, riverMarsh: 0, riverMud: 1, riverRough: 0,
    treeLevel: 1, orchardLevel: 0, grassLevel: 1, roughLevel: 2,
    fieldLevel: 0, mudLevel: 1,
    urbanisation: 8, roadCode: 3, terrainMod: 7,
    season: 'winter', arid: false, savannah: false,
  },
  finland: {
    name: 'Finland', id: 15,
    hillDensity: 3, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 4, lakesSize: 3, marshSize: 2,
    riverTrees: 3, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 7, orchardLevel: 0, grassLevel: 2, roughLevel: 2,
    fieldLevel: 1, mudLevel: 0,
    urbanisation: 1, roadCode: 0, terrainMod: 0,
    season: 'winter', arid: false, savannah: false,
  },
};

const NUMERIC_RANGES: Record<keyof Pick<BatLocParams,
  'hillDensity' | 'maxHillHeight' | 'hillBaseSize' |
  'streamsMarsh' | 'lakesSize' | 'marshSize' |
  'riverTrees' | 'riverMarsh' | 'riverMud' | 'riverRough' |
  'treeLevel' | 'orchardLevel' | 'grassLevel' | 'roughLevel' |
  'fieldLevel' | 'mudLevel' | 'urbanisation'
>, [number, number]> = {
  hillDensity: [0, 10],
  maxHillHeight: [0, 15],
  hillBaseSize: [1, 8],
  streamsMarsh: [0, 9],
  lakesSize: [0, 5],
  marshSize: [0, 5],
  riverTrees: [0, 9],
  riverMarsh: [0, 9],
  riverMud: [0, 9],
  riverRough: [0, 200],
  treeLevel: [0, 10],
  orchardLevel: [0, 5],
  grassLevel: [0, 8],
  roughLevel: [0, 8],
  fieldLevel: [0, 8],
  mudLevel: [0, 5],
  urbanisation: [0, 9],
};

export function normalizeSeed(seed: number): number {
  const scaled = Math.floor(Math.abs(seed) * 1_000_000);
  return scaled >>> 0;
}

export function stageSeed(masterSeed: number, stage: string): number {
  let h = (0x811c9dc5 ^ masterSeed) >>> 0;
  for (let i = 0; i < stage.length; i++) {
    h ^= stage.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function getPreset(name?: string): BatLocParams {
  const key = (name ?? 'plains').toLowerCase();
  return structuredClone(BATLOC_PRESETS[key] ?? BATLOC_PRESETS.plains);
}

export interface BatlocValidationError {
  field: string;
  reason: string;
  expected?: string;
  actual?: unknown;
}

export function resolveBatlocConfig(
  presetName: string | undefined,
  overrides: Partial<BatLocParams> | undefined,
): { batloc: BatLocParams; errors: BatlocValidationError[] } {
  const base = getPreset(presetName);
  const merged: BatLocParams = { ...base, ...(overrides ?? {}) };
  const errors: BatlocValidationError[] = [];

  for (const [key, range] of Object.entries(NUMERIC_RANGES) as Array<[keyof typeof NUMERIC_RANGES, [number, number]]>) {
    const value = merged[key];
    if (!Number.isFinite(value)) {
      errors.push({ field: key, reason: 'must be a finite number' });
      continue;
    }
    if (value < range[0] || value > range[1]) {
      errors.push({
        field: key,
        reason: 'out of allowed range',
        expected: `${range[0]}..${range[1]}`,
        actual: value,
      });
    }
  }

  const roadCodes: RoadCode[] = [0, 1, 2, 3, 4, 5, 255];
  if (!roadCodes.includes(merged.roadCode)) {
    errors.push({ field: 'roadCode', reason: 'invalid enum value', expected: '0|1|2|3|4|5|255', actual: merged.roadCode });
  }

  const terrainMods: TerrainMod[] = [0, 1, 2, 3, 4, 5, 6, 7];
  if (!terrainMods.includes(merged.terrainMod)) {
    errors.push({ field: 'terrainMod', reason: 'invalid enum value', expected: '0..7', actual: merged.terrainMod });
  }

  const seasons: Season[] = ['summer', 'winter', 'desert'];
  if (!seasons.includes(merged.season)) {
    errors.push({ field: 'season', reason: 'invalid enum value', expected: 'summer|winter|desert', actual: merged.season });
  }

  if (merged.arid && merged.savannah) {
    errors.push({ field: 'arid/savannah', reason: 'arid and savannah cannot both be true' });
  }

  return { batloc: merged, errors };
}
