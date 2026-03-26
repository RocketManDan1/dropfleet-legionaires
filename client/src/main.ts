import * as THREE from 'three';
import { RTSCamera } from './camera';
import { GameConnection } from './network';
import { createTerrainMesh, TerrainData } from './terrain';
import { createProceduralBuildingDistricts } from './buildings';
import { UnitManager } from './units/unit-manager';
import { InputHandler, type InputCallbacks } from './input/click-handler';
import { ClientPathfinder } from './pathfinding/client-pathfinding';
import { buildVisionOverlay } from './vision-overlay';
import { DeploymentScreen, type RosterEntry } from './screens/deployment';
import { AARScreen } from './screens/aar';
import { EffectManager } from './effects/effect-manager';
import { UnitPanel } from './hud/unit-panel';
import { OrderButtonBar, type OrderType as HudOrderType } from './hud/order-buttons';
import { InterpolationSystem } from './systems/interpolation';
import type { Vec2, MoraleState, FirePosture, UnitDelta, ContactDelta, UnitSnapshot, ContactSnapshot, GameEvent, DeploymentZonePayload, AARPayload, MissionPhasePayload, MissionPhaseWire } from '@legionaires/shared';

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

const loadingOverlay = document.createElement('div');
loadingOverlay.style.cssText = `
  position: fixed;
  inset: 0;
  z-index: 999;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 14px;
  font-family: monospace;
  color: rgba(180, 255, 220, 0.9);
  letter-spacing: 0.08em;
`;

const loadingLabel = document.createElement('div');
loadingLabel.textContent = 'CONNECTING TO MISSION NODE...';
loadingLabel.style.cssText = `
  font-size: 12px;
  text-transform: uppercase;
  opacity: 0.9;
`;

const loadingBarTrack = document.createElement('div');
loadingBarTrack.style.cssText = `
  width: min(440px, 68vw);
  height: 14px;
  border: 1px solid rgba(128, 255, 216, 0.45);
  background: rgba(8, 10, 10, 0.95);
  padding: 2px;
`;

const loadingBarFill = document.createElement('div');
loadingBarFill.style.cssText = `
  width: 0%;
  height: 100%;
  background: linear-gradient(90deg, rgba(0, 200, 120, 0.85), rgba(128, 255, 216, 0.95));
  box-shadow: 0 0 14px rgba(80, 255, 180, 0.45);
  transition: width 180ms linear;
`;

loadingBarTrack.appendChild(loadingBarFill);
loadingOverlay.appendChild(loadingLabel);
loadingOverlay.appendChild(loadingBarTrack);
document.body.appendChild(loadingOverlay);

let loadingProgress = 0;
let loadingTarget = 6;
let loadingClosed = false;
let terrainReady = false;
let missionSnapshotReady = false;

function setLoadingStage(label: string, targetPercent: number): void {
  loadingLabel.textContent = label;
  loadingTarget = Math.max(loadingTarget, Math.min(100, targetPercent));
}

function tickLoadingProgress(): void {
  if (loadingClosed) return;
  loadingProgress += (loadingTarget - loadingProgress) * 0.18;
  if (Math.abs(loadingTarget - loadingProgress) < 0.3) {
    loadingProgress = loadingTarget;
  }
  loadingBarFill.style.width = `${loadingProgress.toFixed(1)}%`;
  requestAnimationFrame(tickLoadingProgress);
}

function finalizeLoadingOverlay(): void {
  if (loadingClosed) return;
  loadingClosed = true;
  loadingBarFill.style.width = '100%';
  loadingLabel.textContent = 'LINK ESTABLISHED';
  window.setTimeout(() => {
    loadingOverlay.style.transition = 'opacity 250ms ease';
    loadingOverlay.style.opacity = '0';
    window.setTimeout(() => loadingOverlay.remove(), 260);
  }, 180);
}

function tryCompleteLoading(): void {
  if (terrainReady && missionSnapshotReady) {
    finalizeLoadingOverlay();
  }
}

tickLoadingProgress();

const scene = new THREE.Scene();
(renderer.domElement as any).__THREE_SCENE = scene;

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
  'B = CYCLE BATLOC PRESET',
  'C = TOGGLE VISION OVERLAY',
  'V = DEV TOGGLE ENEMY POSITIONS',
  '` = DEV SPAWN ENEMY TOOL',
].join('<br>');
document.body.appendChild(tacticalLegend);

interface ObjectiveView {
  objectiveId: string;
  name: string;
  type: string;
  posX: number;
  posZ: number;
  radius: number;
  progress: number;
  status: string;
}

const objectivesPanel = document.createElement('div');
objectivesPanel.style.cssText = `
  position: fixed;
  top: 170px;
  left: 12px;
  max-width: 320px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.45;
  letter-spacing: 0.04em;
  color: rgba(200, 210, 210, 0.9);
  background: rgba(8, 10, 10, 0.62);
  border: 1px solid rgba(128, 255, 216, 0.25);
  padding: 8px 10px;
  pointer-events: none;
  user-select: none;
`;
objectivesPanel.style.display = 'none';
document.body.appendChild(objectivesPanel);

