# UI Flow Specification
*Federation Legionaires — screen inventory, transitions, and per-screen architecture*
*Last updated: 2026-03-21*

This document defines every screen in the game, every valid transition between them, the data each screen requires, and the actions available on each. It is UX architecture — what exists and how it connects — not visual design or pixel-level layout.

**Companion documents:**
- *DRONECOM_VISUAL_ANALYSIS.md* — visual language, color palette, terrain rendering
- *CAMPAIGN_OVERVIEW.md* — sector map, planet influence, travel, mission structure
- *BATTALION_CREATION.md* — onboarding, sector + type selection, OOB management
- *REPLACEMENT_AND_REINFORCEMENT.md* — SP economy, replacement screen, upgrade milestones
- *Orders and C2 Interaction.md* — full order vocabulary, C2 display feedback
- *Game Systems Overview.md* — tactical HUD elements, system summaries
- *NETWORK_PROTOCOL.md* — wire format, connection lifecycle, auth flow
- *THEATER_SUPPORT.md* — strike points, fire missions, allocation rules

---

## 1. Screen Inventory

Eleven screens. Each has a unique purpose. No screen duplicates another's function.

| # | Screen ID | Type | Purpose |
|---|-----------|------|---------|
| 1 | `MAIN_MENU` | Full page | Title, authentication, entry point |
| 2 | `BATTALION_CREATE` | Full page | One-time onboarding: sector of origin + battalion type |
| 3 | `SECTOR_MAP` | Full page | Campaign hub: star systems, travel, influence overview |
| 4 | `PLANET_VIEW` | Full page | Zoomed planet: info panel, launch mission, active missions |
| 5 | `OOB_MANAGEMENT` | Full page | Battalion roster: reorganize, flag reserves, unit detail |
| 6 | `REPLACEMENT` | Full page | Buy replacements, repairs, upgrades with SP |
| 7 | `LOADING` | Full page | Transition screen while mission generates |
| 8 | `DEPLOYMENT` | Full page (3D) | Place units in deployment zone before combat |
| 9 | `TACTICAL` | Full page (3D) | Main gameplay: 3D battlefield, C2 interface, orders |
| 10 | `AAR` | Full page | After action report: stats, outcome, rewards |
| 11 | `SETTINGS` | Overlay | Audio, graphics, controls, account — accessible from any screen |

---

## 2. Screen Transition Map

```
                         ┌──────────────────────────────────────────────────┐
                         │               SETTINGS (overlay)                │
                         │         accessible from ANY screen              │
                         └──────────────────────────────────────────────────┘

    ┌────────────┐
    │ MAIN_MENU  │
    └─────┬──────┘
          │
          ├── [new account] ──────────► BATTALION_CREATE ──┐
          │                                                │
          └── [returning player] ──┐                       │
                                   │                       │
                                   ▼                       ▼
                            ┌─────────────┐
                            │ SECTOR_MAP  │◄─────────────────────────────────┐
                            └──────┬──────┘                                  │
                                   │                                         │
                    ┌──────────────┼──────────────┐                          │
                    │              │              │                          │
                    ▼              ▼              │                          │
             ┌─────────────┐ ┌──────────────┐    │                          │
             │ PLANET_VIEW │ │ OOB_MANAGE   │◄───┼─────────┐               │
             └──────┬──────┘ └──────┬───────┘    │         │               │
                    │               │            │         │               │
                    │ [select       │ [deferred  │         │               │
                    │  difficulty]  │  replace]  │         │               │
                    ▼               ▼            │         │               │
             ┌───────────┐  ┌─────────────┐     │         │               │
             │  LOADING  │  │ REPLACEMENT │─────┼─────────┘               │
             └─────┬─────┘  └──────┬──────┘     │                         │
                   │               │            │                         │
                   ▼               └── [done] ──┘                         │
             ┌────────────┐                                               │
             │ DEPLOYMENT │                                               │
             └─────┬──────┘                                               │
                   │                                                      │
                   ▼                                                      │
             ┌────────────┐                                               │
             │  TACTICAL  │                                               │
             └─────┬──────┘                                               │
                   │                                                      │
                   ▼                                                      │
             ┌────────────┐                                               │
             │    AAR     │                                               │
             └─────┬──────┘                                               │
                   │                                                      │
                   ├── [proceed to replacements] ──► REPLACEMENT          │
                   │                                                      │
                   └── [skip / no losses] ────────────────────────────────┘


    GLOBAL TRANSITIONS (from any screen):
      • Any screen → SETTINGS (overlay toggle)
      • Any screen → MAIN_MENU (logout)
      • TACTICAL disconnect → reconnect flow (see §5)
```

