// ============================================================================
// DEPLOYMENT SCREEN — shared deployment zone, unit placement, countdown timer
// Milestone: 3 ("Playable Mission")
// Source: DEPLOYMENT_PHASE.md, UI_FLOW.md
//
// Renders a translucent green polygon overlay on the Three.js scene showing
// the deployment zone, plus HTML overlay UI for the countdown timer, unit
// roster sidebar, and Ready button. Players drag units from the roster list
// onto the map within the zone boundary. Uses DRONECOM C2 aesthetic
// (dark background, green/amber text, monospace font, scan-line feel).
// ============================================================================

import * as THREE from 'three';
import type {
  DeploymentZonePayload,
  Vec2,
} from '@legionaires/shared';
import {
  DEPLOYMENT_TIMER_SEC,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A unit entry in the deployment roster — tracks placement state. */
export interface RosterEntry {
  unitTypeId: string;
  displayName: string;
  unitClass: string;
  placed: boolean;
}

/** Callback fired when the player drags a unit from roster toward the map. */
export type UnitDragCallback = (unitTypeId: string, screenX: number, screenY: number) => void;

/** Callback fired when the player clicks "Ready". */
export type ReadyCallback = () => void;

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

const STYLE_ID = 'deployment-screen-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes deployment-scanline {
      0%   { background-position: 0 0; }
      100% { background-position: 0 4px; }
    }

    .deploy-root {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      font-family: 'Courier New', Courier, monospace;
      z-index: 100;
    }

    /* --- Timer banner --- */
    .deploy-timer {
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(8, 10, 10, 0.82);
      border: 1px solid rgba(0, 255, 65, 0.4);
      padding: 10px 28px;
      color: #00ff41;
      font-size: 26px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      pointer-events: none;
      user-select: none;
      text-shadow: 0 0 8px rgba(0, 255, 65, 0.5);
    }

    .deploy-timer-warning {
      color: #ffdc00;
      border-color: rgba(255, 220, 0, 0.5);
      text-shadow: 0 0 8px rgba(255, 220, 0, 0.5);
    }

    .deploy-timer-critical {
      color: #ff4136;
      border-color: rgba(255, 65, 54, 0.5);
      text-shadow: 0 0 8px rgba(255, 65, 54, 0.5);
      animation: deployment-blink 0.5s step-end infinite;
    }

    @keyframes deployment-blink {
      50% { opacity: 0.4; }
    }

    /* --- Roster sidebar --- */
    .deploy-sidebar {
      position: absolute;
      top: 80px;
      right: 16px;
      width: 260px;
      max-height: calc(100vh - 180px);
      overflow-y: auto;
      background: rgba(8, 10, 10, 0.88);
      border: 1px solid rgba(0, 255, 65, 0.3);
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .deploy-sidebar-header {
      padding: 10px 12px;
      color: #00ff41;
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(0, 255, 65, 0.2);
      background: rgba(0, 255, 65, 0.06);
      user-select: none;
    }

    .deploy-section-label {
      padding: 6px 12px;
      color: rgba(0, 255, 65, 0.6);
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(0, 255, 65, 0.1);
      user-select: none;
    }

    .deploy-unit-item {
      padding: 8px 12px;
      color: #c0d8c0;
      font-size: 12px;
      letter-spacing: 0.04em;
      border-bottom: 1px solid rgba(0, 255, 65, 0.08);
      cursor: grab;
      transition: background 0.15s;
      user-select: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .deploy-unit-item:hover {
      background: rgba(0, 255, 65, 0.1);
    }

    .deploy-unit-item:active {
      cursor: grabbing;
      background: rgba(0, 255, 65, 0.2);
    }

    .deploy-unit-item-placed {
      color: rgba(0, 255, 65, 0.4);
      cursor: default;
      text-decoration: line-through;
    }

    .deploy-unit-item-placed:hover {
      background: transparent;
    }

    .deploy-unit-class-badge {
      font-size: 9px;
      padding: 2px 5px;
      border: 1px solid rgba(0, 255, 65, 0.3);
      color: #00ff41;
      border-radius: 2px;
      flex-shrink: 0;
      margin-left: 8px;
    }

    /* --- Reserve counter --- */
    .deploy-reserve-info {
      padding: 8px 12px;
      color: #ffdc00;
      font-size: 11px;
      letter-spacing: 0.06em;
      border-top: 1px solid rgba(255, 220, 0, 0.2);
      user-select: none;
    }

    /* --- Ready button --- */
    .deploy-ready-btn {
      display: block;
      width: calc(100% - 24px);
      margin: 12px auto;
      padding: 10px 0;
      background: rgba(0, 255, 65, 0.12);
      border: 1px solid #00ff41;
      color: #00ff41;
      font-family: 'Courier New', Courier, monospace;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.2s, box-shadow 0.2s;
      pointer-events: auto;
    }

    .deploy-ready-btn:hover {
      background: rgba(0, 255, 65, 0.25);
      box-shadow: 0 0 12px rgba(0, 255, 65, 0.3);
    }

    .deploy-ready-btn:active {
      background: rgba(0, 255, 65, 0.35);
    }

    .deploy-ready-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* --- Instructions banner --- */
    .deploy-instructions {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(8, 10, 10, 0.78);
      border: 1px solid rgba(0, 255, 65, 0.25);
      padding: 8px 20px;
      color: rgba(200, 210, 210, 0.7);
      font-size: 11px;
      letter-spacing: 0.06em;
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
    }

    /* Scrollbar styling */
    .deploy-sidebar::-webkit-scrollbar {
      width: 4px;
    }
    .deploy-sidebar::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.3);
    }
    .deploy-sidebar::-webkit-scrollbar-thumb {
      background: rgba(0, 255, 65, 0.3);
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// DeploymentScreen
// ---------------------------------------------------------------------------

export class DeploymentScreen {
  // Three.js state
  private scene: THREE.Scene | null = null;
  private zoneGroup: THREE.Group | null = null;

  // DOM elements
  private rootEl: HTMLDivElement | null = null;
  private timerEl: HTMLDivElement | null = null;
  private sidebarEl: HTMLDivElement | null = null;
  private toPlaceListEl: HTMLDivElement | null = null;
  private placedListEl: HTMLDivElement | null = null;
  private reserveInfoEl: HTMLDivElement | null = null;
  private readyBtnEl: HTMLButtonElement | null = null;
  private instructionsEl: HTMLDivElement | null = null;

  // State
  private roster: RosterEntry[] = [];
  private zoneVertices: Vec2[] = [];
  private reserveSlots = 0;
  private currentTimerSec: number = DEPLOYMENT_TIMER_SEC;

  // Callbacks
  private unitDragCb: UnitDragCallback | null = null;
  private readyCb: ReadyCallback | null = null;

  // Bound listener refs for cleanup
  private boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private dragUnitTypeId: string | null = null;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initializes the deployment screen: renders the zone polygon overlay on
   * the Three.js scene and creates all DOM overlay elements.
   *
   * @param canvas - The WebGL canvas element (used for coordinate mapping).
   * @param zoneData - Server-provided deployment zone payload.
   * @param roster - List of units the player can deploy.
   */
  init(
    canvas: HTMLCanvasElement,
    zoneData: DeploymentZonePayload,
    roster: RosterEntry[] = [],
  ): void {
    injectStyles();

    this.zoneVertices = zoneData.vertices;
    this.currentTimerSec = zoneData.timeRemainingSec;
    this.reserveSlots = zoneData.reserveSlots;
    this.roster = roster.map((r) => ({ ...r }));

    // Retrieve the scene from the canvas renderer
    this.scene = this._findScene(canvas);

    // Build Three.js zone overlay
    this._buildZoneOverlay();

    // Build DOM overlay
    this._buildDOM();

    // Re-render sidebar
    this._renderRoster();

    // Update timer display
    this._renderTimer();
  }

  /**
   * Registers a callback invoked when the player drags a unit from the
   * roster toward the map. The consumer should use the screen coordinates
   * to raycast into the scene and determine world placement position.
   */
  onUnitDrag(callback: UnitDragCallback): void {
    this.unitDragCb = callback;
  }

  /**
   * Registers a callback invoked when the player clicks the "Ready" button,
   * signaling that they have finished placing units and want to begin
   * the mission.
   */
  onReady(callback: ReadyCallback): void {
    this.readyCb = callback;
  }

  /**
   * Updates the countdown timer display. The server sends periodic updates
   * and this adjusts the visual to match.
   *
   * @param secondsLeft - Remaining seconds in the deployment phase.
   */
  updateTimer(secondsLeft: number): void {
    this.currentTimerSec = Math.max(0, Math.round(secondsLeft));
    this._renderTimer();
  }

  /**
   * Moves a unit from the "to place" list to the "placed" list after the
   * server confirms successful placement.
   *
   * @param unitTypeId - The type ID of the unit that was placed.
   */
  markUnitPlaced(unitTypeId: string): void {
    const entry = this.roster.find(
      (r) => r.unitTypeId === unitTypeId && !r.placed,
    );
    if (entry) {
      entry.placed = true;
      this._renderRoster();
    }
  }

  /**
   * Adds a unit to the roster dynamically (e.g., for late-join reserve
   * units that become available mid-deployment).
   */
  addRosterEntry(entry: RosterEntry): void {
    this.roster.push({ ...entry });
    this._renderRoster();
  }

  /**
   * Removes all DOM elements, Three.js objects, and event listeners
   * created by this screen.
   */
  dispose(): void {
    // Remove Three.js zone overlay
    if (this.zoneGroup && this.scene) {
      this.scene.remove(this.zoneGroup);
      this.zoneGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.zoneGroup = null;
    }

    // Remove DOM overlay
    if (this.rootEl && this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
    this.rootEl = null;
    this.timerEl = null;
    this.sidebarEl = null;
    this.toPlaceListEl = null;
    this.placedListEl = null;
    this.reserveInfoEl = null;
    this.readyBtnEl = null;
    this.instructionsEl = null;

    // Remove global pointer-up listener
    if (this.boundPointerUp) {
      window.removeEventListener('pointerup', this.boundPointerUp);
      this.boundPointerUp = null;
    }

    // Clear callbacks
    this.unitDragCb = null;
    this.readyCb = null;

    this.scene = null;
  }

  // -------------------------------------------------------------------------
  // Private — Three.js zone overlay
  // -------------------------------------------------------------------------

  /**
   * Attempts to recover the THREE.Scene from the canvas's WebGL renderer.
   * Falls back to creating a detached scene (the caller can add zoneGroup
   * to their own scene if needed).
   */
  private _findScene(canvas: HTMLCanvasElement): THREE.Scene {
    // The renderer stores a reference in the canvas's context attributes.
    // As a pragmatic fallback, we create a scene and let the consumer
    // add our group to their own scene via getZoneGroup().
    const scene = new THREE.Scene();
    scene.name = 'deployment-zone-scene';

    // Attempt to find the parent scene from the canvas's __THREE_SCENE property
    // which main.ts may set. If not available, use our own scene.
    const existingScene = (canvas as any).__THREE_SCENE as THREE.Scene | undefined;
    return existingScene ?? scene;
  }

  /**
   * Constructs the translucent green polygon and its border wireframe
   * to visualize the deployment zone on the terrain.
   */
  private _buildZoneOverlay(): void {
    if (!this.scene || this.zoneVertices.length < 3) return;

    this.zoneGroup = new THREE.Group();
    this.zoneGroup.name = 'deployment-zone';

    // --- Fill polygon ---
    const shape = new THREE.Shape();
    shape.moveTo(this.zoneVertices[0].x, this.zoneVertices[0].z);
    for (let i = 1; i < this.zoneVertices.length; i++) {
      shape.lineTo(this.zoneVertices[i].x, this.zoneVertices[i].z);
    }
    shape.closePath();

    const fillGeometry = new THREE.ShapeGeometry(shape);
    // ShapeGeometry places the shape on XY; rotate to lie on XZ plane
    fillGeometry.rotateX(-Math.PI / 2);

    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff41,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.position.y = 0.3; // slight offset above terrain
    fillMesh.name = 'zone-fill';
    this.zoneGroup.add(fillMesh);

    // --- Border wireframe ---
    const borderPoints: THREE.Vector3[] = [];
    for (const v of this.zoneVertices) {
      borderPoints.push(new THREE.Vector3(v.x, 0.5, v.z));
    }
    // Close the loop
    borderPoints.push(new THREE.Vector3(
      this.zoneVertices[0].x, 0.5, this.zoneVertices[0].z,
    ));

    const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const borderMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff41,
      transparent: true,
      opacity: 0.6,
      linewidth: 1,
    });

    const borderLine = new THREE.Line(borderGeometry, borderMaterial);
    borderLine.name = 'zone-border';
    this.zoneGroup.add(borderLine);

    // --- Corner markers (small vertical lines at each vertex) ---
    for (const v of this.zoneVertices) {
      const markerPoints = [
        new THREE.Vector3(v.x, 0.3, v.z),
        new THREE.Vector3(v.x, 3.0, v.z),
      ];
      const markerGeo = new THREE.BufferGeometry().setFromPoints(markerPoints);
      const markerMat = new THREE.LineBasicMaterial({
        color: 0x00ff41,
        transparent: true,
        opacity: 0.8,
      });
      const marker = new THREE.Line(markerGeo, markerMat);
      marker.name = 'zone-corner-marker';
      this.zoneGroup.add(marker);
    }

    // --- Animated pulse ring (pulsing circle at zone center) ---
    const center = this._computeZoneCenter();
    const pulsePoints: THREE.Vector3[] = [];
    const pulseSegments = 48;
    const avgRadius = this._computeAverageRadius(center);
    for (let i = 0; i <= pulseSegments; i++) {
      const angle = (i / pulseSegments) * Math.PI * 2;
      pulsePoints.push(new THREE.Vector3(
        center.x + Math.cos(angle) * avgRadius,
        0.4,
        center.z + Math.sin(angle) * avgRadius,
      ));
    }
    const pulseGeo = new THREE.BufferGeometry().setFromPoints(pulsePoints);
    const pulseMat = new THREE.LineBasicMaterial({
      color: 0x00ff41,
      transparent: true,
      opacity: 0.2,
    });
    const pulseLine = new THREE.Line(pulseGeo, pulseMat);
    pulseLine.name = 'zone-pulse';
    this.zoneGroup.add(pulseLine);

    this.scene.add(this.zoneGroup);
  }

  /**
   * Computes the centroid of the zone polygon.
   */
  private _computeZoneCenter(): Vec2 {
    let sumX = 0;
    let sumZ = 0;
    for (const v of this.zoneVertices) {
      sumX += v.x;
      sumZ += v.z;
    }
    const n = this.zoneVertices.length;
    return { x: sumX / n, z: sumZ / n };
  }

  /**
   * Computes the average distance from the center to each vertex,
   * used as a rough radius for the pulse ring.
   */
  private _computeAverageRadius(center: Vec2): number {
    let sum = 0;
    for (const v of this.zoneVertices) {
      const dx = v.x - center.x;
      const dz = v.z - center.z;
      sum += Math.sqrt(dx * dx + dz * dz);
    }
    return sum / this.zoneVertices.length;
  }

  // -------------------------------------------------------------------------
  // Private — DOM construction
  // -------------------------------------------------------------------------

  /**
   * Builds the entire HTML overlay for deployment: timer, sidebar, roster
   * lists, reserve counter, Ready button, and instructions.
   */
  private _buildDOM(): void {
    // Root container
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'deploy-root';

    // --- Timer ---
    this.timerEl = document.createElement('div');
    this.timerEl.className = 'deploy-timer';
    this.rootEl.appendChild(this.timerEl);

    // --- Sidebar ---
    this.sidebarEl = document.createElement('div');
    this.sidebarEl.className = 'deploy-sidebar';

    // Header
    const header = document.createElement('div');
    header.className = 'deploy-sidebar-header';
    header.textContent = 'DEPLOYMENT ROSTER';
    this.sidebarEl.appendChild(header);

    // "To Place" section label
    const toPlaceLabel = document.createElement('div');
    toPlaceLabel.className = 'deploy-section-label';
    toPlaceLabel.textContent = '// AVAILABLE';
    this.sidebarEl.appendChild(toPlaceLabel);

    // "To Place" list container
    this.toPlaceListEl = document.createElement('div');
    this.sidebarEl.appendChild(this.toPlaceListEl);

    // "Placed" section label
    const placedLabel = document.createElement('div');
    placedLabel.className = 'deploy-section-label';
    placedLabel.textContent = '// DEPLOYED';
    this.sidebarEl.appendChild(placedLabel);

    // "Placed" list container
    this.placedListEl = document.createElement('div');
    this.sidebarEl.appendChild(this.placedListEl);

    // Reserve info
    this.reserveInfoEl = document.createElement('div');
    this.reserveInfoEl.className = 'deploy-reserve-info';
    this._renderReserveInfo();
    this.sidebarEl.appendChild(this.reserveInfoEl);

    // Ready button
    this.readyBtnEl = document.createElement('button');
    this.readyBtnEl.className = 'deploy-ready-btn';
    this.readyBtnEl.textContent = 'READY';
    this.readyBtnEl.addEventListener('click', () => {
      if (this.readyCb) {
        this.readyCb();
      }
      if (this.readyBtnEl) {
        this.readyBtnEl.disabled = true;
        this.readyBtnEl.textContent = 'STANDING BY...';
      }
    });
    this.sidebarEl.appendChild(this.readyBtnEl);

    this.rootEl.appendChild(this.sidebarEl);

    // --- Instructions banner ---
    this.instructionsEl = document.createElement('div');
    this.instructionsEl.className = 'deploy-instructions';
    this.instructionsEl.textContent =
      'DRAG UNITS FROM ROSTER TO DEPLOY | CLICK READY WHEN FINISHED';
    this.rootEl.appendChild(this.instructionsEl);

    document.body.appendChild(this.rootEl);

    // Global pointer-up listener for drag operations
    this.boundPointerUp = (e: PointerEvent) => this._handlePointerUp(e);
    window.addEventListener('pointerup', this.boundPointerUp);
  }

  // -------------------------------------------------------------------------
  // Private — Roster rendering
  // -------------------------------------------------------------------------

  /**
   * Re-renders the "to place" and "placed" unit lists in the sidebar.
   */
  private _renderRoster(): void {
    if (!this.toPlaceListEl || !this.placedListEl) return;

    // Clear both lists
    this.toPlaceListEl.innerHTML = '';
    this.placedListEl.innerHTML = '';

    const toPlace = this.roster.filter((r) => !r.placed);
    const placed = this.roster.filter((r) => r.placed);

    for (const entry of toPlace) {
      const item = this._createRosterItem(entry, false);
      this.toPlaceListEl.appendChild(item);
    }

    if (toPlace.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'deploy-section-label';
      empty.textContent = '(none remaining)';
      this.toPlaceListEl.appendChild(empty);
    }

    for (const entry of placed) {
      const item = this._createRosterItem(entry, true);
      this.placedListEl.appendChild(item);
    }

    if (placed.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'deploy-section-label';
      empty.textContent = '(none deployed)';
      this.placedListEl.appendChild(empty);
    }

    this._renderReserveInfo();
  }

  /**
   * Creates a single roster item DOM element with drag support.
   */
  private _createRosterItem(entry: RosterEntry, isPlaced: boolean): HTMLDivElement {
    const item = document.createElement('div');
    item.className = isPlaced
      ? 'deploy-unit-item deploy-unit-item-placed'
      : 'deploy-unit-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = entry.displayName;
    item.appendChild(nameSpan);

    const classBadge = document.createElement('span');
    classBadge.className = 'deploy-unit-class-badge';
    classBadge.textContent = entry.unitClass.toUpperCase();
    item.appendChild(classBadge);

    if (!isPlaced) {
      // Pointer-down starts a drag
      item.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        this.dragUnitTypeId = entry.unitTypeId;
        // Immediately notify the callback so the consumer can start
        // showing a placement ghost on the map
        if (this.unitDragCb) {
          this.unitDragCb(entry.unitTypeId, e.clientX, e.clientY);
        }
      });

      // Pointer-move during drag continues to notify
      item.addEventListener('pointermove', (e: PointerEvent) => {
        if (this.dragUnitTypeId === entry.unitTypeId && this.unitDragCb) {
          this.unitDragCb(entry.unitTypeId, e.clientX, e.clientY);
        }
      });
    }

    return item;
  }

  /**
   * Handles the global pointer-up event, ending any in-progress drag.
   * The consumer's drag callback receives the final position; the consumer
   * decides whether the position is valid and sends DEPLOY_UNIT.
   */
  private _handlePointerUp(e: PointerEvent): void {
    if (this.dragUnitTypeId && this.unitDragCb) {
      this.unitDragCb(this.dragUnitTypeId, e.clientX, e.clientY);
    }
    this.dragUnitTypeId = null;
  }

  /**
   * Updates the reserve slots display.
   */
  private _renderReserveInfo(): void {
    if (!this.reserveInfoEl) return;
    const unplacedCount = this.roster.filter((r) => !r.placed).length;
    this.reserveInfoEl.textContent =
      `RESERVE SLOTS: ${this.reserveSlots} | UNPLACED: ${unplacedCount}`;
  }

  // -------------------------------------------------------------------------
  // Private — Timer rendering
  // -------------------------------------------------------------------------

  /**
   * Updates the timer DOM element text and applies visual urgency classes
   * based on remaining time.
   */
  private _renderTimer(): void {
    if (!this.timerEl) return;

    const minutes = Math.floor(this.currentTimerSec / 60);
    const seconds = this.currentTimerSec % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    this.timerEl.textContent = `DEPLOYMENT // ${timeStr}`;

    // Remove previous urgency classes
    this.timerEl.classList.remove('deploy-timer-warning', 'deploy-timer-critical');

    if (this.currentTimerSec <= 15) {
      this.timerEl.classList.add('deploy-timer-critical');
    } else if (this.currentTimerSec <= 45) {
      this.timerEl.classList.add('deploy-timer-warning');
    }
  }

  // -------------------------------------------------------------------------
  // Accessor — for external scene integration
  // -------------------------------------------------------------------------

  /**
   * Returns the Three.js group containing the zone overlay geometry,
   * so the consumer can add it to their own scene if the auto-detection
   * in init() did not find the correct scene.
   */
  getZoneGroup(): THREE.Group | null {
    return this.zoneGroup;
  }
}
