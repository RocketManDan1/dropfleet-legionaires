# Campaign Persistence Data Model
*Dropfleet Legionaires -- authoritative persistent data specification*
*Last updated: 2026-03-21*

---

## Purpose

This document defines the **canonical data model** for all persistent state in the Dropfleet Legionaires campaign. Every record type, every field, every relationship is specified here. If it is not in this document, it is not persisted.

This is the single source of truth for backend implementation. Other design documents (CAMPAIGN_OVERVIEW.md, BATTALION_CREATION.md, REPLACEMENT_AND_REINFORCEMENT.md, FORCE_ROSTERS.md, FACTIONS.md) define *what happens*. This document defines *what is stored*.

Cross-document enum/timer/phase contracts are centralized in AUTHORITATIVE_CONTRACTS.md.

---

## 1. Player Account Record

One record per human player. Created at first login.

### TypeScript Interface

```typescript
interface PlayerAccount {
  playerId: string;           // UUID v4, immutable after creation
  displayName: string;        // Player-chosen, 3-24 chars, unique
  createdAt: number;          // Unix timestamp ms
  lastLoginAt: number;        // Unix timestamp ms
  totalMissionsPlayed: number;
  totalPlayTimeMs: number;    // Accumulated across all sessions
  activeBattalionId: string | null;  // FK to BattalionRecord, null if none
  retiredBattalionIds: string[];     // Previous battalions (view-only)
}
```

### Design Decisions

- **One active battalion per account.** A player commands one battalion at a time. They can retire it (preserving the record for viewing) and create a new one. This prevents split attention and preserves the weight of attrition -- you cannot hedge your losses across multiple rosters.
- **Auth is a stub for dev.** No passwords, no OAuth. The `playerId` is the auth token. Production auth is out of scope for this spec.
- **Retired battalions are read-only snapshots.** They appear in a "Service Record" screen. They cannot be reactivated.

### SQL Schema

```sql
CREATE TABLE player_accounts (
  player_id       TEXT PRIMARY KEY,           -- UUID v4
  display_name    TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL,           -- Unix ms
  last_login_at   INTEGER NOT NULL,
  total_missions  INTEGER NOT NULL DEFAULT 0,
  total_play_time INTEGER NOT NULL DEFAULT 0, -- ms
  active_battalion_id TEXT,                   -- FK battalions(battalion_id), nullable
  FOREIGN KEY (active_battalion_id) REFERENCES battalions(battalion_id)
);

CREATE INDEX idx_players_display_name ON player_accounts(display_name);
```

---

## 2. Battalion Record

One record per battalion ever created. Persists after retirement or destruction.

### TypeScript Interface

```typescript
type SectorOfOrigin = 'terran' | 'gliese' | 'bernards_star';

type BattalionType =
  | 'armored'
  | 'mechanized'
  | 'motorized'
  | 'support'
  | 'droptroops';

type BattalionStatus =
  | 'available'       // On a planet, can queue into missions
  | 'in_mission'      // Currently deployed in a tactical engagement
  | 'in_transit'      // Moving between star systems
  | 'destroyed'       // Total wipe -- all units lost, battalion retired
  | 'retired';        // Player voluntarily retired this battalion

interface BattalionRecord {
  battalionId: string;              // UUID v4
  ownerId: string;                  // FK to PlayerAccount.playerId
  name: string;                     // Player-chosen, e.g. "Hellraisers"
  callsign: string;                 // Auto-generated type designation, e.g. "1st Armored"
  sectorOfOrigin: SectorOfOrigin;
  battalionType: BattalionType;
  status: BattalionStatus;

  // Location
  currentPlanetId: string | null;   // FK to PlanetState, null if in transit
  transitOriginId: string | null;   // FK to PlanetState, null if not in transit
  transitDestinationId: string | null;
  transitDepartedAt: number | null; // Unix ms, null if not in transit
  transitArrivesAt: number | null;  // Unix ms, null if not in transit

  // Economy
  supplyPoints: number;             // Current SP balance

  // Campaign Stats
  missionsPlayed: number;
  missionsWon: number;
  missionsLost: number;
  missionsDrawn: number;
  totalKills: number;
  totalCasualties: number;          // Units destroyed over lifetime
  totalReplacements: number;        // Units replaced over lifetime
  planetsLiberated: number;
  zeroKiaStreak: number;            // Current consecutive zero-KIA missions

  // Upgrade Progress
  unlockedUpgrades: string[];       // Array of upgrade milestone IDs
  reinforcementSlotsUsed: number;   // How many of max reinforcement slots consumed
  reinforcementSlotsMax: number;    // Typically starts at 0, incremented by milestones

  // Timestamps
  createdAt: number;                // Unix ms
  retiredAt: number | null;         // Unix ms, null if active
  destroyedAt: number | null;       // Unix ms, null if not destroyed
}
```

### SQL Schema

