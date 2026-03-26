// ============================================================================
// MISSION GENERATION — on-demand mission creation with enemy forces + objectives
// Milestone 3
// Source: MISSION_GENERATION.md, AUTHORITATIVE_CONTRACTS.md
//
// Generates enemy force composition, objectives, and deployment zone
// based on mission type, difficulty, and enemy faction.
// ============================================================================
// ---------------------------------------------------------------------------
// Difficulty multipliers for enemy force generation
// ---------------------------------------------------------------------------
const DIFFICULTY_FORCE_MULTIPLIER = {
    easy: 1.0,
    medium: 1.5,
    hard: 2.5,
};
const DIFFICULTY_PLATOON_COUNT = {
    easy: 2,
    medium: 3,
    hard: 5,
};
const UNITS_PER_PLATOON = 4;
const MISSION_TIME_LIMITS = {
    easy: 1200, // 20 min
    medium: 1500, // 25 min
    hard: 1800, // 30 min
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let genCounter = 0;
function genId(prefix) {
    return `${prefix}_${++genCounter}_${Date.now().toString(36)}`;
}
function randRange(min, max) {
    return min + Math.random() * (max - min);
}
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function findDryPos(terrain, centerX, centerZ, spreadRadius) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const x = centerX + randRange(-spreadRadius, spreadRadius);
        const z = centerZ + randRange(-spreadRadius, spreadRadius);
        const ix = Math.max(0, Math.min(terrain.width - 1, Math.round(x)));
        const iz = Math.max(0, Math.min(terrain.height - 1, Math.round(z)));
        const idx = iz * terrain.width + ix;
        if (terrain.heightmap[idx] > terrain.seaLevel) {
            return { x, z };
        }
    }
    // Fallback: return center
    return { x: centerX, z: centerZ };
}
function createAmmoForType(unitType) {
    const empty = { he: 0, ap: 0, heat: 0, sabot: 0 };
    const slots = unitType.weapons.map((w) => ({
        he: w?.ammoHE ?? 0,
        ap: w?.ammoAP ?? 0,
        heat: w?.ammoHEAT ?? 0,
        sabot: w?.ammoSabot ?? 0,
    }));
    while (slots.length < 4)
        slots.push({ ...empty });
    return [slots[0], slots[1], slots[2], slots[3]];
}
const MISSION_PATTERNS = {
    defend: {
        objectives: [
            { namePrefix: 'DEFEND POSITION', type: 'hold', offsetFromEnemy: true, radius: 80 },
        ],
    },
    seize: {
        objectives: [
            { namePrefix: 'SEIZE OBJECTIVE', type: 'capture', offsetFromEnemy: true, radius: 60 },
        ],
    },
    raid: {
        objectives: [
            { namePrefix: 'DESTROY TARGETS', type: 'destroy', offsetFromEnemy: true, radius: 100 },
            { namePrefix: 'EXTRACT FORCES', type: 'extract', offsetFromEnemy: false, radius: 80 },
        ],
    },
    patrol: {
        objectives: [
            { namePrefix: 'PATROL ZONE ALPHA', type: 'capture', offsetFromEnemy: true, radius: 60 },
            { namePrefix: 'PATROL ZONE BRAVO', type: 'capture', offsetFromEnemy: true, radius: 60 },
        ],
    },
    rescue: {
        objectives: [
            { namePrefix: 'RESCUE AREA', type: 'capture', offsetFromEnemy: true, radius: 50 },
            { namePrefix: 'EXTRACTION POINT', type: 'extract', offsetFromEnemy: false, radius: 80 },
        ],
    },
    breakthrough: {
        objectives: [
            { namePrefix: 'BREAK THROUGH', type: 'capture', offsetFromEnemy: true, radius: 80 },
        ],
    },
    evacuation: {
        objectives: [
            { namePrefix: 'EVACUATION POINT', type: 'extract', offsetFromEnemy: false, radius: 100 },
        ],
    },
    hive_clear: {
        objectives: [
            { namePrefix: 'CLEAR HIVE', type: 'destroy', offsetFromEnemy: true, radius: 120 },
        ],
    },
    fortification_assault: {
        objectives: [
            { namePrefix: 'BREACH FORTIFICATION', type: 'destroy', offsetFromEnemy: true, radius: 80 },
            { namePrefix: 'SECURE POSITION', type: 'hold', offsetFromEnemy: true, radius: 60 },
        ],
    },
    logistics: {
        objectives: [
            { namePrefix: 'SECURE SUPPLY ROUTE', type: 'hold', offsetFromEnemy: false, radius: 100 },
        ],
    },
};
// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------
/**
 * Generate a complete mission: enemy units, platoons, objectives.
 * Called when a player creates a new mission.
 */
