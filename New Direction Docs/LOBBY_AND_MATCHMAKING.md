# Lobby and Matchmaking
*Federation Legionaires — authoritative spec*
*Last updated: 2026-03-21*

This document defines how players find and join missions. There is **no party system, no matchmaking queue, and no lobby room.** Players travel to a planet and select a difficulty — the server either creates a new mission or drops them into an existing one. Simplicity is the design goal: the friction between "I want to play" and "I am playing" should be minimal.

**Companion documents:**
- *MISSION_LIFECYCLE.md* — mission state machine, join-in-progress, disconnect handling
- *MISSION_GENERATION.md* — how missions are created, difficulty tiers, archetypes
- *DEPLOYMENT_PHASE.md* — what happens after joining (unit placement)
- *POST_MISSION_RESOLUTION.md* — AAR, rewards, return to campaign
- *CAMPAIGN_OVERVIEW.md* — sector map, planets, transit, influence
- *CAMPAIGN_PERSISTENCE.md* — PlayerAccount, BattalionRecord, PlanetState
- *NETWORK_PROTOCOL.md* — AUTH, JOIN_MISSION, PLAYER_STATUS wire messages

---

## 1. Planet Mission Interface

When a player arrives at a planet (after transit or at game start), they enter the **Planet View** screen. This is the only place missions are launched from.

### What the player sees:

| Element | Description |
|---|---|
| Planet header | Name, controlling faction, strategic value tier |
| Influence bar | Tri-faction breakdown (Federation / Ataxian / Khroshi), 0–100% |
| Difficulty buttons | Three buttons: **Easy**, **Medium**, **Hard** |
| Active mission cards | One card per running mission instance (if any) |
| Planet chat | Text chat visible to all players on this planet |
| Battalion status | Player's own battalion strength summary |

### Active Mission Cards

Each active mission instance on the planet shows:

```
┌─────────────────────────────────────┐
│  MEDIUM  ·  2/4 players  ·  LIVE   │
│  Armored, Mechanized                │
│  12:34 elapsed                      │
│  [ JOIN ]                           │
└─────────────────────────────────────┘
```

- **Difficulty** of the instance
- **Player count** / max (4)
- **Current phase** (DEPLOYMENT or LIVE — EXTRACTION/AAR/CLOSED are not joinable)
- **Battalion types** of current players (helps the joiner decide if their type complements)
- **Elapsed time** since mission started
- **Join button** (only if phase is DEPLOYMENT or LIVE and player count < 4)

If no active missions exist, the cards area is empty and the difficulty buttons say "Launch" instead of showing existing instances.

---

## 2. Mission Join Flow

```
Player selects difficulty
        │
        ▼
Server: active mission at this difficulty on this planet?
        │
   ┌────┴────────────────────────────┐
   │ YES                             │ NO
   │                                 │
   ▼                                 ▼
Phase = DEPLOYMENT or LIVE?     Create new MissionInstance
AND player count < 4?           (see MISSION_GENERATION.md)
   │                                 │
   ├── YES → Join existing           │
   │         mission instance        │
   │                                 │
   └── NO  → Create new ────────────┘
             MissionInstance
                    │
                    ▼
          Player transitions to
          LOADING → DEPLOYMENT
          (or late-join deployment if LIVE)
```

### Join conditions:

| Condition | Result |
|---|---|
| Active mission, DEPLOYMENT phase, < 4 players | Join — full deployment |
| Active mission, LIVE phase, < 4 players | Join — late-join deployment (30s at reinforcement entry, see DEPLOYMENT_PHASE.md §5) |
| Active mission, EXTRACTION / AAR / CLOSED | Cannot join — create new instance |
| Active mission, 4/4 players | Cannot join — create new instance |
| No active mission at that difficulty | Create new instance |

### Server-side message flow:

1. Client sends `JOIN_MISSION { planetId, difficulty }` (note: not a specific missionId — server resolves)
2. Server finds or creates the instance
3. Server responds with `MISSION_PHASE { missionId, phase }` and `MISSION_STATE_FULL { ... }`
4. Client transitions to deployment or late-join screen

