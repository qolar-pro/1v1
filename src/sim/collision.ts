import type { WallRect } from "../data/maps/types";

/**
 * Pushes a circle out of any overlapping axis-aligned rects. Deterministic
 * given (x, y, radius, walls) — run identically by host and client.
 */
export function resolveWallCollisions(x: number, y: number, radius: number, walls: readonly WallRect[]): {
  x: number;
  y: number;
} {
  let px = x;
  let py = y;

  // A couple of passes stabilizes corner cases (overlapping walls) without
  // the cost of a full iterative solver — plenty for axis-aligned rects.
  for (let pass = 0; pass < 2; pass++) {
    for (const wall of walls) {
      const closestX = clamp(px, wall.x, wall.x + wall.w);
      const closestY = clamp(py, wall.y, wall.y + wall.h);
      const dx = px - closestX;
      const dy = py - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq >= radius * radius) continue;

      if (distSq > 0) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        px += (dx / dist) * push;
        py += (dy / dist) * push;
      } else {
        // Center is exactly inside the rect: push out along the shallowest axis.
        const left = px - wall.x;
        const right = wall.x + wall.w - px;
        const top = py - wall.y;
        const bottom = wall.y + wall.h - py;
        const min = Math.min(left, right, top, bottom);
        if (min === left) px = wall.x - radius;
        else if (min === right) px = wall.x + wall.w + radius;
        else if (min === top) py = wall.y - radius;
        else py = wall.y + wall.h + radius;
      }
    }
  }

  return { x: px, y: py };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