```sql
CREATE TABLE battalions (
  battalion_id     TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL,
  name             TEXT NOT NULL,
  callsign         TEXT NOT NULL,
  sector_of_origin TEXT NOT NULL CHECK (sector_of_origin IN ('terran','gliese','bernards_star')),
  battalion_type   TEXT NOT NULL CHECK (battalion_type IN ('armored','mechanized','motorized','support','droptroops')),
  status           TEXT NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','in_mission','in_transit','destroyed','retired')),

  current_planet_id      TEXT,
  transit_origin_id      TEXT,
  transit_destination_id TEXT,
  transit_departed_at    INTEGER,
  transit_arrives_at     INTEGER,

  supply_points          INTEGER NOT NULL DEFAULT 0,

  missions_played    INTEGER NOT NULL DEFAULT 0,
  missions_won       INTEGER NOT NULL DEFAULT 0,
  missions_lost      INTEGER NOT NULL DEFAULT 0,
  missions_drawn     INTEGER NOT NULL DEFAULT 0,
  total_kills        INTEGER NOT NULL DEFAULT 0,
  total_casualties   INTEGER NOT NULL DEFAULT 0,
  total_replacements INTEGER NOT NULL DEFAULT 0,
  planets_liberated  INTEGER NOT NULL DEFAULT 0,
  zero_kia_streak    INTEGER NOT NULL DEFAULT 0,

  unlocked_upgrades       TEXT NOT NULL DEFAULT '[]',  -- JSON array of milestone IDs
  reinforcement_slots_used INTEGER NOT NULL DEFAULT 0,
  reinforcement_slots_max  INTEGER NOT NULL DEFAULT 0,

  created_at   INTEGER NOT NULL,
  retired_at   INTEGER,
  destroyed_at INTEGER,

  FOREIGN KEY (owner_id) REFERENCES player_accounts(player_id),
  FOREIGN KEY (current_planet_id) REFERENCES planets(planet_id),
  FOREIGN KEY (transit_origin_id) REFERENCES planets(planet_id),
  FOREIGN KEY (transit_destination_id) REFERENCES planets(planet_id)
);

CREATE INDEX idx_battalions_owner ON battalions(owner_id);
CREATE INDEX idx_battalions_planet ON battalions(current_planet_id);
CREATE INDEX idx_battalions_status ON battalions(status);
```

---

## 3. Persistent Unit Record

One record per unit slot in a battalion. Slots are created at battalion creation from FORCE_ROSTERS.md and persist through destruction, replacement, and reinforcement.

### TypeScript Interface

```typescript
type UnitStatus =
  | 'active'               // Deployable
  | 'combat_ineffective'   // Below 50% crew, not deployable until repaired
  | 'destroyed'            // Crew = 0, slot empty until replaced
  | 'reserve';             // Player-flagged, withheld from deployment

interface PersistentUnitRecord {
  unitRecordId: string;         // UUID v4, immutable -- identifies the SLOT
  battalionId: string;          // FK to BattalionRecord
  slotIndex: number;            // Position within the battalion roster (0-based)

  // Organization
  companyDesignation: string;   // "HQ", "A", "B", "C", "FSC", "Scout", "Weapons", etc.
  platoonNumber: number;        // 0 = company-level asset, 1+ = platoon within company
  positionInPlatoon: number;    // Order within platoon (for display)

  // Current unit occupying this slot
  unitTypeId: string;           // References static unit data (e.g. "m1_abrams", "rifle_squad")
  originalUnitTypeId: string;   // What was assigned at battalion creation -- never changes

  // Crew state
  crewCurrent: number;          // Current crew count
  crewMax: number;              // Max crew for current unitTypeId

  // Status
  status: UnitStatus;
  isReserve: boolean;           // Player toggle -- excluded from deployment selection

  // Experience
  missionsDeployed: number;     // How many missions this slot has been deployed in
  killCount: number;            // Lifetime kills for this slot (resets on replacement)

  // Replacement history
  replacementCount: number;     // How many times this slot has been replaced
  lastReplacedAt: number | null; // Unix ms, null if never replaced
  lastReplacedFrom: string | null; // Previous unitTypeId before most recent replacement

  // Equipment modifications (future-proofing for upgrade system)
  appliedUpgrades: string[];    // Milestone-granted modifications, e.g. ["thermal_sight_gen2"]
}
```

### Design Decisions

- **Slots are permanent, units are transient.** The `unitRecordId` identifies a position in the TOE, not the equipment filling it. When a tank is destroyed and replaced with a cheaper model, the slot persists with a new `unitTypeId`. This preserves organizational structure through attrition.
- **`originalUnitTypeId` is immutable.** It records what the slot started as. This enables the "battalion divergence" narrative: "This T60A3 used to be an T1 Abrams before Kepler-4."
- **Kill count resets on replacement.** A new vehicle in the same slot starts at zero. The old kills are preserved in the transaction log.
- **`isReserve` is player-controlled.** It is an OOB screen toggle, independent of `status`. A unit can be `active` and `isReserve = true` (healthy but withheld). A unit cannot be `destroyed` and `isReserve = true` (nonsensical -- auto-cleared on destruction).

### SQL Schema

