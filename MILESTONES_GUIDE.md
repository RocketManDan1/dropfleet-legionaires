# Milestones Implementation Guide

This document maps every scaffold file to its milestone, summarises what each file does, and lists the design docs you need to reference when building it out.

---

## How to Use This Guide

Each milestone is a **playable vertical slice**. Work through them in order — M1 first, M6 last. Within each milestone, the files are grouped by layer (shared → server → client).

When you're ready to implement a file, open it and read the header comment — it references the exact design doc sections. Then open those docs in `New Direction Docs/` for the full spec.

---

## Shared Types Package (All Milestones)

These files are consumed by both client and server. They're already complete — only modify when adding new types for a milestone.

| File | What It Contains |
|------|-----------------|
| `shared/src/constants.ts` | All game constants from AUTHORITATIVE_CONTRACTS.md |
| `shared/src/types/core.ts` | Vec2, FactionId, MissionType, DifficultyTier, MoveClass, SpeedState, MoraleState, FirePosture, ContactTier, etc. |
| `shared/src/types/unit-type.ts` | ArmourFacings, WeaponSlot, UnitType (static CSV data schema) |
| `shared/src/types/unit-instance.ts` | UnitInstance (~50 fields), ContactEntry, PlatoonState, PlayerMissionState, MissionState, ObjectiveState, OrderType |
| `shared/src/types/network.ts` | Wire protocol: all ClientMessage/ServerMessage types, UnitDelta, ContactDelta, GameEvent, TickUpdatePayload, AARPayload |
| `shared/src/types/pathfinding.ts` | CostGrid, PathResult, PathRequest, UnitMovementState |
| `shared/src/types/combat.ts` | ShotRecord, ToHitInputs/Result, PenInputs/Result, DamageResult, SuppressionInputs/Result |
| `shared/src/types/mission.ts` | MissionRecord, DifficultyProfile, DeploymentZone, ObjectiveDefinition |
| `shared/src/types/ai.ts` | PlatoonIntent, InfluenceMapGrid, FactionAIWeights, PlatoonBTContext, BTResult |
| `shared/src/types/campaign.ts` | PlanetRecord, BattalionRecord, UnitSlot, InfluenceDelta, SPRewardBreakdown, PlayerAccount |
| `shared/src/types/vfx.ts` | EffectType (17 types), PoolConfig, ParticleState, EffectSpawnRequest, GroundDecal |

---

## Milestone 1 — "One Unit on a Map"

**Goal:** Three.js scene with DRONECOM aesthetic terrain, one NATO icon unit, click-to-move pathfinding. Client-side only.

**Design docs:** DRONECOM_VISUAL_ANALYSIS.md, NATO_ICONS.md, PATHFINDING.md, LOS_RAYCASTING.md

| File | Layer | Description |
|------|-------|-------------|
| `client/src/main.ts` | Client | Entry point — Three.js scene setup, render loop, camera init |
| `client/src/terrain.ts` | Client | DRONECOM-style heightmap terrain with grayscale shading |
| `client/src/camera.ts` | Client | RTS camera (pan, zoom, rotate) |
| `client/src/buildings.ts` | Client | Procedural building placement (BUILDING_GRAMMARS.md) |
| `client/src/units/unit-renderer.ts` | Client | NATO icon sprite rendering with milsymbol |
| `client/src/units/unit-manager.ts` | Client | Unit lifecycle, selection, sprite management |
| `client/src/input/click-handler.ts` | Client | Click-to-move and click-to-engage input |
| `client/src/pathfinding/client-pathfinding.ts` | Client | Client-side weighted A* for movement preview |

---

## Milestone 2 — "Skirmish Sandbox"

**Goal:** 20Hz server tick loop, WebSocket connection, multiple units, movement/fire/LOS/spotting/combat/suppression/morale. Single-player with hardcoded spawns.

**Design docs:** SERVER_GAME_LOOP.md, Combat Formula Spec.md, Spotting and Contact Model.md, Orders and C2 Interaction.md, NETWORK_PROTOCOL.md, RUNTIME_UNIT_STATE.md, Simulation Time Model.md, Unit Schema Spec.md, server/BATLOC_TERRAIN_SPEC.md, server/TERRAIN_GENERATOR_AUDIT.md, server/TERRAIN_IMPLEMENTATION_PLAN.md