function renderObjectivesPanel(objectives: ObjectiveView[]): void {
  if (objectives.length === 0) {
    objectivesPanel.style.display = 'none';
    objectivesPanel.innerHTML = '';
    return;
  }

  objectivesPanel.style.display = 'block';
  const lines = ['OBJECTIVES'];
  for (const obj of objectives) {
    const state = obj.status === 'complete' ? 'COMPLETE' : `${Math.max(0, Math.min(100, Math.round(obj.progress ?? 0)))}%`;
    lines.push(`${obj.name} [${state}]`);
  }
  objectivesPanel.innerHTML = lines.join('<br>');
}

// --- Batloc selector panel ---
const BATLOC_PRESETS = [
  'plains', 'forest', 'mountains', 'jungle', 'desert',
  'beach', 'river-crossing', 'stalingrad', 'finland',
] as const;
type BatlocKey = typeof BATLOC_PRESETS[number];

let currentBatloc: BatlocKey = 'plains';

const batlocPanel = document.createElement('div');
batlocPanel.style.cssText = `
  position: fixed;
  top: 12px;
  right: 12px;
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: rgba(200, 210, 210, 0.85);
  background: rgba(8, 10, 10, 0.62);
  border: 1px solid rgba(128, 255, 216, 0.25);
  padding: 8px 10px;
  user-select: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
`;

const batlocLabel = document.createElement('div');
batlocLabel.style.cssText = 'color: rgba(128, 255, 216, 0.7); margin-bottom: 2px;';
batlocLabel.textContent = 'BATLOC PRESET';
batlocPanel.appendChild(batlocLabel);

const batlocSelect = document.createElement('select');
batlocSelect.style.cssText = `
  font-family: monospace;
  font-size: 11px;
  background: rgba(8, 10, 10, 0.8);
  color: rgba(200, 210, 210, 0.9);
  border: 1px solid rgba(128, 255, 216, 0.35);
  padding: 2px 4px;
  cursor: pointer;
  outline: none;
  width: 100%;
`;
for (const key of BATLOC_PRESETS) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = key.toUpperCase().replace(/-/g, ' ');
  batlocSelect.appendChild(opt);
}
batlocSelect.value = currentBatloc;
batlocSelect.addEventListener('change', () => {
  currentBatloc = batlocSelect.value as BatlocKey;
});
batlocPanel.appendChild(batlocSelect);

const batlocRegenBtn = document.createElement('button');
batlocRegenBtn.style.cssText = `
  font-family: monospace;
  font-size: 11px;
  background: rgba(20, 30, 20, 0.8);
  color: rgba(128, 255, 216, 0.85);
  border: 1px solid rgba(128, 255, 216, 0.35);
  padding: 3px 6px;
  cursor: pointer;
  margin-top: 2px;
  letter-spacing: 0.05em;
`;
batlocRegenBtn.textContent = 'REGEN (G)';
batlocRegenBtn.addEventListener('click', () => requestTerrainRegen(false));
batlocPanel.appendChild(batlocRegenBtn);

document.body.appendChild(batlocPanel);

// --- Network ---
const connection = new GameConnection();
setLoadingStage('CONNECTING TO MISSION NODE...', 12);

// --- M3: Deployment + AAR screens + Effects ---
const deploymentScreen = new DeploymentScreen();
const aarScreen = new AARScreen();
let effectManager: EffectManager | null = null;
let currentMissionPhase: MissionPhaseWire = 'briefing';
let activeMovementMode: import('@legionaires/shared').MoveMode = 'advance';
let activeOrderMode: 'engage' | 'area_fire' | null = null;

// --- M2: HUD components ---
const unitPanel = new UnitPanel();
const orderBar = new OrderButtonBar();
const interpolation = new InterpolationSystem(100); // 100ms render delay

// Wire order bar button presses to outbound server orders
orderBar.onOrder((orderType: HudOrderType) => {
  const selected = unitManager.getSelectedIds();
  if (selected.length === 0) return;

  // Fire posture orders — apply immediately
  if (orderType === 'hold_fire' || orderType === 'return_fire' || orderType === 'fire_at_will') {
    const posture: FirePosture = orderType === 'fire_at_will' ? 'free_fire' : orderType;
    for (const unitId of selected) {
      connection.send('ORDER', { payload: { unitId, orderType: 'set_posture', posture } });
    }
    return;
  }

  // Movement mode selection — store for next move order
  if (orderType === 'move') { activeMovementMode = 'advance'; activeOrderMode = null; orderBar.setActive('move'); return; }
  if (orderType === 'move_fast') { activeMovementMode = 'march'; activeOrderMode = null; orderBar.setActive('move_fast'); return; }
  if (orderType === 'reverse') { activeMovementMode = 'reverse'; activeOrderMode = null; orderBar.setActive('reverse'); return; }

  // Engage — set active mode, actual target picked on next click
  if (orderType === 'engage') { activeOrderMode = 'engage'; orderBar.setActive('engage'); return; }
  if (orderType === 'area_fire') { activeOrderMode = 'area_fire'; orderBar.setActive('area_fire'); return; }

  // Immediate special orders
  for (const unitId of selected) {
    if (orderType === 'rally') {
      connection.send('ORDER', { payload: { unitId, orderType: 'rally' } });
    } else if (orderType === 'entrench') {
      connection.send('ORDER', { payload: { unitId, orderType: 'entrench' } });
    } else if (orderType === 'deploy_smoke') {
      connection.send('ORDER', { payload: { unitId, orderType: 'deploy_smoke' } });
    } else if (orderType === 'cancel') {
      connection.send('ORDER', { payload: { unitId, orderType: 'cancel' } });
    }
  }
});

