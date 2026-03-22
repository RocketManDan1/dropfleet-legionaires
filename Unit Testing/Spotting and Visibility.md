> **SOURCE RESEARCH ONLY** — This document is a WinSPMBT data reference, not authoritative game rules. For Dropfleet Legionaires game rules, see `New Direction Docs/Spotting and Contact Model.md`.

# WinSPMBT — Spotting and Visibility Reference

Sources: Manual02.htm, Manual03.htm, Manual04.htm, Manual05.htm,
Manual06.htm, MHMBTHelp.htm, patch info.txt (v2.0),
SPMBT_DATA_ANALYSIS.md

Scale: 1 hex = 50 metres.

---

## Part 1 — Global visibility setting

Visibility is a single map-wide value set in hexes (1–99). It represents
all forms of reduced visibility: night, fog, rain, dust, and snow.
The setting can be changed from the View Map screen at any point during
a campaign game.

### Visibility thresholds with mechanical effects

| Visibility | Effect |
|-----------|--------|
| 99 (clear) | No restrictions; full daylight |
| ~60+ hexes | High visibility: dust trails and disturbed snow visible from vehicle movement in desert/snow terrain |
| ~20 hexes | Pre-1970: air strikes unlikely to be allocated (airfields weathered in) |
| ~10 hexes | Air strike accuracy degrades unless aircraft has night vision; glider/paratroop accident rate increases |
| ~3 hexes | Severe: glider landings near-guaranteed rough; smoke treated as equivalent fog |
| ~2–3 hexes | Smoke at this visibility is indistinguishable from natural fog for glider landing purposes |

**Air strike rules by era:**
- Before 1970: visibility < ~20 hexes → strikes rarely allocated
  regardless of preferences setting
- 1970–1980: intermittent restrictions
- After 1980: no visibility restrictions on allocation; player
  responsibility to buy aircraft suited to conditions

**High visibility bonus:** at ~60+ hexes, moving vehicles kick up
visible dust (desert) or snow trails. This can reveal positions even
for units not otherwise spotted.

---

## Part 2 — Vision device tiers

The Vision stat extends a unit's effective spotting range beyond the
global visibility setting. The formula is additive:

> `Effective seeing range = visibility + vision (hexes)`

A unit with Vision 12 in a 3-hex visibility game sees 15 hexes total.

### Vision tier table

| Vision value | Device type |
|-------------|------------|
| 0 | Unaided daylight only |
| 10–15 | Infantry night vision goggles |
| ~20 | Vehicle IR searchlight |
| ~30 | Image Intensifier (II) / Low-Light TV (LLTV) |
| 40+ | **Thermal Imager (TI)** — sees through smoke |
| 50+ | **Ground Surveillance Radar (GSR)** — sees through smoke |
| FC ≥ 100 | **AA radar** — spots aircraft and helicopters beyond normal ground Vision range; sees through smoke and fire vs aerial targets only |

---

## Part 3 — Thermal Imaging (TI) — special rules

Vision 40+ grants TI capability, which changes how smoke and fire
affect LOS.

### TI vs. smoke

TI can see through smoke, but the penetration is **not absolute**:

- **5–6 full smoke hexes** freshly laid are needed to reduce TI LOS
  slightly (causing "shadows").
- Below that threshold: TI sees through smoke normally.
- VIRSS smoke (EW 3–4) is specifically designed to defeat TI — ejected
  anti-TI screening smoke creates an immediate local blind spot for
  Vision 40+ opponents.

### TI vs. fire

- **2+ fire hexes** in the LOS path cause meaningful TI degradation.
- Single fire hexes generally do not significantly block TI.

### AA radar (FC ≥ 100) and smoke

AAA radar fire control is **NOT** degraded by fire or smoke when
engaging aerial targets. The smoke/fire LOS rules apply only to ground
unit TI, not to radar-guided AA.

### TI and movement

TI spotting degrades slightly when the spotter is moving at top speed
(≥ half MP expended). Stationary or slow-moving TI units spot better
than fast-moving ones. This does **not** apply to radar (GSR / radar
AA), only to thermal imagers.

### TI and hidden units that fire

TI-equipped units (Vision ≥ 40) receive a slight upward bonus to
spotting hidden vehicles that fired. Standard vision equipment does
not get this bonus.

---

## Part 4 — Spotting factors

There is no single "spotting stat". Spotting emerges from the
combination of all factors below. There are no "magic" recon abilities
— all units follow the same rules.

### 4a. Target Size

| Size | Typical unit type | Effect |
|------|------------------|--------|
| 0 | Snipers, special forces | Extra hard-to-spot bonus on top of normal rules |
| 1 | Small infantry section, light vehicle | Hard to spot |
| 2–3 | Standard infantry, APC | Normal |
| 4–5 | Tank, SP gun | Easier |
| 6 | Large vehicle, heavy artillery | Easiest to spot |

