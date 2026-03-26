// ============================================================================
// FIRE RESOLUTION TESTS
//
// Tests Phase 5 (fire.ts) of the tick loop.
//
// Critical regression: unit positions are in CELLS, weapon ranges in METRES.
// The tests verify that a unit at N cells away is only in range if
// N × CELL_REAL_M ≤ weapon.rangeM.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { CELL_REAL_M } from '@legionaires/shared';
import { resolveFire } from '../systems/fire.js';
import { UnitRegistry } from '../data/unit-registry.js';
import { makeUnit, makeDetectedContact, makeUnitType } from './helpers.js';
// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------
function buildRegistry(rangeM) {
    const reg = new UnitRegistry();
    reg.load([makeUnitType({ id: 'test_type', weapons: [
                {
                    weaponId: 1, weaponName: 'Test Gun',
                    acc: 10, warheadSize: 5,
                    rangeM,
                    minRangeM: 0,
                    ammoHE: 20, ammoAP: 20, ammoHEAT: 0, ammoSabot: 0,
                    penAP: 5, penSabot: 0, penHEAT: 5,
                    heKill: 3, rof: 3,
                    traverseType: 'turret',
                    sound: 1,
                },
                null, null, null,
            ] })]);
    return reg;
}
function buildScene(firerPosX, targetPosX) {
    const firer = makeUnit({ instanceId: 'firer', ownerId: 'player1', posX: firerPosX, posZ: 0 });
    const target = makeUnit({ instanceId: 'target', ownerId: 'enemy', posX: targetPosX, posZ: 0 });
    const units = new Map([['firer', firer], ['target', target]]);
    const playerContacts = new Map();
    playerContacts.set('target', makeDetectedContact('target', target.posX, target.posZ));
    const contacts = new Map();
    contacts.set('player1', playerContacts);
    return { units, contacts, firer, target };
}
// ---------------------------------------------------------------------------
// Range gating — the core meters ↔ cells regression
// ---------------------------------------------------------------------------
describe('Fire range gating (metres vs cells)', () => {
    const WEAPON_RANGE_M = 2_000; // 100 cells at CELL_REAL_M = 20
    const RANGE_CELLS_AT_LIMIT = WEAPON_RANGE_M / CELL_REAL_M; // exactly 100
    it('fires when target is exactly at weapon range', () => {
        const reg = buildRegistry(WEAPON_RANGE_M);
        const { units, contacts } = buildScene(0, RANGE_CELLS_AT_LIMIT); // 100 cells = 2 000 m
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(1);
    });
    it('does NOT fire when target is one cell beyond weapon range', () => {
        const reg = buildRegistry(WEAPON_RANGE_M);
        const { units, contacts } = buildScene(0, RANGE_CELLS_AT_LIMIT + 1); // 101 cells = 2 020 m
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(0);
    });
    it('regression: target at 200 cells (4 000 m real) is out of range for a 2 000 m weapon', () => {
        // Without the CELL_REAL_M conversion, 200 cells would look like 200 m — inside range.
        // With the correct conversion: 200 × 20 = 4 000 m > 2 000 m → no fire.
        const reg = buildRegistry(WEAPON_RANGE_M);
        const { units, contacts } = buildScene(0, 200);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(0);
    });
    it('fires at short range (10 cells = 200 m)', () => {
        const reg = buildRegistry(WEAPON_RANGE_M);
        const { units, contacts } = buildScene(0, 10);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(1);
    });
});
// ---------------------------------------------------------------------------
// Shot record contents
// ---------------------------------------------------------------------------
describe('ShotRecord contents', () => {
    it('records range in metres (not cells)', () => {
        const reg = buildRegistry(2_000);
        const { units, contacts } = buildScene(0, 50); // 50 cells
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(1);
        const record = result.shotRecords[0];
        // Range should be 50 × 20 = 1 000 m, not raw cells value of 50
        expect(record.range).toBe(50 * CELL_REAL_M);
    });
    it('fromPos and toPos match firer and target cell coordinates', () => {
        const reg = buildRegistry(2_000);
        const { units, contacts, firer, target } = buildScene(10, 40);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(1);
        const rec = result.shotRecords[0];
        expect(rec.fromPos).toEqual({ x: firer.posX, z: firer.posZ });
        expect(rec.toPos).toEqual({ x: target.posX, z: target.posZ });
    });
});
// ---------------------------------------------------------------------------
// Fire prerequisites
// ---------------------------------------------------------------------------
describe('Fire prerequisites', () => {
    it('does NOT fire when target is below detection threshold (SUSPECTED)', () => {
        const reg = buildRegistry(2_000);
        const firer = makeUnit({ instanceId: 'firer', ownerId: 'player1', posX: 0, posZ: 0 });
        const target = makeUnit({ instanceId: 'target', ownerId: 'enemy', posX: 50, posZ: 0 });
        const units = new Map([['firer', firer], ['target', target]]);
        // Contact at detectionValue = 10 (SUSPECTED, not DETECTED)
        const playerContacts = new Map([
            ['target', {
                    observedUnitId: 'target',
                    detectionValue: 10,
                    detectionTier: 'SUSPECTED',
                    estimatedPos: { x: 50, z: 0 },
                    estimatedCategory: null,
                    estimatedTypeId: null,
                    lastSeenTick: 0,
                    lostAt: null,
                }],
        ]);
        const contacts = new Map([['player1', playerContacts]]);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(0);
    });
    it('does NOT fire when firer has no ammo', () => {
        const reg = buildRegistry(2_000);
        const firer = makeUnit({
            instanceId: 'firer', ownerId: 'player1', posX: 0, posZ: 0,
            ammo: [
                { he: 0, ap: 0, heat: 0, sabot: 0 },
                { he: 0, ap: 0, heat: 0, sabot: 0 },
                { he: 0, ap: 0, heat: 0, sabot: 0 },
                { he: 0, ap: 0, heat: 0, sabot: 0 },
            ],
        });
        const target = makeUnit({ instanceId: 'target', ownerId: 'enemy', posX: 50, posZ: 0 });
        const units = new Map([['firer', firer], ['target', target]]);
        const playerContacts = new Map([['target', makeDetectedContact('target', 50, 0)]]);
        const contacts = new Map([['player1', playerContacts]]);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(0);
    });
    it('does NOT fire when weapon is on cooldown', () => {
        const reg = buildRegistry(2_000);
        const firer = makeUnit({
            instanceId: 'firer', ownerId: 'player1', posX: 0, posZ: 0,
            weaponCooldowns: [5, 0, 0, 0], // slot 0 on cooldown
        });
        const target = makeUnit({ instanceId: 'target', ownerId: 'enemy', posX: 50, posZ: 0 });
        const units = new Map([['firer', firer], ['target', target]]);
        const playerContacts = new Map([['target', makeDetectedContact('target', 50, 0)]]);
        const contacts = new Map([['player1', playerContacts]]);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(0);
    });
    it('does NOT fire when unit is destroyed', () => {
        const reg = buildRegistry(2_000);
        const firer = makeUnit({
            instanceId: 'firer', ownerId: 'player1', posX: 0, posZ: 0,
            isDestroyed: true,
        });
        const target = makeUnit({ instanceId: 'target', ownerId: 'enemy', posX: 50, posZ: 0 });
        const units = new Map([['firer', firer], ['target', target]]);
        const playerContacts = new Map([['target', makeDetectedContact('target', 50, 0)]]);
        const contacts = new Map([['player1', playerContacts]]);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(0);
    });
    it('consumes ammo when firing', () => {
        // selectAmmoType prefers Sabot > AP > HEAT > HE; default unit has AP loaded.
        const reg = buildRegistry(2_000);
        const { units, contacts, firer } = buildScene(0, 50);
        const initialAp = firer.ammo[0].ap;
        resolveFire(units, contacts, [], 1, reg);
        expect(firer.ammo[0].ap).toBe(initialAp - 1);
    });
    it('sets weapon cooldown after firing', () => {
        const reg = buildRegistry(2_000);
        const { units, contacts, firer } = buildScene(0, 50);
        expect(firer.weaponCooldowns[0]).toBe(0);
        resolveFire(units, contacts, [], 1, reg);
        expect(firer.weaponCooldowns[0]).toBeGreaterThan(0);
    });
});
// ---------------------------------------------------------------------------
// Friendly fire prevention
// ---------------------------------------------------------------------------
describe('Friendly fire prevention', () => {
    it('does NOT auto-fire at a unit with the same ownerId', () => {
        const reg = buildRegistry(2_000);
        const firer = makeUnit({ instanceId: 'firer', ownerId: 'player1', posX: 0, posZ: 0 });
        const friendly = makeUnit({ instanceId: 'friendly', ownerId: 'player1', posX: 50, posZ: 0 });
        const units = new Map([['firer', firer], ['friendly', friendly]]);
        const playerContacts = new Map([['friendly', makeDetectedContact('friendly', 50, 0)]]);
        const contacts = new Map([['player1', playerContacts]]);
        const result = resolveFire(units, contacts, [], 1, reg);
        expect(result.shotRecords).toHaveLength(0);
    });
});
