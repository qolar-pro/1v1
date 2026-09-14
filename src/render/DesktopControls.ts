import Phaser from "phaser";
import { BUTTON_FIRE, BUTTON_RELOAD, BUTTON_USE, BUTTON_WALK } from "../config";
import type { RawInput, WeaponSlot } from "../sim/types";
import type { Controls } from "./controls";

export class DesktopControls implements Controls {
  private readonly scene: Phaser.Scene;
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private buyToggleQueued = false;
  private throwQueued = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const kb = scene.input.keyboard!;
    this.keys = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      r: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      e: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      b: kb.addKey(Phaser.Input.Keyboard.KeyCodes.B),
      g: kb.addKey(Phaser.Input.Keyboard.KeyCodes.G),
      tab: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
      one: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      three: kb.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      four: kb.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
    };
    this.keys["b"]!.on("down", () => (this.buyToggleQueued = true));
    this.keys["g"]!.on("down", () => (this.throwQueued = true));
  }

  sample(_dt: number, localX: number, localY: number): Omit<RawInput, "dt"> {
    let moveX = 0;
    let moveY = 0;
    if (this.keys["a"]!.isDown) moveX -= 1;
    if (this.keys["d"]!.isDown) moveX += 1;
    if (this.keys["w"]!.isDown) moveY -= 1;
    if (this.keys["s"]!.isDown) moveY += 1;

    const pointer = this.scene.input.activePointer;
    const aimAngle = Phaser.Math.Angle.Between(localX, localY, pointer.worldX, pointer.worldY);

    let buttons = 0;
    if (this.keys["shift"]!.isDown) buttons |= BUTTON_WALK;
    if (pointer.leftButtonDown()) buttons |= BUTTON_FIRE;
    if (this.keys["r"]!.isDown) buttons |= BUTTON_RELOAD;
    if (this.keys["e"]!.isDown) buttons |= BUTTON_USE;

    let wantSlot: WeaponSlot | null = null;
    if (this.keys["one"]!.isDown) wantSlot = "primary";
    else if (this.keys["two"]!.isDown) wantSlot = "secondary";
    else if (this.keys["three"]!.isDown || this.keys["four"]!.isDown) wantSlot = "melee";

    const throwGrenade = this.throwQueued;
    this.throwQueued = false;

    return { moveX, moveY, aimAngle, buttons, wantSlot, throwGrenade };
  }

  consumeBuyToggle(): boolean {
    const q = this.buyToggleQueued;
    this.buyToggleQueued = false;
    return q;
  }

  isScoreboardHeld(): boolean {
    return this.keys["tab"]!.isDown;
  }

  destroy(): void {
    // Phaser tears keys down with the scene; nothing extra to release.
  }
}
