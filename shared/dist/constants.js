// ============================================================================
// GAME CONSTANTS — authoritative values from AUTHORITATIVE_CONTRACTS.md
// If a value appears here AND in a design doc, this file wins.
// ============================================================================
// --- Tick rate ---
export const TICK_RATE_HZ = 20;
export const TICK_MS = 50;
export const TICKS_PER_SEC = 20;
// --- Snapshots ---
export const SNAPSHOT_INTERVAL_SEC = 60;
export const SNAPSHOT_INTERVAL_TICKS = SNAPSHOT_INTERVAL_SEC * TICKS_PER_SEC;
// --- Disconnect ---
export const DISCONNECT_GRACE_SEC = 300; // 5 minutes
export const DISCONNECT_GRACE_TICKS = DISCONNECT_GRACE_SEC * TICKS_PER_SEC; // 6000
// --- Pathfinding ---
export const PATHFINDING_EPSILON = 1.2; // weighted A*
export const PATHFINDING_MAX_OPEN_NODES = 50_000;
export const PATHFINDING_MAX_STAGGER_TICKS = 3;
export const PATHFINDING_SMOOTHING_LOOKAHEAD = 32;
export const IMPASSABLE_THRESHOLD = 90;
export const MAX_QUEUED_WAYPOINTS = 4;
// --- Movement mode multipliers ---
export const MOVE_MULT_MARCH = 1.0;
export const MOVE_MULT_ADVANCE = 0.5;
export const MOVE_MULT_REVERSE = 0.33;
// --- Spotting & detection ---
export const BASE_ACCUMULATION_RATE = 10; // points per second
export const DECAY_RATE_PER_SEC = 8;
export const SPOTTING_UPDATE_TICKS = 20; // once per second (every 20 ticks)
// Detection tier thresholds
export const TIER_SUSPECTED_MIN = 1;
export const TIER_SUSPECTED_MAX = 24;
export const TIER_DETECTED_MIN = 25;
export const TIER_DETECTED_MAX = 74;
export const TIER_CONFIRMED_MIN = 75;
export const TIER_CONFIRMED_MAX = 100;
export const LOST_DISPLAY_FADE_SEC = 60;
// Size-0 detection cap
export const SIZE_ZERO_VISION_CAP = 750; // observers below this visionM can't push past SUSPECTED
// --- Spatial indexing ---
export const SPATIAL_HASH_CELL_SIZE = 500; // metres
// --- Sensor tier thresholds ---
export const THERMAL_VISION_THRESHOLD = 2000; // visionM >= this = thermal
export const RADAR_VISION_THRESHOLD = 2500; // visionM >= this = radar
// --- LOS reduction multipliers ---
export const LOS_FOREST_OPTICAL = 0.30;
export const LOS_FOREST_THERMAL = 0.50;
export const LOS_ORCHARD_OPTICAL = 0.50;
export const LOS_ORCHARD_THERMAL = 0.70;
export const LOS_SMOKE_OPTICAL = 0.30;
export const LOS_SMOKE_THERMAL = 0.70;
export const LOS_SMOKE_BLOCK_COUNT = 3; // 3+ smoke sources = blocked
// --- Suppression thresholds (per Combat Formula Spec §3) ---
export const SUPPRESSION_PIN_THRESHOLD = 40;
export const SUPPRESSION_ROUTE_THRESHOLD = 70;
export const SUPPRESSION_SURRENDER_THRESHOLD = 90;
export const RALLY_COOLDOWN_SEC = 15;
// --- Supply ---
export const SUPPLY_RANGE_M = 150;
export const SUPPLY_CHECK_INTERVAL_SEC = 1;
// --- Deployment ---
export const DEPLOYMENT_TIMER_SEC = 180; // 3 minutes
export const MIN_DEPLOYMENT_ZONE_AREA = 250_000; // m²
export const MAX_AUTO_DEPLOY_ATTEMPTS = 20;
// --- SP economy (POST_MISSION_RESOLUTION model) ---
export const SP_MINIMUM_FLOOR = 10;
export const SP_DIFFICULTY_MULTIPLIERS = { easy: 1.0, medium: 1.5, hard: 2.0 };
export const SP_BONUS_ZERO_KIA = 100;
export const SP_BONUS_SECONDARY = 150;
export const SP_BONUS_SPEED = 50;
export const SP_MIN_COMBAT_TIME_SEC = 60; // minimum time for any reward
// --- SP base by mission type and outcome ---
export const SP_BASE_TABLE = {
    defend: { victory: 300, defeat: 70, draw: 150 },
    seize: { victory: 350, defeat: 80, draw: 175 },
    raid: { victory: 400, defeat: 90, draw: 200 },
    patrol: { victory: 200, defeat: 50, draw: 100 },
    rescue: { victory: 300, defeat: 75, draw: 150 },
    breakthrough: { victory: 500, defeat: 100, draw: 250 },
    evacuation: { victory: 400, defeat: 80, draw: 200 },
    hive_clear: { victory: 500, defeat: 100, draw: 250 },
    fortification_assault: { victory: 500, defeat: 100, draw: 250 },
    logistics: { victory: 350, defeat: 60, draw: 175 },
};
// --- Canonical platoon sizes ---
export const PLATOON_SIZES = {
    ataxian: { infantry: 6, vehicle: 4, specialist: 3 },
    khroshi: { infantry: 4, vehicle: 3, specialist: 2 },
};
// --- Faction AI weights ---
export const FACTION_AI_WEIGHTS = {
    ataxian: {
        retreatThreshold: 0.0,
        threatAversion: 2.0,
        aggressionBias: 4.0,
        defensiveTerrainBonus: 0.5,
    },
    khroshi: {
        retreatThreshold: 0.4,
        threatAversion: 8.0,
        aggressionBias: 1.0,
        defensiveTerrainBonus: 5.0,
    },
};
// --- AI update intervals ---
export const AI_STRATEGIC_UPDATE_TICKS = 100; // every 5s at 20Hz
export const AI_PLATOON_BT_TICKS = 20; // every 1s at 20Hz
// --- VFX ---
export const MAX_CONCURRENT_PARTICLES = 560;
export const MAX_PARTICLE_POOLS = 17;
export const MAX_GROUND_DECALS = 64;
export const VFX_LOD_THRESHOLD = 200; // camera distance for reduced particles
// --- VFX pool budgets ---
export const POOL_BUDGETS = {
    muzzle_flash: 32,
    tracer: 64,
    tracer_burst: 48,
    impact_spark: 48,
    explosion_small: 32,
    explosion_medium: 24,
    explosion_large: 16,
    explosion_orbital: 4,
    smoke_puff: 48,
    smoke_screen: 64,
    dust_cloud: 48,
    fire_sustained: 24,
    debris: 64,
    suppression_ring: 16,
    rocket_trail: 16,
    illumination_flare: 4,
    artillery_whistle: 8,
};
// --- NATO icon colours ---
export const FACTION_COLORS = {
    federation: { frame: '#4080FF', fill: '#203060' },
    ataxian: { frame: '#E04020', fill: '#702010' },
    khroshi: { frame: '#C03050', fill: '#601828' },
    unknown: { frame: '#D09020', fill: '#685010' },
};
// --- Campaign ---
export const CAMPAIGN_TICK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
export const C2_FALLBACK_RADIO_RANGE_M = 300;
export const MAX_PLAYERS_PER_MISSION = 4;
export const DAILY_LOGIN_SP_BONUS = 50;
// --- Influence ---
export const INFLUENCE_SECURE_THRESHOLD = 0; // 0% = planet secure, no missions
export const INFLUENCE_FALLEN_THRESHOLD = 100; // 100% = planet fallen
// --- Helicopter altitude eye heights ---
export const HELICOPTER_EYE_HEIGHT = {
    landed: 2,
    low: 30,
    high: 100,
};
// --- Performance budgets ---
export const PERFORMANCE_BUDGETS = {
    tickBudgetMs: 50,
    spottingPhaseMs: 18,
    maxRaycastsPerSec: 6000,
    influenceMapUpdateMs: 0.6,
    platoonBTPerSecMs: 0.5,
    aiPerTickMs: 0.13,
    vfxPerFrameMs: 0.85,
    iconSystemPerFrameMs: 0.3,
    costGridBuildMs: 200,
    singleAStarMs: 5,
};
