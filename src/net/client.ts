import type { Room } from "trystero";
import {
  HOST_SLOT,
  JOINER_SLOT,
  createPlayerState,
  type InputSample,
  type PlayerState,
  type RawInput,
  type WeaponSlot,
  type WorldState,
} from "../sim/types";
import { applyInputToPlayer } from "../sim/combat";
import { defaultSpawn } from "../sim/world";
import { pushSample, sampleAt, type TimedSample } from "../sim/interpolate";
import { getWeapon } from "../data/weapons";
import { loadMap, type MapId } from "../data/maps/loader";
import type { MapDef } from "../data/maps/types";
import type { GameEvent } from "../sim/events";
import {
  decodeMatch,
  decodePlayer,
  encodeInput,
  wireByteSize,
  type BuyWire,
  type DecodedPlayerWire,
  type InputWire,
  type SnapshotWire,
} from "./protocol";
import {
  INTERP_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  RECONCILE_SMOOTH_MS,
  RECONCILE_SNAP_THRESHOLD_PX,
} from "../config";
import { createNetStats, type MatchView, type NetSession, type NetStats } from "./session";
import type { NetStrategy } from "./trystero";

function mergeAuthoritative(local: PlayerState, decoded: DecodedPlayerWire): PlayerState {
  const weapon = getWeapon(decoded.weaponId);
  const activeSlot: WeaponSlot = weapon.class === "melee" ? "melee" : weapon.class === "pistol" ? "secondary" : "primary";

  let loadout = local.loadout;
  let ammo = local.ammo;
  if (activeSlot === "secondary") {
    loadout = { ...loadout, secondary: decoded.weaponId, active: "secondary" };
    ammo = { ...ammo, secondary: { inMag: decoded.ammoInMag, reserve: decoded.ammoReserve } };
  } else if (activeSlot === "primary") {
    loadout = { ...loadout, primary: decoded.weaponId, active: "primary" };
    ammo = { ...ammo, primary: { inMag: decoded.ammoInMag, reserve: decoded.ammoReserve } };
  } else {
    loadout = { ...loadout, active: "melee" };
  }

  const nowMs = performance.now();
  return {
    ...local,
    x: decoded.x,
    y: decoded.y,
    vx: decoded.vx,
    vy: decoded.vy,
    angle: decoded.angle,
    lastProcessedSeq: decoded.lastProcessedSeq,
    hp: decoded.hp,
    armor: decoded.armor,
    helmet: decoded.helmet,
    alive: decoded.alive,
    loadout,
    ammo,
    reloading: decoded.reloadRemainingMs > 0,
    reloadEndsAtMs: nowMs + decoded.reloadRemainingMs,
    walking: decoded.walking,
    inaccuracy: decoded.inaccuracy,
    money: decoded.money,
    hasDefuseKit: decoded.hasDefuseKit,
    grenades: decoded.grenades,
    flashedUntilMs: nowMs + decoded.flashRemainingMs,
    carryingCharge: decoded.carryingCharge,
    planting: decoded.planting,
    defusing: decoded.defusing,
    actionProgress: decoded.actionProgress,
    kills: decoded.kills,
    deaths: decoded.deaths,
    connected: decoded.connected,
  };
}

export class ClientSession implements NetSession {
  readonly localSlot = JOINER_SLOT;
  readonly stats: NetStats = createNetStats("client");

  private map: MapDef = loadMap("depot");
  private predicted: PlayerState;
  private pendingHistory: InputSample[] = [];
  private nextSeq = 1;

  private hostInterp: TimedSample[] = [];
  private lastAckedTick = -1;
  private latestMatch: MatchView;
  private allEvents: GameEvent[] = [];
  private uiEventCursor = 0;

  private offsetStart = { x: 0, y: 0 };
  private offsetStartTime = 0;

  private readonly hostPeerId: string;
  private readonly sendInput: (data: InputWire) => Promise<void>;
  private readonly sendBuy: (data: BuyWire) => Promise<void>;
  private readonly sendRematch: () => Promise<void>;
  private readonly localNickname: string;
  private remoteNickname = "Host";

