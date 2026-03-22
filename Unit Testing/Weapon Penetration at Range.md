> **SOURCE RESEARCH ONLY** — This document is a WinSPMBT data reference, not authoritative game rules. For Dropfleet Legionaires game rules, see `New Direction Docs/Combat Formula Spec.md` §6–9.

# WinSPMBT — Weapon Penetration at Range

Sources: APCalc_Help.TXT, MHMBTHelp.htm, Manual03.htm,
SPMBT_DATA_ANALYSIS.md

Scale: 1 hex = 50 metres.

---

## Part 1 — The four ammo types and how range affects them

### 1a. AP (Armour Piercing)

- Stored as the AP byte in the weapon record. Represents penetration at
  **point blank / muzzle range** in cm.
- **Degrades linearly with range**, dropping to zero at approximately
  the weapon's maximum AP range.

Approximate formula:

> `AP_pen(R) ≈ AP_muzzle × (1 − R / AP_range_hexes)`

Where R is range in hexes and AP_range_hexes is the weapon's max range.

- Example: a gun with AP 30 and max range 60 hexes hits for roughly
  pen 15 at 30 hexes (half range) and pen 0 at 60 hexes.
- A drop to zero or −1 in APCalc output indicates max range exceeded or
  that ammo type is not rated for the weapon.

### 1b. Sabot (APFSDS / APCR)

- Stored as the Sabot byte. Represents penetration at **muzzle** in cm.
- Higher base value than AP for the same weapon generation.
- **Degrades faster than AP** — sabot loses energy more quickly over
  distance. At long ranges, AP from the same gun may match or exceed
  sabot penetration.
- Sabot max range is encoded in the Sabot range byte. For ATGMs and
  weapons with a minimum engagement range, this byte holds the
  **minimum range** instead.
- Only **slot 1** weapons may be issued sabot ammo.

### 1c. HEAT (High Explosive Anti-Tank)

- Stored as the HEAT byte. Represents penetration in cm at **any range**
  up to the weapon's maximum.
- **Not affected by range** — a HEAT round at hex 1 and hex 50 delivers
  the same base penetration value.
- However, HEAT penetration is heavily influenced by **random variance
  from Warhead Size** (see Part 2).
- HEAT must defeat ERA (if present) before reaching the steel armour layer.
  Anti-HEAT armour values are checked instead of steel armour for shaped
  charges.
- Weapon with AP byte = 222: fires HEAT only (ATGMs, RRs, LAWs). The
  game substitutes the HEAT value for penetration regardless of range.
- Only slot 1 weapons may be issued HEAT ammo.

### 1d. HE (High Explosive)

- Stored as the HE penetration byte. Represents penetration at **any
  range** — does not degrade.
- Primary purpose is defeating **soft targets and unarmoured vehicles**.
  Against armoured targets, HE usually requires **over-penetration**
  (pen noticeably greater than armour value), especially at low warhead
  sizes — a marginal pen result will not defeat armour.
- HE penetration is the **most heavily influenced by Warhead Size** of
  any ammo type. A large warhead hit may significantly exceed the base
  HE pen value; a very small warhead may not.
- APCalc shows only one result for HE (at 50 yards) since range is not
  a factor, but the result shown is an average over 1000 samples and
  will vary between runs due to the WH random component.

---

## Part 2 — Warhead Size and penetration variance

Warhead Size (WH) is not a fixed damage multiplier. On each shot, a
random fraction of the WH value (none, some, or all) is added to the
penetration and kill rolls.

| Ammo | WH influence |
|------|-------------|
| AP | Smaller contribution — AP performance mostly from base stat |
| Sabot | Similar to AP |
| HEAT | Moderate — larger WH HEAT weapons penetrate more on average |
| HE | Largest contribution — WH is the primary driver of HE damage spread |

Effects of WH size on pen spread (APCalc behaviour):
- If resampling a weapon gives significantly different averages, the WH
  random component is large.
- If the pen switches between two numbers frequently: the average sits
  near 50/50 between them.
- If it changes less frequently: the probable pen range is wider.

**"Best" result in APCalc** = the highest single penetration out of
1000 samples. This is a "golden BB" — the luckiest outlier. Do not
design engagements around achieving the "best" result.

---

## Part 3 — Penetration vs. armour resolution

### The penetration threshold

> `Penetration occurs when: pen_value >= armour_value`

For HE this is stricter — over-penetration is generally required unless
warhead size is large. A marginal pen ≈ armour result typically bounces
for HE.

### Catastrophic vs. normal penetration

| Condition | Outcome |
|-----------|---------|
| `pen >= armour + 10` | **Catastrophic penetration** — Survivability bypassed, unit destroyed |
| `pen >= armour` | Normal penetration — Survivability roll applies |
| `pen < armour` | No penetration — suppression only |