// --- M1 game state ---
let terrainGroup: THREE.Group | null = null;
let buildingsGroup: THREE.Group | null = null;
let currentTerrainData: TerrainData | null = null;
let visionOverlay: THREE.Mesh | null = null;
let visionUnitId: string | null = null;    // which unit's vision to track
let visionLastX = 0;                        // position when overlay was last built
let visionLastZ = 0;
let lastVisionRebuildMs = 0;
const VISION_REBUILD_DIST_SQ = 0.25;       // 0.5 cells² — rebuild after moving 0.5 cells
const VISION_REBUILD_MIN_MS  = 120;        // cap at ~8 rebuilds/sec

const pendingDeployRequests = new Map<string, { prevX: number; prevZ: number; wasPlaced: boolean }>();
const deployedUnitIds = new Set<string>();

let devRevealEnemiesEnabled = false;
let devEnemyOverlay: THREE.Group | null = null;
let objectiveOverlay: THREE.Group | null = null;

// --- DEV: Enemy spawn tool state ---
let devSpawnMode = false;
let devSpawnFaction: 'ataxian' | 'khroshi' = 'ataxian';

// --- DEV: Spawn tool panel ---
const devSpawnPanel = document.createElement('div');
devSpawnPanel.style.cssText = `
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  font-family: monospace;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: rgba(255, 80, 60, 0.95);
  background: rgba(10, 8, 8, 0.82);
  border: 1px solid rgba(255, 80, 60, 0.55);
  padding: 10px 16px;
  user-select: none;
  display: none;
  z-index: 200;
  display: none;
  gap: 10px;
  align-items: center;
`;

const devSpawnLabel = document.createElement('span');
devSpawnLabel.textContent = 'DEV SPAWN: CLICK MAP TO PLACE ENEMY';
devSpawnLabel.style.cssText = 'margin-right: 12px;';

const devSpawnFactionBtn = document.createElement('button');
devSpawnFactionBtn.style.cssText = `
  font-family: monospace;
  font-size: 11px;
  background: rgba(30, 12, 12, 0.85);
  color: rgba(255, 100, 60, 0.95);
  border: 1px solid rgba(255, 80, 60, 0.45);
  padding: 3px 8px;
  cursor: pointer;
  letter-spacing: 0.05em;
`;
devSpawnFactionBtn.textContent = 'FACTION: ATAXIAN';
devSpawnFactionBtn.addEventListener('click', () => {
  devSpawnFaction = devSpawnFaction === 'ataxian' ? 'khroshi' : 'ataxian';
  devSpawnFactionBtn.textContent = `FACTION: ${devSpawnFaction.toUpperCase()}`;
});

const devSpawnCloseBtn = document.createElement('button');
devSpawnCloseBtn.style.cssText = `
  font-family: monospace;
  font-size: 11px;
  background: rgba(30, 12, 12, 0.85);
  color: rgba(255, 100, 60, 0.95);
  border: 1px solid rgba(255, 80, 60, 0.45);
  padding: 3px 8px;
  cursor: pointer;
  letter-spacing: 0.05em;
`;
devSpawnCloseBtn.textContent = 'CLOSE [X]';
devSpawnCloseBtn.addEventListener('click', () => {
  devSpawnMode = false;
  devSpawnPanel.style.display = 'none';
});

devSpawnPanel.appendChild(devSpawnLabel);
devSpawnPanel.appendChild(devSpawnFactionBtn);
devSpawnPanel.appendChild(devSpawnCloseBtn);
document.body.appendChild(devSpawnPanel);

const devSpawnLog = document.createElement('div');
devSpawnLog.style.cssText = `
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  font-family: monospace;
  font-size: 11px;
  color: rgba(255, 120, 80, 0.9);
  background: rgba(10, 8, 8, 0.7);
  border: 1px solid rgba(255, 80, 60, 0.3);
  padding: 4px 12px;
  pointer-events: none;
  user-select: none;
  z-index: 200;
  display: none;
  white-space: nowrap;
`;
document.body.appendChild(devSpawnLog);

let devSpawnLogTimer: ReturnType<typeof setTimeout> | null = null;
function showDevSpawnLog(text: string): void {
  devSpawnLog.textContent = text;
  devSpawnLog.style.display = 'block';
  if (devSpawnLogTimer) clearTimeout(devSpawnLogTimer);
  devSpawnLogTimer = setTimeout(() => { devSpawnLog.style.display = 'none'; }, 3000);
}

function toggleDevSpawnMode(): void {
  devSpawnMode = !devSpawnMode;
  devSpawnPanel.style.display = devSpawnMode ? 'flex' : 'none';
  if (!devSpawnMode) {
    devSpawnLog.style.display = 'none';
  }
}

function clearObjectiveOverlay(): void {
  if (!objectiveOverlay) return;
  scene.remove(objectiveOverlay);
  objectiveOverlay.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
  objectiveOverlay = null;
}

