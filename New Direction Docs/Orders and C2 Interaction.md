# Orders and C2 Interaction
*Federation Legionaires — authoritative spec*
*Last updated: 2026-03-19*

This document defines every order a player can issue, how they queue and resolve, and how the C2 display communicates order state back to the player. This is the heart of the "command terminal" aesthetic — the game should feel like issuing military orders through software, not clicking units around a map.

---

## Design Philosophy

- **Every unit action requires an explicit player order.** Units do nothing on their own except react (fire posture) and passively detect.
- **Orders are military in tone.** The UI says `ADVANCE TO GRID 447` not `Move here`.
- **Orders are persistent.** A unit executing a MARCH continues marching until it arrives, is interrupted, or receives a new order.
- **The player is the commander, not the soldier.** You set intent; the unit executes.

---

## Order Vocabulary

### Movement Orders

#### `MOVE [unit] ADVANCE TO [position]`
Cautious movement toward a destination.
- Speed: 50% of `maxSpeedM`
- Fire posture: active (unit fires per its `firePosture` setting en route)
- Movement state: `slow` throughout
- Use case: closing to contact, moving through contested terrain

#### `MOVE [unit] MARCH TO [position]`
Full-speed movement, combat secondary.
- Speed: 100% of `maxSpeedM`
- Fire posture: effectively `hold_fire` while moving (unit does not stop to engage)
- Movement state: `fast` throughout
- Use case: repositioning, reinforcing, road movement behind lines

**Waypoint Queueing:** Shift-click additional positions while a unit is selected to append waypoints to the current order. The unit executes waypoints in sequence. Waypoints can mix ADVANCE and MARCH segments — each waypoint inherits the mode it was queued with. The active route is displayed as a line on the map with segment markers.

New order (without shift) **cancels** the current queue and replaces it.

Maximum queue depth: 4 waypoints.

#### `FACE [unit] [bearing]`
Rotate to face a direction without moving.
- Does not consume movement; happens over ~2 seconds
- Does not change movement state (a halted unit stays halted)
- Use case: orienting a hull-mounted weapon, optimising armour facing before an assault

#### `REVERSE [unit] TO [position]`
Move backward while keeping current facing (front armour toward the threat).
- Speed: 33% of `maxSpeedM` (reversing is slow)
- Unit heading does not change — rear is toward destination
- Use case: withdrawing from contact without exposing rear armour, backing into hull-down position
- Not available for infantry or hovercraft (`moveClass: 'leg'` or `'hover'` → order rejected). All tracked and wheeled vehicles can reverse.

---

### Fire and Engage Orders

#### `ENGAGE [unit] → [contact]`
Direct fire attack on a specific contact.
- Requires contact to be at tier DETECTED or higher in the unit's own sensor picture
- Server selects optimal weapon slot and ammo type automatically (see Unit Schema Spec §Ammo Priority)
- Unit rotates to face target (turret-mounted weapons rotate freely; hull-mounted weapons may require unit rotation)
- Fires as soon as weapon cooldown expires; continues firing on cooldown until contact is LOST or order is cancelled

#### `ENGAGE [unit] → [contact] WITH SLOT [0–3]`
As above, but forces a specific weapon slot.
- Use case: saving main gun ammo, using ATGMs at range before closing, HE vs a soft target instead of auto-selected Sabot

#### `SUPPRESS [unit] → [position]`
Area fire on a grid position regardless of confirmed contact.
- Does not require a contact — fires at coordinates
- Uses HE ammo; hits are distributed in a radius around the target position
- Requires DETECTED or better contact **or** a position specified by a teammate
- Use case: suppressing a treeline, keeping enemy heads down, area denial
- Continues until ammo type exhausted, order cancelled, or unit suppressed

#### `SMOKE [unit] → [position]`
Fire a smoke round at a target position.
- Requires smoke ammo in any weapon slot
- Creates a smoke cloud on impact (see Spotting and Contact Model §Smoke)
- One-shot order — unit does not continue firing smoke automatically

---

### Fire Posture Orders

These are standing states, not one-time orders. They persist until changed.

#### `SET POSTURE [unit] FREE FIRE`
Unit autonomously engages any valid target in sensor range.
- Fires at closest/highest-priority target when cooldown is ready
- Use case: defensive positions, known-contact areas

