import {
  ARMOR_ABSORB,
  ARMOR_DEGRADE_PER_HIT,
  CHEST_MULT,
  EYE_HEIGHT,
  HEADSHOT_MULT,
  HITBOX_MAX_Y,
  HITBOX_MIN_Y,
  LEG_MULT,
  MAX_HEALTH,
  PLAYER_RADIUS,
  RECOIL_RECOVER_S,
  RUN_SPEED,
  VERTICAL_HEAD_FRAC,
  VERTICAL_LEG_FRAC,
} from "../config";
import { getWeapon, type WeaponDef } from "../data/weapons";
import type { WallRect } from "../data/maps/types";
import { stepPlayer } from "./movement";
import { BUTTON_FIRE, BUTTON_RELOAD } from "../config";
import type { InputSample, PlayerState, WeaponSlot } from "./types";

export function activeWeaponId(player: PlayerState): string {
  const slot = player.loadout.active;
  if (slot === "primary" && player.loadout.primary) return player.loadout.primary;
  if (slot === "secondary") return player.loadout.secondary;
  return player.loadout.melee;
}

export function currentWeapon(player: PlayerState): WeaponDef {
  return getWeapon(activeWeaponId(player));
}

export function fireIntervalMs(weapon: WeaponDef): number {
  return (60 / weapon.rpm) * 1000;
}

export function canFire(player: PlayerState, nowMs: number): boolean {
  if (!player.alive || player.reloading) return false;
  const weapon = currentWeapon(player);
  if (weapon.class !== "melee" && player.ammo[player.loadout.active].inMag <= 0) return false;
  if (nowMs - player.lastFireAtMs < fireIntervalMs(weapon)) return false;
  return true;
}

/** Per-frame inaccuracy relaxation toward the current movement-based resting spread. */
export function tickInaccuracy(player: PlayerState, speed: number, dt: number): number {
  const weapon = currentWeapon(player);
  const speedFrac = Math.min(1, speed / RUN_SPEED);
  const resting = weapon.baseInaccuracy + weapon.movementInaccuracy * speedFrac;
  if (player.inaccuracy <= resting) return resting;
  const next = player.inaccuracy - weapon.recoverPerSecond * dt;
  return next < resting ? resting : next;
}

/** Mutates-by-return: consumes ammo/ammo timing and bumps recoil/inaccuracy for one shot. */
export function applyFireCost(player: PlayerState, nowMs: number): PlayerState {
  const weapon = currentWeapon(player);
  const shotsFired = nowMs - player.lastFireAtMs < RECOIL_RECOVER_S * 1000 ? player.shotsFired + 1 : 1;
  const kick = weapon.class === "melee" ? 0 : weapon.baseInaccuracy * 0.9;
  const slot = player.loadout.active;
  const current = player.ammo[slot];
  return {
    ...player,
    ammo:
      weapon.class === "melee"
        ? player.ammo
        : { ...player.ammo, [slot]: { ...current, inMag: Math.max(0, current.inMag - 1) } },
    lastFireAtMs: nowMs,
    shotsFired,
    inaccuracy: player.inaccuracy + kick,
  };
}

/** Angular offset (radians) for one shot: fixed spray pattern position + random inaccuracy jitter. */
export function computeShotAngleOffset(weapon: WeaponDef, shotsFired: number, inaccuracy: number, rand: () => number): number {
  const sprayIndex = weapon.sprayPattern.length > 0 ? (shotsFired - 1) % weapon.sprayPattern.length : -1;
  const sprayOffset = sprayIndex >= 0 ? (weapon.sprayPattern[sprayIndex] ?? 0) : 0;
  const jitter = (rand() * 2 - 1) * inaccuracy;
  return sprayOffset + jitter;
}

export function startReload(player: PlayerState, nowMs: number): PlayerState {
  const weapon = currentWeapon(player);
  const slot = player.loadout.active;
  const ammo = player.ammo[slot];
  if (weapon.class === "melee" || player.reloading) return player;
  if (ammo.inMag >= weapon.magSize || ammo.reserve <= 0) return player;
  return { ...player, reloading: true, reloadEndsAtMs: nowMs + weapon.reloadTimeS * 1000 };
}

