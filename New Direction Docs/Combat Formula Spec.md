# Combat Formula Specification
*Federation Legionaires — authoritative design doc*
*Last updated: 2026-03-19*

Mechanics are inspired by WinSPMBT but defined here. These are **our rules**, not reverse-engineered internals.
All distances in **metres**. All probabilities in **percent (0–100)**.

---

## Scale Reminders

| WinSPMBT unit | Conversion | Real-world equivalent |
|---|---|---|
| 1 hex | × 50 | 50 m |
| 1 turn | — | 5 minutes |
| Weapon range (hexes) | × 50 | metres |
| Speed (MP/turn) | × 50 | max metres per 5-min turn |
| Vision (hexes) | × 50 | metres |

---

## Formula 1 — To-Hit Probability

Used every time a unit fires at a target.

### Inputs

| Parameter | Source | Notes |
|---|---|---|
| `acc` | Weapon.ACC | 0–30 |
| `range` | Runtime | Metres to target |
| `weaponRange` | Weapon.Range × 50 | Max effective range in metres |
| `fc` | Unit.FC | 0–140 |
| `rf` | Unit.RF | 0–23 |
| `stabilizer` | Unit.Stabilizer | 0–5 |
| `firerState` | Runtime | `full_halt` / `short_halt` / `slow` / `fast` |
| `targetState` | Runtime | `stationary` / `slow` / `fast` |
| `targetSize` | Target.Size | 0–6 |
| `suppression` | Firer.suppression | 0–100 |

### Steps

```typescript
function toHitChance(p: ToHitParams): number {

  // 1. Base accuracy: 0–90% at point-blank
  const baseHit = (p.acc / 30) * 90;

  // 2. Range factor (0–1). Laser RF compresses the falloff curve.
  const rfCompression = p.rf >= 20 ? 0.40 : (p.rf / 20) * 0.15;
  const normalizedRange = p.range / p.weaponRange;
  const rangeFactor = Math.max(0, 1 - normalizedRange * (1 - rfCompression));

  // 3. Apply range
  let hit = baseHit * rangeFactor;

  // 4. Firer movement penalty / bonus
  const stabBonus = p.stabilizer * 4;  // Stabilizer 5 = +20%
  const firerMod: Record<string, number> = {
    full_halt:   +10,
    short_halt:  + 5,
    slow:        -10,
    fast:        -30 + stabBonus,  // Stabilizer 5 reduces fast penalty to -10%
  };

  // 5. Target movement penalty, offset by FC
  //    FC 100 fully eliminates penalty for slow targets; halves fast penalty
  const fcFactor = Math.min(1, p.fc / 100);
  const targetMod: Record<string, number> = {
    stationary:  0,
    slow:        -15 * (1 - fcFactor * 0.5),
    fast:        -30 * (1 - fcFactor),
  };

  // 6. Target size modifier (size 3 = neutral)
  const sizeMod = (p.targetSize - 3) * 6 + (p.targetSize === 0 ? -10 : 0);
  //   size 0 = −28%,  size 3 = 0%,  size 6 = +18%

  // 7. Suppression penalty on firer (max −20% at full suppression)
  const suppressionMod = -(p.suppression / 100) * 20;

  // 8. Laser RF halt bonus
  const rfHaltBonus = (p.rf >= 20 && p.firerState === 'full_halt') ? 10 : 0;

  const total = hit
    + firerMod[p.firerState]
    + targetMod[p.targetState]
    + sizeMod
    + suppressionMod
    + rfHaltBonus;

  return Math.min(95, Math.max(5, total));  // hard floor 5%, hard ceiling 95%
}
```

### Critical Hit (Weak-Spot Rule)
When calculated hit chance ≥ 80% **and** range ≤ 500 m, roll a second check:
- Critical hit chance = `(hitChance - 80) × 2`  (so 80% to-hit → 0% crit, 95% to-hit → 30% crit)
- Critical hit bypasses normal facing armour; uses the weakest armour value on the unit instead.

