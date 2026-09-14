import type { Room } from "trystero";
import { HOST_SLOT, JOINER_SLOT, type InputSample, type RawInput, type WorldState } from "../sim/types";
import { stepPlayer } from "../sim/movement";
import { createWorld } from "../sim/world";
import { pushSample, sampleAt, type TimedSample } from "../sim/interpolate";
import {
  decodeInput,
  encodeSnapshot,
  wireByteSize,
  type InputWire,
  type SnapshotWire,
} from "./protocol";
import { INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS, TICK_RATE } from "../config";
import { createNetStats, type NetSession, type NetStats } from "./session";
import type { NetStrategy } from "./trystero";

export class HostSession implements NetSession {
  readonly localSlot = HOST_SLOT;
  readonly stats: NetStats = createNetStats("host");

  private world: WorldState = createWorld();
  private pendingInputs: InputSample[] = [];
  private joinerInterp: TimedSample[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private readonly joinerPeerId: string;
  private readonly sendSnap: (data: SnapshotWire) => Promise<void>;

  constructor(room: Room, joinerPeerId: string, strategy: NetStrategy) {
    this.joinerPeerId = joinerPeerId;
    this.stats.strategy = strategy;
    this.stats.connected = true;

    const inputAction = room.makeAction<InputWire>("input");
    inputAction.onMessage = (wire) => {
      this.pendingInputs.push(decodeInput(wire));
    };

    const snapAction = room.makeAction<SnapshotWire>("snap");
    this.sendSnap = (data) => snapAction.send(data);

    room.onPeerLeave = (peerId) => {
      if (peerId === this.joinerPeerId) this.stats.connected = false;
    };

    this.tickTimer = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.pingTimer = setInterval(() => {
      room
        .ping(this.joinerPeerId)
        .then((ms) => (this.stats.pingMs = Math.round(ms)))
        .catch(() => undefined);
    }, 1000);
  }

  /** Host trusts itself — apply local input immediately, every render frame. */
  handleLocalInput(raw: RawInput): void {
    const input: InputSample = { ...raw, seq: 0 };
    this.world.players[HOST_SLOT] = stepPlayer(this.world.players[HOST_SLOT], input);
    this.world.players[HOST_SLOT].connected = true;
  }

  private tick(): void {
    // Apply every buffered joiner input since the last tick, in arrival order.
    for (const input of this.pendingInputs) {
      this.world.players[JOINER_SLOT] = stepPlayer(this.world.players[JOINER_SLOT], input);
      this.world.players[JOINER_SLOT].connected = true;
    }
    this.pendingInputs = [];

    this.world.tick += 1;
    this.stats.tick = this.world.tick;

    pushSample(this.joinerInterp, {
      t: performance.now(),
      x: this.world.players[JOINER_SLOT].x,
      y: this.world.players[JOINER_SLOT].y,
      angle: this.world.players[JOINER_SLOT].angle,
    });

    const wire = encodeSnapshot(this.world.tick, this.world.players[HOST_SLOT], this.world.players[JOINER_SLOT]);
    this.stats.lastSnapshotBytes = wireByteSize(wire);
    void this.sendSnap(wire);
  }

  getRenderState(nowMs: number): WorldState {
    const renderTime = nowMs - INTERP_DELAY_MS;
    const joinerSample = sampleAt(this.joinerInterp, renderTime, MAX_EXTRAPOLATION_MS);
    const joiner = { ...this.world.players[JOINER_SLOT] };
    if (joinerSample) {
      joiner.x = joinerSample.x;
      joiner.y = joinerSample.y;
      joiner.angle = joinerSample.angle;
    }
    return {
      tick: this.world.tick,
      players: [{ ...this.world.players[HOST_SLOT] }, joiner],
    };
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
  }
}