### Transition Table

| From | To | Trigger | Condition |
|---|---|---|---|
| `MAIN_MENU` | `BATTALION_CREATE` | "Join the War Effort" | No active battalion |
| `MAIN_MENU` | `SECTOR_MAP` | "Resume Command" | Has existing battalion |
| `BATTALION_CREATE` | `SECTOR_MAP` | Confirm selections | Sector + type + name submitted |
| `SECTOR_MAP` | `PLANET_VIEW` | Click planet node | Fleet at that system |
| `SECTOR_MAP` | `OOB_MANAGEMENT` | "Order of Battle" button | Always |
| `PLANET_VIEW` | `SECTOR_MAP` | Back / Escape | Always |
| `PLANET_VIEW` | `LOADING` | Select difficulty + confirm | Planet contested (21–99%) |
| `LOADING` | `DEPLOYMENT` | Mission generated | Server sends zone data |
| `DEPLOYMENT` | `TACTICAL` | All ready or timer expires | Deployment ends |
| `TACTICAL` | `AAR` | Mission ends | Any cause |
| `AAR` | `REPLACEMENT` | "Proceed to Replacements" | Has losses |
| `AAR` | `SECTOR_MAP` | "Return to Sector Map" | Always (skip replacement) |
| `REPLACEMENT` | `SECTOR_MAP` | "Done" / confirm | Always |
| `REPLACEMENT` | `OOB_MANAGEMENT` | "View OOB" | Always |
| `OOB_MANAGEMENT` | `SECTOR_MAP` | Back | Always |
| `OOB_MANAGEMENT` | `REPLACEMENT` | "Replacements" | Has pending losses |
| Any | `SETTINGS` | Hotkey / gear icon | Always (overlay) |
| Any | `MAIN_MENU` | Logout | With confirmation if in mission |

---

## 3. Per-Screen Specifications

### 3.1 MAIN_MENU

**Purpose:** Entry point. Authentication gate.

**Key UI Elements:**
- Game title: "FEDERATION LEGIONAIRES" — large, monospace, mint/cyan accent (`#80FFD0`)
- Login / create account forms
- Background: slow-rotating 3D terrain disc (DRONECOM aesthetic)

**Data from Server:** Auth response, account state (`has_battalion`)

**Transitions Out:** Auth success → `SECTOR_MAP` (returning) or `BATTALION_CREATE` (new)

**Error States:** Invalid credentials (inline), server unreachable (modal with retry)

---

### 3.2 BATTALION_CREATE

**Purpose:** One-time onboarding. Permanent choices.

**Key UI Elements:**
- Sector of Origin (3 options): Terran, Gliese, Bernard's Star — each with buff description
- Battalion Type (5 options): Armored, Mechanized, Motorized, Support, Droptroops — each with roster summary
- Battalion name input (max 32 chars)
- Summary panel and "Confirm and Deploy" button
- Warning: "These choices are permanent."

**Transitions Out:** Confirm → `SECTOR_MAP`

---

### 3.3 SECTOR_MAP

**Purpose:** Campaign hub. Strategic overview.

**Key UI Elements:**
- Star system nodes (colored by control: blue/amber/red)
- Transit lines between systems
- Player fleet icon at current system (animating if in transit)
- Other player fleets visible
- Top bar: battalion name, SP balance, current system
- Campaign event feed (scrolling log)
- Buttons: "Order of Battle", "Settings"

