import type { PlayerState } from "../sim/types";
import type { MatchView } from "../net/session";
import { getWeapon } from "../data/weapons";

export interface HudState {
  self: PlayerState;
  match: MatchView;
  localWins: number;
  enemyWins: number;
  role: "raider" | "warden";
}

let root: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (root) return root;
  root = document.createElement("div");
  root.id = "game-hud";
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-score" id="hud-score"></div>
      <div class="hud-timer" id="hud-timer"></div>
      <div class="hud-phase" id="hud-phase"></div>
    </div>
    <div class="hud-bottom-left">
      <div class="hud-hp-row">
        <span class="hud-icon hud-icon-hp"></span>
        <div class="hud-bar"><div class="hud-bar-fill hud-hp-fill" id="hud-hp-fill"></div></div>
        <span id="hud-hp-num"></span>
      </div>
      <div class="hud-hp-row">
        <span class="hud-icon hud-icon-armor"></span>
        <div class="hud-bar"><div class="hud-bar-fill hud-armor-fill" id="hud-armor-fill"></div></div>
        <span id="hud-armor-num"></span>
      </div>
      <div class="hud-money" id="hud-money"></div>
    </div>
    <div class="hud-bottom-right">
      <div class="hud-weapon" id="hud-weapon"></div>
      <div class="hud-ammo" id="hud-ammo"></div>
    </div>
    <div class="hud-bomb" id="hud-bomb" hidden></div>
    <div class="hud-action" id="hud-action" hidden>
      <div class="hud-action-bar"><div class="hud-action-fill" id="hud-action-fill"></div></div>
      <div id="hud-action-label"></div>
    </div>
    <div class="hud-flash" id="hud-flash"></div>
  `;
  document.body.appendChild(root);
  return root;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function updateHud(state: HudState): void {
  ensure();
  const { self, match, localWins, enemyWins, role } = state;

  el("hud-score").textContent = `${localWins} : ${enemyWins}`;

  const secs = Math.ceil(match.phaseRemainingMs / 1000);
  const m = Math.floor(Math.max(0, secs) / 60);
  const s = Math.max(0, secs) % 60;
  el("hud-timer").textContent = `${m}:${s.toString().padStart(2, "0")}`;

  const phaseLabel =
    match.phase === "freeze"
      ? "BUY PHASE"
      : match.phase === "live"
        ? role === "raider"
          ? "RAIDER"
          : "WARDEN"
        : match.phase === "roundend"
          ? "ROUND OVER"
          : "MATCH OVER";
  el("hud-phase").textContent = phaseLabel;

  el("hud-hp-fill").style.width = `${Math.max(0, self.hp)}%`;
  el("hud-hp-num").textContent = `${Math.round(self.hp)}`;
  el("hud-armor-fill").style.width = `${Math.max(0, self.armor)}%`;
  el("hud-armor-num").textContent = `${Math.round(self.armor)}${self.helmet ? " (H)" : ""}`;
  el("hud-money").textContent = `$${self.money}`;

  const slot = self.loadout.active;
  const weaponId = slot === "primary" ? self.loadout.primary : slot === "secondary" ? self.loadout.secondary : self.loadout.melee;
  const weapon = weaponId ? getWeapon(weaponId) : null;
  el("hud-weapon").textContent = weapon ? weapon.name : "";
  const ammo = self.ammo[slot];
  el("hud-ammo").textContent = weapon && weapon.class !== "melee" ? (self.reloading ? "reloading…" : `${ammo.inMag} / ${ammo.reserve}`) : "";

  const bombEl = el("hud-bomb");
  if (match.bomb.planted && !match.bomb.defused) {
    bombEl.hidden = false;
    bombEl.textContent = `CHARGE ARMED — ${Math.ceil(match.bomb.remainingMs / 1000)}s`;
  } else {
    bombEl.hidden = true;
  }

  const actionEl = el("hud-action");
  const actionFill = el<HTMLDivElement>("hud-action-fill");
  const actionLabel = el("hud-action-label");
  if (self.planting || self.defusing) {
    actionEl.hidden = false;
    actionFill.style.width = `${self.actionProgress * 100}%`;
    actionLabel.textContent = self.planting ? "Planting…" : "Defusing…";
  } else {
    actionEl.hidden = true;
  }

  const flashEl = el("hud-flash");
  const nowMs = performance.now();
  const flashRemaining = self.flashedUntilMs - nowMs;
  flashEl.style.opacity = flashRemaining > 0 ? String(Math.min(1, flashRemaining / 900)) : "0";
}

export function hideHud(): void {
  root?.remove();
  root = null;
}
