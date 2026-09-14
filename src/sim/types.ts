/**
 * Pure simulation types. This module (and the rest of src/sim/) must never
 * import from render/, net/, ui/, or the DOM — it is shared verbatim between
 * the host's authoritative loop and the joining client's predicted loop.
 */

export type Slot = 0 | 1;
export const HOST_SLOT: Slot = 0;
export const JOINER_SLOT: Slot = 1;

/** One frame's worth of raw input, before a sequence number is assigned. */
export interface RawInput {
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimAngle: number; // radians
  buttons: number; // bitmask, see config.ts BUTTON_*
  /** Seconds simulated by this input sample (the sampler's own frame delta). */
  dt: number;
}

export interface InputSample extends RawInput {
  /** Monotonically increasing per-client input sequence number. */
  seq: number;
}

export interface PlayerState {
  connected: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Highest input seq from this player the host has applied. */
  lastProcessedSeq: number;
}

export interface WorldState {
  tick: number;
  players: [PlayerState, PlayerState];
}

export function createPlayerState(x: number, y: number): PlayerState {
  return {
    connected: false,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    lastProcessedSeq: 0,
  };
}

export function clonePlayerState(p: PlayerState): PlayerState {
  return { ...p };
}
