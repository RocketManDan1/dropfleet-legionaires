# Server Terrain Generator — Audit
*Against game requirements from DESIGN_OVERVIEW.md, DRONECOM_VISUAL_ANALYSIS.md, Game Systems Overview.md*
*Date: 2026-03-19*

---

## What the Generator Currently Produces

`generateTerrain(width, height, seed?)` → `TerrainData`

| Field | What it is |
|---|---|
| `heightmap` | Flat float array, 0–1 normalised, row-major |
| `slopeMap` | Gradient magnitude at each point |
| `curvatureMap` | Laplacian (concavity/convexity) |
| `wetnessMap` | Flow accumulation + concavity + flatness |
| `coverMap` | Concavity + wetness + low ground + broken terrain |
| `visibilityMap` | Height + ridgeness + dryness |
| `mountainWeightMap` | Biome blend weight (mountain fraction) |
| `hillWeightMap` | Biome blend weight (hills fraction) |
| `flatlandWeightMap` | Biome blend weight (flatland fraction) |
| `towns` | Array of `{id, type, x, z, radius}` — centroid + radius only |
| `seaLevel` | Float threshold |
| `biome` | Always hardcoded `'mixed'` |

The generator runs once at startup (512×512) and can be re-triggered by a `generate` WebSocket message.
The WebSocket server only handles two message types: `ping` and `generate`.

---

## Missing: Terrain Generator

### 1. Biome / Map Type Selection is Non-Functional

`BiomeType = 'mountains' | 'hills' | 'flatlands' | 'mixed'` exists as a type, but:
- The `biome` field in `TerrainData` is always hardcoded to `'mixed'`
- The `generate` message does not accept a `biome` parameter
- There is no way to request a desert, jungle, winter, or plains map
- The three internal biome param sets (`BIOME_PARAMS`) only differ in elevation shape —
  they produce no climate, vegetation, or terrain-type variation

**What's needed:**
- A `biome` or `batloc` parameter on the `generate` message
- Biome enum extended to cover the game's scenarios: `'plains' | 'forest' | 'desert' | 'mountains' | 'jungle' | 'winter' | 'urban' | 'mixed'`
- Per-biome terrain classification rules (see §4 below)

---

### 2. No River / Water Feature Data

`buildFlowAccumulation()` runs internally and feeds into `wetnessMap`, but:
- **No river path data is exported.** `TerrainData` has no `rivers`, `riverCells`, or `waterFeatures` field
- The client cannot render rivers; it only receives a wetness heatmap
- No river width, no branching, no connection to sea
- No stream vs. wide-river distinction
- No ford or crossing point identification

**What's needed:**
```typescript
rivers: Array<{
  path: Array<{x: number; z: number}>;
  width: 'stream' | 'river';
}>;
fords: Array<{x: number; z: number}>;
```

---

### 3. No Road Network

Towns are placed but never connected. `TerrainData` has no road data at all.

**What's needed:**
- A* pathfinding between town centres, avoiding steep slopes and water
- Primary roads (between major towns) and secondary roads (village connections)
- Road intersections / crossroads identified
- Bridge points where roads cross rivers
```typescript
roads: Array<{
  path: Array<{x: number; z: number}>;
  type: 'primary' | 'secondary' | 'dirt';
}>;
bridges: Array<{x: number; z: number; roadType: string}>;
```

---

### 4. No Terrain Type Classification

The current output is all continuous floats. The game's movement, LOS, and combat systems
need a discrete terrain type per cell. Right now the client has no basis to render
forest, urban, rough, swamp, or open ground differently — only raw height and proxy maps.

**What's needed:**
```typescript
terrainTypeMap: number[];  // flat array, same dimensions as heightmap
```

With values drawn from a terrain type enum:
```typescript
enum TerrainType {
  Open = 0,
  Rough = 1,
  Forest = 2,
  Urban = 3,
  Swamp = 4,
  Sand = 5,
  Rock = 6,
  Water = 7,
  Road = 8,
  Bridge = 9,
}
```

