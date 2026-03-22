// ============================================================================
// LOBBY MANAGER — Mission browser, on-demand creation, matchmaking, join flow
// Milestone 4: Multiplayer
// Source: LOBBY_AND_MATCHMAKING.md, MISSION_LIFECYCLE.md, DEPLOYMENT_PHASE.md
// ============================================================================

import type {
  MissionRecord,
  MissionGenRequest,
  DifficultyTier,
  MissionType,
  MissionPhaseInternal,
  PlayerMissionState,
  Vec2,
} from '@legionaires/shared';

import {
  MAX_PLAYERS_PER_MISSION,
  DEPLOYMENT_TIMER_SEC,
} from '@legionaires/shared/constants';

// ---------------------------------------------------------------------------
// Lobby-specific types
// ---------------------------------------------------------------------------

/** Summary sent to clients browsing available missions on a planet. */
export interface MissionListing {
  missionId: string;
  missionType: MissionType;
  difficulty: DifficultyTier;
  phase: MissionPhaseInternal;
  playerCount: number;
  maxPlayers: number;
  createdAt: number;
  /** Seconds remaining before the mission expires without enough players */
  expiresInSec: number;
}

/** Result of a join attempt. */
export interface JoinResult {
  success: boolean;
  missionId?: string;
  /** If joining during LIVE phase, this is true — client gets late-join flow */
  isLateJoin?: boolean;
  error?: string;
}

/** Result of creating a new mission. */
export interface CreateResult {
  success: boolean;
  missionId?: string;
  error?: string;
}

/**
 * Callback interface for the LobbyManager's external dependencies.
 * Keeps the lobby decoupled from persistence and mission generation.
 */
export interface LobbyDependencies {
  /** Generate a new mission record (delegates to MissionGenerator). */
  generateMission(request: MissionGenRequest): Promise<MissionRecord>;

  /** Persist a mission record to the database. */
  saveMission(mission: MissionRecord): Promise<void>;

  /** Load a mission record by ID. */
  loadMission(missionId: string): Promise<MissionRecord | null>;

  /** Instantiate the game server instance for a mission (tick loop, state). */
  startMissionInstance(missionId: string): Promise<void>;

  /** Notify the game instance that a player has joined. */
  addPlayerToMissionInstance(missionId: string, player: PlayerMissionState): Promise<void>;
}

// ---------------------------------------------------------------------------
// LobbyManager
// ---------------------------------------------------------------------------

/**
 * Manages the pre-game flow for multiplayer missions:
 *
 * - **List missions** — shows joinable missions on a given planet.
 * - **Create mission** — on-demand generation (missions are NOT pre-generated).
 * - **Join mission** — adds a player to an existing mission (max 4 per mission).
 * - **Late-join** — if the mission is already in LIVE phase, the new player
 *   enters a personal deployment sub-phase while combat continues.
 * - **Ready tracking** — monitors DEPLOY_READY messages; when all players are
 *   ready (or the 180 s timer expires), transitions to LIVE.
 *
 * The LobbyManager does NOT own the tick loop or game state — it hands off
 * to the game server instance once the mission starts.
 */
export class LobbyManager {
  /**
   * In-memory index of active missions by planet.
   * Key: planetId → Map<missionId, MissionRecord>
   */
  private missionsByPlanet: Map<string, Map<string, MissionRecord>> = new Map();

  /**
   * Quick lookup: missionId → set of playerIds currently in that mission.
   */
  private missionPlayers: Map<string, Set<string>> = new Map();

  /** External dependencies (persistence, generation, game instances). */
  private deps: LobbyDependencies;

  constructor(deps: LobbyDependencies) {
    this.deps = deps;
  }

  // -----------------------------------------------------------------------
  // List available missions on a planet
  // -----------------------------------------------------------------------

