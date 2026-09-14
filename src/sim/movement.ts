import {
  MOVE_ACCEL,
  MOVE_FRICTION,
  RUN_SPEED,
  WALK_SPEED,
  WORLD_HEIGHT,
  WORLD_MARGIN,
  WORLD_WIDTH,
  BUTTON_WALK,
  BUTTON_JUMP,
  PLAYER_RADIUS,
  JUMP_VELOCITY,
  GRAVITY,
} from "../config";
import type { WallRect } from "../data/maps/types";
import { resolveWallCollisions } from "./collision";
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
export function stepPlayer(
  player: PlayerState,
  input: InputSample,
  solids: readonly WallRect[] = [],
  speedMult = 1,
): PlayerState {
  if (!player.alive) {
    return { ...player, vx: 0, vy: 0, lastProcessedSeq: input.seq };
  }

  const dt = input.dt;
  const walking = (input.buttons & BUTTON_WALK) !== 0;
  const speedCap = (walking ? WALK_SPEED : RUN_SPEED) * speedMult;

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

  let x = clamp(player.x + vx * dt, WORLD_MARGIN, WORLD_WIDTH - WORLD_MARGIN);
  let y = clamp(player.y + vy * dt, WORLD_MARGIN, WORLD_HEIGHT - WORLD_MARGIN);

  if (solids.length > 0) {
    const resolved = resolveWallCollisions(x, y, PLAYER_RADIUS, solids);
    x = resolved.x;
    y = resolved.y;
  }

  const grounded = player.jumpZ <= 0;
  let jumpVel = player.jumpVel;
  let jumpZ = player.jumpZ;
  if (grounded && (input.buttons & BUTTON_JUMP) !== 0) {
    jumpVel = JUMP_VELOCITY;
    jumpZ = 0.01; // nudge airborne immediately so a held key doesn't re-trigger every frame
  }
  jumpVel -= GRAVITY * dt;
  jumpZ += jumpVel * dt;
  if (jumpZ <= 0) {
    jumpZ = 0;
    jumpVel = 0;
  }

  return {
    ...player,
    x,
    y,
    vx,
    vy,
    angle: input.aimAngle,
    lastProcessedSeq: input.seq,
    jumpZ,
    jumpVel,
  };
}
