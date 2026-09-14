/**
 * Central tunables. No magic numbers should live buried in game logic —
 * everything gameplay- or netcode-relevant is declared here or in data/.
 */

// --- Networking ---
export const APP_ID = "breach-1v1-a7f3";
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 30;

/** Render-time delay applied to remote players, for smooth interpolation. */
export const INTERP_DELAY_MS = 100;
/** Never extrapolate a remote player further than this beyond the last snapshot. */
export const MAX_EXTRAPOLATION_MS = 250;
/** Lag-compensation rewind cap for hitscan (used from Phase 3 onward). */
export const MAX_REWIND_MS = 250;

/** Reconciliation: corrections under this magnitude are smoothed, not snapped. */
export const RECONCILE_SNAP_THRESHOLD_PX = 2;
export const RECONCILE_SMOOTH_MS = 100;

/** Disconnect grace period before a match is declared over. */
export const DISCONNECT_GRACE_MS = 3000;

// --- World / movement ---
export const WORLD_WIDTH = 2200;
export const WORLD_HEIGHT = 1600;
export const PLAYER_RADIUS = 18;
export const WORLD_MARGIN = PLAYER_RADIUS;

export const RUN_SPEED = 220; // px/s
export const WALK_SPEED = 120; // px/s
export const MOVE_ACCEL = 2000; // px/s^2
export const MOVE_FRICTION = 10; // 1/s exponential decay

// --- Input button bitmask ---
export const BUTTON_WALK = 1 << 0;
export const BUTTON_FIRE = 1 << 1;
export const BUTTON_RELOAD = 1 << 2;
export const BUTTON_USE = 1 << 3;
