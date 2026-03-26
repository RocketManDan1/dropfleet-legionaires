// ============================================================================
// CLICK HANDLER — mouse/keyboard input handling for the tactical view
// Milestone: 1 ("One Unit on a Map")
//
// Translates raw browser input events into game-meaningful actions:
// select, move, engage, queue waypoints, drag-box multi-select.
// Emits structured callbacks instead of directly mutating game state.
// ============================================================================

import * as THREE from 'three';
import type {
  Vec2,
  FirePosture,
  MoveMode,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a click on the terrain — a world-space position. */
export interface TerrainClickResult {
  worldPos: Vec2;
  screenX: number;
  screenY: number;
}

/** Callbacks the InputHandler invokes when meaningful input occurs. */
export interface InputCallbacks {
  /**
   * Left-click on empty terrain or a unit — select or deselect.
   * @param unitId - ID of clicked unit, or null if terrain was clicked.
   * @param isContact - True if clicked entity is an enemy contact.
   * @param addToSelection - True if Ctrl/Shift was held (multi-select).
   */
  onSelect(unitId: string | null, isContact: boolean, addToSelection: boolean): void;

  /**
   * Right-click on terrain — issue a move order to selected units.
   * @param targetPos - World position to move to.
   * @param queueWaypoint - True if Shift was held (append to waypoint queue).
   */
  onMoveOrder(targetPos: Vec2, queueWaypoint: boolean): void;

  /**
   * Right-click on an enemy contact — issue an engage order.
   * @param targetUnitId - The contact ID to engage.
   * @param queueWaypoint - True if Shift was held.
   */
  onEngageOrder(targetUnitId: string, queueWaypoint: boolean): void;

  /**
   * Drag-box multi-select completed.
   * @param screenRect - The screen-space rectangle {x1, y1, x2, y2}.
   */
  onBoxSelect(screenRect: { x1: number; y1: number; x2: number; y2: number }): void;

  /**
   * Fire posture change requested via keyboard shortcut.
   * @param posture - The requested fire posture.
   */
  onFirePostureChange(posture: FirePosture): void;

  /**
   * Movement mode change requested via keyboard shortcut.
   * @param mode - The requested movement mode.
   */
  onMoveModeChange(mode: MoveMode): void;

  /**
   * Special order requested via keyboard shortcut.
   * @param order - 'entrench' | 'deploy_smoke' | 'rally'
   */
  onSpecialOrder(order: 'entrench' | 'deploy_smoke' | 'rally'): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum drag distance (pixels) before a click becomes a box-select. */
const DRAG_THRESHOLD_PX = 8;

// ---------------------------------------------------------------------------
// InputHandler
// ---------------------------------------------------------------------------

/**
 * Handles all mouse and keyboard input for the tactical view.
 *
 * Input mapping:
 * - Left click:        Select unit / deselect (click terrain)
 * - Ctrl+Left click:   Add to selection (multi-select)
 * - Left drag:         Box-select (drag rectangle)
 * - Right click:       Move order to terrain position
 * - Right click enemy: Engage order
 * - Shift+Right click: Queue waypoint (append to move/engage queue)
 * - 1:                 Fire posture — free fire (Milestone 2+)
 * - 2:                 Fire posture — return fire (Milestone 2+)
 * - 3:                 Fire posture — hold fire (Milestone 2+)
 * - 4:                 Movement mode cycle (Milestone 2+)
 * - E:                 Entrench (Milestone 2+)
 * - K:                 Deploy smoke (Milestone 2+)
 * - R:                 Rally (Milestone 2+)
 *
 * Middle mouse and scroll are handled by the RTSCamera controller
 * and are NOT intercepted here.
 */
export class InputHandler {
  /** Callback interface — the consumer wires these up. */
  private callbacks: InputCallbacks;

  /** Camera used for terrain raycasting. */
  private camera: THREE.Camera;

  /** Raycaster for projecting screen clicks to terrain. */
  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  /** Terrain mesh (or ground plane) for click-to-position raycasting. */
  private terrainMesh: THREE.Object3D | null = null;

  /**
   * Function provided by the consumer to check if a unit/contact
   * exists at a given screen position. Returns { unitId, isContact }
   * or null.
   */
  private pickUnitAtScreen: (
    x: number,
    y: number,
  ) => { unitId: string; isContact: boolean } | null;

  // --- Drag state ---
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragCurrentX = 0;
  private dragCurrentY = 0;
  private leftButtonDown = false;

  /** Current movement mode for the Digit4 cycle. */
  private currentMoveMode: MoveMode = 'advance';

  // --- Box select visual overlay ---
  private boxOverlay: HTMLDivElement;

  // --- Bound event handlers (for cleanup) ---
  private _onMouseDown: (e: MouseEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseUp: (e: MouseEvent) => void;
  private _onKeyDown: (e: KeyboardEvent) => void;

  /**
   * @param camera - The Three.js camera for raycasting.
   * @param callbacks - Game logic callbacks for each input action.
   * @param pickUnitAtScreen - Function from UnitManager.getUnitAtScreenPos().
   */
  constructor(
    camera: THREE.Camera,
    callbacks: InputCallbacks,
    pickUnitAtScreen: (
      x: number,
      y: number,
    ) => { unitId: string; isContact: boolean } | null,
  ) {
    this.camera = camera;
    this.callbacks = callbacks;
    this.pickUnitAtScreen = pickUnitAtScreen;

    // Create the box-select overlay div
    this.boxOverlay = document.createElement('div');
    this.boxOverlay.style.cssText = `
      position: fixed;
      border: 1px solid rgba(0, 255, 136, 0.7);
      background: rgba(0, 255, 136, 0.1);
      pointer-events: none;
      display: none;
      z-index: 100;
    `;
    document.body.appendChild(this.boxOverlay);

    // Bind event handlers
    this._onMouseDown = this.handleMouseDown.bind(this);
    this._onMouseMove = this.handleMouseMove.bind(this);
    this._onMouseUp = this.handleMouseUp.bind(this);
    this._onKeyDown = this.handleKeyDown.bind(this);

    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Sets the terrain mesh used for click-to-world raycasting.
   * Call this after terrain is generated.
   */
  setTerrainMesh(mesh: THREE.Object3D): void {
    this.terrainMesh = mesh;
  }

  // -------------------------------------------------------------------------
  // Mouse event handlers
  // -------------------------------------------------------------------------

  private handleMouseDown(e: MouseEvent): void {
    // Skip game-input when clicking on HUD / UI elements (buttons, selects, etc.)
    if (this.isUIElement(e.target as HTMLElement)) return;

    if (e.button === 0) {
      // Left mouse button
      this.leftButtonDown = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragCurrentX = e.clientX;
      this.dragCurrentY = e.clientY;
      this.isDragging = false;
    }

    if (e.button === 2) {
      // Right mouse button — move or engage order
      // (Only process on mouseup to avoid conflict with camera pan;
      //  camera.ts handles right-drag for panning separately.)
      // We handle right-click on mousedown for responsiveness.
      this.handleRightClick(e);
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.leftButtonDown) return;

    this.dragCurrentX = e.clientX;
    this.dragCurrentY = e.clientY;

    const dx = this.dragCurrentX - this.dragStartX;
    const dy = this.dragCurrentY - this.dragStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > DRAG_THRESHOLD_PX) {
      this.isDragging = true;
      this.updateBoxOverlay();
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;

    // Skip game-input when releasing on HUD / UI elements
    if (this.isUIElement(e.target as HTMLElement)) {
      this.leftButtonDown = false;
      this.isDragging = false;
      this.boxOverlay.style.display = 'none';
      return;
    }

    this.leftButtonDown = false;

    if (this.isDragging) {
      // Finish box-select
      this.isDragging = false;
      this.boxOverlay.style.display = 'none';

      this.callbacks.onBoxSelect({
        x1: this.dragStartX,
        y1: this.dragStartY,
        x2: this.dragCurrentX,
        y2: this.dragCurrentY,
      });
    } else {
      // Single left click — select or deselect
      this.handleLeftClick(e);
    }
  }

  // -------------------------------------------------------------------------
  // Click processing
  // -------------------------------------------------------------------------

  /**
   * Processes a single left click: picks a unit at the cursor, or deselects.
   */
  private handleLeftClick(e: MouseEvent): void {
    const addToSelection = e.ctrlKey || e.shiftKey;

    const pick = this.pickUnitAtScreen(e.clientX, e.clientY);
    if (pick) {
      this.callbacks.onSelect(pick.unitId, pick.isContact, addToSelection);
    } else {
      // Clicked empty terrain — deselect (unless holding Ctrl/Shift)
      if (!addToSelection) {
        this.callbacks.onSelect(null, false, false);
      }
    }
  }

  /**
   * Processes a right click: issues move or engage order.
   */
  private handleRightClick(e: MouseEvent): void {
    const queueWaypoint = e.shiftKey;

    // Check if right-clicking on an enemy contact
    const pick = this.pickUnitAtScreen(e.clientX, e.clientY);
    if (pick && pick.isContact) {
      this.callbacks.onEngageOrder(pick.unitId, queueWaypoint);
      return;
    }

    // Otherwise, raycast to terrain for move position
    const terrainPos = this.raycastTerrain(e.clientX, e.clientY);
    if (terrainPos) {
      this.callbacks.onMoveOrder(terrainPos, queueWaypoint);
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  /**
   * Processes keyboard shortcuts for fire postures, movement modes,
   * and special orders.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;

    // Don't capture if user is typing in an input field
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (e.code) {
      // --- Fire posture (Milestone 2+) ---
      case 'Digit1':
        this.callbacks.onFirePostureChange('free_fire');
        break;
      case 'Digit2':
        this.callbacks.onFirePostureChange('return_fire');
        break;
      case 'Digit3':
        this.callbacks.onFirePostureChange('hold_fire');
        break;

      // --- Movement mode cycle: advance -> march -> reverse -> advance ---
      case 'Digit4': {
        const cycle: MoveMode[] = ['advance', 'march', 'reverse'];
        const idx = cycle.indexOf(this.currentMoveMode);
        this.currentMoveMode = cycle[(idx + 1) % cycle.length];
        this.callbacks.onMoveModeChange(this.currentMoveMode);
        break;
      }

      // Note: E, R, K, S, N, X etc. are handled by OrderButtonBar hotkeys.
      // Do NOT duplicate them here — it causes conflicting orders.

      default:
        // Not a handled key — do nothing
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Terrain raycasting
  // -------------------------------------------------------------------------

  /**
   * Raycasts from screen coordinates to the terrain mesh (or a ground plane
   * fallback) and returns the world-space XZ intersection point.
   *
   * @returns The world-space {x, z} position, or null if no intersection.
   */
  private raycastTerrain(screenX: number, screenY: number): Vec2 | null {
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    if (this.terrainMesh) {
      // Raycast against terrain mesh
      const intersects = this.raycaster.intersectObject(this.terrainMesh, true);
      if (intersects.length > 0) {
        const point = intersects[0].point;
        return { x: point.x, z: point.z };
      }
    }

    // Fallback: intersect with a horizontal plane at Y=0
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    const ray = this.raycaster.ray;
    if (ray.intersectPlane(groundPlane, intersection)) {
      return { x: intersection.x, z: intersection.z };
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // UI element detection
  // -------------------------------------------------------------------------

  /**
   * Returns true if the element (or any ancestor) is a HUD/UI control that
   * should NOT be interpreted as a game-world click.
   */
  private isUIElement(el: HTMLElement | null): boolean {
    if (!el) return false;
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      const tag = node.tagName;
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (node.classList.contains('order-bar')) return true;
      if (node.classList.contains('unit-panel')) return true;
      if (node.classList.contains('deployment-screen')) return true;
      if (node.classList.contains('aar-screen')) return true;
      node = node.parentElement;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Box-select overlay
  // -------------------------------------------------------------------------

  /**
   * Updates the visual overlay rectangle during a drag-select.
   */
  private updateBoxOverlay(): void {
    const left = Math.min(this.dragStartX, this.dragCurrentX);
    const top = Math.min(this.dragStartY, this.dragCurrentY);
    const width = Math.abs(this.dragCurrentX - this.dragStartX);
    const height = Math.abs(this.dragCurrentY - this.dragStartY);

    this.boxOverlay.style.left = `${left}px`;
    this.boxOverlay.style.top = `${top}px`;
    this.boxOverlay.style.width = `${width}px`;
    this.boxOverlay.style.height = `${height}px`;
    this.boxOverlay.style.display = 'block';
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Removes all event listeners and DOM elements.
   * Call when leaving the tactical view.
   */
  dispose(): void {
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('keydown', this._onKeyDown);

    if (this.boxOverlay.parentElement) {
      this.boxOverlay.parentElement.removeChild(this.boxOverlay);
    }
  }
}
