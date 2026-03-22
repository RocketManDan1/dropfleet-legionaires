> **SOURCE RESEARCH ONLY** — This document is a WinSPMBT data reference, not authoritative game rules. For Dropfleet Legionaires game rules, see `New Direction Docs/Combat Formula Spec.md`.

# WinSPMBT — Artillery System Reference

Sources: MHMBTHelp.htm, Manual02.htm, Manual03.htm, Manual04.htm,
SPMBT_DATA_ANALYSIS.md, patch info.txt (v2.0)

Scale: 1 hex = 50 metres, 1 turn ≈ 5 minutes.

---

## Part 1 — Unit class and indirect fire eligibility

Indirect fire capability comes from **unit class**, not weapon class.
A unit must be of a mortar or artillery class to fire indirectly.

| Unit class | Indirect fire |
|------------|--------------|
| Infantry gun (AGL in MBT) | **No** |
| Infantry howitzer | **Yes** |
| Mortar | **Yes** |
| On-map SP artillery | **Yes** |
| Off-map artillery / rocket arty | **Yes** |

Off-map artillery must have weapons with range ≥ 200 (see Part 3).
Assigning a direct-fire range (1–199) to an off-map unit will leave
parts of the map out of range.

**Smoke rounds** are allocated by unit class and battle type (the
assaulter generally gets more). There is no OB data field for smoke
rounds — the count is set by the game engine at battle start.
Indirect-fire units must **not** be issued hand grenades or they will
be unable to fire smoke missions.

---

## Part 2 — ROF and ammo loadout by calibre

All indirect-firing artillery follows a standardised formula (v6.0):

> **On-map ammo = 5 × ROF**
> **Off-map ammo = 10 × ROF**

The calibre-to-ROF table is:

| Calibre | ROF | Off-map ammo | On-map ammo |
|---------|-----|-------------|------------|
| < 65 mm | < 7 | 100 | 50 |
| 65–94 mm | 7 | 90 | 45 |
| 98–107 mm | 6 | 80 | 40 |
| 114–130 mm | 6 | 70 | 35 |
| 140–155 mm | 5 | 60 | 30 |
| 170–185 mm | 4 | 50 | — (off-map only) |
| > 200 mm | 3 | 40 | — (off-map only) |
| > 220 mm | 3 | 30 | — (off-map only) |
| > 250 mm | < 2 | 20 | — (off-map only) |

Artillery ≥ 170 mm is off-map only. The `////////////////////////` marks
in the source table confirm no on-map ammo applies for those tiers.

---

## Part 3 — Off-map range encoding

The game abstracts real-world range into a single-byte value (200–255).

**Cutoff rule:** any gun with a real-world range **> 10 km** qualifies
for off-map. Guns ≤ 10 km must remain on-map.

**Encoding formula:**

> `range_value = 200 + floor(real_km - 10)`
>
> Each kilometre over 10 km adds 1 to the range value.
> Maximum is **255** (64.4 km).

Full lookup table:

| Real range | Game value | | Real range | Game value |
|-----------|------------|---|-----------|------------|
| 10.0–11.4 km | 201 | | 30.5–31.4 km | 221 |
| 11.5–12.4 km | 202 | | 31.5–32.4 km | 222 |
| 12.5–13.4 km | 203 | | 32.5–33.4 km | 223 |
| 13.5–14.4 km | 204 | | 33.5–34.4 km | 224 |
| 14.5–15.4 km | 205 | | 34.5–35.4 km | 225 |
| 15.5–16.4 km | 206 | | 35.5–36.4 km | 226 |
| 16.5–17.4 km | 207 | | 36.5–37.4 km | 227 |
| 17.5–18.4 km | 208 | | 37.5–38.4 km | 228 |
| 18.5–19.4 km | 209 | | 38.5–39.4 km | 229 |
| 19.5–20.4 km | 210 | | 39.5–40.4 km | 230 |
| 20.5–21.4 km | 211 | | 40.5–41.4 km | 231 |
| 21.5–22.4 km | 212 | | 41.5–42.4 km | 232 |
| 22.5–23.4 km | 213 | | 42.5–43.4 km | 233 |
| 23.5–24.4 km | 214 | | 43.5–44.4 km | 234 |
| 24.5–25.4 km | 215 | | 44.5–45.4 km | 235 |
| 25.5–26.4 km | 216 | | 45.5–46.4 km | 236 |
| 26.5–27.4 km | 217 | | 46.5–47.4 km | 237 |
| 27.5–28.4 km | 218 | | 47.5–48.4 km | 239 |
| 28.5–29.4 km | 219 | | 48.5–49.4 km | 240 |
| 29.5–30.4 km | 220 | | … | … |
| | | | 63.5–64.4 km | **255** (max) |