```sql
CREATE TABLE unit_records (
  unit_record_id     TEXT PRIMARY KEY,
  battalion_id       TEXT NOT NULL,
  slot_index         INTEGER NOT NULL,

  company            TEXT NOT NULL,
  platoon_number     INTEGER NOT NULL DEFAULT 0,
  position_in_platoon INTEGER NOT NULL DEFAULT 0,

  unit_type_id       TEXT NOT NULL,
  original_unit_type_id TEXT NOT NULL,

  crew_current       INTEGER NOT NULL,
  crew_max           INTEGER NOT NULL,

  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','combat_ineffective','destroyed','reserve')),
  is_reserve         INTEGER NOT NULL DEFAULT 0,  -- boolean

  missions_deployed  INTEGER NOT NULL DEFAULT 0,
  kill_count         INTEGER NOT NULL DEFAULT 0,

  replacement_count  INTEGER NOT NULL DEFAULT 0,
  last_replaced_at   INTEGER,
  last_replaced_from TEXT,

  applied_upgrades   TEXT NOT NULL DEFAULT '[]',  -- JSON array

  FOREIGN KEY (battalion_id) REFERENCES battalions(battalion_id)
);

CREATE INDEX idx_units_battalion ON unit_records(battalion_id);
CREATE INDEX idx_units_status ON unit_records(status);
CREATE UNIQUE INDEX idx_units_slot ON unit_records(battalion_id, slot_index);
```

---

## 4. Planet State

One record per planet in the sector. Created at campaign initialization. Never deleted.

### TypeScript Interface

```typescript
type FactionId = 'federation' | 'ataxian' | 'khroshi';

type StrategicValueTier = 1 | 2 | 3;  // 1 = low, 3 = critical (industrial/population centers)

interface PlanetState {
  planetId: string;                  // UUID v4
  name: string;                      // e.g. "Kepler-4", "Gliese-876d"
  systemId: string;                  // Which star system this planet belongs to
  sectorPositionX: number;           // Position on sector map (logical grid, not pixel)
  sectorPositionY: number;

  // Influence (must sum to 100)
  influenceFederation: number;       // 0-100
  influenceAtaxian: number;          // 0-100
  influenceKhroshi: number;          // 0-100
  controllingFaction: FactionId | null;  // Faction with >50%, or null if none

  // Strategic properties
  strategicValueTier: StrategicValueTier;
  garrisonStrength: number;          // Abstract 0-100, affects mission difficulty scaling
  planetTraits: string[];            // e.g. ["industrial", "population_center", "orbital_dock"]

  // Mission generation
  missionGenerationSeed: number;     // Deterministic seed for mission pool generation
  lastMissionGeneratedAt: number;    // Unix ms

  // Transit connections
  connectedPlanetIds: string[];      // Adjacent systems reachable by transit
}
```

### Influence Rules (from CAMPAIGN_OVERVIEW.md)

| Influence Range | State | Mission Availability |
|---|---|---|
| 0% enemy | Secure | No missions — "This planet is secure." All difficulty buttons disabled. |
| 1–50% enemy | Contested | Standard mission pool |
| 51–80% enemy | Falling | High-priority missions, increased enemy reinforcement rate |
| 81–99% enemy | Critical | Emergency missions only, max enemy density |
| 100% enemy | Fallen | Planet locked, spreads influence to neighbors |

Influence is per-enemy-faction. A planet can be simultaneously 30% Ataxian and 25% Khroshi (with 45% Federation). The `controllingFaction` is whichever single faction exceeds 50%. If none do, `controllingFaction` is null (contested).

**Redistribution rule:** The `CHECK (sum = 100)` constraint is always satisfied by routing freed influence to the Federation. When a mission reduces enemy influence, `influence_federation` increases by the same amount. No other faction receives the freed points. See POST_MISSION_RESOLUTION.md §Influence Redistribution Rule for the implementation.

### SQL Schema

```sql
CREATE TABLE planets (
  planet_id          TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  system_id          TEXT NOT NULL,
  sector_position_x  REAL NOT NULL,
  sector_position_y  REAL NOT NULL,

  influence_federation INTEGER NOT NULL DEFAULT 100,
  influence_ataxian    INTEGER NOT NULL DEFAULT 0,
  influence_khroshi    INTEGER NOT NULL DEFAULT 0,
  controlling_faction  TEXT CHECK (controlling_faction IN ('federation','ataxian','khroshi')),

  strategic_value_tier INTEGER NOT NULL DEFAULT 1 CHECK (strategic_value_tier IN (1,2,3)),
  garrison_strength    INTEGER NOT NULL DEFAULT 0,
  planet_traits        TEXT NOT NULL DEFAULT '[]',  -- JSON array

  mission_generation_seed   INTEGER NOT NULL,
  last_mission_generated_at INTEGER NOT NULL,

  connected_planet_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of planet_ids

  CHECK (influence_federation + influence_ataxian + influence_khroshi = 100)
);

CREATE INDEX idx_planets_system ON planets(system_id);
CREATE INDEX idx_planets_controlling ON planets(controlling_faction);
```

---

## 5. Mission Instance Record

One record per mission generated. Created when the mission spawns on a planet. Closed after AAR processing.

