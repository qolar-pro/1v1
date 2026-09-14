import type { NetStats } from "../net/session";

let el: HTMLDivElement | null = null;

function ensureEl(): HTMLDivElement {
  if (el) return el;
  el = document.createElement("div");
  el.id = "debug-hud";
  document.body.appendChild(el);
  return el;
}

export function updateDebugHud(stats: NetStats): void {
  const node = ensureEl();
  const ping = stats.pingMs === null ? "…" : `${stats.pingMs}ms`;
  node.textContent =
    `role: ${stats.role} (${stats.strategy})  ` +
    `ping: ${ping}  ` +
    `tick: ${stats.tick}  ` +
    `in: ${stats.lastInputBytes}B  ` +
    `snap: ${stats.lastSnapshotBytes}B  ` +
    `correction: ${stats.correctionPx.toFixed(2)}px  ` +
    (stats.connected ? "" : " [PEER DISCONNECTED]");
}

export function hideDebugHud(): void {
  ensureEl().remove();
  el = null;
}
