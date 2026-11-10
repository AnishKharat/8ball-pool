import { simulateShot, type BallPos, type Keyframe, type Mode, type ShotIntent } from '@chalkline/shared';

const AFTER_CONTACT = 0.5; // seconds simulated past contact, enough to cover TARGET_LEN at any power
const TARGET_LEN = 0.2; // metres of target-ball line: shows the direction, leaves the rest to judgement
const MAX_TIME = 6; // a shot that hasn't reached a ball by now shows no ghost

export interface Point { x: number; y: number }
export interface Preview { ghost: Point; targetId: number; targetPath: Point[] }

/** The ball's path after `after`, cut off once it has covered `len` metres. */
function pathOf(frames: Keyframe[], id: number, from: Point, after: number, len: number): Point[] {
  const path = [from];
  let left = len;
  for (const f of frames) {
    if (f.t <= after) continue;
    for (let i = 0; i < f.b.length; i += 3) {
      if (f.b[i] !== id) continue;
      const last = path[path.length - 1];
      const x = f.b[i + 1] / 1e4, y = f.b[i + 2] / 1e4;
      const d = Math.hypot(x - last.x, y - last.y);
      if (d >= left) {
        path.push({ x: last.x + ((x - last.x) * left) / d, y: last.y + ((y - last.y) * left) / d });
        return path;
      }
      left -= d;
      path.push({ x, y });
    }
  }
  return path;
}

/** Draw-only: never decides a result. Hard mode gets nothing, so it can't render any of this. */
export function aimPreview(mode: Mode, balls: BallPos[], shot: ShotIntent): Preview | null {
  if (mode === 'hard') return null;
  const r = simulateShot(balls, shot, { stopAfterContact: AFTER_CONTACT, maxTime: MAX_TIME });
  const hit = r.events.find((e) => e.type === 'ball');
  if (hit?.type !== 'ball') return null;
  const cueIsA = hit.a === 0;
  const ghost = cueIsA ? { x: hit.x, y: hit.y } : { x: hit.bx, y: hit.by };
  const target = cueIsA ? { x: hit.bx, y: hit.by } : { x: hit.x, y: hit.y };
  const targetId = cueIsA ? hit.b : hit.a;
  return { ghost, targetId, targetPath: pathOf(r.frames, targetId, target, hit.t, TARGET_LEN) };
}
