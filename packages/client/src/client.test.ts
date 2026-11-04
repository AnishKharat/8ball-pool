import { describe, expect, it } from 'vitest';
import { BALL_R, simulateShot } from '@chalkline/shared';
import { buildTracks, sampleTrack } from './playback';
import { aimPreview } from './preview';

const shot = { angle: 0, power: 0.5, hitX: 0, hitY: 0 };
const balls = [{ id: 0, x: -0.5, y: 0 }, { id: 1, x: 0, y: 0 }];

describe('aim preview', () => {
  it('assist gives a ghost at first contact and both paths', () => {
    const p = aimPreview('assist', balls, shot)!;
    expect(p.ghost.x).toBeCloseTo(-2 * BALL_R, 6);
    expect(p.targetId).toBe(1);
    expect(p.targetPath.at(-1)!.x).toBeGreaterThan(0.1);
    expect(p.cuePath[0]).toEqual(p.ghost);
  });

  it('hard mode produces nothing', () => {
    expect(aimPreview('hard', balls, shot)).toBeNull();
  });

  it('a shot that misses everything has no ghost', () => {
    expect(aimPreview('assist', balls, { ...shot, angle: Math.PI / 2, power: 0.05 })).toBeNull();
  });
});

describe('keyframe playback', () => {
  it('holds a ball still until the frames say it moved, without creeping', () => {
    const track = [{ t: 0, x: 0, y: 0 }, { t: 2, x: 0.05, y: 0 }, { t: 2 + 1 / 30, x: 0.1, y: 0 }];
    expect(sampleTrack(track, 1).x).toBe(0);
    expect(sampleTrack(track, 1.9).x).toBe(0);
    expect(sampleTrack(track, 2).x).toBeCloseTo(0.05, 9);
    expect(sampleTrack(track, 2 + 1 / 60).x).toBeCloseTo(0.075, 9);
    expect(sampleTrack(track, 9).x).toBe(0.1);
  });

  it('ends every ball on the final state', () => {
    const r = simulateShot(balls, shot);
    const tracks = buildTracks(balls, r.frames);
    for (const b of r.balls) {
      const end = sampleTrack(tracks.get(b.id)!, r.duration + 1);
      expect(Math.abs(end.x - b.x)).toBeLessThan(2e-4);
      expect(Math.abs(end.y - b.y)).toBeLessThan(2e-4);
    }
  });
});
