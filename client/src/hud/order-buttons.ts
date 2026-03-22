/**
 * OrderButtonBar — order button bar for the tactical screen.
 *
 * Source: UI_FLOW.md (Section 4.3 — Order Panel), Orders and C2 Interaction.md
 * Milestone 2: Skirmish Sandbox
 *
 * Creates a row of order buttons for issuing movement, fire, posture, and
 * special orders. Each button has a unicode icon, tooltip, and keyboard
 * shortcut. Buttons can be individually enabled/disabled and one can be
 * marked as the active order mode.
 *
 * The bar sits below the unit panel on the left side of the tactical HUD.
 * Buttons are disabled by default (no unit selected). When a unit is selected,
 * the caller enables the buttons appropriate for that unit's state.
 */

/** All supported order types for the button bar. */
export type OrderType =
  | 'move'
  | 'move_fast'
  | 'reverse'
  | 'engage'
  | 'area_fire'
  | 'hold_fire'
  | 'return_fire'
  | 'fire_at_will'
  | 'rally'
  | 'entrench'
  | 'deploy_smoke'
  | 'cancel';

/** Definition of a single order button. */
interface OrderButtonDef {
  type: OrderType;
  /** Unicode character used as the button icon. */
  icon: string;
  /** Human-readable tooltip shown on hover. */
  tooltip: string;
  /** Keyboard shortcut key (lowercase). */
  hotkey: string;
  /** Display label for the hotkey badge on the button. */
  hotkeyLabel: string;
}

/**
 * Button definitions — order, icons, tooltips, and hotkeys.
 *
 * Icons use unicode symbols that evoke military / command aesthetics without
 * requiring external icon fonts. The choices:
 *   Move:       \u2B95  rightwards arrow
 *   Move Fast:  \u26A1  lightning bolt
 *   Reverse:    \u23EA  rewind
 *   Engage:     \u2694  crossed swords
 *   Area Fire:  \u25CE  bullseye
 *   Hold Fire:  \u26D4  no entry
 *   Return Fire:\u21A9  hook arrow
 *   Fire At Will:\u2622 radioactive (danger)
 *   Rally:      \u2691  flag
 *   Entrench:   \u26CF  pick
 *   Deploy Smoke:\u2601 cloud
 *   Cancel:     \u2716  heavy x
 */
const BUTTON_DEFS: OrderButtonDef[] = [
  { type: 'move',         icon: '\u2B95', tooltip: 'Advance — cautious movement (50% speed)',              hotkey: 'm', hotkeyLabel: 'M' },
  { type: 'move_fast',    icon: '\u26A1', tooltip: 'March — full speed movement',                         hotkey: 'f', hotkeyLabel: 'F' },
  { type: 'reverse',      icon: '\u23EA', tooltip: 'Reverse — back up holding front facing',              hotkey: 'r', hotkeyLabel: 'R' },
  { type: 'engage',       icon: '\u2694', tooltip: 'Engage — direct fire on a contact',                   hotkey: 'e', hotkeyLabel: 'E' },
  { type: 'area_fire',    icon: '\u25CE', tooltip: 'Suppress — area fire on a position',                  hotkey: 'a', hotkeyLabel: 'A' },
  { type: 'hold_fire',    icon: '\u26D4', tooltip: 'Hold Fire — unit never fires autonomously',           hotkey: 'h', hotkeyLabel: 'H' },
  { type: 'return_fire',  icon: '\u21A9', tooltip: 'Return Fire — fire only when fired upon',             hotkey: 'u', hotkeyLabel: 'U' },
  { type: 'fire_at_will', icon: '\u2622', tooltip: 'Free Fire — engage any valid target automatically',   hotkey: 'w', hotkeyLabel: 'W' },
  { type: 'rally',        icon: '\u2691', tooltip: 'Rally — commander reduces suppression on target unit', hotkey: 'l', hotkeyLabel: 'L' },
  { type: 'entrench',     icon: '\u26CF', tooltip: 'Entrench — dig in at current position (120s)',        hotkey: 'n', hotkeyLabel: 'N' },
  { type: 'deploy_smoke', icon: '\u2601', tooltip: 'Deploy Smoke — fire smoke dischargers',               hotkey: 's', hotkeyLabel: 'S' },
  { type: 'cancel',       icon: '\u2716', tooltip: 'Cancel — clear current order',                        hotkey: 'x', hotkeyLabel: 'X' },
];

