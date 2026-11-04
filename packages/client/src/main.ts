import {
  BALL_R, canPlaceCue, HEAD_STRING_X, MAX_HIT, POCKETS, rackBalls, simulateShot,
  type BallPos, type ShotIntent, type SimResult,
} from '@chalkline/shared';
import { buildTracks, sampleTrack, type TrackPoint } from './playback';
import { aimPreview, type Mode, type Preview } from './preview';
import { drawBall, drawBalls, drawCue, drawPreview, drawTable, fit, toWorld } from './render';

const FINE_STEP = (0.05 * Math.PI) / 180; // about 2 mm of aim across the table's length
const IDLE_PREVIEW_POWER = 0.5; // before the slider is pulled, a zero-power preview would stop short of everything
const GRAB_RADIUS = 3 * BALL_R; // generous enough for a fingertip
const POCKET_TAP_RADIUS = 0.1;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('table');
const statusEl = el('status');
const hitPad = el('hit');
const hitDot = el('hitDot');
const powerEl = el('power');
const powerFill = el('powerFill');

interface Playback { result: SimResult; tracks: Map<number, TrackPoint[]>; start: number; gone: Map<number, number> }

let balls: BallPos[] = [];
let mode: Mode = 'assist';
let angle = 0;
let power = 0;
let hitX = 0;
let hitY = 0;
let ballInHand = false;
let behindHeadString = false;
let calling = false;
let called: number | null = null;
let playback: Playback | null = null;
let draggingCue = false;
let aiming = false;
let preview: Preview | null = null;
let previewKey = '';

function setStatus(text: string) {
  statusEl.textContent = text;
}

const cueBall = () => balls.find((b) => b.id === 0);

function freeCueSpot(): { x: number; y: number } {
  for (let k = 0; ; k++) {
    const y = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.2 * BALL_R;
    if (canPlaceCue(balls, HEAD_STRING_X, y, false)) return { x: HEAD_STRING_X, y };
  }
}

function startRack() {
  balls = rackBalls();
  playback = null;
  ballInHand = true;
  behindHeadString = true;
  calling = false;
  called = null;
  angle = 0;
  previewKey = '';
  setStatus('Break: drag the cue ball behind the line if you like, then aim.');
}

// shortcut: shots simulate in the browser and the bar's buttons stand in for rules, until the server takes over in milestones 4-6.
function submitShot(shot: ShotIntent) {
  const result = simulateShot(balls, shot);
  const gone = new Map<number, number>();
  for (const e of result.events) if (e.type === 'pot' || e.type === 'off') gone.set(e.a, e.t);
  playback = { result, tracks: buildTracks(balls, result.frames), start: performance.now(), gone };
  setStatus('');
}

function finishPlayback(p: Playback) {
  balls = p.result.balls;
  playback = null;
  previewKey = '';
  behindHeadString = false;
  const eight = p.result.events.find((e) => e.type === 'pot' && e.a === 8);
  if (eight?.type === 'pot') setStatus(!calling || called === eight.pocket ? '8 potted.' : '8 potted in the wrong pocket.');
  called = null;
  if (!cueBall()) {
    balls = [{ id: 0, ...freeCueSpot() }, ...balls];
    ballInHand = true;
    setStatus('Scratch: ball in hand.');
  }
  calling = balls.length === 2 && balls.some((b) => b.id === 8);
  if (calling) setStatus('Tap a pocket to call the 8.');
}

function shoot() {
  if (playback || power <= 0) return;
  if (calling && called === null) {
    setStatus('Tap a pocket to call the 8 first.');
    setPower(0);
    return;
  }
  const shot = { angle, power, hitX, hitY };
  setPower(0);
  ballInHand = false;
  submitShot(shot);
}

function setPower(p: number) {
  power = Math.max(0, Math.min(1, p));
  powerFill.style.height = `${power * 100}%`;
  powerEl.setAttribute('aria-valuenow', String(Math.round(power * 100)));
}

function setHit(x: number, y: number) {
  const len = Math.hypot(x, y);
  const k = len > MAX_HIT ? MAX_HIT / len : 1;
  hitX = x * k;
  hitY = y * k;
  hitDot.style.left = `${50 + hitX * 50}%`;
  hitDot.style.top = `${50 - hitY * 50}%`;
}

function updatePreview() {
  const cue = cueBall();
  if (!cue) return;
  const p = power > 0 ? power : IDLE_PREVIEW_POWER;
  const key = [mode, angle, p, hitX, hitY, cue.x, cue.y].join();
  if (key === previewKey) return;
  previewKey = key;
  preview = aimPreview(mode, balls, { angle, power: p, hitX, hitY });
}