  constructor(room: Room, hostPeerId: string, strategy: NetStrategy, nickname = "Player") {
    this.localNickname = nickname;
    const spawn = defaultSpawn(JOINER_SLOT, this.map);
    this.predicted = createPlayerState(spawn.x, spawn.y, "warden");
    this.latestMatch = {
      phase: "freeze",
      phaseRemainingMs: 0,
      round: 1,
      wins: [0, 0],
      raiderSlot: HOST_SLOT,
      bomb: { planted: false, defused: false, detonated: false, remainingMs: 0, x: 0, y: 0 },
      lastRoundWinner: null,
      lastRoundReason: null,
      matchWinner: null,
      smokes: [],
    };

    this.hostPeerId = hostPeerId;
    this.stats.strategy = strategy;
    this.stats.connected = true;

    const inputAction = room.makeAction<InputWire>("input");
    this.sendInput = (data) => inputAction.send(data);

    const buyAction = room.makeAction("buy");
    this.sendBuy = (data) => buyAction.send(data);

    const rematchAction = room.makeAction("rematch");
    this.sendRematch = () => rematchAction.send({});

    const helloAction = room.makeAction("hello");
    helloAction.onMessage = (wire) => {
      const nick = (wire as unknown as { nickname?: string }).nickname;
      if (nick) this.remoteNickname = nick.slice(0, 20);
    };
    const sendHello = () => void helloAction.send({ nickname: this.localNickname });
    sendHello();
    setTimeout(sendHello, 500);
    setTimeout(sendHello, 1500);

    const snapAction = room.makeAction("snap");
    snapAction.onMessage = (wire) => this.onSnapshot(wire as unknown as SnapshotWire);

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

  buyItem(kind: "weapon" | "utility", id: string): void {
    void this.sendBuy({ kind, id });
  }

  requestRematch(): void {
    void this.sendRematch();
  }

  handleLocalInput(raw: RawInput): void {
    const input: InputSample = { ...raw, seq: this.nextSeq++ };
    this.pendingHistory.push(input);

    const gameIsLive = this.latestMatch.phase === "live";
    const result = applyInputToPlayer(this.predicted, input, this.map.solids, performance.now(), gameIsLive);
    this.predicted = result.player;

    const wire = encodeInput(input);
    this.stats.lastInputBytes = wireByteSize(wire);
    void this.sendInput(wire);
  }

  private onSnapshot(wire: SnapshotWire): void {
    if (wire.mapId !== this.map.id) {
      this.map = loadMap(wire.mapId as MapId);
    }
    if (wire.tick <= this.lastAckedTick) return;
    this.lastAckedTick = wire.tick;
    this.stats.tick = wire.tick;
    this.stats.lastSnapshotBytes = wireByteSize(wire);

    const hostDecoded = decodePlayer(wire.host);
    const joinerDecoded = decodePlayer(wire.joiner);
    const nowMs = performance.now();
    const matchDecoded = decodeMatch(wire.match);
    this.latestMatch = {
      phase: matchDecoded.phase,
      phaseRemainingMs: matchDecoded.phaseRemainingMs,
      round: matchDecoded.round,
      wins: matchDecoded.wins,
      raiderSlot: matchDecoded.raiderSlot,
      bomb: matchDecoded.bomb,
      lastRoundWinner: matchDecoded.lastRoundWinner === -1 ? null : matchDecoded.lastRoundWinner,
      lastRoundReason: matchDecoded.lastRoundReason,
      matchWinner: matchDecoded.matchWinner === -1 ? null : matchDecoded.matchWinner,
      smokes: matchDecoded.smokes,
    };
    this.allEvents.push(...wire.events);
    if (this.allEvents.length > 400 && this.uiEventCursor > 200) {
      this.allEvents = this.allEvents.slice(this.uiEventCursor);
      this.uiEventCursor = 0;
    }

    pushSample(this.hostInterp, { t: nowMs, x: hostDecoded.x, y: hostDecoded.y, angle: hostDecoded.angle });

    // Reconcile our own predicted state against the authoritative one.
    const ackSeq = joinerDecoded.lastProcessedSeq;
    this.pendingHistory = this.pendingHistory.filter((i) => i.seq > ackSeq);

    const preReconcilePos = { x: this.predicted.x, y: this.predicted.y };
    const authoritative = mergeAuthoritative(this.predicted, joinerDecoded);

    let replayed = authoritative;
    const gameIsLive = this.latestMatch.phase === "live";
    for (const input of this.pendingHistory) {
      replayed = applyInputToPlayer(replayed, input, this.map.solids, nowMs, gameIsLive).player;
    }

    const dx = replayed.x - preReconcilePos.x;
    const dy = replayed.y - preReconcilePos.y;
    const magnitude = Math.hypot(dx, dy);
    this.stats.correctionPx = magnitude;

    if (magnitude > 0 && magnitude < RECONCILE_SNAP_THRESHOLD_PX) {
      this.offsetStart = { x: preReconcilePos.x - replayed.x, y: preReconcilePos.y - replayed.y };
      this.offsetStartTime = nowMs;
    } else {
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
    const host = createPlayerState(defaultSpawn(HOST_SLOT, this.map).x, defaultSpawn(HOST_SLOT, this.map).y, "raider");
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

  getMatchView(): MatchView {
    return this.latestMatch;
  }

  drainEvents(): GameEvent[] {
    const drained = this.allEvents.slice(this.uiEventCursor);
    this.uiEventCursor = this.allEvents.length;
    return drained;
  }

  getMap(): MapDef {
    return this.map;
  }

  getNicknames(): { local: string; remote: string } {
    return { local: this.localNickname, remote: this.remoteNickname };
  }

  dispose(): void {
    // Ping interval intentionally left running for the tab's lifetime; teardown
    // will matter once rematch/menu-return exists.
  }
}