/** DRONECOM aesthetic colors. */
const COLORS = {
  panelBg: '#0A0F14',
  panelBorder: '#1A3040',
  buttonBg: '#0F1820',
  buttonBgHover: '#162838',
  buttonBgActive: '#1A4040',
  buttonBgDisabled: '#0A0E12',
  textPrimary: '#C8C8C8',
  textDisabled: '#404040',
  accent: '#80FFD0',
  accentDim: '#40806A',
  hotkey: '#607080',
} as const;

/** Callback type for order selection. */
type OrderCallback = (orderType: OrderType) => void;

export class OrderButtonBar {
  private container: HTMLDivElement;
  private buttons: Map<OrderType, HTMLButtonElement> = new Map();
  private enabledState: Map<OrderType, boolean> = new Map();
  private activeType: OrderType | null = null;
  private callback: OrderCallback | null = null;
  private styleTag: HTMLStyleElement;
  private keydownHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.styleTag = this.createStyles();
    document.head.appendChild(this.styleTag);

    this.container = document.createElement('div');
    this.container.className = 'order-bar';

    // Build buttons
    for (const def of BUTTON_DEFS) {
      const btn = this.createButton(def);
      this.buttons.set(def.type, btn);
      this.enabledState.set(def.type, false);
      this.container.appendChild(btn);
    }

    // Start hidden — show when a unit is selected
    this.container.style.display = 'none';

    document.body.appendChild(this.container);

