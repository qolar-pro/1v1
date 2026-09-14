import { FLASH_BLIND_MS, SMOKE_DURATION_MS, SMOKE_RADIUS } from "../config";
import { canSee, hasLineOfSight, raycast, type OccludingCircle, type Segment } from "./raycast";

export interface SmokeVolume {
  x: number;
  y: number;
  radius: number;
  expiresAtMs: number;
}

export function smokeToCircles(smokes: readonly SmokeVolume[], nowMs: number): OccludingCircle[] {
  return smokes.filter((s) => s.expiresAtMs > nowMs).map((s) => ({ x: s.x, y: s.y, radius: s.radius }));
}

const THROW_RANGE = 560;

/** Where a thrown grenade lands: a straight raycast from the thrower, blocked by walls. */
export function computeLanding(ox: number, oy: number, angle: number, segments: readonly Segment[]): { x: number; y: number } {
  const hit = raycast(ox, oy, Math.cos(angle), Math.sin(angle), THROW_RANGE, segments);
  return { x: hit.x, y: hit.y };
}

export function spawnSmoke(x: number, y: number, nowMs: number): SmokeVolume {
  return { x, y, radius: SMOKE_RADIUS, expiresAtMs: nowMs + SMOKE_DURATION_MS };
}

/** Does a flash landing at (fx,fy) blind a player looking at it (in their vision cone, unobstructed)? */
export function flashAffects(
  fx: number,
  fy: number,
  viewerX: number,
  viewerY: number,
  viewerAngle: number,
  segments: readonly Segment[],
): boolean {
  return canSee(viewerX, viewerY, viewerAngle, fx, fy, segments);
}

export function flashBlindDurationMs(): number {
  return FLASH_BLIND_MS;
}

export function fragDamageAt(dist: number, maxRadius: number): number {
  if (dist > maxRadius) return 0;
  return Math.round(100 * (1 - dist / maxRadius));
}

export function fragHitsTarget(
  landX: number,
  landY: number,
  targetX: number,
  targetY: number,
  maxRadius: number,
  segments: readonly Segment[],
): number {
  const dist = Math.hypot(targetX - landX, targetY - landY);
  if (dist > maxRadius) return 0;
  if (!hasLineOfSight(landX, landY, targetX, targetY, segments)) return 0;
  return fragDamageAt(dist, maxRadius);
}

export const FRAG_RADIUS = 220;
