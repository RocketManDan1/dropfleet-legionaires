// ============================================================================
// MISSION GENERATOR — On-demand mission creation from planet + difficulty
// Milestone 5: Campaign
// Source: MISSION_GENERATION.md, AUTHORITATIVE_CONTRACTS.md, FACTIONS.md
// ============================================================================

import type {
  MissionRecord,
  MissionGenRequest,
  MissionArchetype,
  MissionType,
  DifficultyTier,
  DifficultyProfile,
  ObjectiveDefinition,
  DeploymentZone,
  PlanetRecord,
  FactionId,
  Vec2,
} from '@legionaires/shared';

import {
  PLATOON_SIZES,
  MAX_PLAYERS_PER_MISSION,
} from '@legionaires/shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Mission expiry: how long a mission can sit in 'created' state before
 * being automatically reaped. 2 hours.
 */
const MISSION_EXPIRY_MS = 2 * 60 * 60 * 1000;

/**
 * Difficulty profiles from AUTHORITATIVE_CONTRACTS.md.
 * Controls enemy count, quality, time limit, and support assets.
 */
const DIFFICULTY_PROFILES: Record<DifficultyTier, DifficultyProfile> = {
  easy: {
    tier: 'easy',
    tunedForPlayers: 1,
    maxPlayers: 4,
    enemyPlatoonRange: [2, 3],
    enemyQualityWeights: { baseline: 0.7, veteran: 0.25, elite: 0.05 },
    supportAssets: { mortars: true, artillery: false, airSupport: false },
    timeLimitSeconds: 30 * 60,  // 30 min
    spMultiplier: 1.0,
    influenceImpact: 'small',
    secondaryObjectiveRange: [0, 1],
  },
  medium: {
    tier: 'medium',
    tunedForPlayers: 2,
    maxPlayers: 4,
    enemyPlatoonRange: [4, 6],
    enemyQualityWeights: { baseline: 0.4, veteran: 0.45, elite: 0.15 },
    supportAssets: { mortars: true, artillery: true, airSupport: false },
    timeLimitSeconds: 45 * 60,  // 45 min
    spMultiplier: 1.5,
    influenceImpact: 'medium',
    secondaryObjectiveRange: [1, 2],
  },
  hard: {
    tier: 'hard',
    tunedForPlayers: 3,
    maxPlayers: 4,
    enemyPlatoonRange: [6, 9],
    enemyQualityWeights: { baseline: 0.2, veteran: 0.45, elite: 0.35 },
    supportAssets: { mortars: true, artillery: true, airSupport: true },
    timeLimitSeconds: 60 * 60,  // 60 min
    spMultiplier: 2.0,
    influenceImpact: 'large',
    secondaryObjectiveRange: [1, 3],
  },
};

/**
 * The 10 canonical mission archetypes from MISSION_GENERATION.md.
 * Each has a base weight (likelihood of selection) and parameters.
 */
const MISSION_ARCHETYPES: MissionArchetypeEntry[] = [
  { type: 'defend',                weight: 15, disposition: 'defensive',  hasExtraction: false, timeMultiplier: 1.0 },
  { type: 'seize',                 weight: 15, disposition: 'offensive',  hasExtraction: false, timeMultiplier: 1.0 },
  { type: 'raid',                  weight: 12, disposition: 'mixed',      hasExtraction: true,  timeMultiplier: 0.8 },
  { type: 'patrol',               weight: 15, disposition: 'patrol',     hasExtraction: false, timeMultiplier: 0.7 },
  { type: 'rescue',               weight: 8,  disposition: 'mixed',      hasExtraction: true,  timeMultiplier: 1.0 },
  { type: 'breakthrough',         weight: 8,  disposition: 'offensive',  hasExtraction: true,  timeMultiplier: 1.2 },
  { type: 'evacuation',           weight: 8,  disposition: 'defensive',  hasExtraction: true,  timeMultiplier: 0.9 },
  { type: 'hive_clear',           weight: 7,  disposition: 'offensive',  hasExtraction: false, timeMultiplier: 1.3 },
  { type: 'fortification_assault',weight: 7,  disposition: 'defensive',  hasExtraction: false, timeMultiplier: 1.3 },
  { type: 'logistics',            weight: 5,  disposition: 'patrol',     hasExtraction: false, timeMultiplier: 0.8 },
];