function renderObjectiveOverlay(objectives: ObjectiveView[]): void {
  clearObjectiveOverlay();
  if (objectives.length === 0) return;

  const group = new THREE.Group();
  group.name = 'objective-overlay';

  for (const obj of objectives) {
    const baseY = cameraController.getTerrainHeight(obj.posX, obj.posZ);
    const radius = Math.max(12, obj.radius ?? 30);
    const isComplete = obj.status === 'complete';
    const color = isComplete ? 0x6af58f : 0xffd166;

    const ringPoints: THREE.Vector3[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = obj.posX + Math.cos(a) * radius;
      const z = obj.posZ + Math.sin(a) * radius;
      const y = cameraController.getTerrainHeight(x, z) + 1.6;
      ringPoints.push(new THREE.Vector3(x, y, z));
    }

    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: isComplete ? 0.5 : 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const ring = new THREE.Line(ringGeo, ringMat);
    ring.renderOrder = 25;
    group.add(ring);

    const poleGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(obj.posX, baseY + 0.6, obj.posZ),
      new THREE.Vector3(obj.posX, baseY + 9.0, obj.posZ),
    ]);
    const poleMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    const pole = new THREE.Line(poleGeo, poleMat);
    pole.renderOrder = 25;
    group.add(pole);
  }

  scene.add(group);
  objectiveOverlay = group;
}

function clearDevEnemyOverlay(): void {
  if (!devEnemyOverlay) return;
  scene.remove(devEnemyOverlay);
  devEnemyOverlay.traverse((child) => {
    if (child instanceof THREE.Line) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
  devEnemyOverlay = null;
}

function renderDevEnemyOverlay(units: Array<{ unitId: string; posX: number; posZ: number }>): void {
  clearDevEnemyOverlay();

  const group = new THREE.Group();
  group.name = 'dev-enemy-overlay';

  for (const enemy of units) {
    const y = cameraController.getTerrainHeight(enemy.posX, enemy.posZ);
    const mat = new THREE.LineBasicMaterial({
      color: 0xff4b3a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    const crossA = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(enemy.posX - 1.6, y + 0.5, enemy.posZ - 1.6),
      new THREE.Vector3(enemy.posX + 1.6, y + 0.5, enemy.posZ + 1.6),
    ]);
    const crossB = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(enemy.posX - 1.6, y + 0.5, enemy.posZ + 1.6),
      new THREE.Vector3(enemy.posX + 1.6, y + 0.5, enemy.posZ - 1.6),
    ]);
    const stalk = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(enemy.posX, y + 0.25, enemy.posZ),
      new THREE.Vector3(enemy.posX, y + 5.0, enemy.posZ),
    ]);

    group.add(new THREE.Line(crossA, mat.clone()));
    group.add(new THREE.Line(crossB, mat.clone()));
    group.add(new THREE.Line(stalk, mat.clone()));
  }

  scene.add(group);
  devEnemyOverlay = group;
}

function clearVisionOverlay(): void {
  if (visionOverlay) {
    scene.remove(visionOverlay);
    visionOverlay.geometry.dispose();
    (visionOverlay.material as THREE.Material).dispose();
    visionOverlay = null;
  }
  visionUnitId = null;
}

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
// --- DEV: Raycast helper for spawn tool (reuses terrain mesh from InputHandler) ---
const devRaycaster = new THREE.Raycaster();
function devRaycastTerrain(screenX: number, screenY: number): Vec2 | null {
  const ndc = new THREE.Vector2(
    (screenX / window.innerWidth) * 2 - 1,
    -(screenY / window.innerHeight) * 2 + 1,
  );
  devRaycaster.setFromCamera(ndc, cameraController.camera);
  const terrainSurface = terrainGroup?.getObjectByName('terrain-surface');
  if (terrainSurface) {
    const hits = devRaycaster.intersectObject(terrainSurface, false);
    if (hits.length > 0) return { x: hits[0].point.x, z: hits[0].point.z };
  }
  return null;
}

// --- DEV: Mouse handler for spawn clicks (left click while spawn mode active) ---
window.addEventListener('mousedown', (e) => {
  if (!devSpawnMode || e.button !== 0) return;
  // Don't intercept clicks on the panel buttons themselves
  if ((e.target as HTMLElement).closest('button')) return;

  const worldPos = devRaycastTerrain(e.clientX, e.clientY);
  if (!worldPos) return;

  e.stopPropagation();
  e.preventDefault();

  connection.send('DEV_SPAWN_ENEMY', {
    payload: { posX: worldPos.x, posZ: worldPos.z, faction: devSpawnFaction },
  });
  showDevSpawnLog(`Spawning ${devSpawnFaction} unit at (${worldPos.x.toFixed(0)}, ${worldPos.z.toFixed(0)})...`);
}, true); // capture phase to intercept before InputHandler

