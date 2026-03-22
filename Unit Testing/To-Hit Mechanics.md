> **SOURCE RESEARCH ONLY** — This document is a WinSPMBT data reference, not authoritative game rules. For Dropfleet Legionaires game rules, see `New Direction Docs/Combat Formula Spec.md`.

# WinSPMBT — To-Hit Mechanics Reference

Sources: MHMBTHelp.htm, APCalc_Help.TXT, ArmourCalc_Help.txt,
SPMBT_DATA_ANALYSIS.md, Manual04.htm, patch info.txt (v2.0)

Scale: 1 hex = 50 metres, 1 turn ≈ 5 minutes.

---

## Overview

A shot resolves in three sequential gates. All three must pass for damage to occur:

```
1. SPOT   → Can the firer see the target?
2. TO-HIT → Does the shot physically connect?
3. EFFECT → Does it penetrate, and what damage follows?
```

This document covers gates 1 and 2 in full. Gate 3 (penetration and
behind-armour damage) is documented separately.

---

## Gate 1 — Spotting

Before a unit can engage a target it must first be spotted. Spotting is
not a to-hit factor but it gates all subsequent fire.

| Factor | Effect |
|--------|--------|
| **Target Size** (0–6) | Smaller targets are harder to spot. Size 0 (snipers) have an extra hard-to-spot bonus. |
| **Terrain / cover** | Woods, buildings, hull-down ground and smoke all reduce spotting range. |
| **Firer Vision rating** | 0 = daylight only. ~20 = IR searchlight. ~30 = Image Intensifier / LLTV. 40+ = Thermal Imaging (TI). 50+ = Ground Surveillance Radar (GSR). |
| **TI and smoke** | Vision 40+ can see through smoke, but usually requires 5–6 full smoke hexes for any LOS degradation, and 2+ fire hexes for meaningful reduction. |
| **TI and speed** | TI spotting degrades slightly when the spotter is moving at top speed. Spotting while stationary or slow is better. |
| **Hidden unit fires** | Firing generally reveals a hidden unit. A TI-equipped vehicle (Vision 40+) gets a slight bonus to spotting a hidden vehicle that fired (patch v2.0 item 54). |
| **AA radar** | FC ≥ 100 (radar) spots aircraft and helicopters beyond the unit's normal ground Vision range (patch v2.0 item 34). |

---

## Gate 2 — To-Hit

### 2a. Factors that affect to-hit (all unit types)

The game does not publish its exact probability formula. What follows is the
complete list of confirmed inputs, drawn from MHMBTHelp.htm, Manual04.htm, and
patch notes.

#### Weapon accuracy (ACC)

The weapon-level Accuracy stat is the baseline hit probability modifier.
Higher is better. The design formula for guns:

> **ACC = barrel length (mm) ÷ calibre (mm) ÷ 4**, minimum 6 for howitzers.
> Example: Bushmaster II 30 mm — 3,405 ÷ 30 ÷ 4 = 28.

Mortars: regular = ACC 3, breech-loading = ACC 5, commando = ACC 0.
Multi-barrel / Gatling weapons receive a flat +6 ACC bonus on top of the formula.

#### Warhead Size contribution

Warhead Size (WH) is not just an ammo weight stat — "none, some, or all" of
the WH value can be added to kill and penetration rolls. This means a larger
WH weapon with otherwise identical stats will hit *and* penetrate slightly
more on average. The contribution is random, adding variance rather than
a fixed bonus.

#### Target Size

Size 0 = snipers / special forces. Grants an inherent accuracy penalty to
all weapons firing at it, on top of the spotting difficulty.
Size 1–6 scales normally — larger targets are easier to hit.

Note: a Size 1 infantry section is not the same visible profile as a Size 1
vehicle. The scale is relative within category.

#### Range

Longer range reduces hit probability. This applies to all direct-fire
weapons. The degradation is not linear — FC and RF equipment compress
the penalty at long range more than they do at short range.

**Practical thresholds (vehicles):**
- ≤ ~500 m (10 hexes): high probability, critical hit zone possible
- ~1,500–2,000 m (30–40 hexes): fire from the short or full halt strongly advised
- Beyond 2,000 m: full halt nearly mandatory for reliable hits

---

### 2b. Firer movement state

This is the single largest modifier to to-hit for vehicles.

| State | Definition | Accuracy |
|-------|-----------|----------|
| **Full halt** | Did not expend ≥ half MP *this* turn AND did not expend ≥ half MP *last* turn. The "moving fast" flag must be fully cleared. | Best possible |
| **Short halt** | Stationary this turn, but moved (expended ≥ half MP) last turn | Good, significantly better than moving |
| **Moving (slow)** | Moved ≤ 1 hex this turn | Moderate penalty |
| **Moving fast** | Expended ≥ half MP this turn | Heavy penalty to accuracy and number of shots |