### TypeScript Interface

```typescript
type MissionType =
  | 'defend'
  | 'seize'
  | 'raid'
  | 'patrol'
  | 'rescue'
  | 'breakthrough'
  | 'evacuation'
  | 'hive_clear'
  | 'fortification_assault'
  | 'logistics';

type DifficultyTier = 'easy' | 'medium' | 'hard';

type MissionState =
  | 'created'       // Mission record exists, awaiting deployment start
  | 'deployment'    // Players placing units on the map
  | 'live'          // Tactical engagement in progress
  | 'extraction'    // Mission timer expired or objectives met, extraction phase
  | 'aar'           // After Action Report screen
  | 'closed';       // Fully resolved, all rewards distributed

type MissionResult =
  | 'victory'
  | 'defeat'
  | 'draw'
  | 'abandoned'     // All players disconnected or quit
  | 'expired';      // No players joined before mission expired from planet

interface MissionParticipant {
  playerId: string;
  battalionId: string;
  joinedAt: number;                   // Unix ms -- when they entered the mission
  deployedUnitIds: string[];          // unitRecordIds deployed into this mission
  unitsDestroyed: number;             // Count of friendly units destroyed
  unitsDamaged: number;               // Count of friendly units that took crew losses
  killsScored: number;
  spEarned: number;                   // SP awarded to this participant
  influenceContribution: number;      // Portion of influence change attributed
}

interface MissionInstance {
  missionId: string;                  // UUID v4
  planetId: string;                   // FK to PlanetState
  missionType: MissionType;
  enemyFaction: FactionId;            // Which enemy faction this mission is against
  difficulty: DifficultyTier;
  state: MissionState;

  participants: MissionParticipant[];

  // Timing
  createdAt: number;                  // Unix ms -- when mission spawned on planet
  expiresAt: number;                  // Unix ms -- mission removed if no one joins by this time
  startedAt: number | null;           // Unix ms -- when 'live' state began
  endedAt: number | null;             // Unix ms -- when 'extraction' completed

  // Results (populated after mission ends)
  result: MissionResult | null;
  influenceChangeFederation: number;  // Delta applied to planet influence
  influenceChangeEnemy: number;       // Delta applied to enemy faction influence

  // Map reference
  mapSeed: number;                    // Procedural map generation seed
  mapSizeX: number;                   // Logical deployment/path grid columns
  mapSizeY: number;                   // Logical deployment/path grid rows
}
```

### SQL Schema

```sql
CREATE TABLE missions (
  mission_id       TEXT PRIMARY KEY,
  planet_id        TEXT NOT NULL,
  mission_type     TEXT NOT NULL CHECK (mission_type IN (
    'defend','seize','raid','patrol','rescue','breakthrough',
    'evacuation','hive_clear','fortification_assault','logistics'
  )),
  enemy_faction    TEXT NOT NULL CHECK (enemy_faction IN ('ataxian','khroshi')),
  difficulty_tier  TEXT NOT NULL CHECK (difficulty_tier IN ('easy','medium','hard')),
  state            TEXT NOT NULL DEFAULT 'created' CHECK (state IN (
    'created','deployment','live','extraction','aar','closed'
  )),

  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  started_at       INTEGER,
  ended_at         INTEGER,

  result           TEXT CHECK (result IN ('victory','defeat','draw','abandoned','expired')),
  influence_change_federation INTEGER NOT NULL DEFAULT 0,
  influence_change_enemy      INTEGER NOT NULL DEFAULT 0,

  map_seed         INTEGER NOT NULL,
  map_size_x       INTEGER NOT NULL,
  map_size_y       INTEGER NOT NULL,

  FOREIGN KEY (planet_id) REFERENCES planets(planet_id)
);

CREATE TABLE mission_participants (
  mission_id       TEXT NOT NULL,
  player_id        TEXT NOT NULL,
  battalion_id     TEXT NOT NULL,
  joined_at        INTEGER NOT NULL,
  deployed_unit_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array
  units_destroyed  INTEGER NOT NULL DEFAULT 0,
  units_damaged    INTEGER NOT NULL DEFAULT 0,
  kills_scored     INTEGER NOT NULL DEFAULT 0,
  sp_earned        INTEGER NOT NULL DEFAULT 0,
  influence_contribution INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (mission_id, player_id),
  FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
  FOREIGN KEY (player_id) REFERENCES player_accounts(player_id),
  FOREIGN KEY (battalion_id) REFERENCES battalions(battalion_id)
);

CREATE INDEX idx_missions_planet ON missions(planet_id);
CREATE INDEX idx_missions_state ON missions(state);
CREATE INDEX idx_missions_created ON missions(created_at);
CREATE INDEX idx_participants_player ON mission_participants(player_id);
```

---

## 6. Campaign State (Global)

One record per campaign. In the initial release there is exactly one campaign -- the shared war.

### TypeScript Interface

