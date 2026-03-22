# Procedural Building Grammars

This project now includes two hard-sci-fi low-poly district grammars in the client runtime:

- `residential-blocks`
- `industrial-compound`

Implementation lives in `client/src/buildings.ts` and is spawned whenever terrain is received.

## Goals

- Keep silhouettes clean at tactical zoom levels.
- Preserve DRONECOM-like readability over decorative detail.
- Separate residential and industrial massing language.

## Grammar Fields

Each grammar is defined by `DistrictGrammar`:

- `districtType`: `residential | industrial`
- `buildingCount`: min/max instances per district
- `footprintWidth` / `footprintDepth`: min/max footprint dimensions (world units)
- `floors`: min/max storeys
- `floorHeight`: per-floor height range
- `roofWeights`: weighted roof selection (`flat`, `shed`, `sawtooth`)
- `rooftopModuleDensity`: density of rooftop HVAC/electronics modules
- `utilityDensity`: amount of utility clutter (stacks, utility details)
- `clusterRadius`: district spread radius
- `color`: wall/roof/edge/accent palette

## Default Behavior

- Residential districts favor:
  - smaller footprints
  - 1-3 floors
  - mostly flat roofs
  - lower utility clutter

- Industrial districts favor:
  - larger footprints
  - broader, flatter compounds
  - sawtooth roofs
  - denser utility stacks and rooftop modules

## Industrial Themes

Industrial districts now pick one of three silhouette themes:

- `steelworks`
  - higher chimney and frame tower frequency
  - moderate pipes and silos
- `refinery`
  - high silo and pipe-run frequency
  - moderate stacks, fewer frame towers
- `brickworks`
  - high stack + shed annex frequency
  - fewer heavy pipe structures

Themes are selected per industrial district, including annex districts, so nearby compounds can have different industrial identities.

## Placement Rules

- District centers are selected by terrain suitability (slope, wetness, cover, sea proximity).
- Buildings are skipped on steep slopes and submerged terrain.
- District centers are kept separated to avoid overlap.

## Tuning Workflow

1. Edit grammar constants in `client/src/buildings.ts`.
2. Regenerate terrain in the running client (`G` / `Shift+G`).
3. Adjust footprint ranges and densities until silhouettes stay readable at command-view zoom.