> **"Moving fast" flag:** expending half or more MP sets a carry-over flag.
> A complete turn at below-half MP is required to clear it. You are not
> "fully stationary" just because you stopped at the end of the turn.

**Movement also breaks target lock.** Any target lock (fire control solution
held over from a previous turn) is lost if the unit moves — *unless* it has
a Stabiliser (see below).

**Relative speed at point blank:** even at 0–1 hex range, both units' speeds
are combined for the hit calculation. A tank rushing in at 20 MPH against
a target doing 30 MPH is calculated as a 50 MPH passing shot, not a
stationary engagement. Closing to point blank does *not* eliminate movement
penalties.

---

### 2c. Target movement state

| Target state | Effect on to-hit |
|---|---|
| Stationary | No penalty to firer |
| Moving slowly | Moderate penalty |
| Moving fast | Significant penalty; Fire Control (FC) most important here |

Target speed is factored in even if the target *appears* to be in the same
hex at the moment of firing. If it was moving fast at the end of its last
turn, it is still treated as moving fast.

---

### 2d. Fire Control (FC)

The unit-level FC stat. Affects accuracy especially against **moving targets**.

| Value | Meaning |
|-------|---------|
| 0–4 | Poor / WW2 standard (King Tiger max was ~5) |
| 5–19 | Moderate fire control |
| 20–34 | Capable modern systems |
| 35–99 | High-end modern fire control; formula bonus increases notably above 35 |
| ≥ 100 | AAA fire control radar — enables radar tracking of aircraft; sees planes through smoke |

> Patch v2.0 (item 56/62): The FC formula was adjusted to give greater
> benefit to values in the 35+ range. Previously higher FC equipment was
> underperforming relative to its real-world advantage.

FC ≥ 100 makes the unit a SEAD (ARM weapon) target — radar is always
broadcasting. There is no emissions control (EMCON) in SP.

---

### 2e. Range Finder (RF)

Most beneficial **when the firer has not moved** (full or short halt).

| Value | Type |
|-------|------|
| 0–4 | WW2 / no real rangefinder (Panther-class max ~4) |
| 6 | Ranging coaxial MG (UK tanks) or basic optical RF |
| 8 | Ranging .50 MG (Chieftain); stereo optical RF (Nashorn) |
| 6–10 | Optical range finders (M48, M60, Leopard 1) |
| 20+ | **Laser range finder** — significant hit bonus, especially stationary |

> Patch v2.0 (item 56/62): RF formula adjusted — laser RF (20+) now gives
> a greater benefit than before, particularly for stationary firers.

RF 20+ on a Forward Observer also improves artillery scatter and grants
GPS-equivalent bonuses in some scenarios.

Tripod-mounted weapons (standalone MG, AGL teams) receive RF = 1 and FC = 1
as a default bonus to represent stable firing platform.

---

### 2f. Stabiliser

Allows the unit to **maintain target lock while moving**, and reduces the
own-movement accuracy penalty.

- Without stabiliser: moving breaks target lock; accuracy sharply reduced.
- With stabiliser: can keep a lock on the current target through movement,
  provided LOS to that target is not broken during the move.
- Does not eliminate the movement penalty entirely — firing after a long
  move is still less accurate than from the halt.
- Units with high FC *and* RF can engage slow-moving helicopters with AP
  shot (not just HE/HEAT). Hovering helos can be engaged by almost any unit
  in range.

---

### 2g. Critical hit (weak-spot rule)

> "The calculator does not take into account the critical hit for weak spots
> allowed when to-hit probability is high (80% or more to-hit) at under
> 500 metres." — APCalc_Help.TXT

