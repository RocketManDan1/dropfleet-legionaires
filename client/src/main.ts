import * as THREE from 'three';
import { RTSCamera } from './camera';
import { GameConnection } from './network';
import { createTerrainMesh, TerrainData } from './terrain';
import { createProceduralBuildingDistricts } from './buildings';
import { UnitManager } from './units/unit-manager';
import { InputHandler, type InputCallbacks } from './input/click-handler';
import { ClientPathfinder } from './pathfinding/client-pathfinding';
import type { Vec2, MoraleState, FirePosture, UnitDelta, ContactDelta, UnitSnapshot, ContactSnapshot, GameEvent } from '@legionaires/shared';

// Terrain type → track cost (mirrors server TERRAIN_MOVE_COST for 'track')
const TRACK_COST_BY_TERRAIN: Record<number, number> = {
  0: 1.0, 1: 1.5, 2: 2.5, 3: 1.5, 4: 99, 5: 2.0, 6: 3.0, 7: 1.5,
  8: 1.5, 9: 1.0, 10: 1.0, 11: 99, 12: 4.0, 13: 99, 14: 4.0, 15: 1.5,
  16: 1.0, 17: 2.0, 18: 99, 19: 3.0, 20: 0.5, 21: 0.5, 22: 0.5,
  23: 2.0, 24: 2.0,
};

// --- Scene setup ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const cameraController = new RTSCamera(window.innerWidth / window.innerHeight);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  cameraController.resize(window.innerWidth / window.innerHeight);
});

// --- HUD legend ---
const tacticalLegend = document.createElement('div');
tacticalLegend.style.cssText = `
  position: fixed;
  top: 12px;
  left: 12px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  letter-spacing: 0.05em;
  color: rgba(200, 210, 210, 0.85);
  background: rgba(8, 10, 10, 0.62);
  border: 1px solid rgba(128, 255, 216, 0.25);
  padding: 8px 10px;
  pointer-events: none;
  user-select: none;
`;
tacticalLegend.innerHTML = [
  'LEFT CLICK = SELECT UNIT',
  'RIGHT CLICK = MOVE ORDER',
  'SHIFT+RIGHT CLICK = QUEUE WAYPOINT',
  'G = REGEN TERRAIN | SHIFT+G = HI-RES',
].join('<br>');
document.body.appendChild(tacticalLegend);

// --- Network ---
const connection = new GameConnection();

// --- M1 game state ---
let terrainGroup: THREE.Group | null = null;
let buildingsGroup: THREE.Group | null = null;
let currentTerrainData: TerrainData | null = null;

// Unit systems — created once, reused across terrain regenerations
const unitManager = new UnitManager(scene, cameraController.camera);
unitManager.setLocalPlayer('player1', 'federation');

const pathfinder = new ClientPathfinder();

// Simple client-side movement state for M1 (server takes over in M2)
interface M1UnitMove {
  path: Vec2[];
  pathIndex: number;
}
const unitMoves: Map<string, M1UnitMove> = new Map();

// --- Input callbacks ---
const inputCallbacks: InputCallbacks = {
  onSelect(unitId, _isContact, addToSelection) {
    if (!addToSelection) unitManager.deselectAll();
    if (unitId) {
      unitManager.selectUnit(unitId, addToSelection);
    }
  },

  onMoveOrder(targetPos, queueWaypoint) {
    const selected = unitManager.getSelectedIds();
    if (selected.length === 0) return;

    for (const unitId of selected) {
      const unit = unitManager.getUnit(unitId);
      if (!unit) continue;

      const from: Vec2 = { x: unit.posX, z: unit.posZ };
      const result = pathfinder.findPath(from, targetPos, 'track');

      if (result.status === 'FOUND' && result.path.length >= 2) {
        if (queueWaypoint) {
          // Append new path to the remaining portion of the existing path
          const existing = unitMoves.get(unitId);
          if (existing && existing.pathIndex < existing.path.length) {
            const remaining = existing.path.slice(existing.pathIndex);
            const combined = remaining.concat(result.path.slice(1)); // skip duplicate junction point
            unitMoves.set(unitId, { path: combined, pathIndex: 0 });
          } else {
            unitMoves.set(unitId, { path: result.path, pathIndex: 0 });
          }
        } else {
          unitMoves.set(unitId, { path: result.path, pathIndex: 0 });
        }
        // Show combined path preview with terrain-following height
        const move = unitMoves.get(unitId)!;
        pathfinder.showPathPreview(scene, move.path, 0.5, (x, z) => cameraController.getTerrainHeight(x, z));
      }
    }
  },

  onEngageOrder(_targetUnitId, _queueWaypoint) {
    // M2+ feature
  },

  onBoxSelect(screenRect) {
    const ids = unitManager.getUnitsInScreenRect(
      screenRect.x1, screenRect.y1,
      screenRect.x2, screenRect.y2,
    );
    unitManager.deselectAll();
    for (const id of ids) unitManager.selectUnit(id, true);
  },

  onFirePostureChange(_posture) {
    // M2+ feature
  },

  onMoveModeChange(_mode) {
    // M2+ feature
  },

  onSpecialOrder(_order) {
    // M2+ feature
  },
};

