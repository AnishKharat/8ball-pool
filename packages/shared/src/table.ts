import {
  BALL_R, CORNER_FACING_DEG, CORNER_HOLE_OFFSET, CORNER_HOLE_R, CORNER_MOUTH, FACING_LEN, HALF_L, HALF_W,
  JAW_R, SIDE_FACING_DEG, SIDE_HOLE_OFFSET, SIDE_HOLE_R, SIDE_MOUTH,
} from './constants';

/** Straight wall; (nx, ny) points to the side balls live on. */
export interface Segment { x1: number; y1: number; x2: number; y2: number; tx: number; ty: number; len: number; nx: number; ny: number }
export interface Circle { x: number; y: number; r: number }
export interface Pocket extends Circle {
  /** Point in the mouth that shots should aim through. */
  aimX: number;
  aimY: number;
}

function segment(x1: number, y1: number, x2: number, y2: number, nx: number, ny: number): Segment {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return { x1, y1, x2, y2, tx: (x2 - x1) / len, ty: (y2 - y1) / len, len, nx, ny };
}

export const SEGMENTS: Segment[] = [];
export const JAWS: Circle[] = [];

/**
 * One rail end at vertex (vx, vy). The rail arrives along (dirX, dirY), then turns by `deg` toward
 * (outX, outY) into a facing that runs into the pocket. The vertex is filleted by a jaw circle.
 * Returns the point where the straight rail stops.
 */
function railEnd(vx: number, vy: number, dirX: number, dirY: number, outX: number, outY: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const back = JAW_R * Math.tan(rad / 2);
  const fx = dirX * Math.cos(rad) + outX * Math.sin(rad);
  const fy = dirY * Math.cos(rad) + outY * Math.sin(rad);
  // Facing normal: perpendicular to the facing, turned to the pocket's open side (along dir).
  let nx = -fy;
  let ny = fx;
  if (nx * dirX + ny * dirY < 0) {
    nx = -nx;
    ny = -ny;
  }
  const startX = vx + fx * back;
  const startY = vy + fy * back;
  SEGMENTS.push(segment(startX, startY, startX + fx * FACING_LEN, startY + fy * FACING_LEN, nx, ny));
  JAWS.push({ x: vx - dirX * back + outX * JAW_R, y: vy - dirY * back + outY * JAW_R, r: JAW_R });
  return { x: vx - dirX * back, y: vy - dirY * back };
}

function rail(ax: number, ay: number, bx: number, by: number, outX: number, outY: number, degA: number, degB: number) {
  const len = Math.hypot(bx - ax, by - ay);
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  const a = railEnd(ax, ay, -dx, -dy, outX, outY, degA);
  const b = railEnd(bx, by, dx, dy, outX, outY, degB);
  SEGMENTS.push(segment(a.x, a.y, b.x, b.y, -outX, -outY));
}

const c = CORNER_MOUTH / Math.SQRT2;
const s = SIDE_MOUTH / 2;
for (const sign of [1, -1]) {
  rail(-HALF_L + c, sign * HALF_W, -s, sign * HALF_W, 0, sign, CORNER_FACING_DEG, SIDE_FACING_DEG);
  rail(s, sign * HALF_W, HALF_L - c, sign * HALF_W, 0, sign, SIDE_FACING_DEG, CORNER_FACING_DEG);
  rail(sign * HALF_L, -HALF_W + c, sign * HALF_L, HALF_W - c, sign, 0, CORNER_FACING_DEG, CORNER_FACING_DEG);
}

const off = CORNER_HOLE_OFFSET / Math.SQRT2;
function corner(sx: number, sy: number): Pocket {
  return {
    x: sx * (HALF_L + off), y: sy * (HALF_W + off), r: CORNER_HOLE_R,
    aimX: sx * (HALF_L - c / 2), aimY: sy * (HALF_W - c / 2),
  };
}
function side(sy: number): Pocket {
  return { x: 0, y: sy * (HALF_W + SIDE_HOLE_OFFSET), r: SIDE_HOLE_R, aimX: 0, aimY: sy * HALF_W };
}

/** Index order is part of the protocol: 0-2 along y = -W/2 left to right, 3-5 along y = +W/2. */
export const POCKETS: Pocket[] = [corner(-1, -1), side(-1), corner(1, -1), corner(-1, 1), side(1), corner(1, 1)];

/** Head string: the cue ball breaks from x <= this. */
export const HEAD_STRING_X = -HALF_L / 2;
export const FOOT_SPOT_X = HALF_L / 2;
