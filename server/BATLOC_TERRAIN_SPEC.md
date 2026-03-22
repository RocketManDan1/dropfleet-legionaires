# Batloc-Driven Terrain Generation — Implementation Spec
*Reconciles BATLOC_AUDIT.md (Python generator) with TERRAIN_GENERATOR_AUDIT.md (server)*
*Date: 2026-03-19*

---

## Overview

This spec defines the TypeScript terrain generation system for the server, using the
WinSPMBT BatLoc parameter model as its design blueprint. The goal is a single
`BatLocParams` object that fully describes a map type, a named preset registry covering
all SP batloc types, and an extended `TerrainData` output that satisfies both the
3D renderer and the game simulation.

The Python generator (`generate_map_v2.py`) is the proven reference — its ~20-parameter
model has been validated against real SP maps. This spec translates that system into
TypeScript and fills the gaps the server audit identified.

---

## Part 1 — TerrainType Enum

The current server enum has 10 types. This is the full set needed to represent all
SP batloc outputs and support the game's movement, LOS, and cover systems.

```typescript
export const enum TerrainType {
  // ── Open ground ─────────────────────────────────────────────────────────
  Open        = 0,   // Clear grass — default base
  HighGrass   = 1,   // Tall grass — slows infantry, partial LOS block
  Rough       = 2,   // Rocky/broken ground — slows all, no LOS block
  Sand        = 3,   // Desert/beach sand — slows wheeled
  Rock        = 4,   // Impassable cliff face / boulder field

  // ── Vegetation ──────────────────────────────────────────────────────────
  Forest      = 5,   // Temperate trees — slows all, hard LOS block
  Jungle      = 6,   // Dense tropical canopy — very slow, hard LOS block
  Orchard     = 7,   // Fruit trees in rows — light LOS block, moderate slow
  Scrub       = 8,   // Low bush/savannah vegetation — partial LOS block

  // ── Agriculture ─────────────────────────────────────────────────────────
  Crops       = 9,   // Standing grain/crops — partial LOS block
  Fields      = 10,  // Tilled/fallow fields — no special effect
  RicePaddy   = 11,  // Flooded paddy — very slow, impassable to tracked

  // ── Wet terrain ─────────────────────────────────────────────────────────
  Mud         = 12,  // Mud — severe slow, tracked bogging risk
  Swamp       = 13,  // Swamp — very slow, tracked impassable
  Marsh       = 14,  // Open marsh — very slow, no LOS block

  // ── Winter overlays (applied over base terrain in winter season) ─────────
  Snow        = 15,  // Snow-covered open ground
  Ice         = 16,  // Frozen water surface — fast but fragile

  // ── Coastal ─────────────────────────────────────────────────────────────
  Beach       = 17,  // Sandy shore — slows wheeled/tracked, fast foot

  // ── Water ───────────────────────────────────────────────────────────────
  Water       = 18,  // Deep water — impassable except amphibious/air
  ShallowWater = 19, // Fordable shallows — slow, passable foot/tracked

  // ── Infrastructure ──────────────────────────────────────────────────────
  Road        = 20,  // Paved/dirt road — fast for all
  Bridge      = 21,  // Bridge over water — road speed, weight limit
  Pavement    = 22,  // Urban paved surface — fast movement

  // ── Urban ───────────────────────────────────────────────────────────────
  Urban       = 23,  // Built-up area — slow, hard LOS block, high cover
  Industrial  = 24,  // Factory/warehouse zone — same as Urban, heavier
}
```