#### `SET POSTURE [unit] RETURN FIRE`
Unit fires only if it has been fired upon (default for all units).
- Engages the unit that fired at it, not other contacts
- Use case: standard posture, keeps units from revealing position unnecessarily

#### `SET POSTURE [unit] HOLD FIRE`
Unit never fires autonomously.
- Only fires on explicit `ENGAGE` order from player
- Use case: ambush setup, scouts maintaining concealment, artillery waiting for fire mission

#### `SET MAX RANGE [unit] [metres]`
Cap the range at which this unit will auto-engage.
- Applies to all auto-fire (FREE FIRE and RETURN FIRE)
- Does not affect explicit `ENGAGE` orders
- Default: full weapon range
- Example: `SET MAX RANGE Scout 300m` — scout won't auto-fire beyond 300m, preserving concealment
- Example: `SET MAX RANGE Ambush 150m` — infantry hold fire until enemy is at close range
- Set to 0 to effectively disable auto-fire without changing posture (useful if you want to switch posture back without forgetting the range cap)

---

### Smoke and Countermeasure Orders

#### `DEPLOY SMOKE [unit]`
Fire all onboard smoke discharger salvos instantly.
- Creates a smoke cloud around the unit (~30m radius)
- Consumes `smokeDischargers` charges (tracked in `UnitInstance`)
- Instant activation; smoke visible within 1 second

#### `ACTIVATE EW [unit]`
Deploy one charge of the unit's active protection or screening system.
- Arena (EW 1–2): intercepts one incoming ATGM
- VIRSS (EW 3–4): ejects anti-TI screening smoke around unit, defeats Thermal Imaging for ~20 seconds
- Consumes one `ewCharges`
- Arena activates reactively (auto-fires when ATGM is detected inbound); VIRSS is manual

---

### Indirect Fire Orders

#### `CALL ARTY → [position]`
Request artillery or mortar fire on a grid position.
- Any unit can call — no dedicated FOO required (simplified from WinSPMBT)
- Accuracy depends on the calling unit's RF and whether it has LOS to the target (see Combat Formula Spec §4)
- Arty arrives after a delay determined by the battery's position and caliber (minimum 15s, typical 30–45s for on-map; up to 90s for off-map)
- Calling unit does not need to maintain LOS — once the mission is plotted, the rounds are in flight

#### `CALL ARTY → [contact]`
As above, targeting a contact's last known position.
- If contact is CONFIRMED: uses current position
- If contact is DETECTED: uses approximate position (adds 50m scatter on top of normal CEP)
- If contact is LOST: uses last known position; scatter doubles

#### `COUNTER-BATTERY → [enemy arty unit]`
Order own off-map artillery to engage enemy off-map artillery.
- Requires own off-map arty to have range reach (see Combat Formula Spec §10)
- Enemy battery identified by observed fire mission (impacted rounds are heard/spotted)

---

### Air Support Orders

#### `CALL AIR [type] → [position]`
Request an air strike from available strike points.
- Types: `FIGHTER_BOMBER`, `SEAD`, `LEVEL_BOMBER`, `SPOTTER`
- Strike points are finite per scenario; displayed in the orders panel
- Aircraft arrive 90 seconds after call regardless of type (see Simulation Time Model)
- SEAD must be ordered before other air if radar AAA is present — it executes first

#### `CALL AIR SPOTTER → [position]`
Call unarmed spotter/UAV to provide FO support.
- Arriving spotter acts as a high-quality observer: +60% detection accumulation rate
- All artillery called while spotter is on station uses spotter as FO (reduces scatter, see Combat Formula Spec §4)
- Spotter loiters for 120 seconds then exits
- **Killable:** prop spotter planes can be engaged by any AA unit in range. UAVs fly at high altitude and require dedicated AA guns or SAMs to engage (short-range MANPADS cannot reach them). Losing the spotter mid-mission cancels the FO bonus on any in-flight artillery

---

### Transport Orders

#### `EMBARK [infantry unit] → [transport unit]`
Order infantry to board a nearby transport.
- Transport must be within 50m and stationary
- Infantry must not be in combat (suppression < 40)
- Boarding takes 10 seconds; unit is unavailable during embark

#### `DISMOUNT [transport unit]`
Order carried infantry to exit at current position.
- Dismounted infantry are treated as fast-moving and bunched for 5 seconds (vulnerable)
- Always dismount in cover — in the open, a burst on dismount can be devastating
- Transport remains in place; infantry can be immediately issued a movement order but effectiveness is degraded for 5 seconds