This map is required by:
- Movement system (terrain cost multiplier per `MoveClass`)
- LOS system (forest and buildings block line of sight)
- Cover/suppression system (rough and forest grant cover)
- Town rendering (urban tiles need building placement)

---

### 5. No Discrete Grid / Hex Cell Structure

Game Systems doc states pathfinding uses A* on a nav mesh from the heightmap.
The Design Overview raises the square vs. hex grid question (resolved as TBD).
Currently `TerrainData` is a raw heightmap with no grid abstraction.

**What's needed:**
- A cell-resolution layer (e.g., every N×N heightmap samples = 1 cell)
- Per-cell: average height, terrain type, movement cost per class, LOS flag
- Or: explicit hex grid data with axial coordinates

This does not have to replace the heightmap — the heightmap drives the 3D mesh,
the cell grid drives game logic.

---

### 6. No Movement Cost Data

Game Systems Overview defines 5 movement classes (Track, Wheel, Leg, Hover, Air)
with terrain cost multipliers. The server generates no movement cost map.
The client would have to re-derive costs from raw maps at runtime, which is fragile.

**What's needed:**
```typescript
movementCosts: {
  track: number[];
  wheel: number[];
  leg: number[];
  hover: number[];
  // air: no terrain cost
};
```
Or: a single `terrainTypeMap` (§4) from which the client looks up costs via a table.

---

### 7. No Vegetation / Forest Placement

`coverMap` is a proxy for "where forest might be" but no actual forest regions are generated.
The client has no data from which to render trees, determine LOS blocking, or apply
forest movement penalties.

**What's needed:**
- Forest cells in `terrainTypeMap` (see §4)
- Biome-driven density: jungle = 70% forest, plains = 15%, desert = 0%
- Forest blocks LOS (critical for spotting system)

---

### 8. No Urban Layout Data

Towns are `{id, type, x, z, radius}` — a centroid and a bounding radius. There is no:
- Street grid or road layout within the town
- Building footprints or density
- Industrial vs. residential zone distinction beyond the `type` field
- Relation between town boundary and `terrainTypeMap`

**What's needed for rendering:** town cells marked as `TerrainType.Urban` in `terrainTypeMap`, with radius controlling the extent.

**What's needed for game logic:** urban terrain is slow to traverse, high cover, blocks LOS — all derived from `terrainTypeMap`, so §4 is the blocker here.

---

### 9. Edge Taper Not Applied to Heightmap

DRONECOM_VISUAL_ANALYSIS.md §7: "terrain height smoothly tapers to sea level as it approaches the disc edge (starts at ~85–90% of disc radius)."

The generator applies **no edge taper** to the heightmap before sending it. The client
presumably applies this client-side, but the taper is documented as a server-side
generation concern since it affects valid spawn zones and map usability.

**What's needed:**
- Radial falloff applied to heightmap values before export
- Any cells within the tapered zone should be excluded from spawn zone candidates

---

### 10. No Spawn Zone Data

The game needs to place player units on the map. There are no designated deployment
zones in `TerrainData`. The server currently has no concept of:
- Attacker vs. defender edges
- Valid spawn positions (above sea level, not too steep, accessible)
- Exclusion zones (impassable terrain, urban cores, water)

**What's needed:**
```typescript
spawnZones: Array<{
  side: 'attacker' | 'defender';
  cells: Array<{x: number; z: number}>;
}>;
```

---

### 11. No Objective / Victory Point Placement

Scenarios need objectives. Nothing in `TerrainData` marks tactically significant
positions (bridges, crossroads, hilltops, town centres) as potential objectives.

**What's needed:**
```typescript
objectives: Array<{
  id: string;
  label: string;
  x: number;
  z: number;
  type: 'bridge' | 'hilltop' | 'crossroads' | 'town' | 'industrial';
}>;
```