### Infantry: Crew Multiplier
For slot-1 `Class 0` weapons (rifles, SMGs), the weapon fires `crewCount` internal shots per activation, each resolved separately against the same hit chance. This is how 8 men with rifles produce meaningful fire even at low per-shot probability.

---

## Formula 2 — Suppression → Cooldown Scaling and Slot Availability

Suppression is an integer 0–100. Higher = worse. Suppression affects fire rate through two independent mechanisms: **cooldown scaling** and **slot lockout**.

### Cooldown Scaling (the single authoritative mechanic)

Suppression stretches the per-shot cooldown from Formula 9. There is no separate "shots per turn" calculation — this replaced the turn-era model.

```typescript
function suppressedCooldown(baseCooldownSec: number, suppression: number): number {
  // Up to +60% cooldown at full suppression
  const suppressionPenalty = (suppression / 100) * 0.6;
  return baseCooldownSec * (1 + suppressionPenalty);
}
```

| Suppression | Cooldown multiplier | Effect on a 20s base cooldown |
|---|---|---|
| 0 | ×1.00 | 20.0s |
| 25 | ×1.15 | 23.0s |
| 50 | ×1.30 | 26.0s |
| 75 | ×1.45 | 29.0s |
| 100 | ×1.60 | 32.0s |

### Weapon Slot Availability

Suppression locks out secondary weapon slots. This is independent of cooldown scaling — a locked slot does not fire at all, regardless of cooldown state.

| Suppression | Slots available |
|---|---|
| 0–20 | 1, 2, 3, 4 |
| 21–40 | 1, 2, 3 |
| 41–60 | 1, 2 |
| 61–100 | 1 only |

Slot 1 always fires (unless unit is destroyed). If suppression ≥ 81, slot 1 fires with a 50% reliability check — on each cooldown expiry, roll: 50% chance the shot fires, 50% chance the cooldown resets without firing.

### Suppression Accumulation (event-based, instant)

| Event | Suppression added |
|---|---|
| Shot misses nearby (within 50 m) | +3 |
| Shot hits unit (no penetration) | +8 |
| Friendly unit destroyed within 100 m | +5 |
| Indirect fire lands within blast radius | +6 |
| Moving fast through enemy fire (per shot landing nearby) | +4 |
| Dismounting from moving vehicle | +10 |

### Suppression Decay per Second (when not under fire)

| State | Decay per second |
|---|---|
| Normal (< 40) | −0.13 (~−8 per minute) |
| Pinned (40–64) | −0.07 (~−4 per minute) |
| Routing (65–89) | −0.03 (~−2 per minute) |
| Commander rally (any state) | instant −15 on rally event |

---

## Formula 3 — Morale State Machine

Suppression drives morale. States are thresholds, not separate variables.

```
Normal   → suppression < 40
Pinned   → 40 ≤ suppression < 65
Routing  → 65 ≤ suppression < 90
Surrender → suppression ≥ 90 AND crew ≤ 25% of maxCrew
```

### State Effects

| State | Movement | Fire | Opportunity fire |
|---|---|---|---|
| Normal | Full | Full | Yes |
| Pinned | Cannot advance | Reduced (−15% to-hit) | Reduced (50% chance) |
| Routing | Moves away from enemy | Slot 1 only, −30% to-hit | No |
| Surrender | None | None | None; removed from play |

### Rally

- Commander with radio: anywhere on map (radio success roll = `Radio %`)
- Commander without radio / radio failed: ≤ 150 m (voice range)
- Rally effect: immediate −15 suppression; if rolling below Pinned threshold, state upgrades

---

## Formula 4 — Artillery Scatter (CEP)

Circular Error Probable — the radius within which 50% of rounds land.

```typescript
function artilleryScatter(
  caliberMM: number,
  hasFO: boolean,
  foHasLaserRF: boolean,
  foHasGPS: boolean
): number {
  // Base CEP scales with caliber
  const baseCEP = 40 + caliberMM / 8;
  //  81mm mortar → 50 m    105mm → 53 m    155mm → 59 m    203mm → 65 m

  // FO quality modifiers
  const losMult  = hasFO       ? 1.0  : 2.0;   // no FO = scatter doubles
  const rfMult   = foHasLaserRF ? 0.5  : 1.0;
  const gpsMult  = foHasGPS    ? 0.35 : 1.0;   // GPS overrides RF if both present

  const cep = baseCEP * losMult * rfMult * gpsMult;

  // Convert CEP to actual scatter distance for this shot:
  // Sample from a 2D Gaussian with σ = CEP / 1.1774
  return cep;  // caller samples from Rayleigh distribution with this as mode
}
```

