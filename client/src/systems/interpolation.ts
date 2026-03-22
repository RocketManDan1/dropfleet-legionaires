/**
 * InterpolationSystem — client-side interpolation between server snapshots.
 *
 * Source: NETWORK_PROTOCOL.md (Section 5 — TICK_UPDATE Deep Dive)
 * Milestone 2: Skirmish Sandbox
 *
 * The server sends TICK_UPDATE at 1 Hz with unit deltas containing position,
 * heading, and velocity. This system buffers those snapshots and interpolates
 * between them so units move smoothly at the client's render framerate despite
 * the low network update rate.
 *
 * Design:
 * - Ring buffer of 3 snapshots per unit (enough for interpolation + extrapolation)
 * - Configurable render delay (default 100ms = 2 server ticks behind)
 * - Linear interpolation for position
 * - Shortest-arc angular interpolation for heading
 * - Falls back to linear extrapolation when no future snapshot is available
 */

import type { Vec2 } from '@legionaires/shared';

/** Tick rate constants from AUTHORITATIVE_CONTRACTS.md */
const TICK_RATE_HZ = 20;
const TICK_MS = 50;

/** A single server snapshot for one unit at a given tick. */
interface UnitSnapshotEntry {
  posX: number;
  posZ: number;
  heading: number;
  tick: number;
}

/** The result of an interpolation query. */
interface InterpolatedState {
  posX: number;
  posZ: number;
  heading: number;
}

/** Ring buffer holding the last N snapshots for a single unit. */
class SnapshotRingBuffer {
  private readonly entries: (UnitSnapshotEntry | null)[];
  private readonly capacity: number;
  private writeIndex: number = 0;
  private count: number = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.entries = new Array(capacity).fill(null);
  }

  /** Push a new snapshot. If the buffer is full, the oldest entry is overwritten. */
  push(entry: UnitSnapshotEntry): void {
    this.entries[this.writeIndex] = entry;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Number of snapshots stored. */
  get size(): number {
    return this.count;
  }

  /**
   * Get the i-th entry in chronological order (0 = oldest stored).
   * Returns null if index is out of range.
   */
  get(index: number): UnitSnapshotEntry | null {
    if (index < 0 || index >= this.count) {
      return null;
    }
    // The oldest entry is at (writeIndex - count + capacity) % capacity
    const oldest = (this.writeIndex - this.count + this.capacity) % this.capacity;
    const actual = (oldest + index) % this.capacity;
    return this.entries[actual];
  }

  /** Get the most recent snapshot. */
  newest(): UnitSnapshotEntry | null {
    if (this.count === 0) return null;
    const idx = (this.writeIndex - 1 + this.capacity) % this.capacity;
    return this.entries[idx];
  }

  /** Get the second-most-recent snapshot, if available. */
  secondNewest(): UnitSnapshotEntry | null {
    if (this.count < 2) return null;
    const idx = (this.writeIndex - 2 + this.capacity) % this.capacity;
    return this.entries[idx];
  }

  /**
   * Find the pair of snapshots that bracket the given tick.
   * Returns [before, after] where before.tick <= tick <= after.tick.
   * If the tick is beyond all stored snapshots, returns the last two for extrapolation.
   * If only one snapshot exists, returns [snapshot, null].
   */
  findBracket(tick: number): [UnitSnapshotEntry, UnitSnapshotEntry | null] | null {
    if (this.count === 0) return null;

    if (this.count === 1) {
      return [this.get(0)!, null];
    }

    // Walk from oldest to newest looking for a bracket
    for (let i = 0; i < this.count - 1; i++) {
      const a = this.get(i)!;
      const b = this.get(i + 1)!;
      if (a.tick <= tick && tick <= b.tick) {
        return [a, b];
      }
    }

    // Tick is beyond our newest snapshot — return last two for extrapolation
    return [this.secondNewest()!, this.newest()!];
  }
}

export class InterpolationSystem {
  /** Per-unit ring buffers. Key is unitId. */
  private buffers: Map<string, SnapshotRingBuffer> = new Map();

  /** How many ticks behind the server the client renders (for smooth interpolation). */
  private renderDelayTicks: number;

  /** Ring buffer capacity — how many snapshots to store per unit. */
  private static readonly BUFFER_SIZE = 3;

  /**
   * @param renderDelayMs How far behind the server tick the client renders.
   *   Default is 100ms (2 ticks at 20Hz). Higher values give smoother
   *   interpolation but increase visual latency.
   */
  constructor(renderDelayMs: number = 100) {
    this.renderDelayTicks = Math.round(renderDelayMs / TICK_MS);
  }