**Player Actions:** Click planet → `PLANET_VIEW`, issue transit order, open OOB

**Blocking States:** "Loading sector data..." on initial fetch. Fleet in transit = planet interaction disabled.

---

### 3.4 PLANET_VIEW

**Purpose:** Zoomed planet. Launch or join missions.

**Key UI Elements:**
- Planet info: name, influence bar (0–100%), faction icon
- Difficulty selector: Easy / Medium / Hard buttons with descriptions
- Active missions list: phase, player count, elapsed time, "Join" button
- Player list at planet
- Back button

**Player Actions:** Select difficulty → launch/join mission. Join active mission. Back to sector map.

**Blocking States:** Planet Secure (0–20% enemy) = no missions. Planet Fallen (100%) = only BREAKTHROUGH/EVACUATION.

---

### 3.5 OOB_MANAGEMENT

**Purpose:** Battalion roster management between missions.

**Key UI Elements:**
- Hierarchical roster tree: Battalion → Companies → Platoons → Units
- Status badges: `READY`, `COMBAT INEFFECTIVE`, `RESERVED`, `VACANT`
- Drag-and-drop reorganization
- Unit detail panel (full stat card)
- Reserve flagging per unit
- Summary bar: total units, ready, ineffective, reserved, SP balance

**Transitions Out:** "Replacements" → `REPLACEMENT`. Back → `SECTOR_MAP`.

---

### 3.6 REPLACEMENT

**Purpose:** Spend SP on replacements, repairs, upgrades.

**Key UI Elements:**
- Destroyed slots with replacement options (like-for-like, downgrade, upgrade, vacant)
- Combat-ineffective units with repair options (full, partial, leave as-is)
- Reinforcement slots (if unlocked)
- SP balance display (updates live)
- Running cost total
- "Confirm" and "Skip" buttons

**Transitions Out:** Confirm/Done → `SECTOR_MAP`. "View OOB" → `OOB_MANAGEMENT`.

---

### 3.7 LOADING

**Purpose:** Transition while mission generates.

**Key UI Elements:**
- Mission briefing: objective type, faction, biome, difficulty
- Loading indicator
- Player list
- "Cancel" button (returns to PLANET_VIEW)

**Transitions Out:** Complete → `DEPLOYMENT`. Cancel → `PLANET_VIEW`.

---

### 3.8 DEPLOYMENT

**Purpose:** Place units before combat. See DEPLOYMENT_PHASE.md for full spec.

**Key UI Elements:**
- 3D viewport with deployment zone highlighted
- Roster panel (drag to place)
- Deployment timer
- Ready button with player ready states
- Quick Deploy button
- Minimap

**Transitions Out:** All ready or timer expires → `TACTICAL`

---

### 3.9 TACTICAL

**Purpose:** Main gameplay. See §4 for deep dive.

**Transitions Out:** Mission ends → `AAR`

---

### 3.10 AAR

**Purpose:** Post-mission debrief.

**Key UI Elements:**
- Result header: SUCCESS / FAILURE / PARTIAL (color-coded)
- Influence change: before → after
- SP earned breakdown (base + bonuses)
- Casualties summary (destroyed, damaged, by player)
- Kill summary by type
- Per-player contribution panel
- "Proceed to Replacements" / "Return to Sector Map" buttons

**Transitions Out:** Replacements → `REPLACEMENT`. Skip → `SECTOR_MAP`.

---

### 3.11 SETTINGS (Overlay)

Tabs: Audio, Graphics, Controls, Account. Accessible from any screen. Does not navigate away. Close returns to underlying screen.

---

## 4. TACTICAL Screen Deep Dive

