# Terrain Generation Implementation Plan
*Date: 2026-03-20*
*Scope: server-side terrain pipeline and websocket protocol*

## 1. Purpose

This document is the execution plan for implementing the terrain system described in:
- `BATLOC_TERRAIN_SPEC.md`
- `TERRAIN_GENERATOR_AUDIT.md`

It is written to be actionable by a future engineer without needing to reverse-engineer intent from multiple files.

## 2. Current Baseline (Confirmed)

Current server behavior in `src/terrain.ts` and `src/index.ts`:
- Produces continuous maps only: `heightmap`, `slopeMap`, `curvatureMap`, `wetnessMap`, `coverMap`, `visibilityMap`
- Produces town anchors (`id/type/x/z/radius`) only
- Hardcodes biome as `mixed`
- No discrete terrain classification
- No river feature export
- No roads/bridges/fords
- No spawn zones/objectives
- `generate` websocket message supports only width/height/seed

## 3. Target End State

Server produces deterministic terrain by preset or custom BatLoc parameters, returning a `TerrainData` payload with:
- Discrete `terrainTypeMap`
- Feature graphs (`rivers`, `roads`, `bridges`, `fords`)
- Spawn and objective data
- BatLoc echo (`batloc`)
- Existing continuous maps retained for rendering and analytics

## 4. Design Principles

1. Deterministic generation
- Same `(width, height, seed, batloc, params)` must produce identical output.

2. Backward compatibility during rollout
- Keep existing fields until client migration is complete.

3. Layered generation
- Run fixed pipeline order from terrain spec; each stage consumes prior layers.

4. Single source of truth for game logic
- Terrain movement and LOS semantics derive from `terrainTypeMap` plus static lookup tables.

5. Testability over cleverness
- Prefer explicit, pure helpers and snapshot/metrics tests over hidden heuristics.

## 5. File and Module Plan

## 5.1 New files

- `src/terrain-types.ts`
  - `TerrainType` enum
  - `TERRAIN_MOVE_COST`
  - LOS blocking metadata

- `src/batloc.ts`
  - `BatLocParams` types
  - preset registry
  - preset resolution (`resolveBatlocConfig`)

- `src/terrain-pipeline.ts`
  - main orchestrator for ordered generation stages

- `src/generation/` (folder)
  - `elevation.ts`
  - `water.ts`
  - `vegetation.ts`
  - `agriculture.ts`
  - `settlements.ts`
  - `roads.ts`
  - `terrain-mods.ts`
  - `winter.ts`
  - `edge-taper.ts`
  - `spawn-zones.ts`
  - `objectives.ts`

- `src/protocol.ts`
  - websocket message schemas/parsers for `generate`

- `src/validation.ts`
  - map sanity checks and invariant validation helpers

## 5.2 Existing files to update

- `src/terrain.ts`
  - convert to orchestration facade, then gradually decompose to modules

- `src/index.ts`
  - parse new generate message shape (`batloc`, `params`)

## 6. Data Contracts

## 6.1 Extend TerrainData

Add fields from spec:
- `terrainTypeMap: number[]`
- `rivers: RiverFeature[]`
- `roads: RoadFeature[]`
- `bridges: BridgeFeature[]`
- `fords: PointFeature[]`
- `spawnZones: SpawnZone[]`
- `objectives: Objective[]`
- `batloc: BatLocParams`

Keep existing maps to avoid client breakage.

## 6.2 Message contract

New accepted request:

```ts
{
  type: 'generate',
  width?: number,
  height?: number,
  seed?: number,
  batloc?: string,
  params?: Partial<BatLocParams>
}
```

Resolution:
- Start with preset from `batloc` (default `plains`)
- Apply `params` as overrides
- Validate ranges and enums
- Reject invalid requests with `error` message

## 7. Generation Pipeline (Implementation Breakdown)

Implement in exact order below. Each stage has explicit inputs/outputs.

1. Elevation
- Input: map size, seed, batloc hill params
- Output: `heightmap`, weight maps, `seaLevel`

2. Coastline mode
- Input: `coastalEdge?`
- Output: water mask + adjusted height in ocean half

3. Base terrain assignment
- Input: season/arid/savannah
- Output: initial `terrainTypeMap` baseline

4. Wide-river mode
- Input: `wideRiver?`
- Output: carved wide river corridor + base river feature

5. Water system
- Input: `streamsMarsh/lakesSize/marshSize`
- Output: `rivers`, lakes/marsh cells, provisional `fords`