Size is the same scale used for to-hit probability. Smaller = harder to
spot AND harder to hit.

### 4b. Observer unit type

| Observer | Spotting ability |
|---------|-----------------|
| Infantry on foot | Best — spotters with eyes at ground level |
| Infantry as passengers | Better than vehicles; gains the vehicle's mobility with infantry spotting quality |
| Vehicles | Worse than infantry on foot |

Infantry passengers on a vehicle provide the vehicle with better
spotting ("extra eyes"); if the vehicle blunders into an ambush,
passengers may also help respond.

### 4c. Observer movement state

| Movement state | Spotting |
|---------------|---------|
| Stationary | Best |
| Moving slowly | Moderate |
| Moving fast (≥ half MP) | Worst |

Fast-moving units spot significantly less than stationary ones. This
applies equally to ground units and (for TI) to vehicle viewers.

### 4d. Observer experience

Higher-experience units spot better. Suppressed units spot less. The
SEARCHING preference multiplier affects effective spotting range
globally for all units.

### 4e. Terrain effects on LOS

| Terrain | LOS effect |
|---------|-----------|
| Dense woods | Strong LOS block; provides good cover |
| Orchards | Less LOS blocking than woods |
| Buildings / town hexes | Block LOS; provide cover |
| Hills / ridges | Provide hull-down positions; block LOS to units behind them |
| Tall grass / dry tall grass | Low-level LOS block; some infantry concealment |
| Standing crops (farm fields) | Low-level cover for infantry |
| Light smoke | Minor concealment bonus; movement, firing, and Size matter more |
| Heavy smoke (5–6 hexes) | Slightly degrades TI LOS |
| Fire (2+ hexes in path) | Meaningfully degrades TI LOS |
| Vehicle wrecks | Some LOS blocking; counted as normal units for stacking |

**High global visibility modifier:** when game visibility is ~60+ hexes,
LOS penetrates deeper into forests, grasslands, standing crops, and
light smoke than at lower visibility. The same terrain provides less
concealment in high-visibility conditions.

### 4f. Firing and concealment

- Under the **HIDDEN FIRE** preference (recommended ON):
  - A unit firing for the **first time** from a hidden position rarely
    reveals its location after the first shot.
  - A **pinned or retreating** unit may lose spotting of previously
    located enemy (hard to observe when face-down).
- Under HIDDEN FIRE **OFF**: firing immediately reveals the unit's position.
- Smoke from firing can be spotted by the AI and used for counter-battery.
  ATGM backblast/smoke trace can also reveal positions.

### 4g. Suppression effects on spotting

Suppressed units find it harder to spot targets. Heavy suppression
may prevent an otherwise-exposed enemy unit from being re-observed
even if it moves.

---

## Part 5 — The SEARCHING preference

The SEARCHING preference (not "Spotting") is a global multiplier on
the range at which units spot each other.

| SEARCHING value | Effect |
|----------------|--------|
| 30% | Units spotted only at ~4 hexes (very late — turn 10 example) |
| 100% (default) | Units spotted at ~12 hexes (mid-range — turn 6 example) |
| 250% | Units spotted at ~23 hexes (early — turn 4 example) |

These figures are from a controlled test with advancing desert infantry.
Results vary by terrain, visibility, and unit type.

- Reduce SEARCHING if units are being spotted too easily.
- Increase SEARCHING if units feel impossible to find.

---

## Part 6 — Line of Sight (LOS) display

| Action | Result |
|--------|--------|
| Right-click a clear or friendly hex | Highlights all hexes the selected unit can see (dark = no LOS, light = LOS) |
| `}` hotkey | Shows all-around LOS hexes from current unit |
| `U` hotkey | Clears dark hexes and smoke display (press again to restore) |
| Right-click an unspotted enemy hex | **Deliberately suppressed** as a cheat prevention measure — the game no longer tips off the player by refusing to rotate |

LOS is directional — a unit facing one direction shows LOS from that
arc. Moving or rotating to face a different direction shows different
LOS coverage.

---

## Part 7 — Smoke mechanics

### Sources of smoke

| Source | Notes |
|--------|-------|
| `X` hotkey — main gun smoke | Fire a smoke round at the target hex |
| `D` hotkey — smoke dischargers | Fire the unit's onboard smoke discharger salvos (if fitted) |
| VIRSS (EW 3–4) | Automatic anti-TI screening smoke; can be toggled to not fire automatically (green = auto, red = manual) |
| Mortar / SP arty indirect smoke | Plotted via bombardment menu; can be delayed for specific turns |
| HE secondary smoke | Some explosive rounds produce residual smoke |

### Smoke ammo allocation

