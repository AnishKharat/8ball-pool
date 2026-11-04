import {
  BALL_E, BALL_I, BALL_M, BALL_MU, BALL_R, CUE_M, CUE_V_MAX, CUE_V_MIN, CUSHION_E, CUSHION_H, CUSHION_MU, DT, G,
  HALF_L, HALF_W, KEYFRAME_INTERVAL, MAX_SIM_TIME, MU_ROLL, MU_SLIDE, MU_SPIN,
} from './constants';
import { JAWS, POCKETS, SEGMENTS, type Segment } from './table';

export interface BallPos { id: number; x: number; y: number }

/** Full rigid-body state of one ball. Velocity is in the table plane; spin is 3D. */
export interface Ball extends BallPos {
  vx: number; vy: number; wx: number; wy: number; wz: number;
}

export interface ShotIntent {
  angle: number; // radians
  power: number; // 0..1, maps linearly to cue speed
  hitX: number; // side offset as a fraction of R; + is right of centre looking along the shot
  hitY: number; // vertical offset as a fraction of R; + is above centre (follow)
}

export type SimEvent =
  | { type: 'ball'; t: number; a: number; b: number; speed: number; x: number; y: number; bx: number; by: number }
  | { type: 'cushion'; t: number; a: number; speed: number }
  | { type: 'pot'; t: number; a: number; pocket: number; speed: number }
  | { type: 'off'; t: number; a: number };

/** Moving balls only: flat [id, xTenthMm, yTenthMm, ...]. */
export interface Keyframe { t: number; b: number[] }

export interface SimResult {
  frames: Keyframe[];
  events: SimEvent[];
  balls: BallPos[];
  duration: number;
}

const SLIDE_A = MU_SLIDE * G;
const ROLL_A = MU_ROLL * G;
const SPIN_DECAY = (5 * MU_SPIN * G) / (2 * BALL_R);
const SLIP_ANG = (5 / 2) * (SLIDE_A / BALL_R);
const SLIP_EPS = 1e-9;
const SPEED_EPS = 1e-9;
const CONTACT_TOL = 1e-12;
const CUSHION_SIN = CUSHION_H / BALL_R - 1;
const CUSHION_COS = Math.sqrt(1 - CUSHION_SIN * CUSHION_SIN);
// Past this many impacts in one 1 ms step, a pinched cluster is left to the next step rather than looping.
const MAX_EVENTS_PER_STEP = 64;

export function cueSpeed(power: number): number {
  return CUE_V_MIN + power * (CUE_V_MAX - CUE_V_MIN);
}

/** Apply the cue impulse. Mutates the ball. */
export function strike(b: Ball, shot: ShotIntent): void {
  const dx = Math.cos(shot.angle);
  const dy = Math.sin(shot.angle);
  const sx = dy; // side direction: d x z, to the right of the shot
  const sy = -dx;
  const a = shot.hitX * BALL_R;
  const h = shot.hitY * BALL_R;
  const R2 = BALL_R * BALL_R;
  const J = (2 * BALL_M * cueSpeed(shot.power)) / (1 + BALL_M / CUE_M + (5 * (a * a + h * h)) / (2 * R2));
  b.vx = (J / BALL_M) * dx;
  b.vy = (J / BALL_M) * dy;
  const back = -Math.sqrt(R2 - a * a - h * h);
  const rx = a * sx + back * dx;
  const ry = a * sy + back * dy;
  // r x (J d) with d horizontal
  b.wx = (-h * J * dy) / BALL_I;
  b.wy = (h * J * dx) / BALL_I;
  b.wz = ((rx * dy - ry * dx) * J) / BALL_I;
}

export function kineticEnergy(balls: readonly Ball[]): number {
  let e = 0;
  for (const b of balls) {
    e += 0.5 * BALL_M * (b.vx * b.vx + b.vy * b.vy) + 0.5 * BALL_I * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz);
  }
  return e;
}

/** Per-substep motion: constant acceleration until tEnd, when the ball changes phase. */
interface Body extends Ball {
  ax: number; ay: number; alphaX: number; alphaY: number;
  tEnd: number;
  moving: boolean;
  rolling: boolean;
  movedSinceFrame: boolean;
}

function prepare(b: Body): void {
  const ux = b.vx - BALL_R * b.wy;
  const uy = b.vy + BALL_R * b.wx;
  const slip = Math.hypot(ux, uy);
  b.alphaX = b.alphaY = 0;
  b.rolling = false;
  if (slip > SLIP_EPS) {
    const hx = ux / slip;
    const hy = uy / slip;
    b.ax = -SLIDE_A * hx;
    b.ay = -SLIDE_A * hy;
    b.alphaX = -SLIP_ANG * hy;
    b.alphaY = SLIP_ANG * hx;
    b.tEnd = (2 * slip) / (7 * SLIDE_A);
    b.moving = true;
    return;
  }
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > SPEED_EPS) {
    b.ax = (-ROLL_A * b.vx) / speed;
    b.ay = (-ROLL_A * b.vy) / speed;
    b.tEnd = speed / ROLL_A;
    b.moving = true;
    b.rolling = true;
    return;
  }
  b.vx = b.vy = b.wx = b.wy = 0;
  b.ax = b.ay = 0;
  b.tEnd = Infinity;
  b.moving = false;
}