export function finishReloadIfDue(player: PlayerState, nowMs: number): PlayerState {
  if (!player.reloading || nowMs < player.reloadEndsAtMs) return player;
  const weapon = currentWeapon(player);
  const slot = player.loadout.active;
  const ammo = player.ammo[slot];
  const need = weapon.magSize - ammo.inMag;
  const take = Math.min(need, ammo.reserve);
  return {
    ...player,
    reloading: false,
    ammo: { ...player.ammo, [slot]: { inMag: ammo.inMag + take, reserve: ammo.reserve - take } },
  };
}

export function switchWeapon(player: PlayerState, slot: WeaponSlot): PlayerState {
  if (slot === player.loadout.active) return player;
  if (slot === "primary" && !player.loadout.primary) return player;
  const weaponId = slot === "primary" ? player.loadout.primary! : slot === "secondary" ? player.loadout.secondary : player.loadout.melee;
  const weapon = getWeapon(weaponId);
  return {
    ...player,
    loadout: { ...player.loadout, active: slot },
    reloading: false,
    inaccuracy: weapon.baseInaccuracy,
  };
}

export type HitZoneName = "head" | "chest" | "leg";

const HEAD_HALF_ANGLE = Math.PI / 4; // 45°, frontal arc
const LEG_HALF_ANGLE = Math.PI / 4; // 45°, rear arc