function frame(now: number) {
  const v = fit(canvas);
  drawTable(v, calling && !playback, called);
  if (playback) {
    const t = (now - playback.start) / 1000;
    for (const [id, track] of playback.tracks) {
      const goneAt = playback.gone.get(id);
      if (goneAt !== undefined && t >= goneAt) continue;
      const pos = sampleTrack(track, t);
      drawBall(v, id, pos.x, pos.y);
    }
    if (t >= playback.result.duration) finishPlayback(playback);
  } else {
    updatePreview();
    drawBalls(v, balls);
    if (preview) drawPreview(v, preview);
    const cue = cueBall();
    if (cue) drawCue(v, cue, angle, power);
  }
  requestAnimationFrame(frame);
}

function pointerWorld(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return toWorld(fit(canvas), e.clientX - r.left, e.clientY - r.top);
}

function aimAt(x: number, y: number) {
  const cue = cueBall();
  if (cue && Math.hypot(x - cue.x, y - cue.y) > BALL_R) angle = Math.atan2(y - cue.y, x - cue.x);
}

canvas.addEventListener('pointerdown', (e) => {
  if (playback) return;
  const p = pointerWorld(e);
  const cue = cueBall();
  canvas.setPointerCapture(e.pointerId);
  if (calling) {
    const i = POCKETS.findIndex((q) => Math.hypot(q.aimX - p.x, q.aimY - p.y) < POCKET_TAP_RADIUS);
    if (i !== -1) {
      called = i;
      setStatus('Pocket called. Shoot when ready.');
      return;
    }
  }
  if (ballInHand && cue && Math.hypot(p.x - cue.x, p.y - cue.y) < GRAB_RADIUS) {
    draggingCue = true;
    return;
  }
  aiming = true;
  aimAt(p.x, p.y);
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointerWorld(e);
  const cue = cueBall();
  if (draggingCue && cue) {
    // An illegal spot just doesn't take: the ball stays on its last legal one.
    if (canPlaceCue(balls, p.x, p.y, behindHeadString)) {
      cue.x = p.x;
      cue.y = p.y;
    }
  } else if (aiming) {
    aimAt(p.x, p.y);
  }
});

const endCanvasDrag = () => {
  draggingCue = false;
  aiming = false;
};
canvas.addEventListener('pointerup', endCanvasDrag);
canvas.addEventListener('pointercancel', endCanvasDrag);

function moveHit(e: PointerEvent) {
  const r = hitPad.getBoundingClientRect();
  setHit(((e.clientX - r.left) / r.width - 0.5) * 2, -((e.clientY - r.top) / r.height - 0.5) * 2);
}
hitPad.addEventListener('pointerdown', (e) => {
  hitPad.setPointerCapture(e.pointerId);
  moveHit(e);
});
hitPad.addEventListener('pointermove', (e) => {
  if (hitPad.hasPointerCapture(e.pointerId)) moveHit(e);
});

let pullFrom = 0;
powerEl.addEventListener('pointerdown', (e) => {
  if (playback) return;
  powerEl.setPointerCapture(e.pointerId);
  pullFrom = e.clientY;
});
powerEl.addEventListener('pointermove', (e) => {
  if (powerEl.hasPointerCapture(e.pointerId)) setPower((e.clientY - pullFrom) / powerEl.clientHeight);
});
powerEl.addEventListener('pointerup', shoot);
powerEl.addEventListener('pointercancel', () => setPower(0));
powerEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') setPower(power + 0.02);
  else if (e.key === 'ArrowUp') setPower(power - 0.02);
  else if (e.key === 'Enter' || e.key === ' ') shoot();
  else return;
  e.preventDefault();
});

function holdToRepeat(button: HTMLElement, step: () => void) {
  let timer = 0;
  const stop = () => clearInterval(timer);
  button.addEventListener('pointerdown', () => {
    step();
    timer = window.setInterval(step, 40);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
  // detail 0 is a keyboard click; a pointer click already stepped on pointerdown.
  button.addEventListener('click', (e) => {
    if (e.detail === 0) step();
  });
}
holdToRepeat(el('fineLeft'), () => (angle += FINE_STEP));
holdToRepeat(el('fineRight'), () => (angle -= FINE_STEP));
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  if (e.key === 'ArrowLeft') angle += FINE_STEP;
  else if (e.key === 'ArrowRight') angle -= FINE_STEP;
});

el<HTMLSelectElement>('mode').addEventListener('change', (e) => {
  mode = (e.target as HTMLSelectElement).value as Mode;
  previewKey = '';
});
el('newRack').addEventListener('click', startRack);
el('giveHand').addEventListener('click', () => {
  if (playback) return;
  ballInHand = true;
  behindHeadString = false;
  setStatus('Ball in hand: drag the cue ball anywhere.');
});
el('callEight').addEventListener('click', () => {
  if (playback) return;
  calling = true;
  called = null;
  setStatus('Tap a pocket to call the 8.');
});

setHit(0, 0);
startRack();
requestAnimationFrame(frame);
