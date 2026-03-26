// ============================================================================
// MISSION GENERATION TESTS
//
// Validates that generateMission produces a structurally valid mission:
//  - Enemy units exist and have a sensible faction
//  - Unit counts match difficulty settings
//  - Enemy spawn is north of player spawn
//  - Objectives exist and have the right types for the mission archetype
//  - Destroy objectives always have assigned target unit IDs
// ============================================================================
import { describe, it, expect } from 'vitest';
import { generateMission } from '../mission/mission-gen.js';
import { UnitRegistry } from '../data/unit-registry.js';
import { makeUnitType, makeFlatTerrain } from './helpers.js';
// ---------------------------------------------------------------------------
// Shared setup: small flat terrain + one enemy unit type
// ---------------------------------------------------------------------------
function buildMissionSetup() {
    const terrain = makeFlatTerrain(512, 512);
    const reg = new UnitRegistry();
    reg.load([
        // A few ataxian units (nationId = 14)
        makeUnitType({ id: 'atx_infantry', unitClass: 'infantry', nationId: 14 }),
        makeUnitType({ id: 'atx_vehicle', unitClass: 'ifv', nationId: 14 }),
        makeUnitType({ id: 'atx_mbt', unitClass: 'mbt', nationId: 14 }),
    ]);
    return { terrain, reg };
}
// ---------------------------------------------------------------------------
// Enemy force generation
// ---------------------------------------------------------------------------
describe('Enemy force generation', () => {
    it('generates enemy units on easy difficulty', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('defend', 'easy', 'ataxian', terrain, reg, 0);
        // Easy = 2 platoons × 4 units = 8 enemies
        expect(result.enemyUnits.length).toBeGreaterThan(0);
    });
    it('generates more enemy units on hard than easy', () => {
        const { terrain, reg } = buildMissionSetup();
        const easy = generateMission('seize', 'easy', 'ataxian', terrain, reg, 0);
        const hard = generateMission('seize', 'hard', 'ataxian', terrain, reg, 0);
        expect(hard.enemyUnits.length).toBeGreaterThan(easy.enemyUnits.length);
    });
    it('assigns the correct faction to all enemy units', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('raid', 'medium', 'ataxian', terrain, reg, 0);
        for (const unit of result.enemyUnits) {
            expect(unit.ownerId).toBe('ataxian');
        }
    });
    it('all enemy units default to free_fire posture', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('defend', 'easy', 'ataxian', terrain, reg, 0);
        for (const unit of result.enemyUnits) {
            expect(unit.firePosture).toBe('free_fire');
        }
    });
    it('platoon count matches difficulty', () => {
        const { terrain, reg } = buildMissionSetup();
        const easy = generateMission('patrol', 'easy', 'ataxian', terrain, reg, 0);
        const medium = generateMission('patrol', 'medium', 'ataxian', terrain, reg, 0);
        const hard = generateMission('patrol', 'hard', 'ataxian', terrain, reg, 0);
        expect(easy.enemyPlatoons.length).toBe(2);
        expect(medium.enemyPlatoons.length).toBe(3);
        expect(hard.enemyPlatoons.length).toBe(5);
    });
});
// ---------------------------------------------------------------------------
// Deployment zones
// ---------------------------------------------------------------------------
describe('Deployment zones', () => {
    it('player deployment zone is in the southern half of the map', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('seize', 'easy', 'ataxian', terrain, reg, 0);
        // Player center is at 15% of map height = row 76.8 on a 512-high map
        expect(result.deploymentZoneCenter.z).toBeLessThan(terrain.height * 0.5);
    });
    it('enemy spawn center is in the northern portion of the map', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('seize', 'easy', 'ataxian', terrain, reg, 0);
        // Enemy center is at 75% of map height = row 384 on a 512-high map
        expect(result.enemySpawnCenter.z).toBeGreaterThan(terrain.height * 0.5);
    });
    it('enemy spawns north of the player deployment zone', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('defend', 'medium', 'ataxian', terrain, reg, 0);
        expect(result.enemySpawnCenter.z).toBeGreaterThan(result.deploymentZoneCenter.z);
    });
});
// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------
describe('Objectives', () => {
    it('generates at least one objective', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('defend', 'easy', 'ataxian', terrain, reg, 0);
        expect(result.objectives.length).toBeGreaterThan(0);
    });
    it('all objectives start as not completed', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('raid', 'easy', 'ataxian', terrain, reg, 0);
        for (const obj of result.objectives) {
            expect(obj.isCompleted).toBe(false);
            expect(obj.completedAtTick).toBeNull();
        }
    });
    it('all objectives have positive radius', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('seize', 'hard', 'ataxian', terrain, reg, 0);
        for (const obj of result.objectives) {
            expect(obj.radius).toBeGreaterThan(0);
        }
    });
    it('destroy objectives always have assigned target unit IDs', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('raid', 'easy', 'ataxian', terrain, reg, 0);
        const destroyObjectives = result.objectives.filter(o => o.type === 'destroy');
        for (const obj of destroyObjectives) {
            const targets = result.destroyTargets.get(obj.objectiveId);
            expect(targets).toBeDefined();
            expect(targets.length).toBeGreaterThan(0);
        }
    });
    it('raid mission generates both destroy and extract objectives', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('raid', 'easy', 'ataxian', terrain, reg, 0);
        const types = result.objectives.map(o => o.type);
        expect(types).toContain('destroy');
        expect(types).toContain('extract');
    });
});
// ---------------------------------------------------------------------------
// Time limits
// ---------------------------------------------------------------------------
describe('Mission time limits', () => {
    it('easy missions have the shortest time limit', () => {
        const { terrain, reg } = buildMissionSetup();
        const easy = generateMission('defend', 'easy', 'ataxian', terrain, reg, 0);
        const medium = generateMission('defend', 'medium', 'ataxian', terrain, reg, 0);
        const hard = generateMission('defend', 'hard', 'ataxian', terrain, reg, 0);
        expect(easy.timeLimitSec).toBeLessThan(medium.timeLimitSec);
        expect(medium.timeLimitSec).toBeLessThan(hard.timeLimitSec);
    });
    it('time limits are reasonable (between 10 and 60 minutes)', () => {
        const { terrain, reg } = buildMissionSetup();
        const result = generateMission('breakthrough', 'hard', 'ataxian', terrain, reg, 0);
        expect(result.timeLimitSec).toBeGreaterThanOrEqual(600); // ≥ 10 minutes
        expect(result.timeLimitSec).toBeLessThanOrEqual(3_600); // ≤ 60 minutes
    });
});
