// ============================================================================
// ORDER OF BATTLE SCREEN — Battalion management, unit roster, upgrades
// Milestone 5
// Source: BATTALION_CREATION.md, FORCE_ROSTERS.md, UI_FLOW.md
// ============================================================================

import type {
  BattalionRecord, UnitSlot, DifficultyTier,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnitTypeInfo {
  unitTypeId: string;
  name: string;
  unitClass: string;
  crewMax: number;
  pointValue: number;
}

export interface OOBCallbacks {
  onSelectBattalion: (battalionId: string) => void;
  onReplaceUnit: (battalionId: string, slotId: string) => void;
  onUpgradeUnit: (battalionId: string, slotId: string) => void;
  onDeployBattalion: (battalionId: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// OOBScreen
// ---------------------------------------------------------------------------

/**
 * Full-screen Order of Battle management screen.
 * Shows battalion list, unit roster with health status, and action buttons.
 */
export class OOBScreen {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private callbacks: OOBCallbacks | null = null;
  private unitTypeMap = new Map<string, UnitTypeInfo>();
  private selectedBattalionId: string | null = null;

  show(
    battalions: BattalionRecord[],
    unitTypes: UnitTypeInfo[],
    callbacks: OOBCallbacks,
  ): void {
    this.callbacks = callbacks;
    this.unitTypeMap.clear();
    for (const ut of unitTypes) this.unitTypeMap.set(ut.unitTypeId, ut);
    this.injectStyles();
    this.dispose();

    this.overlay = document.createElement('div');
    this.overlay.className = 'oob-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'oob-screen__header';
    header.innerHTML = `
      <span class="oob-screen__title">ORDER OF BATTLE</span>
      <button class="oob-screen__close">✕</button>
    `;
    header.querySelector('.oob-screen__close')!.addEventListener('click', () => {
      this.hide();
      this.callbacks?.onClose();
    });
    this.overlay.appendChild(header);

    // Layout: battalion list (left) + detail panel (right)
    const layout = document.createElement('div');
    layout.className = 'oob-screen__layout';

    // Battalion list
    const listPanel = document.createElement('div');
    listPanel.className = 'oob-screen__list';
    listPanel.innerHTML = '<div class="oob-screen__section-title">BATTALIONS</div>';

    for (const bn of battalions) {
      const row = document.createElement('div');
      row.className = 'oob-screen__bn-row';
      row.dataset.battalionId = bn.battalionId;

      const alive = bn.unitSlots.filter(s => s.status !== 'destroyed').length;
      const total = bn.unitSlots.length;
      const healthPct = total > 0 ? Math.round(alive / total * 100) : 0;
      const statusColor = bn.status === 'available' ? '#00ff41'
        : bn.status === 'in_transit' ? '#4080ff'
          : bn.status === 'in_mission' ? '#ffdc00' : '#ff4136';

      row.innerHTML = `
        <div class="oob-screen__bn-name">${bn.name}</div>
        <div class="oob-screen__bn-type">${bn.type.toUpperCase()}</div>
        <div class="oob-screen__bn-status" style="color:${statusColor}">${bn.status.toUpperCase().replace('_', ' ')}</div>
        <div class="oob-screen__bn-strength">${alive}/${total} (${healthPct}%)</div>
        <div class="oob-screen__bn-sp">${bn.supplyPoints} SP</div>
      `;

      row.addEventListener('click', () => {
        this.selectedBattalionId = bn.battalionId;
        this.callbacks?.onSelectBattalion(bn.battalionId);
        this.showBattalionDetail(bn);
        // Highlight selected
        listPanel.querySelectorAll('.oob-screen__bn-row').forEach(r =>
          r.classList.remove('oob-screen__bn-row--selected'));
        row.classList.add('oob-screen__bn-row--selected');
      });

      listPanel.appendChild(row);
    }

    layout.appendChild(listPanel);

    // Detail panel (empty until selection)
    const detail = document.createElement('div');
    detail.className = 'oob-screen__detail';
    detail.innerHTML = '<div class="oob-screen__detail-empty">Select a battalion</div>';
    layout.appendChild(detail);

    this.overlay.appendChild(layout);
    document.body.appendChild(this.overlay);

    // Auto-select first battalion
    if (battalions.length > 0) {
      this.selectedBattalionId = battalions[0].battalionId;
      this.showBattalionDetail(battalions[0]);
      const firstRow = listPanel.querySelector('.oob-screen__bn-row');
      firstRow?.classList.add('oob-screen__bn-row--selected');
    }
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  dispose(): void {
    this.hide();
  }

  updateBattalion(battalion: BattalionRecord): void {
    if (this.selectedBattalionId === battalion.battalionId) {
      this.showBattalionDetail(battalion);
    }
  }

  // --- Internal ---

  private showBattalionDetail(bn: BattalionRecord): void {
    const detail = this.overlay?.querySelector<HTMLDivElement>('.oob-screen__detail');
    if (!detail) return;

    let html = `
      <div class="oob-screen__detail-header">
        <span class="oob-screen__detail-name">${bn.name}</span>
        <span class="oob-screen__detail-type">${bn.type.toUpperCase()}</span>
        <span class="oob-screen__detail-sp">${bn.supplyPoints} SP</span>
      </div>
      <div class="oob-screen__detail-stats">
        <span>Missions: ${bn.missionsCompleted} (${bn.missionsWon} won)</span>
        <span>Origin: ${bn.sectorOrigin}</span>
      </div>
      <div class="oob-screen__section-title">UNIT ROSTER</div>
      <table class="oob-screen__roster">
        <thead>
          <tr>
            <th>UNIT</th>
            <th>CLASS</th>
            <th>CREW</th>
            <th>STATUS</th>
            <th>TIER</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const slot of bn.unitSlots) {
      const info = this.unitTypeMap.get(slot.unitTypeId);
      const name = info?.name ?? slot.unitTypeId;
      const cls = info?.unitClass ?? '?';
      const crewPct = slot.crewMax > 0 ? Math.round(slot.crewCurrent / slot.crewMax * 100) : 0;
      const crewColor = crewPct > 66 ? '#00ff41' : crewPct > 33 ? '#ffdc00' : '#ff4136';
      const statusColor = slot.status === 'active' ? '#00ff41'
        : slot.status === 'damaged' ? '#ffdc00'
          : slot.status === 'destroyed' ? '#ff4136' : '#888';

      const canReplace = slot.status === 'destroyed' || slot.status === 'combat_ineffective';
      const canUpgrade = slot.status === 'active' || slot.status === 'damaged';

      html += `
        <tr class="oob-screen__unit-row">
          <td class="oob-screen__unit-name">${name}</td>
          <td>${cls}</td>
          <td>
            <div class="oob-screen__crew-bar">
              <div style="width:${crewPct}%;background:${crewColor}"></div>
            </div>
            <span class="oob-screen__crew-text">${slot.crewCurrent}/${slot.crewMax}</span>
          </td>
          <td style="color:${statusColor}">${slot.status.toUpperCase()}</td>
          <td>${slot.upgradeTier > 0 ? '★'.repeat(slot.upgradeTier) : '—'}</td>
          <td>
            ${canReplace ? `<button class="oob-screen__action-btn" data-action="replace" data-slot="${slot.slotId}">REPLACE</button>` : ''}
            ${canUpgrade ? `<button class="oob-screen__action-btn" data-action="upgrade" data-slot="${slot.slotId}">UPGRADE</button>` : ''}
          </td>
        </tr>
      `;
    }

    html += '</tbody></table>';

    // Deploy button
    if (bn.status === 'available') {
      html += `<button class="oob-screen__deploy-btn">DEPLOY BATTALION</button>`;
    }

    detail.innerHTML = html;

    // Bind action buttons
    detail.querySelectorAll('.oob-screen__action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        const slotId = (btn as HTMLElement).dataset.slot!;
        if (action === 'replace') {
          this.callbacks?.onReplaceUnit(bn.battalionId, slotId);
        } else if (action === 'upgrade') {
          this.callbacks?.onUpgradeUnit(bn.battalionId, slotId);
        }
      });
    });

    // Deploy button
    const deployBtn = detail.querySelector('.oob-screen__deploy-btn');
    deployBtn?.addEventListener('click', () => {
      this.callbacks?.onDeployBattalion(bn.battalionId);
    });
  }

  // --- Styles ---

  private injectStyles(): void {
    if (this.styleEl) return;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      .oob-screen {
        position: fixed; inset: 0;
        background: #080810f0;
        font-family: 'Courier New', monospace;
        color: #c0c0c0;
        z-index: 30;
        display: flex;
        flex-direction: column;
      }
      .oob-screen__header {
        display: flex;
        align-items: center;
        padding: 12px 20px;
        border-bottom: 1px solid #2a2a3a;
      }
      .oob-screen__title {
        flex: 1;
        font-size: 16px;
        letter-spacing: 3px;
        color: #80ffd0;
      }
      .oob-screen__close {
        background: none; border: 1px solid #555; color: #aaa;
        cursor: pointer; font-size: 14px; padding: 2px 6px;
      }
      .oob-screen__layout {
        flex: 1;
        display: flex;
        overflow: hidden;
      }
      .oob-screen__list {
        width: 320px;
        border-right: 1px solid #2a2a3a;
        padding: 12px;
        overflow-y: auto;
      }
      .oob-screen__section-title {
        font-size: 10px;
        letter-spacing: 2px;
        color: #666;
        margin-bottom: 8px;
      }
      .oob-screen__bn-row {
        padding: 8px;
        border: 1px solid #1a1a2a;
        margin-bottom: 4px;
        cursor: pointer;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 11px;
      }
      .oob-screen__bn-row:hover { border-color: #333; }
      .oob-screen__bn-row--selected { border-color: #4080ff; background: #0a0a2a; }
      .oob-screen__bn-name { color: #80ffd0; font-weight: bold; width: 100%; }
      .oob-screen__bn-type { color: #888; }
      .oob-screen__bn-sp { color: #ffdc00; }
      .oob-screen__detail {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
      }
      .oob-screen__detail-empty { color: #555; text-align: center; margin-top: 40px; }
      .oob-screen__detail-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }
      .oob-screen__detail-name { font-size: 16px; color: #80ffd0; font-weight: bold; }
      .oob-screen__detail-type { color: #888; font-size: 11px; }
      .oob-screen__detail-sp { color: #ffdc00; font-size: 13px; margin-left: auto; }
      .oob-screen__detail-stats { font-size: 11px; color: #888; margin-bottom: 12px; display: flex; gap: 20px; }
      .oob-screen__roster {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .oob-screen__roster th {
        text-align: left;
        font-size: 9px;
        letter-spacing: 1px;
        color: #666;
        padding: 4px 8px;
        border-bottom: 1px solid #2a2a3a;
      }
      .oob-screen__roster td { padding: 4px 8px; border-bottom: 1px solid #111; }
      .oob-screen__unit-name { color: #aaa; }
      .oob-screen__crew-bar {
        width: 60px; height: 6px;
        background: #1a1a2a;
        border-radius: 2px;
        overflow: hidden;
        display: inline-block;
        vertical-align: middle;
      }
      .oob-screen__crew-bar > div { height: 100%; }
      .oob-screen__crew-text { font-size: 9px; color: #888; margin-left: 4px; }
      .oob-screen__action-btn {
        background: none;
        border: 1px solid #555;
        color: #aaa;
        cursor: pointer;
        font-size: 9px;
        padding: 1px 6px;
        font-family: inherit;
        margin-right: 4px;
      }
      .oob-screen__action-btn:hover { color: #fff; border-color: #888; }
      .oob-screen__action-btn[data-action="replace"] { border-color: #ffdc00; color: #ffdc00; }
      .oob-screen__action-btn[data-action="upgrade"] { border-color: #4080ff; color: #4080ff; }
      .oob-screen__deploy-btn {
        margin-top: 16px;
        width: 100%;
        padding: 10px;
        font-family: inherit;
        font-size: 12px;
        letter-spacing: 2px;
        background: #0a1a0a;
        border: 1px solid #00ff41;
        color: #00ff41;
        cursor: pointer;
      }
      .oob-screen__deploy-btn:hover { background: #0a2a0a; }
    `;
    document.head.appendChild(this.styleEl);
  }
}
