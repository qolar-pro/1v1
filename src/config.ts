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
export const BUTTON_SCOPE = 1 << 4;
export const DEFUSE_RADIUS = 100;
export const MELEE_RANGE = PLAYER_RADIUS * 2.4;
export const MELEE_ARC_RAD = Math.PI / 3;
export const MAX_HITSCAN_RANGE = 2400;

// --- First-person 3D rendering ---
// The simulation stays a flat 2D plane (sim.x, sim.y) — mapped to Three.js
// (x, z) with a fixed height axis. Pitch (looking up/down) is purely a
// client-side visual — hitscan stays a horizontal ray at EYE_HEIGHT, same as
// the original top-down design, so none of sim/combat.ts needed to change.
export const EYE_HEIGHT = 60;
export const WALL_HEIGHT = 240;
export const PROP_HEIGHT = 110;
export const FPS_FOV_DEG = 90;
export const MOUSE_SENSITIVITY = 0.0022; // radians per pixel of mouse movement
export const TOUCH_LOOK_SENSITIVITY = 0.006; // radians per pixel of touch drag
export const MAX_PITCH = Math.PI / 2 - 0.05;

// --- Vision ---
export const VISION_FOV_DEG = 100;
export const VISION_FAR = 700;
export const VISION_NEAR = 90;
export const FLASH_BLIND_MS = 2500;
export const SMOKE_DURATION_MS = 18000;
export const SMOKE_RADIUS = 140;

// --- Combat ---
export const HEADSHOT_MULT = 4;
export const CHEST_MULT = 1;
export const LEG_MULT = 0.75;
export const HEAD_ZONE_RADIUS = 0.35; // fraction of PLAYER_RADIUS, facing-relative cone
export const LEG_ZONE_RADIUS = 0.35;
export const ARMOR_ABSORB = 0.5;
export const ARMOR_DEGRADE_PER_HIT = 0.86; // armor value multiplier per hit that connects while armored
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const RECOIL_RECOVER_S = 0.4;
export const SPRAY_PATTERN_LENGTH = 30;
/** Cap on lag-compensation rewind, mirrors MAX_REWIND_MS above (kept for clarity at call sites). */
export const HITSCAN_REWIND_CAP_MS = MAX_REWIND_MS;

// --- Rounds / match ---
export const ROUNDS_TO_WIN = 7;
export const ROUNDS_TOTAL_MAX = 13;
export const SIDE_SWAP_AFTER_ROUND = 6;
export const FREEZE_TIME_S = 12;
export const ROUND_TIME_S = 95;
export const ROUND_END_TIME_S = 4;
export const BOMB_TIMER_S = 35;
export const DEFUSE_TIME_S = 5;
export const DEFUSE_TIME_KIT_S = 2.5;
export const PLANT_TIME_S = 3.2;

// --- Economy ---
export const START_MONEY = 800;
export const MONEY_CAP = 16000;
export const ROUND_WIN_REWARD = 3250;
export const LOSS_BONUS_LADDER = [1400, 1900, 2400, 2900, 3400];
export const PLANT_BONUS = 300;
export const DEFUSE_BONUS = 300;
