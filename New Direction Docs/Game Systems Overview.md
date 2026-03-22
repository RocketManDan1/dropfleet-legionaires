# Game Systems Overview
*Federation Legionaires — master reference*
*Last updated: 2026-03-19*

This document is the "start here" reference. It describes every gameplay system at the level needed to understand how they interact, and points to the detailed spec for each one. Read this before diving into any individual system doc.

Cross-document enum/timer/phase contracts are centralized in AUTHORITATIVE_CONTRACTS.md.

---

## Scale

| Unit | Value |
|---|---|
| Distance | Metres |
| Time | Real-time (1s = 1s) |
| WinSPMBT turn equivalent | 5 minutes = 300s |
| Map area | ~5 km × 5 km (procedural, variable) |
| Unit count | Platoon scale: 1 model = 1 vehicle or 1 infantry section |

---

## Server-Authoritative Tick Loop

The server runs a continuous real-time loop at a fixed tick rate (e.g. 20 Hz). Most systems update every tick; some (resupply, suppression decay) run on slower intervals.

```
EVERY TICK (~50ms)
  1. Integrate unit movement (position + velocity)
  2. Update movement state flags (full_halt / short_halt / slow / fast)
  3. Fire weapon cooldowns that have expired → resolve shot
  4. Apply in-flight projectile/artillery impacts
  5. Update suppression accumulation

EVERY SECOND
  6. Apply suppression decay
  7. Update sensor detections / contact states
  8. Check morale state transitions
  9. Attempt resupply for eligible units
  10. Broadcast state delta to all clients
```

---

## System 1 — Movement

**Doc:** Unit Schema Spec (MoveClass, maxSpeedM), DESIGN_OVERVIEW.md

### How It Works
Each unit has a `maxSpeedM` (max metres travellable per 300 seconds on clear terrain) and a `moveClass` (Track/Wheel/Leg/Hover/Air). Terrain type applies a cost multiplier from the table in Unit Schema Spec.

```
effectiveSpeedM = maxSpeedM / terrainCostMultiplier
```

Units are moved on a continuous 3D terrain mesh, not a grid. Pathfinding uses A* on a navigation mesh generated from the heightmap.

### Movement State Flags (critical for to-hit)
The server tracks recent movement via a rolling 10-second window. This feeds Formula 1 (to-hit) and determines the firing penalty.

```typescript
// Speed in m/s averaged over last 10 seconds
const recentSpeed = distanceMovedInLast10Sec / 10;
const maxSpeedMs  = unit.type.maxSpeedM / 300;  // convert m/turn → m/s

firerState =
  recentSpeed === 0 && stoppedDuration >= 10  → 'full_halt'
  recentSpeed === 0 && stoppedDuration >= 3   → 'short_halt'
  recentSpeed <= maxSpeedMs * 0.25            → 'slow'
  else                                         → 'fast'
```

A unit that just stopped gets `short_halt` accuracy within 3 seconds. `full_halt` (best accuracy) requires 10 seconds fully stationary. Stabilizer reduces the penalty for units that haven't reached `full_halt` yet.

### Bridge Crossing
Bridges have a `maxWeightClass` property. A unit with a higher `weightClass` than the bridge cannot cross. The weight class is set in `UnitType.weightClass` (see Unit Schema Spec).

---

## System 2 — Spotting and Visibility

**Doc:** [New Direction Docs/Spotting and Contact Model.md](Spotting and Contact Model.md) *(authoritative — supersedes Unit Testing/Spotting and Visibility.md)*

### Summary
Units must be spotted before they can be targeted. Each unit has a detection arc (radius = `effectiveDetectionRange`) rendered on the C2 map as a transparent cone. Detection builds as a confidence accumulator — brief observation creates a SUSPECTED contact; sustained observation reaches CONFIRMED.

| Vision tier | Range | Scenario cap |
|---|---|---|
| Daylight / NVG / II | 0–1999 m | `opticalVisibilityM` |
| Thermal Imaging | ≥ 2000 m | `thermalVisibilityM` |
| Radar (GSR) | ≥ 2500 m | None — always full range |

**C2 Display:** contacts shown as NATO symbols at 4 tiers: SUSPECTED (blip), DETECTED (category), CONFIRMED (full type), LOST (frozen last-known, fades over 60s).

---

## System 3 — Direct Fire Combat

