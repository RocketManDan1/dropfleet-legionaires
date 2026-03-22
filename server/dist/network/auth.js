// ============================================================================
// AUTH MANAGER — Token-based authentication and session management
// Milestone 4: Multiplayer
// Source: NETWORK_PROTOCOL.md, LOBBY_AND_MATCHMAKING.md
// ============================================================================
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
    sessions = new Map();
    /** playerId → token (reverse index for reconnect-by-playerId) */
    playerToToken = new Map();
    /** Injected token verifier (talks to PersistenceLayer / OAuth) */
    verifyToken;
    /** Maximum idle time before a session is reaped (ms). Default: 30 min. */
    sessionTTLMs;
    constructor(verifyToken, sessionTTLMs = 30 * 60 * 1000) {
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
    async authenticate(token) {
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
        const session = {
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
    getPlayer(token) {
        const session = this.sessions.get(token);
        if (!session)
            return null;
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
    resumeSession(playerId, newToken) {
        const oldToken = this.playerToToken.get(playerId);
        if (!oldToken)
            return null;
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
    touch(token) {
        const session = this.sessions.get(token);
        if (session) {
            session.lastSeenAt = Date.now();
        }
    }
    /**
     * Bind a player's session to a specific mission (set on JOIN_MISSION).
     */
    setActiveMission(token, missionId) {
        const session = this.sessions.get(token);
        if (session) {
            session.activeMissionId = missionId;
        }
    }
    /**
     * Terminate a session cleanly (player chose to log out or connection
     * fully expired past grace).
     */
    endSession(token) {
        this.removeSession(token);
    }
    /**
     * Reap all sessions that have exceeded their TTL.
     * Should be called periodically (e.g. every 60 s from a setInterval).
     */
    reapExpiredSessions() {
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
    get activeSessionCount() {
        return this.sessions.size;
    }
    /**
     * Look up the session for a player by their player ID (rather than token).
     * Used internally by DisconnectManager when it only knows the playerId.
     */
    getSessionByPlayerId(playerId) {
        const token = this.playerToToken.get(playerId);
        if (!token)
            return null;
        return this.getPlayer(token);
    }
    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------
    removeSession(token) {
        const session = this.sessions.get(token);
        if (session) {
            this.playerToToken.delete(session.playerId);
        }
        this.sessions.delete(token);
    }
}
