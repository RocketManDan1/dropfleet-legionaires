# Unit Pathfinding
*Federation Legionaires — authoritative pathfinding specification*
*Last updated: 2026-03-22*

---

## 1. Overview

All unit movement is resolved **server-side** in continuous world-space metres.
Pathfinding converts a player's MOVE order into a sequence of waypoints the unit
follows during the Movement Resolution phase (Phase 3 of the tick loop).

The system has three layers:

| Layer | Runs When | Frequency | Output |
|-------|-----------|-----------|--------|
| **Cost Grid** | Map generation | Once per mission | `CostGrid` per moveClass |
| **Path Search** | Order accepted | On demand | `Vec2[]` waypoint list |
| **Movement Integration** | Every tick | 20 Hz | Updated `posX`, `posZ`, `heading` |

---

## 2. Coordinate System

```
X = east     (metres from map origin)
Z = north    (metres from map origin)
Y = up       (elevation, derived from heightmap)
```

All pathfinding operates in the XZ plane. Elevation is used only for slope cost
and LOS — not for route geometry.

### 2.1 Grid ↔ World Conversion

```typescript
// TerrainData provides: width, height, resolution (metres per cell)
function worldToCell(wx: number, wz: number, res: number): [number, number] {
  return [Math.floor(wx / res), Math.floor(wz / res)];
}

function cellToWorld(col: number, row: number, res: number): [number, number] {
  return [(col + 0.5) * res, (row + 0.5) * res];  // cell centre
}
```

`resolution` is the TerrainData cell size in metres — typically **10 m** for a
512×512 map covering 5120 m × 5120 m.

---

## 3. Cost Grid Generation

### 3.1 When to Build

Build **five** cost grids (one per `MoveClass`) immediately after terrain
generation, before any unit is placed. Store them on the mission state object.

```typescript
type MoveClass = 'track' | 'wheel' | 'leg' | 'hover' | 'air';
```

### 3.2 Cell Cost Computation

Each cell's cost is the product of two factors:

```
cellCost = terrainMoveCost × slopePenalty
```

#### 3.2.1 Terrain Move Cost Table

Canonical costs per terrain type per moveClass. A cost of `99` means impassable.

| Terrain | Track | Wheel | Leg | Hover | Air |
|---------|------:|------:|----:|------:|----:|
| Open | 1.0 | 1.5 | 1.0 | 1.0 | 1.0 |
| HighGrass | 1.5 | 2.0 | 1.0 | 1.0 | 1.0 |
| Rough | 2.5 | 5.5 | 1.5 | 1.5 | 1.0 |
| Sand | 1.5 | 3.0 | 1.5 | 1.0 | 1.0 |
| Rock | 99 | 99 | 2.0 | 99 | 1.0 |
| Forest | 2.0 | 4.5 | 1.5 | 2.0 | 1.0 |
| Jungle | 3.0 | 8.0 | 2.0 | 3.0 | 1.0 |
| Orchard | 1.5 | 2.5 | 1.0 | 1.5 | 1.0 |
| Scrub | 1.5 | 2.0 | 1.0 | 1.0 | 1.0 |
| Crops | 1.0 | 1.5 | 1.0 | 1.0 | 1.0 |
| Fields | 1.0 | 1.5 | 1.0 | 1.0 | 1.0 |
| RicePaddy | 99 | 99 | 2.5 | 2.0 | 1.0 |
| Mud | 4.0 | 99 | 2.0 | 2.0 | 1.0 |
| Swamp | 99 | 99 | 2.0 | 99 | 1.0 |
| Marsh | 4.0 | 99 | 2.0 | 3.0 | 1.0 |
| Snow | 1.5 | 2.0 | 1.5 | 1.0 | 1.0 |
| Ice | 1.0 | 1.5 | 1.5 | 1.0 | 1.0 |
| Beach | 2.0 | 3.0 | 1.0 | 1.0 | 1.0 |
| Water | 99 | 99 | 99 | 99 | 1.0 |
| ShallowWater | 3.0 | 99 | 2.0 | 2.0 | 1.0 |
| Road | 0.5 | 0.5 | 0.5 | 0.5 | 1.0 |
| Bridge | 0.5 | 0.5 | 0.5 | 0.5 | 1.0 |
| Pavement | 0.5 | 0.5 | 0.5 | 0.5 | 1.0 |
| Urban | 2.0 | 2.0 | 1.5 | 2.5 | 1.0 |
| Industrial | 2.0 | 2.0 | 1.5 | 2.5 | 1.0 |

