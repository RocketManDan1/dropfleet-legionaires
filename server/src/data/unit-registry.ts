// ============================================================================
// UNIT REGISTRY — UnitType lookup service
// Milestone 2
// ============================================================================

import type { UnitType, UnitClass, FactionId } from '@legionaires/shared';

/**
 * In-memory registry of all loaded UnitType definitions.
 * Loaded once at server startup from CSV files.
 */
export class UnitRegistry {
  private byId = new Map<string, UnitType>();
  private byFaction = new Map<number, UnitType[]>();
  private byClass = new Map<UnitClass, UnitType[]>();

  /** Load unit types (call once at startup). */
  load(units: UnitType[]): void {
    this.byId.clear();
    this.byFaction.clear();
    this.byClass.clear();

    for (const unit of units) {
      this.byId.set(unit.id, unit);

      // Index by nation
      if (!this.byFaction.has(unit.nationId)) {
        this.byFaction.set(unit.nationId, []);
      }
      this.byFaction.get(unit.nationId)!.push(unit);

      // Index by class
      if (!this.byClass.has(unit.unitClass)) {
        this.byClass.set(unit.unitClass, []);
      }
      this.byClass.get(unit.unitClass)!.push(unit);
    }
  }

  /** Get a single unit type by ID. */
  get(id: string): UnitType | undefined {
    return this.byId.get(id);
  }

  /** Get all unit types for a faction (by nationId). */
  getByFaction(nationId: number): UnitType[] {
    return this.byFaction.get(nationId) ?? [];
  }

  /** Get all unit types for a faction by FactionId. */
  getByFactionId(factionId: FactionId): UnitType[] {
    const nationMap: Record<FactionId, number> = {
      federation: 15,
      ataxian: 14,
      khroshi: 11,
    };
    return this.getByFaction(nationMap[factionId]);
  }

  /** Get all unit types of a given class. */
  getByClass(unitClass: UnitClass): UnitType[] {
    return this.byClass.get(unitClass) ?? [];
  }

  /** Total number of loaded unit types. */
  get size(): number {
    return this.byId.size;
  }
}
