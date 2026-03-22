// ============================================================================
// PLATOON BEHAVIOR TREE — per-platoon decision layer (Layer 2)
// Source: ENEMY_AI.md §4 — behavior trees, runs every 1 s (20 ticks)
// Milestone 3 — Playable Mission (enemy AI, one faction)
//
// Runs at: tick % AI_PLATOON_BT_TICKS === 0 (every 20 ticks / 1 s)
// Injects at: start of Phase 2 (Command Propagation), after strategic layer
// Performance budget: ≤ 0.5 ms total for all platoon BT evaluations
// ============================================================================
// ---------------------------------------------------------------------------
// Engagement ranges (metres) — tuned per ENEMY_AI.md §4.3–4.4
// ---------------------------------------------------------------------------
const OVERRUN_RANGE_M = 100;
const CLOSE_ENGAGE_RANGE_M = 200;
const MEDIUM_ENGAGE_RANGE_M = 500;
const LONG_ENGAGE_RANGE_M = 800;
const PATROL_ENGAGE_RANGE_M = 400;
const DISENGAGE_FLEE_DISTANCE_M = 600;
// ============================================================================
// COMPOSITE NODES
// ============================================================================
/**
 * Selector: try children left-to-right. Return the first success or running
 * result. If all children fail, the selector fails.
 * (ENEMY_AI.md §4.1 — Composite nodes)
 */
class Selector {
    children;
    constructor(children) {
        this.children = children;
    }
    tick(ctx, units) {
        for (const child of this.children) {
            const result = child.tick(ctx, units);
            if (result.status === 'success' || result.status === 'running') {
                return result;
            }
        }
        return { status: 'failure', orders: [] };
    }
}
/**
 * Sequence: run children in order. Fail immediately if any child fails.
 * Succeed only when all children succeed. Accumulate orders from all
 * successful children.
 */
class Sequence {
    children;
    constructor(children) {
        this.children = children;
    }
    tick(ctx, units) {
        const allOrders = [];
        for (const child of this.children) {
            const result = child.tick(ctx, units);
            if (result.status === 'failure') {
                return { status: 'failure', orders: [] };
            }
            allOrders.push(...result.orders);
            if (result.status === 'running') {
                return { status: 'running', orders: allOrders };
            }
        }
        return { status: 'success', orders: allOrders };
    }
}
// ============================================================================
// CONDITION NODES (leaf — return success/failure, no orders)
// ============================================================================
/**
 * Check if there are enemy contacts within a given range of the platoon centroid.
 * Uses the nearestThreat field from the BT context.
 */
class HasContactsInRange {
    rangeM;
    constructor(rangeM) {
        this.rangeM = rangeM;
    }
    tick(ctx, _units) {
        if (!ctx.nearestThreat) {
            return { status: 'failure', orders: [] };
        }
        // Compute platoon centroid from living units
        const centroid = computeCentroid(ctx, _units);
        const dist = euclidean(centroid, ctx.nearestThreat);
        if (dist <= this.rangeM) {
            return { status: 'success', orders: [] };
        }
        return { status: 'failure', orders: [] };
    }
}
/**
 * Check if platoon strength is above a threshold.
 */
class PlatoonStrengthAbove {
    threshold;
    constructor(threshold) {
        this.threshold = threshold;
    }
    tick(ctx, _units) {
        if (ctx.platoonStrengthPct >= this.threshold) {
            return { status: 'success', orders: [] };
        }
        return { status: 'failure', orders: [] };
    }
}
/**
 * Check if the platoon's command unit (Synaptic Brood / Broadcast Node) is alive.
 */
class CommandUnitAlive {
    tick(ctx, _units) {
        if (ctx.commandUnitAlive) {
            return { status: 'success', orders: [] };
        }
        return { status: 'failure', orders: [] };
    }
}
/**
 * Decorator: invert the status of a child node (success <-> failure).
 * Running remains running.
 */
class Inverter {
    child;
    constructor(child) {
        this.child = child;
    }
    tick(ctx, units) {
        const result = this.child.tick(ctx, units);
        if (result.status === 'success') {
            return { status: 'failure', orders: result.orders };
        }
        if (result.status === 'failure') {
            return { status: 'success', orders: result.orders };
        }
        return result; // running stays running
    }
}
/**
 * Check if a low-threat flank route exists by sampling influence map
 * cells perpendicular to the threat axis.
 */
