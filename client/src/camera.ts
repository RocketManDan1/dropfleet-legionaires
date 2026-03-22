import * as THREE from 'three';

export interface TerrainCollisionData {
  width: number;
  height: number;
  heightmap: number[];
  seaLevel: number;
}

/**
 * Standard RTS camera controller.
 * - Middle mouse drag: orbit (rotate around look-at point)
 * - Right mouse drag: pan
 * - Scroll wheel: zoom
 * - WASD / arrow keys: pan
 * - Edge scrolling: pan when cursor near screen edge
 */
export class RTSCamera {
  camera: THREE.PerspectiveCamera;

  // Orbit state
  private target = new THREE.Vector3(100, 0, 100); // look-at point
  private distance = 120;
  private azimuth = Math.PI * 0.25;   // horizontal angle
  private elevation = Math.PI * 0.3;  // vertical angle (from horizontal)

  // Limits
  private minDistance = 20;
  private maxDistance = 300;
  private minElevation = 0.1;
  private maxElevation = Math.PI * 0.45;

  // Input state
  private keys = new Set<string>();
  private isDragging = false;
  private dragButton = -1;
  private lastMouse = { x: 0, y: 0 };
  private mousePos = { x: 0, y: 0 };

  // Pan speed
  private panSpeed = 0.15;
  private keyPanSpeed = 1.5;
  private orbitSpeed = 0.005;
  private zoomSpeed = 8;
  private edgeScrollZone = 40; // pixels from edge

  // Terrain collision data
  private hmData: number[] | null = null;
  private hmWidth = 0;
  private hmHeight = 0;
  private hmScale = 40;
  private hmSeaLevel = 0;
  private hmDiscRadius = 0;
  private hmCurvatureRadius = 4000;
  private cameraMargin = 5;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.5, 2000);
    this.updateCameraPosition();
    this.bindEvents();
  }

  setTerrainData(data: TerrainCollisionData, scale: number) {
    this.hmData = data.heightmap;
    this.hmWidth = data.width;
    this.hmHeight = data.height;
    this.hmScale = scale;
    this.hmSeaLevel = data.seaLevel * scale;
    this.hmDiscRadius = Math.min(data.width, data.height) / 2;
    this.target.set(data.width / 2, 0, data.height / 2);
  }

  getTerrainHeight(worldX: number, worldZ: number): number {
    if (!this.hmData) return 0;

    const x = Math.max(0, Math.min(this.hmWidth - 2, worldX));
    const z = Math.max(0, Math.min(this.hmHeight - 2, worldZ));

    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;

    // Bilinear interpolation
    const h00 = this.hmData[iz * this.hmWidth + ix];
    const h10 = this.hmData[iz * this.hmWidth + ix + 1];
    const h01 = this.hmData[(iz + 1) * this.hmWidth + ix];
    const h11 = this.hmData[(iz + 1) * this.hmWidth + ix + 1];

    const h = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) +
              h01 * (1 - fx) * fz + h11 * fx * fz;

    let height = h * this.hmScale;

    // Edge taper (matches terrain vertex shader)
    const centerX = this.hmWidth / 2;
    const centerZ = this.hmHeight / 2;
    const dx = worldX - centerX;
    const dz = worldZ - centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const t = Math.max(0, Math.min(1,
      (dist - this.hmDiscRadius) / (this.hmDiscRadius * 0.88 - this.hmDiscRadius)));
    const edgeFade = t * t * (3 - 2 * t);
    height = this.hmSeaLevel + (height - this.hmSeaLevel) * edgeFade;

    // Spherical curvature
    const drop = (dist * dist) / (2 * this.hmCurvatureRadius);
    height -= drop;

    return height;
  }

  private getSeaLevelAt(worldX: number, worldZ: number): number {
    const centerX = this.hmWidth / 2;
    const centerZ = this.hmHeight / 2;
    const dx = worldX - centerX;
    const dz = worldZ - centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const drop = (dist * dist) / (2 * this.hmCurvatureRadius);
    return this.hmSeaLevel - drop;
  }

  private bindEvents() {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    window.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2) { // middle or right
        this.isDragging = true;
        this.dragButton = e.button;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.dragButton = -1;
    });

    window.addEventListener('mousemove', (e) => {
      this.mousePos = { x: e.clientX, y: e.clientY };

      if (!this.isDragging) return;

      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      if (this.dragButton === 1) {
        // Middle mouse: orbit
        this.azimuth -= dx * this.orbitSpeed;
        this.elevation += dy * this.orbitSpeed;
        this.elevation = THREE.MathUtils.clamp(
          this.elevation, this.minElevation, this.maxElevation
        );
      } else if (this.dragButton === 2) {
        // Right mouse: pan
        const forward = new THREE.Vector3(
          -Math.sin(this.azimuth), 0, -Math.cos(this.azimuth)
        );
        const right = new THREE.Vector3(
          Math.cos(this.azimuth), 0, -Math.sin(this.azimuth)
        );
        this.target.addScaledVector(right, -dx * this.panSpeed);
        this.target.addScaledVector(forward, dy * this.panSpeed);
      }
    });

    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance += Math.sign(e.deltaY) * this.zoomSpeed;
      this.distance = THREE.MathUtils.clamp(
        this.distance, this.minDistance, this.maxDistance
      );
    }, { passive: false });

    // Prevent context menu on right click
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(_dt: number) {
    // Keyboard panning
    const forward = new THREE.Vector3(
      -Math.sin(this.azimuth), 0, -Math.cos(this.azimuth)
    );
    const right = new THREE.Vector3(
      Math.cos(this.azimuth), 0, -Math.sin(this.azimuth)
    );

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))
      this.target.addScaledVector(forward, this.keyPanSpeed);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))
      this.target.addScaledVector(forward, -this.keyPanSpeed);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))
      this.target.addScaledVector(right, -this.keyPanSpeed);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight'))
      this.target.addScaledVector(right, this.keyPanSpeed);

    // Edge scrolling
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ez = this.edgeScrollZone;
    const edgeSpeed = this.keyPanSpeed * 0.8;

    if (this.mousePos.x < ez)
      this.target.addScaledVector(right, -edgeSpeed);
    if (this.mousePos.x > w - ez)
      this.target.addScaledVector(right, edgeSpeed);
    if (this.mousePos.y < ez)
      this.target.addScaledVector(forward, edgeSpeed);
    if (this.mousePos.y > h - ez)
      this.target.addScaledVector(forward, -edgeSpeed);

    // Set target Y to terrain surface (or sea level if over water)
    if (this.hmData) {
      const terrainH = this.getTerrainHeight(this.target.x, this.target.z);
      const seaH = this.getSeaLevelAt(this.target.x, this.target.z);
      this.target.y = Math.max(terrainH, seaH);
    }

    this.updateCameraPosition();
  }

  private updateCameraPosition() {
    const x = this.target.x + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
    const y = this.target.y + this.distance * Math.sin(this.elevation);
    const z = this.target.z + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);

    // Terrain collision — keep camera above terrain + margin
    if (this.hmData) {
      const terrainH = this.getTerrainHeight(x, z);
      const seaH = this.getSeaLevelAt(x, z);
      const surfaceH = Math.max(terrainH, seaH);
      const minY = surfaceH + this.cameraMargin;
      this.camera.position.set(x, Math.max(y, minY), z);
    } else {
      this.camera.position.set(x, y, z);
    }

    this.camera.lookAt(this.target);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
