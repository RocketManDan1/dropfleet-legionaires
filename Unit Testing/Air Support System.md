> **SOURCE RESEARCH ONLY** — This document is a WinSPMBT data reference, not authoritative game rules. For Dropfleet Legionaires game rules, see `New Direction Docs/Game Systems Overview.md` (System 6 — Air Support).

# WinSPMBT — Air Support System Reference

Sources: Manual02.htm, Manual05.htm, Manual06.htm, MHMBTHelp.htm,
patch info.txt (v2.0), SPMBT_DATA_ANALYSIS.md

Scale: 1 hex = 50 metres, 1 turn ≈ 5 minutes.

---

## Part 1 — Core architecture

### Fixed wing vs. helicopters

| Type | On/Off map | Player control |
|------|-----------|----------------|
| All fixed-wing aircraft | Off-map | Requested via bombardment menu |
| Helicopters | On-map | Hex-by-hex, like ground units |

Fixed-wing planes are considered Air Force / higher command assets and are
**not** available in campaign cores. Helicopters **are** allowed in cores.

### Strike point system

Air support is rationed by strike points. The game counts **formations**,
not individual aircraft:

- Each strike formation (attack aircraft, attack helo, spotter, bomber,
  SEAD) purchased **deducts 1 strike point**.
- A strike flight added as reinforcements **adds back** the 1 point it deducted.
- Air transport formations do **not** reduce strike points, but require
  at least 1 available strike point to purchase.

**Formation size rules:**
- Strike planes / Wild Weasels: 2–3 aircraft per formation (rarely 3)
- Bombers: flights of 4
- Spotters: 1–2 per formation
- Attack helicopters: typically 2 per formation

Do not build 10-plane strike formations — the game balance will break.
The game uses the **slot 1 unit type** to classify the formation, so if
mixing helo types put attack helos first in the slot order.

---

## Part 2 — Aircraft types

### 2a. Fighter-Bomber (class 44)

The default strike aircraft. Most versatile class.

- Can carry any air-class weapon: cannon, rockets, bombs, cluster, stand-off
  missiles, ARM, PGM, napalm.
- Makes an ingress pass toward the target hex, strafes/bombs, then exits map.
- Can be armoured (front armour = durability; side armour = 360° protection).
- May have night-vision sights (unlike WW2 equivalents).
- If fitted with ARM **and** bombs: fires ARM on ingress, continues run to
  deliver bombs. Exits after delivering all weapons.
- **Returning passes:** the maximum number of return passes can be stored
  in the HEAT Top Armour byte of the weapon entry.
- Cannon strafing operates at two fixed ranges: ~8–10 hexes and ~2–3 hexes.

### 2b. SEAD aircraft / Wild Weasel (class 214)

Specialist anti-radiation platform.

- **ARM auto-targeting:** ARM weapons (Weapon Class 16) automatically home
  on the nearest active enemy AAA unit with FC ≥ 100 (radar). No manual
  targeting of the ARM itself — it fires on ingress.
- AAA target must have its radar active (FC ≥ 100). There is no EMCON.
- If no radar-equipped AAA is active or surviving, ARM rounds cannot fire.
- After launching ARM, SEAD plane continues to strafe the AA unit's hex.
- Wild Weasel planes pull off at long range after ARM launch — they do
  **not** complete a bomb run unless they also carry conventional bombs
  and the ARM was their only stand-off weapon.
- SEAD planes have superior SAM avoidance compared to other aircraft types.
- Must be purchased before other strike planes in the bombardment list —
  the list runs top-to-bottom, so buying SEAD first ensures it flies first.

### 2c. Level Bomber / COIN Bomber (class 62 / 253)

Area bombardment platform.

- Can **only** use weapons with range = 1 hex (iron bombs, napalm, cluster,
  CBU). Cannot carry cannon, stand-off missiles, or guided weapons.
- Does not aim at individual targets: Vision, FC, and RF are all superfluous
  and not used by this class.
- Flies at very high altitude — above some light SAM envelopes.
- A bomber with PGM (e.g. JDAMs) is modelled as a **Fighter-Bomber**, not
  a Level Bomber class.
- Good for arclight-style area saturation missions against known positions.

### 2d. COIN Fighter (class not specified, variant of FB)

- Identical mechanics to the Fighter-Bomber.
- Weapon loadout biased toward infantry and soft targets.
- Less likely to engage armoured vehicles than a standard FB.
- More likely to target detected infantry within the 15-hex targeting circle.

### 2e. Circling Gunship (class 215)

- Armed only with cannon / MG (no bombs or missiles).
- Circles the target hex; fires several area-fire cannon bursts per pass.
- Effective only against enemies with **no serious AA defence**.
- Less useful against armoured targets.

### 2f. Air Observation / Spotter (class 50)

