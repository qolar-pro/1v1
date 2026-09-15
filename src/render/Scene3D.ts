import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
import { assetUrl, type AssetKey } from "../data/assets.manifest";

const TEXTURE_LOADER = new THREE.TextureLoader();
const WORLD_UNITS_PER_TILE = 140;
// Set once a renderer exists (see Scene3D constructor) so every tiled texture
// gets sharp detail at grazing angles instead of the default blurry mip.
let MAX_ANISOTROPY = 1;

function loadTiledTexture(url: string, repeatX: number, repeatY: number): THREE.Texture {
  const tex = TEXTURE_LOADER.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
}

const HOST_COLOR = 0x2dd4bf;
const JOINER_COLOR = 0xf59e0b;

// Real modeled weapon geometry (CC0 "Ultimate Guns Pack" by Quaternius — see
// public/assets/models/CREDITS.md) for the classes it covers. Melee has no
// blade in the pack, so it stays on the procedural knife from buildGunModel.
const GLTF_LOADER = new GLTFLoader();
const GUN_MODEL_BY_CLASS: Partial<Record<string, AssetKey>> = {
  pistol: "model.pistol",
  smg: "model.smg",
  rifle: "model.rifle",
  sniper: "model.sniper",
};
// Longest-axis target length (world units) each imported model is uniformly
// scaled to, roughly matching the old procedural geometry's proportions.
const GUN_MODEL_TARGET_LENGTH: Partial<Record<string, number>> = {
  pistol: 17,
  smg: 26,
  rifle: 32,
  sniper: 40,
};

export class Scene3D {
  private readonly session: NetSession;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private controls: Controls;
  private readonly map: MapDef;
  private readonly segments: Segment[];

  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly remoteMesh: THREE.Group;
  private readonly effects: Effects;
  private readonly smokeMeshes = new Map<string, THREE.Mesh>();
  private viewmodelGroup: THREE.Group | null = null;
  private readonly gltfCache = new Map<string, THREE.Object3D>();
  private readonly gltfPending = new Set<string>();
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
    // ACES filmic tone mapping is what gives modern realtime-3D games their
    // "cinematic" rolled-off highlights instead of the flat/blown-out look of
    // the default linear mapping — the single biggest lever for a more
    // realistic feel that doesn't require new geometry or textures.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    MAX_ANISOTROPY = this.renderer.capabilities.getMaxAnisotropy();

    this.camera = new THREE.PerspectiveCamera(FPS_FOV_DEG, window.innerWidth / window.innerHeight, 1, 3000);
    this.scene.add(this.camera);

    this.scene.background = new THREE.Color(0x05060a);
    // Far distance must clear the longest sightline on any map (raider<->warden
    // spawns are ~1760u apart on straight corridors) or opponents fog out to
    // pure black before they're ever visible — this was making the far spawn
    // completely invisible from the near spawn even with everything in sync.
    this.scene.fog = new THREE.Fog(0x05060a, 300, 2500);

    // A generic neutral "room" environment (procedural, no art asset needed)
    // gives every metal/PBR material real specular reflections instead of
    // looking flat-lit — this is most of what separates "textured boxes" from
    // something that reads as an actual physical material.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.buildLighting();
    this.buildLevel();

    this.remoteMesh = this.buildPlayerMesh(otherSlot(session.localSlot));
    this.scene.add(this.remoteMesh);
    this.rebuildViewmodel("pistol");
    const headlamp = new THREE.PointLight(0xcfd8ff, 1.2, 420, 1.6);
    this.camera.add(headlamp);