```typescript
interface FactionAIState {
  factionId: FactionId;
  currentStrategy: 'expand' | 'consolidate' | 'surge';  // High-level AI posture
  surgeTargetPlanetId: string | null;   // Planet being surged (Ataxian breakthrough)
  fortifyPlanetIds: string[];           // Planets being fortified (Khroshi entrenchment)
  expansionPressure: number;            // 0-100, how aggressively the faction is pushing
  lastStrategyChangeAt: number;         // Unix ms
}

interface CampaignState {
  campaignId: string;                   // UUID v4
  name: string;                         // e.g. "Gliese Sector Campaign"
  createdAt: number;                    // Unix ms
  currentTick: number;                  // Monotonically increasing, +1 every 30 real minutes
  lastTickAt: number;                   // Unix ms -- when the last tick was processed
  tickIntervalMs: number;              // 1_800_000 (30 minutes), configurable for testing

  factionAI: FactionAIState[];          // One entry per enemy faction

  // Campaign-level counters
  totalMissionsGenerated: number;
  totalMissionsCompleted: number;
  totalPlanetsLiberated: number;
  totalPlanetsFallen: number;
}
```

### SQL Schema

```sql
CREATE TABLE campaigns (
  campaign_id       TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  current_tick      INTEGER NOT NULL DEFAULT 0,
  last_tick_at      INTEGER NOT NULL,
  tick_interval_ms  INTEGER NOT NULL DEFAULT 1800000,

  total_missions_generated INTEGER NOT NULL DEFAULT 0,
  total_missions_completed INTEGER NOT NULL DEFAULT 0,
  total_planets_liberated  INTEGER NOT NULL DEFAULT 0,
  total_planets_fallen     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE faction_ai_states (
  campaign_id       TEXT NOT NULL,
  faction_id        TEXT NOT NULL CHECK (faction_id IN ('ataxian','khroshi')),
  current_strategy  TEXT NOT NULL DEFAULT 'expand'
                    CHECK (current_strategy IN ('expand','consolidate','surge')),
  surge_target_planet_id TEXT,
  fortify_planet_ids     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  expansion_pressure     INTEGER NOT NULL DEFAULT 50,
  last_strategy_change_at INTEGER NOT NULL,

  PRIMARY KEY (campaign_id, faction_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id),
  FOREIGN KEY (surge_target_planet_id) REFERENCES planets(planet_id)
);
```

---

## 7. Transaction Log

Append-only ledger of every SP movement. Never updated, never deleted. This is the audit trail.

### TypeScript Interface

```typescript
type TransactionType =
  | 'mission_reward'              // SP earned from completing a mission
  | 'bonus_zero_kia'              // +100 SP bonus for zero friendly KIA
  | 'bonus_secondary_objective'   // +150 SP bonus for secondary objective
  | 'bonus_planet_liberated'      // +500 SP one-time bonus
  | 'daily_login'                 // +50 SP passive income
  | 'replacement_purchase'        // SP spent replacing a destroyed unit
  | 'repair_full'                 // SP spent on full repair (50% unit cost)
  | 'repair_partial'              // SP spent on partial repair (25% unit cost)
  | 'reinforcement_purchase'      // SP spent adding a new unit (150% cost)
  | 'upgrade_purchase';           // SP spent on upgraded replacement

interface TransactionRecord {
  transactionId: string;          // UUID v4
  battalionId: string;            // FK to BattalionRecord
  playerId: string;               // FK to PlayerAccount (denormalized for query speed)
  type: TransactionType;
  amount: number;                 // Positive = earned, negative = spent
  balanceAfter: number;           // SP balance after this transaction
  missionId: string | null;       // FK to MissionInstance, null for non-mission transactions
  unitRecordId: string | null;    // FK to PersistentUnitRecord, null for earn transactions
  unitTypeId: string | null;      // What was purchased/replaced (denormalized)
  note: string | null;            // Human-readable context, e.g. "Replaced T1 Abrams with T60A3"
  createdAt: number;              // Unix ms
}
```

### Transaction Catalog

| Type | Amount Sign | Typical Range | Trigger |
|---|---|---|---|
| `mission_reward` | + | 200-500 (success), 50-100 (failure) | Mission state -> `aar` |
| `bonus_zero_kia` | + | 100 | Mission ends with 0 friendly destroyed |
| `bonus_secondary_objective` | + | 150 | Secondary objective completed |
| `bonus_planet_liberated` | + | 500 | Planet influence reaches 0% enemy |
| `daily_login` | + | 50 | First login of the calendar day |
| `replacement_purchase` | - | 11-521 | Player buys replacement on Replacement Screen |
| `repair_full` | - | 6-261 | Player pays 50% unit cost for full crew restore |
| `repair_partial` | - | 3-130 | Player pays 25% unit cost for partial crew restore |
| `reinforcement_purchase` | - | 17-782 | Player buys new unit at 150% cost |
| `upgrade_purchase` | - | 154-786 | Player buys upgraded variant |

### SQL Schema