// Input handler wired to the camera and unit manager
const inputHandler = new InputHandler(
  cameraController.camera,
  inputCallbacks,
  (x, y) => unitManager.getUnitAtScreenPos(x, y),
);

// --- Terrain events ---
connection.on('terrain', (msg: { data: TerrainData }) => {
  console.log(`Received terrain — biome: ${msg.data.biome}`);
  currentTerrainData = msg.data;

  // Swap out old terrain
  if (terrainGroup) scene.remove(terrainGroup);
  if (buildingsGroup) scene.remove(buildingsGroup);

  terrainGroup = createTerrainMesh(msg.data);
  scene.add(terrainGroup);

  buildingsGroup = createProceduralBuildingDistricts(msg.data);
  scene.add(buildingsGroup);

  cameraController.setTerrainData(msg.data, 52);

  // Wire terrain surface to input handler for click-to-world raycasting
  const terrainSurface = terrainGroup.getObjectByName('terrain-surface');
  if (terrainSurface) inputHandler.setTerrainMesh(terrainSurface);

  // Build cost grid from terrain type data for client pathfinding preview.
  // Uses the 'track' MoveClass costs as the default for path previews.
  const { width, height, resolution } = msg.data;
  const costs = new Float32Array(width * height);
  const ttMap = msg.data.terrainTypeMap;
  for (let i = 0; i < width * height; i++) {
    if (ttMap) {
      // Use terrain type cost table (track MoveClass)
      const ttCost = TRACK_COST_BY_TERRAIN[ttMap[i]] ?? 1.0;
      const slope = msg.data.slopeMap?.[i] ?? 0;
      if (ttCost >= 90 || slope >= 90) {
        costs[i] = 95;
      } else {
        costs[i] = ttCost * (1 + Math.min(slope / 90, 1.0));
      }
    } else {
      // Fallback: heightmap + slope only
      if (msg.data.heightmap[i] <= msg.data.seaLevel) {
        costs[i] = 95;
      } else {
        const slope = msg.data.slopeMap?.[i] ?? 0;
        costs[i] = slope > 0.85 ? 95 : 1.0 + slope * 4.0;
      }
    }
  }
  pathfinder.setCostGrid({ data: costs, width, height, cellSizeM: resolution });

  // Clear previous units and movements, then spawn a test unit on dry land
  unitManager.clearAll();
  unitMoves.clear();
  pathfinder.clearPathPreview(scene);

  // Find a dry, walkable spawn point — spiral outward from map centre
  let cx = Math.floor(msg.data.width / 2);
  let cz = Math.floor(msg.data.height / 2);
  const sl = msg.data.seaLevel;
  const hm = msg.data.heightmap;
  let found = false;
  for (let r = 0; r < Math.max(width, height) / 2 && !found; r++) {
    for (let dx = -r; dx <= r && !found; dx++) {
      for (let dz = -r; dz <= r && !found; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // perimeter only
        const px = Math.floor(width / 2) + dx;
        const pz = Math.floor(height / 2) + dz;
        if (px < 0 || px >= width || pz < 0 || pz >= height) continue;
        if (hm[pz * width + px] > sl) {
          cx = px;
          cz = pz;
          found = true;
        }
      }
    }
  }

  unitManager.applyFullSnapshot([{
    unitId: 'test-unit-1',
    unitTypeId: 'M1_ABRAMS',
    ownerId: 'player1',
    posX: cx,
    posZ: cz,
    heading: 0,
    crewCurrent: 4,
    crewMax: 4,
    suppression: 0,
    moraleState: 'normal' as MoraleState,
    speedState: 'full_halt',
    firePosture: 'return_fire' as FirePosture,
    ammo: [],
    isDestroyed: false,
    isEntrenched: false,
  }], []);

  console.log(`Test unit spawned at (${cx.toFixed(0)}, ${cz.toFixed(0)})`);
});

