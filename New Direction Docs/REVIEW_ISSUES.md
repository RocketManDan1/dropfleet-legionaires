# Design Document Review — Issues Log
*Review completed: 2026-03-22*
*Status: Pre-implementation review of all 34 design documents (~17,400 lines)*

---

## CRITICAL — Must Fix Before Implementation

### C01: CSV Column Headers Duplicated
**Files:** All 3 unit CSVs (Terran, Ataxian, Khroshi)
**Problem:** Columns 49-50 are both labeled `Wpn1 HE Rds` instead of `Wpn4 HE Rds` / `Wpn4 AP Rds`. Every unit's weapon 4 ammo data is mapped to wrong columns.
**Fix:** Rename column 49 → `Wpn4 HE Rds`, column 50 → `Wpn4 AP Rds`.

### C02: SP Economy Model Disagrees Across 3 Docs
**Files:** MISSION_GENERATION.md, MISSION_LIFECYCLE.md, POST_MISSION_RESOLUTION.md
**Problem:** Three incompatible SP reward models:
- MISSION_GENERATION: difficulty multipliers (×1.0 / ×1.5 / ×2.0)
- MISSION_LIFECYCLE: fixed ranges ([200-300] easy, [400-500] hard)
- POST_MISSION_RESOLUTION: `floor(base_sp × multiplier) + bonuses`
**Fix:** Pick one canonical model, update the other two docs, add to AUTHORITATIVE_CONTRACTS.

### C03: Enemy Force Sizing — Units vs Platoons
**Files:** MISSION_LIFECYCLE.md, MISSION_GENERATION.md
**Problem:** MISSION_LIFECYCLE defines `enemyCountRange` in raw unit counts ([15-25] easy). MISSION_GENERATION defines `enemyPlatoonRange` in platoons ([2-3] easy). Without a canonical platoon size, these can't be reconciled.
**Fix:** Define canonical platoon sizes per faction in FORCE_ROSTERS or AUTHORITATIVE_CONTRACTS, then align both docs.

### C04: Mission Availability Threshold Contradiction
**Files:** LOBBY_AND_MATCHMAKING.md, UI_FLOW.md
**Problem:** LOBBY says "0% enemy influence = no missions." UI_FLOW says "0-20% enemy = no missions (Planet Secure)."
**Fix:** Pick one threshold, update both docs.

### C05: Strategic Value Tier Bonus Inverted
**Files:** POST_MISSION_RESOLUTION.md, MISSION_GENERATION.md
**Problem:** Both give +1 influence bonus for `strategic_value_tier = 1` (low value). This is backwards — high-value planets (tier 3) should yield more influence impact.
**Fix:** Change condition to `strategic_value_tier = 3` or invert the tier numbering.

### C06: VFX Particle Pool Budget Exceeds Cap
**Files:** VISUAL_EFFECTS.md
**Problem:** Pool allocation table totals 560 particles, but the hard cap is stated as 512.
**Fix:** Either reduce individual pool budgets to sum ≤ 512, or raise the cap to 560.

### C07: Influence Redistribution Rule Missing
**Files:** CAMPAIGN_PERSISTENCE.md, POST_MISSION_RESOLUTION.md
**Problem:** SQL constraint enforces `federation + ataxian + khroshi = 100`. When a mission reduces enemy influence, freed points must go somewhere. No doc specifies where.
**Fix:** Define the rule — e.g., "freed influence goes to Federation" or "split proportionally among remaining factions."

### C08: Offline Progression — Which Faction Increases?
**Files:** CAMPAIGN_PERSISTENCE.md
**Problem:** When no players are present, enemy influence rises. But if both Ataxian and Khroshi are on a planet, which one grows? At what rate?
**Fix:** Define faction priority or split behavior for offline influence growth.

### C09: ContactSnapshot `tier` Field Undefined on Wire
**Files:** NETWORK_PROTOCOL.md, AUTHORITATIVE_CONTRACTS.md
**Problem:** `tier: number` has no range specification. Is it the raw 0-100 accumulator value or a tier index 0-3? Both `tier` and `tierLabel` exist with unclear purpose.
**Fix:** Specify that `tier` is 0-100 integer (raw detection value) and `tierLabel` is the derived enum. Add to AUTHORITATIVE_CONTRACTS §9.

### C10: Auto-Fire Timing Undefined in Tick Loop
**Files:** SERVER_GAME_LOOP.md, Game Systems Overview.md
**Problem:** Phase 5 (Fire Resolution) doesn't specify when auto-fire checks occur relative to player fire orders. Can a unit auto-fire AND receive a player ENGAGE in the same tick?
**Fix:** Add explicit sub-phase ordering to SERVER_GAME_LOOP Phase 5.

