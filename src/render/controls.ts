import type { RawInput } from "../sim/types";

/**
 * Per-frame movement/look/buttons sample, plus edge-triggered UI toggles,
 * from whichever input scheme is active (desktop mouse+keyboard or mobile
 * touch). `aimAngle` in the returned sample IS the camera yaw — the sim
 * only ever sees a flat horizontal facing angle, exactly like the original
 * top-down build. Pitch (looking up/down) is camera-only and never leaves
 * the client, so `getPitch()` is separate from `sample()`.
 */
export interface Controls {
  sample(dt: number): Omit<RawInput, "dt">;
  getPitch(): number;
  consumeBuyToggle(): boolean;
  isScoreboardHeld(): boolean;
  destroy(): void;
}
