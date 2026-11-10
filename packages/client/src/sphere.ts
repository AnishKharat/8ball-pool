// Ball sprites: each ball is shaded per pixel as a lit sphere, with its pattern looked up through
// a per-ball orientation that rolls with the ball's drawn motion. Visual only.

const IVORY = [244, 239, 226];
const INK = [24, 24, 28];
const DOT = [176, 70, 62];
export const BALL_RGB = [
  IVORY, [232, 182, 30], [32, 82, 176], [204, 46, 38], [104, 50, 150], [236, 112, 32], [22, 124, 82], [124, 32, 44], [22, 22, 26],
];
export const ballCss = (id: number) => `rgb(${BALL_RGB[id > 8 ? id - 8 : id].join(',')})`;

// Light in screen space (right, up, toward the viewer): above and to the top-left.
const LX = -0.42;
const LY = 0.5;
const LZ = 0.76;
const AMBIENT = 0.38;
const DIFFUSE = 0.72;
const DISC_SIN = 0.6; // number disc angular radius, bigger than a real ball's so numbers read on phones
const DISC_COS = Math.sqrt(1 - DISC_SIN * DISC_SIN);
const BAND = 0.5; // stripe half-width, as sin of its angular half-width
const DOT_COS = 0.988; // cue ball marker dots, about 9 degrees across

let rpx = 0; // ball radius in device pixels
let size = 0; // sprite side
let count = 0;
let nr = new Float32Array(0);
let nu = new Float32Array(0);
let nz = new Float32Array(0);
let shade = new Float32Array(0);
let spec = new Float32Array(0);
let cover = new Float32Array(0);
let glyphSize = 0;
const glyphs: Uint8Array[] = [];

interface Sprite { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData; dirty: boolean }
const sprites: Sprite[] = [];
/** Per ball: orientation quaternion (w, x, y, z) mapping body to world, and the last drawn position. */
const quat = new Float64Array(16 * 4);
const lastX = new Float64Array(16).fill(NaN);
const lastY = new Float64Array(16).fill(NaN);
const m = new Float64Array(9);
let rotated = false;

for (let id = 0; id < 16; id++) {
  // Numbers face up with a small random tilt, so the rack reads and still looks round.
  const a = Math.random() * 2 * Math.PI;
  const tilt = 0.25 * Math.random();
  const s = Math.sin(tilt / 2);
  quat.set([Math.cos(tilt / 2), Math.cos(a) * s, Math.sin(a) * s, 0], id * 4);
}

