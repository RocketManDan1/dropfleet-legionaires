// ============================================================================
// OBJECTIVE TRACKING — capture, destroy, hold, escort, extract
// Milestone 3
// Source: MISSION_GENERATION.md, MISSION_LIFECYCLE.md
// ============================================================================
/**
 * Tracks all objectives for a mission and checks completion each tick.
 */
export class ObjectiveTracker {
    objectives = [];
    /** Initialize objectives from mission generation output. */
    init(defs) {
        this.objectives = defs.map(d => ({ ...d, isCompleted: false, completedAtTick: null, progress: 0 }));
    }
    /** Called every tick to check objective progress. */
    update(units, tick) {
        const updates = [];
        for (const obj of this.objectives) {
            if (obj.isCompleted)
                continue;
            const prevProgress = obj.progress;
            this.evaluateObjective(obj, units, tick);
            if (obj.progress !== prevProgress || obj.isCompleted) {
                updates.push({
                    objectiveId: obj.objectiveId,
                    progress: obj.progress,
                    isCompleted: obj.isCompleted,
                });
            }
        }
        return updates;
    }
    /** Are all primary objectives complete? */
    allPrimaryComplete() {
        return this.objectives
            .filter(o => o.type === 'capture' || o.type === 'hold') // TODO: isPrimary flag
            .every(o => o.isCompleted);
    }
    getAll() { return this.objectives; }
    evaluateObjective(obj, units, tick) {
        switch (obj.type) {
            case 'capture':
                this.evaluateCapture(obj, units, tick);
                break;
            case 'destroy':
                this.evaluateDestroy(obj, units, tick);
                break;
            case 'hold':
                this.evaluateHold(obj, units, tick);
                break;
            case 'extract':
                this.evaluateExtract(obj, units, tick);
                break;
            default:
                break;
        }
    }
    evaluateCapture(obj, units, tick) {
        // Check if friendly units are within capture radius and no enemies
        const friendliesInRadius = this.countUnitsInRadius(units, obj, true);
        const enemiesInRadius = this.countUnitsInRadius(units, obj, false);
        if (friendliesInRadius > 0 && enemiesInRadius === 0) {
            obj.progress = Math.min(100, obj.progress + 1); // ~5 seconds to capture at 20Hz
            if (obj.progress >= 100) {
                obj.isCompleted = true;
                obj.completedAtTick = tick;
            }
        }
        else {
            // Capture progress decays if contested
            obj.progress = Math.max(0, obj.progress - 0.5);
        }
    }
    evaluateDestroy(obj, units, tick) {
        // TODO: Check if target unit(s) are destroyed
        // For now placeholder
    }
    evaluateHold(obj, units, tick) {
        // Similar to capture but requires holding for a duration
        // TODO: Implement hold timer
    }
    evaluateExtract(obj, units, tick) {
        // Check if required units are in extraction zone
        // TODO: Implement extraction check
    }
    countUnitsInRadius(units, obj, friendly) {
        let count = 0;
        for (const [, unit] of units) {
            if (unit.isDestroyed)
                continue;
            // TODO: Determine friendly vs enemy based on ownerId
            const dx = unit.posX - obj.posX;
            const dz = unit.posZ - obj.posZ;
            if (dx * dx + dz * dz <= obj.radius * obj.radius) {
                count++;
            }
        }
        return count;
    }
}