class FlankRouteExists {
    tick(ctx, units) {
        if (!ctx.nearestThreat || !ctx.nearestObjective) {
            return { status: 'failure', orders: [] };
        }
        const centroid = computeCentroid(ctx, units);
        const grid = ctx.influenceMaps.threat;
        // Sample 4 points perpendicular to the threat axis at 300m intervals
        const dx = ctx.nearestThreat.x - centroid.x;
        const dz = ctx.nearestThreat.z - centroid.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 1)
            return { status: 'failure', orders: [] };
        // Perpendicular direction
        const perpX = -dz / len;
        const perpZ = dx / len;
        // Check both flanks (left and right) at 300m offset
        for (const sign of [1, -1]) {
            const checkX = centroid.x + perpX * 300 * sign;
            const checkZ = centroid.z + perpZ * 300 * sign;
            const col = Math.floor(checkX / grid.cellSizeM);
            const row = Math.floor(checkZ / grid.cellSizeM);
            if (col < 0 || col >= grid.width || row < 0 || row >= grid.height)
                continue;
            const threat = grid.data[row * grid.width + col];
            // A "low threat" flank is one with threat below 1.0
            if (threat < 1.0) {
                return { status: 'success', orders: [] };
            }
        }
        return { status: 'failure', orders: [] };
    }
}
// ============================================================================
// ACTION NODES (leaf — return success + orders for units in the platoon)
// ============================================================================
/**
 * Issue MOVE ADVANCE orders toward the assigned objective for all units.
 * Advance mode: half speed, can return fire.
 */
class AdvanceToObjective {
    tick(ctx, units) {
        if (!ctx.nearestObjective) {
            return { status: 'failure', orders: [] };
        }
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'move_advance',
                targetPos: ctx.nearestObjective,
            });
        }
        return { status: orders.length > 0 ? 'success' : 'failure', orders };
    }
}
/**
 * Issue MOVE MARCH orders toward the objective (faster, no firing).
 */
class MarchToObjective {
    tick(ctx, units) {
        if (!ctx.nearestObjective) {
            return { status: 'failure', orders: [] };
        }
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'move_march',
                targetPos: ctx.nearestObjective,
            });
        }
        return { status: orders.length > 0 ? 'success' : 'failure', orders };
    }
}
/**
 * Hold position — cancel movement, stay in place.
 */
class HoldPosition {
    tick(ctx, units) {
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'cancel',
            });
        }
        return { status: 'success', orders };
    }
}
/**
 * Set fire posture for all platoon units.
 */
class SetFirePosture {
    posture;
    constructor(posture) {
        this.posture = posture;
    }
    tick(ctx, units) {
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'set_posture',
                targetPos: undefined,
                targetUnitId: this.posture, // Encode posture in targetUnitId field
            });
        }
        return { status: 'success', orders };
    }
}
/**
 * Concentrate fire: all units engage the nearest detected threat.
 */
class ConcentrateFireOnTarget {
    tick(ctx, units) {
        if (!ctx.nearestThreat) {
            return { status: 'failure', orders: [] };
        }
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'engage_pos',
                targetPos: ctx.nearestThreat,
            });
        }
        return { status: orders.length > 0 ? 'success' : 'failure', orders };
    }
}
/**
 * Move units away from the nearest threat — disengage and flee.
 * Computes a position opposite to the threat direction.
 */