Air units always cost 1.0 — they ignore ground terrain entirely.

#### 3.2.2 Slope Penalty

Computed from `slopeMap` (gradient magnitude per cell, 0–1 normalised).

```typescript
const SLOPE_IMPASSABLE_TRACK = 0.50;   // ~27°
const SLOPE_IMPASSABLE_WHEEL = 0.27;   // ~15°
const SLOPE_IMPASSABLE_LEG   = 0.70;   // ~35°
const SLOPE_IMPASSABLE_HOVER = 0.35;   // ~19°

function slopePenalty(slope: number, moveClass: MoveClass): number {
  const limit = SLOPE_LIMITS[moveClass];
  if (slope >= limit) return 99;           // impassable
  // Linear ramp: no penalty below 50% of limit, up to 2× at limit
  const ratio = Math.max(0, (slope - limit * 0.5) / (limit * 0.5));
  return 1.0 + ratio;                     // 1.0 … 2.0
}
```

#### 3.2.3 Impassable Encoding

Any cell with `cellCost ≥ IMPASSABLE_THRESHOLD` is blocked.

```typescript
const IMPASSABLE_THRESHOLD = 90;
```

This catches both `99` terrain costs and slope-multiplied extremes. Pathfinding
treats these cells as walls.

#### 3.2.4 Bridge Weight Limits

Bridges carry a `maxWeightClass` property. During cost grid generation, check the
unit's `weightClass` against the bridge. If `unit.weightClass > bridge.maxWeightClass`,
the cell is marked impassable for that unit (not for that moveClass globally).

> Because weight class is per-unit, bridge filtering is applied **at path search
> time** as an extra passability check, not baked into the base cost grid.

### 3.3 Storage

```typescript
interface CostGrid {
  width: number;                  // same as TerrainData.width
  height: number;                 // same as TerrainData.height
  resolution: number;             // metres per cell
  costs: Float32Array;            // row-major, length = width × height
}
```

Five of these (~1 MB each for a 512×512 map) are held in memory for the mission
lifetime. Terrain does not change during a mission (craters affect cover, not cost).

---

## 4. Path Search: Weighted A*

### 4.1 Algorithm Choice

**Weighted grid A***. Rationale:

| Option | Verdict | Why |
|--------|---------|-----|
| BFS / Dijkstra | Rejected | Explores too many cells; no heuristic guidance |
| A* (unit weight) | Rejected | Optimal but expands many nodes on large maps |
| **Weighted A* (ε = 1.2)** | **Chosen** | ≤20% longer paths, 3–5× fewer node expansions |
| JPS (Jump Point Search) | Rejected | Only works on uniform-cost grids; ours is weighted |
| Nav mesh + funnel | Deferred | Higher quality paths but complex build step; upgrade later |

Weighted A* with `ε = 1.2` means:

```
f(n) = g(n) + ε × h(n)
```

Paths are at most 20% longer than optimal in exchange for significantly faster
search. On a 512×512 grid, worst-case expansion drops from ~80k nodes (pure A*)
to ~20k nodes.

### 4.2 Heuristic

**Octile distance** — the grid-aware version of Euclidean that accounts for
8-directional movement:

```typescript
function octileH(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}
```

Octile is admissible and consistent for 8-connected grids.

### 4.3 Neighbour Expansion

**8-connected grid.** Cardinal neighbours cost `cellCost`, diagonal neighbours
cost `cellCost × √2`.

Corner-cutting rule: a diagonal move from (r,c) to (r+1,c+1) is legal only if
**both** cardinal neighbours (r+1,c) and (r,c+1) are passable. This prevents
units phasing through diagonal wall corners.

### 4.4 Open List

**Binary heap (min-heap)** on `f` score. Pre-allocate capacity for
`width × height / 4` entries to avoid dynamic resizing in the common case.

### 4.5 Closed List

