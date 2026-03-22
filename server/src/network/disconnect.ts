// ============================================================================
// DISCONNECT MANAGER — Grace-period handling for dropped connections
// Milestone 4: Multiplayer
// Source: NETWORK_PROTOCOL.md, MISSION_LIFECYCLE.md, AUTHORITATIVE_CONTRACTS.md
// ============================================================================

import type {
  MissionState,
  PlayerMissionState,
  UnitInstance,
} from '@legionaires/shared';

import {
  DISCONNECT_GRACE_TICKS,
  TICKS_PER_SEC,
} from '@legionaires/shared/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tracks a single disconnected player's grace period. */
export interface GraceEntry {
  playerId: string;
  missionId: string;
  /** Server tick when the disconnect was detected */
  disconnectedAtTick: number;
  /** Server tick when the grace period expires */
  expiresAtTick: number;
  /** IDs of the player's units that were frozen + made invincible */
  frozenUnitIds: string[];
  /** Whether the player successfully reconnected before expiry */
  reconnected: boolean;
}

/** Outcome of a grace-period expiry for reporting to other systems. */
export interface GraceExpiryResult {
  playerId: string;
  missionId: string;
  /** Unit IDs that were removed (NOT counted as KIA casualties) */
  removedUnitIds: string[];
  /** True if all players in the mission are now disconnected → DEFEAT */
  allPlayersDisconnected: boolean;
}

/**
 * Callback interface so the DisconnectManager can notify other systems
 * without creating circular dependencies.
 */
export interface DisconnectCallbacks {
  /** Called when a player's units should be frozen + made invincible. */
  freezePlayerUnits(missionId: string, unitIds: string[]): void;

  /** Called when a player reconnects and their units should be unfrozen. */
  unfreezePlayerUnits(missionId: string, unitIds: string[]): void;

  /**
   * Called when grace expires — remove units from the battlefield.
   * These units are NOT counted as combat casualties (they "withdrew").
   */
  removePlayerUnits(missionId: string, unitIds: string[]): void;

  /**
   * Called when ALL players in a mission have disconnected.
   * The mission should immediately end as a DEFEAT.
   */
  triggerMissionDefeat(missionId: string, reason: string): void;

  /** Notify connected players that someone disconnected/reconnected. */
  broadcastPlayerStatus(missionId: string, playerId: string, isConnected: boolean): void;
}

// ---------------------------------------------------------------------------
// DisconnectManager
// ---------------------------------------------------------------------------

/**
 * Handles the full lifecycle of player disconnections during a mission:
 *
 * 1. **On disconnect**: Start a 5-minute (6000 tick) grace timer. Freeze all
 *    of the player's units (they stop moving, stop firing, become invincible).
 *
 * 2. **On reconnect** (within grace): Cancel the timer, unfreeze units,
 *    restore full control to the player. No penalty.
 *
 * 3. **On grace expiry**: Remove all of the player's units from the
 *    battlefield. These are NOT counted as combat casualties — the battalion
 *    is treated as having withdrawn. The player loses mission rewards.
 *
 * 4. **All-disconnect rule**: If every player in the mission is simultaneously
 *    disconnected (all in grace or expired), the mission immediately ends
 *    as a DEFEAT. No influence change, minimal SP.
 *
 * This class is called once per server tick from the game loop.
 */
export class DisconnectManager {
  /** playerId → GraceEntry for all currently-disconnected players. */
  private graceEntries: Map<string, GraceEntry> = new Map();

  /** External callbacks for freezing/unfreezing/removing units. */
  private callbacks: DisconnectCallbacks;

  constructor(callbacks: DisconnectCallbacks) {
    this.callbacks = callbacks;
  }

  // -----------------------------------------------------------------------
  // Disconnect detected
  // -----------------------------------------------------------------------

  /**
   * Called when a player's WebSocket connection drops (or they send
   * DISCONNECT_GRACEFUL). Starts the grace period.
   *
   * @param playerId   - The disconnected player.
   * @param missionId  - The mission they were in.
   * @param currentTick - Current server tick.
   * @param playerUnitIds - All unit instanceIds owned by this player.
   */
  onPlayerDisconnect(
    playerId: string,
    missionId: string,
    currentTick: number,
    playerUnitIds: string[],
  ): void {
    // If already tracking this player (double-disconnect), ignore
    if (this.graceEntries.has(playerId)) return;

    const entry: GraceEntry = {
      playerId,
      missionId,
      disconnectedAtTick: currentTick,
      expiresAtTick: currentTick + DISCONNECT_GRACE_TICKS, // 6000 ticks = 5 min
      frozenUnitIds: [...playerUnitIds],
      reconnected: false,
    };

    this.graceEntries.set(playerId, entry);

    // Freeze units: stop movement, stop firing, apply invincibility
    this.callbacks.freezePlayerUnits(missionId, playerUnitIds);

    // Notify remaining players
    this.callbacks.broadcastPlayerStatus(missionId, playerId, false);

    // Check all-disconnect condition immediately
    // (The tick loop will also check this, but we want instant reaction)
  }

