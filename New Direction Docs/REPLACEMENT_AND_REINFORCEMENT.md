# Replacement and Reinforcement System
*Dropfleet Legionaires — post-mission attrition and force recovery*
*Last updated: 2026-03-20*

---

## Core Concept

**There is no battalion builder.** Your starting roster is fixed by doctrine (see FORCE_ROSTERS.md). The "building" happens *through the campaign* — as you take casualties, spend supply points, and make replacement decisions that gradually reshape your force.

Two players who start with identical Armored battalions will have different rosters by their third mission. One might have replaced lost T1 Abrams tanks with cheaper T60A3 Pattons to save supply. The other might have spent everything maintaining a full-strength T1 company but deployed short-handed elsewhere. Both are valid strategies. Both tell a story.

---

## Supply Points (SP)

Supply points are the campaign's universal currency for force recovery. They represent the Terran Federation's logistics pipeline delivering equipment and replacements to your battalion.

### Earning Supply Points

| Source | SP Earned | Notes |
|---|---|---|
| Mission completion (success) | 200–500 SP | Scales with mission difficulty and influence reduction achieved |
| Mission completion (failure) | 50–100 SP | Partial credit for effort; enough to patch one squad |
| Bonus: zero friendly KIA | +100 SP | Reward for careful play |
| Bonus: secondary objective | +150 SP | Optional objectives within missions |
| Planet liberated (influence → 0%) | +500 SP (one-time) | Shared across all players who participated |
| Daily login (passive) | 50 SP | Keeps players from falling hopelessly behind |

*Exact values are balance levers — tune during playtesting.*

### SP Economy Feel

A single rifle squad costs ~21 SP to replace. A single T1 Abrams costs ~353 SP. A successful mission earns 200–500 SP. This means:

- An infantry player can replace several squads per mission — attrition is manageable
- An armored player can replace *maybe one tank* per mission — every loss stings
- A support player losing a Paladin (234 SP) burns most of a mission's earnings on one replacement

This is intentional. The replacement cost IS the balance mechanism.

---

## Post-Mission Flow

After every mission, the player is shown the **After Action Report** screen:

```
AFTER ACTION REPORT — Mission "Ridgeline Echo"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RESULT: SUCCESS          INFLUENCE: 67% → 52%
SP EARNED: +340          BONUS: +100 (zero KIA)

CASUALTIES:
  DESTROYED:  T1 Abrams (Company A, 2nd Plt)     — 353 SP to replace
              Rifle Squad (Company C, 1st Plt)    —  21 SP to replace
  DAMAGED:    T2A1 Bradley (Company C, 2nd Plt)   — crew 3→1, auto-repair
              Dragon Team (Company C, 1st Plt)    — crew 2→1, auto-repair

SUPPLY BALANCE: 1,240 SP (+440 earned)

[PROCEED TO REPLACEMENT SCREEN]
```

### Auto-Repair (Minor Damage)

Units that survived the mission but lost crew are **auto-repaired** between missions at no cost, *if* the damage is minor:

- Units above 50% crew: fully restored to starting crew (free)
- Units at exactly 50% crew: restored to 75% (free) — below full effectiveness but deployable
- Units below 50% crew: flagged **COMBAT INEFFECTIVE** — must be replaced or repaired at SP cost

This represents organic recovery — wounded returning to duty, crews reorganizing, minor vehicle repair.

### Auto-Repair Does NOT Apply To

- Destroyed units (crew = 0) — must be replaced
- Units below 50% crew — must spend SP to repair or accept degraded performance
- Ammo — fully restocked between missions for free (ammo is not tracked between missions)

---

## Replacement Screen

After the AAR, the player enters the **Replacement Screen**. This is where roster decisions happen.

### For Each Destroyed Unit

The player sees a replacement menu offering 2–3 options:

```
DESTROYED: T1 Abrams (Company A, 2nd Platoon)

REPLACEMENT OPTIONS:
  [1] T1 Abrams .............. 353 SP    (like-for-like)
  [2] T60A3 Patton ........... 209 SP    (downgrade: weaker armor, older fire control)
  [3] Leave vacant ........... 0 SP      (platoon fights short-handed)

Your SP balance: 1,240
```

### Replacement Rules

1. **Like-for-like** is always available at full unit cost
2. **Downgrade** offers the next step down the upgrade ladder (see FORCE_ROSTERS.md). Cheaper, weaker, but gets a body in the slot
3. **Leave vacant** is always an option — the unit slot stays empty until you choose to fill it later
4. **No cross-type replacements** — you cannot replace a tank with infantry or vice versa. Replacements must be the same role
5. **No upgrades at replacement** — you cannot buy an T1A1 to replace a lost T1. Upgrades come from campaign milestones only (see below)

### For Combat Ineffective Units (Below 50% Crew)

```
COMBAT INEFFECTIVE: T2A1 Bradley (Company C, 2nd Plt) — Crew: 1/3

REPAIR OPTIONS:
  [1] Full repair to 3/3 ..... 135 SP    (50% of unit cost)
  [2] Partial repair to 2/3 .. 68 SP     (25% of unit cost)
  [3] Leave as-is ............ 0 SP      (deploys at 1/3 crew — heavily degraded)

Your SP balance: 887
```

