# Unit Schema Specification
*Federation Legionaires — authoritative TypeScript type definitions*
*Last updated: 2026-03-19*

This is the canonical field list for the unit and weapon database. These types are shared between server and client. The JSON files loaded at server startup must conform to this schema.

---

## Stat Conversion Reference

All WinSPMBT stats are converted to real-world units:

| WinSPMBT stat | Multiply by | Result unit | Notes |
|---|---|---|---|
| Weapon Range (hexes) | × 50 | metres | |
| Speed (MP/turn) | × 50 | metres/turn | Max distance per 5-min tick on clear terrain |
| Vision (hexes) | × 50 | metres | |
| Swim Speed (hexes) | × 50 | metres/turn | |
| Artillery range (encoded) | decode first | metres | See formula 10 decode |
| Armour values | × 1 | cm RHA equivalent | No conversion needed |

---

## WeaponSlot

```typescript
interface WeaponSlot {
  // Identity
  weaponName:   string;   // display name
  weaponClass:  number;   // WinSPMBT weapon class (0=infantry primary, 1=rifle, 2=AT, 3=MG, etc.)

  // Accuracy
  acc:          number;   // 0–30; accuracy stat (barrel formula or flat value)
  warheadSize:  number;   // 0–30; WH — variance applied per shot (Formula 8)

  // Range
  rangeM:       number;   // effective range in metres (hex × 50)
  minRangeM:    number;   // minimum engagement range in metres; 0 for guns, 50–200 for ATGMs

  // Ammo by type (rounds carried)
  ammoHE:       number;   // HE rounds
  ammoAP:       number;   // AP (kinetic) rounds
  ammoHEAT:     number;   // HEAT (shaped charge) rounds
  ammoSabot:    number;   // Sabot / APFSDS rounds

  // Penetration at muzzle (cm RHA)
  penAP:        number;   // AP penetration at muzzle
  penSabot:     number;   // Sabot penetration at muzzle (degrades faster than AP)
  penHEAT:      number;   // HEAT penetration (constant at all ranges)

  // Anti-soft capability
  heKill:       number;   // HE kill value vs soft targets / infantry

  // Rate of fire
  rof:          number;   // max shots at exp 100 (Formula 9 scales this down)

  // Traverse type
  traverseType: 'turret' | 'hull' | 'fixed';
  //   turret = 360°, hull = ±30°, fixed = forward-only (co-ax)
}
```

---

## UnitType

The static definition of a unit. Loaded from JSON, never mutated at runtime.

```typescript
interface UnitType {
  // ── Identity ──────────────────────────────────────────────────────────────
  id:           string;   // unique key, e.g. "usa_m1a2_abrams"
  name:         string;   // display name
  nation:       string;   // "USA" | "RUS" | "CHN" | etc.
  obSlot:       number;   // original WinSPMBT OB slot (for data traceability)
  unitClass:    UnitClass;
  yearFrom:     number;   // first year available
  yearTo:       number;   // last year available (9999 = still in service)
  cost:         number;   // scenario points value

  // ── Mobility ──────────────────────────────────────────────────────────────
  maxSpeedM:    number;   // max metres per 5-min turn on clear ground (Speed × 50)
  swimSpeedM:   number;   // metres/turn in water; 0 = cannot swim
  moveClass:    MoveClass;
  weightClass:  WeightClass;

  // ── Weapons ───────────────────────────────────────────────────────────────
  weapons:      [WeaponSlot?, WeaponSlot?, WeaponSlot?, WeaponSlot?];
  //            slots 0–3; slot 0 = primary (most reliable, crew-multiplied for infantry)

  // ── Sensors & Electronics ─────────────────────────────────────────────────
  visionM:      number;   // vision range in metres (Vision × 50)
  //   0–750m   = daylight only
  //   750–1500m = NVG
  //   1500–2000m = Image Intensifier / LLTV
  //   2000m+    = Thermal Imaging (sees through smoke)
  //   2500m+    = Ground Surveillance Radar (unaffected by smoke/weather)
  fc:           number;   // 0–140; fire control; ≥100 = radar AA
  rf:           number;   // 0–23; range finder; ≥20 = laser RF
  stabilizer:   number;   // 0–5; gyro stabilizer
  ew:           number;   // 0–4 for vehicles: EW / active protection (see EW table)
                          // for AA units: electronic warfare score vs aircraft defences

  // ── Comms & C2 ────────────────────────────────────────────────────────────
  radioChance:  number;   // 0–99; percent chance per rally attempt that radio contact succeeds

  // ── Defensive Systems ─────────────────────────────────────────────────────
  smokeDischargers: number;  // number of smoke salvo packs

  // ── Armour (cm RHA equivalent) ────────────────────────────────────────────
  //   Facing order: hullFront / hullSide / hullRear / turretFront / turretSide / top
  steelArmour:  ArmourFacings;
  heatArmour:   ArmourFacings;  // ≥ steelArmour values; if absent, use steelArmour
  eraLevel:     Partial<ArmourFacings>;
  //   ERA 1–10 = basic (HEAT only); 11–20 = Kontakt (kinetic too)

  // ── Survivability & Size ──────────────────────────────────────────────────
  maxCrew:      number;   // 1–12; crew/strength (hit points)
  survivability: number;  // 0–6; post-penetration crew survival odds (Formula 7)
  size:         number;   // 0–6; spotting and to-hit modifier

  // ── Transport ─────────────────────────────────────────────────────────────
  transportCapacity: number;  // infantry UNITS this vehicle can carry; 0 = cannot carry
  //   1 unit = one squad/section on the map
  //   Typical: T113 APC = 2 units, T2 Bradley IFV = 1 unit, T1 Abrams = 0
}
```

