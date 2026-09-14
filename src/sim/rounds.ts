import {
  BOMB_TIMER_S,
  FREEZE_TIME_S,
  ROUND_END_TIME_S,
  ROUND_TIME_S,
  ROUNDS_TOTAL_MAX,
  ROUNDS_TO_WIN,
  SIDE_SWAP_AFTER_ROUND,
} from "../config";
import type { MapDef } from "../data/maps/types";
import type { SmokeVolume } from "./grenades";
import { roundLossPayout, roundWinPayout } from "./economy";
import { createPlayerState, HOST_SLOT, JOINER_SLOT, otherSlot, type PlayerState, type Slot, type WorldState } from "./types";

export type RoundPhase = "freeze" | "live" | "roundend" | "matchend";
export type RoundEndReason = "elimination" | "detonation" | "defused" | "time";

export interface BombState {
  planted: boolean;
  defused: boolean;
  detonated: boolean;
  plantedAtMs: number;
  x: number;
  y: number;
}

export interface MatchState {
  phase: RoundPhase;
  phaseEndsAtMs: number;
  round: number;
  wins: [number, number];
  consecutiveLosses: [number, number];
  raiderSlot: Slot;
  bomb: BombState;
  lastRoundWinner: Slot | null;
  lastRoundReason: RoundEndReason | null;
  matchWinner: Slot | null;
  smokes: SmokeVolume[];
}

function emptyBomb(): BombState {
  return { planted: false, defused: false, detonated: false, plantedAtMs: 0, x: 0, y: 0 };
}

export function createMatchState(nowMs: number): MatchState {
  return {
    phase: "freeze",
    phaseEndsAtMs: nowMs + FREEZE_TIME_S * 1000,
    round: 1,
    wins: [0, 0],
    consecutiveLosses: [0, 0],
    raiderSlot: HOST_SLOT,
    bomb: emptyBomb(),
    lastRoundWinner: null,
    lastRoundReason: null,
    matchWinner: null,
    smokes: [],
  };
}

/** Resets both players to a fresh-round state at their role's spawn point. Money carries over. */
export function respawnForRound(world: WorldState, match: MatchState, map: MapDef): WorldState {
  const players = world.players.map((p, slot) => {
    const role = slot === match.raiderSlot ? "raider" : "warden";
    const spawn = role === "raider" ? map.raiderSpawn : map.wardenSpawn;
    const fresh = createPlayerState(spawn.x, spawn.y, role);
    return { ...fresh, money: p.money, connected: p.connected, kills: p.kills, deaths: p.deaths };
  }) as [PlayerState, PlayerState];
  return { ...world, players };
}

export function beginFreeze(world: WorldState, match: MatchState, map: MapDef, nowMs: number): { world: WorldState; match: MatchState } {
  const nextMatch: MatchState = {
    ...match,
    phase: "freeze",
    phaseEndsAtMs: nowMs + FREEZE_TIME_S * 1000,
    bomb: emptyBomb(),
    smokes: [],
  };
  return { world: respawnForRound(world, nextMatch, map), match: nextMatch };
}

export function transitionToLive(match: MatchState, nowMs: number): MatchState {
  return { ...match, phase: "live", phaseEndsAtMs: nowMs + ROUND_TIME_S * 1000 };
}

export interface RoundEndResult {
  world: WorldState;
  match: MatchState;
}

export function checkLiveRoundEnd(
  world: WorldState,
  match: MatchState,
  nowMs: number,
): { reason: RoundEndReason; winner: Slot } | null {
  const raider = match.raiderSlot;
  const warden = otherSlot(raider);
  const raiderP = world.players[raider];
  const wardenP = world.players[warden];

  if (match.bomb.detonated) return { reason: "detonation", winner: raider };
  if (match.bomb.defused) return { reason: "defused", winner: warden };
  if (!wardenP.connected) return null;
  if (!wardenP.alive) return { reason: "elimination", winner: raider };
  if (!raiderP.alive && !match.bomb.planted) return { reason: "elimination", winner: warden };
  if (match.bomb.planted && nowMs - match.bomb.plantedAtMs >= BOMB_TIMER_S * 1000) {
    return { reason: "detonation", winner: raider };
  }
  if (!match.bomb.planted && nowMs >= match.phaseEndsAtMs) return { reason: "time", winner: warden };
  return null;
}

export function applyRoundEnd(
  world: WorldState,
  match: MatchState,
  winner: Slot,
  reason: RoundEndReason,
  nowMs: number,
): RoundEndResult {
  const loser = otherSlot(winner);
  let players = [...world.players] as [PlayerState, PlayerState];

  const nextConsecutiveLosses: [number, number] = [...match.consecutiveLosses] as [number, number];
  nextConsecutiveLosses[winner] = 0;
  nextConsecutiveLosses[loser] = match.consecutiveLosses[loser] + 1;

  players[winner] = roundWinPayout(players[winner]);
  players[loser] = roundLossPayout(players[loser], nextConsecutiveLosses[loser]);

  const wins: [number, number] = [...match.wins] as [number, number];
  wins[winner] += 1;

  const roundsPlayed = match.round;
  const matchOver = wins[winner] >= ROUNDS_TO_WIN || roundsPlayed >= ROUNDS_TOTAL_MAX;

  const nextMatch: MatchState = {
    ...match,
    phase: matchOver ? "matchend" : "roundend",
    phaseEndsAtMs: nowMs + ROUND_END_TIME_S * 1000,
    wins,
    consecutiveLosses: nextConsecutiveLosses,
    lastRoundWinner: winner,
    lastRoundReason: reason,
    matchWinner: matchOver ? (wins[HOST_SLOT] > wins[JOINER_SLOT] ? HOST_SLOT : JOINER_SLOT) : null,
  };

  return { world: { ...world, players }, match: nextMatch };
}

export function startNextRound(match: MatchState): MatchState {
  const nextRoundNumber = match.round + 1;
  const shouldSwap = match.round === SIDE_SWAP_AFTER_ROUND;
  return {
    ...match,
    round: nextRoundNumber,
    raiderSlot: shouldSwap ? otherSlot(match.raiderSlot) : match.raiderSlot,
  };
}

export function plantBomb(world: WorldState, match: MatchState, slot: Slot, nowMs: number): { world: WorldState; match: MatchState } {
  const player = world.players[slot];
  const players = [...world.players] as [PlayerState, PlayerState];
  players[slot] = { ...player, carryingCharge: false, planting: false, actionProgress: 0 };
  return {
    world: { ...world, players },
    match: { ...match, bomb: { planted: true, defused: false, detonated: false, plantedAtMs: nowMs, x: player.x, y: player.y } },
  };
}

export function defuseBomb(match: MatchState): MatchState {
  return { ...match, bomb: { ...match.bomb, defused: true } };
}

export function tickActionProgress(player: PlayerState, dt: number, durationS: number, active: boolean): PlayerState {
  if (!active) {
    return player.actionProgress > 0 ? { ...player, actionProgress: 0, planting: false, defusing: false } : player;
  }
  const next = Math.min(1, player.actionProgress + dt / durationS);
  return { ...player, actionProgress: next };
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
