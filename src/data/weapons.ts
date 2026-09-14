/**
 * All weapon/utility balance in one place. Original names — no trademarked
 * terms anywhere. Prices, damage, and fire rate follow BUILD_PROGRESS.md's
 * design spec; spray patterns are hand-authored angular offset arrays
 * (radians) applied on top of the base inaccuracy cone, one entry per shot,
 * so automatic weapons recoil in a learnable, repeatable pattern.
 */

export type WeaponClass = "melee" | "pistol" | "smg" | "rifle" | "sniper";

export interface WeaponDef {
  id: string;
  name: string;
  class: WeaponClass;
  price: number;
  damage: number;
  /** Rounds per minute. */
  rpm: number;
  killReward: number;
  magSize: number;
  reserveMax: number;
  reloadTimeS: number;
  /** Base spread half-angle (radians) at a dead stop, unscoped. */
  baseInaccuracy: number;
  /** Extra spread (radians) added at full movement speed. */
  movementInaccuracy: number;
  /** Extra spread (radians) applied while airborne (reserved for future jump support). */
  jumpInaccuracy: number;
  /** How fast inaccuracy recovers per second toward baseInaccuracy after firing. */
  recoverPerSecond: number;
  /** Per-shot angular offsets (radians), applied cyclically for automatics. */
  sprayPattern: number[];
  armorPiercing: boolean;
  scoped: boolean;
  moveSpeedMult: number;
  automatic: boolean;
  /** True melee-only backstab multiplier target (knife). */
  backstabMult?: number;
}

function generateSpray(count: number, horizAmp: number, vertAmp: number, seedShift = 0): number[] {
  // Deterministic pseudo-random-looking but fixed spray: climbs then widens,
  // same idea as a real per-weapon recoil pattern — learnable because it's
  // identical every time.
  const pattern: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const climb = -vertAmp * Math.min(1, t * 2.2); // pulls "up" (visualized as angle bias)
    const wobble = Math.sin(i * 2.4 + seedShift) * horizAmp * (0.3 + t * 0.7);
    pattern.push(climb + wobble);
  }
  return pattern;
}

