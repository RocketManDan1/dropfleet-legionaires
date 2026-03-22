# Dropfleet Legionaires — Campaign Overview
*Meta-campaign layer: sector map, planet influence, persistent war*
*Last updated: 2026-03-20*

---

## What the Campaign Is

Dropfleet Legionaires is not a series of disconnected skirmishes. It is a **persistent, live co-operative war** fought across a sector of contested star systems. Every player commands their own battalion. All players share one war.

The meta-campaign layer governs:
- Which planets are contested, controlled, or falling
- Where players deploy their transport fleets
- How enemy influence spreads if left unchecked
- The permanent state of each player's battalion (casualties, experience, attrition)

The tactical missions (terrain, combat, orders) are the *implementation* of that war. The campaign is what gives those missions stakes.

---

## Inspiration References

- **Helldivers 2** — shared galactic war map, real-time influence progression, co-op mission contribution
- **Hearts of Iron IV** — order of battle management, theatre-level strategic picture
- **MekHQ** — persistent unit rosters, campaign casualties, force management between deployments

---

## The Sector Map

### Presentation

The sector map is rendered in the C2 aesthetic — dark background, glowing star nodes connected by transit lines, control zones rendered as colored influence regions. It looks like a strategic operations display, not a space game.

- Star systems are **circular nodes** with labels
- Transit routes between systems are **thin connecting lines**
- Enemy-controlled space is marked with **red diagonal-hatch fill zones** (like the Helldivers screenshot)
- Friendly-secured space uses **blue fill zones**
- Contested systems glow **amber**
- Each player's transport fleet is represented as a **NATO naval symbol** on the map, moving between nodes in real time

### Zones of Control

The sector is divided into named zones. Each zone contains several star systems. Enemy factions spread influence outward from their anchor systems — a zone fully taken by an enemy changes color and its planets become hostile missions.

---

## Planets

Every star system has one or more **planets** that can be contested.

### Planet Influence Bar

Each planet has an **enemy influence value** (0–100%).

| Influence | State | Effect |
|---|---|---|
| 0–20% | Secure | No missions available; no enemy activity |
| 21–50% | Contested | Missions available; player deployments active |
| 51–80% | Falling | High-priority missions; enemy reinforcement rate increases |
| 81–99% | Critical | Emergency missions only; max enemy density |
| 100% | Fallen | Planet locked under enemy control; spreads influence to neighbors |

Influence **increases passively** over time when no players are deployed. Influence **decreases** when players complete missions on that planet. The rate of increase scales with how many adjacent planets the enemy already controls.

### Travel Time

Moving a battalion's transport fleet from one system to an adjacent system takes approximately **24 hours of real time**. This is intentional — decisions about where to deploy carry weight. Players cannot teleport to every crisis simultaneously.

Transit is automatic once a player issues the movement order. The NATO naval symbol animates along the transit line on the sector map.

---

## Missions

When a player's battalion arrives at a contested planet, they can **queue into available missions**. Missions are randomly generated from a pool appropriate to the planet's influence level and enemy faction.

### Mission Structure

- A mission is a **single tactical engagement** — one map, one objective
- Missions can be started solo or with any number of players on the same planet
- Other players present on the planet can **join a mission in progress**, dropping their forces in as reinforcements
- Missions have a **time limit** (scenario-dependent, typically 20–45 minutes of real time)

### Joining In Progress

When a player joins a mission already running:
- Their units spawn at a designated reinforcement entry point on the map
- They see the current state of the battle in real time
- Their kills and casualties from that point forward are tracked for their battalion record

### Mission Completion

On mission end (objectives met or time expired):
- Influence is reduced (success) or unchanged (failure) on the target planet
- Each player's **permanent casualties** are applied to their battalion roster
- Experience is awarded to surviving units (see Battalion Management)

---

## Permanent Casualties

**Kills, losses, and casualties from missions are permanent.**

This is the central tension of the campaign. A destroyed vehicle is gone from your roster until replaced. Dead crew reduce a unit's `currentCrew`. Units with low crew are degraded versions of themselves — fewer shots, lower morale ceiling.

### Replacement

Units below 50% crew are flagged as **combat ineffective** and cannot be deployed in the next mission until resupplied. Resupply is:
- Automatic between missions for minor attrition (1–2 crew losses)
- Requires a **logistics mission** on a secure planet for heavy losses or destroyed vehicles
- Destroyed vehicles require either a logistics mission or spending battalion supply points

Supply points are a battalion resource earned by completing missions. They represent the supply chain supporting the battalion.

---

## The Real-Time Campaign Clock

The campaign runs continuously in server time. Key timings:

| Event | Duration |
|---|---|
| Inter-system transit | ~24 hours |
| Planet influence tick (increase) | Every 30 minutes of real time |
| Mission duration (typical) | 20–45 real-time minutes |
| Resupply between missions (minor) | Immediate on mission exit |
| Resupply (major / replacement) | Requires logistics mission |

Players do not need to be logged in for the campaign to progress. A player who logs off on a planet will find the influence bar has shifted when they return.

---

## Enemy Faction Behaviour

Each enemy faction has distinct campaign behaviour in addition to distinct tactical units (see FACTIONS.md).

**Ataxian Hive** — spreads influence rapidly but loses it quickly when pressured. Operates in swarms — when multiple planets are simultaneously low-influence, they concentrate on one breakthrough point. Identifying and blocking the breakthrough is the tactical puzzle.

**Khroshi Syndicalists** — slower to spread, but heavily fortified once entrenched. Taking back a Khroshi-held planet requires sustained effort over multiple missions. They do not spread randomly — they prioritize high-value industrial and population planets.

Both factions can be active in the sector simultaneously, potentially on different planets.

---

## Session Flow Summary

```
Login
  └── Main Menu
        ├── "Join the War Effort"  → Battalion Creation (new players)
        └── "Resume Command"       → Sector Map (returning players)
                                          └── Select planet / transit fleet
                                                └── Queue into mission
                                                      └── Tactical engagement
                                                            └── Return to sector map
```

---

*Detailed battalion creation is in BATTALION_CREATION.md.*
*Enemy faction details are in FACTIONS.md.*
*Tactical mission rules are in Game Systems Overview.md.*
