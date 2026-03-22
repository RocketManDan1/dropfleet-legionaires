// ============================================================================
// LOBBY SCREEN — mission browser, join, and create interface
// Milestone: 4 ("Multiplayer")
// Source: LOBBY_AND_MATCHMAKING.md, UI_FLOW.md
//
// Full-screen DOM overlay that shows available missions on the current
// planet, lets the player join existing missions or create new ones.
// Each mission row displays planet name, mission type, difficulty badge,
// player count, current phase, and a Join button. The "Create Mission"
// panel includes planet selection and difficulty choice. All styled in
// DRONECOM C2 aesthetic (dark bg, green/amber text, monospace font).
// ============================================================================

import type {
  MissionType,
  DifficultyTier,
  MissionPhaseWire,
} from '@legionaires/shared';
import {
  MAX_PLAYERS_PER_MISSION,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single mission entry in the lobby list. */
export interface MissionListEntry {
  missionId: string;
  planetName: string;
  missionType: MissionType;
  difficulty: DifficultyTier;
  playerCount: number;
  maxPlayers: number;
  phase: MissionPhaseWire;
}

/** Callback fired when the player clicks "Join" on an existing mission. */
export type JoinCallback = (missionId: string) => void;

/** Callback fired when the player creates a new mission. */
export type CreateCallback = (planetId: string, difficulty: DifficultyTier) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  defend: 'DEFENSE',
  seize: 'SEIZURE',
  raid: 'RAID',
  patrol: 'PATROL',
  rescue: 'RESCUE',
  breakthrough: 'BREAKTHROUGH',
  evacuation: 'EVACUATION',
  hive_clear: 'HIVE CLEAR',
  fortification_assault: 'FORT. ASSAULT',
  logistics: 'LOGISTICS',
};

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

const PHASE_LABELS: Record<MissionPhaseWire, string> = {
  briefing: 'BRIEFING',
  deployment: 'DEPLOYING',
  live: 'IN PROGRESS',
  extraction: 'EXTRACTING',
  ended: 'ENDED',
};

const PHASE_COLORS: Record<MissionPhaseWire, string> = {
  briefing: '#4080ff',
  deployment: '#ffdc00',
  live: '#00ff41',
  extraction: '#ff8c00',
  ended: '#888888',
};

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