class MoveAwayFromThreat {
    tick(ctx, units) {
        const centroid = computeCentroid(ctx, units);
        // If no known threat, fall back to moving toward map center as a safe default
        let fleeTarget;
        if (ctx.nearestThreat) {
            const dx = centroid.x - ctx.nearestThreat.x;
            const dz = centroid.z - ctx.nearestThreat.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0) {
                // Move 600m in the direction away from the threat
                fleeTarget = {
                    x: centroid.x + (dx / len) * DISENGAGE_FLEE_DISTANCE_M,
                    z: centroid.z + (dz / len) * DISENGAGE_FLEE_DISTANCE_M,
                };
            }
            else {
                // Threat is exactly at centroid (edge case) — move north
                fleeTarget = { x: centroid.x, z: centroid.z + DISENGAGE_FLEE_DISTANCE_M };
            }
        }
        else {
            // No threat data — hold position
            return { status: 'failure', orders: [] };
        }
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'move_march',
                targetPos: fleeTarget,
            });
        }
        return { status: orders.length > 0 ? 'success' : 'failure', orders };
    }
}
/**
 * Flank via low-threat corridor: use influence map to find a perpendicular
 * approach route that avoids the main threat axis, then advance toward
 * the objective through that corridor.
 *
 * For Ataxian: always attempt (silent approach, hold fire).
 * For Khroshi: rarely used (low flankBonus), but available.
 */
class FlankViaLowThreat {
    tick(ctx, units) {
        if (!ctx.nearestObjective || !ctx.nearestThreat) {
            return { status: 'failure', orders: [] };
        }
        const centroid = computeCentroid(ctx, units);
        const grid = ctx.influenceMaps.threat;
        // Compute perpendicular to the threat axis
        const dx = ctx.nearestThreat.x - centroid.x;
        const dz = ctx.nearestThreat.z - centroid.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 1)
            return { status: 'failure', orders: [] };
        const perpX = -dz / len;
        const perpZ = dx / len;
        // Pick the flank side with lower threat (left vs right at 300m offset)
        let bestFlankPos = null;
        let bestThreat = Infinity;
        for (const sign of [1, -1]) {
            const fx = centroid.x + perpX * 300 * sign;
            const fz = centroid.z + perpZ * 300 * sign;
            const col = Math.floor(fx / grid.cellSizeM);
            const row = Math.floor(fz / grid.cellSizeM);
            if (col < 0 || col >= grid.width || row < 0 || row >= grid.height)
                continue;
            const threat = grid.data[row * grid.width + col];
            if (threat < bestThreat) {
                bestThreat = threat;
                bestFlankPos = { x: fx, z: fz };
            }
        }
        if (!bestFlankPos) {
            return { status: 'failure', orders: [] };
        }
        // Compute a waypoint that goes through the flank corridor then curves
        // toward the objective. Use the midpoint between the flank position
        // and the objective.
        const waypointX = (bestFlankPos.x + ctx.nearestObjective.x) / 2;
        const waypointZ = (bestFlankPos.z + ctx.nearestObjective.z) / 2;
        const flankWaypoint = { x: waypointX, z: waypointZ };
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            // First move to the flank corridor
            orders.push({
                unitId,
                orderType: 'move_advance',
                targetPos: bestFlankPos,
            });
        }
        return { status: orders.length > 0 ? 'running' : 'failure', orders };
    }
}
/**
 * Screen the command unit — position combat units between the command
 * unit and the nearest threat. Used by Ataxian Warriors to protect
 * the Synaptic Brood.
 */
class ScreenCommandUnit {
    tick(ctx, units) {
        if (!ctx.nearestThreat) {
            return { status: 'failure', orders: [] };
        }
        // Find the command unit position
        let cmdPos = null;
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            // The command unit is the one with the platoon's commandUnitId match
            // Since we don't have the platoonState here, use a heuristic:
            // command units typically have the highest crewMax in the platoon
            // For now, put non-command units between centroid and threat
        }
        const centroid = computeCentroid(ctx, units);
        const dx = ctx.nearestThreat.x - centroid.x;
        const dz = ctx.nearestThreat.z - centroid.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 1)
            return { status: 'failure', orders: [] };
        // Screen position: 100m toward the threat from centroid
        const screenDist = Math.min(100, len * 0.5);
        const screenPos = {
            x: centroid.x + (dx / len) * screenDist,
            z: centroid.z + (dz / len) * screenDist,
        };
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'move_advance',
                targetPos: screenPos,
            });
        }
        return { status: orders.length > 0 ? 'success' : 'failure', orders };
    }
}
/**
 * Reverse to fallback — controlled retreat using reverse movement.
 * Units back away from threat while maintaining facing (can still fire).
 * Used by Khroshi when their Broadcast Node is destroyed.
 */