---

## UnitClass Enum

```typescript
type UnitClass =
  // Ground combat
  | 'mbt'           // Main Battle Tank
  | 'ifv'           // Infantry Fighting Vehicle
  | 'apc'           // Armoured Personnel Carrier
  | 'scout'         // Recon / scout vehicle
  | 'at_vehicle'    // Anti-tank vehicle (dedicated)
  | 'aa_vehicle'    // Anti-aircraft vehicle
  | 'arty_sp'       // Self-propelled artillery
  | 'arty_towed'    // Towed artillery (stationary to fire)
  | 'mortar'        // Mortar team
  | 'support'       // Logistics / supply / engineer vehicle
  // Infantry
  | 'infantry'      // Rifle squad / section
  | 'at_infantry'   // Anti-tank infantry team
  | 'aa_infantry'   // MANPADS / AA infantry team
  | 'engineer'      // Engineer squad (bridging, mineclearing, fortification)
  | 'sniper'        // Sniper (size 0)
  | 'hq'            // Command / HQ unit (rally bonus)
  // Air
  | 'helicopter_attack'
  | 'helicopter_transport'
  | 'fixed_wing';
```

---

## MoveClass Enum

```typescript
type MoveClass = 'track' | 'wheel' | 'leg' | 'hover' | 'air';
```

Terrain cost multipliers (divide maxSpeedM by these to get actual speed on terrain):

| Terrain | Track | Wheel | Leg | Hover |
|---|---|---|---|---|
| Clear / road | 1.0 | 1.0 | 1.0 | 1.0 |
| Rough / scrub | 1.5 | 2.0 | 1.2 | 1.3 |
| Woods | 2.5 | 4.0 | 1.5 | impassable |
| Urban | 2.0 | 2.5 | 1.3 | impassable |
| Soft mud | 2.0 | impassable | 1.5 | 1.1 |
| Ford (shallow) | 1.5 | 3.0 | 1.3 | 1.2 |
| Deep water | swimSpeed | impassable | impassable | impassable |
| Hill steep (>30°) | 2.0 | impassable | 2.0 | impassable |

---

## WeightClass Enum

Used for bridge crossing limits.

```typescript
type WeightClass = 'light' | 'medium' | 'heavy' | 'very_heavy';
```

Derived guideline (not enforced — override per unit if needed):

| Size | Default WeightClass | Examples |
|---|---|---|
| 0–1 | `light` | Infantry, jeep |
| 2–3 | `medium` | APCs, IFVs, light tanks |
| 4–5 | `heavy` | MBTs, SPGs, heavy APCs |
| 6 | `very_heavy` | Superheavy tanks, bridge layers |

Bridge ratings (design placeholder — map data specifies):

| Bridge type | Max WeightClass |
|---|---|
| Wooden | light |
| Steel/pontoon | medium |
| Concrete | heavy |
| Military bridge | very_heavy |

---

## ArmourFacings

```typescript
interface ArmourFacings {
  hullFront:   number;
  hullSide:    number;
  hullRear:    number;
  turretFront: number;
  turretSide:  number;
  top:         number;
}
```

---

## UnitInstance

The runtime mutable state of a deployed unit. One per unit on the map.