### C11: Size 0 Detection Cap — Stated but Not in Formulas
**Files:** Spotting and Contact Model.md
**Problem:** Spec says size-0 units can't be detected above SUSPECTED by observers with visionM < 750m unless they fire. This rule is stated in prose (line 337-342) but absent from the `accumulationRate()` function.
**Fix:** Add a tier-cap check to the accumulation formula or add a separate post-accumulation clamp.

### C12: C2 Radio Range Without Command Unit — Undefined
**Files:** ENEMY_AI.md
**Problem:** When a command unit is destroyed, units share contacts "at standard C2 radio range." This range is never defined.
**Fix:** Define the fallback radio range in metres (e.g., 300m) and add to AUTHORITATIVE_CONTRACTS.

### C13: EW Charges vs Capability Type Mapping Missing
**Files:** RUNTIME_UNIT_STATE.md, Unit Schema Spec.md
**Problem:** `ewCharges: number` exists but how charges relate to the `ew: number (0-4)` capability type (Arena, VIRSS, etc.) is never specified.
**Fix:** Define the mapping — e.g., "ew type determines charge behavior; ewCharges is consumed one per incoming HEAT round."

---

## HIGH — Should Fix Before Implementation

### H01: Rally Cooldown — 15s Referenced but Never Defined
**Files:** RUNTIME_UNIT_STATE.md, Combat Formula Spec.md
**Problem:** `lastRalliedAtTick` comment references a 15-second cooldown absent from Combat Formula Spec §3.
**Fix:** Add rally cooldown constraint to Combat Formula Spec §3.

### H02: Suppression Decay Rates Missing from Simulation Time Model
**Files:** Simulation Time Model.md, Combat Formula Spec.md
**Problem:** Combat Formula Spec defines 3 state-dependent decay rates. Simulation Time Model just says "every second" with no cross-reference.
**Fix:** Add cross-reference or inline the rates in Simulation Time Model.

### H03: Battalion `in_mission` Status Never Written
**Files:** CAMPAIGN_PERSISTENCE.md, MISSION_LIFECYCLE.md, DEPLOYMENT_PHASE.md
**Problem:** Status value exists in the schema but no document specifies when it gets set.
**Fix:** Add battalion status transition to MISSION_LIFECYCLE at mission-join time.

### H04: "Meeting Engagement" Mission Type in DEPLOYMENT_PHASE
**Files:** DEPLOYMENT_PHASE.md, MISSION_GENERATION.md
**Problem:** Referenced in zone placement table but doesn't exist in the canonical 10 mission types.
**Fix:** Either add as 11th mission type or remove from DEPLOYMENT_PHASE and map to existing type (e.g., `seize`).

### H05: Upgrade Exclusivity Contradiction
**Files:** REPLACEMENT_AND_REINFORCEMENT.md, POST_MISSION_RESOLUTION.md
**Problem:** R&R line 109 says "no upgrades at replacement." POST_MISSION says upgrade milestones enable replacements with upgraded units.
**Fix:** Clarify: "Upgrades are available as replacement options ONLY IF the milestone has been unlocked."

### H06: Auto-Repair Threshold Ambiguity at Exactly 50%
**Files:** REPLACEMENT_AND_REINFORCEMENT.md
**Problem:** Units at exactly 50% crew fall between "fully restored" (>50%) and "combat ineffective" (<50%).
**Fix:** Change thresholds to ≥50% = deployable, <50% = combat ineffective.

### H07: Helicopter Eye Height Constant (100m for all altitudes)
**Files:** LOS_RAYCASTING.md, Orders and C2 Interaction.md
**Problem:** LOS returns 100m eye height for all air units. LOW altitude helicopters should be much lower (~30-50m).
**Fix:** Add altitude-dependent eye height: LANDED=2m, LOW=30m, HIGH=100m.

### H08: Observer Inside Building — LOS Blocked by Own Cell
**Files:** LOS_RAYCASTING.md, Spotting and Contact Model.md
**Problem:** Bresenham walk hits the building cell immediately, blocking all LOS for units inside urban terrain.
**Fix:** Add rule: "Observer's own cell is never treated as a full block" (skip first cell in walk).

### H09: Observer Inside Woodland — Skip Rule Not in Code
**Files:** LOS_RAYCASTING.md
**Problem:** Spec states observer's own forest cell doesn't apply woodland penalty. Pseudocode doesn't show this condition.
**Fix:** Add `if (cellIndex === 0) continue;` to woodland check in Bresenham callback.