const inputCallbacks: InputCallbacks = {
  onSelect(unitId, _isContact, addToSelection) {
    if (devSpawnMode) return; // swallow select events while placing enemies
    if (!addToSelection) unitManager.deselectAll();
    if (unitId) {
      unitManager.selectUnit(unitId, addToSelection);
    }

    // Clear active order mode on selection change
    activeOrderMode = null;

    // Update HUD panels based on selection state
    const selected = unitManager.getSelectedIds();
    if (selected.length === 1) {
      const unit = unitManager.getUnit(selected[0]);
      if (unit) {
        unitPanel.show({
          unitId: unit.unitId,
          unitTypeId: unit.unitTypeId ?? 'UNKNOWN',
          ownerId: unit.ownerId ?? '',
          posX: unit.posX,
          posZ: unit.posZ,
          heading: unit.heading,
          crewCurrent: unit.crewCurrent,
          crewMax: unit.crewMax,
          suppression: unit.suppression ?? 0,
          moraleState: (unit as any).moraleState ?? 'normal',
          speedState: (unit as any).speedState ?? 'full_halt',
          firePosture: (unit as any).firePosture ?? 'return_fire',
          ammo: [],
          isDestroyed: unit.isDestroyed,
          isEntrenched: (unit as any).isEntrenched ?? false,
        });
        orderBar.show();
        if (unit.isDestroyed) {
          orderBar.setDestroyedState();
        } else if ((unit as any).moraleState === 'routing' || (unit as any).moraleState === 'surrendered') {
          orderBar.setRoutingState();
        } else {
          orderBar.enableAll();
        }
      }
    } else if (selected.length > 1) {
      unitPanel.hide();
      orderBar.show();
      orderBar.enableAll();
    } else {
      unitPanel.hide();
      orderBar.hide();
    }
  },

  onMoveOrder(targetPos, queueWaypoint) {
    let selected = unitManager.getSelectedIds();

    // If area_fire is active, right-click on terrain = fire at that position
    if (activeOrderMode === 'area_fire') {
      if (selected.length === 0) return;
      for (const unitId of selected) {
        connection.send('ORDER', {
          payload: { unitId, orderType: 'area_fire', targetPos },
        });
      }
      activeOrderMode = null;
      orderBar.clearActive();
      return;
    }

    // If engage is active, right-click on terrain = cancel engage mode
    if (activeOrderMode === 'engage') {
      activeOrderMode = null;
      orderBar.clearActive();
      // Fall through to normal move order
    }

    if (currentMissionPhase === 'deployment') {
      // If no unit is selected, auto-pick the next unplaced unit from roster
      if (selected.length === 0) {
        const unplaced = deploymentScreen.getUnplacedUnitIds();
        if (unplaced.length === 0) return;
        selected = [unplaced[0]];
      }

      for (const unitId of selected) {
        const unit = unitManager.getUnit(unitId);
        if (!unit) continue;

        pendingDeployRequests.set(unitId, {
          prevX: unit.posX,
          prevZ: unit.posZ,
          wasPlaced: deploymentScreen.isUnitPlaced(unitId),
        });

        unit.posX = targetPos.x;
        unit.posZ = targetPos.z;
        unit.sceneGroup.position.set(
          targetPos.x,
          cameraController.getTerrainHeight(targetPos.x, targetPos.z),
          targetPos.z,
        );
        unitManager.setUnitVisible(unitId, true);
        deploymentScreen.markUnitPlaced(unitId);
        deployedUnitIds.add(unitId);

        connection.send('DEPLOY_UNIT', {
          payload: { unitId, posX: targetPos.x, posZ: targetPos.z, heading: 0 },
        });
      }
      return;
    }

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

      // Send MOVE order to server for server-authoritative movement
      const orderType = activeMovementMode === 'march' ? 'move_fast'
        : activeMovementMode === 'reverse' ? 'reverse'
        : 'move';
      connection.send('ORDER', {
        payload: {
          unitId,
          orderType,
          targetPos,
          moveMode: activeMovementMode,
          shift: queueWaypoint,
        },
      });
    }
  },

  onEngageOrder(targetUnitId, _queueWaypoint) {
    const selected = unitManager.getSelectedIds();
    if (selected.length === 0) return;

    for (const unitId of selected) {
      connection.send('ORDER', {
        payload: {
          unitId,
          orderType: 'engage',
          targetUnitId,
        },
      });
    }
    // Clear engage/area_fire mode after issuing
    if (activeOrderMode === 'engage' || activeOrderMode === 'area_fire') {
      activeOrderMode = null;
      orderBar.clearActive();
    }
  },

  onBoxSelect(screenRect) {
    const ids = unitManager.getUnitsInScreenRect(
      screenRect.x1, screenRect.y1,
      screenRect.x2, screenRect.y2,
    );
    unitManager.deselectAll();
    for (const id of ids) unitManager.selectUnit(id, true);
  },

  onFirePostureChange(posture) {
    const selected = unitManager.getSelectedIds();
    for (const unitId of selected) {
      connection.send('ORDER', {
        payload: {
          unitId,
          orderType: 'set_posture',
          posture,
        },
      });
    }
  },

  onMoveModeChange(mode) {
    // Movement mode is sent as part of the next move order — store the active mode
    activeMovementMode = mode;
  },

  onSpecialOrder(order) {
    const selected = unitManager.getSelectedIds();
    for (const unitId of selected) {
      if (order === 'rally') {
        connection.send('ORDER', {
          payload: { unitId, orderType: 'rally' },
        });
      } else if (order === 'entrench') {
        connection.send('ORDER', {
          payload: { unitId, orderType: 'entrench' },
        });
      } else if (order === 'deploy_smoke') {
        connection.send('ORDER', {
          payload: { unitId, orderType: 'deploy_smoke' },
        });
      } else if (order === 'cancel') {
        connection.send('ORDER', {
          payload: { unitId, orderType: 'cancel' },
        });
      }
    }
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
  setLoadingStage('TERRAIN RECEIVED, CALIBRATING GRID...', 74);
  terrainReady = true;
  currentTerrainData = msg.data;

  // Swap out old terrain
  if (terrainGroup) scene.remove(terrainGroup);
  if (buildingsGroup) scene.remove(buildingsGroup);

  terrainGroup = createTerrainMesh(msg.data);
  scene.add(terrainGroup);

  buildingsGroup = createProceduralBuildingDistricts(msg.data);
  scene.add(buildingsGroup);

  cameraController.setTerrainData(msg.data, 52);
  unitManager.setTerrainHeightSampler((x, z) => cameraController.getTerrainHeight(x, z));

  // M3: Create EffectManager after we have a scene
  if (!effectManager) {
    effectManager = new EffectManager(scene, cameraController.camera);
  }

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
  clearVisionOverlay();
  clearDevEnemyOverlay();
  clearObjectiveOverlay();
  deployedUnitIds.clear();
  pendingDeployRequests.clear();

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
  tryCompleteLoading();
});