class ReverseToFallback {
    tick(ctx, units) {
        const centroid = computeCentroid(ctx, units);
        let fallbackPos;
        if (ctx.nearestThreat) {
            // Move 400m away from the threat
            const dx = centroid.x - ctx.nearestThreat.x;
            const dz = centroid.z - ctx.nearestThreat.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0) {
                fallbackPos = {
                    x: centroid.x + (dx / len) * 400,
                    z: centroid.z + (dz / len) * 400,
                };
            }
            else {
                fallbackPos = { x: centroid.x, z: centroid.z + 400 };
            }
        }
        else {
            // No threat known — reverse southward as a default
            fallbackPos = { x: centroid.x, z: centroid.z + 400 };
        }
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'move_reverse',
                targetPos: fallbackPos,
            });
        }
        return { status: orders.length > 0 ? 'success' : 'failure', orders };
    }
}
/**
 * March to fallback — full-speed retreat to a fallback position.
 * Used by Khroshi below 40% strength (ENEMY_AI.md §4.4.1 — Fallback sequence).
 */
class MarchToFallback {
    tick(ctx, units) {
        const centroid = computeCentroid(ctx, units);
        // Pick a fallback position: move away from nearest threat (or objective
        // if no threat known) at full march speed
        let fallbackTarget;
        if (ctx.nearestThreat) {
            const dx = centroid.x - ctx.nearestThreat.x;
            const dz = centroid.z - ctx.nearestThreat.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0) {
                fallbackTarget = {
                    x: centroid.x + (dx / len) * 600,
                    z: centroid.z + (dz / len) * 600,
                };
            }
            else {
                fallbackTarget = { x: centroid.x, z: centroid.z + 600 };
            }
        }
        else if (ctx.nearestObjective) {
            // Fall back away from the objective (assume threat is near objective)
            const dx = centroid.x - ctx.nearestObjective.x;
            const dz = centroid.z - ctx.nearestObjective.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0) {
                fallbackTarget = {
                    x: centroid.x + (dx / len) * 600,
                    z: centroid.z + (dz / len) * 600,
                };
            }
            else {
                fallbackTarget = { x: centroid.x, z: centroid.z + 600 };
            }
        }
        else {
            fallbackTarget = { x: centroid.x, z: centroid.z + 600 };
        }
        const orders = [];
        for (const unitId of ctx.unitIds) {
            const unit = units.get(unitId);
            if (!unit || unit.isDestroyed)
                continue;
            orders.push({
                unitId,
                orderType: 'move_march',
                targetPos: fallbackTarget,
            });
        }
        return { status: orders.length > 0 ? 'success' : 'failure', orders };
    }
}
// ============================================================================
// UTILITY HELPERS
// ============================================================================
/**
 * Compute the centroid of all living units in the platoon context.
 */
function computeCentroid(ctx, units) {
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (const unitId of ctx.unitIds) {
        const unit = units.get(unitId);
        if (!unit || unit.isDestroyed)
            continue;
        sumX += unit.posX;
        sumZ += unit.posZ;
        count++;
    }
    if (count === 0)
        return { x: 0, z: 0 };
    return { x: sumX / count, z: sumZ / count };
}
/**
 * Euclidean distance between two Vec2 positions.
 */
function euclidean(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
}
// ============================================================================
// BEHAVIOR TREE BUILDERS — assemble trees per intent and faction
// ============================================================================
/**
 * Build the Ataxian ATTACK behavior tree (ENEMY_AI.md §4.3.1 — Assault Platoon).
 *
 * Selector:
 *   [Overrun]         contacts < 100m → FREE_FIRE + advance
 *   [Protect Brood]   brood dead → screen + RETURN_FIRE
 *   [Flank]           flank route exists → flank via low threat + HOLD_FIRE
 *   [Suppress+Advance] contacts < 500m → FREE_FIRE + advance
 *   [Default]         advance to objective
 */
