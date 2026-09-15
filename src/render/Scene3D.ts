import * as THREE from "three";
import type { NetSession } from "../net/session";
import { HOST_SLOT, otherSlot, type PlayerState, type Slot } from "../sim/types";
import { hasLineOfSight, wallsToSegments, type Segment } from "../sim/raycast";
import { activeWeaponId, pitchedHeightAt } from "../sim/combat";
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
import { initTutorial } from "../ui/Tutorial";
import { hideScoreboard, renderScoreboard, showScoreboard } from "../ui/Scoreboard";
import { hideMatchEnd, hideRoundBanner, showMatchEnd, showRoundBanner } from "../ui/Results";
import { updateDebugHud } from "../ui/DebugHud";
import { hideConnectionStatus, showPeerGone, showReconnecting } from "../ui/ConnectionStatus";
import { updateHud } from "./Hud";
import * as audio from "../audio/engine";
import { assetUrl } from "../data/assets.manifest";

const TEXTURE_LOADER = new THREE.TextureLoader();
const WORLD_UNITS_PER_TILE = 140;

function loadTiledTexture(url: string, repeatX: number, repeatY: number): THREE.Texture {
  const tex = TEXTURE_LOADER.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
  private viewmodelGroup: THREE.Group | null = null;
  private currentViewmodelWeaponId: string | null = null;

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
    // Far distance must clear the longest sightline on any map (raider<->warden
    // spawns are ~1760u apart on straight corridors) or opponents fog out to
    // pure black before they're ever visible — this was making the far spawn
    // completely invisible from the near spawn even with everything in sync.
    this.scene.fog = new THREE.Fog(0x05060a, 300, 2500);

    this.buildLighting();
    this.buildLevel();

    this.remoteMesh = this.buildPlayerMesh(otherSlot(session.localSlot));
    this.scene.add(this.remoteMesh);
    this.rebuildViewmodel("pistol");
    const headlamp = new THREE.PointLight(0xcfd8ff, 1.2, 420, 1.6);
    this.camera.add(headlamp);

    this.effects = new Effects(this.scene, this.camera);

    const touch = isTouchDevice();
    this.controls = touch ? new TouchControls() : new DesktopControls(this.renderer.domElement);
    if (touch) installOrientationGate();
    if (!touch) this.installLookPrompt();
    this.installCrosshair();
    initTutorial();

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
    const floorTex = loadTiledTexture(assetUrl("floor.concrete"), this.map.width / WORLD_UNITS_PER_TILE, this.map.height / WORLD_UNITS_PER_TILE);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.map.width / 2, 0, this.map.height / 2);
    this.scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    for (const wall of this.map.walls) {
      const geo = new THREE.BoxGeometry(wall.w, WALL_HEIGHT, wall.h);
      const mat = wallMat.clone();
      mat.map = loadTiledTexture(assetUrl("wall.metal"), Math.max(wall.w, wall.h) / WORLD_UNITS_PER_TILE, WALL_HEIGHT / WORLD_UNITS_PER_TILE);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wall.x + wall.w / 2, WALL_HEIGHT / 2, wall.y + wall.h / 2);
      this.scene.add(mesh);
    }

    const crateMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    for (const prop of this.map.props) {
      const geo = new THREE.BoxGeometry(prop.w, PROP_HEIGHT, prop.h);
      const mat = crateMat.clone();
      mat.map = loadTiledTexture(assetUrl("material.crate"), Math.max(1, prop.w / WORLD_UNITS_PER_TILE), Math.max(1, PROP_HEIGHT / WORLD_UNITS_PER_TILE));
      const mesh = new THREE.Mesh(geo, mat);
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

  /**
   * A blocky low-poly soldier built from the same box-primitive language as
   * the weapon viewmodels and the crate/wall geometry, rather than a smooth
   * capsule — a capsule-plus-cone read as a placeholder next to everything
   * else's sharp industrial edges. The gunmetal-textured chest plate ties the
   * model back to the weapons/environment materials on purpose.
   */
  private buildPlayerMesh(slot: Slot): THREE.Group {
    const color = slot === HOST_SLOT ? HOST_COLOR : JOINER_COLOR;
    const group = new THREE.Group();

    // Fabric goes on as a bump map only, not a color map — team color has to
    // stay flat and saturated for instant at-a-glance recognition (a fully
    // textured capsule muddied the amber/teal identity badly on a first try).
    const fabricTex = loadTiledTexture(assetUrl("material.fabric"), 1, 1);
    const plateTex = loadTiledTexture(assetUrl("material.gunmetal"), 1, 1);

    const pantsMat = new THREE.MeshStandardMaterial({ bumpMap: fabricTex, bumpScale: 0.5, color: 0x24262b, roughness: 0.85 });
    const vestMat = new THREE.MeshStandardMaterial({ bumpMap: fabricTex, bumpScale: 0.5, color, roughness: 0.7 });
    const sleeveMat = new THREE.MeshStandardMaterial({ bumpMap: fabricTex, bumpScale: 0.5, color: 0x1c1d20, roughness: 0.8 });
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, color: 0x8a8f99, roughness: 0.4, metalness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.6 });
    const visorMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3 });

    const legW = PLAYER_RADIUS * 1.1;
    const legD = PLAYER_RADIUS * 0.9;
    const legH = 26;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legD), pantsMat);
    legs.position.y = legH / 2;
    group.add(legs);

    const torsoW = PLAYER_RADIUS * 1.7;
    const torsoD = PLAYER_RADIUS * 1.1;
    const torsoH = 24;
    const torsoY = legH + torsoH / 2;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), vestMat);
    torso.position.y = torsoY;
    group.add(torso);

    const plate = new THREE.Mesh(new THREE.BoxGeometry(torsoW * 0.6, torsoH * 0.75, 3), plateMat);
    plate.position.set(0, torsoY, torsoD / 2 + 1.5);
    group.add(plate);

    const sleeveW = 7;
    const sleeveH = torsoH - 2;
    for (const side of [-1, 1]) {
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(sleeveW, sleeveH, torsoD * 0.9), sleeveMat);
      sleeve.position.set(side * (torsoW / 2 + sleeveW / 2 - 1), torsoY, 0);
      group.add(sleeve);
    }

    const headSize = 15;
    const headY = legH + torsoH + headSize / 2;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), headMat);
    head.position.y = headY;
    group.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.8, headSize * 0.25, 2), visorMat);
    visor.position.set(0, headY + 1, headSize / 2 + 0.5);
    group.add(visor);

    return group;
  }

  /** Rebuilds the first-person weapon model to match the currently equipped weapon's class. */
  private rebuildViewmodel(weaponClass: string): void {
    if (this.viewmodelGroup) {
      this.camera.remove(this.viewmodelGroup);
      this.viewmodelGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
            m.dispose();
          }
        }
      });
    }
    this.viewmodelGroup = this.buildGunModel(weaponClass);
    this.camera.add(this.viewmodelGroup);
  }

  private buildGunModel(weaponClass: string): THREE.Group {
    const group = new THREE.Group();
    group.position.set(9, -9, -24);

    const metalTex = loadTiledTexture(assetUrl("material.gunmetal"), 1, 1);
    const gripTex = loadTiledTexture(assetUrl("material.gunmetal"), 0.5, 0.5);
    const metal = new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.45, metalness: 0.5 });
    const grip = new THREE.MeshStandardMaterial({ map: gripTex, color: 0x1c1d20, roughness: 0.85, metalness: 0.1 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      group.add(mesh);
    };

    switch (weaponClass) {
      case "pistol":
        add(new THREE.BoxGeometry(5, 5, 14), metal, 0, 2, 0);
        add(new THREE.BoxGeometry(2.5, 2.5, 8), metal, 0, 3, -10);
        add(new THREE.BoxGeometry(4, 8, 4), grip, 0, -4, 4);
        break;
      case "smg":
        add(new THREE.BoxGeometry(6, 6, 20), metal, 0, 2, -2);
        add(new THREE.BoxGeometry(2.5, 2.5, 8), metal, 0, 3, -14);
        add(new THREE.BoxGeometry(4, 8, 4), grip, 0, -4, 2);
        add(new THREE.BoxGeometry(3, 3, 10), grip, 0, -8, 4);
        add(new THREE.BoxGeometry(2, 2, 12), metal, 0, 1, 12, 0.35, 0, 0);
        break;
      case "rifle":
        add(new THREE.BoxGeometry(6, 6, 30), metal, 0, 2, -4);
        add(new THREE.BoxGeometry(2.5, 2.5, 12), metal, 0, 3, -22);
        add(new THREE.BoxGeometry(4, 8, 4), grip, 0, -4, 0);
        add(new THREE.BoxGeometry(3, 3, 12), grip, 0, -8, -2);
        add(new THREE.BoxGeometry(4, 4, 10), metal, 0, 2, 14);
        break;
      case "sniper":
        add(new THREE.BoxGeometry(5, 5, 36), metal, 0, 2, -6);
        add(new THREE.CylinderGeometry(1.3, 1.3, 16, 8), metal, 0, 3, -28, Math.PI / 2, 0, 0);
        add(new THREE.CylinderGeometry(1.8, 1.8, 12, 8), grip, 0, 7, -8, Math.PI / 2, 0, 0);
        add(new THREE.BoxGeometry(4, 8, 4), grip, 0, -4, 4);
        add(new THREE.BoxGeometry(4, 4, 10), metal, 0, 2, 18);
        break;
      default: // melee
        add(new THREE.BoxGeometry(2, 1, 16), metal, 0, 2, -10);
        add(new THREE.CylinderGeometry(1.5, 1.5, 8, 8), grip, 0, 0, 2, Math.PI / 2, 0, 0);
        break;
    }

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

    const equippedId = activeWeaponId(localPlayer);
    if (equippedId !== this.currentViewmodelWeaponId) {
      this.currentViewmodelWeaponId = equippedId;
      this.rebuildViewmodel(getWeapon(equippedId).class);
    }

    const pitch = this.controls.getPitch();
    const yaw = localPlayer.angle;
    this.camera.position.set(localPlayer.x, EYE_HEIGHT + localPlayer.jumpZ, localPlayer.y);
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
      this.remoteMesh.position.set(remotePlayer.x, remotePlayer.jumpZ, remotePlayer.y);
      this.remoteMesh.rotation.y = Math.PI / 2 - remotePlayer.angle;
    }

    for (const ev of this.session.drainEvents()) this.handleEvent(ev, localPlayer, remotePlayer, remoteSlot, localSlot);

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

  private handleEvent(ev: GameEvent, localPlayer: PlayerState, remotePlayer: PlayerState, remoteSlot: Slot, localSlot: Slot): void {
    switch (ev.type) {
      case "shot": {
        const shooterJumpZ = ev.shooter === localSlot ? localPlayer.jumpZ : remotePlayer.jumpZ;
        const originHeight = EYE_HEIGHT + shooterJumpZ;
        const sawShooter = ev.shooter === localSlot || hasLineOfSight(localPlayer.x, localPlayer.y, ev.x, ev.y, this.segments);
        let hitHeight = originHeight;
        if (ev.hitX !== undefined && ev.hitY !== undefined) {
          const horizontalDist = Math.hypot(ev.hitX - ev.x, ev.hitY - ev.y);
          hitHeight = pitchedHeightAt(originHeight, ev.pitch, horizontalDist);
        }
        if (sawShooter) {
          this.effects.muzzleFlash(ev.x, ev.y, originHeight, ev.angle);
          if (ev.hitX !== undefined && ev.hitY !== undefined) this.effects.tracer(ev.x, ev.y, originHeight, ev.hitX, ev.hitY, hitHeight);
          if (ev.shooter === localSlot) this.effects.screenShake(1.4, 60);
        }
        if (ev.hitX !== undefined && ev.hitY !== undefined) {
          const sawImpact = sawShooter || hasLineOfSight(localPlayer.x, localPlayer.y, ev.hitX, ev.hitY, this.segments);
          if (sawImpact) {
            if (ev.hit) this.effects.hitFlash(this.remoteMesh);
            else this.effects.impact(ev.hitX, ev.hitY, hitHeight);
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
        this.effects.tracer(localPlayer.x, localPlayer.y, EYE_HEIGHT + localPlayer.jumpZ, ev.x, ev.y, EYE_HEIGHT);
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
