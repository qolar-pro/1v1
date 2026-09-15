import { BUTTON_FIRE, BUTTON_JUMP, BUTTON_RELOAD, BUTTON_USE, BUTTON_WALK, MAX_PITCH, MOUSE_SENSITIVITY } from "../config";
import type { RawInput, WeaponSlot } from "../sim/types";
import type { Controls } from "./controls";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Game-bound keys only — preventDefault()'d while pointer-locked so Space
// doesn't scroll the page, Tab doesn't shift focus off the canvas, etc.
// Deliberately doesn't touch F-keys/Ctrl-combos/Escape: those are the
// player's escape hatches and browsers won't let a page override the truly
// OS-level ones (Alt+Tab, Win key, Ctrl+Alt+Del) no matter what.
const PREVENTABLE_KEYS = new Set([
  "Space", "Tab", "KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyE", "KeyG", "KeyB",
  "Digit1", "Digit2", "Digit3", "Digit4", "ShiftLeft", "ShiftRight",
]);

interface KeyboardLockNavigator {
  keyboard?: { lock?: (codes?: string[]) => Promise<void> };
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
    if (PREVENTABLE_KEYS.has(e.code) && document.pointerLockElement === this.canvas) e.preventDefault();
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
    this.yaw += e.movementX * MOUSE_SENSITIVITY;
    this.pitch -= e.movementY * MOUSE_SENSITIVITY;
    this.pitch = clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
  };
  private readonly onClick = () => {
    if (document.pointerLockElement !== this.canvas) {
      // Pointer lock first and unconditionally — it's the feature that
      // actually matters. Fullscreen/keyboard-lock are best-effort
      // enhancements layered on after, each wrapped so a throw or rejection
      // from either (both are flaky across browsers/embedded contexts) can
      // never prevent mouse-look from working.
      void this.canvas.requestPointerLock();
      try {
        // Fullscreen the whole page, NOT the canvas -- requesting fullscreen
        // on the canvas element itself makes it the fullscreen root, which
        // hides every sibling DOM element (HUD, crosshair, buy menu, every
        // overlay) since they aren't descendants of it. Real regression
        // caught live: reported as "can't see any UI, can't exit."
        if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      } catch {
        // Fullscreen is optional; pointer lock above already fired.
      }
      try {
        // Captures Tab/Alt/etc. from being intercepted by the browser chrome
        // while locked. Chromium-only, requires fullscreen to take effect,
        // and Escape can never be locked — that's the browser's guaranteed,
        // unblockable way out, by design.
        const kb = (navigator as unknown as KeyboardLockNavigator).keyboard;
        kb?.lock?.().catch(() => undefined);
      } catch {
        // Keyboard Lock is optional too.
      }
    }
  };
  // Releasing focus (alt-tab, clicking another window, switching tabs) never
  // fires `keyup` for whatever was held — without this, movement/fire could
  // get stuck "on" forever after tabbing back in. This was the actual bug
  // behind "shortcuts interrupt gameplay": not that they were leaking out
  // (mouse deltas were already gated on pointer-lock), but that returning
  // from one left the game in a stuck-input state.
  private readonly onLossOfControl = () => {
    this.down.clear();
    this.firing = false;
  };
  private readonly onVisibilityChange = () => {
    if (document.hidden) this.onLossOfControl();
  };
  private readonly onPointerLockChange = () => {
    if (document.pointerLockElement !== this.canvas) this.onLossOfControl();
  };
  private readonly onContextMenu = (e: MouseEvent) => e.preventDefault();

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("blur", this.onLossOfControl);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
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
    // forward vector = (cos, sin) in sim (x,y)/(x,z) space; right = (-sin, cos).
    const moveX = cos * forward - sin * strafe;
    const moveY = sin * forward + cos * strafe;

    let buttons = 0;
    if (this.down.has("ShiftLeft") || this.down.has("ShiftRight")) buttons |= BUTTON_WALK;
    if (this.firing) buttons |= BUTTON_FIRE;
    if (this.down.has("KeyR")) buttons |= BUTTON_RELOAD;
    if (this.down.has("KeyE")) buttons |= BUTTON_USE;
    if (this.down.has("Space")) buttons |= BUTTON_JUMP;

    let wantSlot: WeaponSlot | null = null;
    if (this.down.has("Digit1")) wantSlot = "primary";
    else if (this.down.has("Digit2")) wantSlot = "secondary";
    else if (this.down.has("Digit3") || this.down.has("Digit4")) wantSlot = "melee";

    const throwGrenade = this.throwQueued;
    this.throwQueued = false;

    return { moveX, moveY, aimAngle: this.yaw, buttons, wantSlot, throwGrenade, pitch: this.pitch };
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
    window.removeEventListener("blur", this.onLossOfControl);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }
}
