import {
  MOVE_ACCEL,
  MOVE_FRICTION,
  RUN_SPEED,
  WALK_SPEED,
  WORLD_HEIGHT,
  WORLD_MARGIN,
  WORLD_WIDTH,
  BUTTON_WALK,
} from "../config";
import type { InputSample, PlayerState } from "./types";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Deterministic single-step integration of a player against one input sample.
 * Pure function: same (player, input) always yields the same result, which is
 * what makes host simulation and client replay-on-reconcile produce identical
 * positions.
 */
export function stepPlayer(player: PlayerState, input: InputSample): PlayerState {
  const dt = input.dt;
  const walking = (input.buttons & BUTTON_WALK) !== 0;
  const speedCap = walking ? WALK_SPEED : RUN_SPEED;

  const inputMag = Math.hypot(input.moveX, input.moveY);
  const hasInput = inputMag > 0.001;

  let vx = player.vx;
  let vy = player.vy;

  if (hasInput) {
    const nx = input.moveX / inputMag;
    const ny = input.moveY / inputMag;
    vx += nx * MOVE_ACCEL * dt;
    vy += ny * MOVE_ACCEL * dt;
  } else {
    const decay = Math.exp(-MOVE_FRICTION * dt);
    vx *= decay;
    vy *= decay;
  }

  const speed = Math.hypot(vx, vy);
  if (speed > speedCap) {
    const s = speedCap / speed;
    vx *= s;
    vy *= s;
  }
  if (!hasInput && speed < 1) {
    vx = 0;
    vy = 0;
  }

  const x = clamp(player.x + vx * dt, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
  const y = clamp(player.y + vy * dt, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);

  return {
    ...player,
    x,
    y,
    vx,
    vy,
    angle: input.aimAngle,
    lastProcessedSeq: input.seq,
  };
}
