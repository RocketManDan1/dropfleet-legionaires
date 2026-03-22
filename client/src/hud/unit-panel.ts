/**
 * UnitPanel — unit info panel shown when a unit is selected on the tactical screen.
 *
 * Source: UI_FLOW.md (Section 4.2 — Unit Panel)
 * Milestone 2: Skirmish Sandbox
 *
 * Displays: unit name, HP bar (crew), suppression bar, morale state badge,
 * speed state, fire posture, and ammo counts. The panel sits on the left side
 * of the tactical HUD as an HTML overlay on top of the Three.js viewport.
 *
 * HP bar color thresholds: green > 66%, yellow 33–66%, red < 33%.
 * Suppression bar is always red, grows left-to-right.
 * Morale is a text badge with color coding per state.
 */

import type { UnitSnapshot, UnitDelta, MoraleState, FirePosture } from '@legionaires/shared';

/** Color palette — DRONECOM aesthetic from DRONECOM_VISUAL_ANALYSIS.md */
const COLORS = {
  panelBg: '#0A0F14',
  panelBorder: '#1A3040',
  textPrimary: '#C8C8C8',
  textSecondary: '#808080',
  accent: '#80FFD0',
  hpGreen: '#40C040',
  hpYellow: '#D0C020',
  hpRed: '#E04030',
  suppressionRed: '#E04030',
  barBg: '#1A1A1A',
  morale: {
    normal: '#80FFD0',
    pinned: '#E0A020',
    routing: '#E04030',
    surrendered: '#808080',
  } as Record<MoraleState, string>,
  firePosture: {
    hold_fire: '#D09020',
    return_fire: '#C8C8C8',
    free_fire: '#E04030',
  } as Record<FirePosture, string>,
} as const;

/** Human-readable labels for morale states. */
const MORALE_LABELS: Record<MoraleState, string> = {
  normal: 'STEADY',
  pinned: 'PINNED',
  routing: 'ROUTING',
  surrendered: 'SURRENDERED',
};

/** Human-readable labels for fire postures. */
const FIRE_POSTURE_LABELS: Record<FirePosture, string> = {
  hold_fire: 'HOLD FIRE',
  return_fire: 'RETURN FIRE',
  free_fire: 'FREE FIRE',
};

/** Human-readable labels for speed states. */
const SPEED_LABELS: Record<string, string> = {
  stationary: 'HALTED',
  full_halt: 'HALTED',
  short_halt: 'SHORT HALT',
  slow: 'ADVANCING',
  moving: 'MOVING',
  fast: 'MARCHING',
};

export class UnitPanel {
  private container: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private hpBarFill: HTMLDivElement;
  private hpLabel: HTMLDivElement;
  private suppressionBarFill: HTMLDivElement;
  private suppressionLabel: HTMLDivElement;
  private moraleBadge: HTMLDivElement;
  private speedBadge: HTMLDivElement;
  private firePostureBadge: HTMLDivElement;
  private ammoContainer: HTMLDivElement;
  private styleTag: HTMLStyleElement;

  /** The currently displayed unit's snapshot state, kept for incremental updates. */
  private currentUnit: {
    unitId: string;
    unitTypeId: string;
    crewCurrent: number;
    crewMax: number;
    suppression: number;
    moraleState: MoraleState;
    speedState: string;
    firePosture: FirePosture;
    isDestroyed: boolean;
  } | null = null;

