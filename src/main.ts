import "./ui/styles.css";
import { Scene3D } from "./render/Scene3D";
import { HostSession } from "./net/host";
import { ClientSession } from "./net/client";
import { connectRoom, makeRoomId } from "./net/trystero";
import {
  clearOverlay,
  hideOverlay,
  showLandingMenu,
  showConnecting,
  showJoinPrompt,
  showWaitingForOpponent,
  updateConnecting,
} from "./ui/menu";
import type { MapId } from "./data/maps/loader";
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
  const container = document.getElementById("app")!;
  const scene = new Scene3D(session, container);
  if (import.meta.env.DEV) {
    (window as unknown as { __breachScene: Scene3D; __breachSession: NetSession }).__breachScene = scene;
    (window as unknown as { __breachSession: NetSession }).__breachSession = session;
  }
}

async function runAsHost(roomId: string, nickname: string, mapId: MapId): Promise<void> {
  showWaitingForOpponent(shareUrl(roomId));
  const { room, strategy, firstPeerId } = await connectRoom(roomId, updateConnecting);
  const session = new HostSession(room, firstPeerId, strategy, mapId, nickname);
  launchGame(session);
}

async function runAsClient(roomId: string, nickname: string): Promise<void> {
  showConnecting("Connecting to host…");
  const { room, strategy, firstPeerId } = await connectRoom(roomId, updateConnecting);
  const session = new ClientSession(room, firstPeerId, strategy, nickname);
  launchGame(session);
}

function boot(): void {
  const roomId = parseRoomId();

  if (!roomId) {
    showLandingMenu((nickname, mapId) => {
      const newRoomId = makeRoomId();
      localStorage.setItem(`breach:host:${newRoomId}`, "1");
      localStorage.setItem(`breach:map:${newRoomId}`, mapId);
      history.replaceState(null, "", `#r=${newRoomId}`);
      void runAsHost(newRoomId, nickname, mapId);
    });
    return;
  }

  const isHost = localStorage.getItem(`breach:host:${roomId}`) === "1";
  if (isHost) {
    // A host reloading/reopening its own match link — skip the nickname
    // prompt and reuse whatever was saved when the match was created.
    const nickname = (() => {
      try {
        return localStorage.getItem("breach:nickname") ?? "Host";
      } catch {
        return "Host";
      }
    })();
    const mapId = ((): MapId => {
      try {
        return (localStorage.getItem(`breach:map:${roomId}`) as MapId) ?? "depot";
      } catch {
        return "depot";
      }
    })();
    void runAsHost(roomId, nickname, mapId);
  } else {
    showJoinPrompt((nickname) => {
      void runAsClient(roomId, nickname);
    });
  }
}

boot();
