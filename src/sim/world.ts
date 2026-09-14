import type { MapDef } from "../data/maps/types";
import { createPlayerState, HOST_SLOT, JOINER_SLOT, type Slot, type WorldState } from "./types";

/** Round 1 always starts with host as Raider, joiner as Warden; rounds.ts swaps sides at round 6. */
export function defaultSpawn(slot: Slot, map: MapDef): { x: number; y: number } {
  return slot === HOST_SLOT ? { ...map.raiderSpawn } : { ...map.wardenSpawn };
}

export function createWorld(map: MapDef): WorldState {
  const hostSpawn = defaultSpawn(HOST_SLOT, map);
  const joinerSpawn = defaultSpawn(JOINER_SLOT, map);
  return {
    tick: 0,
    players: [createPlayerState(hostSpawn.x, hostSpawn.y, "raider"), createPlayerState(joinerSpawn.x, joinerSpawn.y, "warden")],
  };
}