### 4.1 Layout Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ MISSION INFO BAR                                                     │
│ [Objective] [Timer] [Phase]                         [Player List]    │
├──────────┬───────────────────────────────────────────┬───────────────┤
│          │                                           │               │
│          │                                           │  CONTACT      │
│  UNIT    │                                           │  PANEL        │
│  PANEL   │              3D VIEWPORT                  │               │
│          │         (Three.js DRONECOM scene)         │               │
│          │                                           ├───────────────┤
│          │                                           │  THEATER      │
│          │                                           │  SUPPORT      │
│          │                                           │  PANEL        │
├──────────┤                                           ├───────────────┤
│  ORDER   │                                           │  MINIMAP      │
│  PANEL   │                                           │               │
│          │                                           │               │
├──────────┼──────────────────────────┬────────────────┼───────────────┤
│          │   NOTIFICATION AREA      │     CHAT       │               │
└──────────┴──────────────────────────┴────────────────┴───────────────┘
```

All panels collapsible. 3D viewport fills remaining space.

### 4.2 Unit Panel (Left)

**Single unit:** NATO icon, type name, company/platoon, crew bar, suppression bar, status badge, movement state, fire posture (clickable), max range, weapon slots with ammo bars, armor values, experience.

**Multiple units:** Count, type list, shared orders available.

### 4.3 Order Panel (Left, Below Unit)

Context-sensitive orders for current selection:

| Category | Orders |
|---|---|
| Movement | ADVANCE, MARCH, REVERSE, FACE |
| Fire | ENGAGE, SUPPRESS, SMOKE |
| Posture | FREE FIRE, RETURN FIRE, HOLD FIRE |
| Range | SET MAX RANGE |
| Smoke/EW | DEPLOY SMOKE, ACTIVATE EW |
| Transport | EMBARK, DISMOUNT |
| Helicopter | ALTITUDE, LAND, PICKUP, INSERT |
| Support | CALL ARTY, CALL AIR |
| C2 | RALLY |
| Fortify | ENTRENCH |
| Cancel | CANCEL ORDER |

Hotkeys displayed on each button. Grayed out with tooltip when invalid.

### 4.4 Contact Panel (Right)

Known enemy contacts sorted by confidence then distance. Per contact: NATO icon, detection tier, type (if confirmed), category (if detected), distance, bearing, age, detecting unit count. Click to center camera. Filter buttons: All / Armor / Infantry / Air / Artillery.

### 4.5 Minimap (Right, Bottom)

Top-down orthographic view. Shows: terrain silhouette, fog of war, friendly units (green dots), contacts (red/amber dots), camera frustum (white rectangle), objectives. Click to move camera.

### 4.6 Theater Support Panel (Right)

Strike points remaining, fire missions remaining, available strike types with counts, cooldown timers, inbound indicators with ETAs. Click type → targeting mode.

### 4.7 Chat Panel (Bottom)

Message history (last 50), input field, player-colored names, system messages in white italic. Enter to focus/send, Escape to unfocus. Collapsible with new-message badge.

### 4.8 Mission Info Bar (Top)

Objective text and progress, mission phase indicator, mission timer, connected player list with status.

### 4.9 Unit Selection Model

| Method | Result |
|---|---|
| Left click unit | Select single |
| Left click empty | Deselect all |
| Shift + click | Toggle add/remove |
| Click + drag | Box select |
| Double-click unit | Select platoon |
| Ctrl + 1-9 | Assign hotkey group |
| 1-9 | Recall group |
| Double-tap 1-9 | Recall + center camera |
| Tab / Shift+Tab | Cycle selection |

### 4.10 Order Issuing

| Method | Action |
|---|---|
| Right-click ground | ADVANCE to position |
| Shift + right-click | Append waypoint |
| Alt + right-click | MARCH to position |
| Right-click contact | ENGAGE contact |
| Order button + click map | Positional orders |
| Hotkey + click | Order with hotkey then target |
| Hotkey (no target) | Posture/toggle orders apply immediately |

---

## 5. Modal and Overlay States

### 5.1 Pause Overlay

**Trigger:** All players disconnected in TACTICAL.
**Display:** Viewport dimmed. "ALL COMMANDERS DISCONNECTED — MISSION PAUSED." Countdown timer.
**Resolution:** Any reconnect dismisses overlay. Timeout = mission fails.

### 5.2 Reconnecting Overlay

**Trigger:** Player's WebSocket drops.
**Display:** Top banner: "CONNECTION LOST — RECONNECTING..." Input disabled. Retry counter.
**Resolution:** Success = banner dismissed + state resync. Exhausted = error modal.

### 5.3 Error Modal

**Trigger:** Unrecoverable error.
**Display:** Center modal: error message + "Return to Main Menu" button.

### 5.4 Confirmation Modal

**Instances:** Leave mission, logout during mission, confirm battalion creation, confirm transit.
**Display:** Warning text + Confirm / Cancel buttons.

---

## 6. Notification Model

### 6.1 Categories

| Category | Examples |
|---|---|
| Campaign | "Fleet arrived at Kepler-4", "Planet influence CRITICAL" |
| Mission | "Player joined", "Objective updated", "Phase: EXTRACTION" |
| Combat | "T1 Abrams destroyed", "Contact: ARMOR spotted NW", "Incoming artillery" |
| System | "Settings saved", "Reconnected to server" |

### 6.2 Priority Levels

| Priority | Color | Duration |
|---|---|---|
| Critical | Red (`#E04030`) | 8 seconds |
| Warning | Amber (`#D09020`) | 5 seconds |
| Info | White (`#C8C8C8`) | 5 seconds |

