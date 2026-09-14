import { BUTTON_FIRE, BUTTON_USE, BUTTON_WALK } from "../config";
import type { RawInput, WeaponSlot } from "../sim/types";
import type { Controls } from "../render/controls";

const STICK_RADIUS = 55;
const WALK_THRESHOLD = 0.55;
const FIRE_DEADZONE = 0.35;

interface StickState {
  pointerId: number | null;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  mag: number; // 0..1
}

function freshStick(): StickState {
  return { pointerId: null, originX: 0, originY: 0, dx: 0, dy: 0, mag: 0 };
}

/**
 * Dual virtual sticks: left thumb moves, right thumb aims and fires past a
 * deadzone (no separate fire button — matches the spec's "twin-stick, not
 * a fire button" guidance). Contextual bottom-right buttons for reload,
 * grenade, use/plant-defuse, and cycling weapons.
 */
export class TouchControls implements Controls {
  private root: HTMLDivElement;
  private leftBase: HTMLDivElement;
  private leftThumb: HTMLDivElement;
  private rightBase: HTMLDivElement;
  private rightThumb: HTMLDivElement;

  private left = freshStick();
  private right = freshStick();

  private useHeld = false;
  private reloadQueued = false;
  private throwQueued = false;
  private buyToggleQueued = false;
  private wantSlotQueued: WeaponSlot | null = null;
  private lastAimAngle = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "touch-controls";
    this.root.innerHTML = `
      <div class="stick-zone stick-zone-left" id="tc-left-zone">
        <div class="stick-base" id="tc-left-base"><div class="stick-thumb" id="tc-left-thumb"></div></div>
      </div>
      <div class="stick-zone stick-zone-right" id="tc-right-zone">
        <div class="stick-base" id="tc-right-base"><div class="stick-thumb" id="tc-right-thumb"></div></div>
      </div>
      <div class="tc-buttons">
        <button class="tc-btn" id="tc-reload">R</button>
        <button class="tc-btn" id="tc-use">USE</button>
        <button class="tc-btn" id="tc-grenade">G</button>
        <button class="tc-btn" id="tc-swap">SWAP</button>
        <button class="tc-btn tc-btn-buy" id="tc-buy">BUY</button>
      </div>
    `;
    document.body.appendChild(this.root);

    this.leftBase = document.getElementById("tc-left-base") as HTMLDivElement;
    this.leftThumb = document.getElementById("tc-left-thumb") as HTMLDivElement;
    this.rightBase = document.getElementById("tc-right-base") as HTMLDivElement;
    this.rightThumb = document.getElementById("tc-right-thumb") as HTMLDivElement;

    this.bindZone(document.getElementById("tc-left-zone")!, this.left, this.leftBase, this.leftThumb);
    this.bindZone(document.getElementById("tc-right-zone")!, this.right, this.rightBase, this.rightThumb);

    const useBtn = document.getElementById("tc-use")!;
    useBtn.addEventListener("pointerdown", () => (this.useHeld = true));
    useBtn.addEventListener("pointerup", () => (this.useHeld = false));
    useBtn.addEventListener("pointercancel", () => (this.useHeld = false));

    document.getElementById("tc-reload")!.addEventListener("pointerdown", () => (this.reloadQueued = true));
    document.getElementById("tc-grenade")!.addEventListener("pointerdown", () => (this.throwQueued = true));
    document.getElementById("tc-buy")!.addEventListener("pointerdown", () => (this.buyToggleQueued = true));

    let swapCycle: WeaponSlot[] = ["primary", "secondary", "melee"];
    let swapIdx = 1;
    document.getElementById("tc-swap")!.addEventListener("pointerdown", () => {
      swapIdx = (swapIdx + 1) % swapCycle.length;
      this.wantSlotQueued = swapCycle[swapIdx]!;
    });
  }

  private bindZone(zone: HTMLElement, stick: StickState, base: HTMLDivElement, thumb: HTMLDivElement): void {
    const reset = () => {
      stick.pointerId = null;
      stick.dx = 0;
      stick.dy = 0;
      stick.mag = 0;
      base.style.opacity = "0";
    };
    reset();

    zone.addEventListener("pointerdown", (e) => {
      if (stick.pointerId !== null) return;
      stick.pointerId = e.pointerId;
      const rect = zone.getBoundingClientRect();
      stick.originX = e.clientX;
      stick.originY = e.clientY;
      base.style.left = `${e.clientX - rect.left}px`;
      base.style.top = `${e.clientY - rect.top}px`;
      base.style.opacity = "1";
      thumb.style.transform = `translate(-50%, -50%)`;
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
      thumb.style.transform = `translate(${stick.dx - 0}px, ${stick.dy - 0}px) translate(-50%, -50%)`;
    });

    const end = (e: PointerEvent) => {
      if (stick.pointerId !== e.pointerId) return;
      reset();
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  sample(_dt: number): Omit<RawInput, "dt"> {
    const moveX = this.left.mag > 0.08 ? this.left.dx / STICK_RADIUS : 0;
    const moveY = this.left.mag > 0.08 ? this.left.dy / STICK_RADIUS : 0;

    let aimAngle = this.lastAimAngle;
    let buttons = 0;
    if (this.right.mag > FIRE_DEADZONE) {
      aimAngle = Math.atan2(this.right.dy, this.right.dx);
      this.lastAimAngle = aimAngle;
      buttons |= BUTTON_FIRE;
    } else if (this.left.mag > 0.08) {
      aimAngle = Math.atan2(this.left.dy, this.left.dx);
      this.lastAimAngle = aimAngle;
    }

    if (this.left.mag > 0 && this.left.mag < WALK_THRESHOLD) buttons |= BUTTON_WALK;
    if (this.useHeld) buttons |= BUTTON_USE;

    const wantSlot = this.wantSlotQueued;
    this.wantSlotQueued = null;
    const throwGrenade = this.throwQueued;
    this.throwQueued = false;

    if (this.reloadQueued) {
      this.reloadQueued = false;
      // Reload is level-triggered in the sim (BUTTON_RELOAD), but a tap should
      // still register — OR it in for this one frame via buttons directly.
      buttons |= 1 << 2;
    }

    return { moveX, moveY, aimAngle, buttons, wantSlot, throwGrenade };
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
