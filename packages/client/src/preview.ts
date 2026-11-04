import { simulateShot, type BallPos, type Keyframe, type Mode, type ShotIntent } from '@chalkline/shared';

const AFTER_CONTACT = 0.5; // seconds of post-contact path to draw
const MAX_TIME = 6; // a shot that hasn't reached a ball by now shows no ghost

export interface Point { x: number; y: number }
export interface Preview { ghost: Point; targetId: number; cuePath: Point[]; targetPath: Point[] }

function pathOf(frames: Keyframe[], id: number, from: Point, after: number): Point[] {
  const path = [from];
  for (const f of frames) {
    if (f.t <= after) continue;
    for (let i = 0; i < f.b.length; i += 3) {
      if (f.b[i] === id) path.push({ x: f.b[i + 1] / 1e4, y: f.b[i + 2] / 1e4 });
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
  return {
    ghost,
    targetId,
    cuePath: pathOf(r.frames, 0, ghost, hit.t),
    targetPath: pathOf(r.frames, targetId, target, hit.t),
  };
}
