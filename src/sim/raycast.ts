import type { WallRect } from "../data/maps/types";
import { VISION_FAR, VISION_FOV_DEG, VISION_NEAR } from "../config";

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function wallsToSegments(walls: readonly WallRect[]): Segment[] {
  const segs: Segment[] = [];
  for (const w of walls) {
    segs.push({ x1: w.x, y1: w.y, x2: w.x + w.w, y2: w.y });
    segs.push({ x1: w.x + w.w, y1: w.y, x2: w.x + w.w, y2: w.y + w.h });
    segs.push({ x1: w.x + w.w, y1: w.y + w.h, x2: w.x, y2: w.y + w.h });
    segs.push({ x1: w.x, y1: w.y + w.h, x2: w.x, y2: w.y });
  }
  return segs;
}

export interface RayHit {
  dist: number;
  x: number;
  y: number;
}

export interface OccludingCircle {
  x: number;
  y: number;
  radius: number;
}

function intersectRayCircle(ox: number, oy: number, dx: number, dy: number, circle: OccludingCircle): number | null {
  const lx = circle.x - ox;
  const ly = circle.y - oy;
  const proj = lx * dx + ly * dy;
  const closestX = ox + dx * Math.max(0, proj);
  const closestY = oy + dy * Math.max(0, proj);
  const distSq = (closestX - circle.x) ** 2 + (closestY - circle.y) ** 2;
  if (distSq > circle.radius * circle.radius) return null;
  const backOff = Math.sqrt(circle.radius * circle.radius - distSq);
  const t = proj - backOff;
  return t >= 0 ? t : null;
}

/** Nearest intersection of a ray (origin, direction, maxDist) against walls and (optionally) smoke volumes. */
export function raycast(
  ox: number,
  oy: number,
  dirX: number,
  dirY: number,
  maxDist: number,
  segments: readonly Segment[],
  smoke: readonly OccludingCircle[] = [],
): RayHit {
  let nearest = maxDist;
  for (const seg of segments) {
    const t = intersectRaySegment(ox, oy, dirX, dirY, seg);
    if (t !== null && t < nearest) nearest = t;
  }
  for (const circle of smoke) {
    const t = intersectRayCircle(ox, oy, dirX, dirY, circle);
    if (t !== null && t < nearest) nearest = t;
  }
  return { dist: nearest, x: ox + dirX * nearest, y: oy + dirY * nearest };
}

/** Ray/segment intersection distance along the ray, or null if no hit. */
function intersectRaySegment(ox: number, oy: number, dx: number, dy: number, seg: Segment): number | null {
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return null;

  const t = ((seg.x1 - ox) * sy - (seg.y1 - oy) * sx) / denom;
  const u = ((seg.x1 - ox) * dy - (seg.y1 - oy) * dx) / denom;

  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}

export function hasLineOfSight(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  segments: readonly Segment[],
  smoke: readonly OccludingCircle[] = [],
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return true;
  const hit = raycast(x1, y1, dx / dist, dy / dist, dist - 0.5, segments, smoke);
  return hit.dist >= dist - 0.5;
}

function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
}

function shortestAngleDiff(a: number, b: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Fan of ray-hit points sweeping [centerAngle - halfSpread, centerAngle + halfSpread]. */
export function sweepRays(
  ox: number,
  oy: number,
  centerAngle: number,
  halfSpread: number,
  maxDist: number,
  rayCount: number,
  segments: readonly Segment[],
  smoke: readonly OccludingCircle[] = [],
): RayHit[] {
  const hits: RayHit[] = [];
  const start = centerAngle - halfSpread;
  const step = rayCount > 1 ? (halfSpread * 2) / (rayCount - 1) : 0;
  for (let i = 0; i < rayCount; i++) {
    const angle = start + step * i;
    hits.push(raycast(ox, oy, Math.cos(angle), Math.sin(angle), maxDist, segments, smoke));
  }
  return hits;
}

const FOV_HALF_RAD = (VISION_FOV_DEG * Math.PI) / 180 / 2;

/**
 * Cone (far, FOV-limited) + near-radius (360°, wall-occluded) visibility rays
 * for the local player, used to build the fog-of-war mask.
 */
export function computeVisionRays(
  ox: number,
  oy: number,
  facingAngle: number,
  segments: readonly Segment[],
  farRayCount: number,
  nearRayCount: number,
  smoke: readonly OccludingCircle[] = [],
): { cone: RayHit[]; near: RayHit[] } {
  const cone = sweepRays(ox, oy, facingAngle, FOV_HALF_RAD, VISION_FAR, farRayCount, segments, smoke);
  const near = sweepRays(ox, oy, 0, Math.PI, VISION_NEAR, nearRayCount, segments, smoke);
  return { cone, near };
}

/** Whether `target` is visible to a viewer standing at (ox,oy) facing `facingAngle`. */
export function canSee(
  ox: number,
  oy: number,
  facingAngle: number,
  targetX: number,
  targetY: number,
  segments: readonly Segment[],
  smoke: readonly OccludingCircle[] = [],
): boolean {
  const dx = targetX - ox;
  const dy = targetY - oy;
  const dist = Math.hypot(dx, dy);

  const withinNear = dist <= VISION_NEAR;
  let withinCone = false;
  if (!withinNear) {
    if (dist > VISION_FAR) return false;
    const angleToTarget = Math.atan2(dy, dx);
    const diff = Math.abs(shortestAngleDiff(normalizeAngle(facingAngle), normalizeAngle(angleToTarget)));
    withinCone = diff <= FOV_HALF_RAD;
  }
  if (!withinNear && !withinCone) return false;

  return hasLineOfSight(ox, oy, targetX, targetY, segments, smoke);
}

export { shortestAngleDiff };
