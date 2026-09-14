import type { RawInput, Slot, WorldState } from "../sim/types";

export interface NetStats {
  role: "host" | "client";
  strategy: "nostr" | "torrent" | "-";
  pingMs: number | null;
  tick: number;
  lastInputBytes: number;
  lastSnapshotBytes: number;
  /** Client only: magnitude (px) of the most recent reconciliation correction. */
  correctionPx: number;
  connected: boolean;
}

export function createNetStats(role: "host" | "client"): NetStats {
  return {
    role,
    strategy: "-",
    pingMs: null,
    tick: 0,
    lastInputBytes: 0,
    lastSnapshotBytes: 0,
    correctionPx: 0,
    connected: false,
  };
}

/**
 * Common surface GameScene renders against, regardless of whether this tab
 * is the host or the joining client.
 */
export interface NetSession {
  readonly localSlot: Slot;
  readonly stats: NetStats;
  /** Feed one freshly sampled local input for this render frame. */
  handleLocalInput(input: RawInput): void;
  /** World state to draw right now (predicted/authoritative local, interpolated remote). */
  getRenderState(nowMs: number): WorldState;
  dispose(): void;
}