- **Prop planes and UAVs only.** No spotter jets or spotter helicopters.
- Unarmed.
- Flies to the plotted binocular-symbol hex; circles twice; exits if not killed.
- Enters after a short delay (on call, not pre-positioned).
- Quicker reaction than strike planes.
- UAVs are high-altitude flyers, above rifle and AAMG height — require
  proper AA guns or SAMs to engage.
- Large SAMs will **not** waste shots on spotters or UAVs — SAM warhead
  size is filtered against target type.

### 2g. Air Transport / Paratroop Transport (class 53 variant)

- Shown on-map during turn 0 deployment so passengers can be loaded.
- After the deployment phase ends, the aircraft goes off-map.
- Makes one pass to drop paratroopers near the plotted DZ; returns to base.
- Does **not** reduce strike points but requires ≥ 1 strike point available.
- If vehicle/gun crews are loaded onto a transport aircraft and later
  unloaded during deployment, press **J** to reunite the crew with their
  vehicle/gun.
- Low visibility (< 10 hexes) increases landing accident rates for
  paratroopers and gliders.

### 2h. Glider

- Unpowered. Must land in flat, open terrain.
- Same low-visibility accident penalty as paratroop transports.

---

## Part 3 — Helicopter specifics

### 3a. On-map control

Helicopters move hex-by-hex. Altitude is listed on the unit info screen.

- Changing altitude costs MP — climbing to high altitude may exhaust MP.
- AI helicopters occasionally pop up to high altitude to spot, then drop down.

### 3b. Weapon classes and AAA interaction

| Weapon class | AAA capability |
|---|---|
| WC 4 (FLAK/AAMG) | Fires at **all** helicopters and aircraft regardless of movement or altitude |
| WC 5 (Light autocannon) | Does **not** engage aircraft or helicopters; use WC 19 for helo autocannons |
| WC 19 (Autocannon, high-angle) | Fires on helos during opportunity fire if both firer and target have moved only a little; allows helo vs. helo opfire |

**Important:** if a helicopter is expected to engage other helicopters,
its autocannon **must** be WC 19. WC 5 cannot shoot at helos.

### 3c. Armour and durability

- **Front armour byte** = general durability (how much damage before destruction).
- **Side armour byte** = protection factor applied uniformly 360 degrees.
- Heavy helicopter class (205) is hard-coded to be more vulnerable to SAMs
  due to size.
- Survivability field is zeroed for helicopters — it is not used.

### 3d. Ammo loadouts

- Helicopter MG / cannon: **20 rounds**
- Fixed-wing cannon: **6–20 rounds** depending on type

### 3e. Helicopter resupply

Helicopters must **land** to resupply. They follow the same supply proximity
rules as large ground transports.

---

## Part 4 — Stand-off weapons (ARM and PGM)

### 4a. ARM (Anti-Radiation Missile, WC 16)

- Automatically targets the **nearest active radar-equipped AAA** (FC ≥ 100).
- Will search anywhere on the map for radar targets (not limited to 15 hex circle).
- If no valid radar target exists, ARM does not fire.
- After ARM launch, SEAD planes pull off; non-SEAD planes continue bomb run.

### 4b. PGM (Precision Guided Munitions, WC 17)

- Targets within a **15-hex circle** around the plotted target hex only.
- No "magical" detection of unspotted units — only previously located enemies
  can be engaged.
- Target priority within the 15-hex circle (highest to lowest):
  1. AAA units (because they threaten the aircraft)
  2. Ammo carriers
  3. Enemy HQ (if visible)
  4. Other detected units (COIN fighters prefer infantry)
- After PGM launch, the plane **exits the map** rather than completing a
  normal bomb run over the target hex.
- Exception: a non-SEAD plane that fires ARM (not PGM) as its only stand-off
  weapon will continue on to complete a bomb run with remaining weapons.

### 4c. Stand-off attack exposure

Planes making stand-off attacks (ARM or PGM launched before flying over the
map) are only exposed to **long-range AA weapons (> 100 hex range)** —
typically SAMs. They bypass all short-range AA and AAMG fire.

A plane with 2 Mavericks in the same weapon slot can make 2 completely
stand-off attack runs without ever entering normal AA range. Only once
bomb/cannon runs begin does the aircraft enter normal AA engagement range.

---

## Part 5 — AA and SAM engagement rules

### 5a. Hidden AAA reaction fire threshold

Hidden AAA units will only fire at aircraft if:
- Aircraft is within **~3 hexes**, OR
- Calculated to-hit exceeds **~9%**

This prevents hidden AA from betraying its position against low-percentage
long-range shots.

### 5b. Non-FLAK AAA restriction (early turns)

Non-FLAK ground units (units with AAMG but not dedicated AA class) in delay
or defence will **not** fire their AAA weapons for approximately the first
12 turns, except against paratrooper/glider carriers. This prevents
"recon by fire" using strike planes as spotters in opening turns.

### 5c. SAM warhead size filtering

