import { describe, expect, it } from 'vitest';
import { BALL_R, CUE_M, BALL_M, CUE_V_MAX, G, HALF_L, HALF_W, MU_SLIDE, BALL_E } from './constants';
import { JAWS, POCKETS } from './table';
import {
  collideBalls, collideCushion, kineticEnergy, restBall, simulate, simulateShot, strike, type Ball,
} from './physics';

const ball = (id: number, x: number, y: number, extra: Partial<Ball> = {}): Ball => ({ ...restBall({ id, x, y }), ...extra });
const deg = (r: number) => (r * 180) / Math.PI;
const slipOf = (b: Ball) => Math.hypot(b.vx - BALL_R * b.wy, b.vy + BALL_R * b.wx);

function track(frames: { t: number; b: number[] }[], id: number) {
  const out: { t: number; x: number; y: number }[] = [];
  for (const f of frames) {
    for (let i = 0; i < f.b.length; i += 3) {
      if (f.b[i] === id) out.push({ t: f.t, x: f.b[i + 1] / 1e4, y: f.b[i + 2] / 1e4 });
    }
  }
  return out;
}

/** Ball velocities straight after the first ball-ball contact. */
function afterContact(balls: Ball[]) {
  let out: Ball[] | null = null;
  let contacted = 0;
  simulate(balls, {
    stopAfterContact: 0,
    onStep: (bs) => {
      if (!out && bs[1].vx * bs[1].vx + bs[1].vy * bs[1].vy > 0) out = bs.map((b) => ({ ...b }));
      contacted++;
    },
  });
  if (!out) throw new Error(`no contact in ${contacted} steps`);
  return out as Ball[];
}

/** Cue ball position a set time after the first contact, before rails can matter. */
function cueAfter(balls: { id: number; x: number; y: number }[], shot: Parameters<typeof simulateShot>[1], dt: number) {
  const r = simulateShot(balls, shot, { stopAfterContact: dt });
  const contact = r.events.find((e) => e.type === 'ball');
  if (contact?.type !== 'ball') throw new Error('no contact');
  return { contactX: contact.x, x: r.balls.find((b) => b.id === 0)!.x };
}

describe('cue strike', () => {
  it('centre hit gives no spin and the speed from the impulse formula', () => {
    const b = ball(0, 0, 0);
    strike(b, { angle: 0, power: 1, hitX: 0, hitY: 0 });
    expect(b.vx).toBeCloseTo((2 * CUE_V_MAX) / (1 + BALL_M / CUE_M), 6);
    expect(b.wx).toBeCloseTo(0, 9);
    expect(b.wy).toBeCloseTo(0, 9);
    expect(b.wz).toBeCloseTo(0, 9);
  });

  it('a hit 2/5 R above centre is natural roll: no slip', () => {
    const b = ball(0, 0, 0);
    strike(b, { angle: 0.7, power: 0.5, hitX: 0, hitY: 0.4 });
    expect(slipOf(b)).toBeLessThan(1e-9);
  });

  it('right english spins counterclockwise from above; low hit makes backspin', () => {
    const b = ball(0, 0, 0);
    strike(b, { angle: 0, power: 0.5, hitX: 0.4, hitY: 0 });
    expect(b.wz).toBeGreaterThan(0);
    strike(b, { angle: 0, power: 0.5, hitX: 0, hitY: -0.4 });
    expect(b.wy).toBeLessThan(0);
  });
});

describe('motion on cloth', () => {
  it('slides to rolling at t = 2|u0| / (7 mu g), then rolls at 5/7 speed', () => {
    const u0 = 2;
    let tRoll = -1;
    let vRoll = 0;
    simulate([ball(0, -1, 0, { vx: u0 })], {
      onStep: (bs, t) => {
        if (tRoll < 0 && slipOf(bs[0]) < 1e-8) {
          tRoll = t;
          vRoll = bs[0].vx;
        }
      },
    });
    expect(tRoll).toBeCloseTo((2 * u0) / (7 * MU_SLIDE * G), 6);
    expect(vRoll).toBeCloseTo((5 / 7) * u0, 6);
  });

  it('side spin alone does not curve the path', () => {
    const r = simulate([ball(0, -1, 0, { vx: 0.6, wy: 0.6 / BALL_R, wz: 40 })]);
    expect(r.balls[0].y).toBeCloseTo(0, 9);
  });

  it('a ball with only vertical spin stays put', () => {
    const r = simulate([ball(0, 0, 0, { wz: 50 })]);
    expect(r.balls[0].x).toBe(0);
    expect(r.duration).toBe(0);
  });
});

