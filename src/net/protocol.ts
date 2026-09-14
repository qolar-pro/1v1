import type { WeaponSlot } from "../sim/types";
import type { PlayerState } from "../sim/types";
import type { BombState, MatchState, RoundEndReason, RoundPhase } from "../sim/rounds";
import type { GameEvent } from "../sim/events";
import { BOMB_TIMER_S } from "../config";

/**
 * Input packets stay a tuple — small, fixed-shape, sent at render-frame
 * frequency, worth every byte. Snapshot payloads (player/match state) use
 * short-keyed objects instead: the field count grew a lot across combat,
 * rounds, and economy, and positional-tuple indices became too easy to get
 * wrong silently. Bandwidth cost is trivial for a 1v1 data channel either way.
 */
export type InputWire = [
  seq: number,
  moveX: number,
  moveY: number,
  aimAngle: number,
  buttons: number,
  dt: number,
  wantSlot: WeaponSlot | 0,
  throwGrenade: 0 | 1,
  pitch: number,
];

function round(v: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

export function encodeInput(input: {
  seq: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  buttons: number;
  dt: number;
  wantSlot: WeaponSlot | null;
  throwGrenade: boolean;
  pitch: number;
}): InputWire {
  return [
    input.seq,
    round(input.moveX),
    round(input.moveY),
    round(input.aimAngle, 4),
    input.buttons,
    round(input.dt, 4),
    input.wantSlot ?? 0,
    input.throwGrenade ? 1 : 0,
    round(input.pitch, 4),
  ];
}

export function decodeInput(wire: InputWire): {
  seq: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  buttons: number;
  dt: number;
  wantSlot: WeaponSlot | null;
  throwGrenade: boolean;
  pitch: number;
} {
  const [seq, moveX, moveY, aimAngle, buttons, dt, wantSlot, throwGrenade, pitch] = wire;
  return {
    seq,
    moveX,
    moveY,
    aimAngle,
    buttons,
    dt,
    wantSlot: wantSlot === 0 ? null : wantSlot,
    throwGrenade: throwGrenade === 1,
    pitch,
  };
}

export interface PlayerWire {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number; // angle
  c: 0 | 1; // connected
  seq: number; // lastProcessedSeq
  hp: number;
  ar: number; // armor
  hl: 0 | 1; // helmet
  al: 0 | 1; // alive
  w: string; // active weapon id
  am: number; // ammo in mag
  ar2: number; // ammo reserve
  rl: number; // reload remaining ms (0 = not reloading)
  wk: 0 | 1; // walking
  ia: number; // inaccuracy (radians)
  mo: number; // money
  dk: 0 | 1; // has defuse kit
  gf: number; // grenades: flash
  gs: number; // grenades: smoke
  gn: number; // grenades: frag
  fl: number; // flash remaining ms
  cc: 0 | 1; // carrying charge
  pl: 0 | 1; // planting
  df: 0 | 1; // defusing
  ap: number; // action progress 0..1
  k: number; // kills
  d: number; // deaths
  jz: number; // jumpZ (height above floor)
}

export function encodePlayer(p: PlayerState, nowMs: number): PlayerWire {
  const ammo = p.ammo[p.loadout.active];
  return {
    x: round(p.x, 1),
    y: round(p.y, 1),
    vx: round(p.vx, 1),
    vy: round(p.vy, 1),
    a: round(p.angle, 4),
    c: p.connected ? 1 : 0,
    seq: p.lastProcessedSeq,
    hp: Math.round(p.hp),
    ar: Math.round(p.armor),
    hl: p.helmet ? 1 : 0,
    al: p.alive ? 1 : 0,
    w: activeWeaponIdOf(p),
    am: ammo.inMag,
    ar2: ammo.reserve,
    rl: p.reloading ? Math.max(0, Math.round(p.reloadEndsAtMs - nowMs)) : 0,
    wk: p.walking ? 1 : 0,
    ia: round(p.inaccuracy, 4),
    mo: p.money,
    dk: p.hasDefuseKit ? 1 : 0,
    gf: p.grenades.flash,
    gs: p.grenades.smoke,
    gn: p.grenades.frag,
    fl: Math.max(0, Math.round(p.flashedUntilMs - nowMs)),
    cc: p.carryingCharge ? 1 : 0,
    pl: p.planting ? 1 : 0,
    df: p.defusing ? 1 : 0,
    ap: round(p.actionProgress, 3),
    k: p.kills,
    d: p.deaths,
    jz: round(p.jumpZ, 1),
  };
}

function activeWeaponIdOf(p: PlayerState): string {
  const slot = p.loadout.active;
  if (slot === "primary" && p.loadout.primary) return p.loadout.primary;
  if (slot === "secondary") return p.loadout.secondary;
  return p.loadout.melee;
}

export interface DecodedPlayerWire {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  connected: boolean;
  lastProcessedSeq: number;
  hp: number;
  armor: number;
  helmet: boolean;
  alive: boolean;
  weaponId: string;
  ammoInMag: number;
  ammoReserve: number;
  reloadRemainingMs: number;
  walking: boolean;
  inaccuracy: number;
  money: number;
  hasDefuseKit: boolean;
  grenades: { flash: number; smoke: number; frag: number };
  flashRemainingMs: number;
  carryingCharge: boolean;
  planting: boolean;
  defusing: boolean;
  actionProgress: number;
  kills: number;
  deaths: number;
  jumpZ: number;
}

export function decodePlayer(w: PlayerWire): DecodedPlayerWire {
  return {
    x: w.x,
    y: w.y,
    vx: w.vx,
    vy: w.vy,
    angle: w.a,
    connected: w.c === 1,
    lastProcessedSeq: w.seq,
    hp: w.hp,
    armor: w.ar,
    helmet: w.hl === 1,
    alive: w.al === 1,
    weaponId: w.w,
    ammoInMag: w.am,
    ammoReserve: w.ar2,
    reloadRemainingMs: w.rl,
    walking: w.wk === 1,
    inaccuracy: w.ia,
    money: w.mo,
    hasDefuseKit: w.dk === 1,
    grenades: { flash: w.gf, smoke: w.gs, frag: w.gn },
    flashRemainingMs: w.fl,
    carryingCharge: w.cc === 1,
    planting: w.pl === 1,
    defusing: w.df === 1,
    actionProgress: w.ap,
    kills: w.k,
    deaths: w.d,
    jumpZ: w.jz,
  };
}

export interface MatchWire {
  ph: RoundPhase;
  pe: number; // phase remaining ms
  rd: number; // round number
  w0: number; // wins[0]
  w1: number; // wins[1]
  rs: 0 | 1; // raiderSlot
  bp: 0 | 1; // bomb planted
  bd: 0 | 1; // bomb defused
  bt: 0 | 1; // bomb detonated
  br: number; // bomb remaining ms until detonation (only if planted)
  bx: number;
  by: number;
  lw: -1 | 0 | 1; // last round winner, -1 = none
  lr: RoundEndReason | null;
  mw: -1 | 0 | 1; // match winner, -1 = none
  sm: [number, number, number][]; // active smokes: [x, y, remainingMs]
}

export function encodeMatch(m: MatchState, nowMs: number): MatchWire {
  return {
    ph: m.phase,
    pe: Math.max(0, Math.round(m.phaseEndsAtMs - nowMs)),
    rd: m.round,
    w0: m.wins[0],
    w1: m.wins[1],
    rs: m.raiderSlot,
    bp: m.bomb.planted ? 1 : 0,
    bd: m.bomb.defused ? 1 : 0,
    bt: m.bomb.detonated ? 1 : 0,
    br: m.bomb.planted ? Math.max(0, Math.round(m.bomb.plantedAtMs + BOMB_TIMER_S * 1000 - nowMs)) : 0,
    bx: round(m.bomb.x, 1),
    by: round(m.bomb.y, 1),
    lw: m.lastRoundWinner ?? -1,
    lr: m.lastRoundReason,
    mw: m.matchWinner ?? -1,
    sm: m.smokes.filter((s) => s.expiresAtMs > nowMs).map((s) => [round(s.x, 1), round(s.y, 1), Math.max(0, Math.round(s.expiresAtMs - nowMs))]),
  };
}

export interface DecodedMatchWire {
  phase: RoundPhase;
  phaseRemainingMs: number;
  round: number;
  wins: [number, number];
  raiderSlot: 0 | 1;
  bomb: { planted: boolean; defused: boolean; detonated: boolean; remainingMs: number; x: number; y: number };
  lastRoundWinner: -1 | 0 | 1;
  lastRoundReason: RoundEndReason | null;
  matchWinner: -1 | 0 | 1;
  smokes: { x: number; y: number; remainingMs: number }[];
}

export function decodeMatch(w: MatchWire): DecodedMatchWire {
  return {
    phase: w.ph,
    phaseRemainingMs: w.pe,
    round: w.rd,
    wins: [w.w0, w.w1],
    raiderSlot: w.rs,
    bomb: { planted: w.bp === 1, defused: w.bd === 1, detonated: w.bt === 1, remainingMs: w.br, x: w.bx, y: w.by },
    lastRoundWinner: w.lw,
    lastRoundReason: w.lr,
    matchWinner: w.mw,
    smokes: w.sm.map(([x, y, remainingMs]) => ({ x: x!, y: y!, remainingMs: remainingMs! })),
  };
}

export interface SnapshotWire {
  tick: number;
  host: PlayerWire;
  joiner: PlayerWire;
  match: MatchWire;
  events: GameEvent[];
  mapId: string;
}

export function encodeSnapshot(
  tick: number,
  host: PlayerState,
  joiner: PlayerState,
  match: MatchState,
  events: GameEvent[],
  mapId: string,
  nowMs: number,
): SnapshotWire {
  return {
    tick,
    host: encodePlayer(host, nowMs),
    joiner: encodePlayer(joiner, nowMs),
    match: encodeMatch(match, nowMs),
    events,
    mapId,
  };
}

export type BuyWire = { kind: "weapon" | "utility"; id: string };

export function wireByteSize(wire: unknown): number {
  return new TextEncoder().encode(JSON.stringify(wire)).length;
}

export type { BombState };
