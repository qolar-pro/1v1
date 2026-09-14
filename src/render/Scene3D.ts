import * as THREE from "three";
import type { NetSession } from "../net/session";
import { HOST_SLOT, otherSlot, type PlayerState, type Slot } from "../sim/types";
import { hasLineOfSight, wallsToSegments, type Segment } from "../sim/raycast";
import { DISCONNECT_GRACE_MS, EYE_HEIGHT, FPS_FOV_DEG, PLAYER_RADIUS, PROP_HEIGHT, WALL_HEIGHT } from "../config";
import type { GameEvent } from "../sim/events";
import { getWeapon } from "../data/weapons";
import type { MapDef } from "../data/maps/types";
import { Effects } from "./Effects";
import type { Controls } from "./controls";
import { DesktopControls } from "./DesktopControls";
import { TouchControls, isTouchDevice } from "../ui/TouchControls";
import { installOrientationGate } from "../ui/OrientationGate";
import { hideBuyMenu, initBuyMenu, isBuyMenuOpen, toggleBuyMenu } from "../ui/BuyMenu";
import { hideScoreboard, renderScoreboard, showScoreboard } from "../ui/Scoreboard";
import { hideMatchEnd, hideRoundBanner, showMatchEnd, showRoundBanner } from "../ui/Results";
import { updateDebugHud } from "../ui/DebugHud";
import { hideConnectionStatus, showPeerGone, showReconnecting } from "../ui/ConnectionStatus";
import { updateHud } from "./Hud";
import * as audio from "../audio/engine";

const HOST_COLOR = 0x2dd4bf;
const JOINER_COLOR = 0xf59e0b;

export class Scene3D {
  private readonly session: NetSession;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private controls: Controls;
  private readonly map: MapDef;
  private readonly segments: Segment[];

  private readonly remoteMesh: THREE.Group;
  private readonly effects: Effects;
  private readonly smokeMeshes = new Map<string, THREE.Mesh>();

  private lookPromptEl: HTMLDivElement | null = null;
  private crosshairEl: HTMLDivElement | null = null;

  private audioUnlocked = false;
  private disconnectedSince: number | null = null;
  private peerGoneShown = false;
  private rafId = 0;
  private lastTime = performance.now();
  private disposed = false;