---

### Helicopter Transport Orders

*(Specced now; implementation deferred until ground combat is working.)*

Applies to `unitClass: 'helicopter_transport'` and `'helicopter_attack'`. All helicopters are always on-map and player-controlled.

---

#### Altitude States

Helicopters operate in one of three discrete altitude states. This is not a continuous 3D value — it is a mode with distinct rules.

| State | Description | Concealment | LOS | Can load/unload/resupply |
|---|---|---|---|---|
| **LANDED** | On the ground, rotors running | None | Ground-level | ✅ Yes |
| **LOW (NOE)** | Nap of the Earth — below local terrain height | ✅ Terrain-masked | Limited by terrain | ❌ No |
| **HIGH** | Above all terrain — open sky | ❌ None | Full map arc | ❌ No |

**LOW altitude concealment:** The server compares the helicopter's position against the surrounding heightmap. If terrain within 200m rises above the helicopter's NOE flight path, it masks the helicopter from observers on the far side of that terrain — the same LOS raycasting used for ground units. Hugging a ridgeline makes a helicopter invisible to everything behind it.

**HIGH altitude spotting:** At HIGH, the helicopter gains elevated LOS across the entire map with no terrain masking. Use this to spot, then drop back to LOW to act. The tradeoff: HIGH is visible to everything.

**Altitude changes take time** — not instantaneous. Transition time:
- LOW → HIGH: 8 seconds
- HIGH → LOW: 5 seconds (descent is faster)
- Any state → LANDED: must be over valid landing zone; takes 5 seconds to touch down
- LANDED → LOW: 4 seconds to lift off

During any altitude transition the helicopter cannot fire or change heading.

---

#### `ALTITUDE [helo] LOW / HIGH`
Set helicopter altitude state.
- Transitions follow the timing above
- Helicopter continues moving during transition (heading is maintained)
- Cannot transition to LANDED via this order — use `LAND` instead

#### `LAND [helo] AT [position]`
Fly to position and land.
- **Landing zone requirements:** clear terrain only — no woods, buildings, or slope > 20°. Cannot land on bridges over water.
- Helicopter transitions to LANDED state on arrival (5 second touchdown)
- Remains LANDED until given a new order — does not auto-lift
- LANDED helicopter is stationary and at maximum exposure (signature 2.0×)

#### `PICKUP [helo] → [infantry unit]`
Fly to infantry, land, board them, lift.
- Helicopter navigates to a valid landing zone within 50m of the infantry unit
- Both helicopter AND infantry expend movement budget during boarding — if either has suppression ≥ 40, boarding is aborted and helicopter lifts immediately
- Boarding time: **15 seconds per infantry unit**
- Helicopter auto-lifts to LOW once all designated infantry are aboard

#### `INSERT [helo] → [position]`
Fly to position, land, unload all passengers, lift.
- Same landing zone requirements as `LAND`
- Unload time: **15 seconds per infantry unit** (same as boarding — loading and unloading cost MP for both parties)
- Passengers unloading into a mined hex trigger a mine check before they can move
- Disembarking infantry are exposed for 5 seconds (same as ground dismount)
- Helicopter auto-lifts to LOW after all passengers are out

---

#### AA Engagement by Altitude

| Altitude | Vulnerable to |
|---|---|
| LANDED | Everything — small arms, MG, all AA |
| LOW (NOE) | FLAK/AAMG (WC4), MANPADS, autocannon (WC19), short-range SAMs |
| HIGH | All of the above + long-range SAMs; immune to small arms and MG |

**FLAK/AAMG (WC4)** engages helicopters at **any** altitude without restriction — these are the primary helicopter killers.

**MANPADS** (shoulder-fired SAMs) can engage LOW and LANDED helicopters. They cannot reach HIGH-altitude fixed-wing or UAVs — those require dedicated AA guns or radar SAMs.

**AA radar** (`fc ≥ 100`) spots helicopters beyond normal ground vision range regardless of altitude. A radar-equipped AA unit will detect a LOW-altitude helicopter that is terrain-masked from all other observers.

**Hidden AA fire threshold:** Hidden AA units (fire posture `hold_fire` or `return_fire`) will only break cover to engage a helicopter if the helicopter is within 150m OR the calculated to-hit exceeds 9% — same rule as for aircraft.

---

#### Resupply

