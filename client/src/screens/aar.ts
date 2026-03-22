// ============================================================================
// AAR SCREEN — After Action Report (post-mission results)
// Milestone: 3 ("Playable Mission")
// Source: POST_MISSION_RESOLUTION.md, UI_FLOW.md
//
// Full-screen DOM overlay that displays the mission result banner
// (VICTORY / DEFEAT / DRAW), mission statistics, per-player breakdown
// table with SP rewards, and an influence change bar. All styled in
// DRONECOM C2 aesthetic (dark background, green/amber/red text,
// monospace font, subtle scan-line overlays).
// ============================================================================

import type {
  AARPayload,
  AARPlayerResult,
  MissionType,
  DifficultyTier,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback fired when the player clicks the "Continue" button. */
export type AcknowledgeCallback = () => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Color scheme by result. */
const RESULT_COLORS: Record<'victory' | 'defeat' | 'draw', {
  primary: string;
  glow: string;
  bg: string;
}> = {
  victory: {
    primary: '#00ff41',
    glow: 'rgba(0, 255, 65, 0.4)',
    bg: 'rgba(0, 255, 65, 0.04)',
  },
  defeat: {
    primary: '#ff4136',
    glow: 'rgba(255, 65, 54, 0.4)',
    bg: 'rgba(255, 65, 54, 0.04)',
  },
  draw: {
    primary: '#ffdc00',
    glow: 'rgba(255, 220, 0, 0.4)',
    bg: 'rgba(255, 220, 0, 0.04)',
  },
};

/** Human-readable mission type labels. */
const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  defend: 'DEFENSE',
  seize: 'SEIZURE',
  raid: 'RAID',
  patrol: 'PATROL',
  rescue: 'RESCUE',
  breakthrough: 'BREAKTHROUGH',
  evacuation: 'EVACUATION',
  hive_clear: 'HIVE CLEARANCE',
  fortification_assault: 'FORT. ASSAULT',
  logistics: 'LOGISTICS',
};

/** Difficulty display labels. */
const DIFFICULTY_LABELS: Record<DifficultyTier, string> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
};

const DIFFICULTY_COLORS: Record<DifficultyTier, string> = {
  easy: '#00ff41',
  medium: '#ffdc00',
  hard: '#ff4136',
};

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