    // Keyboard shortcuts
    this.keydownHandler = (e: KeyboardEvent) => this.handleKeydown(e);
    document.addEventListener('keydown', this.keydownHandler);
  }

  /**
   * Register a callback that fires when the player selects an order button
   * (by clicking or pressing its hotkey).
   */
  onOrder(callback: OrderCallback): void {
    this.callback = callback;
  }

  /**
   * Enable or disable a specific order button.
   * Disabled buttons appear dimmed and do not respond to clicks or hotkeys.
   */
  setEnabled(orderType: OrderType, enabled: boolean): void {
    this.enabledState.set(orderType, enabled);
    const btn = this.buttons.get(orderType);
    if (!btn) return;

    btn.disabled = !enabled;
    if (enabled) {
      btn.classList.remove('order-bar__btn--disabled');
    } else {
      btn.classList.add('order-bar__btn--disabled');
      // If the disabled order was active, clear active state
      if (this.activeType === orderType) {
        this.clearActive();
      }
    }
  }

  /**
   * Enable all order buttons at once.
   */
  enableAll(): void {
    for (const def of BUTTON_DEFS) {
      this.setEnabled(def.type, true);
    }
  }

  /**
   * Disable all order buttons at once. Used when no unit is selected,
   * or when the selected unit is destroyed or routing.
   */
  disableAll(): void {
    for (const def of BUTTON_DEFS) {
      this.setEnabled(def.type, false);
    }
    this.clearActive();
  }

  /**
   * Highlight the given order type as the currently active order mode.
   * Only one button can be active at a time.
   */
  setActive(orderType: OrderType): void {
    // Clear previous
    this.clearActive();

    const btn = this.buttons.get(orderType);
    if (!btn) return;

    this.activeType = orderType;
    btn.classList.add('order-bar__btn--active');
  }

  /**
   * Clear the active order highlight.
   */
  clearActive(): void {
    if (this.activeType) {
      const prevBtn = this.buttons.get(this.activeType);
      if (prevBtn) {
        prevBtn.classList.remove('order-bar__btn--active');
      }
      this.activeType = null;
    }
  }

  /**
   * Get the currently active order type, or null if none.
   */
  getActive(): OrderType | null {
    return this.activeType;
  }

  /**
   * Show the order bar. Call this when a unit is selected.
   */
  show(): void {
    this.container.style.display = 'grid';
  }

  /**
   * Hide the order bar. Call this when no unit is selected.
   */
  hide(): void {
    this.container.style.display = 'none';
    this.clearActive();
  }

  /**
   * Configure the bar for a unit that is routing or surrendered —
   * only Cancel and Rally are available.
   */
  setRoutingState(): void {
    this.disableAll();
    this.setEnabled('cancel', true);
    this.setEnabled('rally', true);
  }

  /**
   * Configure the bar for a destroyed unit — all buttons disabled.
   */
  setDestroyedState(): void {
    this.disableAll();
  }

  /**
   * Destroy the order bar — remove all DOM elements, injected styles,
   * and keyboard listener.
   */
  dispose(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.styleTag.parentNode) {
      this.styleTag.parentNode.removeChild(this.styleTag);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private createButton(def: OrderButtonDef): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'order-bar__btn order-bar__btn--disabled';
    btn.disabled = true;
    btn.title = `${def.tooltip} [${def.hotkeyLabel}]`;
    btn.setAttribute('data-order', def.type);

    // Icon
    const iconSpan = document.createElement('span');
    iconSpan.className = 'order-bar__btn-icon';
    iconSpan.textContent = def.icon;
    btn.appendChild(iconSpan);

    // Hotkey badge
    const hotkeySpan = document.createElement('span');
    hotkeySpan.className = 'order-bar__btn-hotkey';
    hotkeySpan.textContent = def.hotkeyLabel;
    btn.appendChild(hotkeySpan);

    btn.addEventListener('click', () => {
      if (!btn.disabled) {
        this.activateOrder(def.type);
      }
    });

    return btn;
  }

  private activateOrder(orderType: OrderType): void {
    // Posture orders (hold_fire, return_fire, fire_at_will) apply immediately
    // and do not enter an "active mode" — they just fire the callback.
    const immediateOrders: OrderType[] = ['hold_fire', 'return_fire', 'fire_at_will', 'cancel', 'deploy_smoke', 'entrench'];
    const isImmediate = immediateOrders.includes(orderType);

    if (isImmediate) {
      // Clear any existing active mode
      this.clearActive();
    } else {
      // Toggle: if already active, deactivate
      if (this.activeType === orderType) {
        this.clearActive();
        return;
      }
      this.setActive(orderType);
    }

    if (this.callback) {
      this.callback(orderType);
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Ignore if typing in an input/textarea (e.g. chat)
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }

    const key = e.key.toLowerCase();
    const def = BUTTON_DEFS.find(d => d.hotkey === key);
    if (!def) return;

    // Only fire if the button is enabled
    if (!this.enabledState.get(def.type)) return;

    e.preventDefault();
    this.activateOrder(def.type);
  }

  /**
   * Create and return a <style> tag with all CSS for the order button bar.
   */
  private createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.setAttribute('data-order-bar', '');
    style.textContent = `
      .order-bar {
        position: fixed;
        top: 420px;
        left: 12px;
        width: 220px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 3px;
        padding: 8px;
        background: ${COLORS.panelBg};
        border: 1px solid ${COLORS.panelBorder};
        border-radius: 2px;
        z-index: 100;
        pointer-events: auto;
        user-select: none;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
      }

      .order-bar__btn {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 44px;
        padding: 4px 2px;
        background: ${COLORS.buttonBg};
        border: 1px solid ${COLORS.panelBorder};
        border-radius: 2px;
        cursor: pointer;
        font-family: 'Courier New', Courier, monospace;
        transition: background-color 0.1s ease, border-color 0.1s ease;
        outline: none;
      }

      .order-bar__btn:hover:not(:disabled) {
        background: ${COLORS.buttonBgHover};
        border-color: ${COLORS.accentDim};
      }

      .order-bar__btn--active {
        background: ${COLORS.buttonBgActive} !important;
        border-color: ${COLORS.accent} !important;
        box-shadow: 0 0 6px rgba(128, 255, 208, 0.25);
      }

      .order-bar__btn--active .order-bar__btn-icon {
        color: ${COLORS.accent} !important;
      }

      .order-bar__btn--disabled {
        cursor: default;
        opacity: 0.35;
      }

      .order-bar__btn--disabled .order-bar__btn-icon {
        color: ${COLORS.textDisabled};
      }

      .order-bar__btn-icon {
        font-size: 18px;
        line-height: 1;
        color: ${COLORS.textPrimary};
        transition: color 0.1s ease;
      }

      .order-bar__btn-hotkey {
        position: absolute;
        bottom: 2px;
        right: 3px;
        font-size: 8px;
        color: ${COLORS.hotkey};
        line-height: 1;
        pointer-events: none;
      }
    `;
    return style;
  }
}