6. Wadi conversion
- Input: `riverRough`
- Output: river segments converted to rough for arid modes

7. River-bank decoration
- Input: `riverTrees/riverMarsh/riverMud/riverRough`
- Output: nearby vegetation/wet terrain painting

8. Vegetation
- Input: tree/orchard/grass levels + season
- Output: forest/jungle/orchard/high-grass/scrub cells

9. Agriculture
- Input: `fieldLevel`, tropical mode
- Output: fields/crops/rice paddy distribution

10. Rough/mud pass
- Input: rough/mud levels
- Output: rough and mud patch overlays

11. Settlements
- Input: `urbanisation`
- Output: town anchors + urban/industrial footprint painting

12. Roads
- Input: settlements + roadCode + terrain costs
- Output: `roads` path network

13. Bridges
- Input: roads + rivers
- Output: `bridges` and bridge terrain cells

14. Terrain mod pass
- Input: `terrainMod`
- Output: bocage/tropical fringe/etc. modifications

15. Winter pass
- Input: season
- Output: snow and ice overlays

16. Edge taper
- Input: radius profile
- Output: tapered elevation and edge water harmonization

17. Derived maps
- Input: final height + terrain
- Output: slope/curvature/wetness/cover/visibility

18. Spawn zones
- Input: terrain + slope + water + scenario geometry
- Output: attacker/defender spawn cells

19. Objectives
- Input: towns, bridges, crossroads, hilltops
- Output: objective list

## 8. Algorithm Notes (Practical Choices)

## 8.1 Rivers
- Build D8 downhill graph from elevation
- Use flow accumulation threshold for channel extraction
- Skeletonize channel to centerline path
- Classify width by local discharge quantiles

## 8.2 Roads
- Build cost grid from terrain type + slope penalty
- Use A* between selected settlement pairs
- `primary`: largest town connectors
- `secondary/dirt/track`: local connectors by roadCode and urbanisation
- Permit crossing rivers only where bridge placement is allowed

## 8.3 Urban footprints
- Convert town radius to soft brush mask
- Promote center to `Urban` or `Industrial`
- Add local pavement/road ring in dense settlements
- Keep minimum standoff from deep water cells

## 8.4 Objectives
- Bridge objectives: one per bridge
- Crossroads objectives: graph nodes with degree >= 3
- Hilltop objectives: local maxima above percentile threshold
- Town objectives: center of each major settlement

## 9. Validation and Invariants

Run validators after generation; fail fast in development builds.

Required invariants:
- Arrays have exact `width * height` length
- Terrain type values are valid enum members
- Rivers/roads paths lie in bounds
- Bridges occur where road intersects water
- Spawn cells are above sea level and pass slope cutoff
- Objective points are in bounds and deduplicated

Operational metrics to log:
- Terrain type histogram
- River count / total river length
- Road count / total road length
- Bridge count
- Spawn cell counts per side
- Objective counts by type

## 10. Rollout Strategy

## Phase A: Data scaffolding (low risk)
- Add enums/tables/types/presets
- Wire `generate` parsing with batloc/params
- Keep old generation behavior

Exit criteria:
- Build passes
- Generate accepts new request shape

## Phase B: Terrain type map MVP
- Add initial classifier using existing maps
- Include `terrainTypeMap` in payload

Exit criteria:
- Client receives and can render typed terrain
- Movement table lookup possible

## Phase C: Hydrology and transport
- Export rivers
- Add roads and bridges
- Add fords

Exit criteria:
- At least one valid route between major towns
- Bridges align with water crossings

## Phase D: Gameplay layers
- Spawn zones and objectives
- Terrain mods
- Winter/coast/wide-river special modes

Exit criteria:
- Scenario-ready map metadata generated

## Phase E: Hardening
- Deterministic tests
- Property/invariant tests
- Performance tuning for 512x512 and 768x768

Exit criteria:
- Generation time and memory within acceptable budget

## 11. Testing Plan

## 11.1 Unit tests
- Batloc resolver and range validation
- Terrain type classifier rules
- River extraction on synthetic heightmaps
- A* pathing cost behavior across terrain types

## 11.2 Integration tests
- Snapshot terrain payload for fixed seeds and presets
- Validate invariants for each preset
- Regression test for special modes (`beach`, `river-crossing`, `winter`)

## 11.3 Property tests (optional but recommended)
- For random seeds, assert no out-of-bounds features
- Ensure spawn zones are non-empty for supported presets

## 11.4 Performance tests
- Benchmark generation at 256, 512, 768
- Track time per stage and total memory

