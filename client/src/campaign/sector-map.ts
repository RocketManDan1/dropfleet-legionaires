// ============================================================================
// SECTOR MAP — top-level campaign view showing planets and connections
// Milestone 5
// Source: CAMPAIGN_OVERVIEW.md, UI_FLOW.md
// ============================================================================

import type {
  PlanetRecord, FactionId,
} from '@legionaires/shared';
import {
  FACTION_COLORS, INFLUENCE_FALLEN_THRESHOLD,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectorMapCallbacks {
  onPlanetSelect: (planetId: string) => void;
  onPlanetHover: (planetId: string | null) => void;
}

interface PlanetNode {
  planet: PlanetRecord;
  el: HTMLDivElement;
  labelEl: HTMLSpanElement;
  ringEl: HTMLDivElement;
  x: number;   // screen px
  y: number;   // screen px
}

// ---------------------------------------------------------------------------
// SectorMap
// ---------------------------------------------------------------------------

/**
 * Renders a 2D HTML/CSS strategic overview of the campaign sector.
 * Each planet is a coloured ring node; connections drawn via SVG lines.
 */
export class SectorMap {
  private container: HTMLDivElement | null = null;
  private svgLayer: SVGSVGElement | null = null;
  private nodes = new Map<string, PlanetNode>();
  private callbacks: SectorMapCallbacks | null = null;
  private selectedPlanetId: string | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private tooltip: HTMLDivElement | null = null;

  // --- Lifecycle ----

  init(
    parentEl: HTMLElement,
    planets: PlanetRecord[],
    callbacks: SectorMapCallbacks,
  ): void {
    this.callbacks = callbacks;
    this.injectStyles();

    // Root container
    this.container = document.createElement('div');
    this.container.className = 'sector-map';
    parentEl.appendChild(this.container);

    // SVG layer for connections
    this.svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgLayer.classList.add('sector-map__svg');
    this.container.appendChild(this.svgLayer);

    // Tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'sector-map__tooltip';
    this.tooltip.style.display = 'none';
    this.container.appendChild(this.tooltip);

    // Build planet nodes
    this.buildNodes(planets);
    this.drawConnections(planets);
  }

  /** Full refresh (e.g. after campaign tick). */
  updatePlanets(planets: PlanetRecord[]): void {
    for (const p of planets) {
      const node = this.nodes.get(p.planetId);
      if (!node) continue;
      node.planet = p;
      this.stylePlanetNode(node);
    }
    this.drawConnections(planets);
  }

  setSelectedPlanet(planetId: string | null): void {
    if (this.selectedPlanetId) {
      const prev = this.nodes.get(this.selectedPlanetId);
      if (prev) prev.el.classList.remove('sector-map__node--selected');
    }
    this.selectedPlanetId = planetId;
    if (planetId) {
      const node = this.nodes.get(planetId);
      if (node) node.el.classList.add('sector-map__node--selected');
    }
  }

  dispose(): void {
    this.container?.remove();
    this.styleEl?.remove();
    this.nodes.clear();
    this.container = null;
    this.svgLayer = null;
    this.styleEl = null;
    this.tooltip = null;
  }

  // --- Internal ---

  private buildNodes(planets: PlanetRecord[]): void {
    if (!this.container) return;

    // Determine bounds for normalisation
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of planets) {
      if (p.sectorPositionX < minX) minX = p.sectorPositionX;
      if (p.sectorPositionX > maxX) maxX = p.sectorPositionX;
      if (p.sectorPositionY < minY) minY = p.sectorPositionY;
      if (p.sectorPositionY > maxY) maxY = p.sectorPositionY;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const pad = 60; // px padding

    for (const p of planets) {
      const el = document.createElement('div');
      el.className = 'sector-map__node';

      const ringEl = document.createElement('div');
      ringEl.className = 'sector-map__ring';
      el.appendChild(ringEl);

      const labelEl = document.createElement('span');
      labelEl.className = 'sector-map__label';
      labelEl.textContent = p.name;
      el.appendChild(labelEl);

      // Position on map (normalised 0-1, then scaled to container)
      const nx = (p.sectorPositionX - minX) / rangeX;
      const ny = (p.sectorPositionY - minY) / rangeY;
      const x = pad + nx * (window.innerWidth - 2 * pad);
      const y = pad + ny * (window.innerHeight - 2 * pad);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      // Click
      el.addEventListener('click', () => {
        this.setSelectedPlanet(p.planetId);
        this.callbacks?.onPlanetSelect(p.planetId);
      });

      // Hover tooltip
      el.addEventListener('mouseenter', () => {
        this.showTooltip(p, x, y);
        this.callbacks?.onPlanetHover(p.planetId);
      });
      el.addEventListener('mouseleave', () => {
        this.hideTooltip();
        this.callbacks?.onPlanetHover(null);
      });

      this.container!.appendChild(el);

      const node: PlanetNode = { planet: p, el, labelEl, ringEl, x, y };
      this.stylePlanetNode(node);
      this.nodes.set(p.planetId, node);
    }
  }

  private stylePlanetNode(node: PlanetNode): void {
    const p = node.planet;
    const controlling = this.getControllingFaction(p);
    const colors = controlling
      ? FACTION_COLORS[controlling as keyof typeof FACTION_COLORS]
      : FACTION_COLORS.unknown;

    node.ringEl.style.borderColor = colors.frame;
    node.ringEl.style.backgroundColor = colors.fill;

    // Size ring by strategic value
    const sizes = { 1: 24, 2: 32, 3: 40 };
    const sz = sizes[p.strategicValueTier] ?? 28;
    node.ringEl.style.width = `${sz}px`;
    node.ringEl.style.height = `${sz}px`;

    // Contested glow
    const isContested = p.influenceFederation > 0 &&
      (p.influenceAtaxian > 0 || p.influenceKhroshi > 0);
    if (isContested) {
      node.el.classList.add('sector-map__node--contested');
    } else {
      node.el.classList.remove('sector-map__node--contested');
    }

    // Fallen indicator
    const isFallen = p.influenceAtaxian >= INFLUENCE_FALLEN_THRESHOLD ||
      p.influenceKhroshi >= INFLUENCE_FALLEN_THRESHOLD;
    if (isFallen) {
      node.el.classList.add('sector-map__node--fallen');
    } else {
      node.el.classList.remove('sector-map__node--fallen');
    }
  }

  private getControllingFaction(p: PlanetRecord): FactionId | null {
    if (p.influenceFederation > 50) return 'federation';
    if (p.influenceAtaxian > 50) return 'ataxian';
    if (p.influenceKhroshi > 50) return 'khroshi';
    return null;
  }

  private drawConnections(planets: PlanetRecord[]): void {
    if (!this.svgLayer) return;
    // Clear existing
    while (this.svgLayer.firstChild) this.svgLayer.removeChild(this.svgLayer.firstChild);

    this.svgLayer.setAttribute('width', `${window.innerWidth}`);
    this.svgLayer.setAttribute('height', `${window.innerHeight}`);

    const drawn = new Set<string>();

    for (const p of planets) {
      const from = this.nodes.get(p.planetId);
      if (!from) continue;

      for (const connId of p.connectedPlanetIds) {
        const key = [p.planetId, connId].sort().join(':');
        if (drawn.has(key)) continue;
        drawn.add(key);

        const to = this.nodes.get(connId);
        if (!to) continue;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(from.x));
        line.setAttribute('y1', String(from.y));
        line.setAttribute('x2', String(to.x));
        line.setAttribute('y2', String(to.y));
        line.setAttribute('class', 'sector-map__connection');
        this.svgLayer.appendChild(line);
      }
    }
  }

  private showTooltip(p: PlanetRecord, x: number, y: number): void {
    if (!this.tooltip) return;
    const faction = this.getControllingFaction(p) ?? 'Contested';
    this.tooltip.innerHTML = `
      <div class="sector-map__tooltip-name">${p.name}</div>
      <div>Strategic Value: ${'★'.repeat(p.strategicValueTier)}</div>
      <div>Control: ${faction}</div>
      <div class="sector-map__tooltip-bar">
        <span style="width:${p.influenceFederation}%;background:${FACTION_COLORS.federation.frame}"></span>
        <span style="width:${p.influenceAtaxian}%;background:${FACTION_COLORS.ataxian.frame}"></span>
        <span style="width:${p.influenceKhroshi}%;background:${FACTION_COLORS.khroshi.frame}"></span>
      </div>
      <div>Garrison: ${p.garrisonStrength}%</div>
    `;
    this.tooltip.style.left = `${x + 30}px`;
    this.tooltip.style.top = `${y - 20}px`;
    this.tooltip.style.display = 'block';
  }

  private hideTooltip(): void {
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  // --- Styles ---

  private injectStyles(): void {
    if (this.styleEl) return;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      .sector-map {
        position: fixed; inset: 0;
        background: #050508;
        overflow: hidden;
        font-family: 'Courier New', monospace;
        color: #c0c0c0;
      }
      .sector-map__svg {
        position: absolute; inset: 0;
        pointer-events: none;
      }
      .sector-map__connection {
        stroke: #2a2a3a;
        stroke-width: 1;
        stroke-dasharray: 4 4;
      }
      .sector-map__node {
        position: absolute;
        transform: translate(-50%, -50%);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        z-index: 1;
      }
      .sector-map__ring {
        border-radius: 50%;
        border: 2px solid #888;
        transition: border-color 0.3s, background-color 0.3s;
      }
      .sector-map__label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1px;
        white-space: nowrap;
        text-shadow: 0 0 4px #000;
      }
      .sector-map__node--selected .sector-map__ring {
        box-shadow: 0 0 12px 4px rgba(64,128,255,0.6);
      }
      .sector-map__node--contested .sector-map__ring {
        animation: pulse-contested 2s ease-in-out infinite;
      }
      @keyframes pulse-contested {
        0%,100% { box-shadow: 0 0 6px 2px rgba(255,220,0,0.3); }
        50% { box-shadow: 0 0 14px 6px rgba(255,220,0,0.6); }
      }
      .sector-map__node--fallen .sector-map__ring {
        opacity: 0.4;
      }
      .sector-map__tooltip {
        position: absolute;
        background: #0a0a14ee;
        border: 1px solid #333;
        padding: 8px 12px;
        font-size: 11px;
        z-index: 10;
        pointer-events: none;
        min-width: 160px;
      }
      .sector-map__tooltip-name {
        font-size: 13px;
        color: #80ffd0;
        margin-bottom: 4px;
        font-weight: bold;
      }
      .sector-map__tooltip-bar {
        display: flex;
        height: 6px;
        margin: 4px 0;
        border-radius: 3px;
        overflow: hidden;
        background: #222;
      }
      .sector-map__tooltip-bar span {
        display: block;
        height: 100%;
      }
    `;
    document.head.appendChild(this.styleEl);
  }
}
