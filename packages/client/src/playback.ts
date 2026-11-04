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

export function sampleTrack(track: readonly TrackPoint[], t: number): { x: number; y: number } {
  const i = track.findIndex((p) => p.t > t);
  if (i === -1) return track[track.length - 1];
  if (i === 0) return track[0];
  const p = track[i - 1];
  const q = track[i];
  // Frames list moving balls only, so a long gap means the ball sat still until just before q.
  const from = Math.max(p.t, q.t - 1.5 * KEYFRAME_INTERVAL);
  const u = Math.max(0, (t - from) / (q.t - from));
  return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u };
}
