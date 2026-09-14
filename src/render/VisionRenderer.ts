import Phaser from "phaser";
import { computeVisionRays } from "../sim/raycast";
import type { Segment } from "../sim/raycast";
import type { OccludingCircle } from "../sim/raycast";
import { VISION_FAR_RAYS, VISION_NEAR_RAYS } from "../config";

/**
 * Fog-of-war: a "lit" copy of the world is masked to only the local player's
 * visibility polygon (cone + near-radius, both wall/smoke-occluded); a dark
 * copy sits underneath and shows through everywhere else. Opponent
 * visibility itself is decided by sim/raycast.canSee — this class only
 * renders the mask.
 */
export class VisionRenderer {
  private maskGfx: Phaser.GameObjects.Graphics;
  private mask: Phaser.Display.Masks.GeometryMask;

  constructor(scene: Phaser.Scene) {
    this.maskGfx = scene.add.graphics();
    this.maskGfx.setVisible(false);
    this.mask = this.maskGfx.createGeometryMask();
  }

  applyTo(target: Phaser.GameObjects.Container): void {
    target.setMask(this.mask);
  }

  update(originX: number, originY: number, facingAngle: number, segments: readonly Segment[], smoke: readonly OccludingCircle[]): void {
    const { cone, near } = computeVisionRays(originX, originY, facingAngle, segments, VISION_FAR_RAYS, VISION_NEAR_RAYS, smoke);

    this.maskGfx.clear();
    this.maskGfx.fillStyle(0xffffff, 1);

    this.maskGfx.beginPath();
    this.maskGfx.moveTo(originX, originY);
    for (const hit of cone) this.maskGfx.lineTo(hit.x, hit.y);
    this.maskGfx.closePath();
    this.maskGfx.fillPath();

    this.maskGfx.beginPath();
    const first = near[0];
    if (first) this.maskGfx.moveTo(first.x, first.y);
    for (const hit of near) this.maskGfx.lineTo(hit.x, hit.y);
    this.maskGfx.closePath();
    this.maskGfx.fillPath();
  }

  destroy(): void {
    this.maskGfx.destroy();
  }
}