### Server

| File | Description | Game Loop Phase |
|------|-------------|-----------------|
| `server/src/game/tick-loop.ts` | 20Hz fixed-rate loop, 9 phase execution | — |
| `server/src/game/session.ts` | GameSession container (unit registry, terrain, spatial hash, player connections) | — |
| `server/src/game/spatial-hash.ts` | Grid-based spatial indexing (500m cells) | — |
| `server/src/data/csv-loader.ts` | CSV parser for unit stat files (Terran/Ataxian/Khroshi) | — |
| `server/src/data/unit-registry.ts` | UnitType lookup by id, faction, class | — |
| `server/src/systems/movement.ts` | Path following, speed states, position updates | Phase 3 |
| `server/src/systems/spotting.ts` | LOS raycasting, detection accumulators, contact tier transitions | Phase 4 |
| `server/src/systems/fire.ts` | Auto-fire (5a) + player engage (5b), weapon/ammo selection, DETECTED gate | Phase 5 |
| `server/src/systems/damage.ts` | To-hit, penetration, crew damage, ERA depletion, system damage | Phase 6 |
| `server/src/systems/suppression.ts` | Suppression decay, morale state machine (normal→pinned→routing→surrendered), rally | Phase 7 |
| `server/src/systems/supply.ts` | Supply range check, ammo trickle resupply | Phase 8 |
| `server/src/network/protocol.ts` | Message parsing, serialization, fog-of-war filtering | Phase 9 |
| `server/src/network/broadcast.ts` | Delta encoding, state snapshot capture | Phase 9 |

### Terrain Track (M2 Foundation)

Use these docs as mandatory references while implementing M2 server terrain evolution:

- `server/BATLOC_TERRAIN_SPEC.md` — BatLoc params, terrain enum/movement costs, extended `TerrainData`, protocol shape
- `server/TERRAIN_GENERATOR_AUDIT.md` — identified terrain/protocol gaps and priority ordering
- `server/TERRAIN_IMPLEMENTATION_PLAN.md` — staged execution plan (A→E), invariants, determinism, validation checklist

Minimum M2 terrain deliverables:

1. Data scaffolding: `BatLocParams`, preset resolver, strict `generate` parser, invariant validation hook
2. Payload contract extension: include `terrainTypeMap`, `rivers`, `roads`, `bridges`, `fords`, `spawnZones`, `objectives`, `batloc`
3. Backward compatibility: keep existing continuous maps while new fields are introduced

### Client

| File | Description |
|------|-------------|
| `client/src/network.ts` | WebSocket connection manager |
| `client/src/systems/interpolation.ts` | Client-side interpolation between server snapshots (100ms render delay) |
| `client/src/hud/unit-panel.ts` | Selected unit info panel (HP, suppression, morale, posture) |
| `client/src/hud/order-buttons.ts` | Order button bar (12 buttons with hotkeys) |

---

## Milestone 3 — "Playable Mission"

**Goal:** Deployment phase, mission timer/objectives/extraction, enemy AI (one faction), post-mission AAR, visual effects.

**Design docs:** MISSION_LIFECYCLE.md, MISSION_GENERATION.md, DEPLOYMENT_PHASE.md, POST_MISSION_RESOLUTION.md, ENEMY_AI.md, VISUAL_EFFECTS.md

### Server

| File | Description |
|------|-------------|
| `server/src/mission/lifecycle.ts` | State machine: CREATED → DEPLOYMENT → LIVE → EXTRACTION → AAR → CLOSED |
| `server/src/mission/deployment.ts` | Zone generation, unit placement, spiral auto-deploy, convex hull test |
| `server/src/mission/objectives.ts` | Objective tracker for capture/destroy/hold/extract types |
| `server/src/ai/influence-map.ts` | Threat + control influence grids, Gaussian falloff (0.6ms budget) |
| `server/src/ai/strategic.ts` | Faction-wide strategic layer, intent assignment per platoon (every 5s) |
| `server/src/ai/platoon-bt.ts` | Per-platoon behavior trees with faction-specific doctrine (every 1s) |

### Client