function buildAtaxianAttackTree() {
    return new Selector([
        // [Overrun] — close range rush
        new Sequence([
            new HasContactsInRange(OVERRUN_RANGE_M),
            new SetFirePosture('free_fire'),
            new AdvanceToObjective(),
        ]),
        // [Protect Brood] — command unit destroyed
        new Sequence([
            new Inverter(new CommandUnitAlive()),
            new ScreenCommandUnit(),
            new SetFirePosture('return_fire'),
        ]),
        // [Flank] — use low-threat corridor
        new Sequence([
            new FlankRouteExists(),
            new SetFirePosture('hold_fire'),
            new FlankViaLowThreat(),
        ]),
        // [Suppress and Advance] — medium range engagement
        new Sequence([
            new HasContactsInRange(MEDIUM_ENGAGE_RANGE_M),
            new SetFirePosture('free_fire'),
            new AdvanceToObjective(),
        ]),
        // [Default] — always push forward
        new AdvanceToObjective(),
    ]);
}
/**
 * Build the Ataxian DEFEND behavior tree (ENEMY_AI.md §4.3.2 — Garrison Platoon).
 *
 * Selector:
 *   [Swarm Response]  contacts near objective → FREE_FIRE + advance to intercept
 *   [Ambush Hold]     no contacts < 300m → HOLD_FIRE + hold position
 *   [Default]         hold position + RETURN_FIRE
 */
function buildAtaxianDefendTree() {
    return new Selector([
        // [Swarm Response]
        new Sequence([
            new HasContactsInRange(MEDIUM_ENGAGE_RANGE_M),
            new SetFirePosture('free_fire'),
            new AdvanceToObjective(),
        ]),
        // [Ambush Hold] — no close contacts
        new Sequence([
            new Inverter(new HasContactsInRange(300)),
            new SetFirePosture('hold_fire'),
            new HoldPosition(),
        ]),
        // [Default] — hold and return fire
        new Sequence([
            new SetFirePosture('return_fire'),
            new HoldPosition(),
        ]),
    ]);
}
/**
 * Build the Khroshi DEFEND behavior tree (ENEMY_AI.md §4.4.1 — Defense Platoon).
 *
 * Selector:
 *   [Spring Ambush]  contacts < 200m → FREE_FIRE + concentrate fire
 *   [Ambush Wait]    contacts < 400m but NOT < 200m → HOLD_FIRE (let them walk in)
 *   [Fallback]       strength < 40% → RETURN_FIRE + march to fallback
 *   [Node Emergency] command unit dead → reverse to fallback
 *   [Default]        hold position + RETURN_FIRE
 */
function buildKhroshiDefendTree() {
    return new Selector([
        // [Spring Ambush] — enemy walked into kill zone
        new Sequence([
            new HasContactsInRange(CLOSE_ENGAGE_RANGE_M),
            new SetFirePosture('free_fire'),
            new ConcentrateFireOnTarget(),
        ]),
        // [Ambush Wait] — enemy approaching but not in kill zone yet
        new Sequence([
            new HasContactsInRange(PATROL_ENGAGE_RANGE_M),
            new Inverter(new HasContactsInRange(CLOSE_ENGAGE_RANGE_M)),
            new SetFirePosture('hold_fire'),
            new HoldPosition(),
        ]),
        // [Fallback] — below 40% strength
        new Sequence([
            new Inverter(new PlatoonStrengthAbove(0.4)),
            new SetFirePosture('return_fire'),
            new MarchToFallback(),
        ]),
        // [Node Emergency] — Broadcast Node destroyed
        new Sequence([
            new Inverter(new CommandUnitAlive()),
            new SetFirePosture('return_fire'),
            new ReverseToFallback(),
        ]),
        // [Default] — hold and shoot back
        new Sequence([
            new SetFirePosture('return_fire'),
            new HoldPosition(),
        ]),
    ]);
}
/**
 * Build the Khroshi ATTACK behavior tree (ENEMY_AI.md §4.4.2 — Counterattack Platoon).
 *
 * Selector:
 *   [Counterattack]    strength > 60% → FREE_FIRE + advance
 *   [Reinforce]        march to objective + RETURN_FIRE
 *   [Default]          hold + RETURN_FIRE
 */
