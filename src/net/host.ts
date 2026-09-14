import type { Room } from "trystero";
import {
  HOST_SLOT,
  JOINER_SLOT,
  otherSlot,
  type InputSample,
  type PlayerState,
  type RawInput,
  type Slot,
  type WorldState,
} from "../sim/types";
import { applyInputToPlayer, applyHitscanDamage, applyMeleeDamage, circleHitTest, HITBOX_RADIUS } from "../sim/combat";
import { createWorld } from "../sim/world";
import { pushSample, sampleAt, type TimedSample } from "../sim/interpolate";
import { raycast, wallsToSegments, shortestAngleDiff, type Segment } from "../sim/raycast";
import {
  beginFreeze,
  checkLiveRoundEnd,
  createMatchState,
  applyRoundEnd,
  startNextRound,
  transitionToLive,
  plantBomb,
  defuseBomb,
  tickActionProgress,
  distance,
  type MatchState,
} from "../sim/rounds";
import { canAfford, killRewardPayout, spend } from "../sim/economy";
import { computeLanding, flashAffects, flashBlindDurationMs, fragHitsTarget, smokeToCircles, spawnSmoke, FRAG_RADIUS } from "../sim/grenades";
import { BUYABLE_WEAPONS, GRENADE_MAX, getWeapon, type WeaponDef } from "../data/weapons";
import { loadMap, type MapId } from "../data/maps/loader";
import type { MapDef } from "../data/maps/types";
import type { GameEvent } from "../sim/events";
import {
  decodeInput,
  encodeSnapshot,
  wireByteSize,
  type BuyWire,
  type InputWire,
  type SnapshotWire,
} from "./protocol";
import {
  BOMB_TIMER_S,
  BUTTON_USE,
  DEFUSE_RADIUS,
  DEFUSE_TIME_KIT_S,
  DEFUSE_TIME_S,
  INTERP_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  MAX_HITSCAN_RANGE,
  MAX_REWIND_MS,
  MELEE_ARC_RAD,
  MELEE_RANGE,
  PLANT_TIME_S,
  TICK_RATE,
} from "../config";
import { createNetStats, type MatchView, type NetSession, type NetStats } from "./session";
import type { NetStrategy } from "./trystero";

export class HostSession implements NetSession {
  readonly localSlot = HOST_SLOT;
  readonly stats: NetStats = createNetStats("host");
  readonly map: MapDef;

  private world: WorldState;
  private match: MatchState;
  private segments: Segment[];

  private pendingInputs: InputSample[] = [];
  private hostHistory: TimedSample[] = [];
  private joinerHistory: TimedSample[] = [];
  private joinerInterp: TimedSample[] = [];
  private allEvents: GameEvent[] = [];
  private netEventCursor = 0;
  private uiEventCursor = 0;
  private joinerRttMs = 100;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private readonly joinerPeerId: string;
  private readonly sendSnap: (data: SnapshotWire) => Promise<void>;

  private readonly localNickname: string;
  private remoteNickname = "Opponent";

  constructor(room: Room, joinerPeerId: string, strategy: NetStrategy, mapId: MapId = "depot", nickname = "Host") {
    this.localNickname = nickname;
    this.map = loadMap(mapId);
    this.segments = wallsToSegments(this.map.solids);
    this.world = createWorld(this.map);
    this.match = createMatchState(performance.now());

    this.joinerPeerId = joinerPeerId;
    this.stats.strategy = strategy;
    this.stats.connected = true;

    const inputAction = room.makeAction<InputWire>("input");
    inputAction.onMessage = (wire) => {
      this.pendingInputs.push(decodeInput(wire));
    };

    const buyAction = room.makeAction("buy");
    buyAction.onMessage = (wire) => {
      const buy = wire as unknown as BuyWire;
      this.applyBuy(JOINER_SLOT, buy.kind, buy.id);
    };

    const rematchAction = room.makeAction("rematch");
    rematchAction.onMessage = () => this.requestRematch();

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
    this.sendSnap = (data) => snapAction.send(data as unknown as Parameters<typeof snapAction.send>[0]);

    room.onPeerLeave = (peerId) => {
      if (peerId === this.joinerPeerId) this.stats.connected = false;
    };

    this.tickTimer = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.pingTimer = setInterval(() => {
      room
        .ping(this.joinerPeerId)
        .then((ms) => {
          this.stats.pingMs = Math.round(ms);
          this.joinerRttMs = ms;
        })
        .catch(() => undefined);
    }, 1000);
  }