/** Classifies a hit point on target's hitbox circle relative to target's own facing. */
export function classifyHitZone(hitX: number, hitY: number, target: PlayerState): HitZoneName {
  const dx = hitX - target.x;
  const dy = hitY - target.y;
  const cos = Math.cos(-target.angle);
  const sin = Math.sin(-target.angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const angleOnCircle = Math.atan2(localY, localX);
  const abs = Math.abs(angleOnCircle);
  if (abs <= HEAD_HALF_ANGLE) return "head";
  if (abs >= Math.PI - LEG_HALF_ANGLE) return "leg";
  return "chest";
}

export function zoneMultiplier(zone: HitZoneName): number {
  if (zone === "head") return HEADSHOT_MULT;
  if (zone === "leg") return LEG_MULT;
  return CHEST_MULT;
}

/**
 * Aiming into the top or bottom sliver of a target's hitbox forces a
 * head/leg zone outright, regardless of the horizontal facing-relative
 * angle — this is what makes vertical aim (pitch) actually matter for
 * damage, not just "did the shot land at all".
 */
export function classifyVerticalZone(heightFrac: number): HitZoneName | null {
  if (heightFrac >= VERTICAL_HEAD_FRAC) return "head";
  if (heightFrac <= VERTICAL_LEG_FRAC) return "leg";
  return null;
}

export interface DamageResult {
  target: PlayerState;
  damageDealt: number;
  killed: boolean;
  zone: HitZoneName;
}

export function applyHitscanDamage(
  target: PlayerState,
  weapon: WeaponDef,
  hitX: number,
  hitY: number,
  nowMs: number,
  zoneOverride?: HitZoneName | null,
): DamageResult {
  void nowMs;
  const zone = zoneOverride ?? classifyHitZone(hitX, hitY, target);
  const rawDamage = weapon.damage * zoneMultiplier(zone);

  let remaining = rawDamage;
  let armor = target.armor;
  if (armor > 0 && !weapon.armorPiercing) {
    const absorbed = rawDamage * ARMOR_ABSORB;
    remaining = rawDamage - absorbed;
    armor = Math.max(0, armor * ARMOR_DEGRADE_PER_HIT);
  } else if (armor > 0 && weapon.armorPiercing) {
    armor = Math.max(0, armor * ARMOR_DEGRADE_PER_HIT);
  }

  const hp = Math.max(0, target.hp - remaining);
  const killed = hp <= 0 && target.alive;

  const next: PlayerState = {
    ...target,
    hp,
    armor,
    alive: hp > 0,
    deaths: killed ? target.deaths + 1 : target.deaths,
  };

  return { target: next, damageDealt: target.hp - hp, killed, zone };
}

export function applyMeleeDamage(target: PlayerState, isBackstab: boolean, nowMs: number): DamageResult {
  const weapon = getWeapon("shard");
  const dmg = isBackstab && weapon.backstabMult ? weapon.damage * weapon.backstabMult : weapon.damage;
  const hp = Math.max(0, target.hp - dmg);
  const killed = hp <= 0 && target.alive;
  const next: PlayerState = { ...target, hp, alive: hp > 0, deaths: killed ? target.deaths + 1 : target.deaths };
  void nowMs;
  return { target: next, damageDealt: dmg, killed, zone: "chest" };
}

export function respawnAt(player: PlayerState, x: number, y: number, nowMs: number): PlayerState {
  void nowMs;
  return { ...player, x, y, vx: 0, vy: 0, hp: MAX_HEALTH, alive: true, respawnPending: false };
}

export function circleHitTest(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  radius: number,
): number | null {
  // Ray-circle intersection: returns distance along ray to nearest entry point, or null.
  const lx = cx - ox;
  const ly = cy - oy;
  const proj = lx * dx + ly * dy;
  if (proj < 0) return null;
  const closestX = ox + dx * proj;
  const closestY = oy + dy * proj;
  const distSq = (closestX - cx) ** 2 + (closestY - cy) ** 2;
  const rSq = radius * radius;
  if (distSq > rSq) return null;
  const backOff = Math.sqrt(rSq - distSq);
  const t = proj - backOff;
  return t >= 0 ? t : null;
}

export const HITBOX_RADIUS = PLAYER_RADIUS;

export interface VerticalHitResult {
  hit: boolean;
  /** 0 (feet) .. 1 (top of head), clamped — used for the head/leg zone override. */
  heightFrac: number;
}

/**
 * Given the horizontal (XZ) distance to a target's closest approach along a
 * pitched ray, works out the actual world height the shot passes through at
 * that point and whether it falls inside the target's hitbox. This is what
 * makes "aim up/down" actually change what a shot hits instead of every
 * hitscan being a flat ray at eye height regardless of where you're looking.
 */
/** World height a pitched ray reaches after travelling `horizontalDist` (XZ distance) from a point at `originHeight`. */
export function pitchedHeightAt(originHeight: number, pitch: number, horizontalDist: number): number {
  const cosPitch = Math.cos(pitch);
  const safeCos = Math.abs(cosPitch) < 0.05 ? Math.sign(cosPitch || 1) * 0.05 : cosPitch;
  const dist3d = horizontalDist / safeCos;
  return originHeight + dist3d * Math.sin(pitch);
}

export function computeVerticalHit(horizontalDist: number, pitch: number, shooterJumpZ: number, targetJumpZ: number): VerticalHitResult {
  const heightAtPoint = pitchedHeightAt(EYE_HEIGHT + shooterJumpZ, pitch, horizontalDist);
  const relHeight = heightAtPoint - targetJumpZ;
  const hit = relHeight >= HITBOX_MIN_Y && relHeight <= HITBOX_MAX_Y;
  const heightFrac = Math.min(1, Math.max(0, (relHeight - HITBOX_MIN_Y) / (HITBOX_MAX_Y - HITBOX_MIN_Y)));
  return { hit, heightFrac };
}

export interface StepResult {
  player: PlayerState;
  fired: boolean;
  weapon: WeaponDef;
  shotAngle: number;
}

/**
 * Movement + non-damage combat state (reload, weapon switch, inaccuracy,
 * ammo cost) in one deterministic-enough step. Shared by the host (applied
 * to both players every tick) and the client (local prediction of its own
 * player) so ammo/reload/inaccuracy feel instant on both sides. Damage
 * resolution is intentionally NOT here — it needs the opponent + map + net
 * timing, so callers in net/host.ts handle it once `fired` comes back true.
 */
export function applyInputToPlayer(
  player: PlayerState,
  input: InputSample,
  solids: readonly WallRect[],
  nowMs: number,
  gameIsLive: boolean,
): StepResult {
  const weaponBefore = currentWeapon(player);
  let p = stepPlayer(player, input, solids, weaponBefore.moveSpeedMult);
  p = finishReloadIfDue(p, nowMs);
  if (input.wantSlot) p = switchWeapon(p, input.wantSlot);
  if ((input.buttons & BUTTON_RELOAD) !== 0) p = startReload(p, nowMs);

  const speed = Math.hypot(p.vx, p.vy);
  p = { ...p, inaccuracy: tickInaccuracy(p, speed, input.dt) };

  let fired = false;
  const weapon = currentWeapon(p);
  if (gameIsLive && (input.buttons & BUTTON_FIRE) !== 0 && canFire(p, nowMs)) {
    p = applyFireCost(p, nowMs);
    fired = true;
  }

  const shotAngle = fired
    ? p.angle + computeShotAngleOffset(weapon, p.shotsFired, player.inaccuracy, Math.random)
    : p.angle;

  return { player: p, fired, weapon, shotAngle };
}