function buildKhroshiAttackTree() {
    return new Selector([
        // [Counterattack] — strong enough to push
        new Sequence([
            new PlatoonStrengthAbove(0.6),
            new SetFirePosture('free_fire'),
            new AdvanceToObjective(),
        ]),
        // [Reinforce threatened position]
        new Sequence([
            new HasContactsInRange(LONG_ENGAGE_RANGE_M),
            new SetFirePosture('return_fire'),
            new MarchToObjective(),
        ]),
        // [Default] — hold and shoot back
        new Sequence([
            new SetFirePosture('return_fire'),
            new HoldPosition(),
        ]),
    ]);
}
/**
 * Build the RETREAT behavior tree (used by Khroshi when strength < retreatThreshold).
 *
 * Sequence:
 *   Set RETURN_FIRE (covering fire while withdrawing)
 *   Move away from threat
 */
function buildRetreatTree() {
    return new Selector([
        // If threat is close, use reverse (maintain facing)
        new Sequence([
            new HasContactsInRange(CLOSE_ENGAGE_RANGE_M),
            new SetFirePosture('return_fire'),
            new ReverseToFallback(),
        ]),
        // Otherwise full-speed march away
        new Sequence([
            new SetFirePosture('return_fire'),
            new MoveAwayFromThreat(),
        ]),
        // Absolute fallback — just march away from whatever we can
        new MarchToFallback(),
    ]);
}
/**
 * Build the PATROL behavior tree.
 * Patrol units hold position until a contact is detected, then engage.
 *
 * Selector:
 *   [Engage contact]   contacts in range → FREE_FIRE + advance toward them
 *   [Default]          RETURN_FIRE + hold position (between patrol waypoints)
 */
function buildPatrolTree() {
    return new Selector([
        // Contact detected — investigate and engage
        new Sequence([
            new HasContactsInRange(PATROL_ENGAGE_RANGE_M),
            new SetFirePosture('free_fire'),
            new ConcentrateFireOnTarget(),
        ]),
        // No contacts — hold at current position
        new Sequence([
            new SetFirePosture('return_fire'),
            new HoldPosition(),
        ]),
    ]);
}
/**
 * Build the REINFORCE behavior tree.
 * Reinforcing platoons march toward the reinforcement target.
 * If they encounter enemies en route, they engage.
 *
 * Selector:
 *   [Engage en route]  contacts in range → FREE_FIRE + engage
 *   [March to target]  march toward objective
 */
function buildReinforceTree() {
    return new Selector([
        // Contact detected while moving — stop and fight
        new Sequence([
            new HasContactsInRange(MEDIUM_ENGAGE_RANGE_M),
            new SetFirePosture('free_fire'),
            new ConcentrateFireOnTarget(),
        ]),
        // No contacts — keep marching to the reinforcement target
        new MarchToObjective(),
    ]);
}
// ============================================================================
// TREE SELECTION — maps (faction, intent) to a behavior tree
// Per ENEMY_AI.md §4.5 (Mission-Type BT Modifiers)
// ============================================================================
/**
 * Select the appropriate behavior tree for a given faction and intent.
 *
 * | Intent      | Ataxian BT       | Khroshi BT            |
 * |-------------|------------------|-----------------------|
 * | attack      | Assault          | Counterattack         |
 * | defend      | Garrison         | Defense               |
 * | reinforce   | Assault          | Counterattack         |
 * | retreat     | (not used)       | Defense (forced fall)  |
 * | patrol      | Garrison         | Defense               |
 */
function selectTree(faction, intent) {
    if (faction === 'ataxian') {
        switch (intent) {
            case 'attack': return buildAtaxianAttackTree();
            case 'defend': return buildAtaxianDefendTree();
            case 'reinforce': return buildReinforceTree();
            case 'retreat': return buildRetreatTree(); // Ataxian rarely retreats but tree exists
            case 'patrol': return buildPatrolTree();
        }
    }
    // Khroshi (or federation AI if ever needed)
    switch (intent) {
        case 'attack': return buildKhroshiAttackTree();
        case 'defend': return buildKhroshiDefendTree();
        case 'reinforce': return buildReinforceTree();
        case 'retreat': return buildRetreatTree();
        case 'patrol': return buildPatrolTree();
    }
}
// ============================================================================
// CLASS: PlatoonBehaviorTree
// ============================================================================
/**
 * The platoon behavior tree evaluator. Ticks once per second (every 20 game
 * ticks) for each AI platoon, producing a list of PlatoonOrders that the
 * tick loop applies to unit intent fields.
 *
 * Usage (called from TickLoop.phaseCommandPropagation):
 *   const bt = new PlatoonBehaviorTree();
 *   if (tick % AI_PLATOON_BT_TICKS === 0) {
 *     for (const platoon of aiPlatoons) {
 *       const context = buildContext(platoon, ...);
 *       const result = bt.tick(context, units);
 *       applyOrders(result.orders);
 *     }
 *   }
 */