  /** Host trusts itself — apply local input immediately, every render frame. */
  handleLocalInput(raw: RawInput): void {
    const input: InputSample = { ...raw, seq: 0 };
    const nowMs = performance.now();
    this.applyOneInput(HOST_SLOT, input, nowMs);
  }

  buyItem(kind: "weapon" | "utility", id: string): void {
    this.applyBuy(HOST_SLOT, kind, id);
  }

  requestRematch(): void {
    if (this.match.phase !== "matchend") return;
    const preservedTick = this.world.tick;
    const preservedConnected: [boolean, boolean] = [this.world.players[0].connected, this.world.players[1].connected];
    this.world = createWorld(this.map);
    this.world.tick = preservedTick;
    this.world.players[0].connected = preservedConnected[0];
    this.world.players[1].connected = preservedConnected[1];
    this.match = createMatchState(performance.now());
  }

  private applyBuy(slot: Slot, kind: "weapon" | "utility", id: string): void {
    if (this.match.phase !== "freeze") return;
    let player = this.world.players[slot];

    if (kind === "weapon") {
      if (!BUYABLE_WEAPONS.includes(id)) return;
      const weapon = getWeapon(id);
      if (!canAfford(player, weapon.price)) return;
      player = spend(player, weapon.price);
      if (weapon.class === "pistol") {
        player = {
          ...player,
          loadout: { ...player.loadout, secondary: id, active: "secondary" },
          ammo: { ...player.ammo, secondary: { inMag: weapon.magSize, reserve: weapon.reserveMax } },
        };
      } else {
        player = {
          ...player,
          loadout: { ...player.loadout, primary: id, active: "primary" },
          ammo: { ...player.ammo, primary: { inMag: weapon.magSize, reserve: weapon.reserveMax } },
        };
      }
    } else {
      const role = slot === this.match.raiderSlot ? "raider" : "warden";
      if (id === "armor") {
        if (!canAfford(player, 650)) return;
        player = { ...spend(player, 650), armor: 100 };
      } else if (id === "armorHelmet") {
        if (!canAfford(player, 1000)) return;
        player = { ...spend(player, 1000), armor: 100, helmet: true };
      } else if (id === "defuseKit") {
        if (role !== "warden" || player.hasDefuseKit || !canAfford(player, 400)) return;
        player = { ...spend(player, 400), hasDefuseKit: true };
      } else if (id === "flash" || id === "smoke" || id === "frag") {
        const price = id === "flash" ? 200 : 300;
        if (player.grenades[id] >= GRENADE_MAX[id] || !canAfford(player, price)) return;
        player = { ...spend(player, price), grenades: { ...player.grenades, [id]: player.grenades[id] + 1 } };
      } else {
        return;
      }
    }

    this.world.players[slot] = player;
    this.allEvents.push({ type: "buy", slot, itemId: id });
  }

  private applyOneInput(slot: Slot, input: InputSample, nowMs: number): void {
    const before = this.world.players[slot];
    const wasReloading = before.reloading;
    const gameIsLive = this.match.phase === "live";

    const result = applyInputToPlayer(before, input, this.map.solids, nowMs, gameIsLive);
    this.world.players[slot] = result.player;
    this.world.players[slot].connected = true;

    if (!wasReloading && result.player.reloading) {
      this.allEvents.push({ type: "reload", slot });
    }

    if (result.fired) {
      this.resolveShot(slot, result.shotAngle, result.weapon, nowMs);
    }

    if (gameIsLive) {
      this.processUseAction(slot, input, nowMs);
      if (input.throwGrenade) this.processGrenadeThrow(slot, nowMs);
    }
  }

