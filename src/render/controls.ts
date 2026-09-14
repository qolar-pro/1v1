import type { RawInput } from "../sim/types";

/** Per-frame movement/aim/buttons sample, plus edge-triggered UI toggles, from whichever input scheme is active. */
export interface Controls {
  sample(dt: number, localX: number, localY: number): Omit<RawInput, "dt">;
  consumeBuyToggle(): boolean;
  isScoreboardHeld(): boolean;
  destroy(): void;
}
