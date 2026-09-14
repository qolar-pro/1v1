import { BUTTON_FIRE, BUTTON_RELOAD, BUTTON_USE, BUTTON_WALK, MAX_PITCH, MOUSE_SENSITIVITY } from "../config";
import type { RawInput, WeaponSlot } from "../sim/types";
import type { Controls } from "./controls";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Mouse-look (pointer-lock) + WASD first-person controls. `yaw` doubles as
 * the sim-facing angle sent in every input sample; `pitch` is local-only
 * camera tilt.
 */
export class DesktopControls implements Controls {
  private yaw = 0;
  private pitch = 0;
  private down = new Set<string>();
  private firing = false;
  private buyToggleQueued = false;
  private throwQueued = false;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.down.add(e.code);
    if (e.code === "KeyB") this.buyToggleQueued = true;
    if (e.code === "KeyG") this.throwQueued = true;
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.down.delete(e.code);
  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.firing = true;
  };
  private readonly onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.firing = false;
  };
  private readonly onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
    this.pitch -= e.movementY * MOUSE_SENSITIVITY;
    this.pitch = clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
  };
  private readonly onClick = () => {
    if (document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock();
    }
  };

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("click", this.onClick);
  }

  sample(_dt: number): Omit<RawInput, "dt"> {
    let forward = 0;
    let strafe = 0;
    if (this.down.has("KeyW")) forward += 1;
    if (this.down.has("KeyS")) forward -= 1;
    if (this.down.has("KeyD")) strafe += 1;
    if (this.down.has("KeyA")) strafe -= 1;

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    // forward vector = (cos, sin) in sim (x,y)/(x,z) space; right = forward rotated -90deg.
    const moveX = cos * forward + sin * strafe;
    const moveY = sin * forward - cos * strafe;

    let buttons = 0;
    if (this.down.has("ShiftLeft") || this.down.has("ShiftRight")) buttons |= BUTTON_WALK;
    if (this.firing) buttons |= BUTTON_FIRE;
    if (this.down.has("KeyR")) buttons |= BUTTON_RELOAD;
    if (this.down.has("KeyE")) buttons |= BUTTON_USE;

    let wantSlot: WeaponSlot | null = null;
    if (this.down.has("Digit1")) wantSlot = "primary";
    else if (this.down.has("Digit2")) wantSlot = "secondary";
    else if (this.down.has("Digit3") || this.down.has("Digit4")) wantSlot = "melee";

    const throwGrenade = this.throwQueued;
    this.throwQueued = false;

    return { moveX, moveY, aimAngle: this.yaw, buttons, wantSlot, throwGrenade };
  }

  getPitch(): number {
    return this.pitch;
  }

  consumeBuyToggle(): boolean {
    const q = this.buyToggleQueued;
    this.buyToggleQueued = false;
    return q;
  }

  isScoreboardHeld(): boolean {
    return this.down.has("Tab");
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("click", this.onClick);
  }
}