```sql
CREATE TABLE transactions (
  transaction_id TEXT PRIMARY KEY,
  battalion_id   TEXT NOT NULL,
  player_id      TEXT NOT NULL,
  type           TEXT NOT NULL,
  amount         INTEGER NOT NULL,      -- positive = earn, negative = spend
  balance_after  INTEGER NOT NULL,
  mission_id     TEXT,
  unit_record_id TEXT,
  unit_type_id   TEXT,
  note           TEXT,
  created_at     INTEGER NOT NULL,

  FOREIGN KEY (battalion_id) REFERENCES battalions(battalion_id),
  FOREIGN KEY (player_id) REFERENCES player_accounts(player_id),
  FOREIGN KEY (mission_id) REFERENCES missions(mission_id),
  FOREIGN KEY (unit_record_id) REFERENCES unit_records(unit_record_id)
);

CREATE INDEX idx_transactions_battalion ON transactions(battalion_id);
CREATE INDEX idx_transactions_player ON transactions(player_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_created ON transactions(created_at);
-- Composite index for "show me all transactions for this battalion in order"
CREATE INDEX idx_transactions_battalion_time ON transactions(battalion_id, created_at);
```

---

## 8. Campaign Event Log

Append-only log of significant campaign-level events. Used for the campaign timeline display and analytics.

### TypeScript Interface

```typescript
type CampaignEventType =
  | 'planet_liberated'           // Enemy influence dropped to 0%
  | 'planet_fallen'              // Enemy influence reached 100%
  | 'planet_contested'           // Planet moved from Secure to Contested
  | 'faction_surge_started'      // Ataxian Hive began a breakthrough surge
  | 'faction_surge_broken'       // Players stopped a surge
  | 'battalion_created'          // New battalion entered the war
  | 'battalion_destroyed'        // Battalion reached total wipe
  | 'battalion_retired'          // Player retired their battalion
  | 'mission_completed'          // Any mission resolved
  | 'upgrade_unlocked';          // Campaign milestone reached

interface CampaignEvent {
  eventId: string;               // UUID v4
  campaignId: string;            // FK to CampaignState
  type: CampaignEventType;
  tick: number;                  // Campaign tick when this occurred
  timestamp: number;             // Unix ms
  planetId: string | null;       // Relevant planet, if any
  playerId: string | null;       // Relevant player, if any
  battalionId: string | null;    // Relevant battalion, if any
  missionId: string | null;      // Relevant mission, if any
  factionId: FactionId | null;   // Relevant faction, if any
  details: Record<string, unknown>;  // Event-specific payload (JSON)
}
```

### SQL Schema

```sql
CREATE TABLE campaign_events (
  event_id     TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  type         TEXT NOT NULL,
  tick         INTEGER NOT NULL,
  timestamp    INTEGER NOT NULL,
  planet_id    TEXT,
  player_id    TEXT,
  battalion_id TEXT,
  mission_id   TEXT,
  faction_id   TEXT,
  details      TEXT NOT NULL DEFAULT '{}',  -- JSON

  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE INDEX idx_events_campaign_tick ON campaign_events(campaign_id, tick);
CREATE INDEX idx_events_type ON campaign_events(type);
CREATE INDEX idx_events_planet ON campaign_events(planet_id);
```

---

## 9. Persistence Strategy

### Development: SQLite

- **Why:** Zero infrastructure. Single file. Embeds in the game server process. WAL mode for concurrent reads during gameplay.
- **File:** `campaign.db` in the server data directory.
- **WAL mode enabled at startup:** `PRAGMA journal_mode=WAL;`
- **Busy timeout:** `PRAGMA busy_timeout=5000;` (5 seconds, prevents lock errors during tick processing)

### Production: PostgreSQL

- **Why:** Concurrent writes from multiple server processes, proper transaction isolation, battle-tested replication.
- **Migration path:** The schema above uses SQLite-compatible SQL intentionally. The TypeScript data layer abstracts the backend -- swap the driver, keep the queries.

### ORM Recommendation: Drizzle

- **Why:** Type-safe schema definition, zero runtime overhead, explicit queries (no magic). Drizzle supports both SQLite (via `better-sqlite3`) and PostgreSQL (via `pg`) with the same schema definition syntax.
- **Not Prisma:** Prisma's query engine is a separate binary process. Unnecessary complexity for this project. Drizzle compiles to direct SQL.

### Schema Migrations

- **Dev:** Drizzle Kit `push` for rapid iteration. No migration files during prototyping.
- **Production:** Drizzle Kit `generate` + `migrate` for versioned, reviewable migration SQL files.
- **Rule:** Never modify a column type in production. Add new columns, deprecate old ones, backfill, then drop.

---

## 10. Saved vs. Recomputed Data

Not everything in the data model is written to the database on every change. The distinction between saved and recomputed state is critical for performance and consistency.

### Saved to Database (Source of Truth)

| Data | Written When | Why Saved |
|---|---|---|
| Battalion roster (all unit records) | After mission AAR, after replacement screen | Permanent casualties are the core mechanic |
| SP balance | After every transaction | Currency must be authoritative |
| Planet influence values | Every campaign tick, after mission results | Drives mission generation and faction AI |
| Mission results | On mission close | Historical record, affects campaign stats |
| Transaction log | On every SP change | Audit trail, enables rollback |
| Campaign event log | On each event | Campaign timeline display |
| Battalion location + transit state | On movement order, on arrival | Players need to see where everyone is |
| Faction AI state | Every campaign tick | Expensive to recompute, changes slowly |
| Unlock progress | On milestone achievement | Rare writes, must persist |