Note: value 238 is skipped in the source (47.5–48.4 goes 237 → 239).

---

## Part 4 — Counter-battery fire

Off-map range values are also the counter-battery tier system.

> A gun at range value **X** can engage enemy batteries at range values
> **X−1** and below reliably, **X** sometimes, but **not X+1** or higher.

Example: a 203 mm gun (range 203 on a 12.5–13.4 km real range)
can counter-battery 200–202 and sometimes 203, but not 204+.

Higher range value = longer-ranged gun = wider counter-battery reach.
This makes the range encoding formula directly relevant to force composition.
Counter-battery fire does **not** use the target unit's Size value —
off-map artillery size is ignored for this calculation.

---

## Part 5 — FOO system and scatter

### 5a. Scatter baseline

Shell scatter is determined by the observing unit (FOO / FO vehicle).
Without any special equipment, scatter is at its default maximum.

### 5b. Scatter reduction steps

Three stacking bonuses reduce scatter, applied when conditions are met:

| Condition | Requirement | Effect |
|-----------|------------|--------|
| Laser Range Finder | FOO has RF ≥ 20 **and** target hex is in LOS | Scatter reduced |
| GPS | FOO has EW = 15 | Scatter reduced further (stacks with laser RF) |

GPS + Laser RF together give the minimum possible scatter.

### 5c. Artillery priority hexes

Priority hexes are pre-registered target locations that reduce or
eliminate fire delay for plotted missions.

**Base allocation by mission type:**

| Mission | Starting priority hexes |
|---------|------------------------|
| Meeting engagement | 1 |
| Advance (hasty attack) | 3 |
| Assault | 5 |
| Delay | 2 |
| Defend | 4 |
| Scenarios | Up to 10 (designer-set) |

**Additional hexes per FOO purchased** (not in meeting engagements):

| FOO equipment | Additional hexes |
|--------------|-----------------|
| Basic FOO (any year) | +1 per FOO |
| Year > 1970 + FOO with laser RF (RF ≥ 20) | +1 per such FOO |
| Year > 1970 + FOO with GPS (EW = 15) | +2 per such FOO |

**Meeting engagement exception** (year > 1970 only):
- No +1 for the FOO himself
- +1 still granted for laser RF
- +2 still granted for GPS

Maximum cap: **10 priority hexes** regardless of FOO count.

**Note:** The AI does not use priority hexes at all and uses the full
default fire delay for all missions.

**Worked examples:**

*Meeting engagement, 2007, 1× FOO with laser RF + GPS:*
`1 (base) + 1 (post-1970) + 1 (laser RF) + 2 (GPS) = 5 hexes`

*Advance, 2007, 1× FOO with laser RF + GPS:*
`3 (base) + 1 (FOO) + 1 (post-1970) + 1 (laser RF) + 2 (GPS) = 8 hexes`

---

## Part 6 — Blast radius and area effect

Blast propagates from the impact hex outward. Radius scales with
calibre and weapon type (R key shows radius during bombardment).

