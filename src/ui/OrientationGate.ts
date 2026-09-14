let el: HTMLDivElement | null = null;

/** Landscape-only gate for touch devices: shows a "rotate your device" overlay in portrait. */
export function installOrientationGate(): void {
  if (el) return;
  el = document.createElement("div");
  el.id = "orientation-gate";
  el.className = "touch-active";
  el.innerHTML = `<div><div style="font-size:2rem;margin-bottom:0.5rem;">⤾</div><p>Rotate your device to landscape to play.</p></div>`;
  document.body.appendChild(el);
}