### H10: Point-in-Polygon Vertex Ordering Assumption
**Files:** DEPLOYMENT_PHASE.md
**Problem:** Cross-product check assumes clockwise vertex ordering. Standard convex hull algorithms produce counter-clockwise.
**Fix:** Specify vertex ordering (e.g., "always clockwise") or make the test order-agnostic.

### H11: Bilinear Interpolation Edge Clamping Mismatch
**Files:** LOS_RAYCASTING.md, PATHFINDING.md
**Problem:** LOS clamps to `width-2`; pathfinding has no matching clamp. Off-by-one possible at grid edges.
**Fix:** Add matching clamp to pathfinding's `worldToCell()`.

### H12: A* 50K Node Cap May Fail on Large Maps
**Files:** PATHFINDING.md, AUTHORITATIVE_CONTRACTS.md
**Problem:** 50K open-list nodes = ~19% of a 512×512 grid. Complex obstacle layouts could return PATH_NOT_FOUND for reachable destinations.
**Fix:** Add note: "If PATH_NOT_FOUND, server retries with 2× budget on next tick (one retry max)."

### H13: Garrison Strength Referenced but Never Defined
**Files:** MISSION_GENERATION.md, CAMPAIGN_PERSISTENCE.md
**Problem:** `garrisonStrength > 70` used as a condition. Value range and derivation never specified.
**Fix:** Define range (0-100), derivation formula, and add to CAMPAIGN_PERSISTENCE planet state.

### H14: AA Interception Chance Completely Undefined
**Files:** THEATER_SUPPORT.md
**Problem:** Strikes "have a chance of being intercepted" near AA. No probability, range, or formula.
**Fix:** Define base interception chance (e.g., 30% per AA unit within 500m of strike path).

### H15: VFX Gravity Inconsistency
**Files:** VISUAL_EFFECTS.md
**Problem:** Debris definition uses full gravity (9.81), but particle update loop applies 30% gravity (9.81 × 0.3).
**Fix:** Clarify: debris uses full gravity override; other particles use 30%.

---

## MEDIUM — Fix During Implementation (25 items)

### M01: Scurrier Full-Halt Paradox
**Files:** FACTIONS.md
**Problem:** Fast melee units must reach `full_halt` (10+ seconds stationary) to trigger overrun. Contradicts their "always moving" archetype.
**Fix:** Define a shorter trigger (e.g., `short_halt` within 30m) or a different melee trigger.

### M02: Helicopter Altitude Transition — LOS/Detection State Undefined
**Files:** Orders and C2 Interaction.md, LOS_RAYCASTING.md
**Problem:** During 5-8 second altitude transitions, helicopter can't fire or change heading. LOS and detection state during transition undefined.
**Fix:** Define interpolated altitude during transition.

### M03: Entrench Order + Suppression Interaction
**Files:** Orders and C2 Interaction.md
**Problem:** If a unit is entrenching (120s) and gets pinned (suppression ≥ 40), does the order suspend (like movement) or cancel?
**Fix:** Define: "Entrench suspends while pinned, resumes when suppression drops below 40."

### M04: Infantry Dismount — Transport Destroyed Mid-Animation
**Files:** Orders and C2 Interaction.md
**Problem:** 5-second dismount vulnerability window. If transport is killed during dismount, infantry status unclear.
**Fix:** Define: infantry survives with 50% casualty penalty, or all killed.

### M05: Khroshi Jamming Activation Conditions
**Files:** THEATER_SUPPORT.md
**Problem:** "Khroshi EW can extend fire mission delays by 50%" — is this automatic, per-unit, or scenario-based?
**Fix:** Define trigger: "Active if any Khroshi EW unit is alive on the map."

### M06: Forward Observer Suppression State Effects
**Files:** THEATER_SUPPORT.md
**Problem:** If an FO has LOS but is suppressed/pinned, does the accuracy bonus still apply?
**Fix:** Define: "FO must be below suppression 40 to provide accuracy bonus."

### M07: Elite Suppression Floor Stacking
**Files:** ENEMY_AI.md, FACTIONS.md
**Problem:** Elite quality gives +30 suppression threshold. Ataxian faction floor is 70. Does an elite Ataxian unit have floor 100 (immune)?
**Fix:** Define: "Quality modifier adds to faction floor, capped at 89" (can still be routed by melee/special).

