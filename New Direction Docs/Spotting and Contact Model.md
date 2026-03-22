# Spotting and Contact Model
*Dropfleet Legionaires — authoritative spec*
*Last updated: 2026-03-22*

This document defines detection, contact tiers, contact decay, and visibility for Dropfleet Legionaires. It supersedes the WinSPMBT Spotting and Visibility reference for gameplay purposes — that document remains a data source only.

---

## Design Axioms

1. **The map is always fully visible.** The C2 display is a command terminal, not a camera. Terrain is always rendered. Enemy units only appear when spotted, as NATO contact symbols.
2. **Detection is a confidence accumulator, not a binary switch.** Brief observation creates an uncertain contact. Sustained observation confirms it.
3. **Silence and stillness are the best concealment.** Moving fast and firing both dramatically increase a unit's detectability.
4. **All players share one contact picture.** The C2 display shows every contact detected by any friendly unit — all players see the same map. However, **fire authorization is per-unit**: a unit can only engage a target that it has independently detected to at least DETECTED tier in its own sensor arc. A teammate's detection puts a contact on your screen; your unit's own sensor must acquire it before it can pull the trigger.

---

## Global Visibility

Every scenario defines visibility conditions via two values:

```typescript
interface ScenarioSettings {
  opticalVisibilityM: number;   // cap for Daylight / NVG / Image Intensifier sensors
  thermalVisibilityM: number;   // cap for Thermal Imaging (TI) sensors
  // Radar (visionM ≥ 2500m) ignores BOTH caps — always uses full visionM
  //
  // Examples (opticalVisibilityM / thermalVisibilityM):
  //   Clear day:         3000 / 3000
  //   Overcast/fog:      1500 / 2500   — TI still effective
  //   Night, no NVG:      300 / 2500   — TI dominant
  //   Dense fog/smoke:    400 /  800   — TI degraded too, radar unaffected
}
```

**Which cap applies to which sensor — the explicit rule:**

| Sensor tier | visionM | opticalVisibilityM cap | thermalVisibilityM cap |
|---|---|---|---|
| Daylight | 0–749 | ✅ Applied | — |
| NVG | 750–1499 | ✅ Applied | — |
| Image Intensifier | 1500–1999 | ✅ Applied | — |
| Thermal Imaging | ≥ 2000 | ❌ Exempt | ✅ Applied |
| Radar | ≥ 2500 | ❌ Exempt | ❌ Exempt |

Radar is never capped. It uses its full `visionM` value regardless of scenario conditions. The trade-off is that radar emits a detectable signal (SEAD target) and can only detect **moving** units.

---

## Detection Range

Each observing unit has an **effective detection range** for a given target, computed each second:

```typescript
function effectiveDetectionRange(
  observer: UnitInstance,
  target: UnitInstance,
  scenario: ScenarioSettings
): number {
  const baseRange = observer.type.visionM;

  // Signature bonus: target moving fast or firing extends how far it can be seen
  const signatureMultiplier = targetSignatureMultiplier(target);

  // Observer quality: infantry spot better stationary; worse when moving fast
  const observerMod = observerQualityMod(observer);

  const raw = baseRange * signatureMultiplier * observerMod;

  // Apply the correct visibility cap based on sensor tier
  if (observer.type.visionM >= 2500) return raw;                         // Radar: no cap
  if (observer.type.visionM >= 2000) return Math.min(raw, scenario.thermalVisibilityM);  // TI cap
  return Math.min(raw, scenario.opticalVisibilityM);                     // Optical cap
}
```

### Signature Multipliers (applied to observer's base range)

| Target state | Range multiplier | Notes |
|---|---|---|
| Stationary and silent | 0.8× | Hardest to detect |
| Slow movement | 1.0× | Baseline |
| Fast movement | 1.5× | Engine noise, dust, heat bloom |
| Firing MG / secondary weapon | 1.4× | Muzzle flash, tracer |
| Firing main gun / arty | 2.0× | Immediate flash + signature; brief |
| Detonated smoke | 0.5× | Own smoke partially obscures unit |