interface MissionArchetypeEntry {
  type: MissionType;
  weight: number;
  disposition: 'defensive' | 'offensive' | 'patrol' | 'mixed';
  hasExtraction: boolean;
  timeMultiplier: number;
}

// ---------------------------------------------------------------------------
// Enemy force composition types
// ---------------------------------------------------------------------------

/** A single enemy platoon in the generated force. */
export interface EnemyPlatoon {
  platoonId: string;
  faction: FactionId;
  unitTypeIds: string[];
  quality: 'baseline' | 'veteran' | 'elite';
  role: 'infantry' | 'vehicle' | 'specialist';
}

/** The complete enemy force for a generated mission. */
export interface EnemyForceComposition {
  faction: FactionId;
  platoons: EnemyPlatoon[];
  totalUnitCount: number;
  supportAssets: {
    mortars: boolean;
    artillery: boolean;
    airSupport: boolean;
  };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface MissionGenDependencies {
  /** Load a planet record (to check influence, traits, enemy faction). */
  loadPlanet(planetId: string): Promise<PlanetRecord | null>;

  /** Generate a unique ID (UUID v4). */
  generateId(): string;

  /** Get all available enemy unit type IDs for a faction + role. */
  getEnemyUnitTypes(faction: FactionId, role: 'infantry' | 'vehicle' | 'specialist'): string[];
}

// ---------------------------------------------------------------------------
// MissionGenerator
// ---------------------------------------------------------------------------

/**
 * Generates missions on-demand when a player selects a planet and difficulty.
 * Missions are NOT pre-generated — they are created at the moment of request.
 *
 * The generation pipeline:
 *
 * 1. **Select mission type** — weighted random from the 10 archetypes,
 *    influenced by the planet's influence level and traits.
 * 2. **Generate enemy force** — platoon-based sizing using canonical platoon
 *    sizes from AUTHORITATIVE_CONTRACTS.md (Ataxian: 6/4/3, Khroshi: 4/3/2).
 * 3. **Generate objectives** — from archetype templates, placed procedurally.
 * 4. **Generate map seed** — deterministic seed for terrain generation.
 */
export class MissionGenerator {
  private deps: MissionGenDependencies;

  constructor(deps: MissionGenDependencies) {
    this.deps = deps;
  }

  // -----------------------------------------------------------------------
  // Main generation entry point
  // -----------------------------------------------------------------------

  /**
   * Generate a complete mission from a player's request.
   *
   * @param request - Contains planetId, difficulty, requestingPlayerId, battalionId.
   * @returns A fully-formed MissionRecord ready for persistence and play.
   */
  async generate(request: MissionGenRequest): Promise<MissionRecord> {
    const planet = await this.deps.loadPlanet(request.planetId);
    if (!planet) {
      throw new Error(`Planet not found: ${request.planetId}`);
    }

    // Step 1: Select mission type
    const missionType = this.selectMissionType(planet);
    const archetype = MISSION_ARCHETYPES.find(a => a.type === missionType)!;
    const profile = DIFFICULTY_PROFILES[request.difficulty];

    // Step 2: Generate the enemy force composition
    const enemyFaction = this.determineEnemyFaction(planet);
    const enemyForce = this.generateEnemyForce(enemyFaction, profile);

    // Step 3: Generate objectives
    const objectives = this.generateObjectives(missionType, profile);

    // Step 4: Generate map seed and dimensions
    const mapSeed = this.generateMapSeed(planet, missionType);
    const mapWidth = 2000;  // metres — TODO: vary by mission type
    const mapHeight = 2000;

    // Step 5: Assemble the mission record
    const now = Date.now();
    const missionId = this.deps.generateId();

    const mission: MissionRecord = {
      missionId,
      planetId: request.planetId,
      missionType,
      difficulty: request.difficulty,
      state: 'created',
      createdAt: now,
      startedAt: null,
      endedAt: null,
      expiresAt: now + MISSION_EXPIRY_MS,
      result: null,
      playerIds: [],
      mapSeed,
      mapWidth,
      mapHeight,
    };

    // TODO: Store enemyForce and objectives in a separate EnemyForceRecord
    // and ObjectiveRecord table, linked by missionId. For now they are
    // generated at runtime when the mission instance starts.

    return mission;
  }

