import Phaser from "phaser";
import type { NetSession } from "../net/session";
import { HOST_SLOT, JOINER_SLOT, otherSlot, type PlayerState, type Slot } from "../sim/types";
import { canSee, hasLineOfSight, wallsToSegments, type OccludingCircle, type Segment } from "../sim/raycast";
import { PLAYER_RADIUS } from "../config";
import type { GameEvent } from "../sim/events";
import { getWeapon } from "../data/weapons";
import type { MapDef } from "../data/maps/types";
import { VisionRenderer } from "./VisionRenderer";
import { Effects } from "./Effects";
import { updateHud } from "./Hud";
import type { Controls } from "./controls";
import { DesktopControls } from "./DesktopControls";
import { TouchControls, isTouchDevice } from "../ui/TouchControls";
import { installOrientationGate } from "../ui/OrientationGate";
import { initBuyMenu, isBuyMenuOpen, toggleBuyMenu, hideBuyMenu } from "../ui/BuyMenu";
import { hideScoreboard, renderScoreboard, showScoreboard } from "../ui/Scoreboard";
import { hideMatchEnd, hideRoundBanner, showMatchEnd, showRoundBanner } from "../ui/Results";
import { updateDebugHud } from "../ui/DebugHud";
import { hideConnectionStatus, showPeerGone, showReconnecting } from "../ui/ConnectionStatus";
import { DISCONNECT_GRACE_MS } from "../config";
import * as audio from "../audio/engine";

const HOST_COLOR = 0x2dd4bf;
const JOINER_COLOR = 0xf59e0b;
const LOCAL_RING = 0xffffff;

export class GameScene extends Phaser.Scene {
  private readonly session: NetSession;
  private controls!: Controls;
  private map!: MapDef;
  private segments!: Segment[];

  private circles = new Map<Slot, Phaser.GameObjects.Arc>();
  private facingLines = new Map<Slot, Phaser.GameObjects.Graphics>();
  private localRing!: Phaser.GameObjects.Arc;
  private lastLocalRender = { x: 0, y: 0 };

  private vision!: VisionRenderer;
  private effects!: Effects;
  private litLayer!: Phaser.GameObjects.Container;
  private crosshairGfx!: Phaser.GameObjects.Graphics;

  private audioUnlocked = false;
  private smokeCircles: OccludingCircle[] = [];
  private disconnectedSince: number | null = null;
  private peerGoneShown = false;

  constructor(session: NetSession) {
    super("GameScene");
    this.session = session;
  }

