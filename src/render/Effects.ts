import Phaser from "phaser";

const TRACER_MS = 60;
const FLASH_MS = 50;
const IMPACT_MAX = 40;

/** Cheap, short-lived cosmetic effects: muzzle flash, tracers, impact decals, hit-flash, damage indicator. */
export class Effects {
  private readonly scene: Phaser.Scene;
  private impacts: Phaser.GameObjects.Arc[] = [];
  private damageIndicatorGfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.damageIndicatorGfx = scene.add.graphics().setScrollFactor(0).setDepth(50).setAlpha(0);
  }

  muzzleFlash(x: number, y: number, angle: number): void {
    const flash = this.scene.add.circle(x + Math.cos(angle) * 22, y + Math.sin(angle) * 22, 8, 0xfff2c4, 0.95);
    flash.setDepth(30);
    this.scene.tweens.add({ targets: flash, alpha: 0, scale: 1.6, duration: FLASH_MS, onComplete: () => flash.destroy() });
  }

  tracer(x1: number, y1: number, x2: number, y2: number): void {
    const line = this.scene.add.line(0, 0, x1, y1, x2, y2, 0xfff6d8, 0.9).setLineWidth(1.5);
    line.setOrigin(0, 0);
    line.setDepth(29);
    this.scene.tweens.add({ targets: line, alpha: 0, duration: TRACER_MS, onComplete: () => line.destroy() });
  }

  impact(x: number, y: number): void {
    const dot = this.scene.add.circle(x, y, 2.5, 0x2a2a2a, 0.8).setDepth(5);
    this.impacts.push(dot);
    if (this.impacts.length > IMPACT_MAX) this.impacts.shift()?.destroy();
  }

  hitFlash(target: Phaser.GameObjects.Arc, baseColor: number): void {
    target.setFillStyle(0xffffff);
    this.scene.time.delayedCall(50, () => target.setFillStyle(baseColor));
  }

  screenShake(intensity = 0.004, durationMs = 70): void {
    this.scene.cameras.main.shake(durationMs, intensity);
  }

  /** Flashes a red wedge on the edge of the screen pointing toward an angle (radians, world-space) the damage came from. */
  damageIndicator(cameraAngleToSource: number): void {
    const cam = this.scene.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const r = Math.min(cam.width, cam.height) * 0.42;
    const px = cx + Math.cos(cameraAngleToSource) * r;
    const py = cy + Math.sin(cameraAngleToSource) * r;

    this.damageIndicatorGfx.clear();
    this.damageIndicatorGfx.fillStyle(0xff3b3b, 0.85);
    const spread = 0.35;
    this.damageIndicatorGfx.beginPath();
    this.damageIndicatorGfx.moveTo(px, py);
    this.damageIndicatorGfx.lineTo(
      cx + Math.cos(cameraAngleToSource - spread) * (r - 40),
      cy + Math.sin(cameraAngleToSource - spread) * (r - 40),
    );
    this.damageIndicatorGfx.lineTo(
      cx + Math.cos(cameraAngleToSource + spread) * (r - 40),
      cy + Math.sin(cameraAngleToSource + spread) * (r - 40),
    );
    this.damageIndicatorGfx.closePath();
    this.damageIndicatorGfx.fillPath();
    this.damageIndicatorGfx.setAlpha(1);
    this.scene.tweens.add({ targets: this.damageIndicatorGfx, alpha: 0, duration: 500 });
  }

  shellCasing(x: number, y: number, angle: number): void {
    const perp = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    const casing = this.scene.add.rectangle(x, y, 3, 1.5, 0xd8c060, 0.9).setDepth(4);
    const dist = 10 + Math.random() * 10;
    this.scene.tweens.add({
      targets: casing,
      x: x + Math.cos(perp) * dist,
      y: y + Math.sin(perp) * dist,
      alpha: 0,
      duration: 350,
      onComplete: () => casing.destroy(),
    });
  }
}
