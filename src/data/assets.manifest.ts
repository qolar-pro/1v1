/**
 * Logical asset keys -> files in public/assets/. Swapping art (generating a
 * new texture/icon and dropping it in) never requires touching render code —
 * only this manifest. Keys with no file fall back to a flat procedural
 * color/material in the renderer.
 */
export const ASSET_MANIFEST = {
  "floor.concrete": "/assets/floor_concrete.png",
  "wall.metal": "/assets/wall_metal.png",
  "material.gunmetal": "/assets/gunmetal.png",
  "material.crate": "/assets/crate_steel.png",
  "material.fabric": "/assets/fabric_tactical.png",
  "icon.shard": "/assets/icons/shard.png",
  "icon.tacker": "/assets/icons/tacker.png",
  "icon.mule": "/assets/icons/mule.png",
  "icon.hornet": "/assets/icons/hornet.png",
  "icon.sweeper": "/assets/icons/sweeper.png",
  "icon.vector9": "/assets/icons/vector9.png",
  "icon.kestrel": "/assets/icons/kestrel.png",
  "icon.longshot": "/assets/icons/longshot.png",
} as const;

export type AssetKey = keyof typeof ASSET_MANIFEST;

export function assetUrl(key: AssetKey): string {
  return ASSET_MANIFEST[key];
}