function advance(b: Body, t: number): void {
  if (b.wz !== 0) {
    const d = SPIN_DECAY * t;
    b.wz = Math.abs(b.wz) <= d ? 0 : b.wz - Math.sign(b.wz) * d;
  }
  if (!b.moving) return;
  b.x += b.vx * t + 0.5 * b.ax * t * t;
  b.y += b.vy * t + 0.5 * b.ay * t * t;
  b.vx += b.ax * t;
  b.vy += b.ay * t;
  if (b.rolling) {
    if (t >= b.tEnd) b.vx = b.vy = 0;
    b.wx = -b.vy / BALL_R;
    b.wy = b.vx / BALL_R;
  } else if (t >= b.tEnd) {
    // Slip reached zero here; set it exactly so rounding residue can't keep the ball sliding.
    b.wx = -b.vy / BALL_R;
    b.wy = b.vx / BALL_R;
  } else {
    b.wx += b.alphaX * t;
    b.wy += b.alphaY * t;
  }
  b.movedSinceFrame = true;
}

/**
 * Earliest t in [0, h] when |p + v t + a t^2/2| = D, coming from outside. Returns -1 if none.
 * The chord through the substep gives the root; Newton then polishes it on the true quadratic path,
 * so contact normals are exact and cut angles stay right.
 */
function circleToi(px: number, py: number, vx: number, vy: number, ax: number, ay: number, D: number, h: number): number {
  const f0 = px * px + py * py - D * D;
  if (f0 <= CONTACT_TOL) return px * vx + py * vy < 0 ? 0 : -1;
  const mx = vx + 0.5 * ax * h;
  const my = vy + 0.5 * ay * h;
  const B = px * mx + py * my;
  if (B >= 0) return -1;
  const A = mx * mx + my * my;
  const disc = B * B - A * f0;
  if (disc < 0) return -1;
  let t = f0 / (-B + Math.sqrt(disc));
  if (t > h) return -1;
  for (let i = 0; i < 3; i++) {
    const qx = px + vx * t + 0.5 * ax * t * t;
    const qy = py + vy * t + 0.5 * ay * t * t;
    const f = qx * qx + qy * qy - D * D;
    const df = 2 * (qx * (vx + ax * t) + qy * (vy + ay * t));
    if (df === 0) break;
    t -= f / df;
  }
  return t < 0 ? 0 : t > h ? h : t;
}

/** Earliest t in [0, h] when the ball's centre reaches distance R from the wall line, within the segment. */
function segmentToi(b: Body, s: Segment, h: number): number {
  const d0 = (b.x - s.x1) * s.nx + (b.y - s.y1) * s.ny - BALL_R;
  const v = b.vx * s.nx + b.vy * s.ny;
  const a = b.ax * s.nx + b.ay * s.ny;
  let t: number;
  if (d0 <= CONTACT_TOL) {
    if (v >= 0 || d0 < -BALL_R) return -1;
    t = 0;
  } else {
    const disc = v * v - 2 * a * d0;
    if (disc < 0) return -1;
    const den = -v + Math.sqrt(disc);
    if (den <= 0) return -1;
    t = (2 * d0) / den;
    if (t > h) return -1;
  }
  const along = (b.x + b.vx * t + 0.5 * b.ax * t * t - s.x1) * s.tx + (b.y + b.vy * t + 0.5 * b.ay * t * t - s.y1) * s.ty;
  return along >= 0 && along <= s.len ? t : -1;
}

