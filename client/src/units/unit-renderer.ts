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
import type {
  FactionId,
  ContactTier,
  UnitClass,
} from '@legionaires/shared';
import {
  FACTION_COLORS,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Frame shape drawn around the NATO icon, determined by faction. */
export type FrameShape = 'rectangle' | 'diamond' | 'hexagon' | 'quatrefoil';

/** All data the renderer needs to create or update a single icon. */
export interface IconDescriptor {
  unitTypeId: string;
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

/** Health bar dimensions relative to icon. */
const HEALTH_BAR_WIDTH = 48;
const HEALTH_BAR_HEIGHT = 5;
const HEALTH_BAR_OFFSET_Y = -28;

/** Selection ring radius in world units. */
const SELECTION_RING_RADIUS = 3.0;
const SELECTION_RING_SEGMENTS = 32;
const SELECTION_RING_COLOR = new THREE.Color(0x00ff88);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a faction identifier to its NATO frame shape.
 * - Terran Federation: rectangle (friendly standard)
 * - Khroshi Syndicalists: diamond (hostile standard)
 * - Ataxian Hive: hexagon (non-standard hostile — bio swarm)
 * - Unknown: quatrefoil (unidentified contact)
 */
function factionToFrameShape(faction: FactionId | 'unknown'): FrameShape {
  switch (faction) {
    case 'federation': return 'rectangle';
    case 'khroshi':    return 'diamond';
    case 'ataxian':    return 'hexagon';
    default:           return 'quatrefoil';
  }
}

/**
 * Builds a unique cache key from the visual parameters that affect rendering.
 * Detection tier changes what's drawn, so it must be part of the key.
 * Health is NOT part of the key — the health bar is drawn as a separate overlay.
 */
function buildCacheKey(
  unitTypeId: string,
  faction: FactionId | 'unknown',
  detectionTier: ContactTier,
): string {
  return `${unitTypeId}:${faction}:${detectionTier}`;
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

    // --- Icon sprite ---
    const iconSprite = this._createIconSprite(descriptor);
    iconSprite.name = 'icon-sprite';
    group.add(iconSprite);

    // --- Health bar sprite ---
    const healthSprite = this._createHealthBarSprite(
      descriptor.crewCurrent,
      descriptor.crewMax,
    );
    healthSprite.name = 'health-sprite';
    group.add(healthSprite);

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
      );
      const currentKey = (iconSprite.userData as { cacheKey?: string }).cacheKey;
      if (currentKey !== cacheKey) {
        // Need to re-render icon canvas
        const texture = this._getOrRenderIcon(descriptor);
        if (texture) {
          (iconSprite.material as THREE.SpriteMaterial).map = texture;
          (iconSprite.material as THREE.SpriteMaterial).needsUpdate = true;
          (iconSprite.userData as { cacheKey?: string }).cacheKey = cacheKey;
        }
        // If render budget exhausted, skip this frame — will catch up next frame
      }
    }

    // Always update health bar (cheap canvas redraw)
    const healthSprite = group.getObjectByName('health-sprite') as THREE.Sprite | undefined;
    if (healthSprite) {
      this._updateHealthBarTexture(
        healthSprite,
        descriptor.crewCurrent,
        descriptor.crewMax,
      );
    }

    // Toggle selection ring visibility
    const ring = group.getObjectByName('selection-ring');
    if (ring) {
      ring.visible = descriptor.isSelected;
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
    sprite.position.set(0, 5, 0); // float above terrain surface
    sprite.userData = {
      cacheKey: buildCacheKey(
        descriptor.unitTypeId,
        descriptor.faction,
        descriptor.detectionTier,
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

    const colors = FACTION_COLORS[descriptor.faction === 'unknown' ? 'unknown' : descriptor.faction];
    const frameShape = factionToFrameShape(descriptor.faction);

    ctx.clearRect(0, 0, ICON_W, ICON_H);

    // Frame occupies the top portion of the canvas.
    const fX = 3, fY = 4, fW = ICON_W - 6, fH = 38;
    const cx = fX + fW / 2;
    const cy = fY + fH / 2;

    // ---- SUSPECTED: small pulsing blip, no frame ----
    if (descriptor.detectionTier === 'SUSPECTED') {
      ctx.beginPath();
      ctx.arc(ICON_W / 2, fY + fH / 2, 9, 0, Math.PI * 2);
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.strokeStyle = colors.frame;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', ICON_W / 2, fY + fH / 2);
      return canvas;
    }

    // ---- LOST: dashed frame, faded, no inner symbol ----
    if (descriptor.detectionTier === 'LOST') {
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([4, 4]);
      this._drawFrameShape(ctx, frameShape, cx, cy, fX, fY, fW, fH);
      ctx.strokeStyle = colors.frame;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
      return canvas;
    }

    // ---- DETECTED / CONFIRMED: solid frame + inner symbol + labels ----

    // Frame fill: near-black with faction tint — DRONECOM "war room" look
    this._drawFrameShape(ctx, frameShape, cx, cy, fX, fY, fW, fH);
    ctx.fillStyle = '#080C14';
    ctx.fill();
    ctx.strokeStyle = colors.frame;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner NATO symbol (geometric glyph, white)
    this._drawNATOInnerSymbol(ctx, cx, cy, fH * 0.42, descriptor.unitClass);

    // Labels below the frame (CONFIRMED only)
    if (descriptor.detectionTier === 'CONFIRMED') {
      const labelY = fY + fH + 5;
      ctx.textAlign = 'center';

      // Unit class abbreviation — bright, easy to read
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#C8D8E8';
      ctx.textBaseline = 'top';
      ctx.fillText(this._unitClassAbbreviation(descriptor.unitClass), cx, labelY);

      // Type ID — dimmer, faction colour
      ctx.font = '8px monospace';
      ctx.fillStyle = colors.frame;
      ctx.fillText(descriptor.unitTypeId.replace(/_/g, ' ').substring(0, 10), cx, labelY + 12);
    }

    return canvas;
  }

  /**
   * Traces the faction frame shape path (no fill or stroke — caller applies those).
   */
  private _drawFrameShape(
    ctx: CanvasRenderingContext2D,
    shape: FrameShape,
    cx: number, cy: number,
    fX: number, fY: number, fW: number, fH: number,
  ): void {
    const r = Math.min(fW, fH) / 2;
    ctx.beginPath();
    switch (shape) {
      case 'rectangle':
        ctx.rect(fX, fY, fW, fH);
        break;
      case 'diamond':
        ctx.moveTo(cx,        fY);
        ctx.lineTo(fX + fW,  cy);
        ctx.lineTo(cx,        fY + fH);
        ctx.lineTo(fX,        cy);
        ctx.closePath();
        break;
      case 'hexagon':
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = cx + r * Math.cos(a);
          const py = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      case 'quatrefoil': {
        const qr = r * 0.9;
        for (let i = 0; i < 4; i++) {
          const a = (Math.PI / 2) * i;
          const px = cx + qr * Math.cos(a);
          const py = cy + qr * Math.sin(a);
          ctx.quadraticCurveTo(
            cx + qr * 0.55 * Math.cos(a + Math.PI / 4),
            cy + qr * 0.55 * Math.sin(a + Math.PI / 4),
            px, py,
          );
        }
        ctx.closePath();
        break;
      }
    }
  }

  /**
   * Draws the NATO inner glyph centred at (cx, cy).
   * Uses purely geometric shapes — no text — matching the DRONECOM aesthetic.
   *
   * Glyph key:
   *   Armor (MBT/IFV/APC/AT/AA vehicle) — diagonal line, bottom-left → top-right
   *   Infantry variants                  — × (crossed diagonals)
   *   Artillery / mortar                 — circle outline
   *   Scout                              — small filled circle (dot)
   *   HQ                                 — filled diamond pip
   *   Helicopters                        — two arcs (rotor blades)
   *   Fixed wing                         — wide chevron arc
   *   Support / supply                   — horizontal dash
   */
  private _drawNATOInnerSymbol(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    size: number,
    unitClass: UnitClass,
  ): void {
    ctx.strokeStyle = '#FFFFFF';
    ctx.fillStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    switch (unitClass) {
      case 'mbt':
      case 'ifv':
      case 'apc':
      case 'at_vehicle':
      case 'aa_vehicle':
        // Armor: diagonal line, bottom-left to top-right
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.55, cy + size * 0.45);
        ctx.lineTo(cx + size * 0.55, cy - size * 0.45);
        ctx.stroke();
        break;

      case 'infantry':
      case 'at_infantry':
      case 'aa_infantry':
      case 'engineer':
      case 'sniper':
        // Infantry: × (two crossing diagonals)
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.38, cy - size * 0.38);
        ctx.lineTo(cx + size * 0.38, cy + size * 0.38);
        ctx.moveTo(cx + size * 0.38, cy - size * 0.38);
        ctx.lineTo(cx - size * 0.38, cy + size * 0.38);
        ctx.stroke();
        break;

      case 'arty_sp':
      case 'arty_towed':
      case 'mortar':
        // Artillery: circle outline
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.38, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'scout':
        // Scout: small filled dot
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'hq':
        // HQ: small filled diamond pip
        ctx.beginPath();
        ctx.moveTo(cx,           cy - size * 0.38);
        ctx.lineTo(cx + size * 0.28, cy);
        ctx.lineTo(cx,           cy + size * 0.38);
        ctx.lineTo(cx - size * 0.28, cy);
        ctx.closePath();
        ctx.fill();
        break;

      case 'helicopter_attack':
      case 'helicopter_transport':
        // Helicopters: two small arcs (stylised rotor)
        ctx.beginPath();
        ctx.arc(cx - size * 0.22, cy + size * 0.05, size * 0.28, Math.PI, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + size * 0.22, cy + size * 0.05, size * 0.28, Math.PI, 0);
        ctx.stroke();
        break;

      case 'fixed_wing':
        // Fixed wing: wide chevron arc
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.5, cy + size * 0.15);
        ctx.quadraticCurveTo(cx, cy - size * 0.38, cx + size * 0.5, cy + size * 0.15);
        ctx.stroke();
        break;

      default:
        // Support / supply / unknown: horizontal dash
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.38, cy);
        ctx.lineTo(cx + size * 0.38, cy);
        ctx.stroke();
        break;
    }
  }

  /**
   * Maps UnitClass to a short abbreviation for DETECTED-tier display.
   */
  private _unitClassAbbreviation(unitClass: UnitClass): string {
    // TODO: Expand with proper NATO symbol function IDs
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
  // Private — Health bar
  // -------------------------------------------------------------------------

  /**
   * Creates a health bar sprite positioned below the icon.
   */
  private _createHealthBarSprite(
    crewCurrent: number,
    crewMax: number,
  ): THREE.Sprite {
    const canvas = this._renderHealthBarCanvas(crewCurrent, crewMax);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.05, 0.01, 1);
    sprite.position.set(0, 3.5, 0); // below the icon sprite
    sprite.userData = { canvas };

    return sprite;
  }

  /**
   * Updates an existing health bar sprite with new crew values.
   */
  private _updateHealthBarTexture(
    sprite: THREE.Sprite,
    crewCurrent: number,
    crewMax: number,
  ): void {
    const canvas = (sprite.userData as { canvas: HTMLCanvasElement }).canvas;
    this._renderHealthBarCanvas(crewCurrent, crewMax, canvas);
    const material = sprite.material as THREE.SpriteMaterial;
    if (material.map) {
      material.map.needsUpdate = true;
    }
  }

  /**
   * Renders or re-renders the health bar onto a canvas.
   */
  private _renderHealthBarCanvas(
    crewCurrent: number,
    crewMax: number,
    existingCanvas?: HTMLCanvasElement,
  ): HTMLCanvasElement {
    const canvas = existingCanvas ?? document.createElement('canvas');
    canvas.width = HEALTH_BAR_WIDTH;
    canvas.height = HEALTH_BAR_HEIGHT;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);

    // Background (dark)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);

    // Health fill
    const fraction = crewMax > 0 ? Math.max(0, crewCurrent / crewMax) : 0;
    const fillWidth = Math.round(fraction * HEALTH_BAR_WIDTH);

    // Color: green > 66%, yellow > 33%, red <= 33%
    if (fraction > 0.66) {
      ctx.fillStyle = '#22cc44';
    } else if (fraction > 0.33) {
      ctx.fillStyle = '#cccc22';
    } else {
      ctx.fillStyle = '#cc2222';
    }
    ctx.fillRect(0, 0, fillWidth, HEALTH_BAR_HEIGHT);

    // Border
    ctx.strokeStyle = 'rgba(200, 210, 210, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);

    return canvas;
  }

  // -------------------------------------------------------------------------
  // Private — Placeholder & cache eviction
  // -------------------------------------------------------------------------

  /** Shared 1x1 transparent texture for budget-exceeded frames. */
  private _placeholderTexture: THREE.CanvasTexture | null = null;

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
