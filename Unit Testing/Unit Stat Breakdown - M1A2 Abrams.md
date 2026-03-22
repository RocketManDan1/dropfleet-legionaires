# Unit Stat Breakdown — M1A2 Abrams (USA, OB Slot 24)

This document walks through every stat on the M1A2 Abrams and its primary
weapon, the 120mm M256 gun, explaining what each value means in gameplay terms.

---

## Unit Identity

| Field | Value | Meaning |
|-------|-------|---------|
| **Name** | M1A2 Abrams | Display name in the encyclopedia and in-game |
| **Nation** | USA (ID 12) | Determines which OB file the unit belongs to |
| **OB Slot** | 24 | Position in the nation's order of battle list |
| **Class** | MBT (ID 59) | Main Battle Tank — determines movement rules, targeting priority, and what roles it can fill in formations |
| **Cost** | 463 | Purchase cost in scenario/campaign points. Higher = more capable but fewer you can buy |
| **Availability** | Jan 1994 – Dec 1998 | The calendar window during which this variant can be purchased. Outside this window, earlier or later Abrams variants appear instead |

---

## Physical Stats

| Stat | Value | What It Does |
|------|-------|-------------|
| **Size** | 5 | How big the unit appears on the battlefield. Scale is 0–6. Larger = easier to spot AND easier to hit. Size 5 is typical for a full-size MBT. A sniper (Size 0) is dramatically harder to both find and shoot |
| **Crew** | 4 | The unit's hit point pool. Each penetrating hit can kill a crewman. At 0 crew the unit is destroyed. Crew also affects Rate of Fire — fewer crew = fewer shots. The M1A2's 4-man crew (commander, gunner, loader, driver) is standard for Western MBTs |
| **Speed** | 22 | Maximum movement points per turn. On tracked movement class, 1 MP ≈ 1 hex on roads, more on rough terrain. 22 MP is fast — Abrams is one of the quicker MBTs. **Critical rule:** expending ≥ half MP (11+) in a turn sets the "moving fast" flag, which heavily penalises accuracy and persists into the next turn |
| **Swim Speed** | 0 | Cannot swim. A value > 0 would allow water crossing at that speed |
| **Move Class** | Track (ID 4) | Tracked vehicle. Determines terrain movement costs (tracks handle mud, snow, and rough ground better than wheels) |

---

## Electronics & Sensors

| Stat | Value | What It Does |
|------|-------|-------------|
| **Radio** | 91% | Chance that radio communication works each turn. Affects rally (commanders can rally units anywhere on the map via radio) and artillery call-for-fire. 91% is very reliable — failure is rare but possible |
| **Fire Control (FC)** | 45 | The fire control computer's quality. Scale is 0–100+. FC is most important against **moving targets** — it offsets the penalty for shooting at a target that is changing position. At 45, the M1A2 has excellent modern FCS. Values above 35 get a bonus bump from the v2.0 patch formula. FC ≥ 100 would indicate AA radar (not applicable here) |
| **Stabiliser** | 5 | Gun stabilisation system quality. Allows the tank to **maintain target lock while moving** and reduces the accuracy penalty from own movement. Without a stabiliser, moving breaks your lock on the target entirely. Value 5 is a high-end modern stabiliser — the M1A2 can engage while on the move, though firing from a halt is still more accurate |
| **Vision** | 40 | Night/all-weather vision capability. Vision 40 = **Thermal Imager (TI)**. This is the threshold for seeing through smoke (requires 5–6 smoke hexes to degrade TI), spotting hidden units that fire (slight bonus), and extending effective spotting range well beyond the map visibility setting. The formula is: `effective spotting range = map visibility + Vision` |
| **Range Finder (RF)** | 22 | Rangefinding equipment. Value 20+ = **Laser Range Finder**. Provides a significant to-hit bonus, especially when the tank is stationary. Laser RF also improves artillery scatter when used on a Forward Observer. Combined with FC 45, this gives the M1A2 outstanding first-round hit probability from the halt |
| **Nr S/D** | 1 | Number of smoke discharger salvos. Press D in-game to fire a defensive smoke screen. The M1A2 gets 1 salvo — use it wisely to break LOS when caught in the open |
| **EW** | 0 | Electronic warfare / active protection. 0 = none. Values 1–2 would be Arena (active anti-missile), 3–4 would be VIRSS (anti-thermal smoke). The M1A2 has no active protection system in this data set |

---

## Survivability & Armour

### Survivability Rating

| Stat | Value | What It Does |
|------|-------|-------------|
| **Survivability** | 6 | Scale 0–6. Determines crew survival chance after a **normal** penetrating hit (where pen ≥ armour but pen < armour + 10). At S=6 (maximum), the crew has the best possible chance of surviving a penetration — representing blowout panels, compartmentalised ammo storage, and modern crew protection. **Does not help** against catastrophic penetration (pen ≥ armour + 10), which destroys the vehicle outright regardless of S rating |

