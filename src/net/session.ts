import type { RawInput, Slot, WorldState } from "../sim/types";
import type { RoundEndReason, RoundPhase } from "../sim/rounds";
import type { GameEvent } from "../sim/events";
import type { MapDef } from "../data/maps/types";

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

/** Presentation-friendly view of round/economy/bomb state, uniform whether it's local (host) or decoded off the wire (client). */
export interface MatchView {
  phase: RoundPhase;
  phaseRemainingMs: number;
  round: number;
  wins: [number, number];
  raiderSlot: Slot;
  bomb: { planted: boolean; defused: boolean; detonated: boolean; remainingMs: number; x: number; y: number };
  lastRoundWinner: Slot | null;
  lastRoundReason: RoundEndReason | null;
  matchWinner: Slot | null;
  smokes: { x: number; y: number; remainingMs: number }[];
}

/**
 * Common surface GameScene/UI renders against, regardless of whether this tab
 * is the host or the joining client.
 */
export interface NetSession {
  readonly localSlot: Slot;
  readonly stats: NetStats;
  /** Feed one freshly sampled local input for this render frame. */
  handleLocalInput(input: RawInput): void;
  /** World state to draw right now (predicted/authoritative local, interpolated remote). */
  getRenderState(nowMs: number): WorldState;
  getMatchView(nowMs: number): MatchView;
  getMap(): MapDef;
  /** Drains and returns events emitted since the last call (shots, plants, round transitions, …). */
  drainEvents(): GameEvent[];
  buyItem(kind: "weapon" | "utility", id: string): void;
  requestRematch(): void;
  getNicknames(): { local: string; remote: string };
  dispose(): void;
}
