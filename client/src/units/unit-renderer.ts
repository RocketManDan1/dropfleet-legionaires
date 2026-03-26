// ============================================================================
// UNIT RENDERER — NATO icon sprite rendering on the tactical map
// Milestone: 1 ("One Unit on a Map")
//
// Renders NATO military symbols using the milsymbol library, converting
// canvas-drawn icons into Three.js sprites that float above the terrain.
// Supports faction frame shapes, detection tier display, health bars,
// and selection highlights with a bounded icon cache.
// ============================================================================

import * as THREE from 'three';
import ms from 'milsymbol';
import type { ColorMode } from 'milsymbol';
import type {
  FactionId,
  ContactTier,
  UnitClass,
} from '@legionaires/shared';
import {
  FACTION_COLORS,
} from '@legionaires/shared';

/** All data the renderer needs to create or update a single icon. */
export interface IconDescriptor {
  unitTypeId: string;
  unitName?: string;
  unitClass: UnitClass;
  faction: FactionId | 'unknown';
  detectionTier: ContactTier;
  crewCurrent: number;
  crewMax: number;
  isSelected: boolean;
  heading: number;
}

/** Cached rendering result for a given icon configuration. */
interface CachedIcon {
  key: string;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  lastUsedFrame: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of canvas renders allowed per animation frame. */
const MAX_RENDERS_PER_FRAME = 5;

/** Maximum icon cache memory budget in bytes (~1.5 MB). */
const MAX_CACHE_BYTES = 1_500_000;

/** Icon canvas dimensions. Taller than wide to fit frame + labels below. */
const ICON_W = 64;
const ICON_H = 80;

/** Selection ring radius in world units. */
const SELECTION_RING_RADIUS = 3.0;
const SELECTION_RING_SEGMENTS = 32;
const SELECTION_RING_COLOR = new THREE.Color(0x00ff88);
const ICON_GLOW_COLOR = new THREE.Color(0x6fffc8);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// milsymbol integration — SIDC codes and color mode
// ---------------------------------------------------------------------------

/**
 * DRONECOM frame colour mode: maps NATO affiliations to our faction palette.
 * Both hostile factions share the red hostile slot; milsymbol picks the right
 * entry automatically based on the identity character in the SIDC.
 */
const DRONECOM_FRAME_COLOR: ColorMode = {
  Friend:   FACTION_COLORS.federation.frame, // #4080FF
  Hostile:  FACTION_COLORS.ataxian.frame,    // #E04020
  Neutral:  '#30C030',
  Unknown:  FACTION_COLORS.unknown.frame,    // #D09020
  Civilian: '#A060C0',
  Suspect:  FACTION_COLORS.unknown.frame,
};

/**
 * [battle-dimension, 11-char function+modifier string] per unit class.
 * Positions 5-15 of the 15-char MIL-STD-2525C SIDC.
 * Source: APP-6D / MIL-STD-2525C function codes.
 */
const UNIT_SIDC_PARTS: Record<UnitClass, [string, string]> = {
  mbt:                  ['G', 'UCA--------'],  // Armor / Tank
  ifv:                  ['G', 'UCIZ-------'],  // Mechanized Infantry (IFV)
  apc:                  ['G', 'UCAA-------'],  // Armored Personnel Carrier
  infantry:             ['G', 'UCI--------'],  // Infantry
  at_infantry:          ['G', 'UCI--------'],  // Infantry (AT role)
  aa_infantry:          ['G', 'UCI--------'],  // Infantry (AA role)
  engineer:             ['G', 'UCE--------'],  // Combat Engineer
  sniper:               ['G', 'UCI--------'],  // Infantry (sniper)
  scout:                ['G', 'UCRR-------'],  // Reconnaissance
  hq:                   ['G', 'UCI--------'],  // Command (infantry frame)
  arty_sp:              ['G', 'UCFS-------'],  // Field Artillery, SP
  arty_towed:           ['G', 'UCFT-------'],  // Field Artillery, Towed
  mortar:               ['G', 'UCFM-------'],  // Mortar
  at_vehicle:           ['G', 'UCAT-------'],  // Anti-Tank Vehicle
  aa_vehicle:           ['G', 'UCAAA------'],  // Air Defense Vehicle
  support:              ['G', 'USS--------'],  // Combat Service Support
  supply:               ['G', 'USM--------'],  // Supply / Maintenance
  helicopter_attack:    ['A', 'MHA--------'],  // Attack Helicopter
  helicopter_transport: ['A', 'MHU--------'],  // Utility / Transport Helicopter
  fixed_wing:           ['A', 'MFF--------'],  // Fixed-Wing Aircraft
};

/**
 * Builds a 15-character MIL-STD-2525C SIDC for a given unit class and faction.
 * DETECTED tier shows the affiliation frame but no specific unit type.
 */
function buildSIDC(
  unitClass: UnitClass,
  faction: FactionId | 'unknown',
  detectionTier: ContactTier,
): string {
  const id =
    faction === 'federation' ? 'F' :
    faction === 'unknown'    ? 'U' : 'H';

  const [dim, funcMod] = UNIT_SIDC_PARTS[unitClass] ?? ['G', 'UCI--------'];

  // DETECTED: show affiliation frame only — no inner function glyph
  if (detectionTier === 'DETECTED') {
    return `S${id}${dim}P-----------`;
  }
  return `S${id}${dim}P${funcMod}`;
}

/**
 * Crew health bucket — coarse-grained so we don't re-render the canvas on
 * every crew loss, only when crossing a visible colour threshold.
 */
function crewBucket(crewCurrent: number, crewMax: number): 'full' | 'half' | 'low' {
  const f = crewMax > 0 ? crewCurrent / crewMax : 0;
  if (f > 0.66) return 'full';
  if (f > 0.33) return 'half';
  return 'low';
}

/**
 * Builds a unique cache key from the visual parameters that affect rendering.
 * Crew bucket is included so the health bar re-renders on colour threshold crossings.
 */
function buildCacheKey(
  unitTypeId: string,
  faction: FactionId | 'unknown',
  detectionTier: ContactTier,
  crewCurrent: number,
  crewMax: number,
): string {
  return `${unitTypeId}:${faction}:${detectionTier}:${crewBucket(crewCurrent, crewMax)}`;
}

/**
 * Estimates the memory footprint of a canvas icon (RGBA, 4 bytes/pixel).
 */
function canvasBytes(canvas: HTMLCanvasElement): number {
  return canvas.width * canvas.height * 4;
}

// ---------------------------------------------------------------------------
// UnitRenderer
// ---------------------------------------------------------------------------

/**
 * Renders NATO icon sprites for units on the tactical map.
 *
 * Design notes:
 * - Each icon is drawn to an offscreen canvas via milsymbol, then uploaded
 *   as a THREE.CanvasTexture on a THREE.Sprite with sizeAttenuation: false
 *   so icons stay a constant screen size regardless of zoom.
 * - Detection tiers control how much information is revealed:
 *   SUSPECTED = faction blip with "?" symbol, position jittered +/-50m
 *   DETECTED  = faction frame + unit category silhouette
 *   CONFIRMED = faction frame + full type glyph with designation
 * - The icon cache is LRU-evicted when memory exceeds 1.5 MB.
 * - Canvas renders are throttled to <= 5 per frame to avoid jank.
 */
export class UnitRenderer {
  /** The Three.js scene to add sprites into. */
  private scene: THREE.Scene;

