import Phaser from "phaser";
import type { NetSession } from "../net/session";
import type { Slot } from "../sim/types";
import { HOST_SLOT, JOINER_SLOT } from "../sim/types";
import { BUTTON_WALK, PLAYER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from "../config";
import { updateDebugHud } from "../ui/DebugHud";

const HOST_COLOR = 0x2dd4bf; // teal
const JOINER_COLOR = 0xf59e0b; // amber
const LOCAL_RING = 0xffffff;
const FLOOR_COLOR = 0x141414;
const GRID_COLOR = 0x1f1f1f;

interface KeyMap {
  w: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  shift: Phaser.Input.Keyboard.Key;
}

export class GameScene extends Phaser.Scene {
  private keys!: KeyMap;
  private circles = new Map<Slot, Phaser.GameObjects.Arc>();
  private facingLines = new Map<Slot, Phaser.GameObjects.Graphics>();
  private localRing!: Phaser.GameObjects.Arc;
  private lastLocalRender = { x: 0, y: 0 };

  private readonly session: NetSession;

  constructor(session: NetSession) {
    super("GameScene");
    this.session = session;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(FLOOR_COLOR);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawFloor();

    const host = this.add.circle(0, 0, PLAYER_RADIUS, HOST_COLOR);
    const joiner = this.add.circle(0, 0, PLAYER_RADIUS, JOINER_COLOR);
    this.circles.set(HOST_SLOT, host);
    this.circles.set(JOINER_SLOT, joiner);

    this.facingLines.set(HOST_SLOT, this.add.graphics());
    this.facingLines.set(JOINER_SLOT, this.add.graphics());

    this.localRing = this.add.circle(0, 0, PLAYER_RADIUS + 4);
    this.localRing.setStrokeStyle(2, LOCAL_RING, 0.9);
    this.localRing.isFilled = false;

    const localSprite = this.circles.get(this.session.localSlot)!;
    this.cameras.main.startFollow(localSprite, true, 1, 1);

    const kb = this.input.keyboard!;
    this.keys = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
    };
  }

  private drawFloor(): void {
    const g = this.add.graphics();
    g.fillStyle(FLOOR_COLOR, 1);
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    g.lineStyle(1, GRID_COLOR, 1);
    const step = 100;
    for (let x = 0; x <= WORLD_WIDTH; x += step) {
      g.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += step) {
      g.lineBetween(0, y, WORLD_WIDTH, y);
    }
    g.lineStyle(3, 0x2a2a2a, 1);
    g.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);

    let moveX = 0;
    let moveY = 0;
    if (this.keys.a.isDown) moveX -= 1;
    if (this.keys.d.isDown) moveX += 1;
    if (this.keys.w.isDown) moveY -= 1;
    if (this.keys.s.isDown) moveY += 1;

    const pointer = this.input.activePointer;
    const aimAngle = Phaser.Math.Angle.Between(
      this.lastLocalRender.x,
      this.lastLocalRender.y,
      pointer.worldX,
      pointer.worldY,
    );

    const buttons = this.keys.shift.isDown ? BUTTON_WALK : 0;

    this.session.handleLocalInput({ moveX, moveY, aimAngle, buttons, dt });

    const world = this.session.getRenderState(performance.now());
    for (const slot of [HOST_SLOT, JOINER_SLOT] as const) {
      const p = world.players[slot];
      const circle = this.circles.get(slot)!;
      const line = this.facingLines.get(slot)!;
      circle.setPosition(p.x, p.y);
      circle.setVisible(p.connected);
      line.clear();
      if (p.connected) {
        const len = PLAYER_RADIUS + 14;
        line.lineStyle(2, 0xffffff, 1);
        line.lineBetween(p.x, p.y, p.x + Math.cos(p.angle) * len, p.y + Math.sin(p.angle) * len);
      }

      if (slot === this.session.localSlot) {
        this.lastLocalRender = { x: p.x, y: p.y };
        this.localRing.setPosition(p.x, p.y);
      }
    }

    updateDebugHud(this.session.stats);
  }
}
