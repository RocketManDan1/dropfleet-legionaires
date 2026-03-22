// ============================================================================
// PLANET VIEW — detail panel for a selected planet (influence, missions, travel)
// Milestone 5
// Source: CAMPAIGN_OVERVIEW.md, LOBBY_AND_MATCHMAKING.md, UI_FLOW.md
// ============================================================================

import type {
  PlanetRecord, DifficultyTier, MissionType,
} from '@legionaires/shared';
import {
  FACTION_COLORS, MAX_PLAYERS_PER_MISSION,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveMissionSummary {
  missionId: string;
  missionType: MissionType;
  difficulty: DifficultyTier;
  playerCount: number;
  phase: string;
}

export interface PlanetViewCallbacks {
  onCreateMission: (planetId: string, difficulty: DifficultyTier) => void;
  onJoinMission: (missionId: string) => void;
  onTravel: (planetId: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// PlanetView
// ---------------------------------------------------------------------------

/**
 * Slide-in detail panel for a selected planet.
 * Shows influence breakdown, active missions, and action buttons.
 */
export class PlanetView {
  private panel: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private callbacks: PlanetViewCallbacks | null = null;
  private currentPlanet: PlanetRecord | null = null;

  show(
    planet: PlanetRecord,
    missions: ActiveMissionSummary[],
    callbacks: PlanetViewCallbacks,
    options?: { canTravel?: boolean; canCreateMission?: boolean },
  ): void {
    this.callbacks = callbacks;
    this.currentPlanet = planet;
    this.injectStyles();
    this.dispose();

    const canTravel = options?.canTravel ?? true;
    const canCreate = options?.canCreateMission ?? true;

    this.panel = document.createElement('div');
    this.panel.className = 'planet-view';

    // Header
    const header = document.createElement('div');
    header.className = 'planet-view__header';
    header.innerHTML = `
      <span class="planet-view__name">${planet.name}</span>
      <span class="planet-view__stars">${'★'.repeat(planet.strategicValueTier)}</span>
      <button class="planet-view__close">✕</button>
    `;
    header.querySelector('.planet-view__close')!.addEventListener('click', () => {
      this.hide();
      this.callbacks?.onClose();
    });
    this.panel.appendChild(header);

    // Influence bar
    this.panel.appendChild(this.buildInfluenceSection(planet));

    // Traits
    if (planet.planetTraits.length > 0) {
      const traitsEl = document.createElement('div');
      traitsEl.className = 'planet-view__section';
      traitsEl.innerHTML = `<div class="planet-view__section-title">TRAITS</div>
        <div class="planet-view__traits">${planet.planetTraits.map(t =>
        `<span class="planet-view__trait">${t}</span>`
      ).join('')}</div>`;
      this.panel.appendChild(traitsEl);
    }

    // Active missions
    this.panel.appendChild(this.buildMissionsSection(missions));

    // Actions
    const actions = document.createElement('div');
    actions.className = 'planet-view__actions';

    if (canCreate) {
      const createBtn = document.createElement('button');
      createBtn.className = 'planet-view__btn planet-view__btn--create';
      createBtn.textContent = 'CREATE MISSION';
      createBtn.addEventListener('click', () => this.showCreateForm());
      actions.appendChild(createBtn);
    }

    if (canTravel) {
      const travelBtn = document.createElement('button');
      travelBtn.className = 'planet-view__btn planet-view__btn--travel';
      travelBtn.textContent = 'TRAVEL HERE';
      travelBtn.addEventListener('click', () => {
        this.callbacks?.onTravel(planet.planetId);
      });
      actions.appendChild(travelBtn);
    }

    this.panel.appendChild(actions);

    // Create mission form (hidden by default)
    this.panel.appendChild(this.buildCreateForm(planet));

    document.body.appendChild(this.panel);
  }

  hide(): void {
    this.panel?.remove();
    this.panel = null;
  }

  dispose(): void {
    this.hide();
  }

  updateMissions(missions: ActiveMissionSummary[]): void {
    if (!this.panel) return;
    const existing = this.panel.querySelector('.planet-view__missions');
    if (existing && this.currentPlanet) {
      const newSection = this.buildMissionsSection(missions);
      existing.replaceWith(newSection);
    }
  }

  // --- Internal ---

  private buildInfluenceSection(planet: PlanetRecord): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'planet-view__section';

    const fedPct = planet.influenceFederation;
    const atxPct = planet.influenceAtaxian;
    const khrPct = planet.influenceKhroshi;

    section.innerHTML = `
      <div class="planet-view__section-title">INFLUENCE</div>
      <div class="planet-view__influence-bar">
        <div style="width:${fedPct}%;background:${FACTION_COLORS.federation.frame}" title="Federation ${fedPct}%"></div>
        <div style="width:${atxPct}%;background:${FACTION_COLORS.ataxian.frame}" title="Ataxian ${atxPct}%"></div>
        <div style="width:${khrPct}%;background:${FACTION_COLORS.khroshi.frame}" title="Khroshi ${khrPct}%"></div>
      </div>
      <div class="planet-view__influence-labels">
        <span style="color:${FACTION_COLORS.federation.frame}">FED ${fedPct}%</span>
        ${atxPct > 0 ? `<span style="color:${FACTION_COLORS.ataxian.frame}">ATX ${atxPct}%</span>` : ''}
        ${khrPct > 0 ? `<span style="color:${FACTION_COLORS.khroshi.frame}">KHR ${khrPct}%</span>` : ''}
      </div>
      <div class="planet-view__garrison">Garrison: ${planet.garrisonStrength}%</div>
    `;
    return section;
  }

  private buildMissionsSection(missions: ActiveMissionSummary[]): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'planet-view__section planet-view__missions';

    let html = '<div class="planet-view__section-title">ACTIVE MISSIONS</div>';

    if (missions.length === 0) {
      html += '<div class="planet-view__no-missions">No active missions</div>';
    } else {
      for (const m of missions) {
        const joinable = m.playerCount < MAX_PLAYERS_PER_MISSION &&
          (m.phase === 'deployment' || m.phase === 'live');
        const diffClass = `planet-view__diff--${m.difficulty}`;

        html += `
          <div class="planet-view__mission-row">
            <span class="planet-view__mission-type">${m.missionType.toUpperCase()}</span>
            <span class="planet-view__mission-diff ${diffClass}">${m.difficulty.toUpperCase()}</span>
            <span class="planet-view__mission-players">${m.playerCount}/${MAX_PLAYERS_PER_MISSION}</span>
            <span class="planet-view__mission-phase">${m.phase}</span>
            ${joinable
            ? `<button class="planet-view__btn--join" data-mission-id="${m.missionId}">JOIN</button>`
            : '<span class="planet-view__mission-full">FULL</span>'}
          </div>`;
      }
    }

    section.innerHTML = html;

    // Bind join buttons
    section.querySelectorAll('.planet-view__btn--join').forEach(btn => {
      btn.addEventListener('click', () => {
        const missionId = (btn as HTMLElement).dataset.missionId!;
        this.callbacks?.onJoinMission(missionId);
      });
    });

    return section;
  }

  private buildCreateForm(planet: PlanetRecord): HTMLDivElement {
    const form = document.createElement('div');
    form.className = 'planet-view__create-form';
    form.style.display = 'none';

    form.innerHTML = `
      <div class="planet-view__section-title">NEW MISSION</div>
      <div class="planet-view__diff-select">
        <label><input type="radio" name="pv-diff" value="easy" checked> EASY</label>
        <label><input type="radio" name="pv-diff" value="medium"> MEDIUM</label>
        <label><input type="radio" name="pv-diff" value="hard"> HARD</label>
      </div>
      <button class="planet-view__btn planet-view__btn--confirm">LAUNCH OPERATION</button>
      <button class="planet-view__btn planet-view__btn--cancel-create">CANCEL</button>
    `;

    form.querySelector('.planet-view__btn--confirm')!.addEventListener('click', () => {
      const selected = form.querySelector<HTMLInputElement>('input[name="pv-diff"]:checked');
      const difficulty = (selected?.value ?? 'easy') as DifficultyTier;
      this.callbacks?.onCreateMission(planet.planetId, difficulty);
      form.style.display = 'none';
    });

    form.querySelector('.planet-view__btn--cancel-create')!.addEventListener('click', () => {
      form.style.display = 'none';
    });

    return form;
  }

  private showCreateForm(): void {
    const form = this.panel?.querySelector<HTMLDivElement>('.planet-view__create-form');
    if (form) form.style.display = 'block';
  }

  // --- Styles ---

  private injectStyles(): void {
    if (this.styleEl) return;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      .planet-view {
        position: fixed; top: 0; right: 0; bottom: 0;
        width: 360px;
        background: #0a0a10ee;
        border-left: 1px solid #2a2a3a;
        font-family: 'Courier New', monospace;
        color: #c0c0c0;
        padding: 16px;
        overflow-y: auto;
        z-index: 20;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .planet-view__header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .planet-view__name {
        font-size: 18px;
        color: #80ffd0;
        font-weight: bold;
        flex: 1;
      }
      .planet-view__stars { color: #ffdc00; }
      .planet-view__close {
        background: none; border: 1px solid #555; color: #aaa;
        cursor: pointer; font-size: 14px; padding: 2px 6px;
      }
      .planet-view__close:hover { color: #fff; border-color: #888; }
      .planet-view__section { margin-top: 4px; }
      .planet-view__section-title {
        font-size: 10px;
        letter-spacing: 2px;
        color: #666;
        margin-bottom: 6px;
      }
      .planet-view__influence-bar {
        display: flex;
        height: 10px;
        border-radius: 2px;
        overflow: hidden;
        background: #1a1a2a;
        margin-bottom: 4px;
      }
      .planet-view__influence-bar > div { height: 100%; }
      .planet-view__influence-labels {
        display: flex;
        gap: 12px;
        font-size: 10px;
      }
      .planet-view__garrison { font-size: 11px; color: #888; margin-top: 2px; }
      .planet-view__traits { display: flex; gap: 4px; flex-wrap: wrap; }
      .planet-view__trait {
        font-size: 10px;
        background: #1a1a2a;
        border: 1px solid #333;
        padding: 2px 6px;
        border-radius: 2px;
      }
      .planet-view__no-missions { color: #555; font-size: 11px; }
      .planet-view__mission-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        border-bottom: 1px solid #1a1a2a;
        font-size: 11px;
      }
      .planet-view__mission-type { flex: 1; color: #80ffd0; }
      .planet-view__mission-diff { font-size: 9px; padding: 1px 4px; border-radius: 2px; }
      .planet-view__diff--easy { background: #1a3a1a; color: #4a4; }
      .planet-view__diff--medium { background: #3a3a1a; color: #aa4; }
      .planet-view__diff--hard { background: #3a1a1a; color: #a44; }
      .planet-view__mission-players { color: #aaa; }
      .planet-view__mission-phase { color: #666; font-size: 9px; }
      .planet-view__mission-full { color: #555; font-size: 9px; }
      .planet-view__btn--join {
        background: none; border: 1px solid #4080ff; color: #4080ff;
        cursor: pointer; font-size: 10px; padding: 2px 8px; font-family: inherit;
      }
      .planet-view__btn--join:hover { background: #4080ff22; }
      .planet-view__actions {
        display: flex;
        gap: 8px;
      }
      .planet-view__btn {
        flex: 1;
        padding: 8px;
        font-family: inherit;
        font-size: 11px;
        letter-spacing: 1px;
        cursor: pointer;
        border: 1px solid #555;
        background: #111;
        color: #ccc;
      }
      .planet-view__btn:hover { background: #1a1a2a; }
      .planet-view__btn--create { border-color: #00ff41; color: #00ff41; }
      .planet-view__btn--travel { border-color: #4080ff; color: #4080ff; }
      .planet-view__create-form {
        border: 1px solid #333;
        padding: 12px;
        background: #0d0d14;
      }
      .planet-view__diff-select {
        display: flex;
        gap: 12px;
        margin-bottom: 8px;
        font-size: 11px;
      }
      .planet-view__diff-select input { margin-right: 4px; }
      .planet-view__btn--confirm { border-color: #00ff41; color: #00ff41; margin-bottom: 4px; }
      .planet-view__btn--cancel-create { border-color: #666; color: #888; }
    `;
    document.head.appendChild(this.styleEl);
  }
}
