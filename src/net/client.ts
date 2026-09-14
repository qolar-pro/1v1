import type { Room } from "trystero";
import {
  HOST_SLOT,
  JOINER_SLOT,
  createPlayerState,
  type InputSample,
  type RawInput,
  type WorldState,
} from "../sim/types";
import { stepPlayer } from "../sim/movement";
import { defaultSpawn } from "../sim/world";
import { pushSample, sampleAt, type TimedSample } from "../sim/interpolate";
import {
  decodePlayerInto,
  encodeInput,
  wireByteSize,
  type InputWire,
  type SnapshotWire,
} from "./protocol";
import {
  INTERP_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  RECONCILE_SMOOTH_MS,
  RECONCILE_SNAP_THRESHOLD_PX,
} from "../config";
import { createNetStats, type NetSession, type NetStats } from "./session";
import type { NetStrategy } from "./trystero";

export class ClientSession implements NetSession {
  readonly localSlot = JOINER_SLOT;
  readonly stats: NetStats = createNetStats("client");

  private predicted = createPlayerState(defaultSpawn(JOINER_SLOT).x, defaultSpawn(JOINER_SLOT).y);
  private pendingHistory: InputSample[] = [];
  private nextSeq = 1;

  private hostInterp: TimedSample[] = [];
  private lastAckedTick = -1;

  private offsetStart = { x: 0, y: 0 };
  private offsetStartTime = 0;

  private readonly hostPeerId: string;
  private readonly sendInput: (data: InputWire) => Promise<void>;

  constructor(room: Room, hostPeerId: string, strategy: NetStrategy) {
    this.hostPeerId = hostPeerId;
    this.stats.strategy = strategy;
    this.stats.connected = true;

    const inputAction = room.makeAction<InputWire>("input");
    this.sendInput = (data) => inputAction.send(data);

    const snapAction = room.makeAction<SnapshotWire>("snap");
    snapAction.onMessage = (wire) => this.onSnapshot(wire);

    room.onPeerLeave = (peerId) => {
      if (peerId === this.hostPeerId) this.stats.connected = false;
    };

    setInterval(() => {
      room
        .ping(this.hostPeerId)
        .then((ms) => (this.stats.pingMs = Math.round(ms)))
        .catch(() => undefined);
    }, 1000);
  }

  handleLocalInput(raw: RawInput): void {
    const input: InputSample = { ...raw, seq: this.nextSeq++ };
    this.pendingHistory.push(input);
    this.predicted = stepPlayer(this.predicted, input);

    const wire = encodeInput(input);
    this.stats.lastInputBytes = wireByteSize(wire);
    void this.sendInput(wire);
  }

  private onSnapshot(wire: SnapshotWire): void {
    const [tick, hostWire, joinerWire] = wire;
    if (tick <= this.lastAckedTick) return; // out-of-order / duplicate, drop
    this.lastAckedTick = tick;
    this.stats.tick = tick;
    this.stats.lastSnapshotBytes = wireByteSize(wire);

    pushSample(this.hostInterp, {
      t: performance.now(),
      x: hostWire[0],
      y: hostWire[1],
      angle: hostWire[4],
    });

    // Reconcile our own predicted position against the authoritative one.
    const authoritative = decodePlayerInto(joinerWire, this.predicted);
    const ackSeq = authoritative.lastProcessedSeq;
    this.pendingHistory = this.pendingHistory.filter((i) => i.seq > ackSeq);

    const preReconcilePos = { x: this.predicted.x, y: this.predicted.y };

    let replayed = authoritative;
    for (const input of this.pendingHistory) {
      replayed = stepPlayer(replayed, input);
    }

    const dx = replayed.x - preReconcilePos.x;
    const dy = replayed.y - preReconcilePos.y;
    const magnitude = Math.hypot(dx, dy);
    this.stats.correctionPx = magnitude;

    if (magnitude > 0 && magnitude < RECONCILE_SNAP_THRESHOLD_PX) {
      // Small correction: keep rendering from the old spot and glide in.
      this.offsetStart = { x: preReconcilePos.x - replayed.x, y: preReconcilePos.y - replayed.y };
      this.offsetStartTime = performance.now();
    } else {
      // No visible smoothing needed, or correction big enough to snap outright.
      this.offsetStart = { x: 0, y: 0 };
      this.offsetStartTime = 0;
    }

    this.predicted = replayed;
  }

  private currentVisualOffset(nowMs: number): { x: number; y: number } {
    if (this.offsetStart.x === 0 && this.offsetStart.y === 0) return { x: 0, y: 0 };
    const elapsed = nowMs - this.offsetStartTime;
    if (elapsed >= RECONCILE_SMOOTH_MS) return { x: 0, y: 0 };
    const t = 1 - elapsed / RECONCILE_SMOOTH_MS;
    return { x: this.offsetStart.x * t, y: this.offsetStart.y * t };
  }

  getRenderState(nowMs: number): WorldState {
    const renderTime = nowMs - INTERP_DELAY_MS;
    const hostSample = sampleAt(this.hostInterp, renderTime, MAX_EXTRAPOLATION_MS);
    const host = createPlayerState(defaultSpawn(HOST_SLOT).x, defaultSpawn(HOST_SLOT).y);
    if (hostSample) {
      host.x = hostSample.x;
      host.y = hostSample.y;
      host.angle = hostSample.angle;
      host.connected = true;
    }

    const offset = this.currentVisualOffset(nowMs);
    const joiner = { ...this.predicted, x: this.predicted.x + offset.x, y: this.predicted.y + offset.y };
    joiner.connected = true;

    return { tick: this.stats.tick, players: [host, joiner] };
  }

  dispose(): void {
    // Ping interval intentionally left running for the tab's lifetime in Phase 1;
    // teardown will matter once rematch/menu-return exists (Phase 7).
  }
}