/** Normal impulse with restitution plus a Coulomb-limited tangential impulse from the slip at the contact. */
export function collideBalls(a: Ball, b: Ball): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const nx = dx / d;
  const ny = dy / d;
  const dvx = a.vx - b.vx;
  const dvy = a.vy - b.vy;
  const vn = dvx * nx + dvy * ny;
  if (vn <= 0) return 0;
  const Jn = ((1 + BALL_E) * BALL_M * vn) / 2;

  const ox = a.wx + b.wx;
  const oy = a.wy + b.wy;
  const oz = a.wz + b.wz;
  const sx = dvx - vn * nx - BALL_R * oz * ny;
  const sy = dvy - vn * ny + BALL_R * oz * nx;
  const sz = BALL_R * (ox * ny - oy * nx);
  const slip = Math.sqrt(sx * sx + sy * sy + sz * sz);
  const Jt = slip > 0 ? Math.min(BALL_MU * Jn, (BALL_M * slip) / 7) : 0;

  const ix = (Jn * nx) / BALL_M;
  const iy = (Jn * ny) / BALL_M;
  a.vx -= ix;
  a.vy -= iy;
  b.vx += ix;
  b.vy += iy;
  if (Jt > 0) {
    const hx = sx / slip;
    const hy = sy / slip;
    const hz = sz / slip;
    const tv = Jt / BALL_M;
    a.vx -= tv * hx;
    a.vy -= tv * hy;
    b.vx += tv * hx;
    b.vy += tv * hy;
    // Friction turns both balls the same way: dw = -(R Jt / I) (n x s_hat)
    const k = (BALL_R * Jt) / BALL_I;
    const cx = ny * hz;
    const cy = -nx * hz;
    const cz = nx * hy - ny * hx;
    a.wx -= k * cx;
    a.wy -= k * cy;
    a.wz -= k * cz;
    b.wx -= k * cx;
    b.wy -= k * cy;
    b.wz -= k * cz;
  }
  return vn;
}

/**
 * Han (2005) cushion impact. (nx, ny) is the horizontal direction from the ball into the cushion.
 * The contact is above the ball's centre, so vertical impulse goes into the table and is discarded.
 */
export function collideCushion(b: Ball, nx: number, ny: number): number {
  const vn = b.vx * nx + b.vy * ny;
  if (vn <= 0) return 0;
  // Unit vector from ball centre to contact.
  const Nx = nx * CUSHION_COS;
  const Ny = ny * CUSHION_COS;
  const Nz = CUSHION_SIN;
  const c = vn * CUSHION_COS;
  const Pn = (1 + CUSHION_E) * BALL_M * c;
  // Slip: contact velocity v + w x (R N), less its component along N (which is c).
  const ux = b.vx + BALL_R * (b.wy * Nz - b.wz * Ny) - c * Nx;
  const uy = b.vy + BALL_R * (b.wz * Nx - b.wx * Nz) - c * Ny;
  const uz = BALL_R * (b.wx * Ny - b.wy * Nx) - c * Nz;
  const slip = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const Pf = slip > 0 ? Math.min(CUSHION_MU * Pn, (2 / 7) * BALL_M * slip) : 0;
  const hx = slip > 0 ? ux / slip : 0;
  const hy = slip > 0 ? uy / slip : 0;
  const hz = slip > 0 ? uz / slip : 0;
  b.vx += (-Pn * Nx - Pf * hx) / BALL_M;
  b.vy += (-Pn * Ny - Pf * hy) / BALL_M;
  // Only friction has a moment about the centre: dw = (R N x -Pf h) / I
  const k = (-BALL_R * Pf) / BALL_I;
  b.wx += k * (Ny * hz - Nz * hy);
  b.wy += k * (Nz * hx - Nx * hz);
  b.wz += k * (Nx * hy - Ny * hx);
  return vn;
}

type Hit =
  | { kind: 'ball'; a: Body; b: Body }
  | { kind: 'segment'; a: Body; s: Segment }
  | { kind: 'jaw'; a: Body; j: number }
  | { kind: 'pocket'; a: Body; p: number };

export interface SimOptions {
  /** Stop this many seconds after the first ball-ball contact. For the aim preview. */
  stopAfterContact?: number;
  maxTime?: number;
  /** Called after every substep; lets tests inspect full ball state. */
  onStep?: (balls: readonly Ball[], t: number) => void;
}

