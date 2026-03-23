// ============================================================================
// VISION OVERLAY — client-side LOS visibility mesh
//
// Computes which terrain cells a unit can see using a heightmap Bresenham
// raycast, then builds a terrain-following translucent mesh highlighting the
// visible area. Used by the C-key debug tool in main.ts.
// ============================================================================

import * as THREE from 'three';
import type { TerrainData } from './terrain';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EYE_HEIGHT    = 0.012;  // normalised heightmap units above ground (~tank cupola)
const VISION_RADIUS = 50;     // cells — 1 cell = 20 m real → ~1 km sensor range
const Y_OFFSET      = 0.10;   // world units above terrain surface (prevents z-fighting)
const VIS_COLOR     = new THREE.Color(0x00ffcc); // DRONECOM teal
const VIS_OPACITY   = 0.28;

// ---------------------------------------------------------------------------
// LOS cast — Bresenham grid walk
// ---------------------------------------------------------------------------

/**
 * Returns true if the line from (ox,oz) to (tx,tz) is not blocked by terrain.
 *
 * Heights are normalised heightmap values (0–1). The ray starts at the
 * observer's eye height (obsH = terrain + EYE_HEIGHT) and aims at the target's
 * ground level (tgtH = terrain at target cell). Any intermediate cell whose
 * effective terrain height exceeds the interpolated ray height blocks the line.
 *
 * Water-covered cells (height < seaLevel) are treated as flat water surface.
 */
function castLOS(
  ox: number, oz: number,
  tx: number, tz: number,
  heightmap: number[],
  mapWidth: number,
  mapHeight: number,
  seaLevel: number,
  obsH: number,
  tgtH: number,
): boolean {
  if (ox === tx && oz === tz) return true;

  const adx = Math.abs(tx - ox);
  const adz = Math.abs(tz - oz);
  const sx = ox < tx ? 1 : -1;
  const sz = oz < tz ? 1 : -1;
  const totalSteps = adx + adz;
  let err = adx - adz;
  let cx = ox, cz = oz;
  let step = 0;

  while (true) {
    // Advance one Bresenham step
    const e2 = 2 * err;
    if (e2 > -adz) { err -= adz; cx += sx; }
    if (e2 < adx)  { err += adx; cz += sz; }
    step++;

    if (cx === tx && cz === tz) return true; // reached target — clear

    // Interpolated ray height at this intermediate cell
    const t = step / totalSteps;
    const rayH = obsH + t * (tgtH - obsH);

    if (cx >= 0 && cx < mapWidth && cz >= 0 && cz < mapHeight) {
      const terrainH = Math.max(seaLevel, heightmap[cz * mapWidth + cx]);
      if (terrainH > rayH) return false; // terrain breaks line of sight
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes which terrain cells are visible from (posX, posZ) and returns a
 * terrain-following Three.js mesh highlighting the visible area.
 *
 * Each visible cell becomes a terrain-hugging quad (2 triangles) tinted in the
 * DRONECOM vision colour. Invisible cells are simply absent from the geometry.
 *
 * @param posX / posZ  Unit position in cell-index coordinates.
 * @param terrain      Terrain snapshot from the server.
 * @param getTerrainY  Callback returning world-space Y for a cell (x, z).
 *                     Pass `cameraController.getTerrainHeight`.
 */
export function buildVisionOverlay(
  posX: number,
  posZ: number,
  terrain: TerrainData,
  getTerrainY: (x: number, z: number) => number,
): THREE.Mesh {
  const { width, height, heightmap, seaLevel } = terrain;

  const ox = Math.round(posX);
  const oz = Math.round(posZ);

  // Observer eye height (normalised)
  const oxC = Math.max(0, Math.min(width  - 1, ox));
  const ozC = Math.max(0, Math.min(height - 1, oz));
  const obsTerrainH = Math.max(seaLevel, heightmap[ozC * width + oxC]);
  const obsH = obsTerrainH + EYE_HEIGHT;

  // Scan bounds — clip to valid quad range (x+1 and z+1 must remain in bounds)
  const xMin = Math.max(0,          ox - VISION_RADIUS);
  const xMax = Math.min(width  - 2, ox + VISION_RADIUS);
  const zMin = Math.max(0,          oz - VISION_RADIUS);
  const zMax = Math.min(height - 2, oz + VISION_RADIUS);

  const r2 = VISION_RADIUS * VISION_RADIUS;
  const cr = VIS_COLOR.r, cg = VIS_COLOR.g, cb = VIS_COLOR.b;

  const positions: number[] = [];
  const colors: number[]    = [];

  for (let z = zMin; z <= zMax; z++) {
    for (let x = xMin; x <= xMax; x++) {
      // Circular range gate
      const dx = x - ox;
      const dz = z - oz;
      if (dx * dx + dz * dz > r2) continue;

      // LOS check
      const tgtH = Math.max(seaLevel, heightmap[z * width + x]);
      if (!castLOS(ox, oz, x, z, heightmap, width, height, seaLevel, obsH, tgtH)) continue;

      // Terrain-following quad: 4 corner heights
      const y00 = getTerrainY(x,     z    ) + Y_OFFSET;
      const y10 = getTerrainY(x + 1, z    ) + Y_OFFSET;
      const y01 = getTerrainY(x,     z + 1) + Y_OFFSET;
      const y11 = getTerrainY(x + 1, z + 1) + Y_OFFSET;

      // Two triangles (non-indexed, 6 vertices per quad)
      positions.push(
        x,   y00, z,     x,   y01, z + 1,   x + 1, y10, z,    // tri 1
        x + 1, y10, z,   x,   y01, z + 1,   x + 1, y11, z + 1, // tri 2
      );
      for (let i = 0; i < 6; i++) colors.push(cr, cg, cb);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: VIS_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'vision-overlay';
  mesh.renderOrder = 1; // draw above terrain
  return mesh;
}
