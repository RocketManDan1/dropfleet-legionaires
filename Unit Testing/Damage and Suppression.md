> **SOURCE RESEARCH ONLY** — This document is a WinSPMBT data reference, not authoritative game rules. For Dropfleet Legionaires game rules, see `New Direction Docs/Combat Formula Spec.md`.

# WinSPMBT — Damage and Suppression Reference

Sources: MHMBTHelp.htm, APCalc_Help.TXT, Manual01.htm, Manual03.htm,
Manual04.htm, SPMBT_DATA_ANALYSIS.md, patch info.txt (v2.0)

---

## Part 1 — Damage

### 1a. Armour penetration sequence (vehicles)

For any AP, Sabot, HEAT, or HE round that hits an armoured target, damage
is resolved in layers. Every layer must be defeated before the next is reached.

```
Step 1 — ERA check (if ERA value > 0 on the hit facing)
Step 2 — Anti-HEAT armour check (HEAT / shaped-charge rounds only)
Step 3 — Steel armour check (all round types)
Step 4 — Behind-armour damage (Survivability roll)
       OR Catastrophic kill (bypasses Survivability)
```

#### Step 1 — ERA

ERA level on a facing = that facing's number of *chances* to defeat the
incoming round, and also the *per-chance probability*:

| ERA level | Approx. defeat chance per activation |
|-----------|--------------------------------------|
| 1 | ~10% |
| 2 | ~20% |
| 5 | ~50% |
| 9 | ~90% |

- Each activation (whether it defeats the round or not) reduces the ERA
  level by 1. At 0 the facing is bare metal.
- **Plain ERA (1–9):** defeats HEAT and cluster bomblets only.
- **Advanced / Kontakt ERA (11–20):** also defeats AP/kinetic rounds.
  Value 11 = 1 Kontakt point, 19 = 9 Kontakt points.
- **Multi-charge ATGM** (weapon class 19) has a higher chance of defeating
  ERA than standard HEAT.
- ERA must be fully defeated before the armour behind it is checked.
  It is required — not optional — to go through ERA first.

#### Step 2 — Anti-HEAT armour

Only checked for shaped-charge (HEAT) rounds.

- Value = steel armour + any additional HEAT-specific protection (spaced
  armour, side skirts, composite arrays).
- Must always be ≥ steel value on the same facing; never lower.
- If no anti-HEAT values are set on a unit, HEAT rounds use the steel
  armour values instead.

#### Step 3 — Steel armour

The base check for all round types.

- Each digit ≈ 1 cm effective steel at normal incidence.
- **Angled shots get a bonus:** a side-hit at 30° off perpendicular forces
  the round to defeat *more* than the entered value. The game adds to the
  effective armour for oblique impacts.
- The Encyclopaedia displays armour values "adjusted for slope" — i.e.
  already reflecting the vehicle's actual armour angle, not raw plate thickness.
- **Penetration occurs when:** `pen value >= armour value`
- For HE: penetration generally requires *over*-penetration,
  especially if warhead size is low.

#### Step 4 — Behind-armour damage

**Normal penetration** (pen < armour + 10):
- The **Survivability (S) rating** (0–6) applies.
- S represents the chance for crew to survive, bail out successfully, or
  take reduced casualties after a penetrating hit.
- Only relevant for vehicles with bailing crew. No effect on infantry
  sections, aircraft, or planes.
- High armour + high S = very durable unit. Low armour + high S = only
  tough against MG and small-calibre AA.

S scale reference:

| S | Typical unit |
|---|---|
| 0 | Armoured jeep |
| 1 | Makeshift APC |
| 2 | Makeshift armoured car |
| 3 | Light tank, low-end APC/armoured car |
| 4 | Medium tank, rivercraft, high-end APC |
| 5 | Heavy tank, monitors/armoured boats |
| 6 | Ultra-modern MBT, ships |

**Catastrophic penetration** (pen ≥ armour + 10):
- The Survivability roll is **bypassed entirely**.
- The vehicle is destroyed outright regardless of S rating.

---

### 1b. Crew as hit points

Crew count is the unit's effective "health pool" for both vehicles and infantry.

- Vehicle "*" damage messages = 1 crewman disabled (and sometimes the
  removal of a weapon from service).
- A soft-skinned vehicle with 4 crew will absorb more rifle hits before
  destruction than one with 1 crew.
- 8-man infantry sections last significantly longer than 5-man sections.
- Crew losses directly reduce the unit's offensive output (see Rate of Fire
  below) and slot multiplier for Class 0 infantry weapons.

---

### 1c. Rate of Fire (ROF) degradation

ROF is the maximum shots a unit can fire at full experience. Actual shots
allocated each turn are reduced by several factors:

| Factor | Effect |
|--------|--------|
| **Experience** | Exp 70 unit with ROF 9 typically gets ~6 shots allocated |
| **Damage taken** | Each point of crew/damage loss reduces effective ROF |
| **Movement** | Expending MP reduces shots remaining; firing also costs MP |
| **Suppression** | High suppression reduces available shots |
| **High FC** | Can add to effective crew experience, sometimes generating +1 shot |

Slots 2–4 are the first to lose their shot allocation as crew/suppression
degrades. Slot 1 retains priority throughout.

---

### 1d. Warhead Size and damage scaling

Warhead Size is not fixed damage — it is a *modifier* rolled partially into
kill and penetration values on each shot:

- *None, some, or all* of WH can be added to kill and pen rolls per shot.
- A larger WH weapon with otherwise identical stats:
  - Penetrates more armour on average at a given range (AP/HEAT)
  - Kills more soft targets on average (HE)
  - Reloads more slowly from ammo supply
- WH over a threshold causes crater damage, drops wooden bridges (and
  higher still, stone bridges).
- WH 0 drastically reduces effectiveness — appropriate for militarily
  useless weapons (pistols).

---

### 1e. HE damage categories

| Stat | Used for |
|------|---------|
| **HE Kill** | Primary soft-target kill value. Scales with WH. Used against infantry and unarmoured targets. |
| **HE Penetration** | Used when an HE round hits or explodes in the **same hex** as an armoured target. Does not degrade with range. Affects all targets in the hex — cannot be made HESH-equivalent for single-target use without AOE bleed. |
| **AP Kill** | Used for **cluster munitions** (bomblets) as their HE kill value against soft targets. |

Fast-moving infantry (≥ half MP) are more vulnerable to HE fire than
stationary or slowly moving infantry — being prone/still is the best
defence against indirect fire.

---

### 1f. Collateral and blast damage

- Artillery blast propagates into surrounding hexes. Larger calibre = larger
  lethal radius (patch v2.0 item 59).
- 2,000 lb bombs: potentially lethal area up to ~200 yards from impact.
- **Armoured vehicles ≥ 2 hexes from impact:** suppressed rather than
  destroyed by fragments, *except* for cluster munitions.
- **Cluster munitions:** more evenly distributed over their blast radius
  (less range falloff), minimum radius of 1 hex on-map, 2 hexes for
  air-dropped.
- **Buildings collapsing** cause casualties to any occupants; stone
  buildings cause more than other types.
- Artillery does **not** remove wire.
- Counter-battery fire against off-map artillery ignores Size when
  calculating potential damage (the Size stat is not used for off-map units).

---

### 1g. Weapon slot degradation summary

As a unit takes damage and suppression, weapon availability degrades:

```
Slot 1 → always last to go; most reliable under any conditions
Slot 2 → loses availability earlier under damage/suppression
Slot 3 → first to drop out under moderate suppression
Slot 4 → least reliable; drops first
```

A weapon appearing in the fire queue as "due for a shot" does not guarantee
it fires — slots 2–4 can fail to fire even when scheduled, depending on
skill, suppression and damage state.

---

### 1h. Electronic countermeasures (EW)

For non-AA vehicles, the EW field enables special countermeasure systems:

| EW value | System | Effect |
|----------|--------|--------|
| 1 | Arena (1 shot) | Active anti-ATGM; can shoot down incoming missiles |
| 2 | Arena (2 shots) | As above, 2 charges |
| 3 | VIRSS (1 shot) | Visual + IR screening smoke; defeats TI targeting; IR jammer component |
| 4 | VIRSS (2 shots) | As above, 2 charges |

Each use depletes one charge. VIRSS ejects anti-TI smoke (counters
Vision 40+ units). Arena/Drozd intercepts the missile before impact.

For AA units, EW is an electronic warfare score. The ratio between firer
and target aircraft EW determines whether the aircraft's defences reduce
hit probability.

---

## Part 2 — Suppression

### 2a. What causes suppression

Suppression accumulates from multiple sources. Higher suppression value =
worse performance (lower is better):

| Cause | Notes |
|-------|-------|
| Being shot at | Even missed shots add suppression |
| Taking casualties | Casualties cause suppression |
| Nearby wrecks | Presence of destroyed vehicles in/near hex |
| Nearby friendly casualties | Seeing allied units destroyed nearby |
| Smoke (friendly or enemy) | Presence of smoke in/near hex |
| Fast movement | Moving at ≥ half MP increases vulnerability and suppression risk for infantry |
| Dismounting from fast transport | Treated as bunched + fast-moving |
| Entering wire | Causes casualties and suppression to infantry |
| Indirect fire in area | Even non-direct hits from arty add suppression |

---

### 2b. Effects of suppression