| File | Description |
|------|-------------|
| `client/src/screens/deployment.ts` | Deployment zone overlay, unit roster sidebar, countdown timer, drag-to-place |
| `client/src/screens/aar.ts` | After Action Report — result banner, stats, SP breakdown, influence bar |
| `client/src/effects/particles.ts` | GPU-instanced particle pools for all 17 effect types |
| `client/src/effects/effect-manager.ts` | VFX orchestrator — spawns effects from game events, LOD, ground decals |

---

## Milestone 4 — "Multiplayer"

**Goal:** Multi-player join, disconnect handling, delta-encoded snapshots, lobby/matchmaking, late-join.

**Design docs:** LOBBY_AND_MATCHMAKING.md, NETWORK_PROTOCOL.md, MISSION_LIFECYCLE.md (join-in-progress, disconnect)

### Server

| File | Description |
|------|-------------|
| `server/src/network/auth.ts` | Token-based authentication |
| `server/src/network/disconnect.ts` | Disconnect grace period (5 min freeze + invincible), reconnect |
| `server/src/network/lobby.ts` | Mission browser, join flow, max 4 players |

### Client

| File | Description |
|------|-------------|
| `client/src/screens/lobby.ts` | Mission list, join button, create mission form |

---

## Milestone 5 — "Campaign"

**Goal:** Sector map, planet influence, travel, battalion creation, OOB management, mission generation from planets, casualty persistence, SP economy.

**Design docs:** CAMPAIGN_OVERVIEW.md, CAMPAIGN_PERSISTENCE.md, BATTALION_CREATION.md, FORCE_ROSTERS.md, POST_MISSION_RESOLUTION.md, REPLACEMENT_AND_REINFORCEMENT.md, MISSION_GENERATION.md

### Server

| File | Description |
|------|-------------|
| `server/src/campaign/persistence.ts` | Database layer — planet state, battalion records, player accounts |
| `server/src/campaign/planet-state.ts` | Tri-faction influence management, control thresholds |
| `server/src/campaign/campaign-tick.ts` | 30-minute campaign tick — influence growth, faction expansion |
| `server/src/campaign/battalion.ts` | Battalion creation, OOB management, unit slot operations |
| `server/src/campaign/mission-gen.ts` | On-demand mission generation from planet state |
| `server/src/campaign/sp-economy.ts` | SP reward calculation, replacement costs, bonus logic |

### Client

| File | Description |
|------|-------------|
| `client/src/campaign/sector-map.ts` | 2D strategic overview — planet nodes, connections, faction colors |
| `client/src/campaign/planet-view.ts` | Planet detail panel — influence bar, active missions, travel/create actions |
| `client/src/campaign/oob-screen.ts` | Battalion management — unit roster, crew health, replace/upgrade buttons |
| `client/src/campaign/replacement.ts` | Post-mission SP spending — replenish damaged, replace destroyed |

---

## Milestone 6 — "Full Alpha"

**Goal:** Second enemy faction, all 10 mission types, theater support, building grammars, terrain variety, difficulty scaling.

**Design docs:** FACTIONS.md, THEATER_SUPPORT.md, BUILDING_GRAMMARS.md, MISSION_GENERATION.md (all 10 archetypes)

### Server

| File | Description |
|------|-------------|
| `server/src/systems/theater-support.ts` | Artillery, air strikes, orbital support — cooldowns, impact zones, FO bonus |

### Client

Additional work in this milestone is primarily extensions to existing files (adding Khroshi faction to AI trees, new mission archetypes to generation, terrain variety to the renderer). No new scaffold files are needed — the M3 AI scaffolds already support both factions via `FactionAIWeights`.

---

## File Count Summary

| Layer | Files | Lines (approx) |
|-------|-------|----------------|
| shared/ | 13 | ~1,600 |
| server/ | 31 | ~11,000 |
| client/ | 21 | ~11,200 |
| **Total** | **65** | **~23,800** |

---

## Quick Start Commands

```bash
# Install all workspace dependencies
pnpm install

# Run the dev server (20Hz tick loop + WebSocket)
pnpm run dev:server

# Run the client (Vite dev server with HMR)
pnpm run dev:client

# Build everything
pnpm run build
```