```typescript
interface UnitInstance {
  id:           string;       // unique runtime ID
  typeId:       string;       // references UnitType.id
  team:         number;       // 0 = player A, 1 = player B (or enemy)

  // Position
  posX:         number;       // metres from map origin
  posZ:         number;       // metres from map origin (Z = forward in Three.js)
  heading:      number;       // degrees, 0 = north

  // Health
  currentCrew:  number;       // remaining crew (0 = destroyed)
  suppression:  number;       // 0–100

  // Fire posture (player-configurable per unit)
  firePosture:  'free_fire' | 'return_fire' | 'hold_fire';
  //   free_fire   — engages any valid target in range/LOS automatically
  //   return_fire — only fires if the unit itself has been shot at (default)
  //   hold_fire   — never fires autonomously; only fires on explicit player order

  // Morale (derived from suppression, but tracked for UI)
  moraleState:  'normal' | 'pinned' | 'routing' | 'surrendered';

  // Ammo (per weapon slot)
  ammo: [
    AmmoState,  // slot 0
    AmmoState,  // slot 1
    AmmoState,  // slot 2
    AmmoState,  // slot 3
  ];

  // Movement tracking — real-time rolling window (see Simulation Time Model)
  // movedThisTurn / movedLastTurn / mpUsedThisTurn are REMOVED — turn-era concepts
  recentDistanceM:  number;   // metres moved in the last 10 seconds (rolling sum)
  stoppedForSec:    number;   // seconds continuously stationary; resets to 0 on any movement
  firerState:       'full_halt' | 'short_halt' | 'slow' | 'fast';  // derived each tick, cached here
  weaponCooldowns:  [number, number, number, number];  // seconds remaining per slot; 0 = ready

  // ERA depletion (tracks per-facing remaining charges)
  eraRemaining: Partial<ArmourFacings>;

  // EW charges remaining
  ewCharges:    number;

  // Smoke dischargers remaining
  smokeRemaining: number;

  // Experience (0–100, default 70)
  experience:   number;

  // Transport
  transportedBy:    string | null;  // UnitInstance.id of carrying vehicle, if any
  transportedUnits: string[];       // IDs of units being carried

  // Helicopter altitude (helicopters only; null for ground units)
  altitudeState:    'landed' | 'low' | 'high' | null;
  altitudeTransitioning: boolean;   // true during LOW↔HIGH transitions; cannot fire
}
```

---

## AmmoState

```typescript
interface AmmoState {
  he:    number;   // remaining HE rounds
  ap:    number;   // remaining AP rounds
  heat:  number;   // remaining HEAT rounds
  sabot: number;   // remaining Sabot rounds
}
// Initialised from UnitType.weapons[slot].ammo*
// Replenished by supply trucks or depots
```

---

## EW Value Reference (non-AA vehicles)

| EW value | System | Charges |
|---|---|---|
| 0 | None | — |
| 1 | Arena (intercepts ATGMs) | 1 |
| 2 | Arena | 2 |
| 3 | VIRSS (anti-TI smoke + IR jammer) | 1 |
| 4 | VIRSS | 2 |

---

## Supply Model

Ammo is the sole finite resource. No fuel tracking.

### Resupply Rules
- A unit within **150 m** of a friendly supply truck or supply depot is automatically resupplied — no player order required.
- Resupply is a continuous trickle. **Full reload of one weapon slot takes 180 seconds** (3 minutes) while in range.
  - Rate per second: `startingAmmo[slot] / 180` rounds/sec per ammo type
- Resupply pauses if either unit has suppression ≥ 40 or is moving faster than `slow` state.
- Supply trucks have a finite supply pool. When empty they must return to a depot to reload.

### Ammo Priority
When a unit fires, it selects ammo type based on target:
- vs. armoured target: Sabot > AP > HEAT > HE (in order of availability)
- vs. soft / infantry target: HE first; AP/Sabot ignored
- Player can override ammo selection manually

---

## What Is NOT in the Schema

These are deliberately excluded — either runtime-computed or handled by the game engine:

- **Terrain LOS** — computed from heightmap at runtime
- **Exact to-hit rolls** — Formula 1 at resolution time
- **Blast polygon** — Formula 5 at impact time
- **Formation / stance flags** — handled by order system
- **NBC protection** — deferred; not in planned scenarios
- **Fatigue** — deferred to Phase 5+ if added

---

*Schema is the contract between the unit database CSVs and the server. Any CSV field not in this schema is dropped at import time.*