### Recomputed at Runtime (Never Saved)

| Data | Recomputed When | Why Not Saved |
|---|---|---|
| Available missions on a planet | When player arrives or views planet | Generated from influence + seed + garrison; stale missions are pruned |
| Transit ETA countdown | Every client render frame | Derived from `transitDepartedAt` + fixed travel time |
| Unit combat stats (attack, defense, speed) | On mission load | Computed from static unit type data + persistent crew + upgrades |
| Influence state labels ("Secure", "Contested", etc.) | On any influence read | Trivially derived from influence numbers |
| Sector map visualization (colors, zones) | On client render | Derived from planet influence and controlling faction |
| Battalion total SP value | On OOB screen display | Sum of current unit costs, computed from roster |
| Deployment readiness | On mission queue | Derived from unit status flags |

---

## 11. Offline Progression

The campaign continues while players are offline. The server ticks forward regardless of player presence.

### What Happens Each Tick (30 Real Minutes)

```
FOR each planet:
  IF no Federation players present AND total enemy influence < 100%:

    // Determine which faction grows this tick.
    // If only one enemy faction has presence: that faction grows.
    // If both Ataxian and Khroshi have influence > 0%:
    //   They alternate each campaign tick — Ataxian on odd ticks, Khroshi on even ticks.
    //   Each faction competes for territory; only the active faction's influence increases.
    //   The other holds steady (neither grows nor shrinks from this rule alone).
    //   Both factions remain bound by the redistribution rule:
    //   gained influence comes from Federation's share (influence_federation decreases).

    growing_faction = determine_growing_faction(planet, campaign_tick_number)
    Increase growing_faction influence by tick_rate (scaled by adjacent fallen planets)
    Decrease influence_federation by same amount

  IF enemy influence reaches 100%:
    Mark planet as Fallen
    Log campaign event: planet_fallen
    Begin spreading influence to connected planets

FOR each battalion in transit:
  IF current_time >= transit_arrives_at:
    Set current_planet_id = transit_destination_id
    Clear transit fields
    Set status = 'available'
    Log campaign event (if significant)

FOR each unstarted mission:
  IF current_time >= expires_at AND state = 'created':
    Set state = 'closed', result = 'expired'
    Remove from planet's active mission list

Run faction AI strategy evaluation:
  Ataxian: evaluate breakthrough targets
  Khroshi: evaluate fortification priorities
  Update expansion_pressure based on current holdings
```

### Multi-Faction Offline Growth Rule

When both Ataxian and Khroshi influence are present on a planet (both > 0%), the factions compete for the Federation's remaining share. They alternate each campaign tick:

```typescript
function determineGrowingFaction(planet: PlanetRecord, campaignTickNumber: number): FactionId | null {
  const hasAtaxian  = planet.influence_ataxian  > 0;
  const hasKhroshi  = planet.influence_khroshi  > 0;

  if (!hasAtaxian && !hasKhroshi) return null;  // no enemy present
  if ( hasAtaxian && !hasKhroshi) return 'ataxian';
  if (!hasAtaxian &&  hasKhroshi) return 'khroshi';

  // Both factions present: alternate by tick parity
  return campaignTickNumber % 2 === 1 ? 'ataxian' : 'khroshi';
}
```

**Design intent:** The two enemy factions are not allies. They compete for the same space. When both are on the same planet, neither is making steady progress — they're splitting their pressure against the Federation. A planet contested between all three factions falls more slowly than one being pushed by a single enemy.

### What Does NOT Happen Offline

- **No auto-deployment.** A player's battalion stays where it was. If the planet falls while they are offline, the battalion is still there when they log back in -- they just face a 100% enemy influence planet.
- **No auto-repair.** Repair and replacement only happen on the Replacement Screen, which requires player interaction.
- **No SP decay.** Supply points do not expire or degrade.
- **No forced retreat.** Even on a Fallen planet, the battalion does not auto-retreat. The player must issue a transit order.

### Catch-Up on Login

When a player logs in after being offline:

1. Server calculates all ticks that occurred since `lastLoginAt`
2. Player sees the current state of the sector map (already computed by tick processing)
3. If their battalion arrived at a destination during offline, they see it already docked
4. Daily login SP bonus (50 SP) is awarded if 24+ hours have passed since last login
5. `lastLoginAt` is updated

---

## 12. Data Access Patterns

### Query Frequency Table

