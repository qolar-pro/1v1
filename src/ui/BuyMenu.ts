import { BUYABLE_WEAPONS, GRENADE_MAX, UTILITY, WEAPONS, getWeapon } from "../data/weapons";
import type { PlayerState, Role } from "../sim/types";

export type BuyHandler = (kind: "weapon" | "utility", id: string) => void;

let root: HTMLDivElement | null = null;
let visible = false;
let onBuy: BuyHandler = () => undefined;

function ensure(): HTMLDivElement {
  if (root) return root;
  root = document.createElement("div");
  root.id = "buy-menu";
  root.hidden = true;
  document.body.appendChild(root);
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>("[data-kind][data-id]");
    if (!item) return;
    const kind = item.dataset["kind"] as "weapon" | "utility";
    const id = item.dataset["id"]!;
    onBuy(kind, id);
  });
  return root;
}

function weaponRow(id: string, player: PlayerState): string {
  const w = getWeapon(id);
  const affordable = player.money >= w.price;
  const equipped = player.loadout.primary === id || player.loadout.secondary === id;
  return `
    <button class="buy-item ${equipped ? "equipped" : ""}" data-kind="weapon" data-id="${id}" ${affordable ? "" : "disabled"}>
      <span class="buy-item-name">${w.name}</span>
      <span class="buy-item-price">$${w.price}</span>
    </button>
  `;
}

function utilRow(id: string, label: string, player: PlayerState, disabled: boolean, countLabel = ""): string {
  const u = UTILITY[id]!;
  const affordable = player.money >= u.price;
  return `
    <button class="buy-item" data-kind="utility" data-id="${id}" ${affordable && !disabled ? "" : "disabled"}>
      <span class="buy-item-name">${label}${countLabel}</span>
      <span class="buy-item-price">$${u.price}</span>
    </button>
  `;
}

export function initBuyMenu(handler: BuyHandler): void {
  onBuy = handler;
  ensure();
}

export function renderBuyMenu(player: PlayerState, role: Role): void {
  const el = ensure();
  const pistols = BUYABLE_WEAPONS.filter((id) => WEAPONS[id]!.class === "pistol");
  const smgs = BUYABLE_WEAPONS.filter((id) => WEAPONS[id]!.class === "smg");
  const rifles = BUYABLE_WEAPONS.filter((id) => WEAPONS[id]!.class === "rifle");
  const snipers = BUYABLE_WEAPONS.filter((id) => WEAPONS[id]!.class === "sniper");

  el.innerHTML = `
    <div class="buy-sheet">
      <div class="buy-header">
        <h2>Buy — <span class="buy-money">$${player.money}</span></h2>
        <button class="buy-close" id="buy-close">Close (B)</button>
      </div>
      <div class="buy-columns">
        <div class="buy-col">
          <h3>Pistols</h3>
          ${pistols.map((id) => weaponRow(id, player)).join("")}
          <h3>SMG</h3>
          ${smgs.map((id) => weaponRow(id, player)).join("")}
        </div>
        <div class="buy-col">
          <h3>Rifles</h3>
          ${rifles.map((id) => weaponRow(id, player)).join("")}
          <h3>Sniper</h3>
          ${snipers.map((id) => weaponRow(id, player)).join("")}
        </div>
        <div class="buy-col">
          <h3>Armor</h3>
          ${utilRow("armor", "Armor", player, player.armor >= 100 && player.helmet)}
          ${utilRow("armorHelmet", "Armor + Helmet", player, player.armor >= 100 && player.helmet)}
          ${role === "warden" ? utilRow("defuseKit", "Defuse Kit", player, player.hasDefuseKit) : ""}
          <h3>Utility</h3>
          ${utilRow("flash", "Flash", player, player.grenades.flash >= GRENADE_MAX.flash, ` (${player.grenades.flash}/${GRENADE_MAX.flash})`)}
          ${utilRow("smoke", "Smoke", player, player.grenades.smoke >= GRENADE_MAX.smoke, ` (${player.grenades.smoke}/${GRENADE_MAX.smoke})`)}
          ${utilRow("frag", "Frag", player, player.grenades.frag >= GRENADE_MAX.frag, ` (${player.grenades.frag}/${GRENADE_MAX.frag})`)}
        </div>
      </div>
    </div>
  `;
  el.querySelector("#buy-close")?.addEventListener("click", () => hideBuyMenu());
}

export function showBuyMenu(player: PlayerState, role: Role): void {
  visible = true;
  renderBuyMenu(player, role);
  ensure().hidden = false;
}

export function hideBuyMenu(): void {
  visible = false;
  ensure().hidden = true;
}

export function toggleBuyMenu(player: PlayerState, role: Role): void {
  if (visible) hideBuyMenu();
  else showBuyMenu(player, role);
}

export function isBuyMenuOpen(): boolean {
  return visible;
}