### Armour Values

Armour is listed in approximate centimetres of effective steel. Three layers
are checked in order: ERA → Anti-HEAT → Steel. All values are per facing.

#### Steel Armour (vs. all round types)

| Facing | Value | Notes |
|--------|-------|-------|
| Hull Front (HF) | 61 | ~61 cm effective steel. The glacis plate — strongest hull facing |
| Hull Side (HS) | 12 | Much thinner. Flanking shots are dangerous |
| Hull Rear (HR) | 9 | Weakest hull facing. Rear shots are near-guaranteed penetrations from any tank gun |
| Turret Front (TF) | 89 | The strongest single armour value. The turret cheeks are where composite armour is thickest |
| Turret Side (TS) | 30 | Moderate — better than hull side, still vulnerable to modern guns |
| Turret Rear (TR) | 15 | Weak |
| Top | 8 | Thin. Top-attack weapons (artillery, cluster bombs, top-attack ATGMs) exploit this |

#### Anti-HEAT Armour (vs. shaped-charge rounds only)

These values are always ≥ the steel values. The difference represents
composite armour arrays and spaced armour that specifically defeat HEAT jets.

| Facing | Value | vs. Steel | What This Means |
|--------|-------|-----------|-----------------|
| Hull Front | 94 | +33 over steel | A HEAT round must penetrate 94 cm equivalent, not just 61. Major upgrade over bare steel |
| Hull Side | 68 | +56 over steel | Side skirts / composite side arrays. HEAT rounds face 68 cm, not 12 |
| Hull Rear | 30 | +21 over steel | Some rear protection from shaped charges |
| Turret Front | 147 | +58 over steel | Massive — this is the hardest value on the entire tank to defeat with HEAT. Only top-end ATGMs (TOW-2A/B, Kornet) can reliably penetrate |
| Turret Side | 48 | +18 over steel | Moderate composite protection |
| Turret Rear | 33 | +18 over steel | Light composite |
| Top | 16 | +8 over steel | Minimal HEAT protection on top |

#### ERA (Explosive Reactive Armour)

All ERA values are **0** on the M1A2. It relies entirely on passive
composite armour. Some Russian tanks (T-72B, T-80U) use ERA values of
5–20 for additional shaped-charge and kinetic protection.

---

## Weapons Overview

The M1A2 carries 4 weapons across 4 slots. Slot 1 is the most important —
it fires most reliably under all conditions (damage, suppression). Slots 2–4
degrade first as the unit takes casualties or suppression.

| Slot | Weapon | HE Rds | AP Rds | HEAT Rds | Sabot Rds |
|------|--------|--------|--------|----------|-----------|
| 1 | 120mm M256 94 | 0 | 0 | 20 | 20 |
| 2 | 7.62mm M240 CMG | 120 | 0 | — | — |
| 3 | 50 cal AAMG | 90 | 0 | — | — |
| 4 | 7.62 M240 AAMG | 90 | 0 | — | — |

**Ammo notes:**
- The main gun carries **0 HE and 0 AP** but has 20 HEAT and 20 Sabot rounds.
  This means the M1A2 engages armour with Sabot (best at close-medium range)
  or HEAT (consistent at any range), but has **no dedicated HE anti-infantry
  round** from the main gun. Infantry suppression falls to the MGs.
- HEAT and Sabot are **slot 1 only** ammo types — only the main gun can use them.
- The coaxial MG (slot 2) and AA MGs (slots 3–4) carry only HE ammo
  (representing ball ammunition), used against soft targets and infantry.

---

## Rate of Fire (ROF)

| Stat | Value | What It Does |
|------|-------|-------------|
| **ROF** | 6 | Maximum shots the unit can fire per turn at full experience. Actual shots allocated depend on: crew experience (exp 70 with ROF 6 gets ~4–5 shots), damage taken, movement this turn, and suppression level. High FC can sometimes add +1 shot. Losing crew directly reduces effective ROF |

---

## Primary Weapon Breakdown — 120mm M256 94

This is the M1A2's main gun (weapon slot 247 in the USA weapons table).