Town anchors and bridges are already implicit in the generation — this just needs tagging.

---

### 12. Biome-Specific Features Not Implemented

Even if biome selection were exposed (§1), the following biome-specific terrain features
have no implementation:

| Feature | Needed by |
|---|---|
| Desert sand dunes (directional noise ridges) | Desert biome |
| Rice paddy grid patterns (flat irrigated strips) | Jungle / SE Asia biome |
| Bocage hedgerow edge detection | European temperate biome |
| Frozen river / ice surface (winter biome) | Winter biome |
| Dense jungle canopy (high-density forest, wet base) | Jungle biome |
| Wadi / dry riverbed (river_rough mode) | Desert biome |

---

## Missing: WebSocket Protocol

### 13. Generate Message Has No Biome / Config Parameters

```typescript
// Current: only width, height, seed
{ type: 'generate', width: 512, height: 512, seed: 12345 }

// Needed:
{
  type: 'generate',
  width: 512,
  height: 512,
  seed: 12345,
  biome: 'plains',         // map type
  urbanisation: 3,         // 0–9
  waterDensity: 2,         // 0–9
  forestDensity: 4,        // 0–9
  hillDensity: 3,          // 0–9
}
```

---

### 14. No Room / Lobby System

Index.ts holds a single global `terrain` variable. There is no:
- Room creation / join flow
- Multiple concurrent games
- Player identity or session tracking
- Per-room game state

Every client connected gets the same terrain. A new `generate` from any client
replaces the terrain for all clients.

**What's needed:** a room manager (Map of roomId → gameState) before multiplayer is viable.

---

### 15. No Game State — Only Terrain

The server stores only terrain. There is no:
- Unit positions or states
- Tick loop
- Order queue
- Player connections associated with a game

The entire game simulation described in Game Systems Overview does not exist yet.

---

### 16. No State Delta Broadcasting

When terrain is regenerated, the full terrain blob is sent to the requesting client only.
There is no:
- Broadcast to all clients in a room when state changes
- Incremental / delta updates
- Unit position updates
- Combat event messages

---

## Missing: Infrastructure

### 17. No LOS (Line-of-Sight) Computation

Game System 2 (Spotting) requires LOS checks against the heightmap.
The server exports `visibilityMap` as a proxy but no actual raycasting or
terrain occlusion computation is implemented.

**What's needed:** a server-side LOS function:
```typescript
function hasLineOfSight(
  terrain: TerrainData,
  from: {x: number; z: number},
  to: {x: number; z: number},
  sensorHeight: number
): boolean
```

This must run on the server (authoritative) for spotting resolution,
not the client.

---

### 18. No Unit Database Loading

Design Overview: "server loads unit database from /data/*.json at startup."
`index.ts` does not load any unit data. No `/data` volume is mounted.
The OBF extraction pipeline (CSV → JSON) output is not consumed anywhere.

---

## Summary: Gap Table

| Category | Gap | Priority |
|---|---|---|
| **Generation** | Biome/batloc parameter not exposed | High |
| **Generation** | No river path data exported | High |
| **Generation** | No road network | High |
| **Generation** | No terrain type classification map | High |
| **Generation** | No movement cost data | High |
| **Generation** | No discrete cell/grid layer | High |
| **Generation** | No forest/vegetation regions | High |
| **Generation** | No spawn zones | High |
| **Generation** | No urban layout (just centroid+radius) | Medium |
| **Generation** | Edge taper not applied server-side | Low |
| **Generation** | No objective/VictoryPoint placement | Medium |
| **Generation** | Biome-specific features (dunes, paddy, bocage, wadi) | Low |
| **Protocol** | generate message has no biome/config params | High |
| **Protocol** | No room/lobby system (single global terrain) | High |
| **Protocol** | No game state (units, orders, tick) | High |
| **Protocol** | No broadcast / state delta | High |
| **Simulation** | No LOS computation | Medium |
| **Simulation** | No unit database loaded | Medium |