## 12. Performance Budget (Initial)

Targets for release candidate:
- 512x512 generation: <= 1.2s on dev machine
- 768x768 generation: <= 2.8s
- Peak RAM during generation: <= 400MB for largest map

If over budget:
- Reuse typed arrays
- Avoid repeated full-map scans when possible
- Replace sort-heavy operations with bucketed thresholds

## 13. Risk Register and Mitigations

1. Risk: Overwriting terrain semantics between later stages
- Mitigation: stage-level precedence table and immutable input snapshots in tests

2. Risk: Roads fail in wet/mountain presets
- Mitigation: fallback route rules and relaxed penalties on final attempt

3. Risk: Spawn zones invalid for special modes
- Mitigation: mode-specific spawn generator (coastline and wide-river)

4. Risk: Client breaks from payload growth
- Mitigation: feature flags or compatibility mode; compress large arrays if needed

## 14. Definition of Done

Implementation is complete when:
- `generate` supports batloc and partial param overrides
- `TerrainData` includes all new fields from spec
- All stage invariants pass for all presets in registry
- Snapshot tests are stable across runs
- Basic client rendering can differentiate water/forest/urban/roads/bridges
- Spawn zones and objectives are present and plausible

## 15. Immediate Next Tasks (First Sprint)

1. Add `terrain-types.ts` and `batloc.ts`
2. Extend `TerrainData` and websocket `generate` parser
3. Build `terrainTypeMap` MVP classifier from existing maps
4. Add validator module and run it on every generation in dev mode
5. Add integration snapshots for 3 presets and fixed seeds

## 16. Notes for Future Contributors

- Keep procedural constants centralized and named.
- Do not add one-off magic thresholds in random files.
- Any stage that mutates terrain must include a short rule comment and a test.
- Prefer adding a new pass over embedding unrelated logic into existing passes.

## 17. Spec Hardening Checklist (Execution)

This checklist turns the terrain spec into an implementation-safe contract.

## 17.1 Determinism hardening

- [ ] Add `normalizeSeed(seed)` helper and use one canonical uint32 master seed
- [ ] Derive per-stage seeds from `(masterSeed, stageName)`
- [ ] Remove shared mutable RNG across stages
- [ ] Enforce deterministic traversal and tie-break ordering for all sorts/A* expansions
- [ ] Standardize stable ID generation for features/objectives
- [ ] Add normalized payload hashing utility for fixed-seed snapshots

Done criteria:
- Re-running the same fixed-seed test 100 times yields identical hash.

## 17.2 Request validation hardening

- [ ] Add strict parser for websocket `generate` message
- [ ] Reject unknown top-level fields
- [ ] Reject unknown `params` keys
- [ ] Validate all range and enum constraints from `BatLocParams`
- [ ] Enforce `!(arid && savannah)`
- [ ] Return structured error envelope with machine-readable `code`

Done criteria:
- Fuzzed malformed requests never reach generation pipeline.

## 17.3 Post-generation invariant hardening

- [ ] Validate array lengths and terrain enum bounds
- [ ] Validate all path features are in bounds
- [ ] Validate every bridge sits on road/water crossing
- [ ] Validate attacker/defender spawn zones are both non-empty
- [ ] Validate objective uniqueness and in-bounds coordinates
- [ ] Fail closed: do not emit partial terrain payload on invariant failure

Done criteria:
- Invariant test suite passes for all presets and fixed seeds.

## 17.4 Acceptance vectors and baselines

- [ ] Add six fixed-seed scenario tests (`plains`, `forest-river`, `beach`, `river-crossing`, `stalingrad`, `finland`)
- [ ] Assert scenario-specific guarantees (bridges, coast, winter overlay, spawn geometry)
- [ ] Store approved normalized hashes with `generatorVersion`
- [ ] Add CI gate to fail on hash drift without explicit version bump

Done criteria:
- CI determinism suite is green and blocks accidental behavior drift.

## 18. Immediate Build Order (Next Sprint)

1. Implement strict generate parser and error envelope in `src/protocol.ts`.
2. Implement seed normalization and stage-seed helpers in `src/generation/rng.ts`.
3. Wire determinism rules into `src/terrain-pipeline.ts` ordering and feature sorting.
4. Implement invariant validator with fail-closed behavior in `src/validation.ts`.
5. Add fixed-seed acceptance vectors and normalized hash snapshots in test suite.

Sprint success criteria:
- A failing malformed request returns structured error without side effects.
- A fixed-seed terrain request is byte-stable after normalization.
- All registered presets pass invariants.