  /**
   * Return all joinable missions on a given planet.
   * A mission is joinable if:
   *  - It is in 'created' or 'deployment' or 'live' phase
   *  - It has fewer than MAX_PLAYERS_PER_MISSION (4) players
   *  - It has not expired
   *
   * @param planetId - The planet to query.
   * @returns Array of mission summaries, sorted newest-first.
   */
  listMissions(planetId: string): MissionListing[] {
    const planetMissions = this.missionsByPlanet.get(planetId);
    if (!planetMissions) return [];

    const now = Date.now();
    const listings: MissionListing[] = [];

    for (const [missionId, mission] of planetMissions) {
      const joinablePhases: MissionPhaseInternal[] = ['created', 'deployment', 'live'];
      if (!joinablePhases.includes(mission.state)) continue;

      const playerCount = this.missionPlayers.get(missionId)?.size ?? 0;
      if (playerCount >= MAX_PLAYERS_PER_MISSION) continue;

      if (mission.expiresAt < now) continue;

      listings.push({
        missionId,
        missionType: mission.missionType,
        difficulty: mission.difficulty,
        phase: mission.state,
        playerCount,
        maxPlayers: MAX_PLAYERS_PER_MISSION,
        createdAt: mission.createdAt,
        expiresInSec: Math.max(0, Math.floor((mission.expiresAt - now) / 1000)),
      });
    }

    // Newest first
    listings.sort((a, b) => b.createdAt - a.createdAt);
    return listings;
  }

  // -----------------------------------------------------------------------
  // Create a new mission (on-demand, not pre-generated)
  // -----------------------------------------------------------------------

  /**
   * Generate and register a new mission on a planet.
   *
   * @param planetId   - Target planet.
   * @param difficulty - Chosen difficulty tier (easy/medium/hard).
   * @param playerId   - The player requesting creation.
   * @param battalionId - The battalion they're deploying.
   * @returns CreateResult with the new missionId on success.
   */
  async createMission(
    planetId: string,
    difficulty: DifficultyTier,
    playerId: string,
    battalionId: string,
  ): Promise<CreateResult> {
    // Prevent a player from creating a mission while already in one
    if (this.isPlayerInAnyMission(playerId)) {
      return { success: false, error: 'Player is already in a mission' };
    }

    const request: MissionGenRequest = {
      planetId,
      difficulty,
      requestingPlayerId: playerId,
      battalionId,
    };

    // TODO: Validate that the planet exists and is not fallen (influence < 100)
    // TODO: Validate that the battalion is 'available' status and on this planet

    try {
      const mission = await this.deps.generateMission(request);
      await this.deps.saveMission(mission);

      // Index the mission locally
      if (!this.missionsByPlanet.has(planetId)) {
        this.missionsByPlanet.set(planetId, new Map());
      }
      this.missionsByPlanet.get(planetId)!.set(mission.missionId, mission);
      this.missionPlayers.set(mission.missionId, new Set());

      // Spin up the game server instance (tick loop, terrain gen, etc.)
      await this.deps.startMissionInstance(mission.missionId);

      return { success: true, missionId: mission.missionId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: `Mission creation failed: ${message}` };
    }
  }

  // -----------------------------------------------------------------------
  // Join an existing mission
  // -----------------------------------------------------------------------