Large SAMs will not engage small, low-value targets (spotter planes, UAVs).
Warhead size is compared to target type — oversized SAMs are reserved for
larger, more valuable aircraft.

### 5d. AAA radar and SEAD targeting

Any AAA unit with FC ≥ 100 is permanently broadcasting — there is no
emissions control. SEAD planes will always find and target these units.
Destroying or suppressing radar-equipped AAA before flying strike missions
is therefore critical. FC ≥ 100 also allows radar-equipped AAA to spot
aircraft beyond normal ground Vision range, and to see through smoke.

### 5e. EW (Electronic Warfare) ratio for AA engagements

The ratio between firer EW and target aircraft EW affects hit probability.
If the aircraft's electronic defences win the EW contest, the firer's hit
chance is reduced. Higher aircraft EW makes it more survivable against
radar-guided AA.

---

## Part 6 — Weapon class reference for air weapons

| WC | Name | Notes |
|----|------|-------|
| 4 | FLAK / AAMG | Fires at ALL aircraft and helos, regardless of movement |
| 5 | Light autocannon | Does NOT engage aircraft or helos; do not use on helos |
| 11 | Aircraft weapon (off-map) | Used by all fixed-wing strike weapons; bombs = range 1; cannon uses HE ammo count with AP byte for cannon count |
| 13 | Cluster bomb / MLRS | Air-dropped clusters, MRL salvos; treated as HEAT vs ERA |
| 16 | ARM | Auto-targets FC ≥ 100 AAA radar; searches full map |
| 17 | Large air missile / LGB | PGM, ASMs; must have large HE kill value; targets 15-hex circle |
| 18 | Napalm / FAE | Range 1; air napalm and on-map FAE weapons |
| 19 | Autocannon (high-angle) | Helo cannon; enables helo vs. helo opfire |

---

## Part 7 — Accuracy and targeting modifiers

### Low visibility effects

- Visibility < 10 hexes degrades airstrike accuracy unless the aircraft
  has night-vision optics.
- Same low-visibility threshold increases glider/paratroop landing accidents.
- Aircraft ignore underlying terrain movement costs; helicopters cannot
  offload passengers in some woods and building hexes.

### Blast radius (air weapons)

| Weapon | Blast |
|--------|-------|
| Standard iron bomb | Scales with bomb size |
| 2,000 lb bomb | Potentially lethal ~200 yards (~4 hexes) radius |
| Cluster (air-dropped) | Minimum 2-hex radius; even distribution across area |
| Cluster on-map / MRL | Minimum 1-hex radius |

R key during bombardment screen shows blast radius as white circles.
Known enemy units hit within radius are highlighted in yellow.

Armoured vehicles ≥ 2 hexes from impact: suppressed, not destroyed,
except by cluster munitions which affect them more evenly.

**Cluster bomblets count as HEAT for ERA purposes** — ERA will attempt
to defeat incoming bomblets before they reach the vehicle.

---

## Part 8 — Campaign rules

- Fixed-wing aircraft are **not** available in campaign cores.
- Helicopters **are** available in campaign cores.
- In campaign scenarios, strike allocation is handled by the scenario node
  reward system rather than the game preferences airstrike setting.
- The airstrike preference setting is ignored in all scenario games.
- A bug previously allowed attack helicopters to be used to unlock aircraft
  for core purchase — this is fixed.

---

## Part 9 — Tactical notes (from manual)

- **Cluster bombs** are most effective against bunched-up multi-unit targets.
  Wasting them on isolated single units surrounded by open ground is
  inefficient.
- **SEAD first:** buy SEAD formations before other strike planes in the
  purchase list and fly them first — the bombardment list runs top-to-bottom.
  Plan on SEAD missions suppressing or destroying radar AA before committing
  non-SEAD strike aircraft.
- **Hold back fixed wing** until helicopters, artillery, and ground forces
  have reduced the SAM threat. Attack helicopters and troop-carrying helos
  are effective SAM-hunting assets before massed air strikes.
- **SAM ammo is limited** — sustained suppression or destruction of SAM
  sites is possible through combined artillery and ground action.
- **Against guerrillas / low-AA opponents**, even small COIN planes are
  disproportionately lethal. Shoulder-fired SAMs significantly change this
  calculus after ~1970.

---

## Part 10 — What we do not have

- The exact to-hit formula for AA fire against aircraft (inputs confirmed
  as FC, EW ratio, aircraft altitude, range; exact math unknown).
- How aircraft durability (front armour byte) translates to hit points
  (no example values in documentation).
- The exact number of cannon strafing passes per mission beyond the
  "max returns" byte.
- Whether air accuracy degrades with accumulated bomb/cannon ammo expenditure
  within a single mission, or remains flat.

---

*Compiled from: Manual02.htm, Manual05.htm, Manual06.htm (Camo Workshop
Game Guide), MHMBTHelp.htm (Don Goodbrand, 2003), patch info.txt v2.0,
SPMBT_DATA_ANALYSIS.md.*