/** Run balls until all are at rest. Input balls are not mutated. */
export function simulate(input: Ball[], opts: SimOptions = {}): SimResult {
  const live: Body[] = input.map((b) => ({
    ...b, ax: 0, ay: 0, alphaX: 0, alphaY: 0, tEnd: Infinity, moving: false, rolling: false, movedSinceFrame: false,
  }));
  const events: SimEvent[] = [];
  const frames: Keyframe[] = [];
  let stopAt = opts.maxTime ?? MAX_SIM_TIME;
  let contacted = false;
  let t = 0;
  let nextFrame = KEYFRAME_INTERVAL;

  const remove = (b: Body) => {
    live.splice(live.indexOf(b), 1);
    // The ball's last position still has to reach the frame stream.
    frames.push({ t, b: [b.id, Math.round(b.x * 1e4), Math.round(b.y * 1e4)] });
  };

  const recordFrame = () => {
    const f: number[] = [];
    for (const b of live) {
      if (b.movedSinceFrame) {
        f.push(b.id, Math.round(b.x * 1e4), Math.round(b.y * 1e4));
        b.movedSinceFrame = false;
      }
    }
    if (f.length) frames.push({ t, b: f });
  };

  simulation: while (t < stopAt) {
    let rem = DT;
    let eventCount = 0;
    while (rem > 1e-12) {
      let h = rem;
      let anyMoving = false;
      for (const b of live) {
        prepare(b);
        if (b.moving) {
          anyMoving = true;
          if (b.tEnd < h) h = b.tEnd;
        }
      }
      if (!anyMoving) break simulation;

      let hit: Hit | null = null;
      let best = h;
      if (eventCount < MAX_EVENTS_PER_STEP) {
        for (let i = 0; i < live.length; i++) {
          const a = live[i];
          for (let j = i + 1; j < live.length; j++) {
            const o = live[j];
            if (!a.moving && !o.moving) continue;
            const toi = circleToi(o.x - a.x, o.y - a.y, o.vx - a.vx, o.vy - a.vy, o.ax - a.ax, o.ay - a.ay, 2 * BALL_R, best);
            if (toi >= 0 && (toi < best || !hit)) {
              best = toi;
              hit = { kind: 'ball', a, b: o };
            }
          }
          if (!a.moving) continue;
          for (const s of SEGMENTS) {
            const toi = segmentToi(a, s, best);
            if (toi >= 0 && (toi < best || !hit)) {
              best = toi;
              hit = { kind: 'segment', a, s };
            }
          }
          for (let k = 0; k < JAWS.length; k++) {
            const q = JAWS[k];
            const toi = circleToi(q.x - a.x, q.y - a.y, -a.vx, -a.vy, -a.ax, -a.ay, q.r + BALL_R, best);
            if (toi >= 0 && (toi < best || !hit)) {
              best = toi;
              hit = { kind: 'jaw', a, j: k };
            }
          }
          for (let k = 0; k < POCKETS.length; k++) {
            const q = POCKETS[k];
            const px = q.x - a.x;
            const py = q.y - a.y;
            const toi = px * px + py * py <= q.r * q.r ? 0 : circleToi(px, py, -a.vx, -a.vy, -a.ax, -a.ay, q.r, best);
            if (toi >= 0 && (toi < best || !hit)) {
              best = toi;
              hit = { kind: 'pocket', a, p: k };
            }
          }
        }
      }

      const adv = hit ? best : h;
      for (const b of live) advance(b, adv);
      t += adv;
      rem -= adv;

      if (hit) {
        eventCount++;
        if (hit.kind === 'ball') {
          const speed = collideBalls(hit.a, hit.b);
          events.push({ type: 'ball', t, a: hit.a.id, b: hit.b.id, speed, x: hit.a.x, y: hit.a.y, bx: hit.b.x, by: hit.b.y });
          if (!contacted && opts.stopAfterContact !== undefined) stopAt = Math.min(stopAt, t + opts.stopAfterContact);
          contacted = true;
        } else if (hit.kind === 'segment') {
          const speed = collideCushion(hit.a, -hit.s.nx, -hit.s.ny);
          events.push({ type: 'cushion', t, a: hit.a.id, speed });
        } else if (hit.kind === 'jaw') {
          const q = JAWS[hit.j];
          const d = Math.hypot(q.x - hit.a.x, q.y - hit.a.y);
          const speed = collideCushion(hit.a, (q.x - hit.a.x) / d, (q.y - hit.a.y) / d);
          events.push({ type: 'cushion', t, a: hit.a.id, speed });
        } else {
          events.push({ type: 'pot', t, a: hit.a.id, pocket: hit.p, speed: Math.hypot(hit.a.vx, hit.a.vy) });
          remove(hit.a);
        }
      }
      opts.onStep?.(live, t);
    }
    // Numerical safety net: the walls are closed, so this should never fire.
    for (const b of [...live]) {
      if (Math.abs(b.x) > HALF_L + 0.3 || Math.abs(b.y) > HALF_W + 0.3) {
        events.push({ type: 'off', t, a: b.id });
        remove(b);
      }
    }
    if (t >= nextFrame) {
      recordFrame();
      nextFrame = t + KEYFRAME_INTERVAL - DT / 2;
    }
  }
  recordFrame();
  const balls = live.map((b) => ({ id: b.id, x: b.x, y: b.y })).sort((a, b) => a.id - b.id);
  return { frames, events, balls, duration: t };
}

export function restBall(p: BallPos): Ball {
  return { id: p.id, x: p.x, y: p.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0 };
}

/** Simulate one cue shot from a resting table. The cue ball has id 0. */
export function simulateShot(balls: BallPos[], shot: ShotIntent, opts?: SimOptions): SimResult {
  const state = balls.map(restBall);
  const cue = state.find((b) => b.id === 0);
  if (!cue) throw new Error('no cue ball');
  strike(cue, shot);
  return simulate(state, opts);
}
