import type { PlayerState } from "../sim/types";

let root: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (root) return root;
  root = document.createElement("div");
  root.id = "scoreboard";
  root.hidden = true;
  document.body.appendChild(root);
  return root;
}

export function renderScoreboard(
  local: PlayerState,
  localRole: string,
  localName: string,
  remote: PlayerState,
  remoteRole: string,
  remoteName: string,
  localWins: number,
  remoteWins: number,
): void {
  const el = ensure();
  el.innerHTML = `
    <div class="scoreboard-panel">
      <div class="scoreboard-title">${localWins} : ${remoteWins}</div>
      <table>
        <thead><tr><th>Player</th><th>Role</th><th>K</th><th>D</th><th>$</th></tr></thead>
        <tbody>
          <tr class="you"><td>${localName} (You)</td><td>${localRole}</td><td>${local.kills}</td><td>${local.deaths}</td><td>$${local.money}</td></tr>
          <tr><td>${remoteName}</td><td>${remoteRole}</td><td>${remote.kills}</td><td>${remote.deaths}</td><td>$${remote.money}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

export function showScoreboard(): void {
  ensure().hidden = false;
}

export function hideScoreboard(): void {
  ensure().hidden = true;
}
