import { LOSS_BONUS_LADDER, MONEY_CAP, PLANT_BONUS, DEFUSE_BONUS, ROUND_WIN_REWARD } from "../config";
import type { PlayerState } from "./types";

export function addMoney(player: PlayerState, amount: number): PlayerState {
  return { ...player, money: Math.min(MONEY_CAP, Math.max(0, player.money + amount)) };
}

export function lossBonus(consecutiveLosses: number): number {
  const idx = Math.min(consecutiveLosses, LOSS_BONUS_LADDER.length) - 1;
  return LOSS_BONUS_LADDER[Math.max(0, idx)] ?? LOSS_BONUS_LADDER[0]!;
}

export function roundWinPayout(player: PlayerState): PlayerState {
  return addMoney(player, ROUND_WIN_REWARD);
}

export function roundLossPayout(player: PlayerState, consecutiveLosses: number): PlayerState {
  return addMoney(player, lossBonus(consecutiveLosses));
}

export function killRewardPayout(player: PlayerState, reward: number): PlayerState {
  return addMoney(player, reward);
}

export function plantBonusPayout(player: PlayerState): PlayerState {
  return addMoney(player, PLANT_BONUS);
}

export function defuseBonusPayout(player: PlayerState): PlayerState {
  return addMoney(player, DEFUSE_BONUS);
}

export function canAfford(player: PlayerState, price: number): boolean {
  return player.money >= price;
}

export function spend(player: PlayerState, price: number): PlayerState {
  return { ...player, money: Math.max(0, player.money - price) };
}