const STYLE_ID = 'lobby-screen-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .lobby-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #0a0a0a;
      z-index: 200;
      font-family: 'Courier New', Courier, monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow-y: auto;
      padding: 0 20px 40px 20px;
    }

    /* Scan-line overlay */
    .lobby-overlay::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.06) 2px,
        rgba(0, 0, 0, 0.06) 4px
      );
      pointer-events: none;
      z-index: 201;
    }

    /* --- Header --- */
    .lobby-header {
      margin-top: 32px;
      font-size: 28px;
      font-weight: bold;
      color: #00ff41;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      user-select: none;
      text-shadow: 0 0 16px rgba(0, 255, 65, 0.3);
    }

    .lobby-subheader {
      margin-top: 6px;
      font-size: 12px;
      color: rgba(200, 210, 210, 0.5);
      letter-spacing: 0.1em;
      user-select: none;
    }

    /* --- Mission list container --- */
    .lobby-list-container {
      width: 100%;
      max-width: 900px;
      margin-top: 28px;
    }

    .lobby-list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .lobby-list-title {
      font-size: 13px;
      color: rgba(200, 210, 210, 0.5);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      user-select: none;
    }

    .lobby-mission-count {
      font-size: 11px;
      color: rgba(0, 255, 65, 0.6);
      letter-spacing: 0.06em;
      user-select: none;
    }

    /* --- Mission list table --- */
    .lobby-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .lobby-table th {
      text-align: left;
      padding: 10px 12px;
      color: rgba(200, 210, 210, 0.5);
      font-weight: normal;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(0, 255, 65, 0.15);
      user-select: none;
      white-space: nowrap;
    }

    .lobby-table th.lobby-col-center {
      text-align: center;
    }

    .lobby-table td {
      padding: 10px 12px;
      color: rgba(200, 210, 210, 0.85);
      border-bottom: 1px solid rgba(128, 140, 140, 0.08);
      vertical-align: middle;
    }

    .lobby-table td.lobby-col-center {
      text-align: center;
    }

    .lobby-table tr:hover td {
      background: rgba(0, 255, 65, 0.03);
    }

    .lobby-table tr.lobby-row-full td {
      opacity: 0.4;
    }

    /* --- Badges --- */
    .lobby-badge {
      display: inline-block;
      padding: 2px 7px;
      font-size: 10px;
      letter-spacing: 0.06em;
      border-radius: 2px;
      font-weight: bold;
      user-select: none;
    }

    .lobby-difficulty-badge {
      border: 1px solid currentColor;
      background: transparent;
    }

    .lobby-phase-badge {
      background: rgba(128, 140, 140, 0.15);
      border: 1px solid rgba(128, 140, 140, 0.25);
    }

    /* --- Player count --- */
    .lobby-player-count {
      font-variant-numeric: tabular-nums;
    }

    .lobby-player-count-full {
      color: #ff4136;
    }

    .lobby-player-count-available {
      color: #00ff41;
    }

    /* --- Join button --- */
    .lobby-join-btn {
      padding: 5px 16px;
      background: rgba(0, 255, 65, 0.08);
      border: 1px solid rgba(0, 255, 65, 0.4);
      color: #00ff41;
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.15s, box-shadow 0.15s;
      white-space: nowrap;
    }

    .lobby-join-btn:hover {
      background: rgba(0, 255, 65, 0.18);
      box-shadow: 0 0 8px rgba(0, 255, 65, 0.2);
    }

    .lobby-join-btn:active {
      background: rgba(0, 255, 65, 0.28);
    }

    .lobby-join-btn:disabled {
      opacity: 0.25;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* --- Empty state --- */
    .lobby-empty {
      padding: 40px 20px;
      text-align: center;
      color: rgba(200, 210, 210, 0.35);
      font-size: 13px;
      letter-spacing: 0.06em;
      user-select: none;
    }

    /* --- Divider --- */
    .lobby-divider {
      width: 100%;
      max-width: 900px;
      height: 1px;
      background: rgba(128, 140, 140, 0.15);
      margin-top: 28px;
    }

    /* --- Create mission panel --- */
    .lobby-create-panel {
      width: 100%;
      max-width: 900px;
      margin-top: 28px;
    }

    .lobby-create-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }

    .lobby-create-title {
      font-size: 13px;
      color: rgba(200, 210, 210, 0.5);
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .lobby-create-toggle {
      font-size: 11px;
      color: #00ff41;
      letter-spacing: 0.06em;
      padding: 4px 12px;
      border: 1px solid rgba(0, 255, 65, 0.3);
      background: transparent;
      font-family: 'Courier New', Courier, monospace;
      cursor: pointer;
      transition: background 0.15s;
    }

    .lobby-create-toggle:hover {
      background: rgba(0, 255, 65, 0.08);
    }

    .lobby-create-form {
      margin-top: 16px;
      padding: 20px;
      background: rgba(20, 24, 24, 0.8);
      border: 1px solid rgba(0, 255, 65, 0.15);
      display: none;
    }

    .lobby-create-form.lobby-create-form-visible {
      display: block;
    }

    .lobby-form-row {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
    }

    .lobby-form-label {
      font-size: 11px;
      color: rgba(200, 210, 210, 0.6);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      min-width: 100px;
      user-select: none;
    }

    /* --- Planet select dropdown --- */
    .lobby-planet-select {
      padding: 6px 12px;
      background: rgba(10, 14, 14, 0.9);
      border: 1px solid rgba(0, 255, 65, 0.3);
      color: #c0d8c0;
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      letter-spacing: 0.04em;
      min-width: 220px;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
    }

    .lobby-planet-select:focus {
      outline: none;
      border-color: #00ff41;
      box-shadow: 0 0 6px rgba(0, 255, 65, 0.2);
    }

    /* --- Difficulty radio group --- */
    .lobby-difficulty-group {
      display: flex;
      gap: 0;
    }

    .lobby-diff-option {
      position: relative;
    }

    .lobby-diff-option input[type="radio"] {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
    }

    .lobby-diff-label {
      display: block;
      padding: 6px 16px;
      background: rgba(10, 14, 14, 0.9);
      border: 1px solid rgba(128, 140, 140, 0.25);
      color: rgba(200, 210, 210, 0.6);
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      user-select: none;
    }

    .lobby-diff-option:first-child .lobby-diff-label {
      border-radius: 2px 0 0 2px;
    }

    .lobby-diff-option:last-child .lobby-diff-label {
      border-radius: 0 2px 2px 0;
    }

    .lobby-diff-option input[type="radio"]:checked + .lobby-diff-label {
      border-color: currentColor;
      background: rgba(128, 140, 140, 0.15);
    }

    /* --- Create confirm button --- */
    .lobby-create-btn {
      padding: 10px 32px;
      background: rgba(0, 255, 65, 0.08);
      border: 1px solid #00ff41;
      color: #00ff41;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.2s, box-shadow 0.2s;
      margin-top: 8px;
    }

    .lobby-create-btn:hover {
      background: rgba(0, 255, 65, 0.2);
      box-shadow: 0 0 12px rgba(0, 255, 65, 0.25);
    }

    .lobby-create-btn:active {
      background: rgba(0, 255, 65, 0.3);
    }

    .lobby-create-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* --- Refresh hint --- */
    .lobby-refresh-hint {
      margin-top: 24px;
      font-size: 10px;
      color: rgba(200, 210, 210, 0.3);
      letter-spacing: 0.06em;
      user-select: none;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// LobbyScreen
// ---------------------------------------------------------------------------

export class LobbyScreen {
  // DOM elements
  private overlayEl: HTMLDivElement | null = null;
  private listBodyEl: HTMLTableSectionElement | null = null;
  private missionCountEl: HTMLSpanElement | null = null;
  private createFormEl: HTMLDivElement | null = null;
  private planetSelectEl: HTMLSelectElement | null = null;
  private emptyEl: HTMLDivElement | null = null;

  // State
  private missions: MissionListEntry[] = [];
  private selectedDifficulty: DifficultyTier = 'easy';
  private formVisible = false;

  // Callbacks
  private joinCb: JoinCallback | null = null;
  private createCb: CreateCallback | null = null;

  // Planet list (populated from mission data or can be set externally)
  private planetOptions: Array<{ id: string; name: string }> = [];

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Displays the lobby screen with the given list of available missions.
   *
   * @param missions - Array of mission list entries from the server.
   * @param planets - Optional list of planets for the "Create Mission" dropdown.
   */
  show(
    missions: MissionListEntry[],
    planets: Array<{ id: string; name: string }> = [],
  ): void {
    this.hide();
    injectStyles();

    this.missions = [...missions];

    // Derive planet list from missions if not provided
    if (planets.length > 0) {
      this.planetOptions = [...planets];
    } else {
      this.planetOptions = this._derivePlanetsFromMissions(missions);
    }

    this._buildDOM();
    this._renderMissionRows();
  }

  /**
   * Registers a callback invoked when the player clicks "Join" on a mission.
   */
  onJoin(callback: JoinCallback): void {
    this.joinCb = callback;
  }

  /**
   * Registers a callback invoked when the player creates a new mission.
   */
  onCreate(callback: CreateCallback): void {
    this.createCb = callback;
  }

  /**
   * Refreshes the mission list with updated data from the server.
   * Preserves the current scroll position and form state.
   */
  updateMissionList(missions: MissionListEntry[]): void {
    this.missions = [...missions];

    // Update planet options with any new planets
    const newPlanets = this._derivePlanetsFromMissions(missions);
    for (const np of newPlanets) {
      if (!this.planetOptions.some((p) => p.id === np.id)) {
        this.planetOptions.push(np);
      }
    }

    this._renderMissionRows();
    this._updatePlanetDropdown();

    if (this.missionCountEl) {
      this.missionCountEl.textContent = `${missions.length} ACTIVE`;
    }
  }

  /**
   * Removes the lobby overlay from the DOM and cleans up references.
   */
  hide(): void {
    if (this.overlayEl && this.overlayEl.parentElement) {
      this.overlayEl.parentElement.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
    this.listBodyEl = null;
    this.missionCountEl = null;
    this.createFormEl = null;
    this.planetSelectEl = null;
    this.emptyEl = null;
  }

  // -------------------------------------------------------------------------
  // Private — DOM construction
  // -------------------------------------------------------------------------

  /**
   * Builds the entire lobby DOM structure: header, mission table,
   * create mission panel, and footer.
   */
  private _buildDOM(): void {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'lobby-overlay';

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'lobby-header';
    header.textContent = 'MISSION CONTROL';
    this.overlayEl.appendChild(header);

    const subheader = document.createElement('div');
    subheader.className = 'lobby-subheader';
    subheader.textContent = 'SELECT AN ACTIVE MISSION OR CREATE A NEW OPERATION';
    this.overlayEl.appendChild(subheader);

    // --- Mission list container ---
    const listContainer = document.createElement('div');
    listContainer.className = 'lobby-list-container';

    // List header bar
    const listHeader = document.createElement('div');
    listHeader.className = 'lobby-list-header';

    const listTitle = document.createElement('span');
    listTitle.className = 'lobby-list-title';
    listTitle.textContent = '// ACTIVE MISSIONS';
    listHeader.appendChild(listTitle);

    this.missionCountEl = document.createElement('span');
    this.missionCountEl.className = 'lobby-mission-count';
    this.missionCountEl.textContent = `${this.missions.length} ACTIVE`;
    listHeader.appendChild(this.missionCountEl);

    listContainer.appendChild(listHeader);

    // Mission table
    const table = document.createElement('table');
    table.className = 'lobby-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = [
      { text: 'Planet', center: false },
      { text: 'Mission Type', center: false },
      { text: 'Difficulty', center: true },
      { text: 'Players', center: true },
      { text: 'Phase', center: true },
      { text: '', center: true },
    ];
    for (const h of headers) {
      const th = document.createElement('th');
      th.textContent = h.text;
      if (h.center) th.className = 'lobby-col-center';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    this.listBodyEl = document.createElement('tbody');
    table.appendChild(this.listBodyEl);

    listContainer.appendChild(table);

    // Empty state message
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'lobby-empty';
    this.emptyEl.textContent = 'NO ACTIVE MISSIONS // CREATE ONE BELOW';
    this.emptyEl.style.display = 'none';
    listContainer.appendChild(this.emptyEl);

    this.overlayEl.appendChild(listContainer);

    // --- Divider ---
    const divider = document.createElement('div');
    divider.className = 'lobby-divider';
    this.overlayEl.appendChild(divider);

    // --- Create mission panel ---
    this._buildCreatePanel();

    // --- Refresh hint ---
    const hint = document.createElement('div');
    hint.className = 'lobby-refresh-hint';
    hint.textContent = 'MISSION LIST UPDATES AUTOMATICALLY';
    this.overlayEl.appendChild(hint);

    document.body.appendChild(this.overlayEl);
  }

  /**
   * Builds the "Create Mission" collapsible panel with planet dropdown,
   * difficulty radio buttons, and confirm button.
   */
  private _buildCreatePanel(): void {
    if (!this.overlayEl) return;

    const panel = document.createElement('div');
    panel.className = 'lobby-create-panel';

    // Header row (clickable toggle)
    const headerRow = document.createElement('div');
    headerRow.className = 'lobby-create-header';

    const title = document.createElement('span');
    title.className = 'lobby-create-title';
    title.textContent = '// NEW OPERATION';
    headerRow.appendChild(title);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'lobby-create-toggle';
    toggleBtn.textContent = '+ CREATE MISSION';
    headerRow.appendChild(toggleBtn);

    panel.appendChild(headerRow);

    // Form (hidden by default)
    this.createFormEl = document.createElement('div');
    this.createFormEl.className = 'lobby-create-form';

    // --- Planet selection row ---
    const planetRow = document.createElement('div');
    planetRow.className = 'lobby-form-row';

    const planetLabel = document.createElement('span');
    planetLabel.className = 'lobby-form-label';
    planetLabel.textContent = 'PLANET';
    planetRow.appendChild(planetLabel);

    this.planetSelectEl = document.createElement('select');
    this.planetSelectEl.className = 'lobby-planet-select';
    this._updatePlanetDropdown();
    planetRow.appendChild(this.planetSelectEl);

    this.createFormEl.appendChild(planetRow);

    // --- Difficulty selection row ---
    const diffRow = document.createElement('div');
    diffRow.className = 'lobby-form-row';

    const diffLabel = document.createElement('span');
    diffLabel.className = 'lobby-form-label';
    diffLabel.textContent = 'DIFFICULTY';
    diffRow.appendChild(diffLabel);

    const diffGroup = document.createElement('div');
    diffGroup.className = 'lobby-difficulty-group';

    const difficulties: DifficultyTier[] = ['easy', 'medium', 'hard'];
    for (const diff of difficulties) {
      const option = document.createElement('div');
      option.className = 'lobby-diff-option';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'lobby-difficulty';
      input.value = diff;
      input.id = `lobby-diff-${diff}`;
      input.checked = diff === this.selectedDifficulty;
      input.addEventListener('change', () => {
        this.selectedDifficulty = diff;
      });
      option.appendChild(input);

      const label = document.createElement('label');
      label.className = 'lobby-diff-label';
      label.htmlFor = `lobby-diff-${diff}`;
      label.textContent = DIFFICULTY_LABELS[diff];
      label.style.color = DIFFICULTY_COLORS[diff];
      option.appendChild(label);

      diffGroup.appendChild(option);
    }

    diffRow.appendChild(diffGroup);
    this.createFormEl.appendChild(diffRow);

    // --- Confirm button row ---
    const confirmRow = document.createElement('div');
    confirmRow.className = 'lobby-form-row';

    const spacer = document.createElement('span');
    spacer.className = 'lobby-form-label';
    confirmRow.appendChild(spacer);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'lobby-create-btn';
    confirmBtn.textContent = 'LAUNCH OPERATION';
    confirmBtn.addEventListener('click', () => {
      if (!this.createCb || !this.planetSelectEl) return;
      const planetId = this.planetSelectEl.value;
      if (!planetId) return;
      this.createCb(planetId, this.selectedDifficulty);

      // Disable button briefly to prevent double-clicks
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'LAUNCHING...';
      setTimeout(() => {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'LAUNCH OPERATION';
      }, 3000);
    });
    confirmRow.appendChild(confirmBtn);

    this.createFormEl.appendChild(confirmRow);
    panel.appendChild(this.createFormEl);

    // Toggle behavior
    toggleBtn.addEventListener('click', () => {
      this.formVisible = !this.formVisible;
      if (this.createFormEl) {
        if (this.formVisible) {
          this.createFormEl.classList.add('lobby-create-form-visible');
          toggleBtn.textContent = '- HIDE';
        } else {
          this.createFormEl.classList.remove('lobby-create-form-visible');
          toggleBtn.textContent = '+ CREATE MISSION';
        }
      }
    });

    this.overlayEl.appendChild(panel);
  }

  // -------------------------------------------------------------------------
  // Private — Mission list rendering
  // -------------------------------------------------------------------------

  /**
   * Re-renders the mission table body from the current missions array.
   */
  private _renderMissionRows(): void {
    if (!this.listBodyEl || !this.emptyEl) return;

    // Clear existing rows
    this.listBodyEl.innerHTML = '';

    if (this.missions.length === 0) {
      this.emptyEl.style.display = 'block';
      return;
    }

    this.emptyEl.style.display = 'none';

    // Sort: joinable first (not full, not ended), then by player count desc
    const sorted = [...this.missions].sort((a, b) => {
      const aJoinable = a.playerCount < a.maxPlayers && a.phase !== 'ended' ? 0 : 1;
      const bJoinable = b.playerCount < b.maxPlayers && b.phase !== 'ended' ? 0 : 1;
      if (aJoinable !== bJoinable) return aJoinable - bJoinable;
      return b.playerCount - a.playerCount;
    });

    for (const mission of sorted) {
      const row = this._createMissionRow(mission);
      this.listBodyEl.appendChild(row);
    }
  }

  /**
   * Creates a single table row for a mission entry.
   */
  private _createMissionRow(mission: MissionListEntry): HTMLTableRowElement {
    const isFull = mission.playerCount >= mission.maxPlayers;
    const isEnded = mission.phase === 'ended';
    const canJoin = !isFull && !isEnded;

    const row = document.createElement('tr');
    if (isFull || isEnded) {
      row.className = 'lobby-row-full';
    }

    // Planet name
    const planetTd = document.createElement('td');
    planetTd.textContent = mission.planetName;
    row.appendChild(planetTd);

    // Mission type
    const typeTd = document.createElement('td');
    typeTd.textContent = MISSION_TYPE_LABELS[mission.missionType] ?? mission.missionType.toUpperCase();
    row.appendChild(typeTd);

    // Difficulty badge
    const diffTd = document.createElement('td');
    diffTd.className = 'lobby-col-center';
    const diffBadge = document.createElement('span');
    diffBadge.className = 'lobby-badge lobby-difficulty-badge';
    diffBadge.textContent = DIFFICULTY_LABELS[mission.difficulty];
    diffBadge.style.color = DIFFICULTY_COLORS[mission.difficulty];
    diffTd.appendChild(diffBadge);
    row.appendChild(diffTd);

    // Player count
    const playerTd = document.createElement('td');
    playerTd.className = 'lobby-col-center';
    const playerSpan = document.createElement('span');
    playerSpan.className = `lobby-player-count ${isFull ? 'lobby-player-count-full' : 'lobby-player-count-available'}`;
    playerSpan.textContent = `${mission.playerCount}/${mission.maxPlayers}`;
    playerTd.appendChild(playerSpan);
    row.appendChild(playerTd);

    // Phase badge
    const phaseTd = document.createElement('td');
    phaseTd.className = 'lobby-col-center';
    const phaseBadge = document.createElement('span');
    phaseBadge.className = 'lobby-badge lobby-phase-badge';
    phaseBadge.textContent = PHASE_LABELS[mission.phase] ?? mission.phase.toUpperCase();
    phaseBadge.style.color = PHASE_COLORS[mission.phase] ?? '#888888';
    phaseBadge.style.borderColor = PHASE_COLORS[mission.phase] ?? '#888888';
    phaseTd.appendChild(phaseBadge);
    row.appendChild(phaseTd);

    // Join button
    const actionTd = document.createElement('td');
    actionTd.className = 'lobby-col-center';
    const joinBtn = document.createElement('button');
    joinBtn.className = 'lobby-join-btn';
    joinBtn.textContent = canJoin ? 'JOIN' : (isEnded ? 'ENDED' : 'FULL');
    joinBtn.disabled = !canJoin;

    if (canJoin) {
      joinBtn.addEventListener('click', () => {
        if (this.joinCb) {
          this.joinCb(mission.missionId);
        }
        // Visual feedback
        joinBtn.disabled = true;
        joinBtn.textContent = 'JOINING...';
        setTimeout(() => {
          joinBtn.disabled = false;
          joinBtn.textContent = 'JOIN';
        }, 3000);
      });
    }

    actionTd.appendChild(joinBtn);
    row.appendChild(actionTd);

    return row;
  }

  // -------------------------------------------------------------------------
  // Private — Planet dropdown
  // -------------------------------------------------------------------------

  /**
   * Populates or refreshes the planet selection dropdown in the create form.
   */
  private _updatePlanetDropdown(): void {
    if (!this.planetSelectEl) return;

    const currentValue = this.planetSelectEl.value;
    this.planetSelectEl.innerHTML = '';

    // Placeholder option
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- SELECT PLANET --';
    placeholder.disabled = true;
    placeholder.selected = !currentValue;
    this.planetSelectEl.appendChild(placeholder);

    for (const planet of this.planetOptions) {
      const option = document.createElement('option');
      option.value = planet.id;
      option.textContent = planet.name.toUpperCase();
      if (planet.id === currentValue) {
        option.selected = true;
      }
      this.planetSelectEl.appendChild(option);
    }
  }

  /**
   * Extracts a unique planet list from mission entries. Uses the planetName
   * as both the display name and ID (the server will resolve the real ID).
   * This is a fallback when the caller does not provide an explicit planet list.
   */
  private _derivePlanetsFromMissions(
    missions: MissionListEntry[],
  ): Array<{ id: string; name: string }> {
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string }> = [];

    for (const m of missions) {
      const key = m.planetName.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          id: key.replace(/\s+/g, '-'),
          name: m.planetName,
        });
      }
    }

    return result;
  }
}