export function generateMission(missionType, difficulty, enemyFaction, terrain, unitRegistry, spawnTick) {
    const mapW = terrain.width;
    const mapH = terrain.height;
    // Player spawns near the south edge, enemies spawn near north
    const playerCenterX = mapW / 2;
    const playerCenterZ = mapH * 0.15;
    const enemyCenterX = mapW / 2;
    const enemyCenterZ = mapH * 0.75;
    // --- Generate enemy force ---
    const platoonCount = DIFFICULTY_PLATOON_COUNT[difficulty];
    const enemyTypes = unitRegistry.getByFactionId(enemyFaction);
    // Filter to combat-relevant unit types
    const combatTypes = enemyTypes.filter(t => t.unitClass === 'mbt' || t.unitClass === 'ifv' || t.unitClass === 'infantry' ||
        t.unitClass === 'at_vehicle' || t.unitClass === 'scout' || t.unitClass === 'at_infantry');
    // Fallback if faction has no units loaded
    const availableTypes = combatTypes.length > 0 ? combatTypes : enemyTypes;
    if (availableTypes.length === 0) {
        // No enemy units available — return empty mission with objectives only
        return {
            objectives: [],
            enemyUnits: [],
            enemyPlatoons: [],
            deploymentZoneCenter: { x: playerCenterX, z: playerCenterZ },
            enemySpawnCenter: { x: enemyCenterX, z: enemyCenterZ },
            timeLimitSec: MISSION_TIME_LIMITS[difficulty],
            destroyTargets: new Map(),
        };
    }
    const enemyUnits = [];
    const enemyPlatoons = [];
    for (let p = 0; p < platoonCount; p++) {
        const platoonId = genId('ai_platoon');
        // Spread platoons across the enemy deployment zone
        const platoonAnchorX = enemyCenterX + randRange(-mapW * 0.2, mapW * 0.2);
        const platoonAnchorZ = enemyCenterZ + randRange(-mapH * 0.1, mapH * 0.1);
        const unitIds = [];
        let commandUnitId = null;
        for (let u = 0; u < UNITS_PER_PLATOON; u++) {
            const unitType = pickRandom(availableTypes);
            const pos = findDryPos(terrain, platoonAnchorX, platoonAnchorZ, 40);
            const unitId = genId('ai_unit');
            const unit = createEnemyUnit(unitId, unitType, enemyFaction, platoonId, pos, spawnTick);
            enemyUnits.push(unit);
            unitIds.push(unitId);
            if (u === 0)
                commandUnitId = unitId;
        }
        enemyPlatoons.push({
            platoonId,
            factionId: enemyFaction,
            intent: 'defend',
            unitIds,
            commandUnitId,
            isRoutingAsGroup: false,
        });
    }
    // --- Generate objectives ---
    const pattern = MISSION_PATTERNS[missionType] ?? MISSION_PATTERNS['defend'];
    const objectives = [];
    const destroyTargets = new Map();
    // Place objectives in a central engagement band, biased toward player
    // deployment so early gameplay reaches objectives faster.
    const mapMidX = mapW * 0.5;
    const mapMidZ = mapH * 0.5;
    const approachBandZ = playerCenterZ + (mapMidZ - playerCenterZ) * 0.72;
    for (let i = 0; i < pattern.objectives.length; i++) {
        const def = pattern.objectives[i];
        const objId = genId('obj');
        const xBias = def.offsetFromEnemy ? randRange(-mapW * 0.08, mapW * 0.08) : randRange(-mapW * 0.12, mapW * 0.12);
        const zBias = def.offsetFromEnemy ? randRange(-mapH * 0.06, mapH * 0.08) : randRange(-mapH * 0.10, mapH * 0.04);
        // Extract objectives stay slightly closer to deployment than capture/destroy points.
        const baseZ = def.type === 'extract'
            ? playerCenterZ + (approachBandZ - playerCenterZ) * 0.78 + zBias
            : approachBandZ + zBias;
        const pos = findDryPos(terrain, mapMidX + xBias, baseZ, Math.max(24, Math.min(mapW, mapH) * 0.08));
        objectives.push({
            objectiveId: objId,
            name: `${def.namePrefix} ${String.fromCharCode(65 + i)}`,
            type: def.type,
            posX: pos.x,
            posZ: pos.z,
            radius: def.radius,
            isCompleted: false,
            completedAtTick: null,
            progress: 0,
        });
        // For destroy objectives, assign nearby enemy units as targets
        if (def.type === 'destroy') {
            const targetIds = enemyUnits
                .filter(u => {
                const dx = u.posX - pos.x;
                const dz = u.posZ - pos.z;
                return dx * dx + dz * dz < (def.radius * 2) * (def.radius * 2);
            })
                .map(u => u.instanceId);
            // If no units were near enough, assign 2 random enemy units
            if (targetIds.length === 0 && enemyUnits.length > 0) {
                const shuffled = [...enemyUnits].sort(() => Math.random() - 0.5);
                for (let j = 0; j < Math.min(2, shuffled.length); j++) {
                    targetIds.push(shuffled[j].instanceId);
                }
            }
            destroyTargets.set(objId, targetIds);
        }
    }
    return {
        objectives,
        enemyUnits,
        enemyPlatoons,
        deploymentZoneCenter: { x: playerCenterX, z: playerCenterZ },
        enemySpawnCenter: { x: enemyCenterX, z: enemyCenterZ },
        timeLimitSec: MISSION_TIME_LIMITS[difficulty],
        destroyTargets,
    };
}
// ---------------------------------------------------------------------------
// Enemy unit instance factory
// ---------------------------------------------------------------------------
function createEnemyUnit(unitId, unitType, faction, platoonId, pos, spawnTick) {
    return {
        instanceId: unitId,
        unitTypeId: unitType.id,
        ownerId: faction, // AI faction ID used as owner
        platoonId,
        callsign: `${faction.toUpperCase().substring(0, 3)}-${unitId.slice(-4).toUpperCase()}`,
        posX: pos.x,
        posZ: pos.z,
        heading: 180, // face south (toward player spawn)
        turretHeading: unitType.weapons[0]?.traverseType === 'turret' ? 180 : null,
        speedState: 'full_halt',
        moveMode: 'advance',
        currentPath: null,
        pathIndex: 0,
        recentDistanceM: 0,
        stoppedForSec: 0,
        currentOrder: null,
        orderQueue: [],
        isOrderComplete: true,
        crewCurrent: unitType.maxCrew,
        crewMax: unitType.maxCrew,
        isDestroyed: false,
        isBailedOut: false,
        isImmobilized: false,
        steelArmour: { ...unitType.steelArmour },
        heatArmour: { ...unitType.heatArmour },
        eraRemaining: { ...unitType.eraLevel },
        ammo: createAmmoForType(unitType),
        weaponCooldowns: [0, 0, 0, 0],
        lastFireTick: 0,
        firedThisTick: false,
        firePosture: 'free_fire', // AI units default to free fire
        maxEngageRangeM: Math.max(...unitType.weapons.filter(Boolean).map(w => w.rangeM), 1000),
        currentTargetId: null,
        engageSlotOverride: null,
        suppressionLevel: 0,
        moraleState: 'normal',
        lastRalliedAtTick: -999,
        transportedBy: null,
        passengers: [],
        altitudeState: null,
        altitudeTransitioning: false,
        altitudeTransitionTimer: 0,
        isEntrenched: false,
        entrenchProgress: 0,
        ewCharges: unitType.ew,
        smokeRemaining: unitType.smokeDischargers,
        supplyCheckTimer: 0,
        isBeingResupplied: false,
        detectionAccumulators: new Map(),
        experience: 65, // AI units slightly lower experience than player
        camouflageModifier: 1.0,
        spawnTick,
        lastMoveTick: spawnTick,
        destroyedAtTick: null,
    };
}
