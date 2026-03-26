// ============================================================================
// UNIT MANAGER — manages all rendered units on the tactical map
// Milestone: 1 ("One Unit on a Map")
//
// Central registry for all visible unit sprites. Bridges server state
// (UnitSnapshot / UnitDelta) to Three.js scene objects via UnitRenderer.
// Handles selection state, click picking via raycasting, and unit lifecycle.
// ============================================================================

import * as THREE from 'three';
import type {
  FactionId,
  ContactTier,
  UnitClass,
  UnitSnapshot,
  UnitDelta,
  ContactSnapshot,
  ContactDelta,
} from '@legionaires/shared';
import { UnitRenderer, type IconDescriptor } from './unit-renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Client-side unit record combining server snapshot data with render objects. */
export interface ClientUnit {
  /** Unique instance ID from server. */
  unitId: string;
  /** Static type identifier (references UnitType.id). */
  unitTypeId: string;
  /** Owning player ID. */
  ownerId: string;
  /** Faction of the owning player. */
  faction: FactionId;
  /** Display name from unit type registry. */
  unitName?: string;
  /** Unit classification for icon rendering. */
  unitClass: UnitClass;
  /** Current world position X (metres). */
  posX: number;
  /** Current world position Z (metres). */
  posZ: number;
  /** Current heading in degrees (0=north, clockwise). */
  heading: number;
  /** Current crew / hit points. */
  crewCurrent: number;
  /** Maximum crew. */
  crewMax: number;
  /** Suppression level 0-100. */
  suppression: number;
  /** Whether unit has been destroyed. */
  isDestroyed: boolean;
  /** The Three.js group containing icon, health bar, and selection ring. */
  sceneGroup: THREE.Group;
  /** Whether this unit is currently selected by the local player. */
  isSelected: boolean;
}

/** Client-side enemy contact record. */
export interface ClientContact {
  contactId: string;
  tier: ContactTier;
  posX: number;
  posZ: number;
  unitClass: string | undefined;
  heading: number | undefined;
  lastSeenTick: number;
  sceneGroup: THREE.Group;
  isSelected: boolean;
}

// ---------------------------------------------------------------------------
// UnitManager
// ---------------------------------------------------------------------------

/**
 * Manages the full lifecycle of unit sprites on the tactical map:
 * adding, removing, updating from server state, selection, and picking.
 *
 * Usage:
 *   const manager = new UnitManager(scene, camera);
 *   // On full snapshot from server:
 *   manager.applyFullSnapshot(payload.units, 'federation');
 *   // On delta update:
 *   manager.applyUnitDeltas(deltas);
 *   // Each frame:
 *   manager.updateFrame();
 */
export class UnitManager {
  /** All friendly/owned units keyed by instanceId. */
  private units: Map<string, ClientUnit> = new Map();

  /** All enemy contacts keyed by contactId. */
  private contacts: Map<string, ClientContact> = new Map();

  /** Currently selected unit IDs (supports multi-select). */
  private selectedIds: Set<string> = new Set();

  /** The Three.js scene to add/remove groups from. */
  private scene: THREE.Scene;

  /** Camera for raycasting. */
  private camera: THREE.Camera;

  /** Raycaster instance reused for picking. */
  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  /** Renderer for creating/updating icon sprites. */
  private renderer: UnitRenderer;

  /** Local player's faction (set on mission join). */
  private localFaction: FactionId = 'federation';

  /** Local player's ID (set on auth). */
  private localPlayerId: string = '';

  /** Terrain height sampler for grounding icons to terrain. */
  private terrainHeightSampler: ((x: number, z: number) => number) | null = null;