  constructor() {
    this.styleTag = this.createStyles();
    document.head.appendChild(this.styleTag);

    // Container
    this.container = document.createElement('div');
    this.container.className = 'unit-panel';

    // Unit name header
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'unit-panel__name';
    this.container.appendChild(this.nameEl);

    // HP section
    const hpSection = this.createBarSection('CREW');
    this.hpBarFill = hpSection.fill;
    this.hpLabel = hpSection.label;
    this.container.appendChild(hpSection.wrapper);

    // Suppression section
    const suppSection = this.createBarSection('SUPPRESSION');
    this.suppressionBarFill = suppSection.fill;
    this.suppressionLabel = suppSection.label;
    this.container.appendChild(suppSection.wrapper);

    // Status row: morale + speed + fire posture
    const statusRow = document.createElement('div');
    statusRow.className = 'unit-panel__status-row';

    this.moraleBadge = document.createElement('div');
    this.moraleBadge.className = 'unit-panel__badge';

    this.speedBadge = document.createElement('div');
    this.speedBadge.className = 'unit-panel__badge';

    this.firePostureBadge = document.createElement('div');
    this.firePostureBadge.className = 'unit-panel__badge unit-panel__badge--posture';

    statusRow.appendChild(this.moraleBadge);
    statusRow.appendChild(this.speedBadge);
    statusRow.appendChild(this.firePostureBadge);
    this.container.appendChild(statusRow);

    // Ammo counts
    const ammoHeader = document.createElement('div');
    ammoHeader.className = 'unit-panel__section-header';
    ammoHeader.textContent = 'AMMUNITION';
    this.container.appendChild(ammoHeader);

    this.ammoContainer = document.createElement('div');
    this.ammoContainer.className = 'unit-panel__ammo';
    this.container.appendChild(this.ammoContainer);

    // Start hidden
    this.container.style.display = 'none';

    document.body.appendChild(this.container);
  }

  /**
   * Show the panel and populate it with the given unit's data.
   */
  show(unit: UnitSnapshot): void {
    this.currentUnit = {
      unitId: unit.unitId,
      unitTypeId: unit.unitTypeId,
      crewCurrent: unit.crewCurrent,
      crewMax: unit.crewMax,
      suppression: unit.suppression,
      moraleState: unit.moraleState,
      speedState: unit.speedState,
      firePosture: unit.firePosture,
      isDestroyed: unit.isDestroyed,
    };

    // Name
    this.nameEl.textContent = unit.unitTypeId.toUpperCase().replace(/_/g, ' ');
    if (unit.isDestroyed) {
      this.nameEl.textContent += ' [DESTROYED]';
      this.nameEl.style.color = COLORS.hpRed;
    } else {
      this.nameEl.style.color = COLORS.accent;
    }

    // HP bar
    this.updateHpBar(unit.crewCurrent, unit.crewMax);

    // Suppression bar
    this.updateSuppressionBar(unit.suppression);

    // Morale
    this.updateMoraleBadge(unit.moraleState);

    // Speed
    this.updateSpeedBadge(unit.speedState);

    // Fire posture
    this.updateFirePostureBadge(unit.firePosture);

    // Ammo — we render placeholder ammo slots since UnitSnapshot in the
    // shared contract includes basic ammo info. For milestone 2 we display
    // suppression/crew as the primary stats.
    this.renderAmmoSlots(unit);

    this.container.style.display = 'flex';
  }

  /**
   * Hide the panel and clear the current unit reference.
   */
  hide(): void {
    this.container.style.display = 'none';
    this.currentUnit = null;
  }

  /**
   * Incrementally update the panel from a server delta. Only fields present
   * in the delta are updated; everything else stays as-is.
   */
  update(delta: UnitDelta): void {
    if (!this.currentUnit) return;
    if (delta.unitId !== this.currentUnit.unitId) return;

    // Position fields (posX, posZ, heading) are not displayed in the unit panel.

    // HP (crew)
    if (delta.hp !== undefined) {
      this.currentUnit.crewCurrent = delta.hp;
      this.updateHpBar(this.currentUnit.crewCurrent, this.currentUnit.crewMax);
    }

    // Suppression
    if (delta.suppression !== undefined) {
      this.currentUnit.suppression = delta.suppression;
      this.updateSuppressionBar(this.currentUnit.suppression);
    }

    // Morale
    if (delta.moraleState !== undefined) {
      this.currentUnit.moraleState = delta.moraleState;
      this.updateMoraleBadge(this.currentUnit.moraleState);
    }

    // Speed
    if (delta.speedState !== undefined) {
      this.currentUnit.speedState = delta.speedState;
      this.updateSpeedBadge(this.currentUnit.speedState);
    }

    // Destroyed
    if (delta.destroyed !== undefined && delta.destroyed) {
      this.currentUnit.isDestroyed = true;
      this.nameEl.textContent = this.currentUnit.unitTypeId.toUpperCase().replace(/_/g, ' ') + ' [DESTROYED]';
      this.nameEl.style.color = COLORS.hpRed;
    }
  }