  // -----------------------------------------------------------------------
  // Step 1: Mission type selection
  // -----------------------------------------------------------------------

  /**
   * Select a mission type from the weighted pool, biased by the planet's
   * current state.
   *
   * Weight modifiers:
   * - High Ataxian influence → more hive_clear missions
   * - High Khroshi influence → more fortification_assault missions
   * - Planets with "logistics_hub" trait → more logistics missions
   * - Falling/critical planets → more defend/evacuation missions
   *
   * @param planet - The target planet.
   * @returns The selected MissionType.
   */
  private selectMissionType(planet: PlanetRecord): MissionType {
    // Start with base weights
    const weights = new Map<MissionType, number>();
    for (const archetype of MISSION_ARCHETYPES) {
      weights.set(archetype.type, archetype.weight);
    }

    // Apply planet-specific modifiers
    const combinedEnemy = planet.influenceAtaxian + planet.influenceKhroshi;

    // High Ataxian influence → boost hive_clear
    if (planet.influenceAtaxian > 40) {
      weights.set('hive_clear', (weights.get('hive_clear') ?? 0) + 10);
    }

    // High Khroshi influence → boost fortification_assault
    if (planet.influenceKhroshi > 40) {
      weights.set('fortification_assault', (weights.get('fortification_assault') ?? 0) + 10);
    }

    // Planet in danger → more defensive missions
    if (combinedEnemy >= 70) {
      weights.set('defend', (weights.get('defend') ?? 0) + 8);
      weights.set('evacuation', (weights.get('evacuation') ?? 0) + 5);
    }

    // Logistics trait → more logistics missions
    if (planet.planetTraits.includes('logistics_hub')) {
      weights.set('logistics', (weights.get('logistics') ?? 0) + 8);
    }

    // Weighted random selection
    return this.weightedSelect(weights);
  }

  // -----------------------------------------------------------------------
  // Step 2: Enemy force generation
  // -----------------------------------------------------------------------

  /**
   * Determine which enemy faction the mission is against, based on which
   * has more influence on the planet.
   */
  private determineEnemyFaction(planet: PlanetRecord): FactionId {
    if (planet.influenceAtaxian >= planet.influenceKhroshi) {
      return 'ataxian';
    }
    return 'khroshi';
  }

  /**
   * Generate the enemy force composition using platoon-based sizing.
   *
   * Platoon sizes are defined in AUTHORITATIVE_CONTRACTS.md:
   * - Ataxian:  infantry=6, vehicle=4, specialist=3
   * - Khroshi:  infantry=4, vehicle=3, specialist=2
   *
   * The number of platoons comes from the difficulty profile's
   * enemyPlatoonRange [min, max].
   *
   * @param faction - The enemy faction.
   * @param profile - The difficulty profile.
   * @returns Complete enemy force composition.
   */
  private generateEnemyForce(
    faction: FactionId,
    profile: DifficultyProfile,
  ): EnemyForceComposition {
    const [minPlatoons, maxPlatoons] = profile.enemyPlatoonRange;
    const platoonCount = this.randomInt(minPlatoons, maxPlatoons);

    const factionKey = faction === 'ataxian' ? 'ataxian' : 'khroshi';
    const sizes = PLATOON_SIZES[factionKey];

    const platoons: EnemyPlatoon[] = [];
    let totalUnits = 0;

    for (let i = 0; i < platoonCount; i++) {
      // Decide platoon role: ~50% infantry, ~35% vehicle, ~15% specialist
      const roleRoll = Math.random();
      let role: 'infantry' | 'vehicle' | 'specialist';
      if (roleRoll < 0.50) {
        role = 'infantry';
      } else if (roleRoll < 0.85) {
        role = 'vehicle';
      } else {
        role = 'specialist';
      }

      // Determine platoon size from canonical values
      const platoonSize = sizes[role];

      // Determine quality based on difficulty weights
      const quality = this.selectQuality(profile.enemyQualityWeights);

      // Select unit types for the platoon
      const availableTypes = this.deps.getEnemyUnitTypes(faction, role);
      const unitTypeIds: string[] = [];
      for (let u = 0; u < platoonSize; u++) {
        if (availableTypes.length > 0) {
          const idx = this.randomInt(0, availableTypes.length - 1);
          unitTypeIds.push(availableTypes[idx]);
        }
      }

      platoons.push({
        platoonId: this.deps.generateId(),
        faction,
        unitTypeIds,
        quality,
        role,
      });

      totalUnits += platoonSize;
    }

    return {
      faction,
      platoons,
      totalUnitCount: totalUnits,
      supportAssets: { ...profile.supportAssets },
    };
  }

