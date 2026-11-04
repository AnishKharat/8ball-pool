import {
  BALL_R, FACING_LEN, HALF_W, HEAD_STRING_X, POCKETS, SEGMENTS, TABLE_L, TABLE_W, type BallPos,
} from '@chalkline/shared';
import type { Point, Preview } from './preview';

const RAIL = 0.16; // drawn rail width, wide enough to hold the side pocket holes
const AIM_LINE = 0.35; // fixed length, the same in both modes
const COLORS = ['#f4f1e6', '#e3b505', '#1f4fa8', '#c8321e', '#5b2a86', '#e2711d', '#1c7c54', '#7a1f2b', '#15171a'];
const ASPECT = (TABLE_W + 2 * RAIL) / (TABLE_L + 2 * RAIL);

export interface View { ctx: CanvasRenderingContext2D; scale: number; w: number; h: number; dpr: number }

export function fit(canvas: HTMLCanvasElement): View {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = Math.round(w * ASPECT);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = `${h}px`;
  }
  return { ctx: canvas.getContext('2d')!, scale: w / (TABLE_L + 2 * RAIL), w, h, dpr };
}

// World y points up and screen y down, so spin looks right from above.
const sx = (v: View, x: number) => v.w / 2 + x * v.scale;
const sy = (v: View, y: number) => v.h / 2 - y * v.scale;
export const toWorld = (v: View, px: number, py: number): Point => ({ x: (px - v.w / 2) / v.scale, y: (v.h / 2 - py) / v.scale });

function line(v: View, a: Point, b: Point) {
  v.ctx.beginPath();
  v.ctx.moveTo(sx(v, a.x), sy(v, a.y));
  v.ctx.lineTo(sx(v, b.x), sy(v, b.y));
  v.ctx.stroke();
}

function circle(v: View, x: number, y: number, r: number) {
  v.ctx.beginPath();
  v.ctx.arc(sx(v, x), sy(v, y), r * v.scale, 0, 2 * Math.PI);
}

export function drawTable(v: View, callable: boolean, called: number | null) {
  const { ctx } = v;
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.fillStyle = '#3d2a1c';
  ctx.fillRect(0, 0, v.w, v.h);
  ctx.fillStyle = '#17606b';
  ctx.fillRect(sx(v, -TABLE_L / 2), sy(v, TABLE_W / 2), TABLE_L * v.scale, TABLE_W * v.scale);

  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 1;
  line(v, { x: HEAD_STRING_X, y: -HALF_W }, { x: HEAD_STRING_X, y: HALF_W });

  // Each pocket's mouth is the area between the two facing segments that run into it.
  const facings = SEGMENTS.filter((s) => Math.abs(s.len - FACING_LEN) < 1e-9);
  ctx.fillStyle = '#0b0d0f';
  for (const p of POCKETS) {
    const near = facings.filter((s) => Math.hypot(s.x1 - p.aimX, s.y1 - p.aimY) < 0.12);
    ctx.beginPath();
    ctx.moveTo(sx(v, near[0].x1), sy(v, near[0].y1));
    ctx.lineTo(sx(v, near[0].x2), sy(v, near[0].y2));
    ctx.lineTo(sx(v, near[1].x2), sy(v, near[1].y2));
    ctx.lineTo(sx(v, near[1].x1), sy(v, near[1].y1));
    ctx.fill();
    circle(v, p.x, p.y, p.r);
    ctx.fill();
  }

  ctx.strokeStyle = '#0f3f47';
  ctx.lineWidth = 3;
  for (const s of SEGMENTS) line(v, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });

  if (callable) {
    POCKETS.forEach((p, i) => {
      ctx.strokeStyle = i === called ? '#ffe066' : 'rgba(255,224,102,.45)';
      ctx.lineWidth = i === called ? 4 : 2;
      circle(v, p.aimX, p.aimY, 0.07);
      ctx.stroke();
    });
  }
}

export function drawBall(v: View, id: number, x: number, y: number) {
  const { ctx } = v;
  const px = sx(v, x);
  const py = sy(v, y);
  const r = BALL_R * v.scale;
  ctx.save();
  circle(v, x, y, BALL_R);
  ctx.clip();
  ctx.fillStyle = id > 8 ? COLORS[0] : COLORS[id];
  ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
  if (id > 8) {
    ctx.fillStyle = COLORS[id - 8];
    ctx.fillRect(px - r, py - r * 0.55, 2 * r, r * 1.1);
  }
  if (id > 0) {
    ctx.fillStyle = COLORS[0];
    ctx.beginPath();
    ctx.arc(px, py, r * 0.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#15171a';
    ctx.font = `600 ${Math.max(7, r * 0.7)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(id), px, py + 0.5);
  }
  ctx.restore();
}

export function drawBalls(v: View, balls: readonly BallPos[]) {
  for (const b of balls) drawBall(v, b.id, b.x, b.y);
}

/** Cue stick and the short aim line: both modes. */
export function drawCue(v: View, cue: Point, angle: number, power: number) {
  const { ctx } = v;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  line(v, { x: cue.x + dx * BALL_R, y: cue.y + dy * BALL_R }, { x: cue.x + dx * AIM_LINE, y: cue.y + dy * AIM_LINE });
  ctx.setLineDash([]);
  const gap = BALL_R + 0.012 + power * 0.25;
  ctx.strokeStyle = '#d9b382';
  ctx.lineWidth = Math.max(3, 0.012 * v.scale);
  ctx.lineCap = 'round';
  line(v, { x: cue.x - dx * gap, y: cue.y - dy * gap }, { x: cue.x - dx * (gap + 1.2), y: cue.y - dy * (gap + 1.2) });
  ctx.lineCap = 'butt';
}

function polyline(v: View, path: Point[]) {
  v.ctx.beginPath();
  path.forEach((p, i) => (i ? v.ctx.lineTo(sx(v, p.x), sy(v, p.y)) : v.ctx.moveTo(sx(v, p.x), sy(v, p.y))));
  v.ctx.stroke();
}

/** Assist only: aimPreview returns null in Hard mode. */
export function drawPreview(v: View, p: Preview) {
  const { ctx } = v;
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 1.5;
  circle(v, p.ghost.x, p.ghost.y, BALL_R);
  ctx.stroke();
  polyline(v, p.cuePath);
  ctx.strokeStyle = '#ffe066';
  polyline(v, p.targetPath);
}
