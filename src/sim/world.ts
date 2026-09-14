import { WORLD_HEIGHT, WORLD_WIDTH } from "../config";
import { createPlayerState, HOST_SLOT, JOINER_SLOT, type Slot, type WorldState } from "./types";

/**
 * Phase 1 has no map geometry yet — just two spawn points on an empty floor.
 * From Phase 2 onward, spawn points come from data/maps/*.json.
 */
export function defaultSpawn(slot: Slot): { x: number; y: number } {
  const cy = WORLD_HEIGHT / 2;
  return slot === HOST_SLOT
    ? { x: WORLD_WIDTH * 0.25, y: cy }
    : { x: WORLD_WIDTH * 0.75, y: cy };
}

export function createWorld(): WorldState {
  return {
    tick: 0,
    players: [
      createPlayerState(defaultSpawn(HOST_SLOT).x, defaultSpawn(HOST_SLOT).y),
      createPlayerState(defaultSpawn(JOINER_SLOT).x, defaultSpawn(JOINER_SLOT).y),
    ],
  };
}