Main gun firing signature is a **one-second spike**: detection range doubles for 1 second, then returns to normal. It cannot be hidden.

### Observer Quality Modifiers (applied to observer's base range)

| Observer state | Range modifier |
|---|---|
| Stationary, infantry | +20% |
| Stationary, vehicle | baseline (×1.0) |
| Moving slow | −10% |
| Moving fast | −30% |

---

## Sensor Tiers

Observer `visionM` determines what the sensor can do. Ranges are after global visibility clamping.

| visionM | Tier | Night capable | Smoke capable | Detects |
|---|---|---|---|---|
| 0–749 m | Daylight | No | No | Visible units in LOS |
| 750–1499 m | NVG | Yes | No | Visible units in LOS |
| 1500–1999 m | Image Intensifier | Yes (full) | No | Visible units in LOS |
| ≥ 2000 m | Thermal Imaging (TI) | Yes (full) | Partial\* | Heat signatures |
| ≥ 2500 m | Radar (GSR) | Yes (full) | Yes (full) | **Moving units only** |

\*TI sees through smoke at 30% range penalty (2000m TI → 1400m effective in smoke). It is fully blocked by 3+ stacked smoke sources between observer and target.

**Radar special rules:**
- Detects any unit that is not stationary-and-silent, regardless of weather/smoke/night
- Cannot distinguish unit type — contacts top out at **DETECTED** tier, never CONFIRMED
- Radar observers (`fc ≥ 100`) are always broadcasting and are themselves detectable by SEAD units

---

## Line of Sight

LOS is a raycast from observer to target on the 3D heightmap, evaluated every second.

**Blocking conditions:**
- Terrain elevation above the LOS ray
- Buildings (full block)
- Dense woodland (partial block — see §LOS Reduction Rules below)
- Smoke (see §LOS Reduction Rules below)

### LOS Reduction Rules

Woodland and smoke apply **multiplicative range penalties** to the observer's
effective detection range. These stack with each other and with all other range
modifiers.

| Obstruction | Optical (< 2000 m) | Thermal (≥ 2000 m) | Radar (≥ 2500 m) |
|---|---|---|---|
| Forest / Jungle between observer and target | range × 0.30 | range × 0.50 | unaffected |
| Orchard / Crops / HighGrass between obs-tgt | range × 0.50 | range × 0.70 | unaffected |
| One smoke source on LOS line | range × 0.30 | range × 0.70 | unaffected |
| 2 smoke sources on LOS line | range × 0.10 | range × 0.50 | unaffected |
| 3+ smoke sources on LOS line | **blocked** | **blocked** | unaffected |

These are applied to the observer's effective detection range **after** all
other modifiers (signature, observer quality, visibility cap, height bonus)
have been computed. Multiple obstructions on the same ray multiply together:

```
finalRange = effectiveRange × woodlandFactor × smokeFactor
```

Example: TI observer (2000 m base), target behind one forest cell and one
smoke source → `2000 × 0.50 × 0.70 = 700 m` effective range.

**Height advantage:**
A unit on elevated terrain gains a detection range bonus:
```
heightBonus = max(0, (observerElevation - targetElevation) / 10)  // metres height diff
effectiveRangeWithHeight = effectiveDetectionRange + heightBonus × 50  // +50m per 10m height advantage
```

**Hull-down:**
A vehicle behind a ridgeline with only its turret exposed has its effective `size` reduced by 2 for detection purposes (harder to spot).

---

## Detection Accumulator

Every (observer, target) pair that has LOS and is within effective detection range maintains a **detection value** (0–100), updated every second.

### Modifier Stacking Order

Accumulation rate modifiers stack **multiplicatively** in this fixed order:

