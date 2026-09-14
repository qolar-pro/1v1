import { BUTTON_FIRE, BUTTON_USE, BUTTON_WALK, MAX_PITCH, TOUCH_LOOK_SENSITIVITY } from "../config";
import type { RawInput, WeaponSlot } from "../sim/types";
import type { Controls } from "../render/controls";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const STICK_RADIUS = 55;
const WALK_THRESHOLD = 0.55;

interface StickState {
  pointerId: number | null;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  mag: number;
}

function freshStick(): StickState {
  return { pointerId: null, originX: 0, originY: 0, dx: 0, dy: 0, mag: 0 };
}

/**
 * Mobile first-person controls: left thumb is a virtual joystick (move,
 * relative to camera facing — same convention as WASD), the right half of
 * the screen is a look-around drag surface (standard mobile-FPS pattern),
 * and firing is a dedicated button since "aim" is always screen-center now.
 */
export class TouchControls implements Controls {
  private root: HTMLDivElement;
  private leftBase: HTMLDivElement;
  private leftThumb: HTMLDivElement;
  private left = freshStick();

  private yaw = 0;
  private pitch = 0;
  private lookPointerId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;

  private firing = false;
  private useHeld = false;
  private reloadQueued = false;
  private throwQueued = false;
  private buyToggleQueued = false;
  private wantSlotQueued: WeaponSlot | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "touch-controls";
    this.root.innerHTML = `
      <div class="stick-zone stick-zone-left" id="tc-left-zone">
        <div class="stick-base" id="tc-left-base"><div class="stick-thumb" id="tc-left-thumb"></div></div>
      </div>
      <div class="stick-zone stick-zone-right" id="tc-look-zone"></div>
      <div class="tc-buttons">
        <button class="tc-btn" id="tc-reload">R</button>
        <button class="tc-btn tc-btn-fire" id="tc-fire">FIRE</button>
        <button class="tc-btn" id="tc-use">USE</button>
        <button class="tc-btn" id="tc-grenade">G</button>
        <button class="tc-btn" id="tc-swap">SWAP</button>
        <button class="tc-btn tc-btn-buy" id="tc-buy">BUY</button>
      </div>
    `;
    document.body.appendChild(this.root);

    this.leftBase = document.getElementById("tc-left-base") as HTMLDivElement;
    this.leftThumb = document.getElementById("tc-left-thumb") as HTMLDivElement;
    this.bindMoveStick(document.getElementById("tc-left-zone")!);
    this.bindLookZone(document.getElementById("tc-look-zone")!);

    const fireBtn = document.getElementById("tc-fire")!;
    fireBtn.addEventListener("pointerdown", () => (this.firing = true));
    fireBtn.addEventListener("pointerup", () => (this.firing = false));
    fireBtn.addEventListener("pointercancel", () => (this.firing = false));

    const useBtn = document.getElementById("tc-use")!;
    useBtn.addEventListener("pointerdown", () => (this.useHeld = true));
    useBtn.addEventListener("pointerup", () => (this.useHeld = false));
    useBtn.addEventListener("pointercancel", () => (this.useHeld = false));

    document.getElementById("tc-reload")!.addEventListener("pointerdown", () => (this.reloadQueued = true));
    document.getElementById("tc-grenade")!.addEventListener("pointerdown", () => (this.throwQueued = true));
    document.getElementById("tc-buy")!.addEventListener("pointerdown", () => (this.buyToggleQueued = true));

    const swapCycle: WeaponSlot[] = ["primary", "secondary", "melee"];
    let swapIdx = 1;
    document.getElementById("tc-swap")!.addEventListener("pointerdown", () => {
      swapIdx = (swapIdx + 1) % swapCycle.length;
      this.wantSlotQueued = swapCycle[swapIdx]!;
    });
  }

  private bindMoveStick(zone: HTMLElement): void {
    const stick = this.left;
    const reset = () => {
      stick.pointerId = null;
      stick.dx = 0;
      stick.dy = 0;
      stick.mag = 0;
      this.leftBase.style.opacity = "0";
    };
    reset();

    zone.addEventListener("pointerdown", (e) => {
      if (stick.pointerId !== null) return;
      stick.pointerId = e.pointerId;
      const rect = zone.getBoundingClientRect();
      stick.originX = e.clientX;
      stick.originY = e.clientY;
      this.leftBase.style.left = `${e.clientX - rect.left}px`;
      this.leftBase.style.top = `${e.clientY - rect.top}px`;
      this.leftBase.style.opacity = "1";
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener("pointermove", (e) => {
      if (stick.pointerId !== e.pointerId) return;
      const dx = e.clientX - stick.originX;
      const dy = e.clientY - stick.originY;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, STICK_RADIUS);
      const angle = Math.atan2(dy, dx);
      stick.dx = Math.cos(angle) * clamped;
      stick.dy = Math.sin(angle) * clamped;
      stick.mag = clamped / STICK_RADIUS;
      this.leftThumb.style.transform = `translate(${stick.dx}px, ${stick.dy}px) translate(-50%, -50%)`;
    });
    const end = (e: PointerEvent) => {
      if (stick.pointerId !== e.pointerId) return;
      reset();
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  private bindLookZone(zone: HTMLElement): void {
    zone.addEventListener("pointerdown", (e) => {
      if (this.lookPointerId !== null) return;
      this.lookPointerId = e.pointerId;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener("pointermove", (e) => {
      if (this.lookPointerId !== e.pointerId) return;
      const dx = e.clientX - this.lookLastX;
      const dy = e.clientY - this.lookLastY;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
      this.yaw += dx * TOUCH_LOOK_SENSITIVITY;
      this.pitch = clamp(this.pitch - dy * TOUCH_LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    });
    const end = (e: PointerEvent) => {
      if (this.lookPointerId !== e.pointerId) return;
      this.lookPointerId = null;
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  sample(_dt: number): Omit<RawInput, "dt"> {
    const forward = this.left.mag > 0.08 ? -this.left.dy / STICK_RADIUS : 0;
    const strafe = this.left.mag > 0.08 ? this.left.dx / STICK_RADIUS : 0;

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const moveX = cos * forward - sin * strafe;
    const moveY = sin * forward + cos * strafe;

    let buttons = 0;
    if (this.left.mag > 0 && this.left.mag < WALK_THRESHOLD) buttons |= BUTTON_WALK;
    if (this.firing) buttons |= BUTTON_FIRE;
    if (this.useHeld) buttons |= BUTTON_USE;
    if (this.reloadQueued) {
      this.reloadQueued = false;
      buttons |= 1 << 2; // BUTTON_RELOAD — one-frame tap registers as a level trigger
    }

    const wantSlot = this.wantSlotQueued;
    this.wantSlotQueued = null;
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
    return false;
  }

  destroy(): void {
    this.root.remove();
  }
}

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
