import * as THREE from "three";
import { EYE_HEIGHT } from "../config";

const TRACER_MS = 60;
const FLASH_MS = 50;
const IMPACT_MS = 8000;
const IMPACT_MAX = 40;

/** Short-lived cosmetic effects in the 3D scene: muzzle flash, tracers, impact billboards, hit-flash, screen shake. */
export class Effects {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private impacts: THREE.Sprite[] = [];
  private impactMaterial: THREE.SpriteMaterial;
  private shakeUntil = 0;
  private shakeIntensity = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    this.impactMaterial = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
  }

  muzzleFlash(x: number, y: number, angle: number): void {
    const fx = x + Math.cos(angle) * 20;
    const fz = y + Math.sin(angle) * 20;
    const light = new THREE.PointLight(0xfff2c4, 6, 140, 2);
    light.position.set(fx, EYE_HEIGHT, fz);
    this.scene.add(light);
    window.setTimeout(() => this.scene.remove(light), FLASH_MS);
  }

  tracer(x1: number, y1: number, x2: number, y2: number): void {
    const from = new THREE.Vector3(x1, EYE_HEIGHT, y1);
    const to = new THREE.Vector3(x2, EYE_HEIGHT, y2);
    const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / TRACER_MS;
      if (t >= 1) {
        this.scene.remove(line);
        geom.dispose();
        mat.dispose();
        return;
      }
      mat.opacity = 0.9 * (1 - t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  impact(x: number, y: number): void {
    const sprite = new THREE.Sprite(this.impactMaterial);
    sprite.position.set(x, EYE_HEIGHT + (Math.random() - 0.5) * 20, y);
    sprite.scale.set(4, 4, 1);
    this.scene.add(sprite);
    this.impacts.push(sprite);
    if (this.impacts.length > IMPACT_MAX) {
      const old = this.impacts.shift();
      if (old) this.scene.remove(old);
    }
    window.setTimeout(() => {
      this.scene.remove(sprite);
      const idx = this.impacts.indexOf(sprite);
      if (idx >= 0) this.impacts.splice(idx, 1);
    }, IMPACT_MS);
  }

  hitFlash(mesh: THREE.Object3D): void {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        const original = child.material.emissive.clone();
        child.material.emissive.setHex(0xffffff);
        window.setTimeout(() => child.material instanceof THREE.MeshStandardMaterial && child.material.emissive.copy(original), 60);
      }
    });
  }

  screenShake(intensity = 0.02, durationMs = 70): void {
    this.shakeUntil = performance.now() + durationMs;
    this.shakeIntensity = intensity;
  }

  /** Call once per frame after setting the camera's real position — applies a small random offset. */
  applyShake(): void {
    if (performance.now() >= this.shakeUntil) return;
    this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
    this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
  }

  shellCasing(_x: number, _y: number, _angle: number): void {
    // Cosmetic-only and easy to skip in 3D without a ground-relative particle
    // system; omitted to keep the effects budget on muzzle/tracer/impact/hit.
  }
}
