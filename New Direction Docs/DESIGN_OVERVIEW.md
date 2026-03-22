# Dropfleet Legionaires — Design Overview
*Working document. Last updated: 2026-03-20*

---

## Vision

A browser-based co-operative tactical wargame set in a persistent science fiction military campaign. Players command battalions of the Terran Federation, defending fledgling colonies from two hostile forces: the bio-engineered Ataxian Hive and the post-human Khroshi Syndicalists.

The game has two interlocking layers:

1. **The Campaign** — a persistent, real-time sector map shared by all players. Planets have influence bars that shift continuously. Players move their transport fleets between star systems, queue into missions, and push back the enemy tide. Inspired by Helldivers 2.

2. **The Mission** — a tactical engagement on a procedurally generated map. Co-operative, order-based, with simulation-depth combat derived from WinSPMBT data. The look is a military command-and-control terminal — DRONECOM aesthetic. Casualties from missions are permanent.

Gameplay is deliberate and order-based, not twitch APM. The UI should look like operational software, not a game.

---

## Aesthetic Reference

**Target look:** DRONECOM (screenshots)
- Dark near-black background
- Wireframe or flat-shaded terrain with a grid overlay
- Unit icons using simplified NATO symbology or geometric shapes
- Sensor arcs rendered as transparent cones/circles
- Monospace font, green/amber/red color coding
- Curved "globe edge" horizon effect
- Panel-based UI: contact lists, orders, inventory, sensor readouts

This aesthetic is deliberately cheap to render. No textures, no PBR, no normal maps. The entire visual language is lines, geometry, and glowing UI elements — which means it runs well in a browser.

---

## Tech Stack

### Frontend (Client)
| Layer | Technology | Reason |
|-------|-----------|--------|
| 3D Rendering | **Three.js** | Mature WebGL library, excellent wireframe support, huge ecosystem |
| UI Panels | **HTML/CSS overlays** | Military terminal UI is easier in DOM than canvas — monospace, borders, positioning |
| Language | **TypeScript** | Type safety matters when modeling unit stats and game state |
| Build | **Vite** | Fast dev server with hot reload |
| Served by | **nginx** | Lightweight static file serving inside Docker |

### Backend (Game Server)
| Layer | Technology | Reason |
|-------|-----------|--------|
| Runtime | **Node.js** | Matches frontend TS ecosystem, fast to prototype |
| WebSocket | **ws** or **Socket.io** | Real-time bidirectional client-server communication |
| Language | **TypeScript** | Shared type definitions with client |
| Unit DB | **JSON** (from parsed OBF/CSV) | Your existing extraction pipeline feeds directly in |

### Infrastructure
| Layer | Technology | Reason |
|-------|-----------|--------|
| Containerization | **Docker Compose** | Familiar, reproducible, easy to spin up locally |
| Services | client + server (+ redis later) | Clear separation of concerns |

---

## Architecture

```
Browser
  └── localhost:8080
        └── nginx (client container)
              ├── serves: Three.js app (index.html, JS bundle)
              └── proxies: /ws → server:3000 (WebSocket)

server container (Node.js)
  ├── WebSocket server — game state, commands, tick loop
  ├── Loads unit database from /data/*.json at startup
  └── Runs authoritative game simulation

/data volume (mounted)
  └── units.json, weapons.json, etc. (from OBF extraction)
```

The browser only communicates with one origin (port 8080). nginx handles the WebSocket proxy, so there are no CORS issues.

---

## Multiplayer Model: Server-Authoritative State Sync

**Not lockstep.** Here's why the choice matters for this project:

| Concern | Lockstep | Server-Auth (chosen) |
|---------|----------|----------------------|
| Browser determinism | Very hard (float, GC) | Not required |
| Late join / reconnect | Painful | Trivial |
| Bandwidth | O(commands) | O(units) — acceptable at this scale |
| Co-op fog of war | N/A | N/A (same team) |
| Anti-cheat | Hard | Built-in |

### Flow
1. Player sends a **command** to the server: `{ type: "MOVE", unitId: 42, target: {x, z} }`
2. Server validates, updates game state, resolves the tick
3. Server broadcasts **state delta** to all connected clients
4. Clients update their 3D scene to match

At tactical unit counts (dozens to low hundreds), state sync bandwidth is trivial.

---

## Unit Data: WinSPMBT Heritage

The OBF extraction pipeline produces structured data for ~3000+ unit types including:

- **Identity:** name, nationality, year, class (tank, IFV, artillery, drone, etc.)
- **Mobility:** movement class, speed, terrain costs
- **Weapons:** range, AP/HE values, ammo count, fire rate
- **Sensors:** visual range, thermal, radar (approximated from game mechanics)
- **Survivability:** armor values (front/side/rear/top), size class

This data is repurposed as the simulation foundation for **Terran Federation** units. Real-world weapon systems and vehicle stats give the game simulation depth that pure fiction cannot easily achieve. Sensor range becomes the radius of a detection arc. Armor values feed combat resolution. Movement class determines terrain traversal.

**Enemy faction units** (Ataxian Hive and Khroshi Syndicalists) use the same stat schema but with custom values — they are not in the WinSPMBT database. See FACTIONS.md for their unit rosters and special rules.

---

## Terrain

### Generation
- **Heightmap-based** procedural terrain using layered noise (simplex/perlin)
- Inspired by WinSPMBT terrain types (open, rough, wooded, urban, water) but rendered in 3D
- Hex or square grid overlay on top of continuous heightmap mesh