  /**
   * Select a quality tier based on weighted probabilities.
   */
  private selectQuality(
    weights: { baseline: number; veteran: number; elite: number },
  ): 'baseline' | 'veteran' | 'elite' {
    const roll = Math.random();
    if (roll < weights.baseline) return 'baseline';
    if (roll < weights.baseline + weights.veteran) return 'veteran';
    return 'elite';
  }

  // -----------------------------------------------------------------------
  // Step 3: Objective generation
  // -----------------------------------------------------------------------

  /**
   * Generate objectives based on the mission archetype.
   * Each mission type has a template of primary + secondary objectives.
   *
   * @param missionType - The selected mission type.
   * @param profile     - Difficulty profile (controls secondary objective count).
   * @returns Array of ObjectiveDefinitions.
   */
  private generateObjectives(
    missionType: MissionType,
    profile: DifficultyProfile,
  ): ObjectiveDefinition[] {
    const objectives: ObjectiveDefinition[] = [];

    // Primary objective (always exactly 1)
    const primary = this.generatePrimaryObjective(missionType);
    objectives.push(primary);

    // Secondary objectives (count from difficulty profile)
    const [minSecondary, maxSecondary] = profile.secondaryObjectiveRange;
    const secondaryCount = this.randomInt(minSecondary, maxSecondary);

    for (let i = 0; i < secondaryCount; i++) {
      const secondary = this.generateSecondaryObjective(missionType, i);
      objectives.push(secondary);
    }

    return objectives;
  }