  /**
   * Push a new server snapshot for a unit. Call this whenever a TICK_UPDATE
   * arrives with position/heading data for a unit.
   *
   * @param unitId The unit's unique identifier.
   * @param snapshot Position, heading, and server tick from the delta.
   */
  pushSnapshot(
    unitId: string,
    snapshot: { posX: number; posZ: number; heading: number; tick: number }
  ): void {
    let buffer = this.buffers.get(unitId);
    if (!buffer) {
      buffer = new SnapshotRingBuffer(InterpolationSystem.BUFFER_SIZE);
      this.buffers.set(unitId, buffer);
    }

    // Only accept snapshots that are newer than what we already have,
    // or the first snapshot for this unit.
    const newest = buffer.newest();
    if (newest && snapshot.tick <= newest.tick) {
      return;
    }

    buffer.push({
      posX: snapshot.posX,
      posZ: snapshot.posZ,
      heading: snapshot.heading,
      tick: snapshot.tick,
    });
  }

  /**
   * Get the interpolated position and heading for a unit at the given client tick.
   *
   * The client tick is offset behind the actual server tick by the render delay,
   * so there is usually a future snapshot to interpolate toward.
   *
   * @param unitId The unit's unique identifier.
   * @param clientTick The current server tick as known by the client. The system
   *   automatically applies the render delay offset.
   * @returns Interpolated state, or null if no data exists for this unit.
   */
  getInterpolated(unitId: string, clientTick: number): InterpolatedState | null {
    const buffer = this.buffers.get(unitId);
    if (!buffer || buffer.size === 0) {
      return null;
    }

    // Apply render delay — we render a few ticks behind the server
    const renderTick = clientTick - this.renderDelayTicks;

    const bracket = buffer.findBracket(renderTick);
    if (!bracket) {
      return null;
    }

    const [a, b] = bracket;

    // Only one snapshot available — return it directly
    if (!b) {
      return { posX: a.posX, posZ: a.posZ, heading: a.heading };
    }

    // Both snapshots are the same tick (shouldn't happen, but guard against it)
    if (a.tick === b.tick) {
      return { posX: b.posX, posZ: b.posZ, heading: b.heading };
    }

    // Compute interpolation factor (can be > 1.0 for extrapolation)
    const t = (renderTick - a.tick) / (b.tick - a.tick);

    // Linear interpolation for position
    const posX = a.posX + (b.posX - a.posX) * t;
    const posZ = a.posZ + (b.posZ - a.posZ) * t;

    // Shortest-arc interpolation for heading (in degrees, 0-360)
    const heading = lerpAngleDeg(a.heading, b.heading, t);

    return { posX, posZ, heading };
  }

  /**
   * Remove all buffered data for a unit. Call this when a unit is destroyed
   * or removed from the player's fog of war.
   */
  removeUnit(unitId: string): void {
    this.buffers.delete(unitId);
  }

  /**
   * Clear all buffered data for every unit. Call this on reconnect when the
   * client receives a fresh MISSION_STATE_FULL and discards all local state.
   */
  reset(): void {
    this.buffers.clear();
  }

  /**
   * Check whether the system has any snapshot data for a unit.
   */
  hasUnit(unitId: string): boolean {
    const buffer = this.buffers.get(unitId);
    return buffer !== undefined && buffer.size > 0;
  }

  /**
   * Get the render delay in ticks.
   */
  getRenderDelayTicks(): number {
    return this.renderDelayTicks;
  }

  /**
   * Update the render delay. Higher values give smoother interpolation but
   * increase the visual lag behind the server state.
   */
  setRenderDelayMs(ms: number): void {
    this.renderDelayTicks = Math.round(ms / TICK_MS);
  }
}

/**
 * Linearly interpolate between two angles in degrees, taking the shortest arc.
 *
 * For example, interpolating from 350 to 10 goes through 360/0 (20 degree arc),
 * not the long way around (340 degree arc).
 *
 * @param fromDeg Starting angle in degrees.
 * @param toDeg Ending angle in degrees.
 * @param t Interpolation factor. 0 = fromDeg, 1 = toDeg, can exceed 1 for extrapolation.
 * @returns Interpolated angle in degrees, normalized to [0, 360).
 */
function lerpAngleDeg(fromDeg: number, toDeg: number, t: number): number {
  // Compute the shortest signed difference
  let diff = ((toDeg - fromDeg) % 360 + 540) % 360 - 180;

  // Interpolate (or extrapolate if t > 1)
  let result = fromDeg + diff * t;

  // Normalize to [0, 360)
  result = ((result % 360) + 360) % 360;

  return result;
}