**Sampling:** scatter distance `d = cep × sqrt(-2 × ln(uniform()))`, scatter direction = random 0–360°.

GPS (`EW == 15`) hard cap: CEP ≤ 15 m regardless of caliber.

---

## Formula 5 — Blast Radius

Maps caliber to lethal radius (metres). Vehicles beyond this radius are suppressed rather than damaged (except cluster munitions).

| Caliber (mm) | Blast radius (m) | Notes |
|---|---|---|
| < 20 | 5 | Autocannon, small arms |
| 20–60 | 10 | 20mm, 40mm grenade |
| 61–80 | 15 | 60mm mortar, light cannon |
| 81–100 | 20 | 81mm mortar, 90mm tank gun |
| 101–130 | 35 | 105mm howitzer |
| 131–155 | 50 | 155mm howitzer |
| 156–203 | 70 | 8-inch howitzer |
| 204+ | 90 | 240mm+, MLRS |

**Cluster munitions:** radius × 1.5, damage distributed evenly (no falloff to edge).

### Damage Falloff

```typescript
function blastDamageMultiplier(distance: number, blastRadius: number): number {
  if (distance <= blastRadius * 0.5) return 1.0;   // full damage
  if (distance <= blastRadius)       return 0.5;   // half damage
  if (distance <= blastRadius * 2.0) return 0.0;   // suppression only (armoured targets)
  return 0.0;
}
```

---

## Formula 6 — ERA Defeat Chance

### Basic ERA (level 1–10): HEAT and cluster only

```typescript
function eraDefeatChance(eraLevel: number, isTandemCharge: boolean): number {
  if (eraLevel <= 0) return 0;
  let chance = eraLevel * 10;         // ERA 5 = 50%
  if (isTandemCharge) chance *= 0.5;  // tandem warheads are harder to stop
  return Math.min(90, chance);        // ERA 10 = 90% (not guaranteed)
}
```

Each activation (regardless of result) reduces ERA level by 1.
Basic ERA does **not** affect AP or Sabot rounds.

### Advanced ERA / Kontakt (level 11–20): also defeats kinetic rounds

Stored as `eraLevel = 10 + kontaktPoints` (so 11 = 1 Kontakt charge, 20 = 10 Kontakt charges).

```typescript
function kontaktDefeatChance(eraLevel: number, roundType: 'kinetic' | 'heat'): number {
  const points = eraLevel - 10;   // 1–10
  return points * 10;             // 1 Kontakt point = 10% vs kinetic or HEAT
}
```

---

## Formula 7 — Penetration → Survivability Roll

Applied after armour is penetrated by a **normal** hit (pen < armour + 10).
Catastrophic penetration (pen ≥ armour + 10) skips this — unit destroyed immediately.

```typescript
function survivalChance(survivability: number): number {
  // S=0 → 0%,  S=3 → 43%,  S=6 → 86%
  return (survivability / 7) * 100;
}
```

| S | Survival % | Meaning |
|---|---|---|
| 0 | 0% | Crew definitely killed |
| 1 | 14% | Makeshift APC — usually fatal |
| 2 | 29% | Light armour |
| 3 | 43% | Medium — even odds |
| 4 | 57% | Better than even |
| 5 | 71% | Heavy tank crew has a good chance |
| 6 | 86% | Modern MBT crew usually survives normal pen |

**On failed survival roll:** roll `1 + floor(random() × 2)` crew casualties (1–2). If crew drops to 0, unit destroyed.

---

## Formula 8 — Warhead Size Variance

WH adds random bonus to both penetration and kill rolls, independently per shot.

