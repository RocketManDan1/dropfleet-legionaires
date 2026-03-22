# Dropfleet Legionaires — Project Context

## About the User

Dan is a game designer with no coding knowledge. He has deep domain expertise in wargaming (WinSPMBT, military systems, C2 aesthetics) and strong design instincts, but needs all code written for him.

**Working rules:**
- Always write complete, runnable code — never say "implement X here" or leave stubs
- Provide exact terminal commands (copy-paste level) for anything Dan needs to run
- Explain technical tradeoffs in game-design terms, not code terms
- Frame ambiguities as design decisions ("should the unit stop or keep moving?") not technical ones ("should we use a state machine or event emitter?")
- Dan tests by running the game in a browser and giving visual/gameplay feedback

## What This Project Is

A two-layer sci-fi co-op wargame:

- **Layer 1 — Sector Map:** Persistent real-time campaign (Helldivers-inspired). Players move battalions between planets, push back enemy influence. Travel takes ~24 real hours. Casualties are permanent.
- **Layer 2 — Tactical Mission:** Procedural terrain, DRONECOM C2 aesthetic, order-based combat. 20Hz server tick loop. Up to 4 players co-op.

**Setting:** Terran Federation defends fledgling colonies against:
- **Ataxian Hive** — eusocial arthropoids, bio-tech, zerg-rush style, spreads fast but collapses under pressure
- **Khroshi Syndicalists** — post-human collectivists, heavily fortified, slow to spread but hard to dislodge

**Key design decisions (confirmed):**
- Join-in-progress: players can join active missions at any time
- Disconnect: units freeze + invincible for 5 min, then disappear; all-disconnect = loss
- Deployment: all players share ONE large zone, place units in real-time (180s timer)
- Difficulty: Easy (1 player), Medium (2), Hard (3) — more rewards for harder
- Missions: on-demand only (created when players select planet + difficulty), not pre-generated
- Social: no parties, just missions; replacement purchases can be deferred
- Terran units use WinSPMBT real-world stat data; enemy factions use the same schema with custom values

## Tech Stack

- **Frontend:** Three.js + TypeScript + Vite, served by nginx
- **Backend:** Node.js + TypeScript + WebSocket
- **Infrastructure:** Docker Compose
- **Needs:** user accounts/auth, persistent storage (likely PostgreSQL), campaign state server

## Project Structure

```
client/           — Three.js frontend (Vite dev server)
server/           — Node.js game server
New Direction Docs/ — ALL design specifications (34 files, ~17,400 lines)
Unit Testing/     — Early WinSPMBT stat analysis and formula validation
docker-compose.yml
```

## Design Documents

All specs live in `New Direction Docs/`. The authoritative source of truth for shared contracts is:

**`AUTHORITATIVE_CONTRACTS.md`** — canonical types, constants, and enums. If another doc conflicts with this file, this file wins.

### Document Index
| Document | Covers |
|----------|--------|
| DESIGN_OVERVIEW.md | Top-level vision + doc index |
| CAMPAIGN_OVERVIEW.md | Sector map, planet influence, campaign clock |
| CAMPAIGN_PERSISTENCE.md | SQL schemas, slot-based unit records, tri-faction influence |
| BATTALION_CREATION.md | Account flow, sector origin, battalion types, OOB management |
| FACTIONS.md | Ataxian Hive and Khroshi Syndicalists |
| FORCE_ROSTERS.md | Fixed TOE rosters per battalion type, upgrade ladders, point values |
| Game Systems Overview.md | All tactical systems summary |
| Combat Formula Spec.md | Hit, penetration, kill, suppression, morale formulas |
| Unit Schema Spec.md | UnitType fields, weapon slots, armor facings |
| Spotting and Contact Model.md | Detection accumulator, contact tiers, sensor types |
| Orders and C2 Interaction.md | Player orders, fire postures, embark/dismount, helicopters |
| Simulation Time Model.md | Tick rates, update frequencies |
| SERVER_GAME_LOOP.md | 20Hz tick loop, 9 resolution phases, state authority |
| RUNTIME_UNIT_STATE.md | UnitInstance (~50 fields), state lifecycle, serialization |
| NETWORK_PROTOCOL.md | WebSocket/JSON, message types, delta encoding |
| MISSION_LIFECYCLE.md | State machine (CREATED→DEPLOYMENT→LIVE→EXTRACTION→AAR→CLOSED) |
| MISSION_GENERATION.md | On-demand creation, 10 mission archetypes, enemy force pipeline |
| DEPLOYMENT_PHASE.md | Shared zone, reserve system, late-joiner flow |
| POST_MISSION_RESOLUTION.md | Influence, casualties, SP rewards, replacement flow |
| LOBBY_AND_MATCHMAKING.md | Planet mission interface, join flow, max 4 players |
| REPLACEMENT_AND_REINFORCEMENT.md | Casualty recovery, SP costs, reinforcement rules |
| THEATER_SUPPORT.md | Artillery, air strikes, orbital support |
| UI_FLOW.md | 11 screens, tactical layout, modals, notifications |
| LOS_RAYCASTING.md | Bresenham grid walk, bilinear interpolation, obstruction rules |
| PATHFINDING.md | Weighted A*, cost grids, movement integration |
| ENEMY_AI.md | 3-layer AI (strategic/platoon/unit), behavior trees, influence maps |
| NATO_ICONS.md | Faction frames, detection tier display, milsymbol integration |
| VISUAL_EFFECTS.md | Procedural SDF particles, pools, performance budgets |
| DRONECOM_VISUAL_ANALYSIS.md | C2 aesthetic spec (terrain, water, lighting, grid) |
| BUILDING_GRAMMARS.md | Procedural building placement |

### Unit Data (CSV)
- `Terran_Federation_Units.csv` — all Terran unit stats (WinSPMBT-derived)
- `Ataxian_Hive_Units.csv` — all Ataxian unit stats (custom)
- `Khroshi_Syndicalist_Units.csv` — all Khroshi unit stats (custom)

**Known CSV bug:** Columns 49-50 are mislabeled as `Wpn1 HE Rds` twice — should be `Wpn4 HE Rds` / `Wpn4 AP Rds`.

## Known Issues

See `New Direction Docs/REVIEW_ISSUES.md` for the full list from the 2026-03-22 design review. Key categories:
- **13 Critical** — must fix before implementation (SP economy disagreement, influence redistribution, mission availability threshold, etc.)
- **15 High** — should fix before implementation
- **25 Medium** — fix during implementation
- **~100 Low** — documentation cleanup, fix as encountered

## Implementation Plan

Building in vertical slices (each milestone is playable):

1. **Milestone 1 — "One Unit on a Map"**: Three.js scene, DRONECOM aesthetic terrain, single NATO icon unit, click-to-move pathfinding. Client-side only.
2. **Milestone 2 — "Skirmish Sandbox"**: Node.js 20Hz tick server, WebSocket, multiple units, movement/fire orders, LOS/spotting, combat resolution, suppression/morale. Single-player, hardcoded spawns.
3. **Milestone 3 — "Playable Mission"**: Deployment phase, mission timer/objectives/extraction, enemy AI (one faction), post-mission AAR, VFX.
4. **Milestone 4 — "Multiplayer"**: Multi-player join, disconnect handling, delta-encoded snapshots, lobby/matchmaking, late-join.
5. **Milestone 5 — "Campaign"**: Sector map, planet influence, travel, battalion creation, OOB management, mission generation, casualty persistence, SP economy.
6. **Milestone 6 — "Full Alpha"**: Second enemy faction, all 10 mission types, theater support, building grammars, terrain variety, difficulty scaling.
