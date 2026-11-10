import {
  BALL_R, canPlaceCue, currentSeat, groupOf, isOnEight, MAX_HIT, POCKETS,
  type BallPos, type EndReason, type Foul, type GameState, type Mode, type RoomView, type ShotBroadcast,
} from '@chalkline/shared';
import { io } from 'socket.io-client';
import { renderClock, renderTeams, renderTray, type HudSeat } from './hud';
import { buildTracks, sampleTrack, type TrackPoint } from './playback';
import { aimPreview, type Preview } from './preview';
import { drawBalls, drawCue, drawPreview, drawTable, layout, newBallLayer, toWorld, type View } from './render';

const FINE_STEP = (0.05 * Math.PI) / 180; // about 2 mm of aim across the table's length
const IDLE_PREVIEW_POWER = 0.5; // before the slider is pulled, a zero-power preview would stop short of everything
const GRAB_RADIUS = 3 * BALL_R; // generous enough for a fingertip
const POCKET_TAP_RADIUS = 0.1;
const CUE_REST_GAP = 0.012; // tip to ball with no power
const CUE_PULL = 0.25; // extra draw-back at full power
const STRIKE_MS = 110;
const POT_DROP = 0.35; // seconds a potted ball takes to sink
const CLOCK_MS = 45000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const FOUL_TEXT: Record<Foul, string> = {
  scratch: 'scratch',
  wrongBall: 'wrong ball first',
  noContact: 'no contact',
  noCushion: 'no cushion after contact',
  offTable: 'ball off the table',
};
const END_TEXT: Record<EndReason, string> = {
  potted8: 'the 8 went in the called pocket',
  early8: 'the 8 went down early',
  wrongPocket: 'the 8 went in the wrong pocket',
  foulOn8: 'the 8 went down on a foul',
};

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('table');
const statusEl = el('status');
const noteEl = el('note');
const chooseBar = el('chooseBar');
const hitPad = el('hit');
const hitDot = el('hitDot');
const powerEl = el('power');
const powerFill = el('powerFill');

interface Playback {
  shot: ShotBroadcast;
  tracks: (TrackPoint[] | undefined)[]; // by ball id
  start: number;
  end: number;
  goneAt: Float64Array; // by ball id; Infinity if it stays up
  pocket: Int8Array; // by ball id; -1 unless potted
}

const socket = io();
let game: GameState | null = null;
let mode: Mode = 'assist';
let seat = 0;
let angle = 0;
let power = 0;
let hitX = 0;
let hitY = 0;
let called: number | null = null;
let playback: Playback | null = null;
let waiting = false; // a shot is on its way to the server
let draggingCue = false;
let aiming = false;
let preview: Preview | null = null;
let previewKey = '';
let view: View | null = null;
let strike: { angle: number; gap: number; start: number; x: number; y: number } | null = null;
let potted: number[] = []; // for the tray, in the order they went down
let deadline: number | null = null; // local clock time the shot clock runs out
const layer = newBallLayer();
const sample = { x: 0, y: 0 };
const seats: HudSeat[] = [
  { name: 'You', team: 0, connected: true, gone: false },
  { name: 'Bot', team: 1, connected: true, gone: false },
];

const balls = (): BallPos[] => game?.balls ?? [];
const cueBall = () => balls().find((b) => b.id === 0);
const myTeam = () => (game ? game.teamOf[seat] : 0);
const shooting = () => !!game && !playback && !waiting && (game.phase === 'break' || game.phase === 'play') && currentSeat(game) === seat;
const mustCall = () => shooting() && game!.phase === 'play' && isOnEight(game!, myTeam());

function setGame(next: GameState) {
  game = next;
  previewKey = '';
  const up = new Set(next.balls.map((b) => b.id));
  potted = potted.filter((id) => !up.has(id));
  for (let id = 1; id < 16; id++) if (!up.has(id) && !potted.includes(id)) potted.push(id);
  renderTray(potted);
  renderTeams(next, seats, seat);
  renderStatus();
}

function renderStatus() {
  chooseBar.hidden = !(game?.phase === 'breakChoice' && !playback && currentSeat(game) === seat);
  if (!game) return void (statusEl.textContent = 'Choose settings and start a game.');
  if (playback) return void (statusEl.textContent = '');
  const group = groupOf(game, myTeam());
  const yours = group ? ` You have ${group}.` : ' The table is open.';
  if (game.phase === 'over') {
    const won = game.winner === myTeam();
    statusEl.textContent = `${won ? 'You win' : 'You lose'}: ${END_TEXT[game.endReason!]}.`;
  } else if (currentSeat(game) !== seat) {
    statusEl.textContent = `The bot is thinking.${yours}`;
  } else if (game.phase === 'breakChoice') {
    statusEl.textContent = 'Illegal break. Re-rack and break, or play on?';
  } else if (game.phase === 'break') {
    statusEl.textContent = 'Your break. Drag the cue ball behind the line if you like, then aim.';
  } else if (mustCall() && called === null) {
    statusEl.textContent = `Your shot, on the 8. Tap a pocket to call it.`;
  } else {
    statusEl.textContent = `Your shot.${game.ballInHand ? ' Ball in hand: drag the cue ball anywhere.' : ''}${yours}`;
  }
}

