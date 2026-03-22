# Theater-Level Support
*Dropfleet Legionaires — air strikes, off-map artillery, and orbital fire*
*Last updated: 2026-03-20*

---

## Core Concept

Theater-level support represents assets that exist above the battalion level — strike aircraft, naval gunfire, orbital platforms, and corps-level artillery batteries. Players do not own these assets. They are **allocated per mission** based on battalion type, mission difficulty, and co-op composition.

Theater support is powerful but finite. Once your allocations are spent, you fight with what you brought. Choosing when and where to call in support is one of the most consequential decisions in a mission.

---

## Two Resource Pools

Each player receives two pools at the start of every mission:

### Strike Points (SP-AIR)

Represent available sorties from theater air assets. Spent to call in air strikes via the **CALL AIR** order.

### Fire Missions (FM)

Represent available salvos from off-map artillery or orbital fire platforms. Spent to call in bombardments via the **CALL ARTY** order.

Both pools are integer values. They do not regenerate during a mission. Unused allocations are lost when the mission ends — there is no banking.

---

## Base Allocation by Battalion Type

| Battalion Type | Strike Points | Fire Missions | Design Rationale |
|---|---|---|---|
| **Armored** | 1 | 1 | Self-sufficient in direct fire. Minimal theater dependency. |
| **Mechanized** | 1 | 2 | Some indirect fire need; organic mortars cover close range. |
| **Motorized** | 2 | 3 | Light on firepower. Needs theater support to crack hard targets. |
| **Support** | 1 | 2 | Already IS the artillery. Air fills the gap. Fire missions supplement organic tubes. |
| **Droptroops** | 3 | 4 | Lightest ground force. Highest theater dependency by design — they're the tip of the spear, theater assets are the shaft. |

---

## Co-op Multiplier: Support Battalion Bonus

When a **Support** battalion player is in the mission, all players (including the Support player) receive bonus allocations:

| Bonus | Amount |
|---|---|
| +Strike Points (all players) | +1 |
| +Fire Missions (all players) | +2 |

This is the Support battalion's primary co-op contribution. They bring organic artillery to the fight AND increase everyone else's theater allocations. A 4-player mission with a Support player means 3 extra strike sorties and 8 extra fire missions across the team.

Multiple Support players do not stack this bonus. One Support player in the mission activates it; additional Support players do not add further.

---

## Mission Difficulty Scaling

Higher-threat missions grant bonus allocations to compensate for tougher opposition. The bonus is per-player.

| Planet Influence State | SP-AIR Bonus | FM Bonus |
|---|---|---|
| Contested (25–49%) | +0 | +0 |
| Falling (50–74%) | +1 | +1 |
| Critical (75–89%) | +1 | +2 |
| Fallen (90–100%) — liberation mission | +2 | +3 |

*Secure planets (0–24%) do not generate missions.*

---

## Allocation Summary Formula

```
Player's Strike Points = base(battalion_type) + difficulty_bonus + support_bonus
Player's Fire Missions = base(battalion_type) + difficulty_bonus + support_bonus
```

### Example: Droptroops on a Critical Planet with Support Player Present

```
Strike Points = 3 (base) + 1 (Critical) + 1 (Support bonus) = 5
Fire Missions = 4 (base) + 2 (Critical) + 2 (Support bonus) = 8
```

### Example: Armored on a Contested Planet, No Support Player

```
Strike Points = 1 (base) + 0 + 0 = 1
Fire Missions = 1 (base) + 0 + 0 = 1
```

---

## Strike Types (CALL AIR)

When a player issues a **CALL AIR** order, they select a strike type from their available menu. Each type costs a number of Strike Points.

| Strike Type | SP-AIR Cost | Effect | Delay | Notes |
|---|---|---|---|---|
| **Fighter-Bomber** | 1 | Single-pass strafing run along a player-drawn line (200m). HE + AP vs. soft and light armor. | 15s | Bread and butter. Good against infantry concentrations, trucks, light vehicles. |
| **Attack Helicopter Loiter** | 1 | Helicopter enters map, loiters for 60s engaging targets of opportunity with ATGMs. | 20s | AI-controlled. Prioritizes vehicles. Vulnerable to AA — will abort if fired upon by AA units. |
| **Level Bomber** | 2 | Carpet bomb a 150m × 50m rectangle. Massive HE, destroys buildings, heavy suppression. | 30s | Devastating but slow. Best used on known concentrations. Danger-close risk to friendlies. |
| **SEAD Strike** | 1 | Anti-radiation missile strike targeting active radar emitters within 500m of designated point. | 10s | Specialist. Destroys or suppresses enemy radar/AA. Use before committing other air assets. |
| **Orbital Precision** | 3 | Kinetic rod from orbit. Single point, massive AP damage, 10m radius. Destroys anything. | 45s | Droptroops exclusive. The call sign for "delete that one thing." Long delay balances the power. |