  private processUseAction(slot: Slot, input: InputSample, nowMs: number): void {
    const player = this.world.players[slot];
    if (!player.alive) return;
    const usePressed = (input.buttons & BUTTON_USE) !== 0;
    const role = slot === this.match.raiderSlot ? "raider" : "warden";

    if (role === "raider" && player.carryingCharge && !this.match.bomb.planted) {
      const nearSite = distance(player.x, player.y, this.map.plantSite.x, this.map.plantSite.y) <= this.map.plantSite.radius;
      const active = usePressed && nearSite;
      let updated = tickActionProgress(player, input.dt, PLANT_TIME_S, active);
      updated = { ...updated, planting: active };
      this.world.players[slot] = updated;
      if (updated.actionProgress >= 1) {
        const res = plantBomb(this.world, this.match, slot, nowMs);
        this.world = res.world;
        this.match = res.match;
        this.allEvents.push({ type: "planted", x: player.x, y: player.y });
      }
      return;
    }

    if (role === "warden" && this.match.bomb.planted && !this.match.bomb.defused) {
      const nearBomb = distance(player.x, player.y, this.match.bomb.x, this.match.bomb.y) <= DEFUSE_RADIUS;
      const active = usePressed && nearBomb;
      const duration = player.hasDefuseKit ? DEFUSE_TIME_KIT_S : DEFUSE_TIME_S;
      let updated = tickActionProgress(player, input.dt, duration, active);
      updated = { ...updated, defusing: active };
      this.world.players[slot] = updated;
      if (updated.actionProgress >= 1) {
        this.match = defuseBomb(this.match);
        this.allEvents.push({ type: "defused" });
      }
    }
  }

  private processGrenadeThrow(slot: Slot, nowMs: number): void {
    const player = this.world.players[slot];
    if (!player.alive) return;
    const kind: "flash" | "smoke" | "frag" | null =
      player.grenades.flash > 0 ? "flash" : player.grenades.smoke > 0 ? "smoke" : player.grenades.frag > 0 ? "frag" : null;
    if (!kind) return;

    const landing = computeLanding(player.x, player.y, player.angle, this.segments);
    this.world.players[slot] = { ...player, grenades: { ...player.grenades, [kind]: player.grenades[kind] - 1 } };
    this.allEvents.push({ type: "thrown", kind, slot, x: landing.x, y: landing.y });

    if (kind === "smoke") {
      this.match = { ...this.match, smokes: [...this.match.smokes, spawnSmoke(landing.x, landing.y, nowMs)] };
    } else if (kind === "flash") {
      for (const targetSlot of [HOST_SLOT, JOINER_SLOT] as const) {
        const target = this.world.players[targetSlot];
        if (!target.alive) continue;
        if (flashAffects(landing.x, landing.y, target.x, target.y, target.angle, this.segments)) {
          this.world.players[targetSlot] = { ...target, flashedUntilMs: nowMs + flashBlindDurationMs() };
          this.allEvents.push({ type: "flashed", slot: targetSlot, durationMs: flashBlindDurationMs() });
        }
      }
    } else if (kind === "frag") {
      for (const targetSlot of [HOST_SLOT, JOINER_SLOT] as const) {
        const target = this.world.players[targetSlot];
        if (!target.alive) continue;
        const dmg = fragHitsTarget(landing.x, landing.y, target.x, target.y, FRAG_RADIUS, this.segments);
        if (dmg > 0) {
          const hp = Math.max(0, target.hp - dmg);
          const killed = hp <= 0 && target.alive;
          this.world.players[targetSlot] = { ...target, hp, alive: hp > 0, deaths: killed ? target.deaths + 1 : target.deaths };
          if (killed) {
            this.world.players[slot] = killRewardPayout({ ...this.world.players[slot], kills: this.world.players[slot].kills + 1 }, 300);
          }
        }
      }
    }
  }

