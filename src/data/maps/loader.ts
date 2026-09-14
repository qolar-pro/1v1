import depotJson from "./depot.json";
import terraceJson from "./terrace.json";
import { finalizeMap, type MapDef, type MapJson } from "./types";

const REGISTRY: Record<string, MapJson> = {
  depot: depotJson as MapJson,
  terrace: terraceJson as MapJson,
};

export type MapId = "depot" | "terrace";

export function loadMap(id: MapId): MapDef {
  const json = REGISTRY[id];
  if (!json) throw new Error(`Unknown map id: ${id}`);
  return finalizeMap(json);
}

export const MAP_IDS: MapId[] = ["depot", "terrace"];
