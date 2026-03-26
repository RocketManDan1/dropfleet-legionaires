// ============================================================================
// MISSION LIFECYCLE — State machine: CREATED → DEPLOYMENT → LIVE →
//                     EXTRACTION → AAR → CLOSED
// Milestone 3
// Source: MISSION_LIFECYCLE.md, AUTHORITATIVE_CONTRACTS.md §2
// ============================================================================
import { DEPLOYMENT_TIMER_SEC, TICKS_PER_SEC } from '@legionaires/shared';
const PHASE_TO_WIRE = {
    created: 'briefing',
    deployment: 'deployment',
    live: 'live',
    extraction: 'extraction',
    aar: 'ended',
    closed: 'ended',
};
/**
 * Manages the lifecycle state machine for a single mission.
 */
export class MissionLifecycle {
    missionId;
    missionType;
    difficulty;
    phase = 'created';
    phaseStartTick = 0;
    deploymentTimerTicks;
    missionTimeLimitTicks;
    extractionTimerTicks;
    aarAutoCloseTicks;
    constructor(missionId, missionType, difficulty, timeLimitSec) {
        this.missionId = missionId;
        this.missionType = missionType;
        this.difficulty = difficulty;
        this.deploymentTimerTicks = DEPLOYMENT_TIMER_SEC * TICKS_PER_SEC;
        this.missionTimeLimitTicks = timeLimitSec * TICKS_PER_SEC;
        this.extractionTimerTicks = 60 * TICKS_PER_SEC; // 60s extraction window
        this.aarAutoCloseTicks = 180 * TICKS_PER_SEC;
    }
    getPhase() { return this.phase; }
    getWirePhase() { return PHASE_TO_WIRE[this.phase]; }
    /**
     * Called every tick. Returns phase transition event if a transition occurred.
     */
    tick(currentTick, context) {
        const ticksInPhase = currentTick - this.phaseStartTick;
        switch (this.phase) {
            case 'created':
                // Transition to deployment when first player joins
                if (context.playerCount > 0) {
                    return this.transition('deployment', currentTick, 'first_player_joined');
                }
                break;
            case 'deployment':
                // Transition to live when timer expires or all players ready
                if (ticksInPhase >= this.deploymentTimerTicks || context.allPlayersReady) {
                    return this.transition('live', currentTick, 'deployment_complete');
                }
                break;
            case 'live':
                // Transition to extraction when objectives met or time limit reached
                if (context.allObjectivesComplete) {
                    return this.transition('extraction', currentTick, 'objectives_complete');
                }
                if (ticksInPhase >= this.missionTimeLimitTicks) {
                    return this.transition('extraction', currentTick, 'time_limit_reached');
                }
                if (context.allPlayerUnitsDestroyed) {
                    return this.transition('aar', currentTick, 'total_loss');
                }
                break;
            case 'extraction':
                // Transition to AAR when extraction timer expires
                if (ticksInPhase >= this.extractionTimerTicks) {
                    return this.transition('aar', currentTick, 'extraction_complete');
                }
                break;
            case 'aar':
                // AAR closes when all players acknowledge, all players leave,
                // or the 180s auto-close timer expires.
                if (context.allPlayersAcknowledgedAAR) {
                    return this.transition('closed', currentTick, 'aar_acknowledged');
                }
                if (context.playerCount === 0) {
                    return this.transition('closed', currentTick, 'aar_all_players_left');
                }
                if (ticksInPhase >= this.aarAutoCloseTicks) {
                    return this.transition('closed', currentTick, 'aar_timeout');
                }
                break;
        }
        return null;
    }
    /** Is this mission joinable? */
    isJoinable(playerCount) {
        return (this.phase === 'deployment' || this.phase === 'live') && playerCount < 4;
    }
    transition(to, tick, reason) {
        const from = this.phase;
        this.phase = to;
        this.phaseStartTick = tick;
        return { fromPhase: from, toPhase: to, tick, reason };
    }
}
