import { BALL_R, HALF_L, HALF_W, RACK_GAP } from './constants';
import type { BallPos } from './physics';
import { FOOT_SPOT_X, HEAD_STRING_X } from './table';

/** Fisher-Yates, in place. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Triangle at the foot spot: 8 in the centre, a solid and a stripe in the back corners, the rest random. */
export function rackBalls(random: () => number = Math.random): BallPos[] {
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7], random);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], random);
  const corners = shuffle([solids.pop()!, stripes.pop()!], random);
  const rest = shuffle([...solids, ...stripes], random);
  const balls: BallPos[] = [{ id: 0, x: HEAD_STRING_X, y: 0 }];
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      let id: number;
      if (row === 2 && j === 1) id = 8;
      else if (row === 4 && j === 0) id = corners[0];
      else if (row === 4 && j === 4) id = corners[1];
      else id = rest.pop()!;
      balls.push({
        id,
        x: FOOT_SPOT_X + row * (Math.sqrt(3) * BALL_R + RACK_GAP),
        y: (j - row / 2) * (2 * BALL_R + RACK_GAP),
      });
    }
  }
  return balls;
}

/** Ball in hand: on the playing surface, clear of every other ball, and behind the head string for a break. */
export function canPlaceCue(balls: readonly BallPos[], x: number, y: number, behindHeadString: boolean): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (Math.abs(x) > HALF_L - BALL_R || Math.abs(y) > HALF_W - BALL_R) return false;
  if (behindHeadString && x > HEAD_STRING_X) return false;
  return balls.every((b) => b.id === 0 || Math.hypot(b.x - x, b.y - y) >= 2 * BALL_R);
}