---

## 3. Player Visibility on Planet

Players on the same planet can see each other to facilitate organic coordination.

| Visible to player | Source |
|---|---|
| Total players on this planet | Server broadcasts planet player count |
| Active mission instances (see §1 cards) | Server sends active mission summaries |
| Other players' names and battalion types | Included in planet player list |
| Planet-wide chat messages | Broadcast to all players on planet |

### What is NOT visible:

- Other players' exact unit rosters or SP balance (privacy)
- Mission type of an active mission before joining (fog of war — you don't know what you're getting into)
- Players on other planets (only same-planet visibility)

---

## 4. Maximum Players and Overflow

**Hard cap: 4 players per mission instance.**

If a 5th player tries to join a full instance, the server creates a **new instance** at the same difficulty on the same planet. Multiple instances can run simultaneously.

```
Planet: Arcturus IV
├── Easy  instance #1:  2/4 players (LIVE)
├── Medium instance #1: 4/4 players (LIVE)    ← full
├── Medium instance #2: 1/4 players (DEPLOYMENT) ← overflow created
└── Hard  instance #1:  3/4 players (LIVE)
```

Each instance is fully independent — different map seed, different enemy composition, different mission type. They share nothing except the planet they're on.

---

## 5. Social Features (v1 — Minimal)

v1 has no social graph. Players coordinate through co-presence on the same planet.

| Feature | v1 Status |
|---|---|
| Friend list | Not implemented |
| Party / group invite | Not implemented |
| Private missions | Not implemented |
| "Join friend" button | Not implemented |
| Spectator mode | Not implemented |
| Planet-wide text chat | **Implemented** |
| Mission team chat | **Implemented** |
| Player names visible | **Implemented** |

### How players coordinate in v1:

1. Communicate out-of-band (Discord, etc.) to agree on a planet
2. Travel to the same planet
3. Use planet chat to coordinate difficulty choice
4. Select the same difficulty — server puts them in the same instance
5. Mission team chat handles in-game coordination

### Future (v2+):

- Friend list with online status and current planet
- "Join friend's mission" button (auto-travel if not on same planet)
- Private mission instances (invite-only, hidden from planet view)
- Spectator slots (read-only view of active mission)

---

## 6. Anti-Grief Measures

With no party system and open join, minimal anti-grief rules are needed.

| Concern | Mitigation |
|---|---|
| Friendly fire | Not possible — co-op vs AI only, no player-to-player damage |
| AFK during deployment | Auto-deploy algorithm places unplaced units when timer expires (DEPLOYMENT_PHASE.md §6) |
| AFK during combat | 5-minute disconnect timer: units freeze, then disappear (MISSION_LIFECYCLE.md §3) |
| Intentional disconnecting | No penalty beyond losing participation SP. Disconnected units do not burden teammates (invincible then gone). |
| Mission spam (create + abandon to grief influence) | Abandoned missions with 0 participation time have **no influence impact** |
| Chat abuse | v1: no moderation tools. Future: mute per player, report button. |
| Blocking deployment zone | Minimum spacing rules prevent one player from filling the entire zone (DEPLOYMENT_PHASE.md §2) |

**No vote-kick in v1.** With max 4 players and co-op only, the social cost of griefing is self-limiting — a griefer hurts themselves (lost SP, wasted time) as much as others.

---

## 7. Pre-Join Information

Before committing to a difficulty, the player sees enough to make an informed choice without spoiling the mission.

### Shown:

| Information | Purpose |
|---|---|
| Difficulty label and description | "Easy — tuned for 1 player" / "Medium — tuned for 2" / "Hard — tuned for 3" |
| SP reward range | "Easy: 200–500 SP" / "Medium: 300–750 SP" / "Hard: 400–1000 SP" |
| Influence impact tier | "Small" / "Medium" / "Large" |
| Player's battalion strength | Current unit count vs full TOE — helps gauge if they're ready for harder difficulties |
| Active mission info | Player count, phase, elapsed time, battalion types (see §1) |

