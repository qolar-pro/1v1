import { joinRoom as joinNostrRoom } from "trystero/nostr";
import { joinRoom as joinTorrentRoom } from "@trystero-p2p/torrent";
import type { JoinRoomConfig, Room } from "trystero";
import { APP_ID } from "../config";

const NOSTR_CONNECT_TIMEOUT_MS = 6000;

export type NetStrategy = "nostr" | "torrent";

export interface ConnectedRoom {
  room: Room;
  strategy: NetStrategy;
  firstPeerId: string;
}

function waitForFirstPeer(room: Room, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      room.onPeerJoin = null;
      resolve(null);
    }, timeoutMs);
    room.onPeerJoin = (peerId) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(peerId);
    };
  });
}

/**
 * Joins the match room. Tries the nostr signaling strategy first (fast,
 * reliable relays); if no peer shows up within NOSTR_CONNECT_TIMEOUT_MS,
 * falls back to the BitTorrent tracker strategy. Both strategies rendezvous
 * on the same (appId, roomId) pair, so whichever side falls back last still
 * finds the other once both have converged on torrent.
 */
export async function connectRoom(
  roomId: string,
  onStatus?: (status: string) => void,
): Promise<ConnectedRoom> {
  const config: JoinRoomConfig = { appId: APP_ID };

  onStatus?.("Connecting (nostr)…");
  const nostrRoom = joinNostrRoom(config, roomId);
  const nostrPeer = await waitForFirstPeer(nostrRoom, NOSTR_CONNECT_TIMEOUT_MS);
  if (nostrPeer !== null) {
    return { room: nostrRoom, strategy: "nostr", firstPeerId: nostrPeer };
  }

  onStatus?.("Falling back to torrent signaling…");
  await nostrRoom.leave();
  const torrentRoom = joinTorrentRoom(config, roomId);
  const torrentPeer = await waitForFirstPeer(torrentRoom, Number.POSITIVE_INFINITY);
  return { room: torrentRoom, strategy: "torrent", firstPeerId: torrentPeer! };
}

export function makeRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