**Doc:** [Combat Formula Spec.md](Combat Formula Spec.md) *(source research: Unit Testing/To-Hit Mechanics.md)*

### Resolution Order
```
1. Spot check  → Spotting and Contact Model
2. To-hit roll → Combat Formula Spec §1
3. ERA check   → Combat Formula Spec §6
4. Armour check → pen vs facing armour value
5. Damage roll → Combat Formula Spec §7
6. Suppression → Combat Formula Spec §2
```

### Ammo Selection
Server auto-selects based on target type (see Unit Schema Spec §Supply). Player can override via order panel.

### Weapon Slots
Slot 0 = primary (most reliable). Slots 1–3 degrade under suppression (see Formula 2 slot table). Infantry slot-0 with Class 0 weapon fires `currentCrew` internal shots.

---

## System 4 — Suppression and Morale

**Doc:** [Combat Formula Spec.md](Combat Formula Spec.md) §2, §3 *(source research: Unit Testing/Damage and Suppression.md)*

### Summary
Suppression (0–100) accumulates from being shot at, nearby casualties, and indirect fire. It scales weapon cooldown (up to +60%), locks out secondary weapon slots, and reduces to-hit chance. At thresholds, units become Pinned, then Routing, then Surrender.

Suppression decays **each second** when not under fire (see Simulation Time Model). Commanders rally units using radio (map-wide) or voice (≤150 m).

**C2 Display:** unit cards show suppression bar. State badges: `PINNED`, `RTG` (routing), `SURR` (surrendered).

---

## System 5 — Indirect Fire (Artillery and Mortars)

**Doc:** [Combat Formula Spec.md](Combat Formula Spec.md) §4, §5 *(source research: Unit Testing/Artillery System.md)*

### Summary
Artillery and mortar units designated `arty_sp`, `arty_towed`, or `mortar` can fire indirectly. Minimum caliber for indirect fire comes from unit class, not weapon class.

Rounds land at a scatter distance from the target (Formula 4 CEP), then apply blast damage (Formula 5 radius).

**Off-map artillery:** encoded range value decoded to km. Counter-battery determined by Formula 10.

**C2 Display:** fire mission shown as a targeting reticle on map. Impact shown as expanding ring + suppression pulses on nearby contacts.

---

## System 6 — Air Support

**Doc:** [Orders and C2 Interaction.md](Orders and C2 Interaction.md) §Air Support *(source research: Unit Testing/Air Support System.md)*

### Summary
Air support is called via the order panel. Strike points are finite per scenario. Arrival delay is **strike-type specific** (typically 10-45 seconds; see THEATER_SUPPORT.md).

| Aircraft type | Role |
|---|---|
| Fighter-Bomber | General strike; bombs + rockets |
| SEAD/Wild Weasel | Destroys radar units (FC ≥ 100); ARM auto-homes |
| Level Bomber | Area saturation (large blast radius) |
| Spotter | Improves artillery scatter (FO role) |
| Attack Helicopter | On-map, player-controlled, moves freely on map |

**AA:** Units with FC ≥ 100 are radar AA and always broadcasting (SEAD target). Hidden AA fires only if aircraft ≤ 150 m or calculated to-hit ≥ 9%.

**C2 Display:** aircraft shown as NATO air symbols. Strike inbound shown with approach vector.

---

## System 7 — Supply (Ammo Resupply)

**Doc:** Unit Schema Spec §Supply Model

### Summary
Ammo is the only finite resource. No fuel. Supply trucks and depots replenish ammo for nearby units.

- Supply range: 150 m
- Resupply is automatic while in range — continuous trickle, full slot reload in ~180 seconds
- Pauses if either unit is suppressed ≥ 40 or moving faster than `slow`
- Supply trucks have finite capacity; they must return to a depot when empty

**C2 Display:** supply status shown per weapon slot on unit card (coloured ammo bars). Low ammo = amber, empty = red.

---

## System 8 — Command and Rally

**Doc:** Unit Testing/Damage and Suppression.md §2d, Unit Schema Spec

### Summary
HQ units (class `hq`) and any unit with `radioChance > 0` can rally suppressed units.

**Radio:** when a rally order is issued, the commander rolls against `radioChance`. Success = can rally any friendly unit on the map. Failure = only units within voice range (≤150 m) are affected.

**Rally effect:** −15 suppression immediately. Clears `pinned` or `routing` state if suppression drops below threshold.