```typescript
function warheadBonus(warheadSize: number): number {
  // Uniform draw: "none, some, or all" of WH added
  return Math.floor(Math.random() * (warheadSize + 1));
}

// Applied at resolution:
const effectivePen  = basePen  + warheadBonus(weapon.WH);
const effectiveKill = baseKill + warheadBonus(weapon.WH);  // separate roll
```

This makes WH weapons slightly unpredictable — a high-WH weapon can sometimes punch well above its listed stats.

---

## Formula 9 — Experience → Per-Shot Cooldown (Real-Time)

The game runs in real time (1 second = 1 second). WinSPMBT ROF is shots per 5-minute turn.

```typescript
// ROF from WinSPMBT is shots per 5-minute (300s) turn.
// Multiply by 5 to get a game-feel rate — otherwise fire is too slow for real-time.
// NOTE: ROF_REALTIME_MULTIPLIER = 5 is the primary balance lever. Increase to speed
//       up combat feel; decrease for a more deliberate simulation pace.
const ROF_REALTIME_MULTIPLIER = 5;

function shotCooldownSeconds(maxROF: number, experience: number, fc: number): number {
  // Step 1: scale ROF by experience (same linear formula, now gives effective shots/turn)
  let effectiveROF = Math.max(1, Math.round(1 + (maxROF - 1) * (experience / 100)));

  // Step 2: FC ≥ 35 bonus (fire control shortens the reload cycle)
  if (fc >= 35) effectiveROF = Math.min(maxROF, effectiveROF + 1);

  // Step 3: convert to real-time cooldown
  // 300s / effectiveROF = raw seconds between shots at 1:1 time
  // ÷ ROF_REALTIME_MULTIPLIER = compressed to feel right in real-time play
  return (300 / effectiveROF) / ROF_REALTIME_MULTIPLIER;
}
```

| Experience | ROF 3 (tank gun) | ROF 6 (IFV) | ROF 9 (infantry) |
|---|---|---|---|
| 30 (green) | 50s | 30s | 20s |
| 70 (trained) | 25s | 14s | 10s |
| 100 (elite) | 20s | 10s | 6.7s |

*The cooldown returned here is the base value. Under suppression, it is scaled by Formula 2's `suppressedCooldown()` — up to +60% at full suppression.*

---

## Formula 10 — Counter-Battery Fire Precision

For off-map guns, the encoded range value determines counter-battery reach:

```typescript
function counterBatteryEffectiveness(
  firingGunRange: number,  // decoded km
  targetGunRange: number   // decoded km (target gun's off-map range)
): 'effective' | 'partial' | 'impossible' {
  const diff = targetGunRange - firingGunRange;
  if (diff <= -1) return 'effective';   // target gun closer than firer's reach
  if (diff === 0) return 'partial';     // same range band: 50% mission success roll
  return 'impossible';                  // target gun outranges firer
}
```

**Partial (50% success):** roll at mission start. Failure = shells land on empty area with no effect.

**Range encoding decode:**
```typescript
function decodeArtilleryRange(encoded: number): number {
  if (encoded <= 200) return encoded * 50;   // on-map range in hexes: convert hex×50 to metres
  return (encoded - 200 + 10) * 1000;        // off-map: kilometres → metres
}
```

---

## Combat Resolution Summary

```
1. SPOT    Can firer see target? (Vision, size, terrain, smoke)
2. TO-HIT  Formula 1: roll < toHitChance? Add WH bonus (Formula 8).
3. ERA     Formula 6: does ERA stop the round?
4. ARMOUR  pen + whBonus >= facing armour?  → penetration
           pen + whBonus >= facing armour + 10? → catastrophic penetration
5. DAMAGE
   ├─ Catastrophic → unit destroyed, no Survivability check
   └─ Normal pen   → Formula 7: survival roll
                      └─ Fail → 1–2 crew lost; check if unit destroyed
6. SUPPRESSION  Apply suppression to target (Formula 2)
7. MORALE  Update state machine (Formula 3)
```

---

*All formulas subject to balance tuning during playtesting. Version locked when Phase 4 (Simulation) begins.*