export class PlatoonBehaviorTree {
    /**
     * Cache of built trees keyed by "faction:intent" to avoid rebuilding
     * every tick. Trees are stateless (all state is in the context), so
     * a single instance per (faction, intent) pair is safe to share.
     */
    treeCache = new Map();
    /**
     * Evaluate the behavior tree for a platoon and return the resulting orders.
     *
     * @param context  Pre-built PlatoonBTContext with all the data the tree needs
     * @param units    Full unit registry (for position / status lookups)
     * @returns        BTResult with status and a list of PlatoonOrders
     */
    tick(context, units) {
        // Skip platoons with no living units
        if (context.unitIds.length === 0 || context.platoonStrengthPct <= 0) {
            return { status: 'failure', orders: [] };
        }
        const cacheKey = `${context.faction}:${context.intent}`;
        let tree = this.treeCache.get(cacheKey);
        if (!tree) {
            tree = selectTree(context.faction, context.intent);
            this.treeCache.set(cacheKey, tree);
        }
        return tree.tick(context, units);
    }
    /**
     * Build a PlatoonBTContext from raw game state. This is a convenience
     * method that gathers all the data a behavior tree needs into one
     * object, so the tick loop doesn't have to assemble it manually.
     *
     * @param platoonId        The platoon's unique ID
     * @param faction          Which faction owns this platoon
     * @param intent           Current strategic intent assigned by Layer 1
     * @param unitIds          All unit IDs in this platoon (including destroyed)
     * @param commandUnitId    The platoon's command unit ID (or null)
     * @param units            Full unit registry
     * @param influenceMaps    Current influence maps
     * @param objectives       Active mission objectives
     * @param nearestEnemyPos  Nearest detected enemy position (or null)
     */
    buildContext(platoonId, faction, intent, unitIds, commandUnitId, units, influenceMaps, objectives, nearestEnemyPos) {
        // Filter to living unit IDs only
        const livingUnitIds = unitIds.filter((id) => {
            const u = units.get(id);
            return u !== undefined && !u.isDestroyed;
        });
        // Compute platoon strength (crew ratio)
        let currentCrew = 0;
        let maxCrew = 0;
        for (const id of unitIds) {
            const u = units.get(id);
            if (!u)
                continue;
            maxCrew += u.crewMax;
            if (!u.isDestroyed)
                currentCrew += u.crewCurrent;
        }
        const strengthPct = maxCrew > 0 ? currentCrew / maxCrew : 0;
        // Check command unit alive
        let cmdAlive = false;
        if (commandUnitId) {
            const cmd = units.get(commandUnitId);
            cmdAlive = cmd !== undefined && !cmd.isDestroyed;
        }
        // Find nearest objective to platoon centroid
        let nearestObjective = null;
        if (livingUnitIds.length > 0 && objectives.length > 0) {
            let sumX = 0;
            let sumZ = 0;
            for (const id of livingUnitIds) {
                const u = units.get(id);
                sumX += u.posX;
                sumZ += u.posZ;
            }
            const centroid = {
                x: sumX / livingUnitIds.length,
                z: sumZ / livingUnitIds.length,
            };
            let closestDist = Infinity;
            for (const obj of objectives) {
                if (obj.isCompleted)
                    continue;
                const d = euclidean(centroid, { x: obj.posX, z: obj.posZ });
                if (d < closestDist) {
                    closestDist = d;
                    nearestObjective = { x: obj.posX, z: obj.posZ };
                }
            }
        }
        return {
            platoonId,
            faction,
            intent,
            unitIds: livingUnitIds,
            commandUnitAlive: cmdAlive,
            platoonStrengthPct: strengthPct,
            nearestThreat: nearestEnemyPos,
            nearestObjective,
            influenceMaps,
        };
    }
    /**
     * Clear the cached trees (e.g. between missions or for testing).
     */
    clearCache() {
        this.treeCache.clear();
    }
}
