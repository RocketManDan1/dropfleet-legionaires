// ============================================================================
// OBJECTIVE TRACKING — capture, destroy, hold, escort, extract
// Milestone 3
// Source: MISSION_GENERATION.md, MISSION_LIFECYCLE.md
// ============================================================================

import type { MissionType, ObjectiveState, UnitInstance, Vec2 } from '@legionaires/shared';
import { TICKS_PER_SEC, CELL_REAL_M } from '@legionaires/shared';

/** Ticks of uncontested friendly presence needed to complete a hold objective. */
const HOLD_DURATION_TICKS = 60 * TICKS_PER_SEC; // 60 seconds

/**
 * Tracks all objectives for a mission and checks completion each tick.
 */
export class ObjectiveTracker {
  private objectives: ObjectiveState[] = [];

  /** Per-objective auxiliary state: hold timers, target unit lists, etc. */
  private holdTimers = new Map<string, number>(); // objectiveId → ticks held
  private destroyTargets = new Map<string, string[]>(); // objectiveId → target unitIds

  /** The AI faction ID — units owned by this faction are "enemy". */
  private aiFactionId: string = 'ai';
  private primaryTypes = new Set<ObjectiveState['type']>(['capture', 'hold', 'destroy']);

  private static readonly EXTRACT_PRIMARY_MISSION_TYPES = new Set<MissionType>([
    'evacuation',
  ]);

  setAiFactionId(id: string): void { this.aiFactionId = id; }

  setMissionType(missionType: MissionType): void {
    this.primaryTypes = new Set<ObjectiveState['type']>(['capture', 'hold', 'destroy']);
    if (ObjectiveTracker.EXTRACT_PRIMARY_MISSION_TYPES.has(missionType)) {
      this.primaryTypes.add('extract');
    }
  }

  /** Initialize objectives from mission generation output. */
  init(defs: ObjectiveState[]): void {
    this.objectives = defs.map(d => ({ ...d, isCompleted: false, completedAtTick: null, progress: 0 }));
    this.holdTimers.clear();
    this.destroyTargets.clear();
  }

  /**
   * Register target units for a 'destroy' objective.
   * Called during mission generation after enemy units are spawned.
   */
  setDestroyTargets(objectiveId: string, unitIds: string[]): void {
    this.destroyTargets.set(objectiveId, [...unitIds]);
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
    const primaries = this.objectives.filter((o) => this.primaryTypes.has(o.type));
    if (primaries.length === 0) return false;
    return primaries.every((o) => o.isCompleted);
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
    const targets = this.destroyTargets.get(obj.objectiveId);
    if (!targets || targets.length === 0) {
      // If no specific targets, check if all enemy units in objective radius are destroyed
      const enemiesAlive = this.countUnitsInRadius(units, obj, false);
      if (enemiesAlive === 0) {
        obj.progress = 100;
        obj.isCompleted = true;
        obj.completedAtTick = tick;
      }
      return;
    }

    // Count how many target units are destroyed
    let destroyed = 0;
    for (const targetId of targets) {
      const unit = units.get(targetId);
      if (!unit || unit.isDestroyed) destroyed++;
    }

    obj.progress = Math.round((destroyed / targets.length) * 100);
    if (destroyed >= targets.length) {
      obj.isCompleted = true;
      obj.completedAtTick = tick;
    }
  }

  private evaluateHold(obj: ObjectiveState, units: Map<string, UnitInstance>, tick: number): void {
    const friendliesInRadius = this.countUnitsInRadius(units, obj, true);
    const enemiesInRadius = this.countUnitsInRadius(units, obj, false);

    const timer = this.holdTimers.get(obj.objectiveId) ?? 0;

    if (friendliesInRadius > 0 && enemiesInRadius === 0) {
      // Accumulate hold time
      const newTimer = timer + 1;
      this.holdTimers.set(obj.objectiveId, newTimer);
      obj.progress = Math.min(100, Math.round((newTimer / HOLD_DURATION_TICKS) * 100));
      if (newTimer >= HOLD_DURATION_TICKS) {
        obj.isCompleted = true;
        obj.completedAtTick = tick;
      }
    } else if (enemiesInRadius > 0) {
      // Reset hold timer when contested
      this.holdTimers.set(obj.objectiveId, Math.max(0, timer - 2));
      obj.progress = Math.max(0, Math.round((Math.max(0, timer - 2) / HOLD_DURATION_TICKS) * 100));
    }
    // If no friendlies but no enemies either, timer freezes (progress stays)
  }

  private evaluateExtract(obj: ObjectiveState, units: Map<string, UnitInstance>, tick: number): void {
    // Count player-owned units in the extraction zone
    const friendliesInZone = this.countUnitsInRadius(units, obj, true);

    // Count all surviving player units anywhere on map
    let totalPlayerUnits = 0;
    for (const [, unit] of units) {
      if (unit.isDestroyed) continue;
      if (unit.ownerId !== this.aiFactionId) totalPlayerUnits++;
    }

    if (totalPlayerUnits === 0) return;

    // Progress = percentage of surviving units in the extraction zone
    obj.progress = Math.round((friendliesInZone / totalPlayerUnits) * 100);

    // Complete when at least 50% of surviving units are in the zone
    if (friendliesInZone > 0 && friendliesInZone >= Math.ceil(totalPlayerUnits * 0.5)) {
      obj.isCompleted = true;
      obj.completedAtTick = tick;
    }
  }

  private countUnitsInRadius(
    units: Map<string, UnitInstance>,
    obj: ObjectiveState,
    friendly: boolean,
  ): number {
    // obj.radius is in metres; unit positions are in cells.
    // Convert to cells for the distance comparison.
    const radiusCells = obj.radius / CELL_REAL_M;
    const radiusSq = radiusCells * radiusCells;
    let count = 0;
    for (const [, unit] of units) {
      if (unit.isDestroyed) continue;
      const isFriendly = unit.ownerId !== this.aiFactionId;
      if (isFriendly !== friendly) continue;
      const dx = unit.posX - obj.posX;
      const dz = unit.posZ - obj.posZ;
      if (dx * dx + dz * dz <= radiusSq) {
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
