import type { MapId } from "../data/maps/loader";

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

function loadSavedNickname(): string {
  try {
    return localStorage.getItem("breach:nickname") ?? "";
  } catch {
    return "";
  }
}

function saveNickname(name: string): void {
  try {
    localStorage.setItem("breach:nickname", name);
  } catch {
    /* private browsing / storage disabled — nickname just won't persist */
  }
}

export function showLandingMenu(onCreate: (nickname: string, mapId: MapId) => void): void {
  const root = ensureOverlay();
  const saved = loadSavedNickname();
  root.innerHTML = `
    <div class="panel">
      <h1>BREACH <span class="accent">1v1</span></h1>
      <p class="sub">A top-down tactical shooter. One link, no accounts, no server.</p>
      <input id="nickname-input" class="text-input" type="text" placeholder="Nickname" maxlength="20" value="${saved}" />
      <div class="map-choice">
        <label><input type="radio" name="map" value="depot" checked /> Depot</label>
        <label><input type="radio" name="map" value="terrace" /> Terrace</label>
      </div>
      <button id="create-btn" class="primary">Create Match</button>
      <p class="fine" title="The host runs the only real simulation and could, in principle, cheat — there is no server to stop that. Only play with people you trust.">
        Note: the match host is authoritative and could theoretically cheat. Play with people you trust.
      </p>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#create-btn")!.addEventListener("click", () => {
    const nickInput = root.querySelector<HTMLInputElement>("#nickname-input")!;
    const nickname = nickInput.value.trim() || "Host";
    saveNickname(nickname);
    const mapId = (root.querySelector<HTMLInputElement>('input[name="map"]:checked')?.value ?? "depot") as MapId;
    onCreate(nickname, mapId);
  });
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

export function showJoinPrompt(onJoin: (nickname: string) => void): void {
  const root = ensureOverlay();
  const saved = loadSavedNickname();
  root.innerHTML = `
    <div class="panel">
      <h1>BREACH <span class="accent">1v1</span></h1>
      <p class="sub">You've been invited to a match.</p>
      <input id="nickname-input" class="text-input" type="text" placeholder="Nickname" maxlength="20" value="${saved}" />
      <button id="join-btn" class="primary">Join Match</button>
    </div>
  `;
  const go = () => {
    const nickInput = root.querySelector<HTMLInputElement>("#nickname-input")!;
    const nickname = nickInput.value.trim() || "Player";
    saveNickname(nickname);
    onJoin(nickname);
  };
  root.querySelector<HTMLButtonElement>("#join-btn")!.addEventListener("click", go);
  root.querySelector<HTMLInputElement>("#nickname-input")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}

export function showWaitingForOpponent(shareUrl: string): void {
  const root = ensureOverlay();
  const canShare = typeof navigator.share === "function";
  root.innerHTML = `
    <div class="panel">
      <h1>BREACH <span class="accent">1v1</span></h1>
      <p class="sub" id="status-line">Waiting for opponent…</p>
      <div class="link-row">
        <input id="share-link" type="text" readonly value="${shareUrl}" />
        <button id="copy-btn">Copy</button>
      </div>
      ${canShare ? '<button id="share-btn" class="primary" style="margin-bottom:1rem;">Share Link</button>' : ""}
      <div class="spinner"></div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>("#copy-btn")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(shareUrl);
  });
  if (canShare) {
    root.querySelector<HTMLButtonElement>("#share-btn")!.addEventListener("click", () => {
      void navigator.share({ title: "BREACH 1v1", text: "Join my match:", url: shareUrl });
    });
  }
}