| Stat | Value | What It Does |
|------|-------|-------------|
| **Weapon Class** | 7 (Gun/Howitzer, >101mm) | Determines fire rules — this is a direct-fire tank gun. Cannot fire indirectly. Gets standard vehicle to-hit modifiers |
| **Weapon Size** | 0 | Legacy field, no longer used in gameplay |
| **Warhead Size (WH)** | 7 | A random fraction (none, some, or all) of this value is added to penetration and kill rolls on each shot. WH 7 is large — it adds meaningful variance to damage. Larger WH also means bigger explosions (crater damage, bridge destruction potential) |
| **Accuracy (ACC)** | 14 | Baseline hit probability modifier. Higher = more accurate. Formula: barrel length ÷ calibre ÷ 4. ACC 14 is good for a 120mm smoothbore. Combined with FC 45 and RF 22, the M1A2 has excellent hit probability |
| **Range** | 120 | Maximum range in hexes. At 50m/hex, that's 6,000 metres — typical for a modern tank gun. To-hit degrades with range; beyond ~40 hexes (2 km), firing from a full halt is almost mandatory |
| **HE Penetration** | 3 | Penetration value of HE rounds against armour. Does not degrade with range. Value 3 is very low — the 120mm HE round can only penetrate the lightest armour (trucks, jeeps). Against anything with real armour, HE just suppresses. **Note:** the M1A2 carries 0 HE rounds anyway |
| **HE Kill** | 15 | Soft-target kill value. Used against infantry and unarmoured vehicles. Scales with WH. Value 15 is potent — if the M1A2 had HE ammo, each round would devastate infantry in the open |
| **AP Penetration** | 0 | Standard AP penetration at muzzle. Value 0 means no conventional AP ammo — the M1A2 skips AP entirely in favour of Sabot and HEAT |
| **AP Kill** | 0 | Not applicable (no AP ammo) |
| **Sabot Penetration** | 93 | APFSDS penetration at muzzle in cm. 93 cm is outstanding — this will frontally penetrate nearly any tank in the game at combat ranges. Sabot degrades with range (faster than AP), so it's strongest at close-medium range. At ~2/3 max range the advantage over AP narrows |
| **Sabot Range** | 120 | Maximum effective range for Sabot rounds (same as the gun's max range in this case). For ATGMs this field would hold minimum range instead |
| **HEAT Penetration** | 70 | Shaped-charge penetration in cm at **any range** — does not degrade. 70 cm HEAT will defeat most tank side armour and many frontal profiles, but struggles against the heaviest turret fronts (T-80U turret front HEAT protection ≈ 90+). HEAT must defeat ERA first (if present), then anti-HEAT armour |

### Ammo selection guide for the 120mm M256

| Ammo | Best Use Case | Penetration Behaviour |
|------|--------------|----------------------|
| **Sabot** | Close-medium range vs. heavy armour (other MBTs frontally) | 93 cm at muzzle, degrades to 0 at max range. Best within ~40 hexes |
| **HEAT** | Long range vs. armour, or when Sabot can't penetrate (side shots, lighter vehicles) | 70 cm at any range. Consistent but blocked by ERA and anti-HEAT armour |

---

## Putting It All Together — How the M1A2 Fights

### Engagement sequence (what happens when the M1A2 shoots)

```
1. SPOT  — Can the M1A2 see the target?
   Vision 40 (TI) + stationary = excellent spotting.
   Sees through smoke. Spots hidden units that fire.

2. TO-HIT — Does the round connect?
   ACC 14 + FC 45 + RF 22 (laser) + Stabiliser 5
   From a full halt at medium range → very high hit probability.
   Moving fast → heavy penalty, but stabiliser partially compensates.

3. EFFECT — Does it penetrate?
   Sabot at 20 hexes (1 km) → ~60-70 cm pen (after range decay)
   vs. T-72B hull front (Steel 44, HEAT 50, ERA 5-9)
   → Sabot defeats ERA (if Kontakt type), then easiList oly defeats 44 cm steel.
   → Catastrophic kill likely (pen exceeds armour by 10+, bypasses Survivability).
```

### Defensive profile

```
Frontal engagement:
  Turret front HEAT 147 → only top-end ATGMs and 125mm Sabot threaten it.
  Hull front Steel 61 → vulnerable to modern 125mm Sabot at close range.
  Survivability 6 → even if penetrated, good chance of crew survival.

Flanking engagement:
  Hull side Steel 12 → almost any tank gun or heavy ATGM penetrates.
  Hull side HEAT 68 → shaped charges face better odds here, but still dangerous.

Top attack:
  Top armour 8 (Steel) / 16 (HEAT) → cluster bombs, top-attack ATGMs,
  and artillery are the M1A2's biggest threats.
```

### Tactical summary

| Strength | Weakness |
|----------|----------|
| Turret front is nearly impenetrable to HEAT | No HE ammo — relies on MGs for infantry work |
| Excellent FCS (FC 45 + RF 22 + Stab 5) — accurate on the move and at range | Hull sides are thin (Steel 12) — flanking is lethal |
| Thermal imager sees through smoke | Top armour is weak (8) — vulnerable to artillery and top-attack weapons |
| Survivability 6 — crew survives normal penetrations | No ERA, no active protection (EW 0) |
| Fast (Speed 22) — can reposition quickly | Only 1 smoke discharger salvo |
| Sabot pen 93 — defeats nearly all frontal armour at combat range | Cost 463 — one of the most expensive units in the US roster |

---

*Example unit data from USA OB (obat012.obf). Rules drawn from
To-Hit Mechanics, Damage and Suppression, Weapon Penetration at Range,
and Spotting and Visibility reference documents.*