export const WEAPONS: Record<string, WeaponDef> = {
  shard: {
    id: "shard",
    name: "Shard",
    class: "melee",
    price: 0,
    damage: 55,
    rpm: 120,
    killReward: 1500,
    magSize: Infinity,
    reserveMax: Infinity,
    reloadTimeS: 0,
    baseInaccuracy: 0,
    movementInaccuracy: 0,
    jumpInaccuracy: 0,
    recoverPerSecond: 0,
    sprayPattern: [],
    armorPiercing: false,
    scoped: false,
    moveSpeedMult: 1.05,
    automatic: false,
    backstabMult: 180 / 55,
  },
  tacker: {
    id: "tacker",
    name: "Tacker",
    class: "pistol",
    price: 0,
    damage: 32,
    rpm: 400,
    killReward: 300,
    magSize: 15,
    reserveMax: 60,
    reloadTimeS: 1.8,
    baseInaccuracy: 0.02,
    movementInaccuracy: 0.05,
    jumpInaccuracy: 0.09,
    recoverPerSecond: 6,
    sprayPattern: generateSpray(30, 0.012, 0.01, 1),
    armorPiercing: false,
    scoped: false,
    moveSpeedMult: 1,
    automatic: false,
  },
  mule: {
    id: "mule",
    name: "Mule",
    class: "pistol",
    price: 0,
    damage: 29,
    rpm: 400,
    killReward: 300,
    magSize: 16,
    reserveMax: 64,
    reloadTimeS: 1.8,
    baseInaccuracy: 0.02,
    movementInaccuracy: 0.05,
    jumpInaccuracy: 0.09,
    recoverPerSecond: 6,
    sprayPattern: generateSpray(30, 0.012, 0.01, 2),
    armorPiercing: false,
    scoped: false,
    moveSpeedMult: 1,
    automatic: false,
  },
  hornet: {
    id: "hornet",
    name: "Hornet",
    class: "pistol",
    price: 600,
    damage: 36,
    rpm: 350,
    killReward: 300,
    magSize: 12,
    reserveMax: 48,
    reloadTimeS: 2,
    baseInaccuracy: 0.018,
    movementInaccuracy: 0.055,
    jumpInaccuracy: 0.1,
    recoverPerSecond: 5.5,
    sprayPattern: generateSpray(30, 0.014, 0.012, 3),
    armorPiercing: true,
    scoped: false,
    moveSpeedMult: 0.98,
    automatic: false,
  },
  sweeper: {
    id: "sweeper",
    name: "Sweeper",
    class: "smg",
    price: 1250,
    damage: 27,
    rpm: 750,
    killReward: 600,
    magSize: 30,
    reserveMax: 90,
    reloadTimeS: 2.4,
    baseInaccuracy: 0.03,
    movementInaccuracy: 0.045,
    jumpInaccuracy: 0.09,
    recoverPerSecond: 7,
    sprayPattern: generateSpray(30, 0.02, 0.018, 4),
    armorPiercing: false,
    scoped: false,
    moveSpeedMult: 1.02,
    automatic: true,
  },
  vector9: {
    id: "vector9",
    name: "Vector-9",
    class: "rifle",
    price: 2700,
    damage: 36,
    rpm: 600,
    killReward: 300,
    magSize: 30,
    reserveMax: 90,
    reloadTimeS: 3,
    baseInaccuracy: 0.024,
    movementInaccuracy: 0.09,
    jumpInaccuracy: 0.14,
    recoverPerSecond: 5,
    sprayPattern: generateSpray(30, 0.026, 0.024, 5),
    armorPiercing: true,
    scoped: false,
    moveSpeedMult: 0.94,
    automatic: true,
  },
  kestrel: {
    id: "kestrel",
    name: "Kestrel",
    class: "rifle",
    price: 3100,
    damage: 33,
    rpm: 666,
    killReward: 300,
    magSize: 25,
    reserveMax: 75,
    reloadTimeS: 2.8,
    baseInaccuracy: 0.02,
    movementInaccuracy: 0.08,
    jumpInaccuracy: 0.13,
    recoverPerSecond: 5.5,
    sprayPattern: generateSpray(30, 0.02, 0.02, 6),
    armorPiercing: true,
    scoped: false,
    moveSpeedMult: 0.95,
    automatic: true,
  },
  longshot: {
    id: "longshot",
    name: "Longshot",
    class: "sniper",
    price: 4750,
    damage: 115,
    rpm: 41,
    killReward: 100,
    magSize: 5,
    reserveMax: 20,
    reloadTimeS: 3.4,
    baseInaccuracy: 0.006,
    movementInaccuracy: 0.16,
    jumpInaccuracy: 0.22,
    recoverPerSecond: 3,
    sprayPattern: [],
    armorPiercing: true,
    scoped: true,
    moveSpeedMult: 0.86,
    automatic: false,
  },
};

export type WeaponId = keyof typeof WEAPONS;

export const RAIDER_STARTER: WeaponId = "mule";
export const WARDEN_STARTER: WeaponId = "tacker";

export const BUYABLE_WEAPONS: WeaponId[] = ["hornet", "sweeper", "vector9", "kestrel", "longshot"];

export interface UtilityDef {
  id: string;
  name: string;
  price: number;
}

export const UTILITY: Record<string, UtilityDef> = {
  armor: { id: "armor", name: "Armor", price: 650 },
  armorHelmet: { id: "armorHelmet", name: "Armor + Helmet", price: 1000 },
  defuseKit: { id: "defuseKit", name: "Defuse Kit", price: 400 },
  flash: { id: "flash", name: "Flash", price: 200 },
  smoke: { id: "smoke", name: "Smoke", price: 300 },
  frag: { id: "frag", name: "Frag", price: 300 },
};

export const GRENADE_MAX: Record<"flash" | "smoke" | "frag", number> = { flash: 2, smoke: 1, frag: 1 };

export function getWeapon(id: string): WeaponDef {
  const w = WEAPONS[id];
  if (!w) throw new Error(`Unknown weapon id: ${id}`);
  return w;
}
