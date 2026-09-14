import Phaser from "phaser";
import "./ui/styles.css";
import { GameScene } from "./render/GameScene";
import { HostSession } from "./net/host";
import { ClientSession } from "./net/client";
import { connectRoom, makeRoomId } from "./net/trystero";
import { clearOverlay, hideOverlay, showLandingMenu, showConnecting, showWaitingForOpponent, updateConnecting } from "./ui/menu";
import { WORLD_HEIGHT, WORLD_WIDTH } from "./config";
import type { NetSession } from "./net/session";

const ROOM_HASH_RE = /(?:^|[#&])r=([A-Za-z0-9]+)/;

function parseRoomId(): string | null {
  const m = ROOM_HASH_RE.exec(location.hash);
  return m ? m[1]! : null;
}

function shareUrl(roomId: string): string {
  return `${location.origin}${location.pathname}#r=${roomId}`;
}

function launchGame(session: NetSession): void {
  clearOverlay();
  hideOverlay();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#141414",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scene: new GameScene(session),
  });
  if (import.meta.env.DEV) {
    (window as unknown as { __breachGame: Phaser.Game; __breachSession: NetSession }).__breachGame = game;
    (window as unknown as { __breachSession: NetSession }).__breachSession = session;
  }
}

async function runAsHost(roomId: string): Promise<void> {
  showWaitingForOpponent(shareUrl(roomId));
  const { room, strategy, firstPeerId } = await connectRoom(roomId, updateConnecting);
  const session = new HostSession(room, firstPeerId, strategy);
  launchGame(session);
}

async function runAsClient(roomId: string): Promise<void> {
  showConnecting("Connecting to host…");
  const { room, strategy, firstPeerId } = await connectRoom(roomId, updateConnecting);
  const session = new ClientSession(room, firstPeerId, strategy);
  launchGame(session);
}

function boot(): void {
  const roomId = parseRoomId();

  if (!roomId) {
    showLandingMenu(() => {
      const newRoomId = makeRoomId();
      localStorage.setItem(`breach:host:${newRoomId}`, "1");
      history.replaceState(null, "", `#r=${newRoomId}`);
      void runAsHost(newRoomId);
    });
    return;
  }

  const isHost = localStorage.getItem(`breach:host:${roomId}`) === "1";
  if (isHost) {
    void runAsHost(roomId);
  } else {
    void runAsClient(roomId);
  }
}

// Sanity check the world dimensions are wired through before anything renders.
console.info(`[breach] world ${WORLD_WIDTH}x${WORLD_HEIGHT}`);

boot();