### 6.3 Display Rules

- Position: bottom-right
- Stack: newest at bottom, older push up
- Max visible: 5 (oldest dismissed for overflow)
- Hover pauses auto-dismiss
- No toasts during modals (queued behind)

### 6.4 Combat Aggregation

| Event | Rule |
|---|---|
| Multiple contacts spotted <2s | Single toast: "3 contacts spotted NW" |
| Multiple fire events on same unit <3s | Single toast: "Unit under heavy fire" |
| Suppression events | No toast (visible on unit bar) |
| Unit destroyed | Always individual toast (critical) |

---

## 7. Responsive Considerations

| Tier | Resolution | Support |
|---|---|---|
| Minimum | 1280 x 720 | Full functionality |
| Target | 1920 x 1080 | Reference layout |
| High | 2560 x 1440+ | Scales up, more viewport space |

- Panels: fixed pixel width at minimum. Viewport fills remaining space.
- Fonts: 13px base at 1080p, minimum 11px at 720p.
- No mobile support in v1.

---

## 8. Accessibility (v1 Minimum)

- Color + icons for all state indicators (not color alone)
- Minimum 11px text at 720p
- Full keyboard navigation for menus
- All orders have hotkey equivalents
- Combat log as text fallback for visual/audio events
- No gameplay information conveyed exclusively through audio

---

## 9. Cross-Reference

| Topic | Document |
|---|---|
| Visual aesthetic, color palette | DRONECOM_VISUAL_ANALYSIS.md |
| Sector map, influence, travel | CAMPAIGN_OVERVIEW.md |
| Onboarding, sector/type selection | BATTALION_CREATION.md |
| SP economy, replacements | REPLACEMENT_AND_REINFORCEMENT.md |
| Order vocabulary, C2 feedback | Orders and C2 Interaction.md |
| Tactical systems | Game Systems Overview.md |
| Wire protocol, auth | NETWORK_PROTOCOL.md |
| Theater support | THEATER_SUPPORT.md |
| Spotting, contacts, fog of war | Spotting and Contact Model.md |
| Factions | FACTIONS.md |
| Force rosters | FORCE_ROSTERS.md |
| Unit data model | Unit Schema Spec.md |
| Combat formulas | Combat Formula Spec.md |
| Deployment mechanics | DEPLOYMENT_PHASE.md |
| Mission states | MISSION_LIFECYCLE.md |
| Mission creation | MISSION_GENERATION.md |
| Post-mission flow | POST_MISSION_RESOLUTION.md |
| Lobby / join flow | LOBBY_AND_MATCHMAKING.md |

---

*This document is the canonical UI architecture reference. Any screen, transition, or interaction not defined here does not exist in v1.*