describe('ball-ball', () => {
  it('head-on stun stops the cue ball and transfers nearly all speed', () => {
    const a = ball(0, -2 * BALL_R, 0, { vx: 2 });
    const b = ball(1, 0, 0);
    collideBalls(a, b);
    expect(a.vx).toBeCloseTo((2 * (1 - BALL_E)) / 2, 9);
    expect(b.vx).toBeCloseTo((2 * (1 + BALL_E)) / 2, 9);
    // From a real stroke: a little draw cancels what the cloth would add over a short gap, so the ball stops.
    const c = cueAfter([{ id: 0, x: -0.15, y: 0 }, { id: 1, x: 0, y: 0 }], { angle: 0, power: 0.5, hitX: 0, hitY: -0.1 }, 0.6);
    expect(Math.abs(c.x - c.contactX)).toBeLessThan(0.08);
  });

  it('follow continues forward after contact', () => {
    const c = cueAfter([{ id: 0, x: -0.6, y: 0 }, { id: 1, x: 0, y: 0 }], { angle: 0, power: 0.3, hitX: 0, hitY: 0.45 }, 0.6);
    expect(c.x - c.contactX).toBeGreaterThan(0.15);
  });

  it('draw comes back', () => {
    const c = cueAfter([{ id: 0, x: -0.4, y: 0 }, { id: 1, x: 0, y: 0 }], { angle: 0, power: 0.5, hitX: 0, hitY: -0.45 }, 0.6);
    expect(c.x - c.contactX).toBeLessThan(-0.15);
  });

  it('90 degree rule: a stun cut separates near 90 degrees', () => {
    const [c, o] = afterContact([ball(0, -2 * BALL_R - 1e-4, BALL_R, { vx: 2.5 }), ball(1, 0, 0)]);
    const sep = deg(Math.abs(Math.atan2(c.vy, c.vx) - Math.atan2(o.vy, o.vx)));
    expect(sep).toBeGreaterThan(82);
    expect(sep).toBeLessThan(92);
  });

  it('30 degree rule: a rolling half-ball cut ends up deflected about 30 degrees', () => {
    const v = 1.5;
    const r = simulate([ball(0, -0.5, BALL_R, { vx: v, wy: v / BALL_R }), ball(1, 0, 0)]);
    const hitT = r.events[0].t;
    const late = track(r.frames, 0).filter((p) => p.t > hitT + 0.3 && p.t < hitT + 0.45);
    const angle = deg(Math.atan2(late.at(-1)!.y - late[0].y, late.at(-1)!.x - late[0].x));
    expect(Math.abs(angle)).toBeGreaterThan(24);
    expect(Math.abs(angle)).toBeLessThan(38);
  });

  it('cut-induced throw pulls the object ball toward the cue ball direction', () => {
    const [, o] = afterContact([ball(0, -2 * BALL_R - 1e-4, BALL_R, { vx: 1 }), ball(1, 0, 0)]);
    // Without friction the object leaves along the line of centres, -30 degrees.
    const thrown = deg(Math.atan2(o.vy, o.vx)) + 30;
    expect(thrown).toBeGreaterThan(0.5);
    expect(thrown).toBeLessThan(6);
  });

  it('spin-induced throw and spin transfer on a straight-in hit', () => {
    const a = ball(0, -2 * BALL_R, 0, { vx: 1, wz: 60 });
    const b = ball(1, 0, 0);
    collideBalls(a, b);
    expect(Math.abs(b.vy)).toBeGreaterThan(0.01);
    expect(b.wz).not.toBe(0);
    expect(Math.sign(b.wz)).toBe(-1);
  });

  it('conserves momentum through a contact and does not gain energy', () => {
    for (const [wy, wz, wx, y] of [[40, 30, 0, 0.01], [-90, 0, 12, -0.02], [0, -120, 5, 0.04], [300, 300, 300, 0.05]]) {
      const a = ball(0, -Math.sqrt(4 * BALL_R * BALL_R - y * y), y, { vx: 3, vy: 0.4, wy, wz, wx });
      const b = ball(1, 0, 0, { vx: -0.2 });
      const px = a.vx + b.vx;
      const py = a.vy + b.vy;
      const e = kineticEnergy([a, b]);
      collideBalls(a, b);
      expect(a.vx + b.vx).toBeCloseTo(px, 10);
      expect(a.vy + b.vy).toBeCloseTo(py, 10);
      expect(kineticEnergy([a, b])).toBeLessThanOrEqual(e + 1e-12);
    }
  });
});

