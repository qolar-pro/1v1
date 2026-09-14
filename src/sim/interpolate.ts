/**
 * Pure interpolation over a small ring buffer of timestamped remote-player
 * samples. Shared by the client (interpolating the host) and the host
 * (interpolating the joiner) — same math either direction.
 */
export interface TimedSample {
  /** Local monotonic time (ms) this sample was produced/received. */
  t: number;
  x: number;
  y: number;
  angle: number;
}

export const INTERP_BUFFER_SIZE = 12;

export function pushSample(buffer: TimedSample[], sample: TimedSample): void {
  buffer.push(sample);
  if (buffer.length > INTERP_BUFFER_SIZE) buffer.shift();
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Sample the buffer at renderTime (ms). Interpolates between the two
 * bracketing samples; if renderTime is beyond the newest sample, holds
 * (never extrapolates) once past maxExtrapolationMs.
 */
export function sampleAt(
  buffer: readonly TimedSample[],
  renderTime: number,
  maxExtrapolationMs: number,
): { x: number; y: number; angle: number } | null {
  if (buffer.length === 0) return null;
  if (buffer.length === 1) {
    const s = buffer[0]!;
    return { x: s.x, y: s.y, angle: s.angle };
  }

  // Find the pair of samples bracketing renderTime.
  let older: TimedSample | null = null;
  let newer: TimedSample | null = null;
  for (let i = 0; i < buffer.length - 1; i++) {
    const a = buffer[i]!;
    const b = buffer[i + 1]!;
    if (a.t <= renderTime && renderTime <= b.t) {
      older = a;
      newer = b;
      break;
    }
  }

  const last = buffer[buffer.length - 1]!;
  if (!older || !newer) {
    if (renderTime > last.t) {
      // Past the newest sample: freeze once beyond the extrapolation cap.
      const overshoot = renderTime - last.t;
      if (overshoot > maxExtrapolationMs) {
        return { x: last.x, y: last.y, angle: last.angle };
      }
      return { x: last.x, y: last.y, angle: last.angle };
    }
    const first = buffer[0]!;
    return { x: first.x, y: first.y, angle: first.angle };
  }

  const span = newer.t - older.t;
  const t = span > 0 ? (renderTime - older.t) / span : 0;
  return {
    x: older.x + (newer.x - older.x) * t,
    y: older.y + (newer.y - older.y) * t,
    angle: lerpAngle(older.angle, newer.angle, t),
  };
}