### M08: AI Flank Routes Use Stale Influence Maps
**Files:** ENEMY_AI.md
**Problem:** Influence maps update every 5s, BTs evaluate every 1s. AI may commit to flanks that are no longer valid.
**Fix:** This is acceptable as fog-of-war simulation. Add design note documenting this as intentional.

### M09: BT-Issued Orders vs Unit Order Queue
**Files:** ENEMY_AI.md, Orders and C2 Interaction.md
**Problem:** BT issues platoon-level orders. Unit-level order queue may already have commands. Interaction unspecified.
**Fix:** Define: "BT orders clear the unit's current queue (same as player orders without shift)."

### M10: `firerState` vs `speedState` Naming Inconsistency
**Files:** Unit Schema Spec.md, PATHFINDING.md
**Problem:** Same concept named differently across docs.
**Fix:** Standardize to `speedState` everywhere. Update Unit Schema Spec.

### M11: Reserve Flag Limits Undefined
**Files:** BATTALION_CREATION.md
**Problem:** Can all units be flagged as reserve (leaving 0 to deploy)? Maximum reserves?
**Fix:** Define: "Minimum 1 company must remain non-reserve."

### M12: Deployment Zone Sizing for Solo Players
**Files:** DEPLOYMENT_PHASE.md
**Problem:** Minimum zone area is 250,000 m² (same as target per player). Solo player gets the same space as 4 players?
**Fix:** Define: minimum is for 1 player; zone scales up with player count.

### M13: Convex Hull "Discard Concavities" Wording
**Files:** DEPLOYMENT_PHASE.md
**Problem:** Confusing phrasing. A convex hull doesn't "discard concavities."
**Fix:** Reword: "Server computes the convex hull of candidate positions."

### M14: Auto-Deploy Failure Threshold
**Files:** DEPLOYMENT_PHASE.md
**Problem:** Spiral outward placement has no defined failure threshold before units go to reserve.
**Fix:** Define: "After 20 failed placement attempts, unit is added to reserve pool."

### M15: Disconnected Unit Return — Pre-Mission State Edge Case
**Files:** POST_MISSION_RESOLUTION.md
**Problem:** Units removed by timeout grace are "returned to pre-mission state." But what if pre-mission state was invalid?
**Fix:** Define: "Returned to last valid `active` state snapshot taken at mission join."

### M16: Ammo Persistence Contradiction
**Files:** POST_MISSION_RESOLUTION.md
**Problem:** "Ammunition is not tracked between missions" but AAR shows `shotsFired/shotsHit`. Are ammo counts limited within a mission?
**Fix:** Clarify: "Ammo is finite per mission (from unit schema). Full reload between missions."

### M17: Outcome Determination Timing — During EXTRACTION
**Files:** POST_MISSION_RESOLUTION.md
**Problem:** Does achieving an objective during EXTRACTION phase change the outcome?
**Fix:** Define: "Outcome locks when EXTRACTION begins. No objective changes during extraction."

### M18: Mission Expiry Tick Misalignment
**Files:** CAMPAIGN_PERSISTENCE.md
**Problem:** Mission `expiresAt` is a Unix timestamp but campaign ticks are every 30 minutes. Expiry may be detected up to 30 minutes late.
**Fix:** Acceptable for campaign-layer timing. Add note: "Missions expire within one campaign tick of their expiry time."

### M19: Transaction Log "Wins" Rule
**Files:** CAMPAIGN_PERSISTENCE.md
**Problem:** If transaction log is corrupted, the "transaction log wins" rule bakes in the error permanently.
**Fix:** Add: "Transaction log integrity is verified by checksum before reconciliation."

### M20: Multi-Faction Planet — Mission Generation
**Files:** CAMPAIGN_OVERVIEW.md, MISSION_GENERATION.md
**Problem:** If a planet is 30% Ataxian + 25% Khroshi, which faction do missions generate against?
**Fix:** Define: "Mission generates against the faction with highest influence on the planet."

### M21: SP Minimum Floor Exploitability
**Files:** POST_MISSION_RESOLUTION.md
**Problem:** 10 SP minimum reward for any participation. A rifle squad costs 21 SP. Players could farm 10 SP by joining and immediately leaving.
**Fix:** Add: "Minimum 60 seconds of combat-phase participation required for any SP reward."

### M22: Suppression Floor + Swarm Overrun Pinning Paradox
**Files:** FACTIONS.md
**Problem:** Scurrier overrun pins the target (suppression rises to 70 max from Ataxian fire). Pinned units can't easily move away to break melee.
**Fix:** Define: "Units in melee can break contact at half movement speed regardless of suppression state."

