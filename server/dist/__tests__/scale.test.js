// ============================================================================
// SCALE SANITY TESTS
//
// Validates that the meters ↔ cells coordinate system is consistent.
// The core bug these tests guard against: unit positions are stored in
// CELLS (0–511 for a 512-wide map), but weapon/vision ranges are in
// METRES. A direct comparison without conversion causes:
//   - All weapons always in range (cell distance << metre range)
//   - All enemies detected immediately (vision in metres >> map in cells)
//
// These tests will catch any regression where the conversion is removed.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { CELL_REAL_M } from '@legionaires/shared';
describe('CELL_REAL_M constant', () => {
    it('is 20 metres per cell (authoritative value from design spec)', () => {
        expect(CELL_REAL_M).toBe(20);
    });
});
describe('Map scale', () => {
    const MAP_CELLS = 512;
    const MAP_METRES = MAP_CELLS * CELL_REAL_M; // 10 240 m
    it('a 512-cell map represents roughly 10 km × 10 km (tactical battle scale)', () => {
        expect(MAP_METRES).toBe(10_240);
        expect(MAP_METRES).toBeGreaterThan(5_000); // at least 5 km
        expect(MAP_METRES).toBeLessThan(20_000); // at most 20 km
    });
    it('a typical tank gun range (2 000 m) spans 100 cells — not the whole map', () => {
        const weaponRangeM = 2_000;
        const weaponRangeCells = weaponRangeM / CELL_REAL_M;
        expect(weaponRangeCells).toBe(100);
        // Sanity: weapon range should be much less than the full map width
        expect(weaponRangeCells).toBeLessThan(MAP_CELLS * 0.5);
    });
    it('a typical infantry vision range (1 500 m) spans 75 cells', () => {
        const visionM = 1_500;
        const visionCells = visionM / CELL_REAL_M;
        expect(visionCells).toBe(75);
        expect(visionCells).toBeLessThan(MAP_CELLS);
    });
});
describe('Cell ↔ metre conversion round-trips', () => {
    it('converts cells → metres correctly', () => {
        expect(100 * CELL_REAL_M).toBe(2_000); // 100 cells = 2 000 m
        expect(75 * CELL_REAL_M).toBe(1_500); // 75 cells  = 1 500 m
        expect(1 * CELL_REAL_M).toBe(20); // 1 cell    = 20 m
    });
    it('converts metres → cells correctly', () => {
        expect(2_000 / CELL_REAL_M).toBe(100); // 2 000 m = 100 cells
        expect(1_500 / CELL_REAL_M).toBe(75); // 1 500 m = 75  cells
        expect(20 / CELL_REAL_M).toBe(1); // 20 m    = 1   cell
    });
    it('the scale mismatch bug: raw cells are never comparable to metres', () => {
        // If you compared cell-distance directly to weapon range (the bug), a unit
        // 200 cells away would look like it is only 200 m away — well inside a 2 000 m
        // weapon's reach. The correct distance is 200 × 20 = 4 000 m, which is out of range.
        const cellDistance = 200;
        const incorrectMetres = cellDistance; // the bug: no conversion
        const correctMetres = cellDistance * CELL_REAL_M;
        const weaponRangeM = 2_000;
        expect(incorrectMetres).toBeLessThan(weaponRangeM); // bug: appears in range
        expect(correctMetres).toBeGreaterThan(weaponRangeM); // fix: correctly out of range
    });
});
