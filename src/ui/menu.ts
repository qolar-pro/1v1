let overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "ui-overlay";
  document.body.appendChild(overlay);
  return overlay;
}

export function clearOverlay(): void {
  if (overlay) overlay.innerHTML = "";
}

export function hideOverlay(): void {
  overlay?.remove();
  overlay = null;
}

export function showLandingMenu(onCreate: () => void): void {
  const root = ensureOverlay();
  root.innerHTML = `
    <div class="panel">
      <h1>BREACH <span class="accent">1v1</span></h1>
      <p class="sub">A top-down tactical shooter. One link, no accounts, no server.</p>
      <button id="create-btn" class="primary">Create Match</button>
      <p class="fine" title="The host runs the only real simulation and could, in principle, cheat — there is no server to stop that. Only play with people you trust.">
        Note: the match host is authoritative and could theoretically cheat. Play with people you trust.
      </p>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#create-btn")!.addEventListener("click", onCreate);
}

export function showConnecting(text: string): void {
  const root = ensureOverlay();
  root.innerHTML = `
    <div class="panel">
      <h1>BREACH <span class="accent">1v1</span></h1>
      <p class="sub" id="status-line">${text}</p>
      <div class="spinner"></div>
    </div>
  `;
}

export function updateConnecting(text: string): void {
  const line = overlay?.querySelector<HTMLParagraphElement>("#status-line");
  if (line) line.textContent = text;
  else showConnecting(text);
}

export function showWaitingForOpponent(shareUrl: string): void {
  const root = ensureOverlay();
  root.innerHTML = `
    <div class="panel">
      <h1>BREACH <span class="accent">1v1</span></h1>
      <p class="sub" id="status-line">Waiting for opponent…</p>
      <div class="link-row">
        <input id="share-link" type="text" readonly value="${shareUrl}" />
        <button id="copy-btn">Copy</button>
      </div>
      <div class="spinner"></div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#copy-btn")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(shareUrl);
  });
}