**Movement cost lookup table** (multiplier applied to unit's base speed):

```typescript
export const TERRAIN_MOVE_COST: Record<TerrainType, {
  track: number; wheel: number; leg: number; hover: number;
}> = {
  [TerrainType.Open]:        { track: 1.0, wheel: 1.5, leg: 1.0, hover: 1.0 },
  [TerrainType.HighGrass]:   { track: 1.5, wheel: 2.0, leg: 1.0, hover: 1.0 },
  [TerrainType.Rough]:       { track: 2.5, wheel: 5.5, leg: 1.5, hover: 1.5 },
  [TerrainType.Sand]:        { track: 1.5, wheel: 3.0, leg: 1.5, hover: 1.0 },
  [TerrainType.Rock]:        { track: 99,  wheel: 99,  leg: 2.0, hover: 99  },
  [TerrainType.Forest]:      { track: 2.0, wheel: 4.5, leg: 1.5, hover: 2.0 },
  [TerrainType.Jungle]:      { track: 3.0, wheel: 8.0, leg: 2.0, hover: 3.0 },
  [TerrainType.Orchard]:     { track: 1.5, wheel: 2.5, leg: 1.0, hover: 1.5 },
  [TerrainType.Scrub]:       { track: 1.5, wheel: 2.0, leg: 1.0, hover: 1.0 },
  [TerrainType.Crops]:       { track: 1.0, wheel: 1.5, leg: 1.0, hover: 1.0 },
  [TerrainType.Fields]:      { track: 1.0, wheel: 1.5, leg: 1.0, hover: 1.0 },
  [TerrainType.RicePaddy]:   { track: 99,  wheel: 99,  leg: 2.5, hover: 2.0 },
  [TerrainType.Mud]:         { track: 4.0, wheel: 99,  leg: 2.0, hover: 2.0 },
  [TerrainType.Swamp]:       { track: 99,  wheel: 99,  leg: 2.0, hover: 99  },
  [TerrainType.Marsh]:       { track: 4.0, wheel: 99,  leg: 2.0, hover: 3.0 },
  [TerrainType.Snow]:        { track: 1.5, wheel: 2.0, leg: 1.5, hover: 1.0 },
  [TerrainType.Ice]:         { track: 1.0, wheel: 1.5, leg: 1.5, hover: 1.0 },
  [TerrainType.Beach]:       { track: 2.0, wheel: 3.0, leg: 1.0, hover: 1.0 },
  [TerrainType.Water]:       { track: 99,  wheel: 99,  leg: 99,  hover: 99  },
  [TerrainType.ShallowWater]:{ track: 3.0, wheel: 99,  leg: 2.0, hover: 2.0 },
  [TerrainType.Road]:        { track: 0.5, wheel: 0.5, leg: 0.5, hover: 0.5 },
  [TerrainType.Bridge]:      { track: 0.5, wheel: 0.5, leg: 0.5, hover: 0.5 },
  [TerrainType.Pavement]:    { track: 0.5, wheel: 0.5, leg: 0.5, hover: 0.5 },
  [TerrainType.Urban]:       { track: 2.0, wheel: 2.0, leg: 1.5, hover: 2.5 },
  [TerrainType.Industrial]:  { track: 2.0, wheel: 2.0, leg: 1.5, hover: 2.5 },
};

// LOS blocking — true = this terrain type blocks line of sight
export const TERRAIN_BLOCKS_LOS: Record<TerrainType, boolean> = {
  [TerrainType.Forest]:    true,
  [TerrainType.Jungle]:    true,
  [TerrainType.Urban]:     true,
  [TerrainType.Industrial]:true,
  [TerrainType.Orchard]:   true,  // partial — implement as range × 0.50 (see Spotting and Contact Model §LOS Reduction Rules)
  [TerrainType.Crops]:     true,  // partial
  [TerrainType.HighGrass]: true,  // partial
  // all others: false
};
```

---

## Part 2 — BatLocParams Interface

Full translation of the SP BatLoc system into TypeScript.

```typescript
export type Season = 'summer' | 'winter' | 'desert';

export type RoadCode =
  | 0    // Standard dirt roads only
  | 1    // Bocage track — narrow lanes through fields
  | 2    // Highway + dirt roads (paved primary + dirt secondary)
  | 3    // Urban grid roads
  | 4    // Desert tracks (sparse, straight)
  | 5    // Jungle trails (very sparse, winding)
  | 255; // No roads at all

export type TerrainMod =
  | 0   // None — no post-processing
  | 1   // Bocage — tree hedges along all field edges
  | 2   // Tropical river fringe — palm/bamboo density boost near water
  | 3   // Orchard rows — tree lines edging field blocks
  | 4   // Earth roads — dirt tracks cut through fields
  | 5   // Polder / dyke network — low flat with drainage channels
  | 6   // Forest edge rows — tree lines at forest/field boundaries
  | 7;  // Shell damage — rough patches scattered across open ground

export interface BatLocParams {
  name: string;
  id: number;

  // ── Elevation ─────────────────────────────────────────────────────────
  hillDensity:    number;  // 0–10   Number/frequency of hills
  maxHillHeight:  number;  // 0–15   Elevation cap (0 = flat, 15 = extreme)
  hillBaseSize:   number;  // 1–8    Footprint (1 = sharp peaks, 8 = broad plateaus)

  // ── Water ─────────────────────────────────────────────────────────────
  streamsMarsh:   number;  // 0–9    Drives river count + swamp probability
  lakesSize:      number;  // 0–5    Standalone lake count/size (0 = none)
  marshSize:      number;  // 0–5    Standalone marsh count/size (0 = none)

  // ── River bank decoration (% chance per bank cell) ────────────────────
  riverTrees:     number;  // 0–9    Trees along riverbanks
  riverMarsh:     number;  // 0–9    Marsh cells along riverbanks
  riverMud:       number;  // 0–9    Mud cells along riverbanks
  riverRough:     number;  // 0–200  0–100: rough edging %; >100: WADI mode (river dries out)

  // ── Vegetation ────────────────────────────────────────────────────────
  treeLevel:      number;  // 0–10   Forest density (0 = bare, 10 = dense jungle)
  orchardLevel:   number;  // 0–5    Orchard patch frequency
  grassLevel:     number;  // 0–8    High-grass coverage
  roughLevel:     number;  // 0–8    Rocky/broken ground density
  fieldLevel:     number;  // 0–8    Cultivated field coverage
  mudLevel:       number;  // 0–5    Mud patch frequency (0 in desert/winter)

  // ── Urbanisation ──────────────────────────────────────────────────────
  urbanisation:   number;  // 0–9    Settlement density + size
                           //   0 = no roads/buildings (maybe tiny hamlet)
                           //   1–2 = scattered villages
                           //   3–4 = small towns with road network
                           //   5–6 = medium towns
                           //   7–8 = large towns / small cities
                           //   9+  = dense urban
  roadCode:       RoadCode;

  // ── Post-processing ───────────────────────────────────────────────────
  terrainMod:     TerrainMod;

  // ── Base terrain flags ────────────────────────────────────────────────
  season:         Season;
  arid:           boolean; // Base terrain → earth/dirt (mutually exclusive with savannah)
  savannah:       boolean; // Base terrain → dry brown grass

  // ── Special generation modes (not in original SP — added for our system) ─
  coastalEdge?:   'north' | 'south' | 'east' | 'west' | null;
                           // Beach batloc: which map edge is ocean
  wideRiver?:     boolean; // River Crossing batloc: river spans full map width
}
```

---

## Part 3 — Named Preset Registry

All SP generic batloc types plus key historical locations, expressed as `BatLocParams`.
Values carried over from the validated Python generator (`generate_map_v2.py`).

```typescript
export const BATLOC_PRESETS: Record<string, BatLocParams> = {

  // ── Generic archetypes ─────────────────────────────────────────────────

  'plains': {
    name: 'Plains', id: 126,
    hillDensity: 3, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 2, orchardLevel: 1, grassLevel: 5, roughLevel: 1,
    fieldLevel: 4, mudLevel: 0,
    urbanisation: 3, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'forest': {
    name: 'Forest', id: 127,
    hillDensity: 4, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 3, lakesSize: 0, marshSize: 1,
    riverTrees: 3, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 8, orchardLevel: 0, grassLevel: 2, roughLevel: 2,
    fieldLevel: 1, mudLevel: 1,
    urbanisation: 2, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'mountains': {
    name: 'Mountains', id: 128,
    hillDensity: 8, maxHillHeight: 10, hillBaseSize: 2,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 30,
    treeLevel: 4, orchardLevel: 0, grassLevel: 1, roughLevel: 5,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 1, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'jungle': {
    name: 'Jungle', id: 129,
    hillDensity: 3, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 5, lakesSize: 1, marshSize: 2,
    riverTrees: 4, riverMarsh: 2, riverMud: 0, riverRough: 0,
    treeLevel: 9, orchardLevel: 0, grassLevel: 2, roughLevel: 1,
    fieldLevel: 1, mudLevel: 2,
    urbanisation: 1, roadCode: 5, terrainMod: 2,
    season: 'summer', arid: false, savannah: false,
  },

  'desert': {
    name: 'Desert', id: 130,
    hillDensity: 3, maxHillHeight: 5, hillBaseSize: 4,
    streamsMarsh: 0, lakesSize: 0, marshSize: 0,
    riverTrees: 0, riverMarsh: 0, riverMud: 0, riverRough: 110,
    treeLevel: 0, orchardLevel: 0, grassLevel: 0, roughLevel: 4,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 1, roadCode: 4, terrainMod: 0,
    season: 'desert', arid: true, savannah: false,
  },

  'desert-rough': {
    name: 'Desert Rough', id: 141,
    hillDensity: 5, maxHillHeight: 6, hillBaseSize: 2,
    streamsMarsh: 0, lakesSize: 0, marshSize: 0,
    riverTrees: 0, riverMarsh: 0, riverMud: 0, riverRough: 115,
    treeLevel: 0, orchardLevel: 0, grassLevel: 0, roughLevel: 7,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 0, roadCode: 255, terrainMod: 0,
    season: 'desert', arid: true, savannah: false,
  },

  'swamp': {
    name: 'Swamp', id: 142,
    hillDensity: 1, maxHillHeight: 1, hillBaseSize: 6,
    streamsMarsh: 8, lakesSize: 3, marshSize: 4,
    riverTrees: 4, riverMarsh: 5, riverMud: 2, riverRough: 0,
    treeLevel: 5, orchardLevel: 0, grassLevel: 3, roughLevel: 0,
    fieldLevel: 0, mudLevel: 3,
    urbanisation: 0, roadCode: 255, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'marsh': {
    name: 'Marsh', id: 143,
    hillDensity: 0, maxHillHeight: 1, hillBaseSize: 7,
    streamsMarsh: 7, lakesSize: 4, marshSize: 5,
    riverTrees: 2, riverMarsh: 6, riverMud: 1, riverRough: 0,
    treeLevel: 2, orchardLevel: 0, grassLevel: 4, roughLevel: 0,
    fieldLevel: 0, mudLevel: 2,
    urbanisation: 0, roadCode: 255, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'paddy-field': {
    name: 'Paddy Field', id: 144,
    hillDensity: 2, maxHillHeight: 2, hillBaseSize: 5,
    streamsMarsh: 4, lakesSize: 1, marshSize: 2,
    riverTrees: 3, riverMarsh: 2, riverMud: 1, riverRough: 0,
    treeLevel: 4, orchardLevel: 0, grassLevel: 3, roughLevel: 0,
    fieldLevel: 6, mudLevel: 2,
    urbanisation: 2, roadCode: 5, terrainMod: 2,
    season: 'summer', arid: false, savannah: false,
    // fieldLevel at 6 with tropical terrainMod triggers rice paddy placement
    // (see §5: Field Generation — Tropical Mode)
  },

  'savannah': {
    name: 'Savannah', id: 145,
    hillDensity: 2, maxHillHeight: 3, hillBaseSize: 5,
    streamsMarsh: 1, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 0, riverMud: 0, riverRough: 20,
    treeLevel: 1, orchardLevel: 0, grassLevel: 3, roughLevel: 3,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 1, roadCode: 4, terrainMod: 0,
    season: 'summer', arid: false, savannah: true,
  },

  'bocage': {
    name: 'Bocage Hedgerow', id: 133,
    hillDensity: 4, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 3, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 4, orchardLevel: 2, grassLevel: 3, roughLevel: 1,
    fieldLevel: 6, mudLevel: 0,
    urbanisation: 3, roadCode: 1, terrainMod: 1,
    season: 'summer', arid: false, savannah: false,
  },

  'beach': {
    name: 'Beach', id: 146,
    hillDensity: 2, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 1, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 2, orchardLevel: 0, grassLevel: 2, roughLevel: 2,
    fieldLevel: 1, mudLevel: 0,
    urbanisation: 2, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
    coastalEdge: 'south',   // ocean fills the southern half
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
    wideRiver: true,        // 4–6 cell wide river spanning full map width
  },

  // ── City variants ──────────────────────────────────────────────────────

  'plains-city': {
    name: 'Plains City', id: 131,
    hillDensity: 2, maxHillHeight: 2, hillBaseSize: 5,
    streamsMarsh: 1, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 2, orchardLevel: 0, grassLevel: 2, roughLevel: 0,
    fieldLevel: 2, mudLevel: 0,
    urbanisation: 7, roadCode: 2, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'forest-city': {
    name: 'Forest City', id: 132,
    hillDensity: 3, maxHillHeight: 3, hillBaseSize: 3,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 6, orchardLevel: 1, grassLevel: 2, roughLevel: 1,
    fieldLevel: 1, mudLevel: 0,
    urbanisation: 6, roadCode: 2, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'mountain-city': {
    name: 'Mountain City', id: 134,
    hillDensity: 7, maxHillHeight: 8, hillBaseSize: 2,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 20,
    treeLevel: 3, orchardLevel: 0, grassLevel: 1, roughLevel: 4,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 6, roadCode: 2, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'desert-city': {
    name: 'Desert City', id: 135,
    hillDensity: 2, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 0, lakesSize: 0, marshSize: 0,
    riverTrees: 0, riverMarsh: 0, riverMud: 0, riverRough: 110,
    treeLevel: 0, orchardLevel: 0, grassLevel: 0, roughLevel: 2,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 7, roadCode: 3, terrainMod: 0,
    season: 'desert', arid: true, savannah: false,
  },

  'jungle-city': {
    name: 'Jungle City', id: 138,
    hillDensity: 2, maxHillHeight: 3, hillBaseSize: 3,
    streamsMarsh: 4, lakesSize: 0, marshSize: 1,
    riverTrees: 3, riverMarsh: 2, riverMud: 0, riverRough: 0,
    treeLevel: 7, orchardLevel: 0, grassLevel: 2, roughLevel: 0,
    fieldLevel: 2, mudLevel: 1,
    urbanisation: 6, roadCode: 3, terrainMod: 2,
    season: 'summer', arid: false, savannah: false,
  },

  // ── River variants ─────────────────────────────────────────────────────

  'plains-river': {
    name: 'Plains River', id: 136,
    hillDensity: 3, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 5, lakesSize: 1, marshSize: 1,
    riverTrees: 3, riverMarsh: 2, riverMud: 1, riverRough: 0,
    treeLevel: 3, orchardLevel: 1, grassLevel: 4, roughLevel: 1,
    fieldLevel: 3, mudLevel: 1,
    urbanisation: 3, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'forest-river': {
    name: 'Forest River', id: 137,
    hillDensity: 4, maxHillHeight: 5, hillBaseSize: 3,
    streamsMarsh: 5, lakesSize: 1, marshSize: 1,
    riverTrees: 4, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 7, orchardLevel: 0, grassLevel: 2, roughLevel: 2,
    fieldLevel: 1, mudLevel: 1,
    urbanisation: 2, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'mountain-river': {
    name: 'Mountain River', id: 139,
    hillDensity: 7, maxHillHeight: 9, hillBaseSize: 2,
    streamsMarsh: 4, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 0, riverMud: 0, riverRough: 40,
    treeLevel: 4, orchardLevel: 0, grassLevel: 1, roughLevel: 4,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 1, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'desert-river': {
    name: 'Desert River', id: 140,
    hillDensity: 3, maxHillHeight: 4, hillBaseSize: 4,
    streamsMarsh: 3, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 1, orchardLevel: 0, grassLevel: 0, roughLevel: 3,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 2, roadCode: 4, terrainMod: 0,
    season: 'desert', arid: true, savannah: false,
  },

  'jungle-river': {
    name: 'Jungle River', id: 148,
    hillDensity: 3, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 7, lakesSize: 1, marshSize: 2,
    riverTrees: 5, riverMarsh: 3, riverMud: 1, riverRough: 0,
    treeLevel: 8, orchardLevel: 0, grassLevel: 2, roughLevel: 1,
    fieldLevel: 1, mudLevel: 2,
    urbanisation: 1, roadCode: 5, terrainMod: 2,
    season: 'summer', arid: false, savannah: false,
  },

  // ── Named historical locations ──────────────────────────────────────────

  'germany': {
    name: 'Germany', id: 9,
    hillDensity: 4, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 5, orchardLevel: 2, grassLevel: 4, roughLevel: 2,
    fieldLevel: 4, mudLevel: 0,
    urbanisation: 4, roadCode: 2, terrainMod: 6,
    season: 'summer', arid: false, savannah: false,
  },

  'normandy': {
    name: 'Normandy', id: 62,
    hillDensity: 4, maxHillHeight: 5, hillBaseSize: 3,
    streamsMarsh: 3, lakesSize: 0, marshSize: 0,
    riverTrees: 2, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 5, orchardLevel: 3, grassLevel: 3, roughLevel: 2,
    fieldLevel: 4, mudLevel: 0,
    urbanisation: 4, roadCode: 1, terrainMod: 1,
    season: 'summer', arid: false, savannah: false,
  },

  'north-africa': {
    name: 'North Africa', id: 3,
    hillDensity: 4, maxHillHeight: 5, hillBaseSize: 3,
    streamsMarsh: 0, lakesSize: 0, marshSize: 0,
    riverTrees: 0, riverMarsh: 0, riverMud: 0, riverRough: 110,
    treeLevel: 0, orchardLevel: 0, grassLevel: 0, roughLevel: 5,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 1, roadCode: 4, terrainMod: 0,
    season: 'desert', arid: true, savannah: false,
  },

  'middle-east': {
    name: 'Middle East', id: 12,
    hillDensity: 3, maxHillHeight: 4, hillBaseSize: 4,
    streamsMarsh: 0, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 105,
    treeLevel: 1, orchardLevel: 1, grassLevel: 0, roughLevel: 4,
    fieldLevel: 0, mudLevel: 0,
    urbanisation: 3, roadCode: 4, terrainMod: 0,
    season: 'desert', arid: true, savannah: false,
  },

  'finland': {
    name: 'Finland', id: 15,
    hillDensity: 3, maxHillHeight: 3, hillBaseSize: 4,
    streamsMarsh: 4, lakesSize: 3, marshSize: 2,
    riverTrees: 3, riverMarsh: 1, riverMud: 0, riverRough: 0,
    treeLevel: 7, orchardLevel: 0, grassLevel: 2, roughLevel: 2,
    fieldLevel: 1, mudLevel: 0,
    urbanisation: 1, roadCode: 0, terrainMod: 0,
    season: 'winter', arid: false, savannah: false,
  },

  'ardennes': {
    name: 'Ardennes', id: 66,
    hillDensity: 6, maxHillHeight: 6, hillBaseSize: 3,
    streamsMarsh: 3, lakesSize: 0, marshSize: 0,
    riverTrees: 3, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 7, orchardLevel: 0, grassLevel: 2, roughLevel: 3,
    fieldLevel: 1, mudLevel: 0,
    urbanisation: 2, roadCode: 1, terrainMod: 0,
    season: 'winter', arid: false, savannah: false,
  },

  'vietnam': {
    name: 'Vietnam', id: 116,
    hillDensity: 3, maxHillHeight: 4, hillBaseSize: 3,
    streamsMarsh: 5, lakesSize: 1, marshSize: 2,
    riverTrees: 4, riverMarsh: 3, riverMud: 1, riverRough: 0,
    treeLevel: 8, orchardLevel: 0, grassLevel: 2, roughLevel: 1,
    fieldLevel: 2, mudLevel: 2,
    urbanisation: 1, roadCode: 5, terrainMod: 2,
    season: 'summer', arid: false, savannah: false,
  },

  'stalingrad': {
    name: 'Stalingrad', id: 42,
    hillDensity: 2, maxHillHeight: 2, hillBaseSize: 4,
    streamsMarsh: 1, lakesSize: 0, marshSize: 0,
    riverTrees: 0, riverMarsh: 0, riverMud: 1, riverRough: 0,
    treeLevel: 1, orchardLevel: 0, grassLevel: 1, roughLevel: 2,
    fieldLevel: 0, mudLevel: 1,
    urbanisation: 8, roadCode: 3, terrainMod: 7,
    season: 'winter', arid: false, savannah: false,
  },

  'kursk': {
    name: 'Kursk', id: 46,
    hillDensity: 3, maxHillHeight: 3, hillBaseSize: 5,
    streamsMarsh: 2, lakesSize: 0, marshSize: 0,
    riverTrees: 1, riverMarsh: 0, riverMud: 0, riverRough: 0,
    treeLevel: 3, orchardLevel: 1, grassLevel: 6, roughLevel: 1,
    fieldLevel: 5, mudLevel: 0,
    urbanisation: 2, roadCode: 0, terrainMod: 0,
    season: 'summer', arid: false, savannah: false,
  },

  'falklands': {
    name: 'Falklands', id: 240,
    hillDensity: 5, maxHillHeight: 5, hillBaseSize: 3,
    streamsMarsh: 3, lakesSize: 0, marshSize: 2,
    riverTrees: 0, riverMarsh: 2, riverMud: 0, riverRough: 0,
    treeLevel: 0, orchardLevel: 0, grassLevel: 4, roughLevel: 4,
    fieldLevel: 0, mudLevel: 2,
    urbanisation: 0, roadCode: 255, terrainMod: 0,
    season: 'summer', arid: false, savannah: true,
  },
};
```

---

## Part 4 — Generation Pipeline

The generation must run in this fixed order. Each step may read but not modify earlier layers.

```
Step 1  ELEVATION       hillDensity, maxHillHeight, hillBaseSize → heightmap
Step 2  COASTLINE       coastalEdge? → flood one map half with water
Step 3  BASE TERRAIN    season + arid + savannah → base TerrainType per cell
Step 4  WIDE RIVER      wideRiver? → carve full-width river before other water
Step 5  WATER SYSTEM    streamsMarsh → river paths; lakesSize → standalone lakes;
                        marshSize → standalone marshes
Step 6  WADI CHECK      riverRough > 100 → probabilistic river→rough conversion
Step 7  RIVER BANKS     riverTrees/Marsh/Mud/Rough → decorate cells adj. to rivers
Step 8  VEGETATION      treeLevel → forest/jungle; orchardLevel → orchards;
                        grassLevel → high grass; scrub (savannah mode)
Step 9  AGRICULTURE     fieldLevel → crops/fields/rice-paddy (tropical: rice paddy mode)
Step 10 ROUGH / MUD     roughLevel → rough patches; mudLevel → mud patches
Step 11 SETTLEMENTS     urbanisation → town placement + sizing
Step 12 ROADS           roadCode → road network connecting settlements + map edges
Step 13 BRIDGES         auto-place where roads cross rivers
Step 14 TERRAIN MOD     terrainMod 0–7 → post-processing pass (see §5)
Step 15 WINTER PASS     season=winter → snow overlay on all non-water, ice on frozen rivers
Step 16 EDGE TAPER      radial falloff to sea level at ~88% of disc radius
Step 17 DERIVED MAPS    slope, curvature, wetness, cover, visibility
Step 18 SPAWN ZONES     classify attacker/defender edges from map geometry
Step 19 OBJECTIVES      tag bridges, hilltops, crossroads, town centres as VPs
```

---

## Part 5 — Terrain Mod Post-Processing Passes

Executed at Step 14. Each pass reads the current terrain state and modifies it in place.

| terrainMod | Name | What it does |
|---|---|---|
| 0 | None | No-op |
| 1 | Bocage | Place Forest cells along all edges where a crop/field cell meets a non-field cell. Creates the dense hedgerow network. |
| 2 | Tropical Fringe | Boost Forest density near water to Jungle; place scattered palm/jungle cells on river banks even if riverTrees is low. |
| 3 | Orchard Rows | Edge crop/field blocks with Orchard cells (1–2 cell wide rows). |
| 4 | Earth Tracks | Place Road cells cutting through field blocks to connect isolated farmsteads. |
| 5 | Polder / Dyke | Low-elevation cells near water gain ShallowWater; place occasional straight-line Road cells as dyke crossings. |
| 6 | Forest Edge | Place Forest cells in 1–2 cell rows along forest/field boundaries (the "Waldrand" effect common in German maps). |
| 7 | Shell Damage | Scatter Rough cells across ~8% of Open cells regardless of elevation (shell-cratered landscape). |

---

## Part 6 — Special Generation Modes

### 6.1 Beach / Coastline (`coastalEdge` is set)

When `coastalEdge` is not null:
1. Determine the ocean half: everything beyond 45–55% of the map dimension from the coastal edge is Water
2. Apply a 3–5 cell Beach strip along the waterline
3. Taper elevation in the ocean half to below seaLevel
4. Settlement and road generation is excluded from the ocean half
5. Spawn zones: attacker = ocean-side beach strip; defender = inland half

### 6.2 River Crossing (`wideRiver: true`)

When `wideRiver` is true:
1. At Step 4, generate a single river 4–6 cells wide spanning the full map width (or height)
2. The river runs roughly perpendicular to the map's long axis
3. Place 2–4 bridge crossings at varied positions (not evenly spaced)
4. 0–2 ford crossings in shallow/slow sections
5. The road network (Step 12) must connect to at least two bridge/ford points on each bank
6. Spawn zones: attacker = one bank; defender = opposite bank
7. Objectives: all bridges and fords are automatically tagged as VPs

---

## Part 7 — Extended TerrainData

Replace the current `TerrainData` interface. New fields in **bold**.

```typescript
export interface TerrainData {
  // Existing ─────────────────────────────────────────────────────────────
  width:              number;
  height:             number;
  resolution:         number;
  heightmap:          number[];
  slopeMap:           number[];
  curvatureMap:       number[];
  wetnessMap:         number[];
  coverMap:           number[];
  visibilityMap:      number[];
  mountainWeightMap:  number[];
  hillWeightMap:      number[];
  flatlandWeightMap:  number[];
  seaLevel:           number;

  // Changed ──────────────────────────────────────────────────────────────
  biome:              string;    // now the batloc name, e.g. "Plains River"

  // New — terrain classification ─────────────────────────────────────────
  terrainTypeMap:     number[];  // TerrainType per cell, same dims as heightmap

  // New — features ───────────────────────────────────────────────────────
  towns:   TownAnchor[];         // existing, unchanged
  rivers:  RiverFeature[];
  roads:   RoadFeature[];
  bridges: BridgeFeature[];
  fords:   PointFeature[];

  // New — game logic ─────────────────────────────────────────────────────
  spawnZones:   SpawnZone[];
  objectives:   Objective[];

  // New — batloc echo (lets client know what was generated) ──────────────
  batloc:       BatLocParams;
}

// ── Supporting types ────────────────────────────────────────────────────

export interface RiverFeature {
  path:  Array<{ x: number; z: number }>;
  width: 'stream' | 'river' | 'wide';  // stream=1 cell, river=2, wide=4–6
}

export interface RoadFeature {
  path: Array<{ x: number; z: number }>;
  type: 'primary' | 'secondary' | 'dirt' | 'track';
}

export interface BridgeFeature {
  x: number;
  z: number;
  roadType: string;
  maxWeightClass: number;  // 1–5 matching unit weight classes
}

export interface PointFeature {
  x: number;
  z: number;
}

export interface SpawnZone {
  side:  'attacker' | 'defender';
  cells: Array<{ x: number; z: number }>;
}

export interface Objective {
  id:    string;
  label: string;
  x:     number;
  z:     number;
  type:  'bridge' | 'ford' | 'hilltop' | 'crossroads' | 'town' | 'industrial';
}
```

---

## Part 8 — Updated WebSocket Protocol

### generate message

```typescript
// Client → Server
interface GenerateMessage {
  type:    'generate';
  width?:  number;           // 128–768, default 512
  height?: number;           // 128–768, default 512
  seed?:   number;

  // Option A: named preset
  batloc?: string;           // e.g. "plains-river", "germany", "bocage"

  // Option B: custom parameter object (overrides preset)
  params?: Partial<BatLocParams>;
}
```

Resolution order: if `params` is provided, start from `batloc` preset (or 'plains' default)
and apply `params` fields on top. This lets the client send `{ batloc: 'forest', treeLevel: 3 }`
to get a lighter-forest variant without specifying all 20 fields.

### terrain message (server → client)

No change to the message envelope — `TerrainData` is expanded as per §7.
The client receives the same `{ type: 'terrain', data: TerrainData }` message.

---

## Part 9 — Implementation Order

Suggested order to implement without breaking the existing working heightmap:

1. **Add `TerrainType` enum and `TERRAIN_MOVE_COST` table** — pure data, no generation changes
2. **Add `BatLocParams` interface and `BATLOC_PRESETS` registry** — pure data
3. **Wire `batloc` into the `generate` message** — parse preset, pass to generator
4. **Add `terrainTypeMap` to generator output** — classify cells from existing slope/wetness/height data as a first approximation (imperfect but immediately useful)
5. **Add river path export** — `buildFlowAccumulation` already runs; extract paths above a flow threshold and export as `RiverFeature[]`
6. **Add road generation** — A* between town centres, write `RoadFeature[]`
7. **Add bridges** — where road paths cross river cells
8. **Add spawn zones** — simple: two rectangular bands at opposite map edges, filtered for above-sea-level flat terrain
9. **Add objectives** — tag bridges, highest hilltop per quadrant, town centres
10. **Implement full batloc-driven terrain type placement** — replace the approximation in step 4 with proper biome-driven forest/rough/swamp/field generation
11. **Implement terrain mods** — bocage, tropical fringe, etc.
12. **Implement special modes** — beach coastline, wide river crossing

---

## Part 10 — Determinism Contract (Mandatory)

Two servers given the same input tuple `(width, height, seed, batloc, params)` must
produce byte-stable equivalent terrain payloads after normalization (see §12.2).

### 10.1 Seed normalization

Use a canonical 32-bit unsigned seed for all generation stages.

```typescript
function normalizeSeed(seed: number): number {
  // Convert any finite numeric seed into stable uint32 space.
  // Non-finite values are rejected at request validation (see §11).
  const scaled = Math.floor(Math.abs(seed) * 1_000_000);
  return scaled >>> 0;
}
```

### 10.2 Stage seed derivation

Each pipeline stage must use an isolated RNG stream derived from the master seed.
Do not share mutable RNG state across stages.

```typescript
type StageName =
  | 'elevation' | 'coastline' | 'water' | 'vegetation' | 'agriculture'
  | 'rough-mud' | 'settlements' | 'roads' | 'bridges' | 'terrain-mods'
  | 'winter' | 'edge-taper' | 'spawn-zones' | 'objectives';

function stageSeed(masterSeed: number, stage: StageName): number {
  // Deterministic 32-bit FNV-1a over stage label mixed with master seed.
  let h = 0x811c9dc5 ^ masterSeed;
  for (let i = 0; i < stage.length; i++) {
    h ^= stage.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
```

### 10.3 Deterministic processing rules

1. Iterate cells in row-major order: `for (z=0..h-1) for (x=0..w-1)`.
2. Sort operations must include a deterministic secondary key (`x`, then `z`, then id).
3. A* tie-break order must be fixed globally: `N, E, S, W, NE, SE, SW, NW`.
4. Feature IDs must be generated from stable counters by type (`bridge-001`, `obj-bridge-001`).
5. Objective and feature arrays must be output in stable order:
   - primary sort: type order table
   - secondary sort: `z`
   - tertiary sort: `x`

### 10.4 Numeric stability

For hashing, snapshots, and regression comparisons:
- Quantize continuous maps to 6 decimal places.
- Keep integer cell coordinates unrounded.
- Never use locale-sensitive number formatting.

### 10.5 Omitted seed behavior

If client omits `seed`, server may choose any random seed, but must echo the resolved
normalized seed in response metadata so the map can be reproduced.

```typescript
interface GenerationMeta {
  requestedSeed?: number;
  resolvedSeed: number;  // normalized uint32 actually used
  generatorVersion: string;
}
```

---

## Part 11 — Request Validation and Error Model

Validation is mandatory at the websocket boundary before generation begins.

### 11.1 Generate request validation rules

| Field | Rule | On failure |
|---|---|---|
| `type` | Must equal `'generate'` | `INVALID_MESSAGE_TYPE` |
| `width` | Integer, 128-768 | `INVALID_FIELD_RANGE` |
| `height` | Integer, 128-768 | `INVALID_FIELD_RANGE` |
| `seed` | Finite number | `INVALID_FIELD_TYPE` |
| `batloc` | Known preset key in `BATLOC_PRESETS` | `UNKNOWN_BATLOC` |
| `params` | Object with known `BatLocParams` keys only | `INVALID_PARAMS_KEY` |
| `params.<numeric>` | Must be in documented range | `INVALID_FIELD_RANGE` |
| `params.roadCode` | One of `0,1,2,3,4,5,255` | `INVALID_ENUM_VALUE` |
| `params.terrainMod` | One of `0..7` | `INVALID_ENUM_VALUE` |
| `params.season` | One of `'summer'|'winter'|'desert'` | `INVALID_ENUM_VALUE` |
| `params.arid/savannah` | Must not both be true | `INVALID_COMBINATION` |
| unknown top-level keys | Rejected (strict mode) | `UNKNOWN_FIELD` |

### 11.2 Error response envelope

```typescript
interface ErrorResponse {
  type: 'error';
  code:
    | 'INVALID_MESSAGE_TYPE'
    | 'INVALID_FIELD_TYPE'
    | 'INVALID_FIELD_RANGE'
    | 'INVALID_ENUM_VALUE'
    | 'INVALID_PARAMS_KEY'
    | 'UNKNOWN_FIELD'
    | 'UNKNOWN_BATLOC'
    | 'INVALID_COMBINATION'
    | 'TERRAIN_GENERATION_FAILED'
    | 'TERRAIN_INVARIANT_FAILED';
  message: string;
  details?: Array<{
    field: string;
    expected?: string;
    actual?: unknown;
    reason: string;
  }>;
  requestId?: string;
}
```

### 11.3 Post-generation invariants (release mode)

If generation completes but invariant checks fail, return `TERRAIN_INVARIANT_FAILED`
and do not publish partial terrain.

Required invariant names in failure details:
- `array_lengths_match`
- `terrain_type_values_valid`
- `feature_paths_in_bounds`
- `bridge_on_water_crossing`
- `spawn_zones_non_empty`
- `objective_points_unique`

---

## Part 12 — Acceptance Test Vectors

These vectors define the minimum compliance gate for any implementation.

### 12.1 Required fixed-seed scenarios

| Case ID | Preset | Width x Height | Seed | Required assertions |
|---|---|---|---|---|
| A1 | `plains` | 512x512 | `12345` | Non-empty `terrainTypeMap`, >=1 road, >=1 spawn zone each side |
| A2 | `forest-river` | 512x512 | `67890` | >=1 river, >=1 bridge if any road crosses water |
| A3 | `beach` | 512x512 | `24680` | Coastal half water present, beach strip contiguous |
| A4 | `river-crossing` | 512x512 | `13579` | Wide river exists, 2-4 bridges, opposite-bank spawn zones |
| A5 | `stalingrad` | 512x512 | `11223` | High urban share, objectives include town/crossroads |
| A6 | `finland` | 512x512 | `44556` | Winter overlay active, ice only on eligible water |

### 12.2 Snapshot normalization and hash

Determinism checks use a normalized payload hash.

```typescript
function normalizedTerrainHash(data: TerrainData): string {
  // 1) Quantize float maps to 6dp
  // 2) Sort features/objectives by deterministic ordering rules (§10.3)
  // 3) Remove transient metadata except resolvedSeed + generatorVersion
  // 4) Hash JSON string with SHA-256
  return sha256(JSON.stringify(normalizedData));
}
```

A test passes only if:
1. All invariants pass.
2. Required scenario assertions pass.
3. Snapshot hash equals the approved baseline hash for that generator version.

### 12.3 Versioning rule

If algorithm behavior intentionally changes, bump `generatorVersion` and regenerate
baseline hashes in a single reviewable change.
