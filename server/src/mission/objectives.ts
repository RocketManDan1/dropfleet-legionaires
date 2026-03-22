// ============================================================================
// OBJECTIVE TRACKING — capture, destroy, hold, escort, extract
// Milestone 3
// Source: MISSION_GENERATION.md, MISSION_LIFECYCLE.md
// ============================================================================

import type { ObjectiveState, UnitInstance, Vec2 } from '@legionaires/shared';

/**
 * Tracks all objectives for a mission and checks completion each tick.
 */
export class ObjectiveTracker {
  private objectives: ObjectiveState[] = [];

  /** Initialize objectives from mission generation output. */
  init(defs: ObjectiveState[]): void {
    this.objectives = defs.map(d => ({ ...d, isCompleted: false, completedAtTick: null, progress: 0 }));
  }

  /** Called every tick to check objective progress. */
  update(units: Map<string, UnitInstance>, tick: number): ObjectiveUpdate[] {
    const updates: ObjectiveUpdate[] = [];

    for (const obj of this.objectives) {
      if (obj.isCompleted) continue;

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
  allPrimaryComplete(): boolean {
    return this.objectives
      .filter(o => o.type === 'capture' || o.type === 'hold') // TODO: isPrimary flag
      .every(o => o.isCompleted);
  }

  getAll(): ObjectiveState[] { return this.objectives; }

  private evaluateObjective(obj: ObjectiveState, units: Map<string, UnitInstance>, tick: number): void {
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

  private evaluateCapture(obj: ObjectiveState, units: Map<string, UnitInstance>, tick: number): void {
    // Check if friendly units are within capture radius and no enemies
    const friendliesInRadius = this.countUnitsInRadius(units, obj, true);
    const enemiesInRadius = this.countUnitsInRadius(units, obj, false);

    if (friendliesInRadius > 0 && enemiesInRadius === 0) {
      obj.progress = Math.min(100, obj.progress + 1); // ~5 seconds to capture at 20Hz
      if (obj.progress >= 100) {
        obj.isCompleted = true;
        obj.completedAtTick = tick;
      }
    } else {
      // Capture progress decays if contested
      obj.progress = Math.max(0, obj.progress - 0.5);
    }
  }

  private evaluateDestroy(obj: ObjectiveState, units: Map<string, UnitInstance>, tick: number): void {
    // TODO: Check if target unit(s) are destroyed
    // For now placeholder
  }

  private evaluateHold(obj: ObjectiveState, units: Map<string, UnitInstance>, tick: number): void {
    // Similar to capture but requires holding for a duration
    // TODO: Implement hold timer
  }

  private evaluateExtract(obj: ObjectiveState, units: Map<string, UnitInstance>, tick: number): void {
    // Check if required units are in extraction zone
    // TODO: Implement extraction check
  }

  private countUnitsInRadius(
    units: Map<string, UnitInstance>,
    obj: ObjectiveState,
    friendly: boolean,
  ): number {
    let count = 0;
    for (const [, unit] of units) {
      if (unit.isDestroyed) continue;
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

export interface ObjectiveUpdate {
  objectiveId: string;
  progress: number;
  isCompleted: boolean;
}