When the calculated to-hit chance reaches **≥ 80% at ≤ 10 hexes (~500 m)**,
an additional check occurs for a **weak-spot critical hit**. This:
- Ignores normal facing armour
- Targets a vulnerable spot (vision blocks, driver's hatch, etc.)
- Is separate from the catastrophic penetration rule (pen ≥ armour + 10)

This rule is not in APCalc's output and cannot be pre-calculated from stats
alone.

---

## Vehicles: full to-hit checklist

```
Higher acc  → more likely to hit
Larger WH   → small random bonus to hit and pens
Smaller tgt → harder to hit
Longer rng  → harder to hit
───────────────────────────────────────
Firer full halt   → best accuracy
Firer short halt  → good accuracy
Firer moving slow → moderate penalty
Firer moving fast → heavy penalty + fewer shots
───────────────────────────────────────
Target stationary → no penalty
Target moving     → penalty; FC matters most
───────────────────────────────────────
High FC   → partially offsets target movement penalty
High RF   → partially offsets range penalty (esp. when halted)
Stabiliser → partially offsets firer movement penalty
───────────────────────────────────────
≥80% to-hit at ≤10 hex → weak-spot critical possible
```

---

## Infantry: to-hit differences from vehicles

Infantry use the same underlying to-hit system but with several important
additional rules.

### Crew-count multiplier (slot 1 primary weapons)

Weapon Class 0 (primary infantry weapon — rifles, SMGs) in **weapon slot 1**
receives both fire strength and to-hit scaled **upward with crew count**.

- A full-strength 8-man section fires multiple internal shots from slot 1,
  each with the multiplied to-hit.
- The same rifle in slot 2, 3, or 4 gets only **1 unmultiplied shot**.
- If a section carries an LMG in slot 1 and rifles in slot 2+, the rifles
  get only 1 unmodified shot. The LMG benefits from the primary slot priority.

This mechanic means **larger squads are disproportionately more lethal**
than their raw stats suggest, and **casualties matter more than suppression**
for degrading a section's offensive output.

### Movement state and vulnerability (infantry)

Infantry movement is evaluated differently from vehicles:

| State | Accuracy effect | Vulnerability to incoming fire |
|-------|----------------|-------------------------------|
| **Stationary / prone** | Best accuracy | Best protected (going prone, using available cover) |
| **Moving 1 hex** | Small penalty | Moderate — represents either a careful creep or a short dash |
| **Moving fast (≥ half MP)** | Significant penalty | **Increased** — infantry moving fast are MORE vulnerable to direct fire and HE |

> Unlike vehicles, fast-moving infantry are *more* exposed, not just less
> accurate. This is the opposite of the armoured vehicle case where movement
> mainly hurts the firer's accuracy.

**Just dismounted:** infantry who dismount from a transport that has moved
significantly are treated as **bunched up and moving fast**. An enemy burst
at the moment of dismount can cause heavy casualties. Always dismount
in cover.

### Suppressive fire and slot degradation

Suppression affects weapon slot availability:

- **Slot 1** remains available most reliably even under suppression.
- **Slots 2–4** become progressively less likely to fire as suppression
  increases or the unit takes damage.
- A weapon "being due for a shot" (visible on the fire menu) does **not**
  guarantee it fires if it is not in slot 1.

This means suppression systematically strips away secondary and support
weapons first, leaving only the primary weapon before a unit becomes
combat-ineffective.

### Dismounted indirect-fire teams

Indirect fire capability comes from **unit class**, not weapon class. A mortar
team must be of a mortar/artillery unit class to fire indirectly — the weapon
class alone does not enable indirect fire.

### Size 0 units (snipers, special forces)

Size 0 grants:
- Extra concealment / hard-to-spot bonus
- An inherent "hard to hit" accuracy reduction applied to all weapons
  targeting the unit
- Slot 1 weapon still benefits from the crew multiplier if it carries a
  Class 0 weapon in slot 1

---

## Opportunity fire notes

- Units with **remaining shots and LOS** to a moving enemy may fire
  during the enemy turn (opportunity / reaction fire).
- **Hidden AAA** will only fire at aircraft if: the aircraft is at very
  short range (≤ ~3 hexes), OR the calculated to-hit exceeds ~9%
  (patch v2.0 item 53). This prevents hidden AA from revealing itself
  at long range against difficult shots.
- Fast-moving units (≥ half MP expended) have **fewer opportunity fire
  shots** available. Keeping some MP in reserve maintains op-fire capacity.
- **Stabiliser** units can retain target lock for opportunity fire on
  their previously-tracked target.

---

## Summary comparison: vehicles vs. infantry

| Factor | Vehicles | Infantry |
|--------|---------|---------|
| Primary accuracy driver | FC, RF, halt state | Crew count × Class 0 in slot 1 |
| Movement effect on accuracy | Large penalty to firer | Moderate penalty to firer |
| Movement effect on survivability | Neutral (harder to predict target path) | **Negative** — moving fast increases vulnerability |
| Slot 1 importance | Priority slot, most reliable | Critical — crew multiplier only applies here |
| Critical hit zone | ≥80% to-hit at ≤500 m | Same rule applies |
| Cover bonus | Hull-down, terrain | Stationary = prone = maximum cover |
| Suppression effect | Reduces slots 2–4 availability | Same; plus increases vulnerability to HE |

---

*Document compiled from: MHMBTHelp.htm (Don Goodbrand, 2003),
APCalc_Help.TXT, ArmourCalc_Help.txt, SPMBT_DATA_ANALYSIS.md,
Manual04.htm (Camo Workshop Game Guide), patch info.txt v2.0.*
