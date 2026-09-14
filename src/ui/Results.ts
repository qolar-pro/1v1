let bannerEl: HTMLDivElement | null = null;
let matchEndEl: HTMLDivElement | null = null;

function ensureBanner(): HTMLDivElement {
  if (bannerEl) return bannerEl;
  bannerEl = document.createElement("div");
  bannerEl.id = "round-banner";
  bannerEl.hidden = true;
  document.body.appendChild(bannerEl);
  return bannerEl;
}

const REASON_TEXT: Record<string, string> = {
  elimination: "Eliminated",
  detonation: "Charge Detonated",
  defused: "Charge Defused",
  time: "Time Expired",
};

export function showRoundBanner(youWon: boolean, reason: string): void {
  const el = ensureBanner();
  el.hidden = false;
  el.innerHTML = `
    <div class="round-banner-inner ${youWon ? "win" : "loss"}">
      <div class="round-banner-title">${youWon ? "Round Won" : "Round Lost"}</div>
      <div class="round-banner-sub">${REASON_TEXT[reason] ?? reason}</div>
    </div>
  `;
}

export function hideRoundBanner(): void {
  if (bannerEl) bannerEl.hidden = true;
}

function ensureMatchEnd(): HTMLDivElement {
  if (matchEndEl) return matchEndEl;
  matchEndEl = document.createElement("div");
  matchEndEl.id = "match-end";
  matchEndEl.hidden = true;
  document.body.appendChild(matchEndEl);
  return matchEndEl;
}

export function showMatchEnd(youWon: boolean, localWins: number, enemyWins: number, onRematch: () => void): void {
  const el = ensureMatchEnd();
  el.hidden = false;
  el.innerHTML = `
    <div class="match-end-panel">
      <div class="match-end-title ${youWon ? "win" : "loss"}">${youWon ? "Victory" : "Defeat"}</div>
      <div class="match-end-score">${localWins} : ${enemyWins}</div>
      <button class="primary" id="rematch-btn">Rematch</button>
      <p class="fine">Waiting for both players to be ready starts a fresh match on the same link.</p>
    </div>
  `;
  el.querySelector("#rematch-btn")?.addEventListener("click", onRematch);
}

export function hideMatchEnd(): void {
  if (matchEndEl) matchEndEl.hidden = true;
}