  create(): void {
    this.map = this.session.getMap();
    this.segments = wallsToSegments(this.map.solids);

    this.cameras.main.setBackgroundColor(0x0a0a0a);
    this.cameras.main.setBounds(0, 0, this.map.width, this.map.height);

    this.drawWorld();

    const host = this.add.circle(0, 0, PLAYER_RADIUS, HOST_COLOR).setDepth(10);
    const joiner = this.add.circle(0, 0, PLAYER_RADIUS, JOINER_COLOR).setDepth(10);
    this.circles.set(HOST_SLOT, host);
    this.circles.set(JOINER_SLOT, joiner);
    this.facingLines.set(HOST_SLOT, this.add.graphics().setDepth(11));
    this.facingLines.set(JOINER_SLOT, this.add.graphics().setDepth(11));

    this.localRing = this.add.circle(0, 0, PLAYER_RADIUS + 4).setDepth(12);
    this.localRing.setStrokeStyle(2, LOCAL_RING, 0.9);
    this.localRing.isFilled = false;

    const localSprite = this.circles.get(this.session.localSlot)!;
    this.cameras.main.startFollow(localSprite, true, 1, 1);

    this.vision = new VisionRenderer(this);
    this.vision.applyTo(this.litLayer);

    this.effects = new Effects(this);
    this.crosshairGfx = this.add.graphics().setScrollFactor(0).setDepth(40);

    const touch = isTouchDevice();
    this.controls = touch ? new TouchControls() : new DesktopControls(this);
    if (touch) installOrientationGate();

    initBuyMenu((kind, id) => {
      this.session.buyItem(kind, id);
      audio.playUi();
    });

    this.input.once("pointerdown", () => this.unlockAudioOnce());
    this.input.keyboard?.once("keydown", () => this.unlockAudioOnce());

    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      this.cameras.main.setSize(size.width, size.height);
    });
  }

  private unlockAudioOnce(): void {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    audio.unlockAudio();
  }

  private drawWorld(): void {
    const dim = this.add.graphics().setDepth(0);
    dim.fillStyle(0x0d0d0f, 1);
    dim.fillRect(0, 0, this.map.width, this.map.height);
    for (const wall of this.map.solids) {
      dim.fillStyle(0x17171a, 1);
      dim.fillRect(wall.x, wall.y, wall.w, wall.h);
    }

    const litContainer = this.add.container(0, 0).setDepth(1);
    const floor = this.add.graphics();
    floor.fillStyle(0x1c1e22, 1);
    floor.fillRect(0, 0, this.map.width, this.map.height);
    floor.lineStyle(1, 0x24262b, 0.6);
    for (let x = 0; x <= this.map.width; x += 100) floor.lineBetween(x, 0, x, this.map.height);
    for (let y = 0; y <= this.map.height; y += 100) floor.lineBetween(0, y, this.map.width, y);
    litContainer.add(floor);

    for (const wall of this.map.walls) {
      const g = this.add.graphics();
      g.fillStyle(0x35383f, 1);
      g.fillRect(wall.x, wall.y, wall.w, wall.h);
      g.lineStyle(2, 0x5a5f68, 0.9);
      g.strokeRect(wall.x, wall.y, wall.w, wall.h);
      litContainer.add(g);
    }
    for (const prop of this.map.props) {
      const g = this.add.graphics();
      g.fillStyle(0x4a4030, 1);
      g.fillRect(prop.x, prop.y, prop.w, prop.h);
      g.lineStyle(1, 0x6b5c3f, 0.9);
      g.strokeRect(prop.x, prop.y, prop.w, prop.h);
      litContainer.add(g);
    }

    const site = this.add.graphics();
    site.lineStyle(2, 0xf59e0b, 0.5);
    site.strokeCircle(this.map.plantSite.x, this.map.plantSite.y, this.map.plantSite.radius);
    litContainer.add(site);

    this.litLayer = litContainer;
  }

  private drawCrosshair(player: PlayerState): void {
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const spreadPx = Math.min(60, player.inaccuracy * 500);
    const g = this.crosshairGfx;
    g.clear();
    if (!player.alive) return;
    g.lineStyle(2, 0xffffff, 0.85);
    const gap = 6 + spreadPx;
    const len = 8;
    g.lineBetween(cx - gap - len, cy, cx - gap, cy);
    g.lineBetween(cx + gap, cy, cx + gap + len, cy);
    g.lineBetween(cx, cy - gap - len, cx, cy - gap);
    g.lineBetween(cx, cy + gap, cx, cy + gap + len);
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    const nowMs = performance.now();

    this.updateConnectionState(nowMs);
    if (this.peerGoneShown) {
      updateDebugHud(this.session.stats);
      return;
    }

    const matchView = this.session.getMatchView(nowMs);
    this.smokeCircles = matchView.smokes.map((s) => ({ x: s.x, y: s.y, radius: 140 }));

    if (this.controls.consumeBuyToggle() && (isBuyMenuOpen() || matchView.phase === "freeze")) {
      // Closing is always allowed (never trap the player behind the menu once
      // live begins); opening is still freeze-phase-only, matching the spec.
      const world = this.session.getRenderState(nowMs);
      const localRole = this.session.localSlot === matchView.raiderSlot ? "raider" : "warden";
      toggleBuyMenu(world.players[this.session.localSlot], localRole);
      audio.playUi();
    }

    if (!isBuyMenuOpen()) {
      const raw = this.controls.sample(dt, this.lastLocalRender.x, this.lastLocalRender.y);
      this.session.handleLocalInput({ ...raw, dt });
    }

    const world = this.session.getRenderState(nowMs);
    const localSlot = this.session.localSlot;
    const remoteSlot = otherSlot(localSlot);
    const localPlayer = world.players[localSlot];
    const remotePlayer = world.players[remoteSlot];

    this.vision.update(localPlayer.x, localPlayer.y, localPlayer.angle, this.segments, this.smokeCircles);

    const remoteVisible =
      remotePlayer.connected &&
      remotePlayer.alive &&
      canSee(localPlayer.x, localPlayer.y, localPlayer.angle, remotePlayer.x, remotePlayer.y, this.segments, this.smokeCircles);

    for (const slot of [HOST_SLOT, JOINER_SLOT] as const) {
      const p = world.players[slot];
      const isLocal = slot === localSlot;
      const shouldShow = isLocal ? p.connected && p.alive : remoteVisible;
      const circle = this.circles.get(slot)!;
      const line = this.facingLines.get(slot)!;

      circle.setPosition(p.x, p.y);
      circle.setVisible(shouldShow);
      line.clear();
      if (shouldShow) {
        const len = PLAYER_RADIUS + 14;
        line.lineStyle(2, 0xffffff, 1);
        line.lineBetween(p.x, p.y, p.x + Math.cos(p.angle) * len, p.y + Math.sin(p.angle) * len);
      }

      if (isLocal) {
        this.lastLocalRender = { x: p.x, y: p.y };
        this.localRing.setPosition(p.x, p.y);
        this.localRing.setVisible(p.alive);
      }
    }

    for (const ev of this.session.drainEvents()) this.handleEvent(ev, localPlayer, remoteSlot, localSlot);

    this.drawCrosshair(localPlayer);

    if (this.controls.isScoreboardHeld()) {
      const localRole = localSlot === matchView.raiderSlot ? "raider" : "warden";
      const remoteRole = remoteSlot === matchView.raiderSlot ? "raider" : "warden";
      const names = this.session.getNicknames();
      renderScoreboard(localPlayer, localRole, names.local, remotePlayer, remoteRole, names.remote, matchView.wins[localSlot], matchView.wins[remoteSlot]);
      showScoreboard();
    } else {
      hideScoreboard();
    }

    const localRole = localSlot === matchView.raiderSlot ? "raider" : "warden";
    updateHud({ self: localPlayer, match: matchView, localWins: matchView.wins[localSlot], enemyWins: matchView.wins[remoteSlot], role: localRole });

    updateDebugHud(this.session.stats);
  }

  private handleEvent(ev: GameEvent, localPlayer: PlayerState, remoteSlot: Slot, localSlot: Slot): void {
    switch (ev.type) {
      case "shot": {
        const sawShooter = ev.shooter === localSlot || canSee(localPlayer.x, localPlayer.y, localPlayer.angle, ev.x, ev.y, this.segments, this.smokeCircles);
        if (sawShooter) {
          this.effects.muzzleFlash(ev.x, ev.y, ev.angle);
          this.effects.shellCasing(ev.x, ev.y, ev.angle);
          if (ev.hitX !== undefined && ev.hitY !== undefined) this.effects.tracer(ev.x, ev.y, ev.hitX, ev.hitY);
          if (ev.shooter === localSlot) this.effects.screenShake(0.003, 60);
        }
        if (ev.hitX !== undefined && ev.hitY !== undefined) {
          const sawImpact = sawShooter || canSee(localPlayer.x, localPlayer.y, localPlayer.angle, ev.hitX, ev.hitY, this.segments, this.smokeCircles);
          if (sawImpact) {
            if (ev.hit) {
              const targetSlot = otherSlot(ev.shooter);
              const circle = this.circles.get(targetSlot);
              if (circle) this.effects.hitFlash(circle, targetSlot === HOST_SLOT ? HOST_COLOR : JOINER_COLOR);
            } else {
              this.effects.impact(ev.hitX, ev.hitY);
            }
          }
        }
        if (ev.hit && otherSlot(ev.shooter) === localSlot) {
          this.effects.damageIndicator(Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, ev.x, ev.y));
        }
        const occluded = !hasLineOfSight(localPlayer.x, localPlayer.y, ev.x, ev.y, this.segments, this.smokeCircles);
        audio.playGunshot(getWeapon(ev.weaponId).class, ev.x, ev.y, localPlayer.x, localPlayer.y, localPlayer.angle, occluded);
        break;
      }
      case "melee": {
        if (ev.hit && otherSlot(ev.shooter) === localSlot) {
          this.effects.damageIndicator(Phaser.Math.Angle.Between(localPlayer.x, localPlayer.y, ev.x, ev.y));
          const circle = this.circles.get(localSlot);
          if (circle) this.effects.hitFlash(circle, localSlot === HOST_SLOT ? HOST_COLOR : JOINER_COLOR);
        }
        break;
      }
      case "reload": {
        const occluded = false;
        audio.playReload(localPlayer.x, localPlayer.y, localPlayer.x, localPlayer.y, localPlayer.angle, occluded);
        break;
      }
      case "planted": {
        const occluded = !hasLineOfSight(localPlayer.x, localPlayer.y, ev.x, ev.y, this.segments, this.smokeCircles);
        audio.playPlantThump(ev.x, ev.y, localPlayer.x, localPlayer.y, localPlayer.angle, occluded);
        break;
      }
      case "defused": {
        audio.playUi(880);
        break;
      }
      case "thrown": {
        this.effects.tracer(localPlayer.x, localPlayer.y, ev.x, ev.y);
        if (ev.kind === "flash") audio.playFlashBang(ev.x, ev.y, localPlayer.x, localPlayer.y, localPlayer.angle, false);
        else if (ev.kind === "frag") audio.playExplosion(ev.x, ev.y, localPlayer.x, localPlayer.y, localPlayer.angle, false);
        break;
      }
      case "flashed": {
        if (ev.slot === localSlot) audio.playUi(220);
        break;
      }
      case "roundStart": {
        hideRoundBanner();
        hideMatchEnd();
        hideBuyMenu();
        audio.playUi(500);
        break;
      }
      case "roundEnd": {
        showRoundBanner(ev.winner === localSlot, ev.reason);
        window.setTimeout(() => hideRoundBanner(), 3500);
        audio.playUi(ev.winner === localSlot ? 720 : 300);
        break;
      }
      case "matchEnd": {
        const wins = this.session.getMatchView(performance.now()).wins;
        showMatchEnd(ev.winner === localSlot, wins[localSlot], wins[remoteSlot], () => {
          this.session.requestRematch();
        });
        break;
      }
      default:
        break;
    }
  }

  private updateConnectionState(nowMs: number): void {
    if (this.peerGoneShown) return;

    if (this.session.stats.connected) {
      if (this.disconnectedSince !== null) {
        this.disconnectedSince = null;
        hideConnectionStatus();
      }
      return;
    }

    if (this.disconnectedSince === null) {
      this.disconnectedSince = nowMs;
    }
    const elapsed = nowMs - this.disconnectedSince;
    if (elapsed < DISCONNECT_GRACE_MS) {
      showReconnecting(Math.ceil((DISCONNECT_GRACE_MS - elapsed) / 1000));
    } else {
      this.peerGoneShown = true;
      showPeerGone(this.session.localSlot === HOST_SLOT, () => {
        location.hash = "";
        location.reload();
      });
    }
  }
}
