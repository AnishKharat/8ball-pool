import {
  BALL_R, FACING_LEN, FOOT_SPOT_X, HALF_L, HALF_W, HEAD_STRING_X, POCKETS, SEGMENTS, TABLE_L, TABLE_W,
} from '@chalkline/shared';
import type { Point, Preview } from './preview';
import { ballSprite, setBallScale, spriteSize, trackRoll } from './sphere';

const RAIL = 0.16; // drawn rail width, wide enough to hold the side pocket holes
const CUSH = 0.042; // drawn cushion depth behind the nose line
const AIM_LINE = 0.35; // fixed length, the same in both modes
const CUE_LEN = 1.45;
const CUE_TIP_W = 0.013;
const CUE_BUTT_W = 0.03;
const FILL = 0.96; // share of the canvas the table may use; the rest keeps its drop shadow visible

const CLOTH = '#1b5e6e';
const CUSHION = '#164f5d';

/** Screen mapping. Portrait canvases turn the table 90 degrees: screen right = -world y, screen up = world x. */
export interface View { ctx: CanvasRenderingContext2D; dpr: number; w: number; h: number; scale: number; rot: boolean; ox: number; oy: number }

const tableCanvas = document.createElement('canvas');
const cueCanvas = document.createElement('canvas');
const shadowCanvas = document.createElement('canvas');

/** Size the canvas to its box and re-render everything that only changes with size. */
export function layout(canvas: HTMLCanvasElement): View {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const rot = h > w;
  const fw = TABLE_L + 2 * RAIL;
  const fh = TABLE_W + 2 * RAIL;
  const scale = FILL * Math.min(w / (rot ? fh : fw), h / (rot ? fw : fh));
  const v: View = { ctx: canvas.getContext('2d')!, dpr, w, h, scale, rot, ox: w / 2, oy: h / 2 };
  setBallScale(BALL_R * scale * dpr, rot);
  renderStatic(v);
  renderCue(v);
  renderShadow(v);
  return v;
}

export function toWorld(v: View, px: number, py: number): Point {
  return v.rot
    ? { x: (v.oy - py) / v.scale, y: (v.ox - px) / v.scale }
    : { x: (px - v.ox) / v.scale, y: (v.oy - py) / v.scale };
}

const screenX = (v: View, x: number, y: number) => (v.rot ? v.ox - y * v.scale : v.ox + x * v.scale);
const screenY = (v: View, x: number, y: number) => (v.rot ? v.oy - x * v.scale : v.oy - y * v.scale);

/** Draw in world metres on ctx. */
function world(v: View, ctx: CanvasRenderingContext2D) {
  const s = v.scale * v.dpr;
  if (v.rot) ctx.setTransform(0, -s, -s, 0, v.ox * v.dpr, v.oy * v.dpr);
  else ctx.setTransform(s, 0, 0, -s, v.ox * v.dpr, v.oy * v.dpr);
}

/** World direction toward the light, which sits at the screen's top-left. */
function towardLight(v: View): Point {
  const r = -Math.SQRT1_2;
  const d = -Math.SQRT1_2;
  return v.rot ? { x: -d, y: -r } : { x: r, y: -d };
}

/** Seeded, so the wood grain and cloth weave don't change on resize. */
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

let clothPattern: HTMLCanvasElement | null = null;
function weave(): HTMLCanvasElement {
  if (clothPattern) return clothPattern;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  const rnd = seeded(7);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    g.fillRect(Math.floor(rnd() * 96), Math.floor(rnd() * 96), 1, 1);
  }
  return (clothPattern = c);
}

