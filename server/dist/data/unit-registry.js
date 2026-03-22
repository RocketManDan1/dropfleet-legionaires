// ============================================================================
// UNIT REGISTRY — UnitType lookup service
// Milestone 2
// ============================================================================
/**
 * In-memory registry of all loaded UnitType definitions.
 * Loaded once at server startup from CSV files.
 */
export class UnitRegistry {
    byId = new Map();
    byFaction = new Map();
    byClass = new Map();
    /** Load unit types (call once at startup). */
    load(units) {
        this.byId.clear();
        this.byFaction.clear();
        this.byClass.clear();
        for (const unit of units) {
            this.byId.set(unit.id, unit);
            // Index by nation
            if (!this.byFaction.has(unit.nationId)) {
                this.byFaction.set(unit.nationId, []);
            }
            this.byFaction.get(unit.nationId).push(unit);
            // Index by class
            if (!this.byClass.has(unit.unitClass)) {
                this.byClass.set(unit.unitClass, []);
            }
            this.byClass.get(unit.unitClass).push(unit);
        }
    }
    /** Get a single unit type by ID. */
    get(id) {
        return this.byId.get(id);
    }
    /** Get all unit types for a faction (by nationId). */
    getByFaction(nationId) {
        return this.byFaction.get(nationId) ?? [];
    }
    /** Get all unit types for a faction by FactionId. */
    getByFactionId(factionId) {
        const nationMap = {
            federation: 15,
            ataxian: 14,
            khroshi: 11,
        };
        return this.getByFaction(nationMap[factionId]);
    }
    /** Get all unit types of a given class. */
    getByClass(unitClass) {
        return this.byClass.get(unitClass) ?? [];
    }
    /** Total number of loaded unit types. */
    get size() {
        return this.byId.size;
    }
}
