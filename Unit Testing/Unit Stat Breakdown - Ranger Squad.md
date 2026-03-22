# Unit Stat Breakdown — Ranger Squad (USA, OB Slot 440)

This document walks through every stat on a mid-era Ranger Squad and its
four weapons, explaining what each value means and how infantry mechanics
differ from vehicles.

---

## Unit Identity

| Field | Value | Meaning |
|-------|-------|---------|
| **Name** | Ranger Squad | Display name in the encyclopedia and in-game |
| **Nation** | USA (ID 12) | Determines which OB file the unit belongs to |
| **OB Slot** | 440 | Position in the nation's order of battle list |
| **Class** | Rangers (ID 111) | Elite infantry class. Unit class determines formation placement rules and what roles the unit fills. Rangers are not a mortar or artillery class, so they **cannot** fire indirectly — all weapons are direct fire only |
| **Cost** | 35 | Very cheap compared to the M1A2's 463. You can field roughly 13 Ranger Squads for the price of one Abrams. Infantry are the volume element of any force |
| **Availability** | Jan 1994 – Dec 2014 | Long availability window. Earlier and later Ranger variants have different weapon loadouts |

---

## Physical Stats

| Stat | Value | What It Does |
|------|-------|-------------|
| **Size** | 1 | Scale 0–6. Size 1 is very small — hard to spot and hard to hit. Compare to the Abrams at Size 5. A Size 1 infantry section is not the same visible profile as a Size 1 vehicle; the scale is relative within category. Enemies need to get closer to detect this unit, and even once spotted, to-hit is penalised |
| **Crew** | 10 | The squad's manpower and its hit point pool. 10 men is a large squad — this directly makes the unit tougher (absorbs more hits before destruction) AND more lethal (see crew-count multiplier below). Each casualty reduces both survivability and firepower. 10-man squads last significantly longer than 5-man teams |
| **Speed** | 6 | Movement points per turn. Infantry are slow — 6 MP means roughly 2–3 hexes per turn depending on terrain. **Critical rule:** expending ≥ half MP (3+) sets the "moving fast" flag. For infantry this is doubly dangerous: it penalises your accuracy AND makes you **more vulnerable** to incoming fire (the opposite of vehicles, where movement mainly hurts the firer's own accuracy) |
| **Swim Speed** | 0 | Cannot swim across water hexes |
| **Move Class** | Default (ID 0) | Foot infantry. Pays standard infantry terrain costs — can enter all terrain types but moves slowly through woods, buildings, etc. |

---

## Electronics & Sensors

| Stat | Value | What It Does |
|------|-------|-------------|
| **Radio** | 90% | Chance radio works each turn. Allows the squad to be rallied by its commander from anywhere on the map. 90% is reliable. Without a working radio, the commander must be within ~3–4 hexes (voice range) to rally |
| **Fire Control (FC)** | 0 | Infantry squads have no fire control computer. FC primarily matters for vehicles engaging moving targets. Infantry accuracy comes from crew count and weapon accuracy instead |
| **Stabiliser** | 0 | No stabiliser. Infantry don't use stabilisers — their movement accuracy penalty is handled differently (see movement state below) |
| **Vision** | 10 | Basic night vision goggles. Extends spotting range by 10 hexes beyond the map visibility setting. Compare to the Abrams' Vision 40 (thermal imager) — the Rangers can't see through smoke and have much shorter night spotting range. However, infantry on foot are inherently **better spotters** than vehicles in daylight due to eyes-at-ground-level rules |
| **Range Finder (RF)** | 0 | No rangefinding equipment. Infantry don't benefit from laser RF like vehicles do. Tripod-mounted weapons (MMGs, AGLs) would get RF=1 and FC=1 as a default bonus, but squad weapons don't |
| **Nr S/D** | 0 | No smoke dischargers. Infantry can use smoke grenades (if issued) or call for smoke from mortars/artillery, but have no onboard discharger system |
| **EW** | 0 | No electronic warfare / active protection systems |

---

## Survivability & Armour

### Survivability Rating

| Stat | Value | What It Does |
|------|-------|-------------|
| **Survivability** | 0 | Not applicable for infantry. The Survivability rating is a vehicle crew bail-out mechanic — infantry don't use it. Infantry "survivability" comes entirely from their crew count (hit points), Size, terrain cover, and movement state |

### Armour Values

**All armour values are 0.** Infantry have no armour. Every direct hit from
any weapon has the potential to cause casualties. Protection comes from:

- **Terrain:** woods, buildings, trenches, and foxholes provide cover that
  reduces incoming damage
- **Being stationary/prone:** a stationary infantry section is assumed to be
  prone and using available cover — this is the best defensive posture
- **Size 1:** being small and hard to hit is the Rangers' primary defence
- **NOT moving fast:** infantry moving at ≥ half MP are MORE exposed to
  direct fire and HE, not less. Stay still or move slowly under fire

---

## Weapons Overview

The Ranger Squad carries 4 weapons across 4 slots. Understanding **slot
priority** is even more critical for infantry than vehicles.

| Slot | Weapon | HE Rds | AP Rds | HEAT Rds | Sabot Rds |
|------|--------|--------|--------|----------|-----------|
| 1 | M4A1 Carbine | 90 | 0 | — | — |
| 2 | M249 SAW (2) | 90 | 0 | — | — |
| 3 | 40mm M203 GL | 30 | 10 | — | — |
| 4 | M136/AT4 LAW | 0 | 10 | — | — |

### Why slot order matters for infantry

**Slot 1 gets the crew-count fire multiplier.** This is the single most
important infantry mechanic:

- The M4A1 Carbine in slot 1 fires **multiple internal shots** scaled
  upward by the squad's current crew count. A full 10-man squad generates
  far more shots from slot 1 than a depleted 4-man squad.
- If the M4A1 were in slot 2 instead, it would get only **1 unmodified
  shot** — a massive reduction in firepower.
- This means **casualties are more devastating than suppression** for
  degrading a squad's offensive output. Losing 5 men roughly halves
  slot 1's fire output.

**Slots 2–4 degrade under suppression and damage:**
- Slot 2 (M249 SAW) loses availability earlier
- Slot 3 (M203 GL) drops out under moderate suppression
- Slot 4 (AT4) is the least reliable — often won't fire when the squad
  is under pressure, which means your anti-armour capability is the first
  thing you lose in a firefight

---

## Rate of Fire (ROF)

| Stat | Value | What It Does |
|------|-------|-------------|
| **ROF** | 9 | Maximum shots the unit can fire per turn at full experience. At typical experience (70), this yields roughly ~6 actual shots allocated. Shots are distributed across slots with slot 1 getting priority. Casualties, suppression, and movement all reduce effective shots. ROF 9 is high — Rangers are an offensive infantry unit |

---

## Weapon Breakdowns

### Slot 1 — M4A1 Carbine (Weapon 6)

The squad's primary weapon. Benefits from the crew-count multiplier.

| Stat | Value | What It Does |
|------|-------|-------------|
| **Weapon Class** | 1 (Secondary Inf Weapon) | Despite being in slot 1, the M4A1 is classed as a secondary infantry weapon (LMG/carbine category). **Note:** Only Weapon Class 0 (primary infantry weapon — rifles, SMGs) in slot 1 gets the full crew-count multiplier. Class 1 in slot 1 still gets slot priority but the multiplier is different from Class 0. Some Ranger variants carry the M16 Rifle (Class 0) in slot 1 instead, which gets the full multiplier |
| **Weapon Size** | 1 | Small arm |
| **Warhead Size** | 1 | Minimal. Adds very little random variance to kill/pen rolls. Appropriate for a 5.56mm round |
| **Accuracy** | 6 | Moderate for a carbine. The M16 Rifle has ACC 1, while the M16A4 ACOG has ACC 6. The M4A1's shorter barrel is offset by better ergonomics |
| **Range** | 4 | 4 hexes = 200 metres. Short range — typical for a carbine. The squad must close to within 200m to engage with its primary weapon. Compare to a tank gun at 120 hexes (6 km) |
| **HE Kill** | 3 | Soft-target kill value per hit. Low individually, but multiplied across the full squad's fire output, the collective volume is lethal against exposed infantry |
| **HE Penetration** | 0 | Cannot penetrate any armour with ball ammo |
| **AP Penetration** | 0 | No armour-piercing capability |
| **HEAT Penetration** | 0 | No shaped-charge capability |

**Bottom line:** The M4A1 is a volume-of-fire weapon. It kills infantry
through many small hits, not individual power. Its strength is the slot 1
priority and sustained availability even under pressure.

---

### Slot 2 — M249 SAW (2) (Weapon 224)

The squad automatic weapon. The "(2)" indicates two M249s are represented.

| Stat | Value | What It Does |
|------|-------|-------------|
| **Weapon Class** | 2 (Team Weapon) | MMG/mortar category. Does not get the slot 1 crew multiplier. Fires as a single weapon entry regardless of crew count |
| **Weapon Size** | 0 | Light |
| **Warhead Size** | 1 | Minimal — 5.56mm round |
| **Accuracy** | 24 | **Very high.** This is the squad's most accurate weapon by a wide margin. ACC 24 represents the SAW's bipod stability and sustained fire capability. Compare to the M4A1's ACC 6 |
| **Range** | 10 | 10 hexes = 500 metres. Significantly outranges the M4A1 Carbine. The SAW can engage targets the carbines can't reach, providing suppressive fire at medium range |
| **HE Kill** | 9 | Three times the M4A1's kill value. Each SAW burst is individually more lethal than a carbine shot |
| **HE Penetration** | 0 | Cannot penetrate armour |
| **AP/HEAT** | 0 | No anti-armour capability |

**Bottom line:** The M249 SAW is the squad's primary suppression and
medium-range killing tool. High accuracy and range make it effective
at distances where the carbines are useless. However, being in slot 2,
it's the first weapon lost when the squad takes heavy suppression or
casualties.

---

### Slot 3 — 40mm M203 Grenade Launcher (Weapon 123)

Under-barrel grenade launcher carried by one squad member.

| Stat | Value | What It Does |
|------|-------|-------------|
| **Weapon Class** | 2 (Team Weapon) | Same class as the SAW |
| **Weapon Size** | 1 | Small |
| **Warhead Size** | 3 | Moderate for a 40mm grenade. Adds some random variance to damage rolls — a lucky hit can punch above its weight |
| **Accuracy** | 6 | Moderate. Lobbed trajectory makes it less precise than direct-fire weapons |
| **Range** | 7 | 7 hexes = 350 metres. Good medium range |
| **HE Kill** | 3 | Same as the carbine per hit, but the WH 3 adds more splash potential |
| **HE Penetration** | 1 | Minimal armour effect — can theoretically scratch the lightest vehicles |
| **AP Penetration** | 222 | **The 222 code.** This means the weapon fires HEAT only — no kinetic AP. The game substitutes the HEAT pen value |
| **HEAT Penetration** | 5 | 5 cm shaped-charge penetration. Very low — only effective against unarmoured or very lightly armoured vehicles (trucks, jeeps, some APCs from the side). Won't scratch a tank |

**Ammo loadout:** 30 HE rounds + 10 AP rounds (which are actually HEAT
due to the 222 code). The HE grenades are useful against infantry in cover
(the blast effect helps where bullets don't). The HEAT grenades provide
a marginal anti-vehicle capability.

**Bottom line:** A versatile support weapon — provides minor blast effect
against dug-in infantry and can threaten soft-skinned vehicles. Slot 3
means it drops out under moderate suppression. Don't rely on it in a
sustained firefight.

---

### Slot 4 — M136/AT4 LAW (Weapon 31)

Disposable anti-tank rocket. The squad's only real anti-armour weapon.

| Stat | Value | What It Does |
|------|-------|-------------|
| **Weapon Class** | 2 (Team Weapon) | Same class as SAW and M203 |
| **Weapon Size** | 4 | Medium-large — this is a shoulder-fired rocket |
| **Warhead Size** | 5 | Significant. Adds meaningful random variance to penetration — a lucky hit can exceed the base HEAT pen considerably |
| **Accuracy** | 5 | Low. Unguided rocket — must be fired at short range for any reliability. No fire control system to help |
| **Range** | 4 | 4 hexes = 200 metres. Short range — the squad must be dangerously close to use this weapon against armour |
| **HE Kill** | 7 | Decent blast against soft targets if used in HE mode |
| **HE Penetration** | 2 | Minor armour effect from blast |
| **AP Penetration** | 222 | HEAT-only weapon (222 code) |
| **HEAT Penetration** | 42 | **42 cm at any range.** This is a respectable penetration value. It will defeat: APC frontal armour, most IFV frontal armour, tank side armour on many Cold War-era tanks (T-62 hull side = 8 cm steel), and tank rear armour on nearly everything. It will NOT penetrate: modern MBT frontal armour (M1A2 turret front HEAT = 147), or turret fronts on most medium tanks |

**Ammo loadout:** 0 HE rounds + 10 AP rounds (HEAT). The AT4 is a pure
anti-armour weapon. 10 rounds is generous for a disposable launcher —
represents multiple AT4 tubes carried by the squad.

**Bottom line:** The AT4 is the squad's lifeline against armoured vehicles,
but it has three critical limitations:
1. **Slot 4** — least reliable under suppression. When you need it most
   (armour bearing down on you), it's most likely to not fire
2. **Short range** (200m) — you must be very close, where the target's
   return fire is most accurate
3. **No guidance** (ACC 5, no FC/RF) — miss probability is high, especially
   against moving targets

---

## Infantry Movement — How It Differs from Vehicles

This is one of the most important differences between the Ranger Squad
and the M1A2 Abrams:

| State | Accuracy | Vulnerability | Notes |
|-------|----------|---------------|-------|
| **Stationary / prone** | Best | **Best protected** | Assumed to be using cover, prone, in best defensive posture. This is the optimal state for both offence and defence |
| **Moving 1 hex** | Small penalty | Moderate | Careful advance or short dash. Acceptable risk |
| **Moving fast (≥3 MP)** | Significant penalty | **Increased — more exposed** | Infantry moving fast are standing up, bunched, and exposed. They take MORE damage from direct fire and HE. This is the **opposite** of vehicles |
| **Just dismounted** | Worst | **Worst** | Infantry who dismount from a transport that moved are treated as bunched up AND moving fast. An enemy burst at this moment causes maximum casualties. **Always dismount in cover** |

---

## Putting It All Together — How the Rangers Fight

### Engagement sequence

```
1. SPOT — Can the Rangers see the target?
   Vision 10 (basic NVG) + infantry on foot = good ground-level spotting.
   Cannot see through smoke (no TI). Best when stationary.
   Infantry are inherently better spotters than vehicles.

2. TO-HIT — Do the shots connect?
   No FC, no RF, no stabiliser. Accuracy comes from:
   - Weapon ACC values (SAW 24, Carbine 6)
   - Crew count multiplier on slot 1
   - Movement state (stationary = best)
   - Target's Size and movement

3. EFFECT — What damage is done?
   vs. Infantry: M4A1 volume fire + SAW sustained fire = lethal.
     10-man squad pumping multiple slot 1 shots + SAW bursts shreds
     exposed infantry.
   vs. Light armour: AT4 HEAT 42 cm defeats APCs and IFV flanks.
   vs. MBT: AT4 to the side or rear is the only option.
     Frontal engagement with an MBT = suicide.
```

### Defensive profile

```
No armour. No Survivability rating. Defence comes from:
- Size 1: hard to spot, hard to hit
- Terrain: woods and buildings dramatically improve survival
- Staying still: prone infantry in cover is the hardest target
- 10 crew: large squad absorbs casualties before becoming ineffective
- DON'T move fast under fire: moving fast = more casualties
```

### Tactical summary

| Strength | Weakness |
|----------|----------|
| Size 1 — very hard to spot and hit | No armour — any hit causes casualties |
| 10-man squad — large health pool | Speed 6 — very slow; can't reposition quickly |
| ROF 9 — high volume of fire | Vision 10 — can't see through smoke, short night range |
| SAW ACC 24 at 500m — excellent suppression | No FC/RF/Stabiliser — accuracy is purely weapon-based |
| AT4 HEAT 42 — can threaten armour sides/rear | AT4 in slot 4 — least reliable under pressure |
| Cost 35 — very cheap, field many squads | Moving fast increases vulnerability (opposite of vehicles) |
| Infantry spot better than vehicles on foot | No smoke dischargers — must rely on external smoke |
| Terrain cover is highly effective | Dismounting from fast transport is extremely dangerous |

---

## Comparison: Ranger Squad vs. M1A2 Abrams

| Factor | Ranger Squad | M1A2 Abrams |
|--------|-------------|-------------|
| **Cost** | 35 | 463 (13× more expensive) |
| **Size** | 1 (hard to find) | 5 (easy to find) |
| **Crew/HP** | 10 | 4 |
| **Speed** | 6 MP | 22 MP |
| **Armour** | None | 61–147 cm equivalent |
| **Best AT weapon** | AT4: HEAT 42 at 200m | 120mm Sabot 93 at 6,000m |
| **Anti-infantry** | M4A1 volume + SAW suppression | MG only (no main gun HE) |
| **Vision** | 10 (NVG) | 40 (Thermal Imager) |
| **FC / RF** | 0 / 0 | 45 / 22 (laser) |
| **Primary accuracy driver** | Crew count × slot 1 multiplier | FC + RF + halt state |
| **Movement vulnerability** | Moving fast = more exposed | Moving fast = less accurate but not more vulnerable |
| **Spotting quality** | Excellent (infantry on foot) | Good (vehicle) |
| **Terrain use** | Critical — cover is the only defence | Important but armour provides baseline protection |

The Ranger Squad and the M1A2 Abrams are complementary, not interchangeable.
Rangers hold ground, spot targets, clear buildings, and provide anti-infantry
volume. The Abrams destroys armour at range and punches through defended
positions. Neither does the other's job well.

---

*Example unit data from USA OB (obat012.obf). Rules drawn from
To-Hit Mechanics, Damage and Suppression, Weapon Penetration at Range,
and Spotting and Visibility reference documents.*
