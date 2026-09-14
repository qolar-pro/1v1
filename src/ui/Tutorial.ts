const DISMISS_KEY = "breach:tutorialDismissed";
const AUTO_DISMISS_MS = 18000;

interface BlobDef {
  id: string;
  icon: string;
  text: string;
  style: string;
}

const BLOBS: BlobDef[] = [
  { id: "money", icon: "💰", text: "Your cash — spend it in the Buy Menu each round. Unspent money carries over.", style: "bottom:118px; left:16px;" },
  { id: "shop", icon: "🛒", text: "Press B during the Buy Phase to gear up.", style: "top:88px; left:calc(50% - 260px);" },
  { id: "rounds", icon: "🏆", text: "First to 7 rounds wins the match.", style: "top:88px; left:calc(50% + 40px);" },
  { id: "kills", icon: "⌨️", text: "Hold TAB to see kills, deaths, and the scoreboard.", style: "bottom:96px; left:50%; transform:translateX(-50%);" },
];

function alreadyDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private browsing / storage disabled — tutorial just reappears next time */
  }
}

/** One-time floating hint bubbles pointing at the money/shop/rounds/scoreboard HUD elements, for first-time players. */
export function initTutorial(): void {
  if (alreadyDismissed()) return;

  const root = document.createElement("div");
  root.id = "tutorial-blobs";
  document.body.appendChild(root);

  let remaining = BLOBS.length;
  const finishIfDone = () => {
    if (remaining <= 0) markDismissed();
  };

  for (const b of BLOBS) {
    const el = document.createElement("div");
    el.className = "tut-blob";
    el.style.cssText = b.style;
    el.innerHTML = `<span class="tut-dot">${b.icon}</span><span class="tut-text">${b.text}</span><button class="tut-close" aria-label="Dismiss tip">×</button>`;
    root.appendChild(el);

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      el.remove();
      remaining -= 1;
      finishIfDone();
    };

    el.querySelector(".tut-close")!.addEventListener("click", remove);
    window.setTimeout(remove, AUTO_DISMISS_MS);
  }
}
