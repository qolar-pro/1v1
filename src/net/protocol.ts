import type { InputSample, PlayerState } from "../sim/types";

/**
 * Compact wire formats. Tuples instead of objects keep the JSON payload
 * small — Trystero serializes every action payload with JSON.stringify, so
 * shorter arrays translate directly into fewer bytes on the wire.
 */
export type InputWire = [
  seq: number,
  moveX: number,
  moveY: number,
  aimAngle: number,
  buttons: number,
  dt: number,
];

export type PlayerWire = [
  x: number,
  y: number,
  vx: number,
  vy: number,
  angle: number,
  connected: 0 | 1,
  lastProcessedSeq: number,
];

export type SnapshotWire = [tick: number, host: PlayerWire, joiner: PlayerWire];

function round(v: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

export function encodeInput(input: InputSample): InputWire {
  return [
    input.seq,
    round(input.moveX),
    round(input.moveY),
    round(input.aimAngle, 4),
    input.buttons,
    round(input.dt, 4),
  ];
}

export function decodeInput(wire: InputWire): InputSample {
  const [seq, moveX, moveY, aimAngle, buttons, dt] = wire;
  return { seq, moveX, moveY, aimAngle, buttons, dt };
}

export function encodePlayer(p: PlayerState): PlayerWire {
  return [
    round(p.x, 1),
    round(p.y, 1),
    round(p.vx, 1),
    round(p.vy, 1),
    round(p.angle, 4),
    p.connected ? 1 : 0,
    p.lastProcessedSeq,
  ];
}

export function decodePlayerInto(w: PlayerWire, into: PlayerState): PlayerState {
  const [x, y, vx, vy, angle, connected, lastProcessedSeq] = w;
  return { ...into, x, y, vx, vy, angle, connected: connected === 1, lastProcessedSeq };
}

export function encodeSnapshot(tick: number, host: PlayerState, joiner: PlayerState): SnapshotWire {
  return [tick, encodePlayer(host), encodePlayer(joiner)];
}

export function wireByteSize(wire: unknown): number {
  return new TextEncoder().encode(JSON.stringify(wire)).length;
}