const STYLE_ID = 'aar-screen-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .aar-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #0a0a0a;
      z-index: 200;
      font-family: 'Courier New', Courier, monospace;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0 20px 40px 20px;
    }

    /* Scan-line overlay */
    .aar-overlay::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.08) 2px,
        rgba(0, 0, 0, 0.08) 4px
      );
      pointer-events: none;
      z-index: 201;
    }

    /* --- Result banner --- */
    .aar-result-banner {
      margin-top: 40px;
      font-size: 48px;
      font-weight: bold;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      user-select: none;
      animation: aar-banner-appear 0.6s ease-out;
    }

    @keyframes aar-banner-appear {
      from {
        opacity: 0;
        transform: scale(0.85);
        filter: blur(8px);
      }
      to {
        opacity: 1;
        transform: scale(1);
        filter: blur(0);
      }
    }

    .aar-mission-label {
      margin-top: 8px;
      font-size: 14px;
      color: rgba(200, 210, 210, 0.6);
      letter-spacing: 0.1em;
      user-select: none;
    }

    /* --- Stats grid --- */
    .aar-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      width: 100%;
      max-width: 800px;
      margin-top: 32px;
    }

    .aar-stat-card {
      background: rgba(30, 35, 35, 0.7);
      border: 1px solid rgba(128, 140, 140, 0.15);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .aar-stat-label {
      font-size: 10px;
      color: rgba(200, 210, 210, 0.5);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      user-select: none;
    }

    .aar-stat-value {
      font-size: 22px;
      font-weight: bold;
      letter-spacing: 0.05em;
    }

    /* --- Player table --- */
    .aar-table-container {
      width: 100%;
      max-width: 960px;
      margin-top: 32px;
      overflow-x: auto;
    }

    .aar-table-title {
      font-size: 13px;
      color: rgba(200, 210, 210, 0.5);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 8px;
      user-select: none;
    }

    .aar-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .aar-table th {
      text-align: left;
      padding: 8px 10px;
      color: rgba(200, 210, 210, 0.6);
      font-weight: normal;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(128, 140, 140, 0.2);
      white-space: nowrap;
      user-select: none;
    }

    .aar-table th.aar-col-right {
      text-align: right;
    }

    .aar-table td {
      padding: 8px 10px;
      color: rgba(200, 210, 210, 0.85);
      border-bottom: 1px solid rgba(128, 140, 140, 0.08);
      white-space: nowrap;
    }

    .aar-table td.aar-col-right {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .aar-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    .aar-sp-highlight {
      font-weight: bold;
    }

    /* --- Influence bar --- */
    .aar-influence-section {
      width: 100%;
      max-width: 800px;
      margin-top: 32px;
    }

    .aar-influence-title {
      font-size: 13px;
      color: rgba(200, 210, 210, 0.5);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 12px;
      user-select: none;
    }

    .aar-influence-bar-wrapper {
      position: relative;
      height: 28px;
      background: rgba(30, 35, 35, 0.7);
      border: 1px solid rgba(128, 140, 140, 0.2);
      overflow: hidden;
    }

    .aar-influence-bar-before {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      transition: width 0.8s ease-out;
    }

    .aar-influence-bar-after {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      transition: width 1.2s ease-out 0.4s;
      border-right: 2px solid #ffffff;
    }

    .aar-influence-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
      font-size: 11px;
      color: rgba(200, 210, 210, 0.5);
      user-select: none;
    }

    .aar-influence-change {
      text-align: center;
      margin-top: 4px;
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 0.06em;
    }

    /* --- Continue button --- */
    .aar-continue-btn {
      margin-top: 36px;
      padding: 12px 48px;
      background: rgba(128, 140, 140, 0.1);
      border: 1px solid rgba(128, 140, 140, 0.3);
      color: rgba(200, 210, 210, 0.85);
      font-family: 'Courier New', Courier, monospace;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
    }

    .aar-continue-btn:hover {
      background: rgba(128, 140, 140, 0.2);
      border-color: rgba(200, 210, 210, 0.5);
      box-shadow: 0 0 12px rgba(200, 210, 210, 0.1);
    }

    .aar-continue-btn:active {
      background: rgba(128, 140, 140, 0.3);
    }

    /* --- Divider line --- */
    .aar-divider {
      width: 100%;
      max-width: 800px;
      height: 1px;
      background: rgba(128, 140, 140, 0.15);
      margin-top: 24px;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// AARScreen
// ---------------------------------------------------------------------------

export class AARScreen {
  private overlayEl: HTMLDivElement | null = null;
  private acknowledgeCb: AcknowledgeCallback | null = null;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Displays the After Action Report overlay with full mission results.
   *
   * @param data - The AAR payload from the server containing all results.
   */
  show(data: AARPayload): void {
    // Clean up any existing overlay first
    this.hide();
    injectStyles();

    const colors = RESULT_COLORS[data.result];

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'aar-overlay';
    this.overlayEl.style.background = `linear-gradient(180deg, ${colors.bg} 0%, #0a0a0a 40%)`;

    // --- Result banner ---
    const banner = document.createElement('div');
    banner.className = 'aar-result-banner';
    banner.textContent = data.result.toUpperCase();
    banner.style.color = colors.primary;
    banner.style.textShadow = `0 0 24px ${colors.glow}, 0 0 48px ${colors.glow}`;
    this.overlayEl.appendChild(banner);

    // --- Mission type / difficulty label ---
    const missionLabel = document.createElement('div');
    missionLabel.className = 'aar-mission-label';
    const typeLabel = MISSION_TYPE_LABELS[data.missionType] ?? data.missionType.toUpperCase();
    const diffLabel = DIFFICULTY_LABELS[data.difficulty] ?? data.difficulty.toUpperCase();
    missionLabel.innerHTML =
      `MISSION: ${typeLabel} // ` +
      `<span style="color: ${DIFFICULTY_COLORS[data.difficulty]}">${diffLabel}</span>` +
      ` // ID: ${data.missionId.substring(0, 8).toUpperCase()}`;
    this.overlayEl.appendChild(missionLabel);

    // --- Stats grid ---
    this._buildStatsGrid(data, colors.primary);

    // --- Divider ---
    this._addDivider();

    // --- Player table ---
    this._buildPlayerTable(data.playerResults, colors.primary);

    // --- Divider ---
    this._addDivider();

    // --- Influence bar ---
    this._buildInfluenceBar(data, colors.primary);

    // --- Continue button ---
    const continueBtn = document.createElement('button');
    continueBtn.className = 'aar-continue-btn';
    continueBtn.textContent = 'CONTINUE';
    continueBtn.style.borderColor = colors.primary;
    continueBtn.style.color = colors.primary;
    continueBtn.addEventListener('click', () => {
      if (this.acknowledgeCb) {
        this.acknowledgeCb();
      }
    });
    this.overlayEl.appendChild(continueBtn);

    document.body.appendChild(this.overlayEl);
  }

  /**
   * Registers a callback invoked when the player clicks the "Continue"
   * button to acknowledge the AAR and return to the lobby or campaign map.
   */
  onAcknowledge(callback: AcknowledgeCallback): void {
    this.acknowledgeCb = callback;
  }

  /**
   * Removes the AAR overlay from the DOM and cleans up references.
   */
  hide(): void {
    if (this.overlayEl && this.overlayEl.parentElement) {
      this.overlayEl.parentElement.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
  }

  // -------------------------------------------------------------------------
  // Private — Stats grid
  // -------------------------------------------------------------------------

  /**
   * Builds the summary stats grid: duration, enemies destroyed, friendly
   * casualties, player count.
   */
  private _buildStatsGrid(data: AARPayload, accentColor: string): void {
    if (!this.overlayEl) return;

    const grid = document.createElement('div');
    grid.className = 'aar-stats-grid';

    const durationMin = Math.floor(data.durationSec / 60);
    const durationSec = data.durationSec % 60;
    const durationStr = `${durationMin}m ${String(durationSec).padStart(2, '0')}s`;

    const stats: Array<{ label: string; value: string; color?: string }> = [
      { label: 'Duration', value: durationStr },
      { label: 'Enemies Destroyed', value: String(data.totalEnemiesDestroyed), color: '#00ff41' },
      { label: 'Friendly Casualties', value: String(data.totalFriendlyCasualties), color: data.totalFriendlyCasualties === 0 ? '#00ff41' : '#ff4136' },
      { label: 'Players', value: String(data.playerResults.length) },
    ];

    for (const stat of stats) {
      const card = document.createElement('div');
      card.className = 'aar-stat-card';

      const label = document.createElement('div');
      label.className = 'aar-stat-label';
      label.textContent = stat.label;
      card.appendChild(label);

      const value = document.createElement('div');
      value.className = 'aar-stat-value';
      value.textContent = stat.value;
      value.style.color = stat.color ?? accentColor;
      card.appendChild(value);

      grid.appendChild(card);
    }

    this.overlayEl.appendChild(grid);
  }

  // -------------------------------------------------------------------------
  // Private — Player table
  // -------------------------------------------------------------------------

  /**
   * Builds the per-player breakdown table showing units, kills, and SP.
   */
  private _buildPlayerTable(
    players: AARPlayerResult[],
    accentColor: string,
  ): void {
    if (!this.overlayEl) return;

    const container = document.createElement('div');
    container.className = 'aar-table-container';

    const title = document.createElement('div');
    title.className = 'aar-table-title';
    title.textContent = '// PLAYER BREAKDOWN';
    container.appendChild(title);

    const table = document.createElement('table');
    table.className = 'aar-table';

    // --- Header row ---
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = [
      { text: 'Name', right: false },
      { text: 'Battalion', right: false },
      { text: 'Deployed', right: true },
      { text: 'Lost', right: true },
      { text: 'Kills', right: true },
      { text: 'Base SP', right: true },
      { text: '0-KIA', right: true },
      { text: 'Obj', right: true },
      { text: 'Speed', right: true },
      { text: 'Total SP', right: true },
    ];
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h.text;
      if (h.right) th.className = 'aar-col-right';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // --- Body rows ---
    const tbody = document.createElement('tbody');
    for (const p of players) {
      const row = document.createElement('tr');

      const cells: Array<{ text: string; right: boolean; highlight?: boolean; color?: string }> = [
        { text: p.playerName, right: false },
        { text: p.battalionName, right: false },
        { text: String(p.unitsDeployed), right: true },
        { text: String(p.unitsDestroyed), right: true, color: p.unitsDestroyed === 0 ? '#00ff41' : '#ff4136' },
        { text: String(p.killsScored), right: true },
        { text: String(p.spBase), right: true },
        { text: p.spBonusZeroKIA > 0 ? `+${p.spBonusZeroKIA}` : '-', right: true, color: p.spBonusZeroKIA > 0 ? '#00ff41' : undefined },
        { text: p.spBonusSecondary > 0 ? `+${p.spBonusSecondary}` : '-', right: true, color: p.spBonusSecondary > 0 ? '#ffdc00' : undefined },
        { text: p.spBonusSpeed > 0 ? `+${p.spBonusSpeed}` : '-', right: true, color: p.spBonusSpeed > 0 ? '#ffdc00' : undefined },
        { text: String(p.spTotal), right: true, highlight: true },
      ];

      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c.text;
        if (c.right) td.className = 'aar-col-right';
        if (c.highlight) {
          td.classList.add('aar-sp-highlight');
          td.style.color = accentColor;
        }
        if (c.color) {
          td.style.color = c.color;
        }
        row.appendChild(td);
      }

      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    container.appendChild(table);
    this.overlayEl.appendChild(container);
  }

  // -------------------------------------------------------------------------
  // Private — Influence bar
  // -------------------------------------------------------------------------

  /**
   * Builds the planet influence before/after comparison bar.
   * The bar runs from 0% (Secure) to 100% (Fallen). Lower is better
   * for the Terran Federation.
   */
  private _buildInfluenceBar(data: AARPayload, accentColor: string): void {
    if (!this.overlayEl) return;

    const section = document.createElement('div');
    section.className = 'aar-influence-section';

    const title = document.createElement('div');
    title.className = 'aar-influence-title';
    title.textContent = '// PLANET INFLUENCE';
    section.appendChild(title);

    // Bar wrapper
    const barWrapper = document.createElement('div');
    barWrapper.className = 'aar-influence-bar-wrapper';

    // "Before" bar — shown as a muted red fill
    const beforeBar = document.createElement('div');
    beforeBar.className = 'aar-influence-bar-before';
    const beforePct = Math.max(0, Math.min(100, data.influenceBefore));
    beforeBar.style.width = `${beforePct}%`;
    beforeBar.style.background = 'rgba(255, 65, 54, 0.25)';
    barWrapper.appendChild(beforeBar);

    // "After" bar — shown as a brighter fill
    const afterBar = document.createElement('div');
    afterBar.className = 'aar-influence-bar-after';
    const afterPct = Math.max(0, Math.min(100, data.influenceAfter));
    afterBar.style.width = '0%'; // animate in
    const influenceDecreased = data.influenceAfter < data.influenceBefore;
    afterBar.style.background = influenceDecreased
      ? 'rgba(0, 255, 65, 0.3)'
      : 'rgba(255, 65, 54, 0.4)';
    barWrapper.appendChild(afterBar);

    section.appendChild(barWrapper);

    // Labels
    const labels = document.createElement('div');
    labels.className = 'aar-influence-labels';

    const labelSecure = document.createElement('span');
    labelSecure.textContent = 'SECURE 0%';
    labels.appendChild(labelSecure);

    const labelFallen = document.createElement('span');
    labelFallen.textContent = '100% FALLEN';
    labels.appendChild(labelFallen);

    section.appendChild(labels);

    // Influence change summary
    const change = data.influenceAfter - data.influenceBefore;
    const changeEl = document.createElement('div');
    changeEl.className = 'aar-influence-change';

    const sign = change > 0 ? '+' : '';
    const changeText = `${beforePct.toFixed(1)}% → ${afterPct.toFixed(1)}% (${sign}${change.toFixed(1)}%)`;

    changeEl.textContent = changeText;
    if (change < 0) {
      changeEl.style.color = '#00ff41';
    } else if (change > 0) {
      changeEl.style.color = '#ff4136';
    } else {
      changeEl.style.color = accentColor;
    }

    section.appendChild(changeEl);
    this.overlayEl.appendChild(section);

    // Trigger the "after" bar animation on next frame
    requestAnimationFrame(() => {
      afterBar.style.width = `${afterPct}%`;
    });
  }

  // -------------------------------------------------------------------------
  // Private — Helpers
  // -------------------------------------------------------------------------

  /**
   * Adds a visual divider line to the overlay.
   */
  private _addDivider(): void {
    if (!this.overlayEl) return;
    const div = document.createElement('div');
    div.className = 'aar-divider';
    this.overlayEl.appendChild(div);
  }
}