describe('cushion', () => {
  it('rebound without spin keeps a plausible coefficient', () => {
    const b = ball(0, 0, 0, { vy: 2 });
    collideCushion(b, 0, 1);
    expect(-b.vy / 2).toBeGreaterThan(0.55);
    expect(-b.vy / 2).toBeLessThan(0.9);
  });

  it('side spin changes the rebound angle', () => {
    const fire = (wz: number) => {
      const b = ball(0, 0, 0, { vx: 1, vy: 2, wz });
      collideCushion(b, 0, 1);
      return deg(Math.atan2(b.vx, -b.vy));
    };
    const plain = fire(0);
    expect(Math.abs(fire(80) - plain)).toBeGreaterThan(2);
    expect(Math.abs(fire(-80) - plain)).toBeGreaterThan(2);
    expect(Math.sign(fire(80) - plain)).toBe(-Math.sign(fire(-80) - plain));
  });

  it('english from a real stroke moves the ball to a different place after the rail', () => {
    const shot = (hitX: number) =>
      simulateShot([{ id: 0, x: 0.3, y: 0 }], { angle: Math.PI / 2 - 0.3, power: 0.1, hitX, hitY: 0 });
    expect(Math.abs(shot(0).balls[0].x - shot(0.4).balls[0].x)).toBeGreaterThan(0.02);
  });

  it('impact changes spin and never adds energy', () => {
    for (const [wx, wy, wz] of [[-70, 0, 0], [50, 40, 120], [0, 0, -200], [300, 300, 300]]) {
      const b = ball(0, 0, 0, { vx: 0.5, vy: 2, wx, wy, wz });
      const e = kineticEnergy([b]);
      const before = [b.wx, b.wy, b.wz];
      collideCushion(b, 0, 1);
      expect([b.wx, b.wy, b.wz]).not.toEqual(before);
      expect(kineticEnergy([b])).toBeLessThan(e);
    }
  });
});

describe('pockets', () => {
  it('a straight shot along the axis drops in the corner', () => {
    const cue = { id: 0, x: 0.8, y: 0.2 };
    const p = POCKETS[5];
    const r = simulateShot([cue], { angle: Math.atan2(p.aimY - cue.y, p.aimX - cue.x), power: 0.3, hitX: 0, hitY: 0 });
    expect(r.events.find((e) => e.type === 'pot')).toMatchObject({ a: 0, pocket: 5 });
    expect(r.balls).toHaveLength(0);
  });

  it('a straight shot drops in the side', () => {
    const r = simulateShot([{ id: 0, x: 0, y: 0 }], { angle: Math.PI / 2, power: 0.3, hitX: 0, hitY: 0 });
    expect(r.events.find((e) => e.type === 'pot')).toMatchObject({ pocket: 4 });
  });

  it('a ball overlapping the mouth is not captured', () => {
    const lip = ball(1, 0, HALF_W - 0.001);
    const r = simulate([lip, ball(0, -0.9, -0.3, { vx: 0.1 })]);
    expect(r.events.filter((e) => e.type === 'pot')).toHaveLength(0);
    expect(r.balls.find((b) => b.id === 1)).toMatchObject({ x: 0, y: HALF_W - 0.001 });
  });

  it('a ball rattles off a jaw and stays out', () => {
    const jaw = JAWS[0];
    const cueX = jaw.x + 0.5;
    const cueY = jaw.y - Math.sign(jaw.y) * 0.1;
    const angle = Math.atan2(jaw.y - cueY, jaw.x - cueX);
    const r = simulateShot([{ id: 0, x: cueX, y: cueY }], { angle, power: 0.25, hitX: 0, hitY: 0 });
    expect(r.events[0].type).toBe('cushion');
    expect(r.events.some((e) => e.type === 'pot')).toBe(false);
  });

  it('a slow ball can die on the lip', () => {
    const v = 0.05;
    const r = simulate([ball(0, 0, HALF_W - 0.02, { vy: v, wx: -v / BALL_R })]);
    expect(r.balls).toHaveLength(1);
    expect(r.balls[0].y).toBeGreaterThan(HALF_W - 0.02);
  });
});