```
finalRate = BASE_RATE
          × sensorTierMod        (TI: 1.3, Radar: handled separately)
          × observerRoleMod      (scout: 1.4, sniper: 1.3, hq: 1.1, infantry: 1.2)
          × targetConcealmentMod (from size formula, §Concealment)
          × targetStateMod       (stationary + small: 0.5)
```

All modifiers are relative to the base rate; they do not compound off each
other. LOS obstruction (woodland, smoke) is applied to **range**, not rate.

### Multi-Observer Rule

When multiple friendly units observe the same target:
- Each observer maintains an **independent** accumulator for that target
- The **shared contact tier** displayed on the C2 map equals the **highest**
  detection value across all observers — it does not sum
- Accumulation rates are **not pooled**: 5 observers do not detect 5× faster;
  each ticks independently at its own rate
- If the best observer loses LOS, the shared tier falls back to the next-best
  observer's value (no instant drop to zero unless all lose LOS)

### Accumulation Rate (per second, while in range + LOS)

```typescript
const BASE_ACCUMULATION_RATE = 10; // points per second

function accumulationRate(observer: UnitInstance, target: UnitInstance): number {
  let rate = BASE_ACCUMULATION_RATE;

  // 1. Sensor tier modifier
  if (observer.type.visionM >= 2500) return 0;  // Radar — handled separately
  if (observer.type.visionM >= 2000) rate *= 1.3; // TI

  // 2. Observer role modifier
  if (observer.type.unitClass === 'scout')   rate *= 1.4;
  else if (observer.type.unitClass === 'sniper')  rate *= 1.3;
  else if (observer.type.unitClass === 'hq')      rate *= 1.1;
  else if (observer.type.moveClass === 'leg')      rate *= 1.2; // generic infantry

  // 3. Target concealment modifier (from size)
  const concealmentMod = 1 - (6 - target.type.size) * 0.05;
  rate *= concealmentMod;

  // 4. Target state modifier
  if (target.speedState === 'full_halt' && target.type.size <= 1) rate *= 0.5;

  return rate;
}
```

### Decay Rate (per second, when LOS broken or out of range)

```typescript
const DECAY_RATE_PER_SEC = 8;  // drops faster than it builds — LOS loss is quick to register
```

### Radar Special Case

Radar (`visionM ≥ 2500`) bypasses the accumulator for moving targets:
- Moving target in radar range → immediately set detection value to **floor of DETECTED tier (25)**
- Cannot accumulate above 25 via radar alone
- If a non-radar observer also has LOS, accumulation continues normally from 25

---

## Contact Tiers

Detection value maps to a contact tier. The tier determines what information is shown on the C2 display.

| Tier | Detection value | Symbol | Information shown |
|---|---|---|---|
| **SUSPECTED** | 1–24 | `?` blip (no NATO symbol) | Rough position only, ±50m |
| **DETECTED** | 25–74 | NATO category symbol | Unit category (vehicle / infantry / air), precise position |
| **CONFIRMED** | 75–100 | Full NATO symbol + label | Unit type name, all visible stats |
| **LOST** | 0 (was ≥ 1) | Dashed NATO symbol | Last known position + elapsed time |

**Category** is the broad NATO symbol class — friendly/hostile vehicle vs infantry vs air. It does not reveal whether the vehicle is a tank, APC, or SPG. That requires CONFIRMED.

### Tier Transition Times (at base 10 pts/sec)

| Transition | Time |
|---|---|
| Nothing → SUSPECTED | ~0.1s (any glimpse) |
| SUSPECTED → DETECTED | ~2.5s |
| DETECTED → CONFIRMED | ~5s |
| Total: undetected → CONFIRMED | ~7.5s continuous observation |

---

## Contact Decay and LOST State

When all LOS to a contact is broken:
1. Detection value decays at 8 pts/sec
2. When value reaches 0: contact enters **LOST** state
3. LOST contacts are frozen at last known position with a timestamp
4. LOST contacts fade (reduce opacity) over 60 seconds
5. After 60 seconds with no re-acquisition: contact is removed from the display