  private resolveShot(shooterSlot: Slot, shotAngle: number, weapon: WeaponDef, nowMs: number): void {
    const shooter = this.world.players[shooterSlot];
    if (weapon.class === "melee") {
      this.resolveMelee(shooterSlot, nowMs);
      return;
    }

    const targetSlot = otherSlot(shooterSlot);
    const targetCurrent = this.world.players[targetSlot];
    const dirX = Math.cos(shotAngle);
    const dirY = Math.sin(shotAngle);
    const smokeCircles = smokeToCircles(this.match.smokes, nowMs);
    const wallHit = raycast(shooter.x, shooter.y, dirX, dirY, MAX_HITSCAN_RANGE, this.segments, smokeCircles);

    if (targetCurrent.alive) {
      const rewindMs = Math.min(MAX_REWIND_MS, INTERP_DELAY_MS + (shooterSlot === JOINER_SLOT ? this.joinerRttMs / 2 : 0));
      const history = targetSlot === HOST_SLOT ? this.hostHistory : this.joinerHistory;
      const rewound = sampleAt(history, nowMs - rewindMs, MAX_EXTRAPOLATION_MS) ?? {
        x: targetCurrent.x,
        y: targetCurrent.y,
        angle: targetCurrent.angle,
      };
      const t = circleHitTest(shooter.x, shooter.y, dirX, dirY, rewound.x, rewound.y, HITBOX_RADIUS);
      if (t !== null && t < wallHit.dist) {
        const hitX = shooter.x + dirX * t;
        const hitY = shooter.y + dirY * t;
        const targetForZone: PlayerState = { ...targetCurrent, x: rewound.x, y: rewound.y, angle: rewound.angle };
        const result = applyHitscanDamage(targetForZone, weapon, hitX, hitY, nowMs);
        this.world.players[targetSlot] = {
          ...targetCurrent,
          hp: result.target.hp,
          armor: result.target.armor,
          alive: result.target.alive,
          deaths: result.target.deaths,
        };
        if (result.killed) {
          this.world.players[shooterSlot] = killRewardPayout(
            { ...this.world.players[shooterSlot], kills: this.world.players[shooterSlot].kills + 1 },
            weapon.killReward,
          );
        }
        this.allEvents.push({
          type: "shot",
          shooter: shooterSlot,
          x: shooter.x,
          y: shooter.y,
          angle: shotAngle,
          weaponId: weapon.id,
          hit: true,
          hitX,
          hitY,
          zone: result.zone,
          killed: result.killed,
        });
        return;
      }
    }

    this.allEvents.push({
      type: "shot",
      shooter: shooterSlot,
      x: shooter.x,
      y: shooter.y,
      angle: shotAngle,
      weaponId: weapon.id,
      hit: false,
      hitX: wallHit.x,
      hitY: wallHit.y,
    });
  }

  private resolveMelee(shooterSlot: Slot, nowMs: number): void {
    const shooter = this.world.players[shooterSlot];
    const targetSlot = otherSlot(shooterSlot);
    const target = this.world.players[targetSlot];

    if (!target.alive) return;
    const dist = distance(shooter.x, shooter.y, target.x, target.y);
    if (dist > MELEE_RANGE) {
      this.allEvents.push({ type: "melee", shooter: shooterSlot, x: shooter.x, y: shooter.y, angle: shooter.angle, hit: false });
      return;
    }
    const angleToTarget = Math.atan2(target.y - shooter.y, target.x - shooter.x);
    if (Math.abs(shortestAngleDiff(shooter.angle, angleToTarget)) > MELEE_ARC_RAD) {
      this.allEvents.push({ type: "melee", shooter: shooterSlot, x: shooter.x, y: shooter.y, angle: shooter.angle, hit: false });
      return;
    }
    const angleToShooterFromTarget = Math.atan2(shooter.y - target.y, shooter.x - target.x);
    const backstab = Math.abs(shortestAngleDiff(target.angle, angleToShooterFromTarget)) < Math.PI / 2.5;

    const result = applyMeleeDamage(target, backstab, nowMs);
    this.world.players[targetSlot] = result.target;
    if (result.killed) {
      this.world.players[shooterSlot] = killRewardPayout(
        { ...this.world.players[shooterSlot], kills: this.world.players[shooterSlot].kills + 1 },
        getWeapon("shard").killReward,
      );
    }
    this.allEvents.push({
      type: "melee",
      shooter: shooterSlot,
      x: shooter.x,
      y: shooter.y,
      angle: shooter.angle,
      hit: true,
      killed: result.killed,
      backstab,
    });
  }