| Effect | Detail |
|--------|--------|
| **Reduced to-hit** | Suppression directly lowers hit probability. Manual explicitly states: "reducing suppression will increase its chance to hit." |
| **Reduced shots** | Fewer shots allocated per turn from suppression |
| **Slot availability** | Slots 2–4 progressively less likely to fire |
| **OP fire reduction** | Suppressed units are less likely to trigger opportunity fire |
| **Resupply impaired** | Suppression state of either firer or resupply unit slows ammo resupply |
| **Morale risk** | High suppression can lead to pinning, rout, or surrender |
| **Infantry vulnerability** | Suppressed infantry in the open are more exposed to further HE fire |

---

### 2c. Morale states and cascade

Suppression feeds into morale, which has its own state ladder:

```
Normal → Pinned → Routing → Surrender
```

- **Pinned:** unit cannot advance but can return fire at reduced effectiveness.
- **Routing:** unit flees toward map edge; limited ability to take any action.
- **Surrender:** unit removed from play; adds to enemy victory points.
- Units routing have less chance of retreating into enemy-occupied hexes
  (patch v2.0 item 60).
- **Force morale break:** if a formation's overall morale collapses, the
  whole formation may route simultaneously.

Experience and morale are linked: veterans have better base morale,
better rally values, and recover faster. Green troops have lower base
morale, less shots per move, and rally less reliably.

---

### 2d. Rally mechanic

Rally reduces suppression and can pull units back from pinned/routing states.

**Rally chain (top-down):**
```
A0 (Battle Group HQ) → Company commander → Platoon commander → Unit's own sergeant
```

Pressing R on a subordinate uses the highest available commander's rally
attempt first, then works down the chain. This means:
- Rally A0 last — you may accidentally exhaust him rallying lower units.
- Check the commander's state before rallying: a routing/retreating
  commander has **no** rally influence.
- Failing a rally attempt sets that unit's rally chance to **0 for the
  rest of the turn**. Zero does not mean permanently broken — it resets
  next turn.

**Radio and command range:**
- Units with radios can be rallied by their commander anywhere on the map
  (provided radio contact is working — radios have a chance to fail).
- Units without radios require the commander to be within ~3–4 hexes
  (voice range ≈ 150–200 m).

**Auto-rally option:** if enabled in game options, the computer automatically
attempts to rally suppressed units at end of turn.

---

### 2e. Experience and morale modifiers on damage/suppression

Experience level (default baseline = 70) modifies several damage-related
outcomes:

| Experience | Effect |
|-----------|--------|
| Higher | Better rally values, more shots per move, better morale, more resistant to suppression cascade |
| Lower | Fewer shots per move (green exp 70 crew with ROF 9 gets ~6; less experienced get fewer) |
| Very high (veterans) | Top tier: fire better, rally better; at the extreme, qualify for special kill VP bonus vs. same-tier enemy |

FC values contribute to effective crew experience — a unit with high FC
can sometimes generate 1 additional shot as a knock-on effect.

---

## Part 3 — Damage/Suppression interaction summary

```
SHOT HITS
│
├── Miss → small suppression added to target
│
└── Hit
    ├── No penetration → suppression added; possible morale check
    │
    └── Penetration
        ├── Normal (pen < armour+10)
        │   └── Survivability roll
        │       ├── Pass → crew survives / minor damage
        │       └── Fail → crew casualties; weapon/ROF loss; possible destruction
        │
        └── Catastrophic (pen ≥ armour+10)
            └── Bypasses Survivability → destroyed
```

**Suppression compounds over time.** A unit that has been trading fire for
several turns accumulates suppression from misses, nearby casualties and
wrecks, even if never directly hit. This makes rally management as
important as firepower — a unit at high suppression loses slots, loses
shots, and risks routing regardless of its remaining crew count.

**Casualties and suppression reinforce each other.** Casualties directly
reduce crew (hit points) and the slot-1 fire multiplier for infantry.
They also *cause* suppression. Suppression then reduces the remaining
crew's effective output further. A squad hit hard enough to lose half its
men and accumulate heavy suppression may be functionally combat-ineffective
even with several men still alive.

---

## Part 4 — What we do not have

The following details are internal to the game engine and not documented
in any available file:

- The exact numeric formula converting penetration excess into Survivability
  roll probability.
- The exact numeric formula converting suppression level into to-hit
  and shots-available reduction.
- The precise morale thresholds for each state transition (normal →
  pinned → routing → surrender).
- How experience level maps to exact shots-allocated numbers beyond the
  one example given (ROF 9 at exp 70 → ~6 shots).

---

*Compiled from: MHMBTHelp.htm (Don Goodbrand, 2003), APCalc_Help.TXT,
Manual01.htm, Manual03.htm, Manual04.htm (Camo Workshop Game Guide),
SPMBT_DATA_ANALYSIS.md, patch info.txt v2.0.*