function startPlayback(shot: ShotBroadcast) {
  const goneAt = new Float64Array(16).fill(Infinity);
  const pocket = new Int8Array(16).fill(-1);
  let end = shot.duration;
  for (const e of shot.events) {
    if (e.type === 'off') goneAt[e.a] = e.t;
    if (e.type === 'pot') {
      goneAt[e.a] = e.t;
      pocket[e.a] = e.pocket;
      end = Math.max(end, e.t + POT_DROP);
    }
  }
  const byId = buildTracks(balls(), shot.frames);
  const tracks = Array.from({ length: 16 }, (_, id) => byId.get(id));
  // Let the cue stick finish its strike before the balls move.
  const start = Math.max(performance.now(), strike && !reducedMotion.matches ? strike.start + STRIKE_MS : 0);
  playback = { shot, tracks, start, end, goneAt, pocket };
  waiting = false;
  called = null;
  noteEl.textContent = '';
  renderStatus();
}

function finishPlayback(p: Playback) {
  playback = null;
  const { fouls } = p.shot.outcome;
  noteEl.textContent = fouls.length ? `Foul: ${fouls.map((f) => FOUL_TEXT[f]).join(', ')}.` : '';
  setGame(p.shot.state);
}

socket.on('state', (v: RoomView) => {
  mode = v.mode;
  seat = v.seat;
  waiting = false;
  // A state sent during playback describes the table after it, so it replaces what playback will end on.
  if (playback) playback.shot.state = v.game;
  else setGame(v.game);
});
socket.on('shotResult', startPlayback);
socket.on('rejected', (reason: string) => {
  waiting = false;
  noteEl.textContent = `Refused: ${reason}.`;
});
socket.on('disconnect', () => {
  noteEl.textContent = 'Disconnected from the server.';
});

function shoot() {
  if (!shooting() || power <= 0) return setPower(0);
  if (mustCall() && called === null) {
    noteEl.textContent = 'Tap a pocket to call the 8 first.';
    return setPower(0);
  }
  // atan2 brings fine-aim drift back into the range the server validates.
  socket.emit('shot', { angle: Math.atan2(Math.sin(angle), Math.cos(angle)), power, hitX, hitY });
  waiting = true;
  const cue = cueBall()!;
  strike = { angle, gap: CUE_REST_GAP + power * CUE_PULL, start: performance.now(), x: cue.x, y: cue.y };
  setPower(0);
}

function setPower(p: number) {
  power = Math.max(0, Math.min(1, p));
  powerFill.style.setProperty('--p', String(power));
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
  preview = aimPreview(mode, balls(), { angle, power: p, hitX, hitY });
}

/** Fill the ball layer from the playback at time t (seconds), sinking potted balls into their pockets. */
function sampleShot(p: Playback, t: number) {
  for (let id = 0; id < 16; id++) {
    const track = p.tracks[id];
    layer.shown[id] = 0;
    if (!track) continue;
    const goneAt = p.goneAt[id];
    const sinking = t - goneAt;
    const pocket = p.pocket[id];
    if (sinking >= 0 && (pocket < 0 || sinking >= POT_DROP || reducedMotion.matches)) continue;
    sampleTrack(track, Math.min(t, goneAt), sample);
    layer.shown[id] = 1;
    layer.x[id] = sample.x;
    layer.y[id] = sample.y;
    layer.size[id] = 1;
    layer.dark[id] = 0;
    if (sinking >= 0) {
      const k = sinking / POT_DROP;
      const q = POCKETS[pocket];
      layer.x[id] += (q.x - sample.x) * k;
      layer.y[id] += (q.y - sample.y) * k;
      layer.size[id] = 1 - 0.45 * k;
      layer.dark[id] = 0.85 * k;
    }
  }
}