// --- TICK_UPDATE handler: apply server-authoritative state deltas ---
connection.on('TICK_UPDATE', (msg: { payload: { tick: number; missionTimeSec: number; unitDeltas: UnitDelta[]; contactDeltas: ContactDelta[]; events: GameEvent[] } }) => {
  const { unitDeltas, contactDeltas, events } = msg.payload;

  if (unitDeltas.length > 0) {
    unitManager.applyUnitDeltas(unitDeltas);
    // Update Y positions from terrain + feed interpolation + update HUD panel
    for (const delta of unitDeltas) {
      // Feed interpolation system with new snapshots
      if (delta.posX !== undefined && delta.posZ !== undefined) {
        const unit = unitManager.getUnit(delta.unitId);
        if (unit) {
          interpolation.pushSnapshot(delta.unitId, {
            posX: unit.posX,
            posZ: unit.posZ,
            heading: unit.heading,
            tick: msg.payload.tick,
          });
          const y = cameraController.getTerrainHeight(unit.posX, unit.posZ);
          unit.sceneGroup.position.setY(y);
        }
      }
      // Update unit panel if this delta is for the selected unit
      unitPanel.update(delta);
    }
  }

  if (contactDeltas.length > 0) {
    unitManager.applyContactDeltas(contactDeltas);
  }

  // M3: Process game events through the effect manager
  if (effectManager && events && events.length > 0) {
    effectManager.processGameEvents(events);
  }

  if (devRevealEnemiesEnabled) {
    connection.send('DEV_QUERY_ENEMIES', { payload: {} });
  }
});

// --- ORDER_ACK handler: command feedback ---
connection.on('ORDER_ACK', (msg: { payload: { orderId: string; unitId: string; status: 'ACCEPTED' | 'REJECTED'; reason?: string } }) => {
  if (msg.payload.status === 'REJECTED') {
    console.warn(`[ORDER] Rejected for ${msg.payload.unitId}: ${msg.payload.reason}`);
  }
});

// --- MISSION_STATE_FULL handler: full state reset (join / reconnect) ---
connection.on('MISSION_STATE_FULL', (msg: { payload: { units: UnitSnapshot[]; contacts: ContactSnapshot[]; objectives?: ObjectiveView[] } }) => {
  const { units, contacts } = msg.payload;
  unitManager.applyFullSnapshot(units, contacts);
  const objectives = msg.payload.objectives ?? [];
  renderObjectivesPanel(objectives);
  renderObjectiveOverlay(objectives);
  setLoadingStage('MISSION SNAPSHOT SYNCHRONIZED...', 90);
  missionSnapshotReady = true;
  tryCompleteLoading();
});

// --- M3: DEPLOYMENT_ZONE handler ---
connection.on('DEPLOYMENT_ZONE', (msg: { payload: DeploymentZonePayload }) => {
  const zoneData = msg.payload;
  console.log(`[M3] Deployment zone received: ${zoneData.vertices.length} vertices, ${zoneData.timeRemainingSec}s`);

  // Build a roster from player's deployed units
  const roster: RosterEntry[] = [];
  for (const unit of unitManager.getAllUnits()) {
    roster.push({
      unitId: unit.unitId,
      unitTypeId: unit.unitTypeId || 'unknown',
      displayName: unit.unitName ?? unit.unitId,
      unitClass: unit.unitClass || 'mbt',
      placed: false,
    });
  }

  deploymentScreen.init(
    renderer.domElement,
    zoneData,
    roster,
    (x, z) => cameraController.getTerrainHeight(x, z),
  );

  for (const unitId of deploymentScreen.getUnplacedUnitIds()) {
    unitManager.setUnitVisible(unitId, false);
  }

  deploymentScreen.onUnitDrag((unitId, screenX, screenY) => {
    // Convert screen position to world coordinates via raycasting
    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraController.camera);

    // Intersect with terrain
    const terrainSurface = terrainGroup?.getObjectByName('terrain-surface');
    if (terrainSurface) {
      const hits = raycaster.intersectObject(terrainSurface, false);
      if (hits.length > 0) {
        const pos = hits[0].point;
        const unit = unitManager.getUnit(unitId);
        if (!unit) return;

        pendingDeployRequests.set(unitId, {
          prevX: unit.posX,
          prevZ: unit.posZ,
          wasPlaced: deploymentScreen.isUnitPlaced(unitId),
        });

        unit.posX = pos.x;
        unit.posZ = pos.z;
        unit.sceneGroup.position.set(pos.x, cameraController.getTerrainHeight(pos.x, pos.z), pos.z);
        unitManager.setUnitVisible(unitId, true);
        deploymentScreen.markUnitPlaced(unitId);
        deployedUnitIds.add(unitId);

        connection.send('DEPLOY_UNIT', {
          payload: { unitId, posX: pos.x, posZ: pos.z, heading: 0 },
        });
      }
    }
  });

  deploymentScreen.onUnitUndeploy((unitId) => {
    const unit = unitManager.getUnit(unitId);
    if (!unit) return;

    pendingDeployRequests.set(unitId, {
      prevX: unit.posX,
      prevZ: unit.posZ,
      wasPlaced: true,
    });

    unitManager.setUnitVisible(unitId, false);
    deploymentScreen.markUnitUnplaced(unitId);
    deployedUnitIds.delete(unitId);
    connection.send('UNDEPLOY_UNIT', { payload: { unitId } });
  });

  deploymentScreen.onReady(() => {
    connection.send('DEPLOY_READY', { payload: {} });
  });
});

