import * as THREE from 'three';
import { RTSCamera } from './camera';
import { GameConnection } from './network';
import { createTerrainMesh, TerrainData } from './terrain';
import { createProceduralBuildingDistricts } from './buildings';

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
tacticalLegend.textContent = 'BRIGHT RIDGES = LONG VIS | HATCHED BASINS = MORE COVER | G = REGENERATE | SHIFT+G = HI-RES';
document.body.appendChild(tacticalLegend);

// --- Network ---
const connection = new GameConnection();

let terrainGroup: THREE.Group | null = null;
let buildingsGroup: THREE.Group | null = null;

connection.on('terrain', (msg: { data: TerrainData }) => {
  console.log(`Received terrain — biome: ${msg.data.biome}`);

  // Remove previous terrain
  if (terrainGroup) {
    scene.remove(terrainGroup);
  }
  if (buildingsGroup) {
    scene.remove(buildingsGroup);
  }

  terrainGroup = createTerrainMesh(msg.data);
  scene.add(terrainGroup);

  buildingsGroup = createProceduralBuildingDistricts(msg.data);
  scene.add(buildingsGroup);

  cameraController.setTerrainData(msg.data, 52);
});

connection.connect();

// On-demand regeneration: press G for a new random terrain seed.
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

// --- Render loop ---
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  cameraController.update(dt);
  renderer.render(scene, cameraController.camera);
}

animate();