  /** LRU icon cache: cacheKey -> CachedIcon. */
  private cache: Map<string, CachedIcon> = new Map();

  /** Total estimated bytes in cache. */
  private cacheSizeBytes = 0;

  /** Number of canvas renders performed this frame. */
  private rendersThisFrame = 0;

  /** Current frame number, incremented by resetFrameBudget(). */
  private currentFrame = 0;

  /** Shared geometry for selection highlight rings. */
  private selectionRingGeometry: THREE.BufferGeometry;

  /** Shared material for selection highlight rings. */
  private selectionRingMaterial: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pre-build the selection ring geometry (a flat circle on the XZ plane)
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= SELECTION_RING_SEGMENTS; i++) {
      const angle = (i / SELECTION_RING_SEGMENTS) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * SELECTION_RING_RADIUS,
        0.1, // slight Y offset so it sits just above terrain
        Math.sin(angle) * SELECTION_RING_RADIUS,
      ));
    }
    this.selectionRingGeometry = new THREE.BufferGeometry().setFromPoints(points);
    this.selectionRingMaterial = new THREE.LineBasicMaterial({
      color: SELECTION_RING_COLOR,
      transparent: true,
      opacity: 0.8,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Call at the start of each animation frame to reset the per-frame
   * canvas render budget.
   */
  resetFrameBudget(): void {
    this.rendersThisFrame = 0;
    this.currentFrame++;
  }

  /**
   * Creates a new NATO icon sprite for the given unit type and faction.
   * Returns a THREE.Group containing:
   *   - The icon sprite (billboard, constant screen size)
   *   - A health bar sprite (drawn separately, updated independently)
   *   - A selection ring (Line, initially invisible)
   *
   * @param descriptor - All visual parameters needed to render the icon.
   * @returns A THREE.Group positioned at world origin; caller sets position.
   */
  createIcon(descriptor: IconDescriptor): THREE.Group {
    const group = new THREE.Group();
    group.name = `unit-icon`;

    // --- Selection glow (icon halo) ---
    const glowSprite = this._createSelectionGlowSprite();
    glowSprite.name = 'selection-glow';
    glowSprite.visible = descriptor.isSelected;
    group.add(glowSprite);

    // --- Icon sprite (health bar baked into canvas) ---
    const iconSprite = this._createIconSprite(descriptor);
    iconSprite.name = 'icon-sprite';
    group.add(iconSprite);

    // --- Selection ring ---
    const ring = new THREE.LineLoop(
      this.selectionRingGeometry,
      this.selectionRingMaterial,
    );
    ring.name = 'selection-ring';
    ring.visible = descriptor.isSelected;
    group.add(ring);

    return group;
  }

  /**
   * Updates an existing icon group to reflect changed unit state.
   * Only re-renders the canvas if the cache key changed (e.g. detection
   * tier promotion). Health bar is always cheaply redrawn.
   *
   * @param group - The THREE.Group returned by createIcon().
   * @param descriptor - Current visual parameters.
   */
  updateIcon(group: THREE.Group, descriptor: IconDescriptor): void {
    // Update icon sprite if visual identity changed
    const iconSprite = group.getObjectByName('icon-sprite') as THREE.Sprite | undefined;
    if (iconSprite) {
      const cacheKey = buildCacheKey(
        descriptor.unitTypeId,
        descriptor.faction,
        descriptor.detectionTier,
        descriptor.crewCurrent,
        descriptor.crewMax,
      );
      const currentKey = (iconSprite.userData as { cacheKey?: string }).cacheKey;
      if (currentKey !== cacheKey) {
        // Need to re-render icon canvas (tier change or crew bucket change)
        const texture = this._getOrRenderIcon(descriptor);
        if (texture) {
          (iconSprite.material as THREE.SpriteMaterial).map = texture;
          (iconSprite.material as THREE.SpriteMaterial).needsUpdate = true;
          (iconSprite.userData as { cacheKey?: string }).cacheKey = cacheKey;
        }
        // If render budget exhausted, skip this frame — will catch up next frame
      }
    }

    // Toggle selection ring visibility
    const ring = group.getObjectByName('selection-ring');
    if (ring) {
      ring.visible = descriptor.isSelected;
    }

    const glow = group.getObjectByName('selection-glow') as THREE.Sprite | undefined;
    if (glow) {
      glow.visible = descriptor.isSelected;
    }
  }

  /**
   * Disposes all GPU resources and clears the icon cache.
   * Call when leaving the tactical view or cleaning up the scene.
   */
  dispose(): void {
    // Dispose all cached textures
    for (const entry of this.cache.values()) {
      entry.texture.dispose();
    }
    this.cache.clear();
    this.cacheSizeBytes = 0;

    // Dispose shared selection ring resources
    this.selectionRingGeometry.dispose();
    this.selectionRingMaterial.dispose();

    if (this._placeholderTexture) {
      this._placeholderTexture.dispose();
      this._placeholderTexture = null;
    }
    if (this._selectionGlowTexture) {
      this._selectionGlowTexture.dispose();
      this._selectionGlowTexture = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private — Icon rendering
  // -------------------------------------------------------------------------

  /**
   * Creates the main icon sprite from a canvas texture.
   */
  private _createIconSprite(descriptor: IconDescriptor): THREE.Sprite {
    const texture = this._getOrRenderIcon(descriptor);

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: false, // constant screen size regardless of zoom
    });

    const sprite = new THREE.Sprite(material);
    // Scale maintains canvas aspect ratio (64×80) so labels don't squish.
    sprite.scale.set(0.08, 0.08 * (ICON_H / ICON_W), 1);
    sprite.position.set(0, 1.5, 0); // float just above terrain surface
    sprite.userData = {
      cacheKey: buildCacheKey(
        descriptor.unitTypeId,
        descriptor.faction,
        descriptor.detectionTier,
        descriptor.crewCurrent,
        descriptor.crewMax,
      ),
    };

    return sprite;
  }

  /**
   * Retrieves a cached icon texture or renders a new one.
   * Respects the per-frame render budget.
   */
  private _getOrRenderIcon(descriptor: IconDescriptor): THREE.CanvasTexture {
    const key = buildCacheKey(
      descriptor.unitTypeId,
      descriptor.faction,
      descriptor.detectionTier,
      descriptor.crewCurrent,
      descriptor.crewMax,
    );

    // Cache hit?
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsedFrame = this.currentFrame;
      return cached.texture;
    }

    // Budget check — if we've already rendered too many this frame,
    // return a placeholder (transparent) texture. It will be filled next frame.
    if (this.rendersThisFrame >= MAX_RENDERS_PER_FRAME) {
      return this._getPlaceholderTexture();
    }

    // Render new icon
    const canvas = this._renderIconCanvas(descriptor);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    this.rendersThisFrame++;

    // Store in cache
    const entry: CachedIcon = {
      key,
      canvas,
      texture,
      lastUsedFrame: this.currentFrame,
    };
    this.cache.set(key, entry);
    this.cacheSizeBytes += canvasBytes(canvas);

    // Evict oldest entries if over budget
    this._evictIfNeeded();

    return texture;
  }

  /**
   * Renders a DRONECOM-style NATO icon to an offscreen canvas.
   *
   * Layout (64×80 canvas):
   *   - Frame shape occupies the top 40px (rows 4–44), proportioned wider
   *     than tall per NATO ground-unit convention.
   *   - NATO inner symbol (geometric glyph, no text) drawn centred inside
   *     the frame at DETECTED / CONFIRMED tier.
   *   - Unit class abbreviation + type ID drawn as labels in rows 46–72,
   *     BELOW the frame — never inside it.
   *   - SUSPECTED tier: faction-coloured blip with "?" only, no frame.
   *   - LOST tier: dashed frame at 40% opacity, no inner symbol.
   */
  private _renderIconCanvas(descriptor: IconDescriptor): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_W;
    canvas.height = ICON_H;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, ICON_W, ICON_H);

    const colors = FACTION_COLORS[descriptor.faction === 'unknown' ? 'unknown' : descriptor.faction];
    const cx = ICON_W / 2;

    // Symbol area: top 40px of the 64×80 canvas
    const symAreaH = 40;

    // ---- SUSPECTED: faction-coloured blip with '?' ----
    if (descriptor.detectionTier === 'SUSPECTED') {
      const bx = cx, by = symAreaH / 2;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.strokeStyle = colors.frame;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', bx, by);
      return canvas;
    }

    // ---- LOST: dashed rectangle, faded ----
    if (descriptor.detectionTier === 'LOST') {
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.rect(3, 2, ICON_W - 6, symAreaH - 4);
      ctx.strokeStyle = colors.frame;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
      return canvas;
    }

    // ---- DETECTED / CONFIRMED: milsymbol renders the authoritative NATO icon ----
    const sidc = buildSIDC(descriptor.unitClass, descriptor.faction, descriptor.detectionTier);
    try {
      const sym = new ms.Symbol(sidc, {
        size: 35,
        fillColor: '#080C14',
        frameColor: DRONECOM_FRAME_COLOR,
        iconColor: '#FFFFFF',
        infoFields: false,   // suppress milsymbol's own label fields
      });
      const symCanvas = sym.asCanvas();
      const scale = Math.min((ICON_W - 4) / symCanvas.width, symAreaH / symCanvas.height);
      const sw = symCanvas.width * scale;
      const sh = symCanvas.height * scale;
      ctx.drawImage(symCanvas, (ICON_W - sw) / 2, (symAreaH - sh) / 2, sw, sh);
    } catch {
      // Fallback: plain dark rect with faction frame if milsymbol errors
      ctx.fillStyle = '#080C14';
      ctx.fillRect(3, 2, ICON_W - 6, symAreaH - 4);
      ctx.strokeStyle = colors.frame;
      ctx.lineWidth = 2;
      ctx.strokeRect(3, 2, ICON_W - 6, symAreaH - 4);
    }

    // ---- Health bar: 3px strip below symbol ----
    const barX = 3, barY = symAreaH + 1, barW = ICON_W - 6, barH = 3;
    const fraction = descriptor.crewMax > 0
      ? Math.max(0, descriptor.crewCurrent / descriptor.crewMax) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = fraction > 0.66 ? '#22cc44' : fraction > 0.33 ? '#cccc22' : '#cc2222';
    ctx.fillRect(barX, barY, Math.round(fraction * barW), barH);
    ctx.strokeStyle = 'rgba(200,216,216,0.4)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barW, barH);

    // ---- Labels below health bar (CONFIRMED only) ----
    if (descriptor.detectionTier === 'CONFIRMED') {
      const labelY = barY + barH + 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#C8D8E8';
      ctx.fillText(this._unitClassAbbreviation(descriptor.unitClass), cx, labelY);
      ctx.font = '8px monospace';
      ctx.fillStyle = colors.frame;
      const displayName = descriptor.unitName ?? descriptor.unitTypeId.replace(/_/g, ' ');
      ctx.fillText(displayName.substring(0, 10), cx, labelY + 12);
    }

    return canvas;
  }

  /**
   * Maps UnitClass to a short abbreviation for DETECTED-tier display.
   */
  private _unitClassAbbreviation(unitClass: UnitClass): string {
    // Full NATO APP-6 SIDC integration deferred to M6 (milsymbol library).
    // Current abbreviations cover all UnitClass values for DETECTED-tier display.
    const abbreviations: Record<UnitClass, string> = {
      mbt: 'MBT',
      ifv: 'IFV',
      apc: 'APC',
      scout: 'SCT',
      at_vehicle: 'AT',
      aa_vehicle: 'AA',
      arty_sp: 'SPG',
      arty_towed: 'ART',
      mortar: 'MOR',
      support: 'SUP',
      supply: 'LOG',
      infantry: 'INF',
      at_infantry: 'ATI',
      aa_infantry: 'AAI',
      engineer: 'ENG',
      sniper: 'SNP',
      hq: 'HQ',
      helicopter_attack: 'AH',
      helicopter_transport: 'TH',
      fixed_wing: 'FW',
    };
    return abbreviations[unitClass] ?? '???';
  }

  // -------------------------------------------------------------------------
  // Private — Placeholder & cache eviction
  // -------------------------------------------------------------------------

  /** Shared 1x1 transparent texture for budget-exceeded frames. */
  private _placeholderTexture: THREE.CanvasTexture | null = null;
  private _selectionGlowTexture: THREE.CanvasTexture | null = null;

  private _createSelectionGlowSprite(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: this._getSelectionGlowTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: false,
      blending: THREE.AdditiveBlending,
      color: ICON_GLOW_COLOR,
      opacity: 0.42,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.12, 0.12, 1);
    sprite.position.set(0, 1.5, -0.01);
    return sprite;
  }

  private _getSelectionGlowTexture(): THREE.CanvasTexture {
    if (this._selectionGlowTexture) {
      return this._selectionGlowTexture;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.35, 'rgba(180,255,230,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    this._selectionGlowTexture = new THREE.CanvasTexture(canvas);
    this._selectionGlowTexture.minFilter = THREE.LinearFilter;
    this._selectionGlowTexture.magFilter = THREE.LinearFilter;
    return this._selectionGlowTexture;
  }

  private _getPlaceholderTexture(): THREE.CanvasTexture {
    if (!this._placeholderTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      this._placeholderTexture = new THREE.CanvasTexture(canvas);
    }
    return this._placeholderTexture;
  }

  /**
   * Evicts least-recently-used cache entries until memory is under budget.
   */
  private _evictIfNeeded(): void {
    while (this.cacheSizeBytes > MAX_CACHE_BYTES && this.cache.size > 1) {
      // Find the entry with the oldest lastUsedFrame
      let oldestKey: string | null = null;
      let oldestFrame = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.lastUsedFrame < oldestFrame) {
          oldestFrame = entry.lastUsedFrame;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        const entry = this.cache.get(oldestKey)!;
        entry.texture.dispose();
        this.cacheSizeBytes -= canvasBytes(entry.canvas);
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }
}