  // -----------------------------------------------------------------------
  // Reconnection
  // -----------------------------------------------------------------------

  /**
   * Called when a previously-disconnected player re-establishes their
   * WebSocket connection and re-authenticates.
   *
   * @param playerId - The reconnecting player.
   * @returns True if the player was in grace and successfully reconnected.
   *          False if there was no grace entry (already expired or never disconnected).
   */
  onPlayerReconnect(playerId: string): boolean {
    const entry = this.graceEntries.get(playerId);
    if (!entry) return false;

    entry.reconnected = true;

    // Unfreeze their units (restore movement, fire control, remove invincibility)
    this.callbacks.unfreezePlayerUnits(entry.missionId, entry.frozenUnitIds);

    // Notify remaining players
    this.callbacks.broadcastPlayerStatus(entry.missionId, playerId, true);

    // Clean up the grace entry
    this.graceEntries.delete(playerId);

    return true;
  }

  // -----------------------------------------------------------------------
  // Tick processing (called every server tick from the game loop)
  // -----------------------------------------------------------------------

  /**
   * Process all active grace periods. Called once per tick from the main
   * game loop (Phase 0 or similar early phase).
   *
   * @param currentTick - The current server tick number.
   * @param missionPlayerCounts - Map of missionId → total player count
   *        (to check the all-disconnect condition).
   * @returns Array of expiry results for any players whose grace just ended.
   */
  tick(
    currentTick: number,
    missionPlayerCounts: Map<string, number>,
  ): GraceExpiryResult[] {
    const results: GraceExpiryResult[] = [];

    for (const [playerId, entry] of this.graceEntries) {
      // Skip already-reconnected entries (shouldn't exist, but be safe)
      if (entry.reconnected) {
        this.graceEntries.delete(playerId);
        continue;
      }

      // Check if grace period has expired
      if (currentTick >= entry.expiresAtTick) {
        // Remove the player's units from the battlefield
        this.callbacks.removePlayerUnits(entry.missionId, entry.frozenUnitIds);

        // Check if all players in this mission are now disconnected
        const allDisconnected = this.areAllPlayersDisconnected(
          entry.missionId,
          missionPlayerCounts,
        );

        results.push({
          playerId,
          missionId: entry.missionId,
          removedUnitIds: entry.frozenUnitIds,
          allPlayersDisconnected: allDisconnected,
        });

        // If all players are gone, trigger immediate DEFEAT
        if (allDisconnected) {
          this.callbacks.triggerMissionDefeat(
            entry.missionId,
            'All players disconnected — mission lost',
          );
        }

        this.graceEntries.delete(playerId);
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Check whether a player is currently in a grace period.
   */
  isInGracePeriod(playerId: string): boolean {
    return this.graceEntries.has(playerId);
  }

  /**
   * Get the remaining grace time in seconds for a disconnected player.
   * Returns 0 if the player is not in grace.
   */
  getRemainingGraceSec(playerId: string, currentTick: number): number {
    const entry = this.graceEntries.get(playerId);
    if (!entry) return 0;
    const remainingTicks = Math.max(0, entry.expiresAtTick - currentTick);
    return remainingTicks / TICKS_PER_SEC;
  }

  /**
   * Get all currently-disconnected player IDs for a given mission.
   */
  getDisconnectedPlayers(missionId: string): string[] {
    const result: string[] = [];
    for (const [playerId, entry] of this.graceEntries) {
      if (entry.missionId === missionId) {
        result.push(playerId);
      }
    }
    return result;
  }

  /**
   * Clean up all grace entries for a mission (called when mission ends).
   */
  clearMission(missionId: string): void {
    for (const [playerId, entry] of this.graceEntries) {
      if (entry.missionId === missionId) {
        this.graceEntries.delete(playerId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Check if ALL players in a mission are currently disconnected.
   * This triggers the all-disconnect → DEFEAT rule.
   */
  private areAllPlayersDisconnected(
    missionId: string,
    missionPlayerCounts: Map<string, number>,
  ): boolean {
    const totalPlayers = missionPlayerCounts.get(missionId) ?? 0;
    if (totalPlayers === 0) return true;

    let disconnectedCount = 0;
    for (const entry of this.graceEntries.values()) {
      if (entry.missionId === missionId) {
        disconnectedCount++;
      }
    }

    return disconnectedCount >= totalPlayers;
  }
}