```typescript
interface Contact {
  id:                  string;
  observedUnitId:      string;

  tier:                'suspected' | 'detected' | 'confirmed' | 'lost';
  detectionValue:      number;      // 0–100

  lastKnownPosX:       number;      // metres
  lastKnownPosZ:       number;
  lastKnownHeading:    number;      // degrees
  lastSeenTimestamp:   number;      // epoch ms — shown as "last seen Xs ago" in UI

  // Revealed information (depends on tier at time of observation)
  category:            'vehicle' | 'infantry' | 'air' | null;  // null until DETECTED
  unitTypeId:          string | null;  // null until CONFIRMED; stays after LOST

  lostAt:              number | null;  // epoch ms when entered LOST; null if still active
}
```

**Re-acquisition:** if a LOST contact is re-sighted, it does not start from zero. It resumes at detection value 1 and accumulates normally. If the same `observedUnitId` is re-acquired, the existing contact object is updated rather than creating a new one.

---

## Combat Gate: Spotting Check

Before a unit can fire at a target, the target must be at tier **DETECTED or higher** (detection value ≥ 25) **in the firer's own sensor accumulator**.

The shared contact picture (Axiom 4) means all players see the same contact icons on the C2 display — but seeing a contact on the map does not grant fire permission. Each unit maintains its own per-target detection accumulator. A teammate's detection puts the icon on your screen and tells you where to look, but the firing unit must independently reach DETECTED through its own sensor arc + LOS before it can engage.

```
fire order issued
  └── target contact tier ≥ DETECTED in firer's own sensor?
        YES → proceed to To-Hit (Combat Formula Spec §1)
        NO  → order rejected: "Target not acquired"
```

SUSPECTED contacts can be targeted by **indirect fire only** (artillery, mortars). Accuracy is degraded — the scatter formula uses SUSPECTED as equivalent to "no FO" (2× base CEP).

---

## Observer Roles

Some unit classes provide enhanced spotting capability:

| Unit class | Bonus |
|---|---|
| `scout` | +40% accumulation rate; can spot while moving fast without observer penalty |
| `hq` | +10% accumulation rate; shares detections to all friendly units instantly |
| `sniper` | +30% accumulation rate; `hold_fire` default to preserve concealment |
| Spotter aircraft | Full map LOS; +60% accumulation rate; cannot fire |
| `infantry` (generic) | +20% accumulation rate vs. all ground targets (baseline in table above) |

---

## Concealment and Size

`UnitType.size` (0–6) directly reduces detection accumulation rate against that unit:

```typescript
concealmentMod = 1 - (6 - target.size) * 0.05;
// size 6 (large vehicle): 1.0x  — no bonus
// size 3 (average):       0.85x — 15% slower to detect
// size 1 (infantry):      0.75x — 25% slower
// size 0 (sniper/SF):     0.7x  — 30% slower, plus inherent hard-to-spot bonus
```

Size 0 units also have a floor: they cannot be detected above SUSPECTED tier by any observer with `visionM < 750m` unless they fire.

---

## Smoke

Smoke is a terrain effect layered over LOS. Rules by sensor type:

| Sensor | Effect of smoke (per source on LOS) |
|---|---|
| Daylight / NVG / II | `effectiveRange × 0.30` per smoke source; blocked at 3+ |
| Thermal (≥ 2000m) | `effectiveRange × 0.70` per smoke source; blocked at 3+ |
| Radar (≥ 2500m) | Not affected |

Smoke multipliers are applied to **effective detection range**, not accumulation
rate. Multiple smoke sources multiply: 2 sources for optical = `range × 0.30 × 0.30 = range × 0.09`. See §LOS Reduction Rules for the complete table.

Smoke from `smokeDischargers` (unit-deployed) lasts 45 seconds per salvo and occupies a ~30m radius.

---

*This document is the authoritative spotting spec. The Unit Testing/Spotting and Visibility.md file remains as a WinSPMBT source reference but is not authoritative for game rules.*