  /**
   * Destroy the panel — remove all DOM elements and injected styles.
   * Call this when tearing down the tactical screen.
   */
  dispose(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.styleTag.parentNode) {
      this.styleTag.parentNode.removeChild(this.styleTag);
    }
  }

  /**
   * Returns true if the panel is currently visible.
   */
  isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  /**
   * Returns the unit ID currently displayed, or null if hidden.
   */
  getDisplayedUnitId(): string | null {
    return this.currentUnit?.unitId ?? null;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private updateHpBar(current: number, max: number): void {
    const pct = max > 0 ? (current / max) * 100 : 0;
    this.hpBarFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;

    // Color thresholds: green > 66%, yellow 33-66%, red < 33%
    if (pct > 66) {
      this.hpBarFill.style.backgroundColor = COLORS.hpGreen;
    } else if (pct > 33) {
      this.hpBarFill.style.backgroundColor = COLORS.hpYellow;
    } else {
      this.hpBarFill.style.backgroundColor = COLORS.hpRed;
    }

    this.hpLabel.textContent = `${current} / ${max}`;
  }

  private updateSuppressionBar(suppression: number): void {
    // Suppression is 0-100 scale
    const pct = Math.max(0, Math.min(100, suppression));
    this.suppressionBarFill.style.width = `${pct}%`;
    this.suppressionBarFill.style.backgroundColor = COLORS.suppressionRed;
    this.suppressionLabel.textContent = `${Math.round(suppression)}`;
  }

  private updateMoraleBadge(state: MoraleState): void {
    const label = MORALE_LABELS[state] || state.toUpperCase();
    const color = COLORS.morale[state] || COLORS.textPrimary;
    this.moraleBadge.textContent = label;
    this.moraleBadge.style.color = color;
    this.moraleBadge.style.borderColor = color;
  }

  private updateSpeedBadge(state: string): void {
    const label = SPEED_LABELS[state] || state.toUpperCase();
    this.speedBadge.textContent = label;
    this.speedBadge.style.color = COLORS.textSecondary;
    this.speedBadge.style.borderColor = COLORS.panelBorder;
  }

  private updateFirePostureBadge(posture: FirePosture): void {
    const label = FIRE_POSTURE_LABELS[posture] || posture.toUpperCase();
    const color = COLORS.firePosture[posture] || COLORS.textPrimary;
    this.firePostureBadge.textContent = label;
    this.firePostureBadge.style.color = color;
    this.firePostureBadge.style.borderColor = color;
  }

  private renderAmmoSlots(unit: UnitSnapshot): void {
    // Clear existing
    this.ammoContainer.innerHTML = '';

    // UnitSnapshot from the shared types does not include a detailed ammo
    // array, so we render crew-based readiness as the primary metric for
    // milestone 2. When the full UnitSnapshot with per-weapon ammo lands
    // (milestone 3+), this will be expanded.
    const readinessRow = document.createElement('div');
    readinessRow.className = 'unit-panel__ammo-row';

    const readinessLabel = document.createElement('span');
    readinessLabel.className = 'unit-panel__ammo-label';
    readinessLabel.textContent = 'READINESS';

    const readinessBar = document.createElement('div');
    readinessBar.className = 'unit-panel__ammo-bar';

    const readinessFill = document.createElement('div');
    readinessFill.className = 'unit-panel__ammo-bar-fill';
    const readinessPct = unit.crewMax > 0 ? (unit.crewCurrent / unit.crewMax) * 100 : 0;
    readinessFill.style.width = `${readinessPct}%`;
    readinessFill.style.backgroundColor = COLORS.accent;

    readinessBar.appendChild(readinessFill);
    readinessRow.appendChild(readinessLabel);
    readinessRow.appendChild(readinessBar);
    this.ammoContainer.appendChild(readinessRow);

    // Entrenched indicator
    if (unit.isEntrenched) {
      const entrenchedRow = document.createElement('div');
      entrenchedRow.className = 'unit-panel__ammo-row';
      const entrenchedLabel = document.createElement('span');
      entrenchedLabel.className = 'unit-panel__ammo-label';
      entrenchedLabel.textContent = 'ENTRENCHED';
      entrenchedLabel.style.color = COLORS.accent;
      entrenchedRow.appendChild(entrenchedLabel);
      this.ammoContainer.appendChild(entrenchedRow);
    }
  }

  private createBarSection(title: string): {
    wrapper: HTMLDivElement;
    fill: HTMLDivElement;
    label: HTMLDivElement;
  } {
    const wrapper = document.createElement('div');
    wrapper.className = 'unit-panel__bar-section';

    const header = document.createElement('div');
    header.className = 'unit-panel__bar-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'unit-panel__bar-title';
    titleEl.textContent = title;

    const label = document.createElement('div');
    label.className = 'unit-panel__bar-value';

    header.appendChild(titleEl);
    header.appendChild(label);
    wrapper.appendChild(header);

    const barTrack = document.createElement('div');
    barTrack.className = 'unit-panel__bar-track';

    const fill = document.createElement('div');
    fill.className = 'unit-panel__bar-fill';

    barTrack.appendChild(fill);
    wrapper.appendChild(barTrack);

    return { wrapper, fill, label };
  }

  /**
   * Create and return a <style> tag with all CSS for the unit panel.
   * Uses the DRONECOM aesthetic: dark background, monospace type,
   * mint/cyan accent color.
   */
  createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.setAttribute('data-unit-panel', '');
    style.textContent = `
      .unit-panel {
        position: fixed;
        top: 60px;
        left: 12px;
        width: 220px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: ${COLORS.panelBg};
        border: 1px solid ${COLORS.panelBorder};
        border-radius: 2px;
        font-family: 'Courier New', Courier, monospace;
        font-size: 12px;
        color: ${COLORS.textPrimary};
        z-index: 100;
        pointer-events: auto;
        user-select: none;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
      }

      .unit-panel__name {
        font-size: 13px;
        font-weight: bold;
        color: ${COLORS.accent};
        letter-spacing: 0.5px;
        padding-bottom: 6px;
        border-bottom: 1px solid ${COLORS.panelBorder};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .unit-panel__bar-section {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .unit-panel__bar-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }

      .unit-panel__bar-title {
        font-size: 10px;
        color: ${COLORS.textSecondary};
        letter-spacing: 1px;
      }

      .unit-panel__bar-value {
        font-size: 11px;
        color: ${COLORS.textPrimary};
      }

      .unit-panel__bar-track {
        width: 100%;
        height: 8px;
        background: ${COLORS.barBg};
        border: 1px solid ${COLORS.panelBorder};
        border-radius: 1px;
        overflow: hidden;
      }

      .unit-panel__bar-fill {
        height: 100%;
        width: 0%;
        transition: width 0.15s ease-out, background-color 0.15s ease-out;
        border-radius: 1px;
      }

      .unit-panel__status-row {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding-top: 4px;
      }

      .unit-panel__badge {
        padding: 2px 6px;
        border: 1px solid ${COLORS.panelBorder};
        border-radius: 2px;
        font-size: 10px;
        font-weight: bold;
        letter-spacing: 0.5px;
        white-space: nowrap;
      }

      .unit-panel__badge--posture {
        cursor: default;
      }

      .unit-panel__section-header {
        font-size: 10px;
        color: ${COLORS.textSecondary};
        letter-spacing: 1px;
        padding-top: 4px;
        border-top: 1px solid ${COLORS.panelBorder};
      }

      .unit-panel__ammo {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .unit-panel__ammo-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .unit-panel__ammo-label {
        font-size: 10px;
        color: ${COLORS.textSecondary};
        letter-spacing: 0.5px;
        min-width: 70px;
      }

      .unit-panel__ammo-bar {
        flex: 1;
        height: 6px;
        background: ${COLORS.barBg};
        border: 1px solid ${COLORS.panelBorder};
        border-radius: 1px;
        overflow: hidden;
      }

      .unit-panel__ammo-bar-fill {
        height: 100%;
        width: 0%;
        transition: width 0.15s ease-out;
        border-radius: 1px;
      }
    `;
    return style;
  }
}