function buildGlyphs() {
  glyphSize = Math.max(8, Math.ceil(2 * DISC_SIN * rpx));
  const c = document.createElement('canvas');
  c.width = c.height = glyphSize;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  for (let id = 1; id < 16; id++) {
    g.clearRect(0, 0, glyphSize, glyphSize);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(glyphSize * (id > 9 ? 0.62 : 0.74))}px system-ui, sans-serif`;
    g.fillText(String(id), glyphSize / 2, glyphSize * 0.53);
    if (id === 6 || id === 9) g.fillRect(glyphSize * 0.32, glyphSize * 0.86, glyphSize * 0.36, Math.max(1, glyphSize * 0.07));
    const data = g.getImageData(0, 0, glyphSize, glyphSize).data;
    const alpha = new Uint8Array(glyphSize * glyphSize);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    glyphs[id] = alpha;
  }
}

/** Rebuild the shading tables and sprites for a new on-screen size. `rot` is the portrait table rotation. */
export function setBallScale(radiusPx: number, rot: boolean) {
  if (rot !== rotated) {
    // Turn every ball a quarter about the vertical with the table, so numbers stay upright on screen.
    const h = (rot ? -Math.PI : Math.PI) / 4;
    const cw = Math.cos(h);
    const sz = Math.sin(h);
    for (let o = 0; o < quat.length; o += 4) {
      const w = quat[o], x = quat[o + 1], y = quat[o + 2], z = quat[o + 3];
      quat[o] = cw * w - sz * z;
      quat[o + 1] = cw * x - sz * y;
      quat[o + 2] = cw * y + sz * x;
      quat[o + 3] = cw * z + sz * w;
    }
  }
  rotated = rot;
  rpx = radiusPx;
  size = 2 * Math.ceil(radiusPx) + 2;
  count = size * size;
  nr = new Float32Array(count);
  nu = new Float32Array(count);
  nz = new Float32Array(count);
  shade = new Float32Array(count);
  spec = new Float32Array(count);
  cover = new Float32Array(count);
  const hl = Math.hypot(LX, LY, LZ + 1);
  const c = size / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let x = (i + 0.5 - c) / rpx;
      let y = (c - j - 0.5) / rpx;
      const d = Math.hypot(x, y);
      cover[k] = Math.max(0, Math.min(1, rpx - d * rpx + 0.5));
      if (d > 0.999) {
        x *= 0.999 / d;
        y *= 0.999 / d;
      }
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      nr[k] = x;
      nu[k] = y;
      nz[k] = z;
      const lambert = Math.max(0, x * LX + y * LY + z * LZ);
      shade[k] = AMBIENT + DIFFUSE * lambert;
      const h = Math.max(0, (x * LX + y * LY + z * (LZ + 1)) / hl);
      spec[k] = 255 * (0.85 * h ** 90 + 0.1 * h ** 10);
    }
  }
  buildGlyphs();
  for (let id = 0; id < 16; id++) {
    const canvas = sprites[id]?.canvas ?? document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    sprites[id] = { canvas, ctx, img: ctx.createImageData(size, size), dirty: true };
  }
}

export const spriteSize = () => size;

/** Roll a ball by its drawn displacement: angle = distance / R about the horizontal axis normal to the motion. */
export function trackRoll(id: number, x: number, y: number, radius: number) {
  const dx = x - lastX[id];
  const dy = y - lastY[id];
  lastX[id] = x;
  lastY[id] = y;
  const d = Math.hypot(dx, dy);
  // NaN on first sight, and a jump (re-rack, placement) isn't a roll.
  if (!(d > 1e-7) || d > 0.3) return;
  const half = d / radius / 2;
  const s = Math.sin(half) / d;
  const qw = Math.cos(half);
  const qx = -dy * s;
  const qy = dx * s;
  const o = id * 4;
  const w = quat[o], a = quat[o + 1], b = quat[o + 2], cc = quat[o + 3];
  // q = dq * q, with dq's z part zero.
  let nw = qw * w - qx * a - qy * b;
  let nx = qw * a + qx * w - qy * cc;
  let ny = qw * b + qy * w + qx * cc;
  let nzq = qw * cc + qx * b - qy * a;
  const len = Math.hypot(nw, nx, ny, nzq);
  nw /= len; nx /= len; ny /= len; nzq /= len;
  quat[o] = nw; quat[o + 1] = nx; quat[o + 2] = ny; quat[o + 3] = nzq;
  sprites[id].dirty = true;
}

/** Screen normal to body frame for one ball: body = R^T * S * n, where S undoes the portrait rotation. */
function bodyMatrix(id: number) {
  const o = id * 4;
  const w = quat[o], x = quat[o + 1], y = quat[o + 2], z = quat[o + 3];
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  // Rows of R^T are R's columns. Portrait maps world x = screen up, world y = -screen right.
  if (!rotated) {
    m[0] = r00; m[1] = r10; m[2] = r20;
    m[3] = r01; m[4] = r11; m[5] = r21;
    m[6] = r02; m[7] = r12; m[8] = r22;
  } else {
    m[0] = -r10; m[1] = r00; m[2] = r20;
    m[3] = -r11; m[4] = r01; m[5] = r21;
    m[6] = -r12; m[7] = r02; m[8] = r22;
  }
}

const ramp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function paint(id: number, sp: Sprite) {
  bodyMatrix(id);
  const data = sp.img.data;
  const base = BALL_RGB[id > 8 ? id - 8 : id];
  const stripe = id > 8;
  const glyph = glyphs[id];
  const gs = glyphSize;
  const discEdge = DISC_SIN / rpx; // one pixel, in cos units
  const bandEdge = 1.2 / rpx;
  for (let k = 0; k < count; k++) {
    const a = cover[k];
    const p = k * 4;
    if (a === 0) {
      data[p + 3] = 0;
      continue;
    }
    const sr = nr[k], su = nu[k], sz = nz[k];
    const bx = m[0] * sr + m[1] * su + m[2] * sz;
    const by = m[3] * sr + m[4] * su + m[5] * sz;
    const bz = m[6] * sr + m[7] * su + m[8] * sz;
    let r: number, g: number, b: number;
    if (id === 0) {
      const ax = bx < 0 ? -bx : bx, ay = by < 0 ? -by : by, az = bz < 0 ? -bz : bz;
      const t = ramp(((ax > ay ? (ax > az ? ax : az) : ay > az ? ay : az) - DOT_COS) / (2 / rpx) + 0.5);
      r = IVORY[0] + (DOT[0] - IVORY[0]) * t;
      g = IVORY[1] + (DOT[1] - IVORY[1]) * t;
      b = IVORY[2] + (DOT[2] - IVORY[2]) * t;
    } else {
      // Outside the number discs: the ball colour, or for a stripe its white caps outside the band.
      const t = stripe ? ramp(((bx < 0 ? -bx : bx) - BAND) / bandEdge + 0.5) : 0;
      r = base[0] + (IVORY[0] - base[0]) * t;
      g = base[1] + (IVORY[1] - base[1]) * t;
      b = base[2] + (IVORY[2] - base[2]) * t;
      const az = bz < 0 ? -bz : bz;
      const disc = ramp((az - DISC_COS) / discEdge + 0.5);
      if (disc > 0) {
        const u = bx / DISC_SIN;
        const v = (bz > 0 ? by : -by) / DISC_SIN;
        const gx = ((u + 1) * 0.5 * gs) | 0;
        const gy = ((1 - v) * 0.5 * gs) | 0;
        const ink = gx >= 0 && gx < gs && gy >= 0 && gy < gs ? glyph[gy * gs + gx] / 255 : 0;
        const wr = IVORY[0] + (INK[0] - IVORY[0]) * ink;
        const wg = IVORY[1] + (INK[1] - IVORY[1]) * ink;
        const wb = IVORY[2] + (INK[2] - IVORY[2]) * ink;
        r += (wr - r) * disc;
        g += (wg - g) * disc;
        b += (wb - b) * disc;
      }
    }
    const s = shade[k];
    const h = spec[k];
    data[p] = r * s + h;
    data[p + 1] = g * s + h;
    data[p + 2] = b * s + h;
    data[p + 3] = a * 255;
  }
  sp.ctx.putImageData(sp.img, 0, 0);
  sp.dirty = false;
}

/** The ball's sprite, repainted only if it rolled since the last call. */
export function ballSprite(id: number): HTMLCanvasElement {
  const sp = sprites[id];
  if (sp.dirty) paint(id, sp);
  return sp.canvas;
}