### NOT shown:

| Information | Reason |
|---|---|
| Mission type / archetype | Fog of war — you deploy not knowing if it's a DEFEND or a RAID |
| Enemy composition | Same — no pre-scouting |
| Map preview | Discovery is part of gameplay |
| Other players' exact rosters | Privacy |

---

## 8. Returning After Mission

After AAR (and optional replacement screen), the player returns to the **Planet View** on the planet where the mission took place.

State on return:
- Battalion status: `available`
- Location: current planet (unchanged)
- SP balance: updated with mission rewards
- Unit roster: updated with casualties and any replacements purchased
- Planet influence: updated with mission result

The player can immediately:
1. **Launch another mission** on the same planet (select difficulty again)
2. **Travel to another planet** via sector map
3. **Manage OOB** (reorganize, flag reserves, view unit details)
4. **Access deferred replacement** if they skipped it after AAR
5. **Log off** (battalion stays on current planet)

---

## 9. Edge Cases

| Scenario | Behavior |
|---|---|
| Battalion is `in_transit` | Cannot join any mission — "Your battalion is in transit. ETA: X hours." |
| Battalion is `in_mission` | Cannot join a second mission — one mission at a time |
| Battalion is `destroyed` | Cannot join — must create new battalion |
| Planet at 0% enemy influence | No missions available — "This planet is secure." All three difficulty buttons disabled. |
| Planet at 100% enemy influence | Only BREAKTHROUGH and EVACUATION mission types in the generation pool |
| Player has no battalion | Redirected to BATTALION_CREATE screen |
| Server restart during active missions | Missions recovered from periodic snapshots (SERVER_GAME_LOOP.md §6). Players reconnect and rejoin via normal AUTH → JOIN_MISSION flow. |
| Two players select same difficulty simultaneously, no active mission | Server creates one instance (first request wins), second player joins it. Race condition handled by server-side lock on mission creation per planet+difficulty. |

---

## 10. Network Messages

Mission join uses existing message types from NETWORK_PROTOCOL.md:

### Client → Server

```typescript
/** Player requests to join or create a mission on their current planet. */
interface JoinMissionRequest {
  type: 'JOIN_MISSION';
  seq: number;
  payload: {
    planetId: string;
    difficulty: 'easy' | 'medium' | 'hard';
  };
}
```

Note: the client sends `planetId` + `difficulty`, not a specific `missionId`. The server resolves which instance to join or whether to create a new one.

### Server → Client

```typescript
/** Confirms mission join and provides initial state. */
// Existing messages used:
// - MISSION_PHASE    → tells client the current phase
// - MISSION_STATE_FULL → full snapshot (units, contacts, objectives, timer)
// - DEPLOYMENT_ZONE  → zone polygon for unit placement
// - PLAYER_STATUS    → broadcast to other players that someone joined

/** Rejection if join is not possible. */
interface JoinMissionError {
  type: 'ERROR';
  seq: number;     // references client's JoinMissionRequest.seq
  payload: {
    code: 'BATTALION_IN_TRANSIT'
        | 'BATTALION_IN_MISSION'
        | 'BATTALION_DESTROYED'
        | 'NO_BATTALION'
        | 'PLANET_SECURE'    // 0% enemy influence
        | 'INTERNAL_ERROR';
    message: string;
  };
}
```

---

## Cross-Reference Index

| Topic | Document |
|---|---|
| Mission state machine and phase transitions | MISSION_LIFECYCLE.md |
| Mission type selection and enemy generation | MISSION_GENERATION.md |
| Unit placement after joining | DEPLOYMENT_PHASE.md |
| Post-mission rewards and replacement | POST_MISSION_RESOLUTION.md |
| Planet influence and transit | CAMPAIGN_OVERVIEW.md |
| Persistent player/battalion/planet records | CAMPAIGN_PERSISTENCE.md |
| Wire format for all messages | NETWORK_PROTOCOL.md |
| Screen transitions and UI layout | UI_FLOW.md |