**Flat `Uint8Array`** the size of the grid (`width × height`). Bit 0 = in closed
set. Zero-fill between searches. Faster than a `Set<number>` for dense grids.

### 4.6 Output: Raw Cell Path

The search returns the sequence of cell indices from start to goal. Convert to
world-space centres:

```typescript
const rawPath: Vec2[] = cellIndicesToWorld(cellPath, grid.resolution);
```

---

## 5. Path Smoothing

Raw A* paths staircase along grid axes. Two passes clean them up.

### 5.1 Pass 1 — Greedy Line-of-Walk

Walk the raw path from the start. For each node, check whether a **straight line
on the cost grid** to the farthest visible future node is passable (no blocked
cells along the line). If so, skip all intermediate nodes.

```
Input:   A → B → C → D → E → F → G
If A can walk straight to D (no blocked cells along Bresenham line):
Output:  A → D → ... continue from D
```

This is a computationally cheap O(n × k) pass where n = path length and k =
lookahead (capped at 32 cells).

### 5.2 Pass 2 — Catmull-Rom Subdivision (Optional)

For aesthetic smoothness on the client, the server may optionally emit a
Catmull-Rom spline through the pruned waypoints. The client interpolates along
this spline for rendering. The server still integrates movement along the
straight-line segments — the spline is **cosmetic only**.

If implemented, use `α = 0.5` (centripetal parameterisation) to avoid cusps.

### 5.3 Final Waypoint List

The smoothed list becomes the unit's `currentPath`.

```typescript
interface UnitMovementState {
  currentPath: Vec2[] | null;   // smoothed waypoints in world-space
  pathIndex: number;            // index of the next waypoint to reach
  moveMode: 'advance' | 'march' | 'reverse' | null;
}
```

Max waypoints after smoothing will typically be 5–30 depending on path
complexity. Memory impact is negligible.

---

## 6. Movement Integration (Per Tick)

Runs every tick (50 ms) for every unit with an active path.

### 6.1 Algorithm

```typescript
function integrateMoveOneTick(unit: UnitInstance, grid: CostGrid, dt: number): void {
  if (!unit.currentPath || unit.pathIndex >= unit.currentPath.length) {
    arriveAtDestination(unit);
    return;
  }

  const target = unit.currentPath[unit.pathIndex];
  const dx = target.x - unit.posX;
  const dz = target.z - unit.posZ;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Speed based on move mode
  const baseSpeedMs = unit.maxSpeedM / 300;  // convert metres/turn → metres/sec
  const modeMultiplier = unit.moveMode === 'advance' ? 0.5
                       : unit.moveMode === 'reverse' ? 0.33
                       : 1.0;  // march

  // Terrain cost at current position
  const [col, row] = worldToCell(unit.posX, unit.posZ, grid.resolution);
  const cellCost = grid.costs[row * grid.width + col] || 1.0;

  const effectiveSpeed = (baseSpeedMs * modeMultiplier) / cellCost;
  const stepDist = effectiveSpeed * dt;

  if (stepDist >= dist) {
    // Arrived at waypoint — snap and advance index
    unit.posX = target.x;
    unit.posZ = target.z;
    unit.pathIndex++;
  } else {
    // Move toward waypoint
    const ratio = stepDist / dist;
    unit.posX += dx * ratio;
    unit.posZ += dz * ratio;
  }

  // Update heading to face direction of travel
  unit.heading = Math.atan2(dx, dz) * (180 / Math.PI);
  if (unit.heading < 0) unit.heading += 360;

  // Reverse: heading stays fixed, unit moves backward
  if (unit.moveMode === 'reverse') {
    unit.heading = (unit.heading + 180) % 360;
  }

  // Track distance for speedState derivation
  unit.recentDistanceM += stepDist;
}
```

### 6.2 Speed State Derivation

After integration, derive `speedState` from a 10-second rolling window.
This feeds directly into the to-hit formula (Formula 1).