  /** Base sprite width scale at close camera distance. */
  private static readonly ICON_SCALE_NEAR = 0.08;
  /** Base sprite width scale at far camera distance. */
  private static readonly ICON_SCALE_FAR = 0.046;
  /** Camera distances (world units) used for icon scaling interpolation. */
  private static readonly ICON_SCALE_DIST_NEAR = 70;
  private static readonly ICON_SCALE_DIST_FAR = 420;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = new UnitRenderer(scene);
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Sets the local player context. Called after AUTH_RESULT and mission join.
   */
  setLocalPlayer(playerId: string, faction: FactionId): void {
    this.localPlayerId = playerId;
    this.localFaction = faction;
  }

  /** Sets terrain sampler used to keep icons above terrain surface. */
  setTerrainHeightSampler(sampler: ((x: number, z: number) => number) | null): void {
    this.terrainHeightSampler = sampler;
  }

  // -------------------------------------------------------------------------
  // Full state application
  // -------------------------------------------------------------------------

  /**
   * Applies a full mission snapshot (MISSION_STATE_FULL).
   * Clears all existing units and rebuilds from the snapshot arrays.
   *
   * @param units - Array of unit snapshots from server.
   * @param contacts - Array of contact snapshots from server.
   */
  applyFullSnapshot(
    units: UnitSnapshot[],
    contacts: ContactSnapshot[],
  ): void {
    // Remove all existing units from scene
    this.clearAll();

    // Add friendly units
    for (const snap of units) {
      this.addUnit(snap);
    }

    // Add enemy contacts
    for (const contact of contacts) {
      this.addContact(contact);
    }
  }

  // -------------------------------------------------------------------------
  // Incremental updates
  // -------------------------------------------------------------------------

  /**
   * Applies an array of unit deltas from a TICK_UPDATE message.
   * Only updates fields that are present in the delta.
   */
  applyUnitDeltas(deltas: UnitDelta[]): void {
    for (const delta of deltas) {
      const unit = this.units.get(delta.unitId);
      if (!unit) continue;

      if (delta.posX !== undefined) unit.posX = delta.posX;
      if (delta.posZ !== undefined) unit.posZ = delta.posZ;
      if (delta.heading !== undefined) unit.heading = delta.heading;
      if (delta.hp !== undefined) unit.crewCurrent = delta.hp;
      if (delta.suppression !== undefined) unit.suppression = delta.suppression;
      if (delta.destroyed !== undefined) unit.isDestroyed = delta.destroyed;

      // Update scene position
      unit.sceneGroup.position.set(unit.posX, this._groundY(unit.posX, unit.posZ), unit.posZ);
    }
  }

