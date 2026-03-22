// ============================================================================
// AUTH MANAGER — Token-based authentication and session management
// Milestone 4: Multiplayer
// Source: NETWORK_PROTOCOL.md, LOBBY_AND_MATCHMAKING.md
// ============================================================================

import type {
  PlayerAccount,
} from '@legionaires/shared';

// ---------------------------------------------------------------------------
// Session: an authenticated player's active server connection
// ---------------------------------------------------------------------------

export interface AuthSession {
  /** Opaque auth token provided by the client */
  token: string;
  /** Resolved player ID from the database */
  playerId: string;
  /** Player display name */
  playerName: string;
  /** Unix ms timestamp when session was created */
  createdAt: number;
  /** Unix ms timestamp of last heartbeat (PING/message) */
  lastSeenAt: number;
  /** If the player is currently inside a mission, its ID; otherwise null */
  activeMissionId: string | null;
}

// ---------------------------------------------------------------------------
// Token verification result (returned by the verify callback)
// ---------------------------------------------------------------------------

export interface TokenVerifyResult {
  valid: boolean;
  playerId?: string;
  playerName?: string;
  error?: string;
}

/**
 * Callback type that the AuthManager uses to verify tokens against the
 * backing store (PostgreSQL player table, external OAuth, etc.).
 * Injected at construction so the auth layer stays storage-agnostic.
 */
export type TokenVerifier = (token: string) => Promise<TokenVerifyResult>;

// ---------------------------------------------------------------------------
// AuthManager
// ---------------------------------------------------------------------------

/**
 * Handles all token-based authentication flows:
 *
 * 1. **authenticate(token)** — validates a client-supplied token, creates or
 *    resumes a session, and returns the player's account info.
 * 2. **getPlayer(token)** — fast lookup of a previously-authenticated session.
 * 3. **resumeSession(token)** — reconnects a dropped client to an existing
 *    session (e.g. after a WebSocket drop within the 5-minute grace window).
 * 4. **endSession(token)** — cleans up when a player deliberately disconnects.
 *
 * Sessions are stored in-memory (Map). A future iteration will persist them
 * in Redis/PG for horizontal scaling.
 */
export class AuthManager {
  /** token → AuthSession */
  private sessions: Map<string, AuthSession> = new Map();

  /** playerId → token (reverse index for reconnect-by-playerId) */
  private playerToToken: Map<string, string> = new Map();

  /** Injected token verifier (talks to PersistenceLayer / OAuth) */
  private verifyToken: TokenVerifier;

  /** Maximum idle time before a session is reaped (ms). Default: 30 min. */
  private readonly sessionTTLMs: number;

  constructor(verifyToken: TokenVerifier, sessionTTLMs: number = 30 * 60 * 1000) {
    this.verifyToken = verifyToken;
    this.sessionTTLMs = sessionTTLMs;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Validate a client-supplied auth token and establish (or resume) a session.
   *
   * @param token - The opaque bearer token from the AUTH client message.
   * @returns The authenticated session, or null if the token is invalid.
   *
   * Flow:
   *  1. Check if we already have a live session for this token → resume.
   *  2. Otherwise call the injected verifier (DB lookup / OAuth introspect).
   *  3. If valid, create a new AuthSession and index it.
   *  4. If the player already had a session under a *different* token
   *     (e.g. token refresh), migrate to the new token.
   */
  async authenticate(token: string): Promise<AuthSession | null> {
    // --- Fast path: session already exists for this exact token ---
    const existing = this.sessions.get(token);
    if (existing) {
      existing.lastSeenAt = Date.now();
      return existing;
    }

    // --- Slow path: verify against backing store ---
    const result = await this.verifyToken(token);
    if (!result.valid || !result.playerId || !result.playerName) {
      return null;
    }

    // If the player had a prior session under a different token, clean it up
    const oldToken = this.playerToToken.get(result.playerId);
    if (oldToken && oldToken !== token) {
      this.sessions.delete(oldToken);
    }

    const session: AuthSession = {
      token,
      playerId: result.playerId,
      playerName: result.playerName,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      activeMissionId: null,
    };

    this.sessions.set(token, session);
    this.playerToToken.set(result.playerId, token);

    return session;
  }

  /**
   * Fast, synchronous lookup of a previously-authenticated session.
   * Returns null if the token has not been authenticated or has expired.
   */
  getPlayer(token: string): AuthSession | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    // Check TTL
    if (Date.now() - session.lastSeenAt > this.sessionTTLMs) {
      this.removeSession(token);
      return null;
    }

    return session;
  }

  /**
   * Attempt to resume an existing session for a reconnecting player.
   * Called when the DisconnectManager detects a WebSocket reconnection
   * within the 5-minute grace period.
   *
   * @param playerId - The player ID from a previous session.
   * @param newToken - The freshly-issued token from re-authentication.
   * @returns The restored session (with updated token), or null if no
   *          prior session exists.
   */
  resumeSession(playerId: string, newToken: string): AuthSession | null {
    const oldToken = this.playerToToken.get(playerId);
    if (!oldToken) return null;

    const session = this.sessions.get(oldToken);
    if (!session) {
      this.playerToToken.delete(playerId);
      return null;
    }

    // Migrate session to the new token
    this.sessions.delete(oldToken);
    session.token = newToken;
    session.lastSeenAt = Date.now();
    this.sessions.set(newToken, session);
    this.playerToToken.set(playerId, newToken);

    return session;
  }

  /**
   * Mark a session's heartbeat. Should be called on every inbound message
   * to keep the session alive.
   */
  touch(token: string): void {
    const session = this.sessions.get(token);
    if (session) {
      session.lastSeenAt = Date.now();
    }
  }

  /**
   * Bind a player's session to a specific mission (set on JOIN_MISSION).
   */
  setActiveMission(token: string, missionId: string | null): void {
    const session = this.sessions.get(token);
    if (session) {
      session.activeMissionId = missionId;
    }
  }

  /**
   * Terminate a session cleanly (player chose to log out or connection
   * fully expired past grace).
   */
  endSession(token: string): void {
    this.removeSession(token);
  }

  /**
   * Reap all sessions that have exceeded their TTL.
   * Should be called periodically (e.g. every 60 s from a setInterval).
   */
  reapExpiredSessions(): number {
    const now = Date.now();
    let reaped = 0;
    for (const [token, session] of this.sessions) {
      if (now - session.lastSeenAt > this.sessionTTLMs) {
        this.removeSession(token);
        reaped++;
      }
    }
    return reaped;
  }

  /**
   * Return the number of currently active sessions. Useful for server
   * metrics and lobby population display.
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Look up the session for a player by their player ID (rather than token).
   * Used internally by DisconnectManager when it only knows the playerId.
   */
  getSessionByPlayerId(playerId: string): AuthSession | null {
    const token = this.playerToToken.get(playerId);
    if (!token) return null;
    return this.getPlayer(token);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private removeSession(token: string): void {
    const session = this.sessions.get(token);
    if (session) {
      this.playerToToken.delete(session.playerId);
    }
    this.sessions.delete(token);
  }
}