### Armour facing applied

Attack direction determines which armour value is checked:

| Facing | Description |
|--------|------------|
| HF | Hull Front |
| HFS | Hull Front Slope |
| Side | Hull Side |
| SideS | Hull Side Slope |
| HR | Hull Rear |
| HRS | Hull Rear Slope |
| Top | Top armour |

Turret values are separate from hull values (turret front, side, rear,
top). The encyclopedia displays hull and turret armour separately.

Oblique shots get an effective armour bonus — the game adds to the
normal facing value when the angle is off-perpendicular.

---

## Part 4 — Range degradation comparison (AP vs Sabot)

```
Penetration
    ^
    |  Sabot (high start, degrades fast)
    | \
    |  \  AP (lower start, degrades slower)
    |   \ \
    |    \ \
    |     \ \
    |      \ \
    |       \\
    |        \\__ AP
    |            \\_____ Sabot
    +-----------------------> Range
   0                   Max
```

The crossover point — where AP pen equals Sabot pen — was lowered
slightly in v2.0 patch changes to the accuracy/smoothbore formula
(item 56). Shorter-barrelled smoothbores (L44, M256) had their
sabot performance slightly reduced, while longer Russian barrels had
theirs trimmed. The specific crossover hex will depend on the weapon.

**Practical implication:** at very long ranges (beyond ~2/3 max range)
the sabot advantage over AP narrows severely. Sabot is most powerful
at close-to-medium range.

---

## Part 5 — APCalc methodology

APCalc averages **1000 samples** per range increment to produce its
output. Displayed values are:

| Column | Meaning |
|--------|---------|
| Average | Mean penetration across all 1000 samples |
| Best | Highest single result of the 1000 — the luckiest outlier |

Increments start at **50 yards (~1 hex)** and continue to and beyond
max range.

**Not included in APCalc:**
- Critical hit weak-spot check (≥ 80% to-hit at ≤ 10 hexes)
- Behind-armour damage calculations
- ERA interactions
- Anti-HEAT armour check

APCalc exclusively models the raw penetration value before it is
compared against armour. All downstream calculations are separate.

---

## Part 6 — Weapon data fields (CSV mapping reference)

Based on the MoBHack CSV export order (unconfirmed column mapping):

| Suspected col | Field | Notes |
|--------------|-------|-------|
| col_22 | HE Penetration | Steel penetration at any range, in cm |
| col_23 | AP Penetration | Muzzle pen in cm; degrades with range |
| col_24 | HEAT Penetration | Pen in cm at any range; shaped charge only |
| col_25 | Sabot / Min Range | Muzzle sabot pen in cm; or ATGM minimum range |
| col_21 | Weapon ID (slot 1) | Index into weapon table |
| col_19 | Rate of Fire | Max shots at full experience |
| col_20 | Range Finder | Affects to-hit at range |

The HE and AP penetration display in the Encyclopaedia is shown as:
`HEpen:APpen` (e.g. `3:28`).

---

## Part 7 — Special cases

### AP = 222

When the AP byte is set to 222, the weapon fires HEAT only. The game
substitutes the HEAT pen value at all ranges. Applies to:
- ATGMs
- Rocket launchers (RPG, LAW, Carl Gustav)
- Recoilless rifles
- Flamethrowers / napalm (no AP at all)
- Some aircraft weapons

### Minimum range (Sabot byte as min range)

For ATGMs and guided weapons, the Sabot byte encodes the **minimum
engagement range** rather than a sabot penetration value. Attempting to
fire at a target inside the minimum range will fail.

### HE penetration vs. HESH

HE penetration applies to any target in the same hex as the explosion —
it cannot be directed at a single target to the exclusion of others in
the hex. True HESH (squash head) behaviour is not separated from HE
in the game engine. Large-WH HE against steel hull front armour is the
closest equivalent.

### Counter-battery and off-map artillery

Counter-battery fire does **not** use the target's Size value for damage
calculation. Off-map unit size is ignored entirely for this purpose.

---

## Part 8 — What we do not have

- The exact AP drawdown curve shape (confirmed approximately linear from
  SPMBT_DATA_ANALYSIS.md, but the exact formula is internal).
- The precise Sabot decay rate relative to AP (confirmed faster, specific
  ratio unknown).
- The exact WH random contribution formula (confirmed as "none, some, or
  all" added to pen/kill per shot, specific dice mechanic unknown).
- How ERA level interacts with HEAT pen value numerically (confirmed
  per-level approximate percent chances, exact formula internal).

---

*Compiled from: APCalc_Help.TXT, MHMBTHelp.htm (Don Goodbrand, 2003),
Manual03.htm (Camo Workshop Game Guide), SPMBT_DATA_ANALYSIS.md.*