Helicopters **must be LANDED** to resupply. Hovering next to a supply truck does not work. Resupply follows the same trickle rate as ground units (180 seconds per full slot reload) but only while LANDED and within 150m of supply.

---

#### Capacity

`UnitType.transportCapacity` applies to helicopters the same as ground APCs.

| Class | Typical capacity |
|---|---|
| Light (`class 204`) | 1 infantry unit |
| Transport (`class 53`) | 2 infantry units |
| Heavy (`class 205`, Chinook-type) | 3–4 infantry units |
| Attack (`helicopter_attack`) | 0 — cannot carry infantry |

---

### Fortification Orders

#### `ENTRENCH [unit]`
Order a unit to dig in at its current position, gaining a defensive bonus.
- Unit must be stationary (`full_halt`) and not under fire (suppression < 20)
- Takes **120 seconds** to complete
- Effect: `entrenched: true` on `UnitInstance` — reduces incoming damage and suppression accumulation by 30%
- Movement cancels the entrenched state
- Infantry and towed artillery only — tracked/wheeled vehicles cannot entrench
- *(Deferred: WinSPMBT limits this to deployment phase. We may extend it to gameplay in Phase 4.)*

---

### C2 and Rally Orders

#### `RALLY [commander] → [unit]`
Commander attempts to reduce suppression on a target unit.
- Commander rolls `radioChance`; success = map-wide range, failure = voice range only (150m)
- Effect: −15 suppression on target immediately
- Rally has a 15-second cooldown per commander before it can be used again
- Routing or surrendered commanders have zero rally influence
- Use the chain: Company → Platoon before committing A0 (Battle Group HQ)

---

## Group Orders (Formation Select)

Multiple units can be selected simultaneously and issued a single order. Each unit receives the order independently — they do not move in formation, they each pathfind to the same destination.

- **Click + drag** to box-select multiple units
- **Shift+click** individual units to add to selection
- **All selected units** receive the next movement or posture order issued
- **ENGAGE and RALLY** are always single-unit orders — group selection is cleared when either is issued

Use case: issuing the same MARCH order to a whole platoon, setting a formation to HOLD FIRE before an ambush.

---

## Order Queue and Cancellation

### Queueing
- **Shift+click** appends a waypoint to a unit's movement queue (up to 4 waypoints)
- The active route is shown as a segmented line on the map; each segment labelled ADVANCE or MARCH
- Non-movement orders (ENGAGE, RALLY, etc.) execute immediately and do not queue

### Cancellation
- **Click unit → press Cancel (or new order without Shift)** clears the movement queue
- A unit that takes fire and reaches suppression ≥ 40 automatically suspends its movement order (does not cancel — it resumes when suppression drops below 40)
- A unit that is destroyed or surrenders has all orders cleared

### Order Priority
If a unit receives a direct `ENGAGE` order while executing a movement order:
- MARCH → `ENGAGE` is queued; unit finishes current waypoint segment, then fires
- ADVANCE → `ENGAGE` executes immediately; movement resumes after firing (ADVANCE assumes weapons-ready)

---

## Server-Side Order Resolution

Orders are sent to the server as command messages:

```typescript
type OrderMessage =
  | { type: 'MOVE';        unitId: string; mode: 'advance' | 'march'; waypoints: Vec2[] }
  | { type: 'FACE';        unitId: string; bearingDeg: number }
  | { type: 'ENGAGE';      unitId: string; contactId: string; slotOverride?: number }
  | { type: 'SUPPRESS';    unitId: string; posX: number; posZ: number }
  | { type: 'SMOKE';       unitId: string; posX: number; posZ: number }
  | { type: 'SET_POSTURE'; unitId: string; posture: 'free_fire' | 'return_fire' | 'hold_fire' }
  | { type: 'SET_MAX_RANGE'; unitId: string; rangeM: number }
  | { type: 'DEPLOY_SMOKE'; unitId: string }
  | { type: 'ACTIVATE_EW'; unitId: string }
  | { type: 'CALL_ARTY';   callerUnitId: string; targetPos: Vec2; contactId?: string }
  | { type: 'CALL_AIR';    strikeType: AirStrikeType; targetPos: Vec2 }
  | { type: 'EMBARK';      unitId: string; transportId: string }
  | { type: 'DISMOUNT';    transportId: string }
  | { type: 'RALLY';       commanderId: string; targetUnitId: string }
  | { type: 'ALTITUDE';   unitId: string; state: 'low' | 'high' }
  | { type: 'LAND';       unitId: string; targetPos: Vec2 }
  | { type: 'PICKUP';     unitId: string; targetUnitId: string }
  | { type: 'INSERT';     unitId: string; targetPos: Vec2 }
  | { type: 'REVERSE';    unitId: string; targetPos: Vec2 }
  | { type: 'ENTRENCH';   unitId: string }
  | { type: 'CANCEL';     unitId: string };
```