```typescript
// Runs every tick
function deriveSpeedState(unit: UnitInstance): void {
  const recentSpeed = unit.recentDistanceM / 10;   // m/s over window
  const maxMs = unit.maxSpeedM / 300;

  if (recentSpeed === 0) {
    unit.stoppedForSec += 0.05;  // one tick = 50 ms
    if (unit.stoppedForSec >= 10) unit.speedState = 'full_halt';
    else if (unit.stoppedForSec >= 3) unit.speedState = 'short_halt';
    else unit.speedState = 'slow';  // just stopped, not yet settled
  } else {
    unit.stoppedForSec = 0;
    unit.speedState = (recentSpeed <= maxMs * 0.25) ? 'slow' : 'fast';
  }
}
```

### 6.3 Arrival

When `pathIndex` reaches the end of `currentPath`:

1. Set `currentPath = null`, `moveMode = null`
2. `stoppedForSec` begins incrementing each tick
3. After 3 seconds → `short_halt`, after 10 → `full_halt`

If the unit has queued waypoints (shift-click queue, max 4), pop the next one
and run a fresh A* search for the new segment.

---

## 7. Queued Waypoints

Players may queue up to **4 waypoints** per unit. Each waypoint carries its own
`moveMode`:

```typescript
interface QueuedWaypoint {
  target: Vec2;
  moveMode: 'advance' | 'march';
}

// On UnitInstance:
waypointQueue: QueuedWaypoint[];   // max length 4
```

When the unit arrives at its current destination:
1. If `waypointQueue` is non-empty, shift the first entry
2. Run A* from the unit's current position to the new target
3. Set `currentPath` and `moveMode` from the dequeued entry
4. Resume integration

A new MOVE order **without shift** clears the queue and replaces the current path.

---

## 8. Reverse Movement

`REVERSE` orders are only valid for `track` and `wheel` moveClass.

Differences from forward movement:
- Speed: **33%** of `maxSpeedM`
- Heading: **locked** to original facing (front armour stays toward threat)
- Path search: Identical A* but the target is behind the unit
- Integration: Movement vector is negated relative to heading

---

## 9. Performance Budget

### 9.1 Targets

| Metric | Budget |
|--------|--------|
| Cost grid build (×5 grids) | ≤ 200 ms total at mission start |
| Single A* search (512×512) | ≤ 5 ms worst case |
| Movement integration (200 units) | ≤ 2 ms per tick |
| Memory (5 cost grids, 512×512) | ~5 MB |

### 9.2 Optimisations

1. **Weighted A* (ε = 1.2)**: 3–5× fewer node expansions vs pure A*.

2. **Early termination**: If the open list exceeds 50,000 nodes, return
   `PATH_NOT_FOUND`. This caps worst-case search time. The unit stays put and
   the player receives an `ORDER_REJECTED` message with reason `unreachable`.

3. **Path caching**: Store the last computed path per unit. If the unit receives
   a new MOVE order to the same cell (within 1 cell tolerance), reuse the cached
   path from the nearest passed waypoint forward.

4. **Deferred re-pathing**: If a unit's path passes through a cell that becomes
   blocked mid-mission (e.g., bridge destroyed), the unit stops at the boundary
   and the server notifies the client. The player must issue a new order.
   The server does **not** auto-repath.

5. **Staggered searches**: If multiple units receive MOVE orders on the same
   tick, spread their A* searches across up to 3 ticks (≤ 150 ms window).
   Priority: HQ units first, then by order timestamp. This prevents a single
   tick from exceeding its 50 ms budget when a player shift-selects 20 units.

### 9.3 Complexity Summary

| Operation | Complexity |
|-----------|-----------|
| Cost grid build | O(W × H) per moveClass |
| A* search | O(E log V) where E ≤ 8V, V = grid cells |
| Smoothing pass | O(n × k), n = path length, k = lookahead cap |
| Integration per tick | O(U) where U = units with active paths |

---

## 10. Data Flow Summary

