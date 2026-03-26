export declare const TICK_RATE_HZ = 20;
export declare const TICK_MS = 50;
export declare const TICKS_PER_SEC = 20;
export declare const CELL_REAL_M = 20;
export declare const SNAPSHOT_INTERVAL_SEC = 60;
export declare const SNAPSHOT_INTERVAL_TICKS: number;
export declare const DISCONNECT_GRACE_SEC = 300;
export declare const DISCONNECT_GRACE_TICKS: number;
export declare const PATHFINDING_EPSILON = 1.2;
export declare const PATHFINDING_MAX_OPEN_NODES = 50000;
export declare const PATHFINDING_MAX_STAGGER_TICKS = 3;
export declare const PATHFINDING_SMOOTHING_LOOKAHEAD = 32;
export declare const IMPASSABLE_THRESHOLD = 90;
export declare const MAX_QUEUED_WAYPOINTS = 4;
export declare const MOVE_MULT_MARCH = 1;
export declare const MOVE_MULT_ADVANCE = 0.5;
export declare const MOVE_MULT_REVERSE = 0.33;
export declare const BASE_ACCUMULATION_RATE = 10;
export declare const DECAY_RATE_PER_SEC = 8;
export declare const SPOTTING_UPDATE_TICKS = 20;
export declare const TIER_SUSPECTED_MIN = 1;
export declare const TIER_SUSPECTED_MAX = 24;
export declare const TIER_DETECTED_MIN = 25;
export declare const TIER_DETECTED_MAX = 74;
export declare const TIER_CONFIRMED_MIN = 75;
export declare const TIER_CONFIRMED_MAX = 100;
export declare const LOST_DISPLAY_FADE_SEC = 60;
export declare const SIZE_ZERO_VISION_CAP = 750;
export declare const SPATIAL_HASH_CELL_SIZE = 500;
export declare const THERMAL_VISION_THRESHOLD = 2000;
export declare const RADAR_VISION_THRESHOLD = 2500;
export declare const LOS_FOREST_OPTICAL = 0.3;
export declare const LOS_FOREST_THERMAL = 0.5;
export declare const LOS_ORCHARD_OPTICAL = 0.5;
export declare const LOS_ORCHARD_THERMAL = 0.7;
export declare const LOS_SMOKE_OPTICAL = 0.3;
export declare const LOS_SMOKE_THERMAL = 0.7;
export declare const LOS_SMOKE_BLOCK_COUNT = 3;
export declare const SUPPRESSION_PIN_THRESHOLD = 40;
export declare const SUPPRESSION_ROUTE_THRESHOLD = 70;
export declare const SUPPRESSION_SURRENDER_THRESHOLD = 90;
export declare const RALLY_COOLDOWN_SEC = 15;
export declare const SUPPLY_RANGE_M = 150;
export declare const SUPPLY_CHECK_INTERVAL_SEC = 1;
export declare const DEPLOYMENT_TIMER_SEC = 180;
export declare const MIN_DEPLOYMENT_ZONE_AREA = 250000;
export declare const MAX_AUTO_DEPLOY_ATTEMPTS = 20;
export declare const SP_MINIMUM_FLOOR = 10;
export declare const SP_DIFFICULTY_MULTIPLIERS: {
    readonly easy: 1;
    readonly medium: 1.5;
    readonly hard: 2;
};
export declare const SP_BONUS_ZERO_KIA = 100;
export declare const SP_BONUS_SECONDARY = 150;
export declare const SP_BONUS_SPEED = 50;
export declare const SP_MIN_COMBAT_TIME_SEC = 60;
export declare const SP_BASE_TABLE: {
    readonly defend: {
        readonly victory: 300;
        readonly defeat: 70;
        readonly draw: 150;
    };
    readonly seize: {
        readonly victory: 350;
        readonly defeat: 80;
        readonly draw: 175;
    };
    readonly raid: {
        readonly victory: 400;
        readonly defeat: 90;
        readonly draw: 200;
    };
    readonly patrol: {
        readonly victory: 200;
        readonly defeat: 50;
        readonly draw: 100;
    };
    readonly rescue: {
        readonly victory: 300;
        readonly defeat: 75;
        readonly draw: 150;
    };
    readonly breakthrough: {
        readonly victory: 500;
        readonly defeat: 100;
        readonly draw: 250;
    };
    readonly evacuation: {
        readonly victory: 400;
        readonly defeat: 80;
        readonly draw: 200;
    };
    readonly hive_clear: {
        readonly victory: 500;
        readonly defeat: 100;
        readonly draw: 250;
    };
    readonly fortification_assault: {
        readonly victory: 500;
        readonly defeat: 100;
        readonly draw: 250;
    };
    readonly logistics: {
        readonly victory: 350;
        readonly defeat: 60;
        readonly draw: 175;
    };
};
export declare const PLATOON_SIZES: {
    readonly ataxian: {
        readonly infantry: 6;
        readonly vehicle: 4;
        readonly specialist: 3;
    };
    readonly khroshi: {
        readonly infantry: 4;
        readonly vehicle: 3;
        readonly specialist: 2;
    };
};
export declare const FACTION_AI_WEIGHTS: {
    readonly ataxian: {
        readonly retreatThreshold: 0;
        readonly threatAversion: 2;
        readonly aggressionBias: 4;
        readonly defensiveTerrainBonus: 0.5;
    };
    readonly khroshi: {
        readonly retreatThreshold: 0.4;
        readonly threatAversion: 8;
        readonly aggressionBias: 1;
        readonly defensiveTerrainBonus: 5;
    };
};
export declare const AI_STRATEGIC_UPDATE_TICKS = 100;
export declare const AI_PLATOON_BT_TICKS = 20;
export declare const MAX_CONCURRENT_PARTICLES = 560;
export declare const MAX_PARTICLE_POOLS = 17;
export declare const MAX_GROUND_DECALS = 64;
export declare const VFX_LOD_THRESHOLD = 200;
export declare const POOL_BUDGETS: {
    readonly muzzle_flash: 32;
    readonly tracer: 64;
    readonly tracer_burst: 48;
    readonly impact_spark: 48;
    readonly explosion_small: 32;
    readonly explosion_medium: 24;
    readonly explosion_large: 16;
    readonly explosion_orbital: 4;
    readonly smoke_puff: 48;
    readonly smoke_screen: 64;
    readonly dust_cloud: 48;
    readonly fire_sustained: 24;
    readonly debris: 64;
    readonly suppression_ring: 16;
    readonly rocket_trail: 16;
    readonly illumination_flare: 4;
    readonly artillery_whistle: 8;
};
export declare const FACTION_COLORS: {
    readonly federation: {
        readonly frame: "#4080FF";
        readonly fill: "#203060";
    };
    readonly ataxian: {
        readonly frame: "#E04020";
        readonly fill: "#702010";
    };
    readonly khroshi: {
        readonly frame: "#C03050";
        readonly fill: "#601828";
    };
    readonly unknown: {
        readonly frame: "#D09020";
        readonly fill: "#685010";
    };
};
export declare const CAMPAIGN_TICK_INTERVAL_MS: number;
export declare const C2_FALLBACK_RADIO_RANGE_M = 300;
export declare const MAX_PLAYERS_PER_MISSION = 4;
export declare const DAILY_LOGIN_SP_BONUS = 50;
export declare const INFLUENCE_SECURE_THRESHOLD = 0;
export declare const INFLUENCE_FALLEN_THRESHOLD = 100;
export declare const HELICOPTER_EYE_HEIGHT: {
    readonly landed: 2;
    readonly low: 30;
    readonly high: 100;
};
export declare const PERFORMANCE_BUDGETS: {
    readonly tickBudgetMs: 50;
    readonly spottingPhaseMs: 18;
    readonly maxRaycastsPerSec: 6000;
    readonly influenceMapUpdateMs: 0.6;
    readonly platoonBTPerSecMs: 0.5;
    readonly aiPerTickMs: 0.13;
    readonly vfxPerFrameMs: 0.85;
    readonly iconSystemPerFrameMs: 0.3;
    readonly costGridBuildMs: 200;
    readonly singleAStarMs: 5;
};