| Query | Frequency | Path | Index Used |
|---|---|---|---|
| Get battalion by owner | Every login, every page load | Hot | `idx_battalions_owner` |
| Get all units for battalion | Every OOB screen, every mission load | Hot | `idx_units_battalion` |
| Get planet state | Every sector map render, every tick | Hot | PK |
| Get active missions for planet | When player views planet, when joining | Warm | `idx_missions_planet` + `idx_missions_state` |
| Get mission participants | During live mission, on AAR | Warm | PK (composite) |
| Write unit state after mission | Once per mission per player | Cold | `idx_units_battalion` |
| Write transaction | On every SP change | Cold | PK (append-only) |
| Get transaction history | On SP audit screen | Cold | `idx_transactions_battalion_time` |
| Get campaign events | On campaign timeline view | Cold | `idx_events_campaign_tick` |
| Tick: update all planet influence | Every 30 minutes | Batch | Full table scan (small table) |
| Tick: process all in-transit battalions | Every 30 minutes | Batch | `idx_battalions_status` |

### Read vs. Write Ratio

| Table | Read : Write | Notes |
|---|---|---|
| `player_accounts` | 100:1 | Written on login (update timestamp), read constantly |
| `battalions` | 50:1 | Written after missions and transit changes, read on every screen |
| `unit_records` | 20:1 | Written after missions (casualties) and replacement, read on OOB |
| `planets` | 100:1 | Written on ticks (every 30min), read on every map render |
| `missions` | 5:1 | Written on state transitions, read during gameplay |
| `mission_participants` | 2:1 | Written during and after mission, read for AAR |
| `transactions` | 1:0 | Write-only in normal operation; read only for auditing |
| `campaign_events` | 1:5 | Write-heavy (events logged often); read on timeline view |

### Hot Path: Live Mission State

**Mission state during gameplay is NOT read from the database.**

During a live tactical engagement, the authoritative game state lives in server memory. The database is not queried or written during combat. The flow is:

```
Mission starts:
  1. Read battalion roster from DB -> load into memory
  2. Read unit type stats from static data files -> compute combat stats
  3. All gameplay state (positions, health, suppression, orders) in memory

During mission:
  4. Zero DB queries. All state changes are in-memory.

Mission ends:
  5. Compute casualties, kills, results
  6. Write updated unit_records to DB (batch)
  7. Write mission result to DB
  8. Write transactions to DB (batch)
  9. Write planet influence change to DB
  10. Write campaign events to DB
```

This means a server crash during a mission loses that mission's progress. This is acceptable -- the mission is simply treated as abandoned. Battalion state in the DB is the pre-mission snapshot and remains consistent.

### Cold Path: Post-Mission Writes

All post-mission writes happen in a single database transaction:

```sql
BEGIN TRANSACTION;
  -- Update each unit's crew, status, kills
  UPDATE unit_records SET crew_current = ?, status = ?, kill_count = kill_count + ? WHERE unit_record_id = ?;
  -- (repeated for each unit)

  -- Update battalion stats
  UPDATE battalions SET missions_played = missions_played + 1, missions_won = missions_won + ?, ... WHERE battalion_id = ?;

  -- Insert SP transaction(s)
  INSERT INTO transactions (...) VALUES (...);
  -- Update SP balance
  UPDATE battalions SET supply_points = ? WHERE battalion_id = ?;

  -- Update mission record
  UPDATE missions SET state = 'closed', result = ?, ended_at = ?, ... WHERE mission_id = ?;

  -- Update planet influence
  UPDATE planets SET influence_federation = ?, influence_ataxian = ?, influence_khroshi = ? WHERE planet_id = ?;

  -- Insert campaign events
  INSERT INTO campaign_events (...) VALUES (...);
COMMIT;
```

If any step fails, the entire transaction rolls back. The mission is treated as if it never happened. This is the crash recovery strategy.

### Backup Strategy

- **Dev (SQLite):** WAL mode + periodic `.backup` command to a timestamped file every hour. Retain 24 hours of backups.
- **Production (PostgreSQL):** WAL archiving + pg_basebackup daily. Point-in-time recovery enabled.
- **Rule:** The transaction log is the ultimate source of truth for SP. If the `battalions.supply_points` column ever disagrees with the sum of transactions, the transaction log wins. A reconciliation job runs daily.

---

## 13. Entity Relationship Summary

```
PlayerAccount
  |-- 1:1 (active) --> BattalionRecord
  |-- 1:N (retired) --> BattalionRecord
  |-- 1:N --> MissionParticipant
  |-- 1:N --> TransactionRecord

BattalionRecord
  |-- 1:N --> PersistentUnitRecord
  |-- 1:N --> TransactionRecord
  |-- 1:N --> MissionParticipant
  |-- N:1 --> PlanetState (current location)

PlanetState
  |-- 1:N --> MissionInstance
  |-- N:N --> PlanetState (transit connections)

MissionInstance
  |-- 1:N --> MissionParticipant
  |-- N:1 --> PlanetState

CampaignState
  |-- 1:N --> FactionAIState
  |-- 1:N --> CampaignEvent
  |-- (owns all PlanetStates implicitly)
```

---

*This document is the authoritative persistence specification. All backend implementation must conform to these schemas. Changes to this document require updating any dependent implementations.*

*Related documents: CAMPAIGN_OVERVIEW.md, BATTALION_CREATION.md, REPLACEMENT_AND_REINFORCEMENT.md, FORCE_ROSTERS.md, FACTIONS.md*