```
Player clicks destination
        │
        ▼
  ┌─────────────────────────┐
  │   Order Validation       │  Phase 1 — reject if unit dead,
  │   (server tick loop)     │  target off-map, or unit pinned
  └──────────┬──────────────┘
             │ valid
             ▼
  ┌─────────────────────────┐
  │   A* Path Search         │  Uses CostGrid[unit.moveClass]
  │   + Bridge weight check  │  Returns Vec2[] or PATH_NOT_FOUND
  └──────────┬──────────────┘
             │ found
             ▼
  ┌─────────────────────────┐
  │   Line-of-Walk Smoothing │  Prunes redundant waypoints
  └──────────┬──────────────┘
             │
             ▼
  ┌─────────────────────────┐
  │   Store on UnitInstance  │  currentPath, pathIndex, moveMode
  └──────────┬──────────────┘
             │
             ▼
  ┌─────────────────────────┐
  │   Movement Integration   │  Every tick (20 Hz):
  │                          │    advance along path
  │                          │    update posX, posZ, heading
  │                          │    derive speedState
  └──────────┬──────────────┘
             │ arrived
             ▼
  ┌─────────────────────────┐
  │   Dequeue Next Waypoint  │  Pop from waypointQueue
  │   or HALT                │  Run A* for next segment
  └─────────────────────────┘
```

---

## 11. Edge Cases

### 11.1 No Path Found

The order is rejected. The server sends:

```typescript
{ type: 'ORDER_REJECTED', unitId, reason: 'unreachable' }
```

The unit does not move. The client should flash the destination marker red.

### 11.2 Unit Placed on Impassable Cell

This should never happen (deployment validation prevents it). If it does,
the unit can move **out** of the cell (integration skips the cost check for the
origin cell) but cannot return.

### 11.3 Destination on Impassable Cell

A* targets the closest passable cell to the requested destination. The server
sends an `ORDER_MODIFIED` event with the adjusted target so the client can show
the actual endpoint.

### 11.4 Path Blocked Mid-Transit

If a cell on the unit's remaining path becomes impassable (bridge destroyed,
terrain event), the unit halts at the last passable cell. The server sends:

```typescript
{ type: 'PATH_BLOCKED', unitId, stoppedAt: { x, z } }
```

The player must re-issue a new MOVE order. No automatic re-pathing.

### 11.5 Multiple Units, Same Destination

Units do **not** collide. Multiple units can occupy the same world-space
position. There is no unit-to-unit collision, formation spreading, or flow-field
system. Units path independently. This matches the design decision in
RUNTIME_UNIT_STATE.md (no runtime collision model).

### 11.6 Suppressed / Pinned Units

- **PINNED** (suppression 40–64): MOVE orders are **rejected**. Unit cannot
  move until suppression drops below 40 or a RALLY order succeeds.
- **ROUTING** (suppression 65–89): Unit ignores player MOVE orders and retreats
  toward the nearest friendly map edge at 50% maxSpeedM, using A* with the
  retreat target auto-selected.

---

## 12. Future Upgrades (Not in V1)

These are noted for awareness but **must not** be implemented until explicitly
scheduled:

- **Nav mesh**: Replace grid A* with constrained Delaunay triangulation +
  funnel algorithm for smoother, resolution-independent paths.
- **Flow fields**: For large groups (20+ units) moving to the same objective,
  a shared flow field is cheaper than 20 independent A* searches.
- **Dynamic re-pathing**: Auto-repath around destroyed bridges or new obstacles
  without requiring a player re-order.
- **Unit collision avoidance**: Local steering (RVO2 / ORCA) to prevent units
  from overlapping in tight spaces.
- **Hierarchical A***: Cluster the grid into macro-regions for a two-level
  search. Useful if maps grow beyond 1024×1024.

---

## 13. Canonical Types

These TypeScript types are authoritative. Other docs reference them.

```typescript
interface Vec2 {
  x: number;   // metres east from map origin
  z: number;   // metres north from map origin
}

type MoveClass = 'track' | 'wheel' | 'leg' | 'hover' | 'air';

type SpeedState = 'full_halt' | 'short_halt' | 'slow' | 'fast';

type MoveMode = 'advance' | 'march' | 'reverse';

interface CostGrid {
  width: number;
  height: number;
  resolution: number;
  costs: Float32Array;
}

interface QueuedWaypoint {
  target: Vec2;
  moveMode: MoveMode;
}

interface UnitMovementState {
  currentPath: Vec2[] | null;
  pathIndex: number;
  moveMode: MoveMode | null;
  waypointQueue: QueuedWaypoint[];     // max 4
  recentDistanceM: number;             // rolling 10s window
  stoppedForSec: number;               // continuous stationary seconds
  speedState: SpeedState;
}
```
