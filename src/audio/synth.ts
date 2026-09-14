/** Procedural sound generators. Each returns a fresh AudioBufferSourceNode (or a short-lived graph) already connected to `dest`, ready to `.start()`. Nothing here touches the DOM or Phaser. */

function noiseBuffer(ctx: BaseAudioContext, durationS: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function playGunshot(ctx: BaseAudioContext, dest: AudioNode, weaponClass: string): void {
  const now = ctx.currentTime;
  const durations: Record<string, number> = { pistol: 0.14, smg: 0.12, rifle: 0.18, sniper: 0.3, melee: 0.05 };
  const dur = durations[weaponClass] ?? 0.15;

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, dur);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = weaponClass === "sniper" ? 900 : weaponClass === "rifle" ? 1400 : 1800;
  bandpass.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + dur);

  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(weaponClass === "sniper" ? 90 : 140, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + dur * 0.6);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.5, now);
  oscGain.gain.exponentialRampToValueAtTime(0.01, now + dur * 0.5);

  noise.connect(bandpass).connect(gain).connect(dest);
  osc.connect(oscGain).connect(dest);

  noise.start(now);
  noise.stop(now + dur);
  osc.start(now);
  osc.stop(now + dur * 0.6);
}

export function playFootstep(ctx: BaseAudioContext, dest: AudioNode, walking: boolean): void {
  const now = ctx.currentTime;
  const dur = 0.06;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, dur);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = walking ? 500 : 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(walking ? 0.25 : 0.45, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
  noise.connect(filter).connect(gain).connect(dest);
  noise.start(now);
  noise.stop(now + dur);
}

export function playReload(ctx: BaseAudioContext, dest: AudioNode): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.linearRampToValueAtTime(200, now + 0.05);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
  osc.connect(gain).connect(dest);
  osc.start(now);
  osc.stop(now + 0.08);
}

export function playUiBeep(ctx: BaseAudioContext, dest: AudioNode, freq = 660): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);
  osc.connect(gain).connect(dest);
  osc.start(now);
  osc.stop(now + 0.09);
}

export function playPlantThump(ctx: BaseAudioContext, dest: AudioNode): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
  osc.connect(gain).connect(dest);
  osc.start(now);
  osc.stop(now + 0.45);
}

export function playFlashBang(ctx: BaseAudioContext, dest: AudioNode): void {
  const now = ctx.currentTime;
  const dur = 0.5;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.8, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
  noise.connect(gain).connect(dest);
  noise.start(now);
  noise.stop(now + dur);
}

export function playExplosion(ctx: BaseAudioContext, dest: AudioNode): void {
  const now = ctx.currentTime;
  const dur = 0.6;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, dur);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1200, now);
  filter.frequency.exponentialRampToValueAtTime(120, now + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
  noise.connect(filter).connect(gain).connect(dest);
  noise.start(now);
  noise.stop(now + dur);
}