### Strike Mechanics

- **Delay** is from order issue to impact. During the delay, the target area is marked with a warning indicator on the C2 display.
- **Friendly fire** is possible. Strikes hit everything in the target area. The C2 display warns when friendly units are inside a pending strike zone.
- **AA threat**: If enemy AA units are active near the strike path, Fighter-Bomber and Level Bomber strikes have a chance of being **intercepted** — reduced effectiveness or aborted entirely. SEAD first, then strike.
- **Attack Helicopter** is a physical unit that enters the map edge. It can be shot down. Lost helicopters do not cost the player anything (they are theater assets, not battalion assets) but the strike point is spent regardless.

---

## Fire Mission Types (CALL ARTY)

When a player issues a **CALL ARTY** order, they select a fire mission type. Each costs a number of Fire Missions.

| Fire Mission Type | FM Cost | Effect | Delay | Duration | Notes |
|---|---|---|---|---|---|
| **HE Concentration** | 1 | 6-round salvo on a 100m radius. Standard HE. | 20s | ~10s | General purpose. Suppresses and damages infantry, soft vehicles. |
| **Smoke Screen** | 1 | Smoke blanket across a 150m line. Blocks LOS for optical/NVG. | 15s | 60s | Tactical screen. TI sees through at reduced range; radar unaffected. Ties into Spotting and Contact Model smoke rules. |
| **Illumination** | 1 | Flare rounds over a 200m radius. Raises optical visibility to daylight levels in area. | 10s | 45s | Night missions only. Negates darkness penalty for optical sensors in the lit area — but also reveals friendly positions to enemy. |
| **Sustained Barrage** | 2 | Continuous fire on a 80m radius for 60s. Repeated salvos, heavy suppression, area denial. | 25s | 60s | Keeps heads down. Excellent for pinning a position before an assault. Danger-close risk. |
| **Precision Strike** | 2 | Single round, GPS-guided, 5m CEP. AP warhead, effective against single hard targets. | 30s | instant | Requires a CONFIRMED contact (tier 75+) as the target. The spotter's detection tier matters — SUSPECTED contacts cannot be precision-targeted. |
| **Rocket Salvo (MLRS)** | 3 | 12-rocket salvo across a 200m × 100m rectangle. Massive area saturation. | 35s | ~15s | Theater-level MLRS. Destroys everything soft in the area. Extremely dangerous to friendlies. |

### Fire Mission Mechanics

- **Delay** represents communication, calculation, and flight time. Shorter for simple missions, longer for heavy ones.
- **Requires a Forward Observer (FO) for full accuracy.** If the calling player has a unit with `unitClass: 'fo'` that has LOS to the target area, the fire mission uses base CEP. Without FO LOS, scatter is doubled (2× CEP). See Combat Formula Spec §6.
- **Friendly fire** applies. All fire missions are area effects. The C2 display shows the projected impact zone and warns of friendly units inside it.
- **Terrain interaction**: HE missions crater soft terrain (reduces cover value for subsequent use of that position). Smoke follows standard smoke rules from Spotting and Contact Model.
- **Precision Strike** requires a CONFIRMED contact — this ties the theater support system directly to the spotting model. You need eyes on target to guide the round.

---

## Calling Procedure (Orders Integration)

Theater support calls use the existing **CALL AIR** and **CALL ARTY** orders defined in Orders and C2 Interaction.md.

```
CALL AIR order:
  1. Player selects a unit to act as the requester (any unit)
  2. Player selects strike type from available menu
  3. Player designates target area (point or line depending on type)
  4. Confirmation prompt: "Fighter-Bomber strike on [grid]. 1 SP-AIR. Delay: 15s. Confirm?"
  5. On confirm: SP-AIR pool decremented, delay timer starts, warning marker placed on C2 display
  6. On impact: strike resolves using Combat Formula Spec damage rules

CALL ARTY order:
  1. Player selects a unit to act as the requester (any unit; FO preferred for accuracy)
  2. Player selects fire mission type from available menu
  3. Player designates target point or area
  4. System checks: FO with LOS? CONFIRMED contact (for Precision Strike)?
  5. Confirmation prompt with cost, delay, and accuracy warning if no FO
  6. On confirm: FM pool decremented, delay timer starts, impact zone shown on C2 display
  7. On impact: fire mission resolves per Combat Formula Spec §6
```