// --- M3: MISSION_PHASE handler ---
connection.on('MISSION_PHASE', (msg: { payload: MissionPhasePayload }) => {
  const { phase, missionTimeSec, message } = msg.payload;
  console.log(`[M3] Mission phase: ${phase} — ${message ?? ''}`);
  currentMissionPhase = phase;
  if (phase === 'deployment' || phase === 'live') {
    setLoadingStage('MISSION PHASE CONFIRMED...', 96);
    tryCompleteLoading();
  }

  if (phase === 'live') {
    // Dispose deployment screen when transitioning to live
    for (const unit of unitManager.getAllUnits()) {
      unitManager.setUnitVisible(unit.unitId, true);
    }
    deploymentScreen.dispose();
  }

  if (phase === 'ended') {
    // AAR data will come separately via AAR_DATA message
    clearDevEnemyOverlay();
    clearObjectiveOverlay();
    deploymentScreen.dispose();
  }
});

// --- M3: AAR_DATA handler ---
connection.on('AAR_DATA', (msg: { payload: AARPayload }) => {
  console.log(`[M3] AAR received: ${msg.payload.result}`);
  aarScreen.show(msg.payload);

  aarScreen.onAcknowledge(() => {
    connection.send('AAR_ACK', { payload: {} });
    aarScreen.hide();
    connection.send('DISCONNECT_GRACEFUL', {});
  });
});

connection.on('DEPLOY_UNIT_RESULT', (msg: { payload: { unitId: string; success: boolean; reason?: string } }) => {
  const { unitId, success, reason } = msg.payload;
  const pending = pendingDeployRequests.get(unitId);
  pendingDeployRequests.delete(unitId);

  if (!success) {
    if (pending && !pending.wasPlaced) {
      deploymentScreen.markUnitUnplaced(unitId);
      deployedUnitIds.delete(unitId);
      unitManager.setUnitVisible(unitId, false);
    }

    const unit = unitManager.getUnit(unitId);
    if (unit && pending) {
      unit.posX = pending.prevX;
      unit.posZ = pending.prevZ;
      unit.sceneGroup.position.set(
        pending.prevX,
        cameraController.getTerrainHeight(pending.prevX, pending.prevZ),
        pending.prevZ,
      );
      unitManager.setUnitVisible(unitId, pending.wasPlaced);
    }

    console.warn(`[M3] Deployment rejected for ${unitId}: ${reason ?? 'UNKNOWN'}`);
    return;
  }

  deployedUnitIds.add(unitId);
  deploymentScreen.markUnitPlaced(unitId);
  unitManager.setUnitVisible(unitId, true);
});

connection.on('UNDEPLOY_UNIT_RESULT', (msg: { payload: { unitId: string; success: boolean; reason?: string } }) => {
  const { unitId, success, reason } = msg.payload;
  if (!success) {
    deploymentScreen.markUnitPlaced(unitId);
    deployedUnitIds.add(unitId);
    unitManager.setUnitVisible(unitId, true);
    console.warn(`[M3] Undeploy rejected for ${unitId}: ${reason ?? 'UNKNOWN'}`);
    return;
  }

  deployedUnitIds.delete(unitId);
  deploymentScreen.markUnitUnplaced(unitId);
  unitManager.setUnitVisible(unitId, false);
});

connection.on('DEV_ENEMY_POSITIONS', (msg: { payload: { units: Array<{ unitId: string; posX: number; posZ: number }> } }) => {
  if (!devRevealEnemiesEnabled) return;
  renderDevEnemyOverlay(msg.payload.units);
});

connection.on('DEV_SPAWN_RESULT', (msg: { payload: { success: boolean; unitId: string; name: string; faction: string; posX: number; posZ: number } }) => {
  const { success, name, faction, posX, posZ } = msg.payload;
  if (success) {
    showDevSpawnLog(`Spawned: ${name} (${faction}) at (${posX.toFixed(0)}, ${posZ.toFixed(0)})`);
  } else {
    showDevSpawnLog('Spawn failed — no unit types available for faction');
  }
});

connection.connect();

// Terrain regeneration — shared by hotkey and UI button
function requestTerrainRegen(hiRes: boolean): void {
  const seed = Math.random() * 1_000_000;
  const payload: Record<string, unknown> = { seed, batloc: currentBatloc };
  if (hiRes) { payload.width = 640; payload.height = 640; }
  console.log(`Requesting terrain seed=${seed.toFixed(0)} batloc=${currentBatloc}${hiRes ? ' (hi-res)' : ''}`);
  connection.send('generate', payload);
}