  /**
   * Applies contact delta updates from a TICK_UPDATE message.
   */
  applyContactDeltas(deltas: ContactDelta[]): void {
    for (const delta of deltas) {
      switch (delta.action) {
        case 'add':
          this.addContact({
            contactId: delta.contactId,
            tier: delta.tier ?? 0,
            tierLabel: delta.tierLabel ?? 'SUSPECTED',
            posX: delta.posX ?? 0,
            posZ: delta.posZ ?? 0,
            unitClass: delta.unitClass,
            heading: delta.heading,
            lastSeenTick: delta.lastSeenTick ?? 0,
          });
          break;

        case 'update': {
          const contact = this.contacts.get(delta.contactId);
          if (!contact) break;
          if (delta.tierLabel !== undefined) contact.tier = delta.tierLabel;
          if (delta.posX !== undefined) contact.posX = delta.posX;
          if (delta.posZ !== undefined) contact.posZ = delta.posZ;
          if (delta.unitClass !== undefined) contact.unitClass = delta.unitClass;
          if (delta.heading !== undefined) contact.heading = delta.heading;
          if (delta.lastSeenTick !== undefined) contact.lastSeenTick = delta.lastSeenTick;
          contact.sceneGroup.position.set(
            contact.posX,
            this._groundY(contact.posX, contact.posZ),
            contact.posZ,
          );
          break;
        }

        case 'remove':
          this.removeContact(delta.contactId);
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Add / remove individual units
  // -------------------------------------------------------------------------

  /**
   * Adds a single friendly unit from a snapshot.
   */
  addUnit(snapshot: UnitSnapshot): void {
    if (this.units.has(snapshot.unitId)) return;

    const descriptor: IconDescriptor = {
      unitTypeId: snapshot.unitTypeId,
      unitName: snapshot.unitName,
      unitClass: (snapshot.unitClass as UnitClass) ?? this._inferUnitClass(snapshot.unitTypeId),
      faction: this.localFaction,
      detectionTier: 'CONFIRMED', // own units are always fully known
      crewCurrent: snapshot.crewCurrent,
      crewMax: snapshot.crewMax,
      isSelected: false,
      heading: snapshot.heading,
    };

    const group = this.renderer.createIcon(descriptor);
    group.position.set(
      snapshot.posX,
      this._groundY(snapshot.posX, snapshot.posZ),
      snapshot.posZ,
    );
    group.name = `unit-${snapshot.unitId}`;
    this.scene.add(group);

    const clientUnit: ClientUnit = {
      unitId: snapshot.unitId,
      unitTypeId: snapshot.unitTypeId,
      ownerId: snapshot.ownerId,
      faction: this.localFaction,
      unitName: snapshot.unitName,
      unitClass: descriptor.unitClass,
      posX: snapshot.posX,
      posZ: snapshot.posZ,
      heading: snapshot.heading,
      crewCurrent: snapshot.crewCurrent,
      crewMax: snapshot.crewMax,
      suppression: snapshot.suppression,
      isDestroyed: snapshot.isDestroyed,
      sceneGroup: group,
      isSelected: false,
    };

    this.units.set(snapshot.unitId, clientUnit);
  }

  /**
   * Adds an enemy contact from a contact snapshot.
   */
  addContact(snapshot: ContactSnapshot): void {
    if (this.contacts.has(snapshot.contactId)) return;

    // Infer enemy faction from contact data: at CONFIRMED tier the unitClass
    // field carries the unitTypeId which encodes faction. At lower tiers we
    // mark as 'unknown' which renders the NATO Unknown affiliation frame.
    let enemyFaction: FactionId | 'unknown' = 'unknown';
    if (snapshot.tierLabel === 'CONFIRMED' && snapshot.unitClass) {
      const cls = snapshot.unitClass.toLowerCase();
      if (cls.includes('ataxian') || cls.startsWith('ax_')) {
        enemyFaction = 'ataxian';
      } else if (cls.includes('khroshi') || cls.startsWith('ks_')) {
        enemyFaction = 'khroshi';
      }
    }

    const descriptor: IconDescriptor = {
      unitTypeId: snapshot.contactId, // contacts may not have a type yet
      unitClass: (snapshot.unitClass as UnitClass) ?? 'infantry',
      faction: enemyFaction,
      detectionTier: snapshot.tierLabel,
      crewCurrent: 1,
      crewMax: 1,
      isSelected: false,
      heading: snapshot.heading ?? 0,
    };

    const group = this.renderer.createIcon(descriptor);

    // Apply position jitter for SUSPECTED contacts (+/- 50m)
    let displayX = snapshot.posX;
    let displayZ = snapshot.posZ;
    if (snapshot.tierLabel === 'SUSPECTED') {
      displayX += (Math.random() - 0.5) * 100;
      displayZ += (Math.random() - 0.5) * 100;
    }

    group.position.set(displayX, this._groundY(displayX, displayZ), displayZ);
    group.name = `contact-${snapshot.contactId}`;
    this.scene.add(group);

    this.contacts.set(snapshot.contactId, {
      contactId: snapshot.contactId,
      tier: snapshot.tierLabel,
      posX: displayX,
      posZ: displayZ,
      unitClass: snapshot.unitClass,
      heading: snapshot.heading,
      lastSeenTick: snapshot.lastSeenTick,
      sceneGroup: group,
      isSelected: false,
    });
  }

  /**
   * Removes a unit from the scene and registry.
   */
  removeUnit(unitId: string): void {
    const unit = this.units.get(unitId);
    if (!unit) return;

    this.scene.remove(unit.sceneGroup);
    this.units.delete(unitId);
    this.selectedIds.delete(unitId);
  }

  /**
   * Removes a contact from the scene and registry.
   */
  removeContact(contactId: string): void {
    const contact = this.contacts.get(contactId);
    if (!contact) return;

    this.scene.remove(contact.sceneGroup);
    this.contacts.delete(contactId);
  }

  /**
   * Removes all units and contacts from the scene.
   */
  clearAll(): void {
    for (const unit of this.units.values()) {
      this.scene.remove(unit.sceneGroup);
    }
    this.units.clear();

    for (const contact of this.contacts.values()) {
      this.scene.remove(contact.sceneGroup);
    }
    this.contacts.clear();

    this.selectedIds.clear();
  }

  /** Sets unit group visibility by unit id. */
  setUnitVisible(unitId: string, visible: boolean): void {
    const unit = this.units.get(unitId);
    if (!unit) return;
    unit.sceneGroup.visible = visible;
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /**
   * Selects a single unit. If addToSelection is false (default), deselects all others first.
   */
  selectUnit(unitId: string, addToSelection: boolean = false): void {
    if (!addToSelection) this.deselectAll();
    const unit = this.units.get(unitId);
    if (unit) {
      unit.isSelected = true;
      this.selectedIds.add(unitId);
    }
  }

  /**
   * Returns all friendly ClientUnit records.
   */
  getAllUnits(): ClientUnit[] {
    return Array.from(this.units.values());
  }

  /**
   * Adds a unit to the current selection (multi-select).
   */
  addToSelection(unitId: string): void {
    const unit = this.units.get(unitId);
    if (unit) {
      unit.isSelected = true;
      this.selectedIds.add(unitId);
    }
  }

  /**
   * Selects all units whose IDs are in the provided set.
   * Used by box-select (drag selection rectangle).
   */
  selectMultiple(unitIds: string[]): void {
    this.deselectAll();
    for (const id of unitIds) {
      this.addToSelection(id);
    }
  }

  /**
   * Clears all selections.
   */
  deselectAll(): void {
    for (const id of this.selectedIds) {
      const unit = this.units.get(id);
      if (unit) unit.isSelected = false;
    }
    this.selectedIds.clear();
  }

  /**
   * Returns the IDs of all currently selected units.
   */
  getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  /**
   * Returns the ClientUnit records for all selected units.
   */
  getSelectedUnits(): ClientUnit[] {
    const result: ClientUnit[] = [];
    for (const id of this.selectedIds) {
      const unit = this.units.get(id);
      if (unit) result.push(unit);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Picking (click detection)
  // -------------------------------------------------------------------------

  /**
   * Returns the unit or contact ID at the given screen coordinates,
   * or null if nothing was hit.
   *
   * Uses Three.js raycaster against all unit/contact sprites.
   *
   * @param screenX - Mouse X in pixels (0 = left edge).
   * @param screenY - Mouse Y in pixels (0 = top edge).
   * @returns Object with the hit entity's ID and whether it's a contact (enemy).
   */
  getUnitAtScreenPos(
    screenX: number,
    screenY: number,
  ): { unitId: string; isContact: boolean } | null {
    // Convert screen coordinates to normalized device coordinates (-1 to +1)
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    // Collect all sprite objects from units and contacts
    const sprites: THREE.Object3D[] = [];
    for (const unit of this.units.values()) {
      const iconSprite = unit.sceneGroup.getObjectByName('icon-sprite');
      if (iconSprite) {
        iconSprite.userData.pickId = unit.unitId;
        iconSprite.userData.pickIsContact = false;
        sprites.push(iconSprite);
      }
    }
    for (const contact of this.contacts.values()) {
      const iconSprite = contact.sceneGroup.getObjectByName('icon-sprite');
      if (iconSprite) {
        iconSprite.userData.pickId = contact.contactId;
        iconSprite.userData.pickIsContact = true;
        sprites.push(iconSprite);
      }
    }

    const intersects = this.raycaster.intersectObjects(sprites, false);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      return {
        unitId: hit.userData.pickId as string,
        isContact: hit.userData.pickIsContact as boolean,
      };
    }

    return null;
  }

  /**
   * Returns all own-unit IDs whose screen positions fall within a rectangle.
   * Used for drag-box multi-selection.
   *
   * @param x1 - Left edge of selection box (pixels).
   * @param y1 - Top edge of selection box (pixels).
   * @param x2 - Right edge of selection box (pixels).
   * @param y2 - Bottom edge of selection box (pixels).
   */
  getUnitsInScreenRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): string[] {
    const result: string[] = [];

    // Normalize rect (user may drag in any direction)
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    const tempVec = new THREE.Vector3();

    for (const unit of this.units.values()) {
      // Only select own units
      if (unit.ownerId !== this.localPlayerId) continue;

      // Project world position to screen
      tempVec.set(unit.posX, this._groundY(unit.posX, unit.posZ), unit.posZ);
      tempVec.project(this.camera);

      const screenX = (tempVec.x * 0.5 + 0.5) * window.innerWidth;
      const screenY = (-tempVec.y * 0.5 + 0.5) * window.innerHeight;

      if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
        result.push(unit.unitId);
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  /**
   * Called each animation frame. Resets the renderer's per-frame budget
   * and updates all icon visuals.
   */
  updateFrame(): void {
    this.renderer.resetFrameBudget();

    // Update icon visuals for each unit
    for (const unit of this.units.values()) {
      unit.sceneGroup.position.set(unit.posX, this._groundY(unit.posX, unit.posZ), unit.posZ);
      this.renderer.updateIcon(unit.sceneGroup, {
        unitTypeId: unit.unitTypeId,
        unitName: unit.unitName,
        unitClass: unit.unitClass,
        faction: unit.faction,
        detectionTier: 'CONFIRMED',
        crewCurrent: unit.crewCurrent,
        crewMax: unit.crewMax,
        isSelected: unit.isSelected,
        heading: unit.heading,
      });

      this._updateIconScale(unit.sceneGroup, unit.posX, unit.posZ, unit.isSelected);
    }

    // Update contact visuals
    for (const contact of this.contacts.values()) {
      contact.sceneGroup.position.set(contact.posX, this._groundY(contact.posX, contact.posZ), contact.posZ);
      this.renderer.updateIcon(contact.sceneGroup, {
        unitTypeId: contact.contactId,
        unitClass: (contact.unitClass as UnitClass) ?? 'infantry',
        faction: 'unknown',
        detectionTier: contact.tier,
        crewCurrent: 1,
        crewMax: 1,
        isSelected: contact.isSelected,
        heading: contact.heading ?? 0,
      });

      this._updateIconScale(contact.sceneGroup, contact.posX, contact.posZ, false);
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Returns a unit by ID, or undefined if not found.
   */
  getUnit(unitId: string): ClientUnit | undefined {
    return this.units.get(unitId);
  }

  /**
   * Returns a contact by ID, or undefined if not found.
   */
  getContact(contactId: string): ClientContact | undefined {
    return this.contacts.get(contactId);
  }

  /**
   * Returns total number of rendered units (friendly).
   */
  getUnitCount(): number {
    return this.units.size;
  }

  /**
   * Returns total number of rendered contacts (enemy).
   */
  getContactCount(): number {
    return this.contacts.size;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Disposes all resources. Call when leaving the tactical view.
   */
  dispose(): void {
    this.clearAll();
    this.renderer.dispose();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Infers a UnitClass from the unit type ID.
   *
   * Uses keyword matching on the unitTypeId string until the full CSV-backed
   * UnitType registry is loaded in M2.
   */
  private _inferUnitClass(unitTypeId: string): UnitClass {
    const id = unitTypeId.toUpperCase();

    // Armour / vehicles
    if (id.includes('ABRAMS') || id.includes('MBT') || id.includes('LEOPARD') || id.includes('T-') && id.match(/T-\d/)) return 'mbt';
    if (id.includes('BRADLEY') || id.includes('IFV') || id.includes('BMP')) return 'ifv';
    if (id.includes('APC') || id.includes('STRYKER') || id.includes('BTR')) return 'apc';
    if (id.includes('SCOUT') || id.includes('RECON')) return 'scout';
    if (id.includes('JAVELIN') || id.includes('TOW') || id.includes('AT_VEH')) return 'at_vehicle';
    if (id.includes('AA_VEH') || id.includes('AVENGER') || id.includes('GEPARD')) return 'aa_vehicle';
    if (id.includes('PALADIN') || id.includes('SPG') || id.includes('ARTY_SP')) return 'arty_sp';
    if (id.includes('HOWITZER') || id.includes('ARTY_TOW')) return 'arty_towed';
    if (id.includes('MORTAR')) return 'mortar';
    if (id.includes('SUPPLY') || id.includes('LOGISTICS')) return 'supply';
    if (id.includes('HQ') || id.includes('COMMAND')) return 'hq';

    // Infantry
    if (id.includes('SNIPER')) return 'sniper';
    if (id.includes('ENGINEER') || id.includes('SAPPER')) return 'engineer';
    if (id.includes('AT_INF') || id.includes('ANTI_TANK') || id.includes('ANTI-TANK')) return 'at_infantry';
    if (id.includes('AA_INF') || id.includes('MANPAD') || id.includes('STINGER')) return 'aa_infantry';
    if (id.includes('INFANTRY') || id.includes('RIFLE') || id.includes('SQUAD')) return 'infantry';

    // Air
    if (id.includes('APACHE') || id.includes('ATTACK_HELO') || id.includes('HELO_ATK')) return 'helicopter_attack';
    if (id.includes('BLACKHAWK') || id.includes('TRANSPORT_HELO') || id.includes('HELO_TRN')) return 'helicopter_transport';
    if (id.includes('FIXED_WING') || id.includes('F-') || id.includes('A-10')) return 'fixed_wing';

    // Support catch-all
    if (id.includes('SUPPORT')) return 'support';

    return 'infantry';
  }

  private _updateIconScale(group: THREE.Group, x: number, z: number, isSelected: boolean): void {
    const icon = group.getObjectByName('icon-sprite') as THREE.Sprite | undefined;
    if (!icon) return;

    const dx = this.camera.position.x - x;
    const dy = this.camera.position.y;
    const dz = this.camera.position.z - z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const t = THREE.MathUtils.clamp(
      (dist - UnitManager.ICON_SCALE_DIST_NEAR)
      / (UnitManager.ICON_SCALE_DIST_FAR - UnitManager.ICON_SCALE_DIST_NEAR),
      0,
      1,
    );
    const width = THREE.MathUtils.lerp(UnitManager.ICON_SCALE_NEAR, UnitManager.ICON_SCALE_FAR, t);
    const selectedBoost = isSelected ? 1.08 : 1.0;
    const scaledWidth = width * selectedBoost;

    icon.scale.set(scaledWidth, scaledWidth * (80 / 64), 1);

    const glow = group.getObjectByName('selection-glow') as THREE.Sprite | undefined;
    if (glow) {
      const glowScale = scaledWidth * 1.45;
      glow.scale.set(glowScale, glowScale, 1);
    }
  }

  private _groundY(x: number, z: number): number {
    if (!this.terrainHeightSampler) return 0;
    return this.terrainHeightSampler(x, z);
  }
}