**Chain:** A0 (Battle Group HQ) → Company → Platoon → Section. Use junior commanders for routine rallies; preserve A0 for emergencies.

**C2 Display:** active rally shown as a line between commander and target unit.

---

## System 9 — Penetration and Armour

**Doc:** [Combat Formula Spec.md](Combat Formula Spec.md) §6–9 *(source research: Unit Testing/Weapon Penetration at Range.md, Unit Testing/Damage and Suppression.md §1a)*

### Range Degradation

| Ammo type | Degrades with range? | Notes |
|---|---|---|
| AP | Yes, linear | Drops to ~0 at max range |
| Sabot | Yes, faster than AP | At long range AP may exceed Sabot pen |
| HEAT | No | Same pen at all ranges; defeated by ERA and anti-HEAT armour |
| HE | No | Constant; usually needs over-penetration to damage armour |

```typescript
function penAtRange(basePen: number, ammoType: 'ap' | 'sabot', rangeM: number, maxRangeM: number): number {
  if (ammoType === 'ap') {
    return basePen * Math.max(0, 1 - rangeM / maxRangeM);
  }
  if (ammoType === 'sabot') {
    // Sabot degrades 1.6× faster than AP
    return basePen * Math.max(0, 1 - (rangeM / maxRangeM) * 1.6);
  }
  return basePen; // HEAT, HE: no degradation
}
```

---

## System 10 — Engineer Actions (Deferred)

Planned but not in Phase 4 scope. `engineer` class units will eventually support:
- Bridge laying (enables `very_heavy` crossing)
- Mine clearing
- Fortification (emplacement bonus to survivability)

---

## What Fires in What Order (Conflict Resolution)

All fire in real-time. Multiple shots can be in-flight simultaneously. Resolution order within a single server tick:

1. **Auto-fire** — units with `free_fire` or `return_fire` posture engage autonomously when conditions are met (see fire posture rules in Unit Schema Spec)
2. **Player-ordered direct fire** — fire orders execute at the moment the cooldown expires
3. **Artillery impacts** — resolved at impact time (after flight time from fire order)

Damage is applied immediately per hit, not batched. A target destroyed by the first hit in a tick will not receive damage from subsequent hits in the same tick (shots already in flight are cancelled).

---

## C2 Display Summary

All game information is rendered as C2 overlay elements, not game objects:

| Data | Display |
|---|---|
| Unit position | NATO symbology icon |
| Unit state | Badge: `OK`, `PINNED`, `RTG`, `SURR` |
| Sensor arc | Transparent cone, colour-coded by tier |
| Contact | Dashed icon with last-seen timestamp |
| Artillery inbound | Targeting reticle + impact ring |
| Supply status | Ammo bars on unit card |
| Rally action | Line between commander and target |
| Air strike | Approach vector + impact flash |

---

## Cross-Reference: Docs by System

**Canonical docs** (in `New Direction Docs/`) are the authoritative game rules. **Source research** (in `Unit Testing/`) documents WinSPMBT mechanics that informed our rules — useful as background, not as implementation specs.

| System | Canonical doc | Formula ref | Source research (WinSPMBT) |
|---|---|---|---|
| Movement | Unit Schema Spec | — | — |
| Spotting | Spotting and Contact Model.md | — | Spotting and Visibility.md |
| Direct fire | Combat Formula Spec §1 | §1 | To-Hit Mechanics.md |
| Suppression/morale | Combat Formula Spec §2, 3 | §2, 3 | Damage and Suppression.md |
| Artillery | Combat Formula Spec §4, 5 | §4, 5 | Artillery System.md |
| Air support | Game Systems Overview §6 | — | Air Support System.md |
| Supply | Unit Schema Spec §Supply | — | — |
| Rally/C2 | Orders and C2 Interaction.md | — | Damage and Suppression.md §2d |
| Penetration | Combat Formula Spec §6–9 | §6–9 | Weapon Penetration at Range.md |
| Unit data types | Unit Schema Spec | — | Unit Stat Breakdowns |
| Time model | Simulation Time Model.md | — | — |
| Orders | Orders and C2 Interaction.md | — | — |
| Campaign | CAMPAIGN_OVERVIEW.md | — | — |
| Factions | FACTIONS.md | — | — |
| Battalion | BATTALION_CREATION.md | — | — |

---

*This document should stay high-level. Detailed mechanics live in the canonical docs. Source research docs are reference-only — they are not authoritative for game rules.*