  /**
   * Add a player to an existing mission.
   *
   * - If the mission is in 'created' or 'deployment' phase → normal join.
   * - If the mission is in 'live' phase → late-join flow: the player gets
   *   a personal deployment zone and can place units while combat continues.
   *   Their units are invulnerable until deployment completes.
   *
   * @param missionId   - The mission to join.
   * @param playerId    - Joining player's ID.
   * @param playerName  - Display name.
   * @param battalionId - The battalion being deployed.
   * @returns JoinResult indicating success/failure and whether it's a late join.
   */
  async joinMission(
    missionId: string,
    playerId: string,
    playerName: string,
    battalionId: string,
  ): Promise<JoinResult> {
    // Check the player isn't already in a mission
    if (this.isPlayerInAnyMission(playerId)) {
      return { success: false, error: 'Player is already in a mission' };
    }

    // Find the mission
    const mission = this.findMissionById(missionId);
    if (!mission) {
      return { success: false, error: 'Mission not found' };
    }

    // Check phase allows joining
    const joinablePhases: MissionPhaseInternal[] = ['created', 'deployment', 'live'];
    if (!joinablePhases.includes(mission.state)) {
      return { success: false, error: `Cannot join mission in '${mission.state}' phase` };
    }

    // Check player cap
    const players = this.missionPlayers.get(missionId);
    if (!players) {
      return { success: false, error: 'Mission state corrupted' };
    }
    if (players.size >= MAX_PLAYERS_PER_MISSION) {
      return { success: false, error: 'Mission is full (max 4 players)' };
    }

    // Check expiry
    if (mission.expiresAt < Date.now()) {
      return { success: false, error: 'Mission has expired' };
    }

    // TODO: Validate battalion is available and on this planet

    const isLateJoin = mission.state === 'live';

    // Register the player
    players.add(playerId);
    mission.playerIds.push(playerId);

    // Build the PlayerMissionState and hand off to the game instance
    const playerState: PlayerMissionState = {
      playerId,
      playerName,
      battalionId,
      unitIds: [],                          // populated during deployment
      isConnected: true,
      disconnectedAtTick: null,
      joinedAtTick: 0,                      // game instance will set the real tick
      readyForDeployment: false,
    };

    await this.deps.addPlayerToMissionInstance(missionId, playerState);

    // If the mission was in 'created' and this is the first player,
    // transition to 'deployment' phase
    if (mission.state === 'created') {
      mission.state = 'deployment';
      mission.startedAt = Date.now();
      // TODO: Persist the state change
      // TODO: Start the deployment timer (DEPLOYMENT_TIMER_SEC = 180s)
    }

    return {
      success: true,
      missionId,
      isLateJoin,
    };
  }

  // -----------------------------------------------------------------------
  // Player disconnect / leave
  // -----------------------------------------------------------------------

  /**
   * Remove a player from a mission's lobby tracking.
   * Called by DisconnectManager when grace period expires, or when
   * the player explicitly leaves.
   */
  removePlayerFromMission(missionId: string, playerId: string): void {
    const players = this.missionPlayers.get(missionId);
    if (players) {
      players.delete(playerId);
    }

    const mission = this.findMissionById(missionId);
    if (mission) {
      mission.playerIds = mission.playerIds.filter(id => id !== playerId);
    }
  }

  // -----------------------------------------------------------------------
  // Mission lifecycle helpers
  // -----------------------------------------------------------------------

  /**
   * Transition a mission to a new phase. Called by the game server instance
   * when phase transitions occur (deployment → live, live → extraction, etc.).
   */
  updateMissionPhase(missionId: string, newPhase: MissionPhaseInternal): void {
    const mission = this.findMissionById(missionId);
    if (!mission) return;

    mission.state = newPhase;

    // If the mission has ended, clean up our indices
    if (newPhase === 'closed') {
      this.cleanupMission(missionId);
    }
  }

  /**
   * Remove expired missions. Should be called periodically.
   */
  reapExpiredMissions(): number {
    const now = Date.now();
    let reaped = 0;

    for (const [planetId, missions] of this.missionsByPlanet) {
      for (const [missionId, mission] of missions) {
        // Only reap missions that are still in 'created' phase and have expired
        // (active missions are handled by the game loop)
        if (mission.state === 'created' && mission.expiresAt < now) {
          this.cleanupMission(missionId);
          reaped++;
        }
      }
    }

    return reaped;
  }

  /**
   * Get the current player count for a mission.
   */
  getPlayerCount(missionId: string): number {
    return this.missionPlayers.get(missionId)?.size ?? 0;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Check if a player is currently in any active mission.
   */
  private isPlayerInAnyMission(playerId: string): boolean {
    for (const players of this.missionPlayers.values()) {
      if (players.has(playerId)) return true;
    }
    return false;
  }

  /**
   * Find a mission by ID across all planets.
   */
  private findMissionById(missionId: string): MissionRecord | null {
    for (const missions of this.missionsByPlanet.values()) {
      const mission = missions.get(missionId);
      if (mission) return mission;
    }
    return null;
  }

  /**
   * Remove all traces of a mission from in-memory indices.
   */
  private cleanupMission(missionId: string): void {
    this.missionPlayers.delete(missionId);

    for (const [planetId, missions] of this.missionsByPlanet) {
      if (missions.delete(missionId)) {
        // If planet has no more missions, remove the planet entry
        if (missions.size === 0) {
          this.missionsByPlanet.delete(planetId);
        }
        break;
      }
    }
  }
}