// --- TICK_UPDATE handler: apply server-authoritative state deltas ---
connection.on('TICK_UPDATE', (msg: { payload: { tick: number; missionTimeSec: number; unitDeltas: UnitDelta[]; contactDeltas: ContactDelta[]; events: GameEvent[] } }) => {
  const { unitDeltas, contactDeltas } = msg.payload;

  if (unitDeltas.length > 0) {
    unitManager.applyUnitDeltas(unitDeltas);
    // Update Y positions from terrain
    for (const delta of unitDeltas) {
      if (delta.posX === undefined) continue;
      const unit = unitManager.getUnit(delta.unitId);
      if (!unit) continue;
      const y = cameraController.getTerrainHeight(unit.posX, unit.posZ);
      unit.sceneGroup.position.setY(y);
    }
  }

  if (contactDeltas.length > 0) {
    unitManager.applyContactDeltas(contactDeltas);
  }
});

// --- MISSION_STATE_FULL handler: full state reset (join / reconnect) ---
connection.on('MISSION_STATE_FULL', (msg: { payload: { units: UnitSnapshot[]; contacts: ContactSnapshot[] } }) => {
  const { units, contacts } = msg.payload;
  unitManager.applyFullSnapshot(units, contacts);
});

connection.connect();

// Terrain regeneration hotkey (G)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || e.repeat) return;
  const seed = Math.random() * 1_000_000;
  if (e.shiftKey) {
    console.log(`Requesting HI-RES terrain seed=${seed.toFixed(0)} (640x640)`);
    connection.send('generate', { seed, width: 640, height: 640 });
    return;
  }
  console.log(`Requesting terrain seed=${seed.toFixed(0)}`);
  connection.send('generate', { seed });
});

// --- M1 client-side movement integration ---
// In M2 this is replaced by server-authoritative movement via the tick loop.
//
// Positions (posX/posZ) are in CELL INDICES. Terrain resolution (m/cell) converts
// real-world m/s speeds into cells/sec so the unit moves at the correct visual pace.
//   8 m/s ÷ 20 m/cell = 0.4 cells/sec ≈ 29 km/h advance speed
const UNIT_SPEED_M_PER_SEC = 8; // ~29 km/h cross-country advance

function tickClientMovement(dt: number): void {
  if (!currentTerrainData) return;

  // Convert m/s → cells/sec using the terrain's real-world cell size
  const resolution = currentTerrainData.resolution; // m per cell (20)
  const speedCellsPerSec = UNIT_SPEED_M_PER_SEC / resolution;

  for (const [unitId, move] of unitMoves) {
    const unit = unitManager.getUnit(unitId);
    if (!unit || unit.isDestroyed) {
      unitMoves.delete(unitId);
      continue;
    }

    if (move.pathIndex >= move.path.length) {
      unitMoves.delete(unitId);
      continue;
    }

    const target = move.path[move.pathIndex];
    const dx = target.x - unit.posX;
    const dz = target.z - unit.posZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const stepDist = speedCellsPerSec * dt;

    if (stepDist >= dist) {
      // Arrived at this waypoint
      unit.posX = target.x;
      unit.posZ = target.z;
      move.pathIndex++;
    } else {
      const ratio = stepDist / dist;
      unit.posX += dx * ratio;
      unit.posZ += dz * ratio;
      // Update heading to face direction of travel
      unit.heading = Math.atan2(dx, dz) * (180 / Math.PI);
      if (unit.heading < 0) unit.heading += 360;
    }

    // Elevate icon to terrain surface
    const terrainY = cameraController.getTerrainHeight(unit.posX, unit.posZ);
    unit.sceneGroup.position.set(unit.posX, terrainY, unit.posZ);
  }

  // For stationary units, also keep them grounded after terrain changes
  for (const unit of unitManager.getAllUnits()) {
    if (unitMoves.has(unit.unitId)) continue; // handled above
    const terrainY = cameraController.getTerrainHeight(unit.posX, unit.posZ);
    unit.sceneGroup.position.set(unit.posX, terrainY, unit.posZ);
  }
}

// --- Render loop ---
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
  lastTime = now;

  cameraController.update(dt);
  tickClientMovement(dt);
  unitManager.updateFrame();

  renderer.render(scene, cameraController.camera);
}

animate();