  /**
   * Generate the primary objective for a mission type.
   */
  private generatePrimaryObjective(missionType: MissionType): ObjectiveDefinition {
    // TODO: Randomize positions based on map layout and mission type.
    // For now, place objectives in reasonable default positions.
    const centerX = 1000; // map center
    const centerZ = 1000;

    const id = this.deps.generateId();

    switch (missionType) {
      case 'defend':
        return {
          objectiveId: id,
          name: 'Defend Command Post',
          type: 'hold',
          isPrimary: true,
          posX: centerX,
          posZ: centerZ - 300, // near player spawn
          radius: 100,
          captureTimeSec: 600, // hold for 10 minutes
        };

      case 'seize':
        return {
          objectiveId: id,
          name: 'Capture Objective Alpha',
          type: 'capture',
          isPrimary: true,
          posX: centerX,
          posZ: centerZ + 400, // deep in enemy territory
          radius: 80,
          captureTimeSec: 120,
        };

      case 'raid':
        return {
          objectiveId: id,
          name: 'Destroy Enemy Supply Cache',
          type: 'destroy',
          isPrimary: true,
          posX: centerX + 200,
          posZ: centerZ + 300,
          radius: 50,
          targetUnitTypeId: 'supply_cache',
        };

      case 'patrol':
        return {
          objectiveId: id,
          name: 'Clear Patrol Route',
          type: 'capture',
          isPrimary: true,
          posX: centerX + 300,
          posZ: centerZ,
          radius: 150,
          captureTimeSec: 30,
        };

      case 'rescue':
        return {
          objectiveId: id,
          name: 'Rescue Stranded Patrol',
          type: 'escort',
          isPrimary: true,
          posX: centerX,
          posZ: centerZ + 500,
          radius: 60,
        };

      case 'breakthrough':
        return {
          objectiveId: id,
          name: 'Reach Extraction Zone',
          type: 'extract',
          isPrimary: true,
          posX: centerX,
          posZ: centerZ + 800,
          radius: 120,
        };

      case 'evacuation':
        return {
          objectiveId: id,
          name: 'Evacuate Civilians',
          type: 'hold',
          isPrimary: true,
          posX: centerX,
          posZ: centerZ - 200,
          radius: 100,
          captureTimeSec: 480, // hold for 8 minutes
        };

      case 'hive_clear':
        return {
          objectiveId: id,
          name: 'Destroy Hive Nexus',
          type: 'destroy',
          isPrimary: true,
          posX: centerX,
          posZ: centerZ + 600,
          radius: 80,
          targetUnitTypeId: 'hive_nexus',
        };

      case 'fortification_assault':
        return {
          objectiveId: id,
          name: 'Capture Fortified Position',
          type: 'capture',
          isPrimary: true,
          posX: centerX,
          posZ: centerZ + 500,
          radius: 120,
          captureTimeSec: 180,
        };

      case 'logistics':
        return {
          objectiveId: id,
          name: 'Secure Supply Route',
          type: 'hold',
          isPrimary: true,
          posX: centerX + 400,
          posZ: centerZ,
          radius: 100,
          captureTimeSec: 300,
        };

      default:
        const _exhaustive: never = missionType;
        throw new Error(`Unknown mission type: ${_exhaustive}`);
    }
  }

  /**
   * Generate a secondary objective (bonus SP).
   */
  private generateSecondaryObjective(
    missionType: MissionType,
    index: number,
  ): ObjectiveDefinition {
    // Secondary objectives are smaller side tasks scattered around the map
    const offsetX = (index % 2 === 0 ? 1 : -1) * (200 + Math.random() * 300);
    const offsetZ = Math.random() * 400 - 200;

    const id = this.deps.generateId();

    // Randomly pick a secondary objective type
    const types: Array<ObjectiveDefinition['type']> = ['capture', 'destroy'];
    const type = types[this.randomInt(0, types.length - 1)];

    return {
      objectiveId: id,
      name: `Secondary Objective ${String.fromCharCode(65 + index)}`, // A, B, C...
      type,
      isPrimary: false,
      posX: 1000 + offsetX,
      posZ: 1000 + offsetZ,
      radius: 50,
      captureTimeSec: type === 'capture' ? 60 : undefined,
      targetUnitTypeId: type === 'destroy' ? 'secondary_target' : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Step 4: Map seed generation
  // -----------------------------------------------------------------------

  /**
   * Generate a deterministic map seed from the planet and mission type.
   * Uses the planet's seed plus a hash of the mission type and current time
   * to produce unique-but-reproducible terrain.
   */
  private generateMapSeed(planet: PlanetRecord, missionType: MissionType): number {
    // Combine planet seed with current time for uniqueness
    const timeFactor = Math.floor(Date.now() / 1000);
    let hash = planet.missionGenerationSeed ^ timeFactor;

    // Mix in mission type
    for (let i = 0; i < missionType.length; i++) {
      hash = ((hash << 5) - hash + missionType.charCodeAt(i)) | 0;
    }

    return Math.abs(hash);
  }

  // -----------------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------------

  /**
   * Weighted random selection from a Map<T, weight>.
   */
  private weightedSelect<T>(weights: Map<T, number>): T {
    let totalWeight = 0;
    for (const w of weights.values()) {
      totalWeight += w;
    }

    let roll = Math.random() * totalWeight;
    for (const [item, weight] of weights) {
      roll -= weight;
      if (roll <= 0) return item;
    }

    // Fallback: return first item
    return weights.keys().next().value!;
  }

  /**
   * Generate a random integer in [min, max] inclusive.
   */
  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