  private tickRoundState(nowMs: number): void {
    if (this.match.phase === "freeze") {
      if (nowMs >= this.match.phaseEndsAtMs) {
        this.match = transitionToLive(this.match, nowMs);
        this.allEvents.push({ type: "roundStart", round: this.match.round });
      }
    } else if (this.match.phase === "live") {
      const end = checkLiveRoundEnd(this.world, this.match, nowMs);
      if (end) {
        const res = applyRoundEnd(this.world, this.match, end.winner, end.reason, nowMs);
        this.world = res.world;
        this.match = res.match;
        this.allEvents.push({ type: "roundEnd", winner: end.winner, reason: end.reason });
        if (this.match.matchWinner !== null) {
          this.allEvents.push({ type: "matchEnd", winner: this.match.matchWinner });
        }
      }
    } else if (this.match.phase === "roundend") {
      if (nowMs >= this.match.phaseEndsAtMs) {
        this.match = startNextRound(this.match);
        const res = beginFreeze(this.world, this.match, this.map, nowMs);
        this.world = res.world;
        this.match = res.match;
      }
    }
  }

  private tick(): void {
    const nowMs = performance.now();

    for (const input of this.pendingInputs) {
      this.applyOneInput(JOINER_SLOT, input, nowMs);
    }
    this.pendingInputs = [];

    this.tickRoundState(nowMs);

    this.world.tick += 1;
    this.stats.tick = this.world.tick;

    pushSample(this.hostHistory, { t: nowMs, x: this.world.players[HOST_SLOT].x, y: this.world.players[HOST_SLOT].y, angle: this.world.players[HOST_SLOT].angle });
    pushSample(this.joinerHistory, { t: nowMs, x: this.world.players[JOINER_SLOT].x, y: this.world.players[JOINER_SLOT].y, angle: this.world.players[JOINER_SLOT].angle });
    pushSample(this.joinerInterp, { t: nowMs, x: this.world.players[JOINER_SLOT].x, y: this.world.players[JOINER_SLOT].y, angle: this.world.players[JOINER_SLOT].angle });

    const newEvents = this.allEvents.slice(this.netEventCursor);
    this.netEventCursor = this.allEvents.length;

    const wire = encodeSnapshot(
      this.world.tick,
      this.world.players[HOST_SLOT],
      this.world.players[JOINER_SLOT],
      this.match,
      newEvents,
      this.map.id,
      nowMs,
    );
    this.stats.lastSnapshotBytes = wireByteSize(wire);
    void this.sendSnap(wire);

    if (this.netEventCursor > 400 && this.uiEventCursor > 400) {
      const trim = Math.min(this.netEventCursor, this.uiEventCursor);
      this.allEvents = this.allEvents.slice(trim);
      this.netEventCursor -= trim;
      this.uiEventCursor -= trim;
    }
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

  getMatchView(nowMs: number): MatchView {
    return {
      phase: this.match.phase,
      phaseRemainingMs: Math.max(0, this.match.phaseEndsAtMs - nowMs),
      round: this.match.round,
      wins: this.match.wins,
      raiderSlot: this.match.raiderSlot,
      bomb: {
        planted: this.match.bomb.planted,
        defused: this.match.bomb.defused,
        detonated: this.match.bomb.detonated,
        remainingMs: this.match.bomb.planted ? Math.max(0, this.match.bomb.plantedAtMs + BOMB_TIMER_S * 1000 - nowMs) : 0,
        x: this.match.bomb.x,
        y: this.match.bomb.y,
      },
      lastRoundWinner: this.match.lastRoundWinner,
      lastRoundReason: this.match.lastRoundReason,
      matchWinner: this.match.matchWinner,
      smokes: this.match.smokes.filter((s) => s.expiresAtMs > nowMs).map((s) => ({ x: s.x, y: s.y, remainingMs: s.expiresAtMs - nowMs })),
    };
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
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
  }
}
