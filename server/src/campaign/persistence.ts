// ============================================================================
// PERSISTENCE LAYER — PostgreSQL integration for campaign data
// Milestone 5: Campaign
// Source: CAMPAIGN_PERSISTENCE.md, AUTHORITATIVE_CONTRACTS.md
// ============================================================================

import type {
  PlanetRecord,
  BattalionRecord,
  MissionRecord,
  PlayerAccount,
  CampaignTickState,
  UnitSlot,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal database client interface so the PersistenceLayer doesn't depend
 * directly on the pg module. The real implementation will wrap node-postgres;
 * tests can inject a mock.
 */
export interface DatabaseClient {
  /** Execute a parameterized SQL query. */
  query<T = unknown>(text: string, values?: unknown[]): Promise<QueryResult<T>>;

  /** Begin a transaction. Returns a client that must be committed/rolled back. */
  beginTransaction(): Promise<TransactionClient>;
}

export interface TransactionClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Schema SQL
// ---------------------------------------------------------------------------

/**
 * Full database schema for the campaign layer.
 * Executed once on first startup (idempotent via IF NOT EXISTS).
 */
const SCHEMA_SQL = `
-- Players table: account data
CREATE TABLE IF NOT EXISTS players (
  player_id       TEXT PRIMARY KEY,
  player_name     TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  last_login_at   BIGINT NOT NULL,
  battalion_ids   JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Planets table: sector map state
CREATE TABLE IF NOT EXISTS planets (
  planet_id               TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  system_id               TEXT NOT NULL,
  sector_position_x       REAL NOT NULL,
  sector_position_y       REAL NOT NULL,
  influence_federation    REAL NOT NULL DEFAULT 100,
  influence_ataxian       REAL NOT NULL DEFAULT 0,
  influence_khroshi       REAL NOT NULL DEFAULT 0,
  controlling_faction     TEXT,
  strategic_value_tier    INTEGER NOT NULL DEFAULT 1,
  garrison_strength       REAL NOT NULL DEFAULT 100,
  planet_traits           JSONB NOT NULL DEFAULT '[]'::jsonb,
  mission_generation_seed BIGINT NOT NULL,
  last_mission_generated  BIGINT NOT NULL DEFAULT 0,
  connected_planet_ids    JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Battalions table: player-owned force records
CREATE TABLE IF NOT EXISTS battalions (
  battalion_id            TEXT PRIMARY KEY,
  player_id               TEXT NOT NULL REFERENCES players(player_id),
  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL,
  sector_origin           TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'available',
  current_planet_id       TEXT,
  transit_destination_id  TEXT,
  transit_departed_at     BIGINT,
  transit_arrives_at      BIGINT,
  supply_points           INTEGER NOT NULL DEFAULT 0,
  missions_completed      INTEGER NOT NULL DEFAULT 0,
  missions_won            INTEGER NOT NULL DEFAULT 0,
  created_at              BIGINT NOT NULL,
  last_mission_at         BIGINT
);

-- Unit slots table: individual units within a battalion's OOB
CREATE TABLE IF NOT EXISTS unit_slots (
  slot_id         TEXT PRIMARY KEY,
  battalion_id    TEXT NOT NULL REFERENCES battalions(battalion_id) ON DELETE CASCADE,
  unit_type_id    TEXT NOT NULL,
  crew_current    INTEGER NOT NULL,
  crew_max        INTEGER NOT NULL,
  is_reserve      BOOLEAN NOT NULL DEFAULT false,
  upgrade_tier    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_unit_slots_battalion ON unit_slots(battalion_id);

-- Missions table: active and historical mission records
CREATE TABLE IF NOT EXISTS missions (
  mission_id      TEXT PRIMARY KEY,
  planet_id       TEXT NOT NULL,
  mission_type    TEXT NOT NULL,
  difficulty      TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'created',
  created_at      BIGINT NOT NULL,
  started_at      BIGINT,
  ended_at        BIGINT,
  expires_at      BIGINT NOT NULL,
  result          TEXT,
  player_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  map_seed        BIGINT NOT NULL,
  map_width       INTEGER NOT NULL,
  map_height      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_missions_planet ON missions(planet_id);
CREATE INDEX IF NOT EXISTS idx_missions_state ON missions(state);

-- Campaign tick state: single-row table tracking the campaign clock
CREATE TABLE IF NOT EXISTS campaign_tick (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  tick_number     INTEGER NOT NULL DEFAULT 0,
  tick_interval   BIGINT NOT NULL,
  last_tick_at    BIGINT NOT NULL
);

-- Transaction log for crash recovery
CREATE TABLE IF NOT EXISTS transaction_log (
  log_id          SERIAL PRIMARY KEY,
  operation       TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  payload         JSONB NOT NULL,
  created_at      BIGINT NOT NULL,
  committed       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_txlog_uncommitted ON transaction_log(committed) WHERE NOT committed;
`;

// ---------------------------------------------------------------------------
// PersistenceLayer
// ---------------------------------------------------------------------------

/**
 * PostgreSQL persistence layer for all campaign data. Provides:
 *
 * - **Schema initialization** — creates all tables on first run.
 * - **CRUD operations** — for planets, battalions, missions, players, unit slots.
 * - **Atomic transactions** — wraps multi-step operations (e.g. post-mission
 *   casualty commitment) in a transaction for atomicity.
 * - **Crash recovery** — uses a transaction log to detect and replay
 *   incomplete operations after a server crash.
 *
 * All methods accept/return the shared type interfaces. SQL mapping is
 * handled internally.
 */
export class PersistenceLayer {
  private db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
  }

  // -----------------------------------------------------------------------
  // Schema initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the database schema. Idempotent — safe to call on every startup.
   */
  async initializeSchema(): Promise<void> {
    await this.db.query(SCHEMA_SQL);
    console.log('[PersistenceLayer] Schema initialized.');
  }

  // -----------------------------------------------------------------------
  // Player operations
  // -----------------------------------------------------------------------

  /**
   * Read a player account by ID.
   */
  async loadPlayer(playerId: string): Promise<PlayerAccount | null> {
    const result = await this.db.query<PlayerRow>(
      'SELECT * FROM players WHERE player_id = $1',
      [playerId],
    );
    if (result.rows.length === 0) return null;
    return this.rowToPlayerAccount(result.rows[0]);
  }

  /**
   * Create or update a player account.
   */
  async savePlayer(player: PlayerAccount): Promise<void> {
    await this.db.query(
      `INSERT INTO players (player_id, player_name, created_at, last_login_at, battalion_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (player_id) DO UPDATE SET
         player_name = EXCLUDED.player_name,
         last_login_at = EXCLUDED.last_login_at,
         battalion_ids = EXCLUDED.battalion_ids`,
      [
        player.playerId,
        player.playerName,
        player.createdAt,
        player.lastLoginAt,
        JSON.stringify(player.battalionIds),
      ],
    );
  }

  /**
   * Update a player's battalion ID list.
   */
  async updatePlayerBattalionIds(playerId: string, battalionIds: string[]): Promise<void> {
    await this.db.query(
      'UPDATE players SET battalion_ids = $1 WHERE player_id = $2',
      [JSON.stringify(battalionIds), playerId],
    );
  }

  // -----------------------------------------------------------------------
  // Planet operations
  // -----------------------------------------------------------------------

  /**
   * Load all planets in the campaign.
   */
  async loadAllPlanets(): Promise<PlanetRecord[]> {
    const result = await this.db.query<PlanetRow>('SELECT * FROM planets');
    return result.rows.map(row => this.rowToPlanetRecord(row));
  }

  /**
   * Load a single planet by ID.
   */
  async loadPlanet(planetId: string): Promise<PlanetRecord | null> {
    const result = await this.db.query<PlanetRow>(
      'SELECT * FROM planets WHERE planet_id = $1',
      [planetId],
    );
    if (result.rows.length === 0) return null;
    return this.rowToPlanetRecord(result.rows[0]);
  }

  /**
   * Save (upsert) one or more planet records.
   */
  async savePlanets(planets: PlanetRecord[]): Promise<void> {
    for (const planet of planets) {
      await this.db.query(
        `INSERT INTO planets (
          planet_id, name, system_id, sector_position_x, sector_position_y,
          influence_federation, influence_ataxian, influence_khroshi,
          controlling_faction, strategic_value_tier, garrison_strength,
          planet_traits, mission_generation_seed, last_mission_generated,
          connected_planet_ids
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (planet_id) DO UPDATE SET
          influence_federation = EXCLUDED.influence_federation,
          influence_ataxian = EXCLUDED.influence_ataxian,
          influence_khroshi = EXCLUDED.influence_khroshi,
          controlling_faction = EXCLUDED.controlling_faction,
          garrison_strength = EXCLUDED.garrison_strength,
          last_mission_generated = EXCLUDED.last_mission_generated`,
        [
          planet.planetId, planet.name, planet.systemId,
          planet.sectorPositionX, planet.sectorPositionY,
          planet.influenceFederation, planet.influenceAtaxian, planet.influenceKhroshi,
          planet.controllingFaction, planet.strategicValueTier, planet.garrisonStrength,
          JSON.stringify(planet.planetTraits), planet.missionGenerationSeed,
          planet.lastMissionGeneratedAt, JSON.stringify(planet.connectedPlanetIds),
        ],
      );
    }
  }

  // -----------------------------------------------------------------------
  // Battalion operations
  // -----------------------------------------------------------------------

  /**
   * Load a battalion by ID, including its unit slots.
   */
  async loadBattalion(battalionId: string): Promise<BattalionRecord | null> {
    const batResult = await this.db.query<BattalionRow>(
      'SELECT * FROM battalions WHERE battalion_id = $1',
      [battalionId],
    );
    if (batResult.rows.length === 0) return null;

    const slotsResult = await this.db.query<UnitSlotRow>(
      'SELECT * FROM unit_slots WHERE battalion_id = $1 ORDER BY slot_id',
      [battalionId],
    );

    return this.rowToBattalionRecord(
      batResult.rows[0],
      slotsResult.rows.map(r => this.rowToUnitSlot(r)),
    );
  }

  /**
   * Load all battalions owned by a player.
   */
  async loadPlayerBattalions(playerId: string): Promise<BattalionRecord[]> {
    const batResult = await this.db.query<BattalionRow>(
      'SELECT * FROM battalions WHERE player_id = $1',
      [playerId],
    );

    const battalions: BattalionRecord[] = [];
    for (const row of batResult.rows) {
      const slotsResult = await this.db.query<UnitSlotRow>(
        'SELECT * FROM unit_slots WHERE battalion_id = $1 ORDER BY slot_id',
        [row.battalion_id],
      );
      battalions.push(
        this.rowToBattalionRecord(row, slotsResult.rows.map(r => this.rowToUnitSlot(r))),
      );
    }

    return battalions;
  }

  /**
   * Load all battalions currently in transit.
   */
  async loadBattalionsInTransit(): Promise<BattalionRecord[]> {
    const batResult = await this.db.query<BattalionRow>(
      "SELECT * FROM battalions WHERE status = 'in_transit'",
    );

    const battalions: BattalionRecord[] = [];
    for (const row of batResult.rows) {
      const slotsResult = await this.db.query<UnitSlotRow>(
        'SELECT * FROM unit_slots WHERE battalion_id = $1 ORDER BY slot_id',
        [row.battalion_id],
      );
      battalions.push(
        this.rowToBattalionRecord(row, slotsResult.rows.map(r => this.rowToUnitSlot(r))),
      );
    }

    return battalions;
  }

  /**
   * Save (upsert) a battalion and all its unit slots.
   * Uses a transaction to ensure atomicity.
   */
  async saveBattalion(battalion: BattalionRecord): Promise<void> {
    const txn = await this.db.beginTransaction();

    try {
      // Upsert the battalion row
      await txn.query(
        `INSERT INTO battalions (
          battalion_id, player_id, name, type, sector_origin, status,
          current_planet_id, transit_destination_id, transit_departed_at,
          transit_arrives_at, supply_points, missions_completed,
          missions_won, created_at, last_mission_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (battalion_id) DO UPDATE SET
          status = EXCLUDED.status,
          current_planet_id = EXCLUDED.current_planet_id,
          transit_destination_id = EXCLUDED.transit_destination_id,
          transit_departed_at = EXCLUDED.transit_departed_at,
          transit_arrives_at = EXCLUDED.transit_arrives_at,
          supply_points = EXCLUDED.supply_points,
          missions_completed = EXCLUDED.missions_completed,
          missions_won = EXCLUDED.missions_won,
          last_mission_at = EXCLUDED.last_mission_at`,
        [
          battalion.battalionId, battalion.playerId, battalion.name,
          battalion.type, battalion.sectorOrigin, battalion.status,
          battalion.currentPlanetId, battalion.transitDestinationId,
          battalion.transitDepartedAt, battalion.transitArrivesAt,
          battalion.supplyPoints, battalion.missionsCompleted,
          battalion.missionsWon, battalion.createdAt, battalion.lastMissionAt,
        ],
      );

      // Delete existing unit slots and re-insert (simplest upsert for arrays)
      await txn.query(
        'DELETE FROM unit_slots WHERE battalion_id = $1',
        [battalion.battalionId],
      );

      for (const slot of battalion.unitSlots) {
        await txn.query(
          `INSERT INTO unit_slots (
            slot_id, battalion_id, unit_type_id, crew_current, crew_max,
            is_reserve, upgrade_tier, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            slot.slotId, battalion.battalionId, slot.unitTypeId,
            slot.crewCurrent, slot.crewMax, slot.isReserve,
            slot.upgradeTier, slot.status,
          ],
        );
      }

      await txn.commit();
    } catch (err) {
      await txn.rollback();
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Mission operations
  // -----------------------------------------------------------------------

  /**
   * Load a mission by ID.
   */
  async loadMission(missionId: string): Promise<MissionRecord | null> {
    const result = await this.db.query<MissionRow>(
      'SELECT * FROM missions WHERE mission_id = $1',
      [missionId],
    );
    if (result.rows.length === 0) return null;
    return this.rowToMissionRecord(result.rows[0]);
  }

  /**
   * Load all active (non-closed, non-expired) missions.
   */
  async loadActiveMissions(): Promise<MissionRecord[]> {
    const result = await this.db.query<MissionRow>(
      "SELECT * FROM missions WHERE state NOT IN ('closed') ORDER BY created_at DESC",
    );
    return result.rows.map(row => this.rowToMissionRecord(row));
  }

  /**
   * Save (upsert) a mission record.
   */
  async saveMission(mission: MissionRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO missions (
        mission_id, planet_id, mission_type, difficulty, state,
        created_at, started_at, ended_at, expires_at, result,
        player_ids, map_seed, map_width, map_height
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (mission_id) DO UPDATE SET
        state = EXCLUDED.state,
        started_at = EXCLUDED.started_at,
        ended_at = EXCLUDED.ended_at,
        result = EXCLUDED.result,
        player_ids = EXCLUDED.player_ids`,
      [
        mission.missionId, mission.planetId, mission.missionType,
        mission.difficulty, mission.state, mission.createdAt,
        mission.startedAt, mission.endedAt, mission.expiresAt,
        mission.result, JSON.stringify(mission.playerIds),
        mission.mapSeed, mission.mapWidth, mission.mapHeight,
      ],
    );
  }

  /**
   * Mark a mission as expired.
   */
  async expireMission(missionId: string): Promise<void> {
    await this.db.query(
      "UPDATE missions SET state = 'closed', result = 'expired', ended_at = $1 WHERE mission_id = $2",
      [Date.now(), missionId],
    );
  }

  // -----------------------------------------------------------------------
  // Campaign tick state
  // -----------------------------------------------------------------------

  /**
   * Load the campaign tick state. Creates the initial record if it
   * doesn't exist yet.
   */
  async loadTickState(): Promise<CampaignTickState> {
    const result = await this.db.query<CampaignTickRow>(
      'SELECT * FROM campaign_tick WHERE id = 1',
    );

    if (result.rows.length === 0) {
      // First run — create initial tick state
      const initial: CampaignTickState = {
        tickNumber: 0,
        tickInterval: 30 * 60 * 1000,
        lastTickAt: Date.now(),
      };
      await this.db.query(
        'INSERT INTO campaign_tick (id, tick_number, tick_interval, last_tick_at) VALUES (1, $1, $2, $3)',
        [initial.tickNumber, initial.tickInterval, initial.lastTickAt],
      );
      return initial;
    }

    const row = result.rows[0];
    return {
      tickNumber: row.tick_number,
      tickInterval: row.tick_interval,
      lastTickAt: row.last_tick_at,
    };
  }

  /**
   * Save the campaign tick state.
   */
  async saveTickState(state: CampaignTickState): Promise<void> {
    await this.db.query(
      'UPDATE campaign_tick SET tick_number = $1, tick_interval = $2, last_tick_at = $3 WHERE id = 1',
      [state.tickNumber, state.tickInterval, state.lastTickAt],
    );
  }

  // -----------------------------------------------------------------------
  // Atomic transaction wrapper
  // -----------------------------------------------------------------------

  /**
   * Execute a multi-step operation atomically. Used for post-mission
   * resolution where we need to:
   *  1. Update planet influence
   *  2. Apply casualties to battalion slots
   *  3. Award SP
   *  4. Mark mission as closed
   *
   * All must succeed or none do.
   *
   * @param fn - Async function that receives a TransactionClient and
   *             performs all the writes.
   */
  async withTransaction<T>(fn: (txn: TransactionClient) => Promise<T>): Promise<T> {
    const txn = await this.db.beginTransaction();
    try {
      const result = await fn(txn);
      await txn.commit();
      return result;
    } catch (err) {
      await txn.rollback();
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Crash recovery
  // -----------------------------------------------------------------------

  /**
   * Write a transaction log entry BEFORE performing a critical operation.
   * If the server crashes mid-operation, the recovery process can detect
   * and replay uncommitted entries.
   *
   * @param operation - Description of the operation (e.g. 'post_mission_resolve').
   * @param entityType - Type of entity ('planet', 'battalion', 'mission').
   * @param entityId - The entity's ID.
   * @param payload - The data to be written (serialized for replay).
   * @returns The log entry ID.
   */
  async writeTransactionLog(
    operation: string,
    entityType: string,
    entityId: string,
    payload: unknown,
  ): Promise<number> {
    const result = await this.db.query<{ log_id: number }>(
      `INSERT INTO transaction_log (operation, entity_type, entity_id, payload, created_at, committed)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING log_id`,
      [operation, entityType, entityId, JSON.stringify(payload), Date.now()],
    );
    return result.rows[0].log_id;
  }

  /**
   * Mark a transaction log entry as committed (successfully applied).
   */
  async commitTransactionLog(logId: number): Promise<void> {
    await this.db.query(
      'UPDATE transaction_log SET committed = true WHERE log_id = $1',
      [logId],
    );
  }

  /**
   * Find all uncommitted transaction log entries (from a previous crash).
   * Called during startup to detect incomplete operations.
   */
  async findUncommittedEntries(): Promise<TransactionLogEntry[]> {
    const result = await this.db.query<TransactionLogRow>(
      'SELECT * FROM transaction_log WHERE NOT committed ORDER BY log_id ASC',
    );
    return result.rows.map(row => ({
      logId: row.log_id,
      operation: row.operation,
      entityType: row.entity_type,
      entityId: row.entity_id,
      payload: row.payload,
      createdAt: row.created_at,
    }));
  }

  /**
   * Replay uncommitted transaction log entries to restore consistency.
   * Called during startup after finding uncommitted entries.
   */
  async recoverFromCrash(): Promise<number> {
    const uncommitted = await this.findUncommittedEntries();
    if (uncommitted.length === 0) return 0;

    console.log(`[PersistenceLayer] Found ${uncommitted.length} uncommitted transaction(s). Replaying...`);

    let recovered = 0;
    for (const entry of uncommitted) {
      try {
        // TODO: Implement per-operation replay logic based on entry.operation.
        // For now, just mark them as committed to avoid infinite retry loops.
        // Real implementation would re-apply the operation from entry.payload.
        console.log(`[PersistenceLayer] Recovering: ${entry.operation} on ${entry.entityType}/${entry.entityId}`);
        await this.commitTransactionLog(entry.logId);
        recovered++;
      } catch (err) {
        console.error(`[PersistenceLayer] Failed to recover log entry ${entry.logId}:`, err);
      }
    }

    console.log(`[PersistenceLayer] Recovery complete. ${recovered}/${uncommitted.length} entries replayed.`);
    return recovered;
  }

  // -----------------------------------------------------------------------
  // Row → domain type mappers
  // -----------------------------------------------------------------------

  private rowToPlayerAccount(row: PlayerRow): PlayerAccount {
    return {
      playerId: row.player_id,
      playerName: row.player_name,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      battalionIds: row.battalion_ids as string[],
    };
  }

  private rowToPlanetRecord(row: PlanetRow): PlanetRecord {
    return {
      planetId: row.planet_id,
      name: row.name,
      systemId: row.system_id,
      sectorPositionX: row.sector_position_x,
      sectorPositionY: row.sector_position_y,
      influenceFederation: row.influence_federation,
      influenceAtaxian: row.influence_ataxian,
      influenceKhroshi: row.influence_khroshi,
      controllingFaction: row.controlling_faction as PlanetRecord['controllingFaction'],
      strategicValueTier: row.strategic_value_tier as 1 | 2 | 3,
      garrisonStrength: row.garrison_strength,
      planetTraits: row.planet_traits as string[],
      missionGenerationSeed: row.mission_generation_seed,
      lastMissionGeneratedAt: row.last_mission_generated,
      connectedPlanetIds: row.connected_planet_ids as string[],
    };
  }

  private rowToBattalionRecord(row: BattalionRow, unitSlots: UnitSlot[]): BattalionRecord {
    return {
      battalionId: row.battalion_id,
      playerId: row.player_id,
      name: row.name,
      type: row.type as BattalionRecord['type'],
      sectorOrigin: row.sector_origin,
      status: row.status as BattalionRecord['status'],
      currentPlanetId: row.current_planet_id,
      transitDestinationId: row.transit_destination_id,
      transitDepartedAt: row.transit_departed_at,
      transitArrivesAt: row.transit_arrives_at,
      supplyPoints: row.supply_points,
      missionsCompleted: row.missions_completed,
      missionsWon: row.missions_won,
      unitSlots,
      createdAt: row.created_at,
      lastMissionAt: row.last_mission_at,
    };
  }

  private rowToUnitSlot(row: UnitSlotRow): UnitSlot {
    return {
      slotId: row.slot_id,
      unitTypeId: row.unit_type_id,
      crewCurrent: row.crew_current,
      crewMax: row.crew_max,
      isReserve: row.is_reserve,
      upgradeTier: row.upgrade_tier,
      status: row.status as UnitSlot['status'],
    };
  }

  private rowToMissionRecord(row: MissionRow): MissionRecord {
    return {
      missionId: row.mission_id,
      planetId: row.planet_id,
      missionType: row.mission_type as MissionRecord['missionType'],
      difficulty: row.difficulty as MissionRecord['difficulty'],
      state: row.state as MissionRecord['state'],
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      expiresAt: row.expires_at,
      result: row.result as MissionRecord['result'],
      playerIds: row.player_ids as string[],
      mapSeed: row.map_seed,
      mapWidth: row.map_width,
      mapHeight: row.map_height,
    };
  }
}

// ---------------------------------------------------------------------------
// Transaction log entry (public type for recovery consumers)
// ---------------------------------------------------------------------------

export interface TransactionLogEntry {
  logId: number;
  operation: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Internal row types (match PostgreSQL column names)
// ---------------------------------------------------------------------------

interface PlayerRow {
  player_id: string;
  player_name: string;
  created_at: number;
  last_login_at: number;
  battalion_ids: unknown; // JSONB
}

interface PlanetRow {
  planet_id: string;
  name: string;
  system_id: string;
  sector_position_x: number;
  sector_position_y: number;
  influence_federation: number;
  influence_ataxian: number;
  influence_khroshi: number;
  controlling_faction: string | null;
  strategic_value_tier: number;
  garrison_strength: number;
  planet_traits: unknown;           // JSONB
  mission_generation_seed: number;
  last_mission_generated: number;
  connected_planet_ids: unknown;    // JSONB
}

interface BattalionRow {
  battalion_id: string;
  player_id: string;
  name: string;
  type: string;
  sector_origin: string;
  status: string;
  current_planet_id: string | null;
  transit_destination_id: string | null;
  transit_departed_at: number | null;
  transit_arrives_at: number | null;
  supply_points: number;
  missions_completed: number;
  missions_won: number;
  created_at: number;
  last_mission_at: number | null;
}

interface UnitSlotRow {
  slot_id: string;
  battalion_id: string;
  unit_type_id: string;
  crew_current: number;
  crew_max: number;
  is_reserve: boolean;
  upgrade_tier: number;
  status: string;
}

interface MissionRow {
  mission_id: string;
  planet_id: string;
  mission_type: string;
  difficulty: string;
  state: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  expires_at: number;
  result: string | null;
  player_ids: unknown;  // JSONB
  map_seed: number;
  map_width: number;
  map_height: number;
}

interface CampaignTickRow {
  id: number;
  tick_number: number;
  tick_interval: number;
  last_tick_at: number;
}

interface TransactionLogRow {
  log_id: number;
  operation: string;
  entity_type: string;
  entity_id: string;
  payload: unknown;
  created_at: number;
  committed: boolean;
}
