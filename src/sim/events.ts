import type { HitZoneName } from "./combat";
import type { RoundEndReason } from "./rounds";
import type { Slot } from "./types";

/**
 * One-shot game events emitted by the host each tick (shots, plants,
 * round transitions, …) and carried in the next outgoing snapshot for the
 * client to render/play — cosmetic and audio triggers, never authoritative
 * state by themselves (that lives in PlayerWire/MatchWire).
 */
export type GameEvent =
  | { type: "shot"; shooter: Slot; x: number; y: number; angle: number; weaponId: string; hit: boolean; hitX?: number; hitY?: number; zone?: HitZoneName; killed?: boolean }
  | { type: "melee"; shooter: Slot; x: number; y: number; angle: number; hit: boolean; killed?: boolean; backstab?: boolean }
  | { type: "reload"; slot: Slot }
  | { type: "planted"; x: number; y: number }
  | { type: "defused" }
  | { type: "roundStart"; round: number }
  | { type: "roundEnd"; winner: Slot; reason: RoundEndReason }
  | { type: "matchEnd"; winner: Slot }
  | { type: "flashed"; slot: Slot; durationMs: number }
  | { type: "thrown"; kind: "flash" | "smoke" | "frag"; slot: Slot; x: number; y: number }
  | { type: "buy"; slot: Slot; itemId: string };