function quad(ctx: CanvasRenderingContext2D, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

/** Pocket mouths: the area between the two facing segments that run into each pocket. */
function mouths() {
  const facings = SEGMENTS.filter((s) => Math.abs(s.len - FACING_LEN) < 1e-9);
  return POCKETS.map((p) => facings.filter((s) => Math.hypot(s.x1 - p.aimX, s.y1 - p.aimY) < 0.12));
}

function renderStatic(v: View) {
  tableCanvas.width = Math.round(v.w * v.dpr);
  tableCanvas.height = Math.round(v.h * v.dpr);
  const ctx = tableCanvas.getContext('2d')!;
  const L = towardLight(v);
  const px = 1 / v.scale; // one CSS pixel in metres
  const ox = HALF_L + RAIL;
  const oy = HALF_W + RAIL;
  world(v, ctx);

  // Frame, with a drop shadow cast away from the light.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 28 * v.dpr;
  ctx.shadowOffsetX = 8 * v.dpr;
  ctx.shadowOffsetY = 12 * v.dpr;
  const wood = ctx.createLinearGradient(L.x * ox, L.y * oy, -L.x * ox, -L.y * oy);
  wood.addColorStop(0, '#6b3f24');
  wood.addColorStop(0.5, '#4e2c19');
  wood.addColorStop(1, '#371d10');
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.roundRect(-ox, -oy, 2 * ox, 2 * oy, 0.06);
  ctx.fill();
  ctx.restore();

  // Grain runs along each rail.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-ox, -oy, 2 * ox, 2 * oy, 0.06);
  ctx.clip();
  const rnd = seeded(11);
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = rnd() < 0.5 ? 'rgba(20,8,2,0.22)' : 'rgba(255,214,170,0.07)';
    ctx.lineWidth = (0.6 + rnd() * 1.6) * px;
    const long = i < 60;
    const side = rnd() < 0.5 ? -1 : 1;
    const depth = (long ? HALF_W : HALF_L) + CUSH + rnd() * (RAIL - CUSH);
    const start = (rnd() * 2 - 1) * (long ? ox : oy);
    const len = 0.2 + rnd() * 0.8;
    ctx.beginPath();
    if (long) {
      ctx.moveTo(start, side * depth);
      ctx.quadraticCurveTo(start + len / 2, side * (depth + (rnd() - 0.5) * 0.01), start + len, side * depth);
    } else {
      ctx.moveTo(side * depth, start);
      ctx.quadraticCurveTo(side * (depth + (rnd() - 0.5) * 0.01), start + len / 2, side * depth, start + len);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Bevels: the outer lip and the inner drop to the cushion, lit or shaded by which way each face points.
  const ix = HALF_L + CUSH;
  const iy = HALF_W + CUSH;
  const bevel = (outX: number, outY: number, inX: number, inY: number, inward: boolean) => {
    const sides: [number, number, number[]][] = [
      [0, 1, [-outX, outY, outX, outY, inX, inY, -inX, inY]],
      [0, -1, [-outX, -outY, outX, -outY, inX, -inY, -inX, -inY]],
      [1, 0, [outX, -outY, outX, outY, inX, inY, inX, -inY]],
      [-1, 0, [-outX, -outY, -outX, outY, -inX, inY, -inX, -inY]],
    ];
    for (const [nx, ny, pts] of sides) {
      const facing = (inward ? -1 : 1) * (nx * L.x + ny * L.y);
      ctx.fillStyle = facing > 0 ? `rgba(255,226,190,${0.1 + 0.12 * facing})` : `rgba(0,0,0,${0.15 - 0.25 * facing})`;
      quad(ctx, pts);
      ctx.fill();
    }
  };
  bevel(ox, oy, ox - 0.02, oy - 0.02, false);
  bevel(ix + 0.014, iy + 0.014, ix, iy, true);

  // Cloth, with weave and a vignette, drawn in screen space inside a world clip.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-ix, -iy, 2 * ix, 2 * iy);
  ctx.clip();
  ctx.fillStyle = CLOTH;
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = ctx.createPattern(weave(), 'repeat')!;
  ctx.fillRect(0, 0, tableCanvas.width, tableCanvas.height);
  const cx = v.ox * v.dpr;
  const cy = v.oy * v.dpr;
  const reach = Math.hypot(ix, iy) * v.scale * v.dpr;
  const vignette = ctx.createRadialGradient(cx, cy, reach * 0.25, cx, cy, reach);
  vignette.addColorStop(0, 'rgba(120,220,220,0.08)');
  vignette.addColorStop(1, 'rgba(0,10,14,0.5)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, tableCanvas.width, tableCanvas.height);
  ctx.restore();

  // Markings.
  world(v, ctx);
  ctx.strokeStyle = 'rgba(230,245,240,0.16)';
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.moveTo(HEAD_STRING_X, -HALF_W);
  ctx.lineTo(HEAD_STRING_X, HALF_W);
  ctx.stroke();
  ctx.fillStyle = 'rgba(230,245,240,0.3)';
  for (const x of [HEAD_STRING_X, FOOT_SPOT_X]) {
    ctx.beginPath();
    ctx.arc(x, 0, 2.2 * px, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Cushions: each rail's nose, its two facings cut at the cushion depth. The shadow falls on the cloth.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 5 * v.dpr;
  ctx.shadowOffsetX = 2.5 * v.dpr;
  ctx.shadowOffsetY = 3 * v.dpr;
  ctx.fillStyle = CUSHION;
  const noses: number[][] = [];
  for (let i = 0; i < SEGMENTS.length; i += 3) {
    const fa = SEGMENTS[i];
    const fb = SEGMENTS[i + 1];
    const main = SEGMENTS[i + 2];
    const outX = -main.nx;
    const outY = -main.ny;
    const c0 = main.x1 * outX + main.y1 * outY;
    const cut = (f: typeof fa) => {
      const t = (CUSH - (f.x1 * outX + f.y1 * outY - c0)) / (f.tx * outX + f.ty * outY);
      return [f.x1 + f.tx * t, f.y1 + f.ty * t];
    };
    const pts = [...cut(fa), fa.x1, fa.y1, main.x1, main.y1, main.x2, main.y2, fb.x1, fb.y1, ...cut(fb)];
    quad(ctx, pts);
    ctx.fill();
    noses.push([fa.x1, fa.y1, main.x1, main.y1, main.x2, main.y2, fb.x1, fb.y1, main.nx, main.ny]);
  }
  ctx.restore();
  // Lit edge along each nose; brighter where the cushion face turns toward the light.
  ctx.lineWidth = 1.4 * px;
  ctx.lineJoin = 'round';
  for (const n of noses) {
    const facing = n[8] * L.x + n[9] * L.y;
    ctx.strokeStyle = `rgba(150,230,225,${0.18 + 0.3 * Math.max(0, facing)})`;
    ctx.beginPath();
    ctx.moveTo(n[0], n[1]);
    for (let i = 2; i < 8; i += 2) ctx.lineTo(n[i], n[i + 1]);
    ctx.stroke();
  }

  // Pockets: dark mouths, holes with an inner shadow on the lit side, and a leather liner.
  ctx.fillStyle = '#07090a';
  for (const near of mouths()) {
    quad(ctx, [near[0].x1, near[0].y1, near[0].x2, near[0].y2, near[1].x2, near[1].y2, near[1].x1, near[1].y1]);
    ctx.fill();
  }
  for (const p of POCKETS) {
    ctx.strokeStyle = '#1d1410';
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 0.006, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,180,0.18)';
    ctx.lineWidth = 1.2 * px;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 0.012, 0, 2 * Math.PI);
    ctx.stroke();
    const hole = ctx.createRadialGradient(p.x - L.x * p.r * 0.35, p.y - L.y * p.r * 0.35, p.r * 0.1, p.x, p.y, p.r);
    hole.addColorStop(0, '#000');
    hole.addColorStop(0.75, '#050607');
    hole.addColorStop(1, '#1a1c1d');
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Diamond sights: three per half of each long rail and three on each short rail.
  const sight = (x: number, y: number) => {
    const d = 0.011;
    const g = ctx.createRadialGradient(x + L.x * d * 0.4, y + L.y * d * 0.4, 0, x, y, d);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(1, '#b9ad98');
    ctx.fillStyle = g;
    quad(ctx, [x - d, y, x, y + d * 0.7, x + d, y, x, y - d * 0.7]);
    ctx.fill();
  };
  const railMid = CUSH + (RAIL - CUSH) * 0.55;
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    sight((k * TABLE_L) / 8, HALF_W + railMid);
    sight((k * TABLE_L) / 8, -HALF_W - railMid);
  }
  for (const k of [-1, 0, 1]) {
    for (const sx of [-1, 1]) {
      const x = sx * (HALF_L + railMid);
      const y = (k * TABLE_W) / 4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      sight(0, 0);
      ctx.restore();
    }
  }
}

function renderCue(v: View) {
  const s = v.scale * v.dpr;
  cueCanvas.width = Math.ceil(CUE_LEN * s);
  cueCanvas.height = Math.ceil(CUE_BUTT_W * s) + 2;
  const ctx = cueCanvas.getContext('2d')!;
  const h = cueCanvas.height;
  const mid = h / 2;
  const len = cueCanvas.width;
  const half = (x: number) => ((CUE_TIP_W + (CUE_BUTT_W - CUE_TIP_W) * (x / len)) * s) / 2;
  ctx.beginPath();
  ctx.moveTo(0, mid - half(0));
  ctx.lineTo(len, mid - half(len));
  ctx.lineTo(len, mid + half(len));
  ctx.lineTo(0, mid + half(0));
  ctx.closePath();
  ctx.save();
  ctx.clip();
  // Sections from the tip: chalked tip, ferrule, maple shaft, a ring, dark butt.
  const sections: [number, string][] = [[0.012, '#3d7fb0'], [0.035, '#efe8d6'], [0.82, '#d9b77e'], [0.86, '#1b1b1f'], [0.9, '#c9a24a'], [1, '#2a1712']];
  let from = 0;
  for (const [to, color] of sections) {
    ctx.fillStyle = color;
    ctx.fillRect(from * len, 0, (to - from) * len + 1, h);
    from = to;
  }
  // Round shading across the shaft: symmetric, so it reads the same at any aim angle.
  const round = ctx.createLinearGradient(0, 0, 0, h);
  round.addColorStop(0, 'rgba(0,0,0,0.55)');
  round.addColorStop(0.42, 'rgba(255,255,255,0.28)');
  round.addColorStop(0.58, 'rgba(255,255,255,0.1)');
  round.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = round;
  ctx.fillRect(0, 0, len, h);
  ctx.restore();
}

function renderShadow(v: View) {
  const r = BALL_R * v.scale * v.dpr;
  const size = Math.ceil(r * 3.2);
  shadowCanvas.width = shadowCanvas.height = size;
  const ctx = shadowCanvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

export function drawTable(v: View, callable: boolean, called: number | null) {
  const { ctx } = v;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(tableCanvas, 0, 0);
  if (!callable) return;
  world(v, ctx);
  for (let i = 0; i < POCKETS.length; i++) {
    const p = POCKETS[i];
    ctx.strokeStyle = i === called ? '#ffd166' : 'rgba(255,209,102,0.5)';
    ctx.lineWidth = (i === called ? 4 : 2) / v.scale;
    ctx.beginPath();
    ctx.arc(p.aimX, p.aimY, 0.07, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

/** One frame's balls, indexed by id. `size` < 1 shrinks a ball and `dark` > 0 darkens it as it drops. */
export interface BallLayer { shown: Uint8Array; x: Float64Array; y: Float64Array; size: Float64Array; dark: Float64Array }
export const newBallLayer = (): BallLayer => ({
  shown: new Uint8Array(16), x: new Float64Array(16), y: new Float64Array(16), size: new Float64Array(16), dark: new Float64Array(16),
});

export function drawBalls(v: View, layer: BallLayer) {
  const { ctx } = v;
  const d = v.dpr;
  const r = BALL_R * v.scale * d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Shadows first, so none lands on a neighbouring ball; offset away from the top-left light.
  const ss = shadowCanvas.width;
  for (let id = 0; id < 16; id++) {
    if (!layer.shown[id]) continue;
    const k = layer.size[id];
    const x = screenX(v, layer.x[id], layer.y[id]) * d + r * 0.28 * k;
    const y = screenY(v, layer.x[id], layer.y[id]) * d + r * 0.34 * k;
    ctx.globalAlpha = 1 - layer.dark[id];
    ctx.drawImage(shadowCanvas, x - (ss * k) / 2, y - (ss * k) / 2, ss * k, ss * k);
  }
  ctx.globalAlpha = 1;
  const size = spriteSize();
  for (let id = 0; id < 16; id++) {
    if (!layer.shown[id]) continue;
    trackRoll(id, layer.x[id], layer.y[id], BALL_R);
    const k = layer.size[id];
    const x = screenX(v, layer.x[id], layer.y[id]) * d;
    const y = screenY(v, layer.x[id], layer.y[id]) * d;
    ctx.drawImage(ballSprite(id), x - (size * k) / 2, y - (size * k) / 2, size * k, size * k);
    if (layer.dark[id] > 0) {
      ctx.globalAlpha = layer.dark[id];
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, r * k + 0.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

const AIM_DASH = [0, 0];
const NO_DASH: number[] = [];

/** Cue stick and the short aim line: both modes. `gap` is the tip's distance from the cue ball's surface. */
export function drawCue(v: View, cue: Point, angle: number, gap: number, aimLine: boolean) {
  const { ctx } = v;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (aimLine) {
    world(v, ctx);
    AIM_DASH[0] = 6 / v.scale;
    AIM_DASH[1] = 5 / v.scale;
    ctx.setLineDash(AIM_DASH);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5 / v.scale;
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * BALL_R, cue.y + dy * BALL_R);
    ctx.lineTo(cue.x + dx * AIM_LINE, cue.y + dy * AIM_LINE);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }
  // The stick sprite runs from its tip along +x; turn it to point back from the ball.
  const tipX = cue.x - dx * (BALL_R + gap);
  const tipY = cue.y - dy * (BALL_R + gap);
  const d = v.dpr;
  const bx = v.rot ? dy : -dx; // butt direction on screen (right, down)
  const by = v.rot ? dx : dy;
  const h = cueCanvas.height;
  ctx.setTransform(bx, by, -by, bx, screenX(v, tipX, tipY) * d, screenY(v, tipX, tipY) * d);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6 * d;
  ctx.shadowOffsetX = 6 * d;
  ctx.shadowOffsetY = 9 * d;
  ctx.drawImage(cueCanvas, 0, -h / 2);
  ctx.restore();
}

function polyline(ctx: CanvasRenderingContext2D, path: Point[]) {
  ctx.beginPath();
  for (let i = 0; i < path.length; i++) {
    if (i) ctx.lineTo(path[i].x, path[i].y);
    else ctx.moveTo(path[i].x, path[i].y);
  }
  ctx.stroke();
}

/** Assist only: aimPreview returns null in Hard mode, so this has nothing to draw there. */
export function drawPreview(v: View, p: Preview) {
  const { ctx } = v;
  world(v, ctx);
  ctx.lineWidth = 1.5 / v.scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(p.ghost.x, p.ghost.y, BALL_R, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = '#ffd166';
  polyline(ctx, p.targetPath);
}