| Round type | Blast behaviour |
|-----------|----------------|
| Standard HE | Radius scales with calibre; larger rounds lethal further out |
| 2,000 lb bomb | Potentially lethal area up to ~200 yards (~4 hexes) from impact |
| Cluster (on-map) | Minimum 1 hex radius; more even distribution across area |
| Cluster (air-dropped) | Minimum 2 hex radius (higher delivery speed = wider footprint) |

**Range falloff rule:**
- Blast effect reduces with distance from impact hex.
- **Armoured vehicles ≥ 2 hexes from impact:** suppressed but not
  destroyed by fragments. Exception: cluster munitions affect them
  more evenly and can destroy at range.
- **Cluster vs HE:** cluster damage is more uniform across the radius;
  HE damage falls off sharply beyond the inner hexes.

**Dug-in and cover modifiers apply** — units in trenches, foxholes, or
buildings take reduced blast damage. Buildings collapsing under heavy
fire cause casualties to occupants (stone > wood/other).

---

## Part 7 — Mortars

### 7a. Movement rate by calibre

Heavier mortars sacrifice mobility for range:

| Calibre | Movement points |
|---------|----------------|
| 40–59 mm | 6 |
| 60–69 mm | 5 |
| 70–79 mm | 4 |
| 80–90 mm | 3 |
| 91–110 mm | 2 |
| 111–125 mm | 1 |
| 126 mm+ | 0 (immobile) |

> Standardised crew sizes assume the following:

| Calibre | Crew per mortar |
|---------|----------------|
| 60 mm | 3 |
| 3"/81 mm | 4 |
| 90/107 mm | 4 |
| 120 mm | 6 |
| 160 mm | 8 |
| 240 mm | 12 (single mortar only) |

---

## Part 8 — Multiple Rocket Launchers (MRL)

MRLs follow a split-slot design pattern:

> **ROF = actual rockets fired ÷ 2**
> Two weapon slots, each loaded with ROF rounds (= half the salvo).
> Both slots fire in one turn, achieving the full rocket count.

Example: a 24-rocket BM-21 salvo
- ROF = 24 ÷ 2 = **12**
- Slot 1: 12 rockets, Slot 2: 12 rockets
- Full turn fire: 24 rockets total

Off-map MRL use class 14 (Minelets/FASCAM) with HE ammo in some cases
rather than AP, so rounds appear on the HE menu rather than the cluster
button. Adding "CM" to the weapon name is recommended to flag this.

---

## Part 9 — Minelet / FASCAM artillery

- Minelet rounds must use **off-map classes 210 and 211 only**.
- ROF is deliberately very low — a real battalion of 155 mm howitzers
  takes ~30 minutes to seed a useful 500 m minefield.
- Do **not** give on-map units minelet ammo — reaction fire will
  accidentally seed minefields on the firer's own side of the map.
- Minelet ammo must always be AP type.

---

## Part 10 — AA gun ammo loadouts (reference)

Not strictly indirect-fire artillery, but included for completeness
as they use the same ROF/ammo system:

| Calibre | Ammo (towed/static) |
|---------|---------------------|
| 14.5 mm | 60 |
| 20 mm | 45 |
| 23–59 mm | 40 |
| Fort-type AA gun | 120 |

Vehicle AAMGs: 90 rounds.
Vehicle TMG / CMG / BMG: 120 rounds.

---

## Part 11 — What we do not have

- The exact scatter formula (inputs confirmed: RF, EW, LOS — magnitude
  of each reduction unknown).
- How fire delay is calculated in turns (only know priority hexes reduce it).
- The exact blast radius formula mapping calibre → hex radius.
- Whether ROF degrades for on-map artillery under suppression the same
  way it does for direct-fire units (likely yes, but unconfirmed).

---

*Compiled from: MHMBTHelp.htm (Don Goodbrand, 2003), Manual02.htm,
Manual03.htm, Manual04.htm (Camo Workshop Game Guide),
SPMBT_DATA_ANALYSIS.md, patch info.txt v2.0.*