  constructor(session: NetSession, container: HTMLElement) {
    this.session = session;
    this.map = session.getMap();
    this.segments = wallsToSegments(this.map.solids);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(FPS_FOV_DEG, window.innerWidth / window.innerHeight, 1, 3000);
    this.scene.add(this.camera);

    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.Fog(0x05060a, 260, 1150);

    this.buildLighting();
    this.buildLevel();

    this.remoteMesh = this.buildPlayerMesh(otherSlot(session.localSlot));
    this.scene.add(this.remoteMesh);
    this.camera.add(this.buildViewmodel());
    const headlamp = new THREE.PointLight(0xcfd8ff, 1.2, 420, 1.6);
    this.camera.add(headlamp);

    this.effects = new Effects(this.scene, this.camera);

    const touch = isTouchDevice();
    this.controls = touch ? new TouchControls() : new DesktopControls(this.renderer.domElement);
    if (touch) installOrientationGate();
    if (!touch) this.installLookPrompt();
    this.installCrosshair();

    initBuyMenu((kind, id) => {
      this.session.buyItem(kind, id);
      audio.playUi();
    });

    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointerdown", this.unlockAudioOnce, { once: true });
    window.addEventListener("keydown", this.unlockAudioOnce, { once: true });

    this.rafId = requestAnimationFrame(this.loop);
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private readonly unlockAudioOnce = (): void => {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    audio.unlockAudio();
  };

  private installLookPrompt(): void {
    this.lookPromptEl = document.createElement("div");
    this.lookPromptEl.id = "look-prompt";
    this.lookPromptEl.textContent = "Click to look around";
    document.body.appendChild(this.lookPromptEl);
  }

  private installCrosshair(): void {
    this.crosshairEl = document.createElement("div");
    this.crosshairEl.id = "crosshair";
    this.crosshairEl.innerHTML = `
      <span class="ch ch-l"></span><span class="ch ch-r"></span>
      <span class="ch ch-t"></span><span class="ch ch-b"></span>
    `;
    document.body.appendChild(this.crosshairEl);
  }

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0xaeb8c8, 0x15161a, 1.6);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(400, 600, 200);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x6f7aa8, 0.4);
    fill.position.set(-300, 400, -400);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x404550, 0.6));
  }

  private buildLevel(): void {
    const floorGeo = new THREE.PlaneGeometry(this.map.width, this.map.height);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.map.width / 2, 0, this.map.height / 2);
    this.scene.add(floor);

    const grid = new THREE.GridHelper(Math.max(this.map.width, this.map.height), 22, 0x24262b, 0x24262b);
    grid.position.set(this.map.width / 2, 0.5, this.map.height / 2);
    this.scene.add(grid);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x35383f, roughness: 0.85 });
    for (const wall of this.map.walls) {
      const geo = new THREE.BoxGeometry(wall.w, WALL_HEIGHT, wall.h);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(wall.x + wall.w / 2, WALL_HEIGHT / 2, wall.y + wall.h / 2);
      this.scene.add(mesh);
    }

    const propMat = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.9 });
    for (const prop of this.map.props) {
      const geo = new THREE.BoxGeometry(prop.w, PROP_HEIGHT, prop.h);
      const mesh = new THREE.Mesh(geo, propMat);
      mesh.position.set(prop.x + prop.w / 2, PROP_HEIGHT / 2, prop.y + prop.h / 2);
      this.scene.add(mesh);
    }

    const ringGeo = new THREE.RingGeometry(this.map.plantSite.radius - 4, this.map.plantSite.radius, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.map.plantSite.x, 1, this.map.plantSite.y);
    this.scene.add(ring);
  }

  private buildPlayerMesh(slot: Slot): THREE.Group {
    const color = slot === HOST_SLOT ? HOST_COLOR : JOINER_COLOR;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, Math.max(1, EYE_HEIGHT - PLAYER_RADIUS * 2), 4, 8), bodyMat);
    body.position.y = EYE_HEIGHT * 0.5;
    group.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(6, 18, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, EYE_HEIGHT * 0.8, PLAYER_RADIUS + 8);
    group.add(nose);
    return group;
  }

  private buildViewmodel(): THREE.Object3D {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 });
    const gun = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 34), mat);
    gun.position.set(9, -9, -24);
    group.add(gun);
    return group;
  }

  private readonly loop = (time: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    const nowMs = performance.now();

    this.updateConnectionState(nowMs);
    if (this.peerGoneShown) {
      updateDebugHud(this.session.stats);
      return;
    }

    const matchView = this.session.getMatchView(nowMs);
    this.syncSmokeVolumes(matchView.smokes);

    if (this.controls.consumeBuyToggle() && (isBuyMenuOpen() || matchView.phase === "freeze")) {
      const world = this.session.getRenderState(nowMs);
      const localRole = this.session.localSlot === matchView.raiderSlot ? "raider" : "warden";
      toggleBuyMenu(world.players[this.session.localSlot], localRole);
      audio.playUi();
    }

    if (isBuyMenuOpen()) {
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    } else {
      const raw = this.controls.sample(dt);
      this.session.handleLocalInput({ ...raw, dt });
    }

    const world = this.session.getRenderState(nowMs);
    const localSlot = this.session.localSlot;
    const remoteSlot = otherSlot(localSlot);
    const localPlayer = world.players[localSlot];
    const remotePlayer = world.players[remoteSlot];

    const pitch = this.controls.getPitch();
    const yaw = localPlayer.angle;
    this.camera.position.set(localPlayer.x, EYE_HEIGHT, localPlayer.y);
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this.effects.applyShake();

    this.renderer.domElement.style.filter = localPlayer.alive ? "" : "grayscale(1) brightness(0.45)";

    if (this.lookPromptEl) {
      this.lookPromptEl.hidden = document.pointerLockElement === this.renderer.domElement || isBuyMenuOpen();
    }

    const remoteVisible = remotePlayer.connected && remotePlayer.alive;
    this.remoteMesh.visible = remoteVisible;
    if (remoteVisible) {
      this.remoteMesh.position.set(remotePlayer.x, 0, remotePlayer.y);
      this.remoteMesh.rotation.y = Math.PI / 2 - remotePlayer.angle;
    }

    for (const ev of this.session.drainEvents()) this.handleEvent(ev, localPlayer, remoteSlot, localSlot);

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
    this.updateCrosshair(localPlayer);

    updateDebugHud(this.session.stats);

    this.renderer.render(this.scene, this.camera);
  };

  private syncSmokeVolumes(smokes: { x: number; y: number; remainingMs: number }[]): void {
    const seen = new Set<string>();
    for (const s of smokes) {
      const key = `${Math.round(s.x)},${Math.round(s.y)}`;
      seen.add(key);
      let mesh = this.smokeMeshes.get(key);
      if (!mesh) {
        const geo = new THREE.SphereGeometry(140, 12, 10);
        const mat = new THREE.MeshBasicMaterial({ color: 0xc9cdd4, transparent: true, opacity: 0.55, depthWrite: false });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(s.x, PROP_HEIGHT, s.y);
        this.scene.add(mesh);
        this.smokeMeshes.set(key, mesh);
      }
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = s.remainingMs < 1500 ? 0.55 * (s.remainingMs / 1500) : 0.55;
    }
    for (const [key, mesh] of this.smokeMeshes) {
      if (!seen.has(key)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.smokeMeshes.delete(key);
      }
    }
  }

  private updateCrosshair(player: PlayerState): void {
    if (!this.crosshairEl) return;
    if (!player.alive) {
      this.crosshairEl.style.display = "none";
      return;
    }
    this.crosshairEl.style.display = "";
    const gap = 6 + Math.min(60, player.inaccuracy * 500);
    this.crosshairEl.style.setProperty("--gap", `${gap}px`);
  }

  private handleEvent(ev: GameEvent, localPlayer: PlayerState, remoteSlot: Slot, localSlot: Slot): void {
    switch (ev.type) {
      case "shot": {
        const sawShooter = ev.shooter === localSlot || hasLineOfSight(localPlayer.x, localPlayer.y, ev.x, ev.y, this.segments);
        if (sawShooter) {
          this.effects.muzzleFlash(ev.x, ev.y, ev.angle);
          if (ev.hitX !== undefined && ev.hitY !== undefined) this.effects.tracer(ev.x, ev.y, ev.hitX, ev.hitY);
          if (ev.shooter === localSlot) this.effects.screenShake(1.4, 60);
        }
        if (ev.hitX !== undefined && ev.hitY !== undefined) {
          const sawImpact = sawShooter || hasLineOfSight(localPlayer.x, localPlayer.y, ev.hitX, ev.hitY, this.segments);
          if (sawImpact) {
            if (ev.hit) this.effects.hitFlash(this.remoteMesh);
            else this.effects.impact(ev.hitX, ev.hitY);
          }
        }
        if (ev.hit && otherSlot(ev.shooter) === localSlot) {
          this.effects.screenShake(2.2, 90);
        }
        const occluded = !hasLineOfSight(localPlayer.x, localPlayer.y, ev.x, ev.y, this.segments);
        audio.playGunshot(getWeapon(ev.weaponId).class, ev.x, ev.y, localPlayer.x, localPlayer.y, localPlayer.angle, occluded);
        break;
      }
      case "melee": {
        if (ev.hit && otherSlot(ev.shooter) === localSlot) {
          this.effects.screenShake(2.5, 100);
        }
        break;
      }
      case "reload": {
        audio.playReload(localPlayer.x, localPlayer.y, localPlayer.x, localPlayer.y, localPlayer.angle, false);
        break;
      }
      case "planted": {
        const occluded = !hasLineOfSight(localPlayer.x, localPlayer.y, ev.x, ev.y, this.segments);
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

    if (this.disconnectedSince === null) this.disconnectedSince = nowMs;
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

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.controls.destroy();
    this.renderer.dispose();
  }
}
