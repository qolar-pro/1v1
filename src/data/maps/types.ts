export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface PlantSite {
  x: number;
  y: number;
  radius: number;
}

/** Raw shape of a map's JSON file. */
export interface MapJson {
  id: string;
  name: string;
  width: number;
  height: number;
  walls: WallRect[];
  props: WallRect[];
  raiderSpawn: MapPoint;
  wardenSpawn: MapPoint;
  plantSite: PlantSite;
}

/** All wall-like geometry (structural walls + cover props) merged for collision/raycast purposes. */
export interface MapDef extends MapJson {
  solids: WallRect[];
}

export function finalizeMap(json: MapJson): MapDef {
  return { ...json, solids: [...json.walls, ...json.props] };
}