Any unit can request theater support — you don't need a specific radio operator or command unit. The assumption is that at the battalion level, all units have radio contact with their HQ, which relays to theater. The FO requirement is about **accuracy**, not **access**.

---

## Faction Interactions

### Ataxian Hive
- Ataxian units have no radar and no AA capability. Air strikes are unopposed against pure Ataxian forces.
- Ataxian swarm density makes area strikes (Level Bomber, Rocket Salvo, Sustained Barrage) extremely efficient — many kills per call.
- This is intentional: theater support is the hard counter to Hive swarms. The design creates a natural demand for Droptroops and Support players in Ataxian missions.

### Khroshi Syndicalists
- Khroshi field advanced AA (automated Gatling platforms, SAM teams). Air strikes are risky without SEAD suppression first.
- Khroshi electronic warfare can **extend fire mission delays** by 50% (jamming the comm relay). This is a scenario modifier, not a per-unit ability.
- Precision Strike is the most valuable fire mission against Khroshi — their units are expensive and spread out, making area bombardment less efficient.

---

## Co-op Dynamics

Theater support is **per-player, not shared**. Each player spends from their own pools. However, the tactical coordination opportunities are significant:

- **Support player calls smoke**, Armored player advances through it
- **Droptroops call SEAD**, then Motorized player follows with Fighter-Bomber on the suppressed AA position
- **Any player calls illumination** on a night map, all players benefit from improved optical detection
- **Stacking fire missions**: Two players can call HE Concentration on the same area simultaneously for overlapping devastation — but both pay the cost

The Support battalion's co-op bonus (+1 SP-AIR, +2 FM to all players) is deliberately generous. It makes the Support player's presence feel impactful even before they fire a single organic gun.

---

## UI Display

Theater support status is shown in a persistent panel on the C2 display:

```
┌─ THEATER SUPPORT ─────────────────┐
│ AIR  ██░░░  2/5 sorties remaining │
│ ARTY ██████░░  6/8 fire missions  │
│                                   │
│ PENDING:                          │
│  ▸ HE CONC  → grid 4421  T-12s   │
│  ▸ F-BOMBER → line 4418  T-03s   │
└───────────────────────────────────┘
```

Pending strikes show countdown timers. The impact zone is highlighted on the terrain view with a pulsing outline (amber for fire missions, red for air strikes). Friendly units inside the zone trigger a flashing **DANGER CLOSE** warning.

---

## Balance Levers

All values in this document are tuning targets for playtesting:

- **Base allocations** per battalion type
- **Co-op bonus** amounts
- **Difficulty scaling** bonuses
- **Strike/mission costs** (SP-AIR and FM per type)
- **Delays** per strike type
- **AA interception chance** against air strikes
- **FO accuracy bonus** vs. no-FO scatter penalty
- **Khroshi jamming delay** multiplier

The fundamental balance question: theater support should feel powerful enough to be worth calling (not a waste of a turn), but scarce enough that every call is a decision. A Droptroops player on a Critical planet with Support backup (5 air / 8 fire missions) should feel well-resourced but not invincible. An Armored player alone on Contested (1/1) should treat their single sortie and single fire mission as precious.

---

## Open Questions

1. **Can unused allocations carry between missions?** Current design says no — use it or lose it. But a partial-carry (50% rounded down) could reward restraint.
2. **Should there be a theater support cooldown?** After calling a strike, a brief lockout (30s) before the next call could prevent alpha-strike dumping everything at once.
3. **Counter-battery fire?** Should enemy off-map artillery exist as a threat? If so, FO units calling fire missions might attract counter-battery — creating risk for the spotter.
4. **Orbital assets for Khroshi?** The Khroshi Syndicalists are post-human with advanced tech. Should they have their own orbital strike capability that players must contend with?

---

*Strike types and fire missions use combat resolution from: Combat Formula Spec.md*
*Smoke and illumination interact with: Spotting and Contact Model.md*
*CALL AIR and CALL ARTY order flow: Orders and C2 Interaction.md*
*Battalion allocations reference: FORCE_ROSTERS.md*
*Faction-specific interactions: FACTIONS.md*
*Campaign difficulty states: CAMPAIGN_OVERVIEW.md*