describe('whole shots', () => {
  const rack = () => {
    const balls: { id: number; x: number; y: number }[] = [{ id: 0, x: -0.635, y: 0.03 }];
    let id = 1;
    for (let row = 0; row < 5; row++) {
      for (let j = 0; j <= row; j++) {
        balls.push({ id: id++, x: 0.635 + row * (Math.sqrt(3) * BALL_R + 1e-4), y: (j - row / 2) * (2 * BALL_R + 1e-4) });
      }
    }
    return balls;
  };

  it('kinetic energy never rises during a break', () => {
    let prev = Infinity;
    let prevCount = Infinity;
    let worst = -Infinity;
    const balls = rack().map(restBall);
    strike(balls[0], { angle: 0, power: 1, hitX: 0.1, hitY: 0.3 });
    simulate(balls, {
      onStep: (bs) => {
        const e = kineticEnergy(bs);
        // A pocketed ball leaves the sum, which can only lower it.
        if (bs.length === prevCount) worst = Math.max(worst, e - prev);
        prev = e;
        prevCount = bs.length;
      },
    });
    expect(worst).toBeLessThan(1e-9);
  });

  it('no tunnelling at maximum speed: balls stay inside the rails and never overlap', () => {
    for (let k = 0; k < 40; k++) {
      const angle = (k / 40) * 2 * Math.PI + 0.013;
      const r = simulateShot(rack(), { angle, power: 1, hitX: 0.35 * Math.cos(k), hitY: 0.35 * Math.sin(k) });
      expect(r.events.some((e) => e.type === 'off')).toBe(false);
      for (const b of r.balls) {
        // Past the rail line is only possible inside a pocket mouth.
        const inMouth = POCKETS.some((p) => Math.hypot(p.aimX - b.x, p.aimY - b.y) < 0.09);
        if (!inMouth) expect(Math.abs(b.x)).toBeLessThanOrEqual(HALF_L - BALL_R + 1e-6);
        if (!inMouth) expect(Math.abs(b.y)).toBeLessThanOrEqual(HALF_W - BALL_R + 1e-6);
        for (const o of r.balls) {
          if (o.id > b.id) expect(Math.hypot(o.x - b.x, o.y - b.y)).toBeGreaterThan(2 * BALL_R - 1e-5);
        }
      }
    }
  });

  it('every shot terminates well before the cap', () => {
    for (let k = 0; k < 20; k++) {
      const r = simulateShot(rack(), { angle: k * 0.31, power: k / 19, hitX: 0.3, hitY: -0.2 });
      expect(r.duration).toBeLessThan(40);
      expect(r.duration).toBeGreaterThan(0);
    }
  });

  it('keyframes are integers in 0.1 mm and list only moving balls', () => {
    const r = simulateShot(rack(), { angle: 0, power: 0.1, hitX: 0, hitY: 0 });
    expect(r.frames[0].b).toHaveLength(3);
    for (const v of r.frames[0].b) expect(Number.isInteger(v)).toBe(true);
  });

  it('final frame positions match the final ball state', () => {
    const r = simulateShot(rack(), { angle: 0.01, power: 0.8, hitX: 0, hitY: 0 });
    const last = new Map<number, number[]>();
    for (const f of r.frames) for (let i = 0; i < f.b.length; i += 3) last.set(f.b[i], [f.b[i + 1], f.b[i + 2]]);
    for (const b of r.balls) {
      const p = last.get(b.id);
      if (p) {
        expect(Math.abs(p[0] / 1e4 - b.x)).toBeLessThan(2e-4);
        expect(Math.abs(p[1] / 1e4 - b.y)).toBeLessThan(2e-4);
      }
    }
  });
});