### M23: Building Slope Threshold Undefined
**Files:** BUILDING_GRAMMARS.md
**Problem:** "Buildings are skipped on steep slopes" — no angle threshold.
**Fix:** Define: "Skip placement if terrain slope exceeds 30 degrees."

### M24: Sector Buff Application Formulas
**Files:** BATTALION_CREATION.md
**Problem:** "+10% maxSpeed" — multiplicative or additive? No formula.
**Fix:** Define: "All sector buffs are multiplicative (baseValue × 1.1)."

### M25: Morale State Naming — `Surrender` vs `surrendered`
**Files:** Combat Formula Spec.md, RUNTIME_UNIT_STATE.md
**Problem:** Combat Formula uses `Surrender` (capitalized, singular). Runtime uses `'surrendered'` (lowercase).
**Fix:** Standardize to `'surrendered'` everywhere.

---

## LOW — Documentation Cleanup (~100 items)

These are minor and can be fixed as encountered during implementation:

- Inconsistent cross-document reference styles (bold vs italic vs backtick)
- Missing tables of contents on large documents (VISUAL_EFFECTS, UI_FLOW)
- Color hex mismatch: `#E04020` vs `#E04030` for Ataxian in NATO_ICONS.md
- Undefined abbreviation "OOB" (Order of Battle) never formally expanded
- Reconnection timeout duration missing from UI_FLOW disconnect overlay
- WCAG color contrast ratios not specified
- Inconsistent heading levels across documents
- Missing "Last updated" dates on some docs
- Vision range conversion (×50) not documented in Spotting spec
- VFX muzzle flash caliber scaling divisor (60) unjustified
- Water splash "near water edges" distance threshold undefined
- VFX floating-point comparison with exact equality (emitter duration check)
- Shoreline fringe width specified in pixels (resolution-dependent)
- Underwater shader `maxDepth` parameter undefined
- Edge taper formula unspecified (linear vs quadratic vs exponential)
- Grid clipping through above-water terrain undefined
- District center separation distance undefined
- "Command-view zoom" is subjective (no camera distance in world units)
- Lobby race condition handling underspecified
- Battalion type SP values use `~` (approximate) instead of exact values
- OOB reorganization scope undefined
- Armor material combination rules unspecified
- Nation ID values undocumented (Terran=15, Ataxian=14, Khroshi=11)
- Unarmed unit validation rules undefined
- Deployment roster selection location in flow unclear
- Contact system terminology inconsistent across UI docs
- Order precedence for conflicting standing + new orders
- Deployment zone shape definition missing from UI_FLOW
- Bresenham corner-cutting may allow LOS exploits
- Heightmap cell-center approximation vs actual terrain shape
- Path cache tolerance (1 cell) may cause suboptimal routes
- Closest-passable-cell algorithm unspecified (Euclidean vs Manhattan)
- Pathfinding staggering across ticks not reflected in tick budget table
- Spotter aircraft "full map LOS" definition vague
- Spotter destruction effect on in-flight artillery (one-way reference)
- Smoke source overlap counting (separate vs merged) could be clearer
- Accumulation rate modifiers described as "not compounding" but code is multiplicative (mathematically equivalent, confusing wording)
- Hull-down size reduction floor at size 0 → -1 unspecified
- Observer role modifier default for unlisted unit classes
- Contact object doesn't store ±50m position jitter for SUSPECTED
- LOST contact lifecycle (deleted vs hidden, re-acquisition grace period)
- Indirect fire CEP formula cross-reference unverifiable without Combat Formula Spec
- Height bonus formula (5m per metre) arbitrary, no design rationale
- LOS getElevation function doesn't validate heightmap array size
- Bresenham zero-length walk (same-cell) handling unclear
- Smoke point-to-segment distance radius handling
- Stabilizer stat effect undocumented
- Transport capacity partial-squad edge case
- ERA depletion mechanics incomplete
- Replacement platoon size ambiguous (3-4 units)
- Faction breakthrough doctrine mechanics (campaign-level, not in tactical docs)
- Bio-regeneration "not under fire" condition vague
- Conscript Mob unit class vs infantry class distinction
- Automaton morale immunity not noted in Orders doc
- Faction colors on sector map vs NATO icon colors alignment
- Acknowledged incomplete faction design (commanders, tech escalation)
- milsymbol SIDC construction details sparse
- Missing glyph error handling
- Icon cache key collision risk (unitType vs unitTypeId)
- Suspected blip pulsing performance with many contacts
- LOD transition smoothing for health bars
- Targeting reticle show/hide timing
- AI difficulty "same behavior" claim contradicted by different update rates
