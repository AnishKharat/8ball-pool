import { describe, expect, it } from 'vitest';
import { BALL_R, HALF_L } from './constants';
import { simulateShot } from './physics';
import { canPlaceCue, rackBalls } from './rules';
import { FOOT_SPOT_X, HEAD_STRING_X } from './table';

const isSolid = (id: number) => id >= 1 && id <= 7;

describe('rack', () => {
  it('holds all 16 balls once, with no overlaps', () => {
    const r = rackBalls();
    expect(r.map((b) => b.id).sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    for (const a of r) for (const b of r) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * BALL_R);
  });

  it('always has the 8 in the centre and one of each group in the back corners', () => {
    for (let k = 0; k < 50; k++) {
      const objects = rackBalls().filter((b) => b.id !== 0);
      const eight = objects.find((b) => b.id === 8)!;
      expect(eight.y).toBeCloseTo(0, 9);
      expect(eight.x).toBeGreaterThan(FOOT_SPOT_X + 3 * BALL_R);
      expect(eight.x).toBeLessThan(FOOT_SPOT_X + 4 * BALL_R);
      const back = Math.max(...objects.map((b) => b.x));
      const corners = objects.filter((b) => b.x > back - 1e-9 && Math.abs(b.y) > 3 * BALL_R);
      expect(corners).toHaveLength(2);
      expect(isSolid(corners[0].id)).not.toBe(isSolid(corners[1].id));
    }
  });

  it('is randomised', () => {
    const order = () => rackBalls().map((b) => b.id).join();
    expect(new Set(Array.from({ length: 10 }, order)).size).toBeGreaterThan(1);
  });

  it('breaks and scatters the balls', () => {
    const r = simulateShot(rackBalls(), { angle: 0, power: 1, hitX: 0, hitY: 0 });
    expect(new Set(r.events.filter((e) => e.type === 'cushion').map((e) => e.a)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('ball in hand placement', () => {
  const balls = [{ id: 0, x: 0.5, y: 0.5 }, { id: 1, x: 0, y: 0 }];

  it('rejects overlap with another ball, but not with the cue ball itself', () => {
    expect(canPlaceCue(balls, 0.04, 0, false)).toBe(false);
    expect(canPlaceCue(balls, 2 * BALL_R + 1e-6, 0, false)).toBe(true);
    expect(canPlaceCue(balls, 0.5, 0.5, false)).toBe(true);
  });

  it('rejects off-table and non-finite positions', () => {
    expect(canPlaceCue(balls, HALF_L, 0, false)).toBe(false);
    expect(canPlaceCue(balls, NaN, 0, false)).toBe(false);
    expect(canPlaceCue(balls, Infinity, 0, false)).toBe(false);
  });

  it('keeps a breaker behind the head string', () => {
    expect(canPlaceCue(balls, HEAD_STRING_X - 0.01, 0.1, true)).toBe(true);
    expect(canPlaceCue(balls, HEAD_STRING_X + 0.01, 0.1, true)).toBe(false);
  });
});
