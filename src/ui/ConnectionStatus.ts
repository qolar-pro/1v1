let el: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (el) return el;
  el = document.createElement("div");
  el.id = "connection-status";
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

export function showReconnecting(secondsLeft: number): void {
  const node = ensure();
  node.hidden = false;
  node.innerHTML = `
    <div class="conn-panel">
      <div class="spinner"></div>
      <p>Opponent disconnected — reconnecting… (${secondsLeft}s)</p>
    </div>
  `;
}

export function showPeerGone(isHost: boolean, onLeave: () => void): void {
  const node = ensure();
  node.hidden = false;
  node.innerHTML = `
    <div class="conn-panel">
      <h2>${isHost ? "Opponent disconnected" : "Host left"}</h2>
      <p>${isHost ? "They didn't reconnect in time." : "The host closed the match — a client can't take over hosting."}</p>
      <button class="primary" id="conn-leave-btn">Back to menu</button>
    </div>
  `;
  node.querySelector("#conn-leave-btn")?.addEventListener("click", onLeave);
}

export function hideConnectionStatus(): void {
  if (el) el.hidden = true;
}