Repair cost scales with unit cost: 50% for full, 25% for partial. This means repairing an expensive unit is proportionally costly.

---

## Upgrade Milestones

Upgrades — replacing baseline equipment with better variants — are **earned through campaign progress**, not purchased.

### Milestone Examples

| Milestone | Reward | Available to |
|---|---|---|
| Liberate first planet | Unlock next-tier MBT for Armored/Mech battalions | Armored, Mechanized |
| Complete 10 missions | Unlock improved IFV variant | Mechanized |
| Liberate industrial planet | Unlock improved artillery variant | Support |
| Complete a special "supply raid" mission | +1,000 SP bonus | All |
| Liberate 3 planets in same zone | Unlock next-tier infantry AT weapon | All infantry types |
| Zero-KIA streak (5 missions) | Unlock elite scout variant | All |

### How Upgrades Work

When an upgrade is unlocked, it becomes available as a **replacement option** — not a free swap. The player must still spend SP to acquire the upgraded unit, and only when replacing a destroyed or vacant slot.

```
DESTROYED: T1 Abrams (Company B, 3rd Platoon)

REPLACEMENT OPTIONS:
  [1] T1 Abrams .............. 353 SP    (like-for-like)
  [2] T1A1 Abrams ............ 407 SP    (UPGRADE — unlocked: "Liberate Kepler-4")
  [3] T60A3 Patton ........... 209 SP    (downgrade)
  [4] Leave vacant ........... 0 SP

Your SP balance: 2,100
```

This creates a meaningful choice: do you spend 407 SP for one T1A1, or 353 + 209 = 562 SP for an T1 and an T60A3 in two different slots? Quantity vs quality.

---

## Reinforcement (New Units)

In addition to replacing destroyed units, players can occasionally **add units to their roster** beyond the starting TOE.

### How Reinforcement Works

- Reinforcement slots unlock at campaign milestones (same system as upgrades)
- Each reinforcement slot allows adding one unit from a defined list appropriate to the battalion type
- Reinforcement costs 150% of the unit's base SP cost (premium for expanding, not just maintaining)
- Maximum reinforcement: +1 platoon (3–4 units) per battalion over the entire campaign

### Example

An Armored battalion liberates a key planet and unlocks a reinforcement slot:

```
REINFORCEMENT AVAILABLE: 1 slot

ADD TO ROSTER:
  [1] T1 Abrams .............. 530 SP    (353 × 1.5)
  [2] HMMWV-HMG (scout) ...... 30 SP     (20 × 1.5)
  [3] Stinger Team (AA) ...... 129 SP    (86 × 1.5)
  [4] Skip for now ........... 0 SP
```

Reinforcement slots are rare and valuable. Choosing what to add — more tanks? AA coverage you lack? Scouts? — is a campaign-defining decision.

---

## Battalion Access Lists

Each battalion type can only replace and reinforce with units on its **access list**. This prevents roster convergence — an Armored battalion can never become a Support battalion through replacements.

| Battalion Type | Can field | Cannot field |
|---|---|---|
| Armored | MBT, IFV, scout, engineer, utility, ammo carrier | Artillery (SP/towed), AA batteries, helicopters |
| Mechanized | IFV, MBT (limited: max 1 platoon), infantry, scout, AT teams | SP artillery, helicopters |
| Motorized | Infantry, APC, light vehicles, mortars, AT/AA teams, TOW vehicles | MBT, IFV, SP artillery, helicopters |
| Support | SP artillery, AA vehicles, FO vehicles, mortars, ammo carriers, light infantry | MBT, IFV, attack helicopters |
| Droptroops | Light infantry, airborne AT/AA teams, mortars, helicopters, scouts, snipers | MBT, IFV, SP artillery, heavy vehicles |

*A Droptroops battalion that loses both Cobras can replace them — helicopters are on their access list. An Armored battalion cannot add Cobras no matter what.*

---

## What This Replaces

The old BATTALION_CREATION.md described "unit access priority" lists that implied a shopping/builder system. This document replaces that concept entirely:

| Old concept | New concept |
|---|---|
| "Unit access priority" | Fixed starting TOE + access list for replacements |
| Implied points-buy | Fixed roster, SP only for recovery |
| Builder at creation | Two-dropdown selection (type + sector), roster assigned |
| "Customize and organize" | OOB management (reorganize what you have, not what you buy) |
| No attrition model | Permanent casualties + SP replacement economy |

---

## Open Questions

1. **SP sharing between players?** Can a Support player donate SP to an Armored player who lost three tanks? This would reinforce the co-op dependency but could be exploited.
2. **Time-gated replacements?** Should replacement be instant between missions, or should expensive replacements take real time (e.g., "T1 Abrams arriving in 6 hours")? This would add weight to losses but might frustrate players.
3. **Salvage from kills?** Should destroying enemy units yield a small SP bonus on top of mission rewards? This rewards aggressive play but could incentivize kill-farming over objectives.
4. **Insurance against total wipe?** If a player loses their entire battalion in one catastrophic mission, what happens? Emergency resupply at 50% roster? Campaign-level rescue mission?

---

*Fixed roster definitions: FORCE_ROSTERS.md*
*Battalion creation flow: BATTALION_CREATION.md*
*Tactical combat rules: Game Systems Overview.md*
