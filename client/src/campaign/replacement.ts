// ============================================================================
// REPLACEMENT SCREEN — Post-mission casualty recovery and SP spending
// Milestone 5
// Source: REPLACEMENT_AND_REINFORCEMENT.md, POST_MISSION_RESOLUTION.md, UI_FLOW.md
// ============================================================================

import type {
  BattalionRecord, UnitSlot, DifficultyTier,
} from '@legionaires/shared';
import {
  SP_MINIMUM_FLOOR,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplacementOption {
  slotId: string;
  unitTypeId: string;
  unitName: string;
  crewCurrent: number;
  crewMax: number;
  /** SP cost to fully replenish this unit. */
  replenishCost: number;
  /** SP cost to replace a destroyed unit. */
  replaceCost: number;
  status: UnitSlot['status'];
}

export interface ReplacementCallbacks {
  onReplenish: (battalionId: string, slotId: string) => void;
  onReplace: (battalionId: string, slotId: string) => void;
  onSkip: (battalionId: string, slotId: string) => void;
  onConfirmAll: (battalionId: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// ReplacementScreen
// ---------------------------------------------------------------------------

/**
 * Post-mission replacement/reinforcement screen.
 * Players spend SP to replenish damaged units or replace destroyed ones.
 */
export class ReplacementScreen {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private callbacks: ReplacementCallbacks | null = null;
  private currentBattalionId: string | null = null;
  private spAvailable = 0;
  private spSpent = 0;
  private decisions = new Map<string, 'replenish' | 'replace' | 'skip'>();

  show(
    battalion: BattalionRecord,
    options: ReplacementOption[],
    callbacks: ReplacementCallbacks,
  ): void {
    this.callbacks = callbacks;
    this.currentBattalionId = battalion.battalionId;
    this.spAvailable = battalion.supplyPoints;
    this.spSpent = 0;
    this.decisions.clear();
    this.injectStyles();
    this.dispose();

    this.overlay = document.createElement('div');
    this.overlay.className = 'repl-screen';

    // Header
    const header = document.createElement('div');
    header.className = 'repl-screen__header';
    header.innerHTML = `
      <span class="repl-screen__title">CASUALTY REPLACEMENT</span>
      <span class="repl-screen__bn-name">${battalion.name}</span>
      <span class="repl-screen__sp-display">
        SP: <span class="repl-screen__sp-value">${this.spAvailable}</span>
        <span class="repl-screen__sp-spent">(−${this.spSpent})</span>
      </span>
      <button class="repl-screen__close">✕</button>
    `;
    header.querySelector('.repl-screen__close')!.addEventListener('click', () => {
      this.hide();
      this.callbacks?.onClose();
    });
    this.overlay.appendChild(header);

    // Needs-attention units only (damaged or destroyed)
    const needsAttention = options.filter(o =>
      o.status === 'damaged' || o.status === 'destroyed' || o.status === 'combat_ineffective'
    );

    if (needsAttention.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'repl-screen__no-casualties';
      msg.textContent = 'All units operational — no replacements needed.';
      this.overlay.appendChild(msg);
    } else {
      const list = document.createElement('div');
      list.className = 'repl-screen__list';

      for (const opt of needsAttention) {
        list.appendChild(this.buildUnitRow(opt));
      }

      this.overlay.appendChild(list);
    }

    // Summary + confirm
    const footer = document.createElement('div');
    footer.className = 'repl-screen__footer';
    footer.innerHTML = `
      <div class="repl-screen__summary">
        <span>Units requiring attention: ${needsAttention.length}</span>
        <span>SP remaining after decisions: <span class="repl-screen__sp-remaining">${this.spAvailable - this.spSpent}</span></span>
      </div>
      <button class="repl-screen__confirm-btn">CONFIRM ALL DECISIONS</button>
    `;
    footer.querySelector('.repl-screen__confirm-btn')!.addEventListener('click', () => {
      // Fire individual callbacks for each decision
      for (const [slotId, decision] of this.decisions) {
        if (decision === 'replenish') {
          this.callbacks?.onReplenish(battalion.battalionId, slotId);
        } else if (decision === 'replace') {
          this.callbacks?.onReplace(battalion.battalionId, slotId);
        } else {
          this.callbacks?.onSkip(battalion.battalionId, slotId);
        }
      }
      this.callbacks?.onConfirmAll(battalion.battalionId);
    });
    this.overlay.appendChild(footer);

    document.body.appendChild(this.overlay);
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  dispose(): void {
    this.hide();
  }

  /** Update SP display after server confirms a transaction. */
  updateSP(newSP: number): void {
    this.spAvailable = newSP;
    this.refreshSPDisplay();
  }

  // --- Internal ---

  private buildUnitRow(opt: ReplacementOption): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'repl-screen__row';
    row.dataset.slotId = opt.slotId;

    const crewPct = opt.crewMax > 0 ? Math.round(opt.crewCurrent / opt.crewMax * 100) : 0;
    const isDestroyed = opt.status === 'destroyed';

    let actionsHtml = '';

    if (isDestroyed) {
      actionsHtml = `
        <button class="repl-screen__btn repl-screen__btn--replace" data-action="replace" data-cost="${opt.replaceCost}">
          REPLACE (${opt.replaceCost} SP)
        </button>
        <button class="repl-screen__btn repl-screen__btn--skip" data-action="skip">
          SKIP
        </button>
      `;
    } else {
      // Damaged / combat ineffective
      actionsHtml = `
        <button class="repl-screen__btn repl-screen__btn--replenish" data-action="replenish" data-cost="${opt.replenishCost}">
          REPLENISH (${opt.replenishCost} SP)
        </button>
        <button class="repl-screen__btn repl-screen__btn--skip" data-action="skip">
          SKIP
        </button>
      `;
    }

    const statusColor = isDestroyed ? '#ff4136' : '#ffdc00';

    row.innerHTML = `
      <div class="repl-screen__unit-info">
        <span class="repl-screen__unit-name">${opt.unitName}</span>
        <span class="repl-screen__unit-status" style="color:${statusColor}">${opt.status.toUpperCase()}</span>
      </div>
      <div class="repl-screen__crew">
        ${isDestroyed
        ? '<span class="repl-screen__crew-destroyed">DESTROYED</span>'
        : `<div class="repl-screen__crew-bar">
              <div style="width:${crewPct}%;background:${crewPct > 66 ? '#00ff41' : crewPct > 33 ? '#ffdc00' : '#ff4136'}"></div>
            </div>
            <span class="repl-screen__crew-text">${opt.crewCurrent}/${opt.crewMax}</span>`
      }
      </div>
      <div class="repl-screen__actions">${actionsHtml}</div>
      <div class="repl-screen__decision"></div>
    `;

    // Bind action buttons
    row.querySelectorAll('.repl-screen__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action as 'replenish' | 'replace' | 'skip';
        const cost = parseInt((btn as HTMLElement).dataset.cost ?? '0', 10);

        // Undo previous decision cost
        const prev = this.decisions.get(opt.slotId);
        if (prev && prev !== 'skip') {
          const prevCost = prev === 'replenish' ? opt.replenishCost : opt.replaceCost;
          this.spSpent -= prevCost;
        }

        // Apply new decision
        if (action !== 'skip') {
          if (this.spAvailable - this.spSpent < cost) {
            // Not enough SP — flash warning
            this.flashInsufficientSP(row);
            return;
          }
          this.spSpent += cost;
        }

        this.decisions.set(opt.slotId, action);
        this.refreshSPDisplay();

        // Update row visual
        const decisionEl = row.querySelector('.repl-screen__decision')!;
        if (action === 'skip') {
          decisionEl.innerHTML = '<span style="color:#888">SKIPPED</span>';
        } else if (action === 'replenish') {
          decisionEl.innerHTML = '<span style="color:#00ff41">REPLENISHING</span>';
        } else {
          decisionEl.innerHTML = '<span style="color:#4080ff">REPLACING</span>';
        }

        // Highlight selected action
        row.querySelectorAll('.repl-screen__btn').forEach(b =>
          b.classList.remove('repl-screen__btn--active'));
        btn.classList.add('repl-screen__btn--active');
      });
    });

    return row;
  }

  private refreshSPDisplay(): void {
    if (!this.overlay) return;
    const spVal = this.overlay.querySelector('.repl-screen__sp-value');
    const spSpent = this.overlay.querySelector('.repl-screen__sp-spent');
    const spRemaining = this.overlay.querySelector('.repl-screen__sp-remaining');

    if (spVal) spVal.textContent = String(this.spAvailable);
    if (spSpent) spSpent.textContent = `(−${this.spSpent})`;
    if (spRemaining) {
      const remaining = this.spAvailable - this.spSpent;
      spRemaining.textContent = String(remaining);
      (spRemaining as HTMLElement).style.color = remaining < SP_MINIMUM_FLOOR ? '#ff4136' : '#00ff41';
    }
  }

  private flashInsufficientSP(row: HTMLDivElement): void {
    row.classList.add('repl-screen__row--flash');
    setTimeout(() => row.classList.remove('repl-screen__row--flash'), 600);
  }

  // --- Styles ---

  private injectStyles(): void {
    if (this.styleEl) return;
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = `
      .repl-screen {
        position: fixed; inset: 0;
        background: #080810f0;
        font-family: 'Courier New', monospace;
        color: #c0c0c0;
        z-index: 30;
        display: flex;
        flex-direction: column;
      }
      .repl-screen__header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 20px;
        border-bottom: 1px solid #2a2a3a;
      }
      .repl-screen__title {
        font-size: 14px;
        letter-spacing: 3px;
        color: #80ffd0;
      }
      .repl-screen__bn-name { color: #aaa; font-size: 12px; }
      .repl-screen__sp-display {
        margin-left: auto;
        font-size: 14px;
        color: #ffdc00;
      }
      .repl-screen__sp-value { font-weight: bold; }
      .repl-screen__sp-spent { color: #ff4136; font-size: 11px; }
      .repl-screen__close {
        background: none; border: 1px solid #555; color: #aaa;
        cursor: pointer; font-size: 14px; padding: 2px 6px;
      }
      .repl-screen__no-casualties {
        text-align: center;
        color: #00ff41;
        font-size: 14px;
        margin-top: 60px;
      }
      .repl-screen__list {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
      }
      .repl-screen__row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 12px;
        border: 1px solid #1a1a2a;
        margin-bottom: 4px;
        transition: border-color 0.2s;
      }
      .repl-screen__row--flash {
        border-color: #ff4136 !important;
        animation: repl-flash 0.3s ease-in-out 2;
      }
      @keyframes repl-flash {
        50% { background: #2a0a0a; }
      }
      .repl-screen__unit-info { width: 180px; }
      .repl-screen__unit-name { display: block; color: #aaa; font-size: 12px; }
      .repl-screen__unit-status { font-size: 9px; letter-spacing: 1px; }
      .repl-screen__crew { width: 120px; }
      .repl-screen__crew-bar {
        width: 80px; height: 6px;
        background: #1a1a2a;
        border-radius: 2px;
        overflow: hidden;
        display: inline-block;
        vertical-align: middle;
      }
      .repl-screen__crew-bar > div { height: 100%; }
      .repl-screen__crew-text { font-size: 9px; color: #888; margin-left: 4px; }
      .repl-screen__crew-destroyed { color: #ff4136; font-size: 10px; }
      .repl-screen__actions { display: flex; gap: 6px; }
      .repl-screen__btn {
        background: none;
        border: 1px solid #555;
        color: #aaa;
        cursor: pointer;
        font-size: 10px;
        padding: 4px 10px;
        font-family: inherit;
        transition: all 0.15s;
      }
      .repl-screen__btn:hover { border-color: #888; color: #fff; }
      .repl-screen__btn--replenish { border-color: #00ff41; color: #00ff41; }
      .repl-screen__btn--replace { border-color: #4080ff; color: #4080ff; }
      .repl-screen__btn--skip { border-color: #666; color: #888; }
      .repl-screen__btn--active {
        background: #1a1a2a;
        box-shadow: 0 0 6px 1px currentColor;
      }
      .repl-screen__decision {
        width: 100px;
        font-size: 10px;
        letter-spacing: 1px;
        text-align: center;
      }
      .repl-screen__footer {
        padding: 12px 20px;
        border-top: 1px solid #2a2a3a;
        display: flex;
        align-items: center;
        gap: 20px;
      }
      .repl-screen__summary {
        flex: 1;
        font-size: 11px;
        display: flex;
        gap: 20px;
      }
      .repl-screen__sp-remaining { color: #00ff41; font-weight: bold; }
      .repl-screen__confirm-btn {
        padding: 10px 24px;
        font-family: inherit;
        font-size: 12px;
        letter-spacing: 2px;
        background: #0a1a0a;
        border: 1px solid #00ff41;
        color: #00ff41;
        cursor: pointer;
      }
      .repl-screen__confirm-btn:hover { background: #0a2a0a; }
    `;
    document.head.appendChild(this.styleEl);
  }
}
