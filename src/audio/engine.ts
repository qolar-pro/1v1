import * as synth from "./synth";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

const MAX_DISTANCE = 900;

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call once on a user gesture (click/keydown) to satisfy browser autoplay policy. */
export function unlockAudio(): void {
  ensureCtx();
}

interface PositionalNode {
  gain: GainNode;
  lowpass: BiquadFilterNode;
  pan: StereoPannerNode;
}

function positionalChain(listenerX: number, listenerY: number, listenerAngle: number, srcX: number, srcY: number, occluded: boolean): PositionalNode {
  const audioCtx = ensureCtx();
  const dist = Math.hypot(srcX - listenerX, srcY - listenerY);
  const falloff = Math.max(0, 1 - dist / MAX_DISTANCE);

  const angleToSrc = Math.atan2(srcY - listenerY, srcX - listenerX);
  let relative = angleToSrc - listenerAngle;
  relative = ((relative + Math.PI) % (Math.PI * 2)) - Math.PI;
  const pan = audioCtx.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, Math.sin(relative)));

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = occluded ? 500 : 18000;

  const gain = audioCtx.createGain();
  gain.gain.value = falloff * (occluded ? 0.45 : 1);

  gain.connect(pan).connect(lowpass).connect(master!);
  return { gain, lowpass, pan };
}

export function playGunshot(weaponClass: string, srcX: number, srcY: number, listenerX: number, listenerY: number, listenerAngle: number, occluded: boolean): void {
  const audioCtx = ensureCtx();
  const chain = positionalChain(listenerX, listenerY, listenerAngle, srcX, srcY, occluded);
  synth.playGunshot(audioCtx, chain.gain, weaponClass);
}

export function playFootstep(walking: boolean, srcX: number, srcY: number, listenerX: number, listenerY: number, listenerAngle: number, occluded: boolean): void {
  const audioCtx = ensureCtx();
  const chain = positionalChain(listenerX, listenerY, listenerAngle, srcX, srcY, occluded);
  synth.playFootstep(audioCtx, chain.gain, walking);
}

export function playReload(srcX: number, srcY: number, listenerX: number, listenerY: number, listenerAngle: number, occluded: boolean): void {
  const audioCtx = ensureCtx();
  const chain = positionalChain(listenerX, listenerY, listenerAngle, srcX, srcY, occluded);
  synth.playReload(audioCtx, chain.gain);
}

export function playPlantThump(srcX: number, srcY: number, listenerX: number, listenerY: number, listenerAngle: number, occluded: boolean): void {
  const audioCtx = ensureCtx();
  const chain = positionalChain(listenerX, listenerY, listenerAngle, srcX, srcY, occluded);
  synth.playPlantThump(audioCtx, chain.gain);
}

export function playFlashBang(srcX: number, srcY: number, listenerX: number, listenerY: number, listenerAngle: number, occluded: boolean): void {
  const audioCtx = ensureCtx();
  const chain = positionalChain(listenerX, listenerY, listenerAngle, srcX, srcY, occluded);
  synth.playFlashBang(audioCtx, chain.gain);
}

export function playExplosion(srcX: number, srcY: number, listenerX: number, listenerY: number, listenerAngle: number, occluded: boolean): void {
  const audioCtx = ensureCtx();
  const chain = positionalChain(listenerX, listenerY, listenerAngle, srcX, srcY, occluded);
  synth.playExplosion(audioCtx, chain.gain);
}

export function playUi(freq?: number): void {
  const audioCtx = ensureCtx();
  synth.playUiBeep(audioCtx, master!, freq);
}