**Validation:** The server rejects invalid orders and returns a reason code. Examples:
- `ENGAGE` on a contact below DETECTED tier → `ERR_TARGET_NOT_ACQUIRED`
- `CALL_ARTY` with no ammo remaining → `ERR_NO_ARTY_AVAILABLE`
- `EMBARK` when infantry is suppressed ≥ 40 → `ERR_UNIT_SUPPRESSED`
- `DISMOUNT` when transport is moving fast → `ERR_TRANSPORT_MOVING`

**Confirmation:** Valid orders are echoed back to the client with status `ACCEPTED`. The client renders a visual indicator on the unit until the order begins executing (`EXECUTING`) or completes (`DONE`).

---

## C2 Display: Order Feedback

All pending and active orders are visible on the map.

| Order state | Display |
|---|---|
| Queued movement | Dashed route line, waypoint markers |
| Active movement | Solid route line, animated unit icon moving |
| Queued ENGAGE | Dashed target line from unit to contact |
| Active ENGAGE | Solid line, pulsing when firing |
| CALL ARTY (inbound) | Targeting reticle at impact point, countdown timer |
| CALL AIR (inbound) | Approach vector arrow, countdown to arrival |
| RALLY (in progress) | Line from commander to target, fading when resolved |
| HOLD FIRE posture | Unit icon has amber ring |
| FREE FIRE posture | Unit icon has red ring |
| RETURN FIRE (default) | No ring (default state, no indicator needed) |
| MAX RANGE set | Unit card shows range cap value in amber |

---

## WinSPMBT Orders: What We Kept, What We Changed, What We Dropped

| WinSPMBT Order | Status | Our Equivalent |
|---|---|---|
| Move to hex | ✅ Kept | MOVE ADVANCE / MARCH |
| Advance to contact | ✅ Adapted | ADVANCE move posture |
| Move at sustained speed | ✅ Adapted | MARCH move posture |
| Fire at target | ✅ Kept | ENGAGE |
| Area fire / beat zone | ✅ Kept | SUPPRESS |
| Fire smoke round | ✅ Kept | SMOKE |
| Deploy smoke dischargers | ✅ Kept | DEPLOY SMOKE |
| Set max fire range | ✅ Kept | SET MAX RANGE |
| Call artillery | ✅ Kept | CALL ARTY |
| Counter-battery | ✅ Kept | COUNTER-BATTERY |
| Request air strike | ✅ Kept | CALL AIR |
| Rally unit | ✅ Kept | RALLY |
| Dismount infantry | ✅ Kept | DISMOUNT |
| Embark infantry | ✅ Kept | EMBARK |
| Activate EW (Arena/VIRSS) | ✅ Kept | ACTIVATE EW |
| Set unit facing | ✅ Kept | FACE |
| Suppress with cannon (as intent) | ✅ Adapted | SUPPRESS order with HE |
| Register priority hex | ❌ Dropped | Arty delay is fixed; no pre-registration needed in real-time |
| VIRSS auto-smoke toggle | ❌ Dropped | Merged into ACTIVATE EW |
| Delay artillery fire | ❌ Dropped | Not needed — arty delay is inherent |
| Reverse movement | ✅ Added | REVERSE (back up while holding front facing) |
| Entrench / dig in | ✅ Added | ENTRENCH (infantry + towed arty; 120s, deferred to Phase 4) |
| Paratroop drop | ❌ Deferred | Phase 5+ if scenarios require it |
| Minefield deployment via arty | ❌ Deferred | Engineer phase |
| Go prone (explicit) | ❌ Dropped | Automatic at `full_halt` for infantry |
| Auto-rally toggle | ❌ Dropped | Rally is always manual; AI does not auto-rally |
| Change global visibility | ❌ Dropped | Scenario setting, not runtime order |
| SEARCHING preference | ❌ Dropped | Detection is per-unit, not a global slider |

---

*This document is the canonical order vocabulary. Any system that introduces a new player action must add it here.*
