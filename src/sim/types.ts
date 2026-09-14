/**
 * Pure simulation types. This module (and the rest of src/sim/) must never
 * import from render/, net/, ui/, or the DOM — it is shared verbatim between
 * the host's authoritative loop and the joining client's predicted loop.
 */
import { getWeapon, RAIDER_STARTER, WARDEN_STARTER, type WeaponId } from "../data/weapons";
import { MAX_HEALTH, START_MONEY } from "../config";

export type Slot = 0 | 1;
export const HOST_SLOT: Slot = 0;
export const JOINER_SLOT: Slot = 1;

export type Role = "raider" | "warden";

/** One frame's worth of raw input, before a sequence number is assigned. */
export interface RawInput {
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimAngle: number; // radians
  buttons: number; // bitmask, see config.ts BUTTON_*
  /** Seconds simulated by this input sample (the sampler's own frame delta). */
  dt: number;
  /** Weapon slot request this frame, or null for "no change". */
  wantSlot: WeaponSlot | null;
  /** Edge-triggered grenade-throw request (client sends it once, on keydown). */
  throwGrenade: boolean;
}

export interface InputSample extends RawInput {
  /** Monotonically increasing per-client input sequence number. */
  seq: number;
}

export type WeaponSlot = "primary" | "secondary" | "melee";

export interface Loadout {
  primary: WeaponId | null;
  secondary: WeaponId;
  melee: WeaponId;
  active: WeaponSlot;
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

  role: Role;
  hp: number;
  armor: number;
  helmet: boolean;
  alive: boolean;
  walking: boolean;

  loadout: Loadout;
  ammo: Record<WeaponSlot, { inMag: number; reserve: number }>;
  reloading: boolean;
  reloadEndsAtMs: number;

  inaccuracy: number;
  shotsFired: number;
  lastFireAtMs: number;

  money: number;
  hasDefuseKit: boolean;
  grenades: { flash: number; smoke: number; frag: number };

  flashedUntilMs: number;

  carryingCharge: boolean;
  planting: boolean;
  defusing: boolean;
  actionProgress: number;

  kills: number;
  deaths: number;

  respawnPending: boolean;
}

export interface WorldState {
  tick: number;
  players: [PlayerState, PlayerState];
}

export function createPlayerState(x: number, y: number, role: Role): PlayerState {
  const weaponId = role === "raider" ? RAIDER_STARTER : WARDEN_STARTER;
  const weapon = getWeapon(weaponId);
  return {
    connected: false,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    lastProcessedSeq: 0,

    role,
    hp: MAX_HEALTH,
    armor: 0,
    helmet: false,
    alive: true,
    walking: false,

    loadout: { primary: null, secondary: weaponId, melee: "shard", active: "secondary" },
    ammo: {
      primary: { inMag: 0, reserve: 0 },
      secondary: { inMag: weapon.magSize, reserve: weapon.reserveMax },
      melee: { inMag: 0, reserve: 0 },
    },
    reloading: false,
    reloadEndsAtMs: 0,

    inaccuracy: 0,
    shotsFired: 0,
    lastFireAtMs: 0,

    money: START_MONEY,
    hasDefuseKit: false,
    grenades: { flash: 0, smoke: 0, frag: 0 },

    flashedUntilMs: 0,

    carryingCharge: role === "raider",
    planting: false,
    defusing: false,
    actionProgress: 0,

    kills: 0,
    deaths: 0,
    respawnPending: false,
  };
}

export function clonePlayerState(p: PlayerState): PlayerState {
  return {
    ...p,
    loadout: { ...p.loadout },
    grenades: { ...p.grenades },
    ammo: { primary: { ...p.ammo.primary }, secondary: { ...p.ammo.secondary }, melee: { ...p.ammo.melee } },
  };
}

export function otherSlot(slot: Slot): Slot {
  return slot === HOST_SLOT ? JOINER_SLOT : HOST_SLOT;
}
