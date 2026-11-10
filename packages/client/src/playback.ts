import { KEYFRAME_INTERVAL, type BallPos, type Keyframe } from '@chalkline/shared';

export interface TrackPoint { t: number; x: number; y: number }

export function buildTracks(start: readonly BallPos[], frames: readonly Keyframe[]): Map<number, TrackPoint[]> {
  const tracks = new Map(start.map((b) => [b.id, [{ t: 0, x: b.x, y: b.y }]]));
  for (const f of frames) {
    for (let i = 0; i < f.b.length; i += 3) {
      tracks.get(f.b[i])?.push({ t: f.t, x: f.b[i + 1] / 1e4, y: f.b[i + 2] / 1e4 });
    }
  }
  return tracks;
}

/** Writes into `out`, so playback can sample every ball every frame without allocating. */
export function sampleTrack(track: readonly TrackPoint[], t: number, out = { x: 0, y: 0 }): { x: number; y: number } {
  let i = 0;
  while (i < track.length && track[i].t <= t) i++;
  const last = track[track.length - 1];
  if (i === track.length) {
    out.x = last.x;
    out.y = last.y;
    return out;
  }
  if (i === 0) {
    out.x = track[0].x;
    out.y = track[0].y;
    return out;
  }
  const p = track[i - 1];
  const q = track[i];
  // Frames list moving balls only, so a long gap means the ball sat still until just before q.
  const from = Math.max(p.t, q.t - 1.5 * KEYFRAME_INTERVAL);
  const u = Math.max(0, (t - from) / (q.t - from));
  out.x = p.x + (q.x - p.x) * u;
  out.y = p.y + (q.y - p.y) * u;
  return out;
}