### Rendering
- **Wireframe mesh** from PlaneGeometry + WireframeGeometry in Three.js
- Dark base color, bright edge lines — the DRONECOM look
- Optional: flat-shaded solid faces beneath wireframe for landmass fill
- Water as flat plane below sea level threshold
- Later: biome tinting (desert amber, arctic blue-white, temperate green-grey)

### Camera
- **Standard RTS camera:** orbiting + panning + zoom
- Middle mouse drag = orbit, right mouse drag = pan, scroll = zoom
- Edge scrolling optional
- Perspective projection with slight tilt for situational awareness

---

## Game Loop (Phase 1 Target)

For the initial playable version:

1. Server generates a terrain map on room creation
2. Players join a room via browser
3. Server spawns units on the map (initially from a preset or random)
4. Clients render the 3D scene with unit icons
5. Player clicks a unit → selects it → clicks terrain → issues move order
6. Server validates, updates unit position over time, broadcasts
7. All clients see units move in real-time

Combat, sensors, and fog of war come in subsequent phases.

---

## Phased Roadmap

### Phase 1 — Foundation (Current)
- [x] Docker Compose framework (client + server containers)
- [ ] Procedural terrain generation (noise-based heightmap)
- [ ] Three.js wireframe viewer with RTS camera
- [ ] nginx serving client, proxying WebSocket to server
- [ ] Basic WebSocket connection (client ↔ server ping/pong)

### Phase 2 — Game State
- [ ] Room/lobby system (create/join game)
- [ ] Unit spawning and positioning on map
- [ ] Move orders and server-side unit movement
- [ ] State delta broadcasting to all clients
- [ ] Unit selection and order UI panels

### Phase 3 — Unit Database Integration
- [ ] Load WinSPMBT JSON data as unit type library
- [ ] Fixed TOE roster assignment from FORCE_ROSTERS.md
- [ ] Display unit stats in C2 panel (name, class, speed, weapons)
- [ ] Sensor arcs rendered on map based on unit data

### Phase 4 — Simulation
- [ ] Line-of-sight checks against heightmap
- [ ] Sensor detection modeling (visual, radar, thermal)
- [ ] Contact list (detected vs. confirmed vs. lost)
- [ ] Combat resolution using WinSPMBT weapon/armor values
- [ ] Fog of war (cooperative — shared team view)

### Phase 5 — Polish
- [ ] Globe edge horizon shader
- [ ] NATO symbology icons
- [ ] Sound design (terminal beeps, radio chatter aesthetic)
- [ ] Replay system
- [ ] Persistent lobbies (Redis)

---

## Document Index

| Document | Covers |
|---|---|
| **DESIGN_OVERVIEW.md** (this file) | Top-level vision, tech stack, architecture |
| **CAMPAIGN_OVERVIEW.md** | Sector map, planet influence, persistent war, travel, missions |
| **BATTALION_CREATION.md** | Account/login flow, sector origin, battalion types, OOB management |
| **FORCE_ROSTERS.md** | Fixed TOEs for all 5 battalion types with unit counts and costs |
| **REPLACEMENT_AND_REINFORCEMENT.md** | Supply points, post-mission replacement market, upgrades |
| **FACTIONS.md** | Ataxian Hive and Khroshi Syndicalists — lore, campaign behaviour, tactical units |
| **THEATER_SUPPORT.md** | Per-mission air strikes, off-map artillery, orbital fire — allocation, types, co-op bonuses |
| **Game Systems Overview.md** | All tactical systems with cross-references |
| **Combat Formula Spec.md** | Authoritative combat math |
| **Unit Schema Spec.md** | TypeScript type definitions for units and weapons |
| **Spotting and Contact Model.md** | Detection, contact tiers, LOS |
| **Orders and C2 Interaction.md** | Full order vocabulary |
| **Simulation Time Model.md** | Tick rate, cooldowns, real-time conversion |
| **DRONECOM_VISUAL_ANALYSIS.md** | Rendering reference for the C2 aesthetic |
| **BUILDING_GRAMMARS.md** | Procedural building district rules |

---

## What We Are Not Building

- Sprite art or pixel art — all visual information is geometry and UI
- A faithful WinSPMBT clone — mechanics are inspired by, not identical to, the source game
- A competitive multiplayer game — co-op only
- A mobile game — desktop browser, keyboard+mouse assumed
- A persistent world MMO — persistent *campaign*, but missions are instanced engagements

---

## Open Questions

1. **Grid type:** ~~Hex (faithful to SPMBT) or square (simpler 3D integration)?~~ **Resolved: continuous world-space simulation with a logical overlay grid.** Movement and LOS are authoritative on the continuous heightmap/nav representation; overlay cells are for deployment validation, UI references, and coarse indexing. The overlay may be implemented as square or hex without changing combat semantics.
2. **Turn structure:** ~~Pure real-time, or a hybrid?~~ **Resolved: pure real-time.** Server runs a continuous tick loop; orders execute as issued. No simultaneous-resolution pulse.
3. **Unit scale:** ~~Platoon-level or individual vehicle?~~ **Resolved: 1 unit = 1 vehicle or 1 infantry section, represented as a single NATO icon.** No individual soldier or crew models. Spacing and formation mechanics are not needed at this representation level.
4. **Session persistence:** Browser tabs close. Do we save game state to disk/Redis between sessions?