    this.effects = new Effects(this.scene, this.camera);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.4, 0.85);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

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
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass.setSize(window.innerWidth, window.innerHeight);
  };

  private readonly unlockAudioOnce = (): void => {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    audio.unlockAudio();
  };

  private installLookPrompt(): void {
    this.lookPromptEl = document.createElement("div");
    this.lookPromptEl.id = "look-prompt";
    this.lookPromptEl.textContent = "Click to lock mouse & look around (Esc to release)";
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

    const centerX = this.map.width / 2;
    const centerZ = this.map.height / 2;
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(centerX + 400, 600, centerZ + 200);
    dir.target.position.set(centerX, 0, centerZ);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const halfExtent = Math.max(this.map.width, this.map.height) / 2 + 100;
    dir.shadow.camera.left = -halfExtent;
    dir.shadow.camera.right = halfExtent;
    dir.shadow.camera.top = halfExtent;
    dir.shadow.camera.bottom = -halfExtent;
    dir.shadow.camera.near = 10;
    dir.shadow.camera.far = 2200;
    dir.shadow.bias = -0.0015;
    dir.shadow.normalBias = 0.6;
    this.scene.add(dir);
    this.scene.add(dir.target);

    const fill = new THREE.DirectionalLight(0x6f7aa8, 0.4);
    fill.position.set(centerX - 300, 400, centerZ - 400);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x404550, 0.6));
  }

  private buildLevel(): void {
    const floorGeo = new THREE.PlaneGeometry(this.map.width, this.map.height);
    const floorTex = loadTiledTexture(assetUrl("floor.concrete"), this.map.width / WORLD_UNITS_PER_TILE, this.map.height / WORLD_UNITS_PER_TILE);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0.1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.map.width / 2, 0, this.map.height / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.35 });
    for (const wall of this.map.walls) {
      const geo = new THREE.BoxGeometry(wall.w, WALL_HEIGHT, wall.h);
      const mat = wallMat.clone();
      mat.map = loadTiledTexture(assetUrl("wall.metal"), Math.max(wall.w, wall.h) / WORLD_UNITS_PER_TILE, WALL_HEIGHT / WORLD_UNITS_PER_TILE);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wall.x + wall.w / 2, WALL_HEIGHT / 2, wall.y + wall.h / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    const crateMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.25 });
    for (const prop of this.map.props) {
      const geo = new THREE.BoxGeometry(prop.w, PROP_HEIGHT, prop.h);
      const mat = crateMat.clone();
      mat.map = loadTiledTexture(assetUrl("material.crate"), Math.max(1, prop.w / WORLD_UNITS_PER_TILE), Math.max(1, PROP_HEIGHT / WORLD_UNITS_PER_TILE));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(prop.x + prop.w / 2, PROP_HEIGHT / 2, prop.y + prop.h / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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

    // Rounded box edges instead of razor-sharp cube corners — a small change
    // that reads as a much less "programmer art" silhouette once lit, since
    // real gear/armor edges catch light as a soft highlight, not a hard line.
    const legW = PLAYER_RADIUS * 1.1;
    const legD = PLAYER_RADIUS * 0.9;
    const legH = 26;
    const legs = new THREE.Mesh(new RoundedBoxGeometry(legW, legH, legD, 2, 2), pantsMat);
    legs.position.y = legH / 2;
    group.add(legs);

    const torsoW = PLAYER_RADIUS * 1.7;
    const torsoD = PLAYER_RADIUS * 1.1;
    const torsoH = 24;
    const torsoY = legH + torsoH / 2;
    const torso = new THREE.Mesh(new RoundedBoxGeometry(torsoW, torsoH, torsoD, 2, 2), vestMat);
    torso.position.y = torsoY;
    group.add(torso);

    const plate = new THREE.Mesh(new RoundedBoxGeometry(torsoW * 0.6, torsoH * 0.75, 3, 2, 1), plateMat);
    plate.position.set(0, torsoY, torsoD / 2 + 1.5);
    group.add(plate);

    const sleeveW = 7;
    const sleeveH = torsoH - 2;
    for (const side of [-1, 1]) {
      const sleeve = new THREE.Mesh(new RoundedBoxGeometry(sleeveW, sleeveH, torsoD * 0.9, 1, 2), sleeveMat);
      sleeve.position.set(side * (torsoW / 2 + sleeveW / 2 - 1), torsoY, 0);
      group.add(sleeve);
    }

    const headSize = 15;
    const headY = legH + torsoH + headSize / 2;
    const head = new THREE.Mesh(new RoundedBoxGeometry(headSize, headSize, headSize, 2, 3), headMat);
    head.position.y = headY;
    group.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.8, headSize * 0.25, 2), visorMat);
    visor.position.set(0, headY + 1, headSize / 2 + 0.5);
    group.add(visor);

    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  /** Rebuilds the first-person weapon model to match the currently equipped weapon's class. */
  private rebuildViewmodel(weaponClass: string): void {
    if (this.viewmodelGroup) {
      this.camera.remove(this.viewmodelGroup);
      this.viewmodelGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // GLTF-sourced meshes share their geometry with the cached template
          // (cloned via .clone(), which copies the reference, not the data) —
          // disposing it here would corrupt every future weapon-switch clone.
          if (!child.userData.sharedGeometry) child.geometry.dispose();
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

  /**
   * Every weapon class gets its own real part list (slide/barrel/trigger
   * guard/sights/magazine/stock/optic, not just 2-3 stretched boxes) so each
   * reads as an actual gun silhouette instead of a gray brick. Parts use
   * RoundedBoxGeometry to match the player model's bevel language, and small
   * hardware (sights, triggers, mags) gets a separate darker-tinted metal
   * from the main barrel/slide so the model reads as multiple materials the
   * way a real gun does, not one flat-shaded block.
   */
  private buildGunMaterials(): { metal: THREE.MeshStandardMaterial; grip: THREE.MeshStandardMaterial; hardware: THREE.MeshStandardMaterial; lens: THREE.MeshStandardMaterial } {
    const metalTex = loadTiledTexture(assetUrl("material.gunmetal"), 1, 1);
    const gripTex = loadTiledTexture(assetUrl("material.gunmetal"), 0.5, 0.5);
    const hardwareTex = loadTiledTexture(assetUrl("material.gunmetal"), 0.35, 0.35);
    return {
      metal: new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.4, metalness: 0.6 }),
      grip: new THREE.MeshStandardMaterial({ map: gripTex, color: 0x1c1d20, roughness: 0.85, metalness: 0.1 }),
      hardware: new THREE.MeshStandardMaterial({ map: hardwareTex, color: 0x101114, roughness: 0.5, metalness: 0.65 }),
      lens: new THREE.MeshStandardMaterial({ color: 0x0a1622, emissive: 0x2fc8ff, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.3 }),
    };
  }

  /**
   * Clones the cached GLTF template for this weapon class, re-scales it to
   * our viewmodel's world-unit scale, and swaps every sub-mesh's material for
   * one of ours (matched by the source material's name — Quaternius's pack
   * consistently names parts Metal/DarkMetal/LightMetal/Grey, Wood/DarkWood,
   * Black/Black2, and Glass, which maps cleanly onto our metal/grip/hardware/
   * lens set) rather than trusting the pack's own flat-color materials, so
   * the model matches this scene's lighting/shadows/bloom instead of looking
   * pasted in from a different renderer.
   */
  private styleImportedGunModel(weaponClass: string): THREE.Group {
    const source = this.gltfCache.get(weaponClass)!;
    const instance = source.clone(true);
    const { metal, grip, hardware, lens } = this.buildGunMaterials();

    instance.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.userData.sharedGeometry = true;
        const name = (Array.isArray(child.material) ? child.material[0]?.name : child.material.name)?.toLowerCase() ?? "";
        child.material = name.includes("glass") ? lens : name.includes("wood") ? grip : name.includes("metal") || name.includes("grey") ? metal : hardware;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Normalize scale: the pack's models come in at whatever raw unit the
    // original FBX export used, not this game's world-unit scale.
    const box = new THREE.Box3().setFromObject(instance);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const targetLength = GUN_MODEL_TARGET_LENGTH[weaponClass] ?? 26;
    const scale = targetLength / longest;
    instance.scale.setScalar(scale);

    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    const wrapper = new THREE.Group();
    wrapper.position.set(9, -9, -24);
    instance.position.set(-center.x, -center.y, -center.z);
    // Quaternius's export forward axis lands on +Z after the pack's own
    // baked Z-up->Y-up correction; our camera-forward is -Z, so face it.
    instance.rotation.y = Math.PI;
    wrapper.add(instance);
    return wrapper;
  }

  private ensureGltfLoaded(weaponClass: string): void {
    if (this.gltfCache.has(weaponClass) || this.gltfPending.has(weaponClass)) return;
    const key = GUN_MODEL_BY_CLASS[weaponClass];
    if (!key) return;
    this.gltfPending.add(weaponClass);
    GLTF_LOADER.load(
      assetUrl(key),
      (gltf) => {
        this.gltfPending.delete(weaponClass);
        this.gltfCache.set(weaponClass, gltf.scene);
        // If the player is still holding this class once the (tiny, ~70KB)
        // model finishes loading, swap the procedural placeholder for it.
        if (this.currentViewmodelWeaponId && getWeapon(this.currentViewmodelWeaponId).class === weaponClass) {
          this.rebuildViewmodel(weaponClass);
        }
      },
      undefined,
      () => this.gltfPending.delete(weaponClass),
    );
  }

  private buildGunModel(weaponClass: string): THREE.Group {
    if (this.gltfCache.has(weaponClass)) return this.styleImportedGunModel(weaponClass);
    this.ensureGltfLoaded(weaponClass);

    const group = new THREE.Group();
    group.position.set(9, -9, -24);

    const { metal, grip, hardware, lens } = this.buildGunMaterials();

    const rb = (w: number, h: number, d: number, radius = 0.6): THREE.BufferGeometry =>
      new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 2, h / 2, d / 2));

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      group.add(mesh);
      return mesh;
    };

    switch (weaponClass) {
      case "pistol":
        add(rb(4.5, 4.5, 15), metal, 0, 2.5, -1); // slide
        add(rb(2, 2, 5, 0.5), metal, 0, 2.5, -9.5); // barrel/muzzle tip
        add(rb(4.6, 1, 3), hardware, 0, 4.6, -6); // rear sight
        add(rb(1.2, 1, 1.6), hardware, 0, 4.5, -8.8); // front sight
        add(rb(3.8, 8, 3.6, 0.8), grip, 0, -4, 4); // grip
        add(rb(4.2, 1.2, 3.2), hardware, 0, -7.8, 3.6); // mag base
        add(new THREE.TorusGeometry(2.1, 0.5, 6, 10, Math.PI), hardware, 0, -0.2, 1.5, 0, Math.PI / 2, 0); // trigger guard
        add(rb(0.7, 1.6, 0.6), hardware, 0, 0.2, 1.2); // trigger
        break;

      case "smg":
        add(rb(5.5, 5.5, 22), metal, 0, 2.5, -3); // receiver
        add(rb(2.2, 2.2, 8), metal, 0, 2.5, -16); // barrel
        add(new THREE.CylinderGeometry(1.6, 1.6, 3, 10), hardware, 0, 2.5, -20.5, Math.PI / 2, 0, 0); // muzzle device
        add(rb(3.8, 3, 10), grip, 0, -0.5, -6, -0.05, 0, 0); // handguard
        add(rb(1.6, 3, 1.6), grip, 0, -3, -9); // foregrip
        add(rb(4.6, 1, 2.6), hardware, 0, 5.4, -13); // rear sight
        add(rb(1, 1, 1.4), hardware, 0, 5.3, -19); // front sight
        add(rb(3.6, 8, 3.4, 0.8), grip, 0, -4, 3); // grip
        add(rb(4, 1.2, 3), hardware, 0, -7.7, 2.6); // mag base
        add(rb(3.2, 3.2, 2), grip, 0, -1, 9); // stock body
        add(new THREE.CylinderGeometry(0.8, 0.8, 6, 8), hardware, 0, -1, 12, Math.PI / 2, 0, 0); // stock tube
        add(new THREE.TorusGeometry(1.9, 0.4, 6, 10, Math.PI), hardware, 0, -0.3, 0.5, 0, Math.PI / 2, 0); // trigger guard
        break;

      case "rifle":
        add(rb(5.5, 5.5, 30), metal, 0, 2.5, -4); // receiver
        add(rb(2.2, 2.2, 14), metal, 0, 2, -24); // barrel
        add(new THREE.CylinderGeometry(1.9, 1.9, 4, 10), metal, 0, 2, -30.5, Math.PI / 2, 0, 0); // muzzle brake body
        add(new THREE.CylinderGeometry(1.9, 2.3, 1, 10), hardware, 0, 2, -32.4, Math.PI / 2, 0, 0); // muzzle brake cap
        add(rb(4, 3.6, 14), grip, 0, -0.3, -18); // handguard
        add(rb(1.6, 3, 1.6), grip, 0, -3.4, -14); // vertical foregrip
        add(rb(4, 1.4, 6, 0.4), hardware, 0, 5.4, -6); // top rail
        add(rb(2.2, 1.8, 1.6), hardware, 0, 6.6, -5); // red-dot body
        add(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 10), lens, 0, 6.6, -3.6, Math.PI / 2, 0, 0); // red-dot lens
        add(rb(3.8, 8, 3.6, 0.8), grip, 0, -4, 0); // grip
        add(rb(4.6, 8, 3.2, 0.8), hardware, -0.5, -8, 2, 0, 0, -0.18); // curved magazine
        add(rb(3.4, 3.6, 3.4, 0.7), grip, 0, 1, 13); // stock
        add(new THREE.CylinderGeometry(1.1, 1.1, 5, 8), hardware, 0, 1, 10.5, Math.PI / 2, 0, 0); // buffer tube
        add(rb(3, 1.6, 3), grip, 0, -1.6, 15.5); // stock butt-pad
        break;

      case "sniper":
        add(rb(5, 5, 34), metal, 0, 2.5, -6); // receiver
        add(rb(2, 2, 16), metal, 0, 2, -30); // heavy barrel
        add(new THREE.CylinderGeometry(1.7, 1.7, 5, 10), hardware, 0, 2, -37, Math.PI / 2, 0, 0); // ported muzzle brake
        add(new THREE.CylinderGeometry(0.6, 0.6, 3, 6), metal, 3.4, 2, -18, 0, 0, Math.PI / 2); // bolt handle
        add(new THREE.CylinderGeometry(1.7, 1.7, 22, 12), hardware, 0, 8, -10, Math.PI / 2, 0, 0); // scope tube
        add(new THREE.CylinderGeometry(2, 2, 3, 12), lens, 0, 8, -20.5, Math.PI / 2, 0, 0); // scope objective lens
        add(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 12), lens, 0, 8, 0.5, Math.PI / 2, 0, 0); // scope ocular lens
        add(rb(1.2, 4.6, 1.2), hardware, 0, 5.2, -14); // front scope mount
        add(rb(1.2, 4.6, 1.2), hardware, 0, 5.2, -4); // rear scope mount
        add(rb(3.6, 5, 3.4, 0.8), grip, 0, -0.5, 6); // thumbhole stock body
        add(rb(2.6, 2, 5, 0.6), grip, 0, 4.6, 8); // cheek riser
        add(rb(3, 8, 3.4, 0.8), grip, 0, -4.5, 4); // pistol grip
        add(rb(3.4, 1.2, 3), hardware, 0, -8.2, 3.4); // mag base
        add(new THREE.CylinderGeometry(0.4, 0.4, 9, 6), hardware, -2.6, -4.5, -22, 0.5, 0, 0.3); // bipod leg L
        add(new THREE.CylinderGeometry(0.4, 0.4, 9, 6), hardware, 2.6, -4.5, -22, -0.5, 0, -0.3); // bipod leg R
        break;

      default: { // melee
        const blade = add(new THREE.ConeGeometry(3.2, 18, 4), metal, 0, 2, -14, Math.PI / 2, Math.PI / 4, 0);
        blade.scale.set(1, 1, 0.28);
        add(rb(4.2, 1.6, 1.4), hardware, 0, 2, -4.5); // cross-guard
        add(new THREE.CylinderGeometry(1.1, 1.1, 8, 10), grip, 0, 1.6, 2, Math.PI / 2, 0, 0); // handle
        add(new THREE.SphereGeometry(1.3, 10, 8), hardware, 0, 1.4, 6.2); // pommel
        break;
      }
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
      if (import.meta.env.DEV) updateDebugHud(this.session.stats);
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

    // Dev-only perf/net readout — not part of the game's actual HUD, and
    // real clutter on a small mobile screen.
    if (import.meta.env.DEV) updateDebugHud(this.session.stats);

    this.composer.render();
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
    this.composer.dispose();
    this.renderer.dispose();
  }
}