// Terrain regeneration hotkeys
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyG') {
    requestTerrainRegen(e.shiftKey);
    return;
  }
  // B = cycle batloc preset forward
  if (e.code === 'KeyB') {
    const idx = BATLOC_PRESETS.indexOf(currentBatloc);
    currentBatloc = BATLOC_PRESETS[(idx + 1) % BATLOC_PRESETS.length];
    batlocSelect.value = currentBatloc;
    return;
  }
  // C = toggle vision overlay for selected unit
  if (e.code === 'KeyC') {
    if (visionUnitId) {
      clearVisionOverlay();
      return;
    }
    const selectedIds = unitManager.getSelectedIds();
    if (selectedIds.length === 0 || !currentTerrainData) return;
    const unit = unitManager.getUnit(selectedIds[0]);
    if (!unit) return;
    visionUnitId        = unit.unitId;
    visionLastX         = unit.posX;
    visionLastZ         = unit.posZ;
    lastVisionRebuildMs = performance.now();
    visionOverlay = buildVisionOverlay(
      unit.posX,
      unit.posZ,
      currentTerrainData,
      (x, z) => cameraController.getTerrainHeight(x, z),
    );
    scene.add(visionOverlay);
    return;
  }

  // V = developer overlay for true enemy positions
  if (e.code === 'KeyV') {
    devRevealEnemiesEnabled = !devRevealEnemiesEnabled;
    if (!devRevealEnemiesEnabled) {
      clearDevEnemyOverlay();
      return;
    }
    connection.send('DEV_QUERY_ENEMIES', { payload: {} });
  }

  // Backquote (`) = dev spawn enemy tool (was X, moved to avoid conflict with Cancel order)
  if (e.code === 'Backquote') {
    toggleDevSpawnMode();
  }
});

// --- Server tick tracker for interpolation ---
let lastServerTick = 0;
connection.on('TICK_UPDATE', (msg: { payload: { tick: number } }) => {
  lastServerTick = msg.payload.tick;
});
connection.on('PONG', (msg: { payload: { serverTick: number } }) => {
  if (msg.payload.serverTick > lastServerTick) lastServerTick = msg.payload.serverTick;
});

// --- Client-side movement integration ---
// During the LIVE phase, movement is server-authoritative — positions arrive
// via TICK_UPDATE deltas and are applied in the handler above.  The local
// path-following loop below only runs during DEPLOYMENT (drag-to-place preview
// movement) and when there is no active server connection.
const UNIT_SPEED_M_PER_SEC = 8; // ~29 km/h cross-country advance
const CELL_REAL_M = 20;         // real-world metres represented by one terrain cell

function tickClientMovement(dt: number): void {
  if (!currentTerrainData) return;

  // In live play the server moves units — skip local path integration
  if (currentMissionPhase === 'live' || currentMissionPhase === 'extraction') {
    // Still keep scene Y in sync with terrain for all units
    for (const unit of unitManager.getAllUnits()) {
      const terrainY = cameraController.getTerrainHeight(unit.posX, unit.posZ);
      unit.sceneGroup.position.set(unit.posX, terrainY, unit.posZ);
    }
    return;
  }

  const speedCellsPerSec = UNIT_SPEED_M_PER_SEC / CELL_REAL_M;

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
      unit.posX = target.x;
      unit.posZ = target.z;
      move.pathIndex++;
    } else {
      const ratio = stepDist / dist;
      unit.posX += dx * ratio;
      unit.posZ += dz * ratio;
      unit.heading = Math.atan2(dx, dz) * (180 / Math.PI);
      if (unit.heading < 0) unit.heading += 360;
    }

    const terrainY = cameraController.getTerrainHeight(unit.posX, unit.posZ);
    unit.sceneGroup.position.set(unit.posX, terrainY, unit.posZ);
  }

  // For stationary units, also keep them grounded after terrain changes
  for (const unit of unitManager.getAllUnits()) {
    if (unitMoves.has(unit.unitId)) continue;
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

  // Interpolation disabled — TICK_UPDATE deltas already set authoritative positions.
  // Re-enable once the server broadcasts at a higher rate with enough snapshots
  // to fill the interpolation ring buffer reliably.

  unitManager.updateFrame();

  // M3: Update effects (particles, decals, screen shake)
  if (effectManager) {
    const camPos = cameraController.camera.position;
    effectManager.update(dt, { x: camPos.x, z: camPos.z });
  }

  // --- Vision overlay: rebuild when tracked unit has moved enough ---
  if (visionUnitId && currentTerrainData) {
    const unit = unitManager.getUnit(visionUnitId);
    if (!unit || unit.isDestroyed) {
      clearVisionOverlay();
    } else {
      const dx = unit.posX - visionLastX;
      const dz = unit.posZ - visionLastZ;
      const now = performance.now();
      if (
        dx * dx + dz * dz >= VISION_REBUILD_DIST_SQ &&
        now - lastVisionRebuildMs >= VISION_REBUILD_MIN_MS
      ) {
        // Dispose old mesh, keep visionUnitId alive
        if (visionOverlay) {
          scene.remove(visionOverlay);
          visionOverlay.geometry.dispose();
          (visionOverlay.material as THREE.Material).dispose();
          visionOverlay = null;
        }
        visionLastX         = unit.posX;
        visionLastZ         = unit.posZ;
        lastVisionRebuildMs = now;
        visionOverlay = buildVisionOverlay(
          unit.posX,
          unit.posZ,
          currentTerrainData,
          (x, z) => cameraController.getTerrainHeight(x, z),
        );
        scene.add(visionOverlay);
      }
    }
  }

  renderer.render(scene, cameraController.camera);
}

animate();

