# Simulation Time Model
*Federation Legionaires — authoritative reference*
*Last updated: 2026-03-19*

This document defines once, authoritatively, what time means in this game. Any other doc that mentions ticks, turns, seconds, or cooldowns defers to this one.

Cross-document enum/timer/phase contracts are centralized in AUTHORITATIVE_CONTRACTS.md.

---

## Core Model

**The game runs in real time. 1 second of play = 1 second of real time.**

This is a pure real-time tactics game (RTT). There is no turn structure, no simultaneous-resolution pulse, and no time compression. The WinSPMBT source data uses a 5-minute turn as its unit — that value is kept as a conversion reference only, never as a gameplay unit.

```
WinSPMBT "1 turn" = 300 seconds = reference only, not a game concept
```

---

## Server Tick Rate

The server runs at **20 Hz (one tick every 50 ms)**.

This rate was chosen because:
- It is fast enough that movement and fire feel continuous to players
- It is slow enough that a single server can handle 100+ units without CPU pressure
- State deltas broadcast every second (not every tick) keep bandwidth low

The tick rate is a server config constant. It should not need to change, but if combat feels laggy it can be raised to 30 Hz.

```typescript
const TICK_RATE_HZ   = 20;
const TICK_MS        = 1000 / TICK_RATE_HZ;  // 50ms
const TICKS_PER_SEC  = TICK_RATE_HZ;         // 20
```

---

## Update Frequency Table

Systems run at different frequencies. This is the canonical reference.

| System | Frequency | Trigger |
|---|---|---|
| Unit movement integration | Every tick (50ms) | Continuous |
| Weapon cooldown countdown | Every tick (50ms) | Continuous |
| Projectile / shell flight | Every tick (50ms) | While in-flight |
| Fire posture auto-fire check | Every tick (50ms) | Continuous |
| Movement state flag update | Every tick (50ms) | Continuous |
| Suppression decay | Every second | Interval |
| Morale state check | Every second | Interval |
| Sensor / LOS detection update | Every second | Interval |
| Resupply trickle | Every second | While in supply range |
| State delta broadcast to clients | Every second | Interval |
| Suppression accumulation | On event | Shot lands near unit |
| Damage application | On event | Shot hits unit |
| ERA depletion | On event | ERA activated |
| Ammo consumption | On event | Shot fired |
| Rally effect | On event | Rally order issued |
| Air support arrival | On event | 90s after call |

**Rule of thumb:** anything that affects position or targeting runs every tick. Everything else runs every second or on events.

---

## Cooldown Semantics

Weapons do not fire on a schedule — they fire when ordered (or via fire posture auto-fire), then enter a cooldown. The cooldown is the only rate limiter.

```typescript
// ROF from WinSPMBT is shots per 5-minute (300s) turn.
// ROF_REALTIME_MULTIPLIER converts to a real-time-feel rate.
// This is the primary combat pacing lever — increase to speed up firefights.
const ROF_REALTIME_MULTIPLIER = 5;

cooldownSeconds = (300 / effectiveROF) / ROF_REALTIME_MULTIPLIER;
// effectiveROF = f(maxROF, experience, FC) — see Combat Formula Spec §9
```

**Each weapon slot has its own independent cooldown timer.** Slots do not block each other. An MG (slot 1) can fire while the main gun (slot 0) reloads.

Cooldown timers are stored on `UnitInstance` at runtime, not in `UnitType`. They reset on shot fired and count down each tick.

---

## Movement State Timing

Movement state is derived from a **rolling 10-second history** of distance moved, updated every tick.

```typescript
const HALT_WINDOW_SEC      = 10;   // full seconds stationary required for full_halt
const SHORT_HALT_WINDOW_SEC = 3;   // seconds stationary for short_halt

// Computed each tick:
const recentSpeed = distanceMovedInLast10Sec / 10;          // m/s
const maxSpeedMs  = unit.type.maxSpeedM / 300;               // m/s at clear terrain

firerState:
  recentSpeed === 0 && stoppedFor >= HALT_WINDOW_SEC       → 'full_halt'
  recentSpeed === 0 && stoppedFor >= SHORT_HALT_WINDOW_SEC → 'short_halt'
  recentSpeed <= maxSpeedMs * 0.25                         → 'slow'
  else                                                      → 'fast'
```

`stoppedFor` is a server-side counter (seconds) that increments while `recentSpeed === 0` and resets to 0 the moment the unit moves.

---

## "Per Turn" Conversion Reference

Any WinSPMBT stat expressed "per turn" converts as follows. This table is for data import only — the game never uses turns as a unit.

| WinSPMBT concept | Conversion | Real-time equivalent |
|---|---|---|
| Speed (MP/turn) | × 50 | max metres per 300s at full speed |
| Weapon range (hexes) | × 50 | metres |
| Vision range (hexes) | × 50 | metres |
| ROF (shots/turn) | ÷ 300 × ROF_REALTIME_MULTIPLIER | shots/second effective rate |
| Artillery off-map range | decode: `(encoded − 200 + 10) × 1000` | metres |

---

## State Broadcast

The server does **not** stream every tick to clients. It broadcasts a **state delta** once per second containing only values that changed since the last broadcast.

```typescript
interface StateDelta {
  tick:       number;          // server tick counter (for ordering)
  timestamp:  number;          // server epoch ms
  units:      UnitDelta[];     // only units with changed fields
  events:     GameEvent[];     // shots fired, hits, deaths, etc. since last broadcast
}
```

Clients interpolate unit positions between broadcasts using the last-known velocity. This keeps perceived movement smooth at 60 fps even though positions only update from the server once per second.

**Events** (shots, explosions, rallies, air strikes) are sent immediately as they occur, not batched with the second interval. They travel in the same WebSocket channel but are flagged `priority: true`.

---

## What This Replaced

| Old concept | New concept |
|---|---|
| "End of turn resupply" | Continuous trickle while in supply range |
| "Shots per turn" | Per-shot cooldown (cooldownSeconds formula) |
| "Moved this turn / last turn" | Rolling 10s movement history |
| "Per turn radio check" | Per rally-attempt radio roll |
| "Opportunity fire during enemy turn" | Auto-fire via `firePosture` setting |
| "Next tick" air arrival | Strike-type delay from theater support table (typically 10-45 seconds) |
| "Suppression decay per turn" | 0.13 / 0.07 / 0.03 points per second by state |

---

*If a system doc uses the word "turn" to mean a gameplay unit (not the 300s conversion reference), it is out of date. Fix it to reference seconds, ticks, or events.*