function sampleRest() {
  layer.shown.fill(0);
  for (const b of balls()) {
    layer.shown[b.id] = 1;
    layer.x[b.id] = b.x;
    layer.y[b.id] = b.y;
    layer.size[b.id] = 1;
    layer.dark[b.id] = 0;
  }
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const v = view;
  if (!v) return;
  drawTable(v, mustCall(), called);
  if (playback && now >= playback.start) {
    const t = (now - playback.start) / 1000;
    sampleShot(playback, t);
    drawBalls(v, layer);
    if (t >= playback.end) finishPlayback(playback);
  } else {
    sampleRest();
    drawBalls(v, layer);
    const cue = cueBall();
    if (strike && (waiting || playback)) {
      // The stick drives through to the ball, then holds there until the balls start moving.
      const k = reducedMotion.matches ? 1 : Math.min(1, (now - strike.start) / STRIKE_MS);
      drawCue(v, strike, strike.angle, strike.gap * (1 - k * k), false);
    } else if (shooting() && cue) {
      updatePreview();
      if (preview) drawPreview(v, preview);
      drawCue(v, cue, angle, CUE_REST_GAP + power * CUE_PULL, true);
    }
  }
  renderClock(deadline === null || game?.phase === 'over' ? null : deadline - Date.now(), CLOCK_MS);
}

function pointerWorld(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return toWorld(view!, e.clientX - r.left, e.clientY - r.top);
}

function aimAt(x: number, y: number) {
  const cue = cueBall();
  if (cue && Math.hypot(x - cue.x, y - cue.y) > BALL_R) angle = Math.atan2(y - cue.y, x - cue.x);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!shooting() || !view) return;
  const p = pointerWorld(e);
  const cue = cueBall();
  canvas.setPointerCapture(e.pointerId);
  if (mustCall()) {
    const i = POCKETS.findIndex((q) => Math.hypot(q.aimX - p.x, q.aimY - p.y) < POCKET_TAP_RADIUS);
    if (i !== -1) {
      called = i;
      socket.emit('call', { pocket: i });
      noteEl.textContent = '';
      statusEl.textContent = 'Pocket called. Shoot when ready.';
      return;
    }
  }
  if (game!.ballInHand && cue && Math.hypot(p.x - cue.x, p.y - cue.y) < GRAB_RADIUS) {
    draggingCue = true;
    return;
  }
  aiming = true;
  aimAt(p.x, p.y);
});

canvas.addEventListener('pointermove', (e) => {
  if (!view) return;
  const p = pointerWorld(e);
  const cue = cueBall();
  if (draggingCue && cue && game) {
    // An illegal spot just doesn't take: the ball stays on its last legal one.
    if (canPlaceCue(balls(), p.x, p.y, game.phase === 'break')) {
      cue.x = p.x;
      cue.y = p.y;
    }
  } else if (aiming) {
    aimAt(p.x, p.y);
  }
});

const endCanvasDrag = () => {
  const cue = cueBall();
  if (draggingCue && cue) socket.emit('place', { x: cue.x, y: cue.y });
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

// The slider runs down in landscape and to the right when the portrait layout lays it flat.
const powerFlat = () => powerEl.clientWidth > powerEl.clientHeight;
let pullFrom = 0;
powerEl.addEventListener('pointerdown', (e) => {
  if (!shooting()) return;
  powerEl.setPointerCapture(e.pointerId);
  pullFrom = powerFlat() ? e.clientX : e.clientY;
});
powerEl.addEventListener('pointermove', (e) => {
  if (!powerEl.hasPointerCapture(e.pointerId)) return;
  setPower(powerFlat() ? (e.clientX - pullFrom) / powerEl.clientWidth : (e.clientY - pullFrom) / powerEl.clientHeight);
});
powerEl.addEventListener('pointerup', shoot);
powerEl.addEventListener('pointercancel', () => setPower(0));
powerEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') setPower(power + 0.02);
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setPower(power - 0.02);
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
  if (e.target instanceof HTMLSelectElement || e.target === powerEl) return;
  if (e.key === 'ArrowLeft') angle += FINE_STEP;
  else if (e.key === 'ArrowRight') angle -= FINE_STEP;
});

el('newGame').addEventListener('click', () => {
  playback = null;
  waiting = false;
  strike = null;
  called = null;
  potted = [];
  angle = 0;
  noteEl.textContent = '';
  setPower(0);
  socket.emit('startBot', {
    mode: el<HTMLSelectElement>('mode').value,
    difficulty: el<HTMLSelectElement>('difficulty').value,
  });
});
el('rerack').addEventListener('click', () => socket.emit('choose', { choice: 'rerack' }));
el('playOn').addEventListener('click', () => socket.emit('choose', { choice: 'playOn' }));

const relayout = () => {
  view = layout(canvas);
};
new ResizeObserver(relayout).observe(canvas);
// Zooming or moving to another screen changes the pixel ratio without resizing the box.
const watchDpr = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
  relayout();
  watchDpr();
}, { once: true });
watchDpr();

setHit(0, 0);
renderTeams(null, seats, seat);
renderStatus();
requestAnimationFrame(frame);