Smoke round counts are not stored as OB data — they are assigned by the
game at battle start based on:
- Unit class
- Warhead size
- Battle type (assault role gives more smoke)

The scenario editor's smoke round field is game instance data, not
permanent OB data.

### Indirect fire through smoke

Mortars, SP guns, howitzers, and tripod-mounted MGs can use the **Z key**
(area fire) to fire through smoke or over tree lines — but **not over
hills** — at targets outside their own LOS. This creates a "beaten zone"
for harassing fire at suspected enemy positions without LOS.

### Artillery and LOS

If the observing FOO/FO vehicle **loses LOS** to the target hex during a
barrage, the game:
- Increases shell scatter
- Shifts the main point of impact

This prevents accurate blind barrage fire into completely unobserved areas.

### Smoke as deception

Dropping smoke on an area where you do **not** intend to attack (with a
probe to back it up) can deceive a human opponent into committing
reserves to the wrong sector. Smoke does not deceive a TI-equipped
opponent unless VIRSS-class anti-TI smoke is used.

---

## Part 8 — Hidden units and fog of war

### HIDDEN FIRE preference

When ON (recommended):
- First shot from a hidden unit rarely reveals position.
- Pinned units risk losing previously-spotted enemy positions.

When OFF:
- Any shot immediately reveals the firer.

### Unit naming as PBEM misinformation

In PBEM games, when a hidden unit fires, the game reports the unit
name to the opponent. Renaming a unit provides misinformation
potential (e.g. rename one tank unit to the name of another).
Note: the reported firing weapon stats remain the same; only the
name changes.

### Max fire range setting

The `Y` hotkey sets a unit's **maximum fire range**. This prevents
defence units from opening fire at long range and revealing their
positions prematurely. Setting range to 0 or 1 is the recommended
scout technique to prevent scouts from shooting and revealing themselves.

---

## Part 9 — Special spotting cases

### Minefields

All minefields are hidden by default. There are no dummy minefields
or marked minefields.

- Engineers/engineer vehicles detect mined hexes without triggering
  them ("Engineer detects minefield" message).
- Artillery-dropped minelets are usually spotted when they fall.
- Minefields can be made visible to both sides in scenario design,
  but only if deployed **before** entering the attacker's purchase
  screen. Re-deploying after that step makes them invisible again.

### FOO / artillery spotters preference

When the SPOTTERS preference is ON (recommended):
- Only formation HQ units (the "0" unit) with a radio and specialist
  artillery observers can call indirect fire.

When OFF:
- Any unit can call artillery.

This affects what units need to have LOS for accurate fire missions
rather than affecting spotting of enemy units directly.

### Aircraft spotting ground targets

Aircraft with "attacking hex" message = no LOS to target established.
Usually caused by smoke, dust, or the target being behind a ridge.
Aircraft with bombs or area weapons (napalm, cluster) can still
deliver area fire without LOS. Rocket/cannon attacks require direct LOS.
Aircraft with TI may mitigate poor visibility; standard visual aircraft
cannot.

### AA radar spotting

FC ≥ 100 units (radar AA) can detect aircraft and helicopters at ranges
beyond their normal ground Vision. Radar sees through smoke and fire
against aerial targets. No equivalent benefit against ground units.

---

## Part 10 — Summary: spotting modifier stack

```
Better spotting                        Worse spotting
──────────────────────────────────────────────────────
Infantry on foot                       Vehicle
Stationary                             Moving fast
High experience                        Low experience
Not suppressed                         Suppressed
High global SEARCHING                  Low global SEARCHING
High Vision                            Vision 0
Target large Size (5–6)                Target small Size (0–1)
Open terrain                           Dense woods / buildings
High global visibility               Low global visibility
TI (enemy in smoke)                    No NVG at night/fog

Special cases:
+ TI bonus: hidden targets that fire are slightly easier to spot
+ Size 0 targets: carry extra hard-to-spot modifier regardless of terrain
+ Infantry as passengers: better spotting than vehicle alone
```

---

## Part 11 — What we do not have

- The exact spotting probability formula (confirmed inputs are Size,
  terrain, movement state, experience, suppression, Vision, and
  SEARCHING; exact math is internal).
- Precise LOS penetration distances for each terrain type (e.g. how many
  hexes of woods before LOS is broken at different visibility levels).
- The exact magnitude of the TI firing-unit spotting bonus (confirmed
  exists as a "slight adjustment upwards").
- Whether there are any unit-class bonuses beyond infantry vs vehicle
  (recon vehicles confirmed to have no special bonuses).

---

*Compiled from: Manual02.htm, Manual03.htm, Manual04.htm, Manual05.htm,
Manual06.htm (Camo Workshop Game Guide), MHMBTHelp.htm (Don Goodbrand,
2003), patch info.txt v2.0, SPMBT_DATA_ANALYSIS.md.*
