import {
  BALL_R, canPlaceCue, currentSeat, groupOf, isOnEight, MAX_HIT, POCKETS,
  type BallPos, type EndReason, type Foul, type GameState, type Mode, type RoomView, type ShotBroadcast,
} from '@chalkline/shared';
import { io } from 'socket.io-client';
import { buildTracks, sampleTrack, type TrackPoint } from './playback';
import { aimPreview, type Preview } from './preview';
import { drawBall, drawBalls, drawCue, drawPreview, drawTable, fit, toWorld } from './render';

const FINE_STEP = (0.05 * Math.PI) / 180; // about 2 mm of aim across the table's length
const IDLE_PREVIEW_POWER = 0.5; // before the slider is pulled, a zero-power preview would stop short of everything
const GRAB_RADIUS = 3 * BALL_R; // generous enough for a fingertip
const POCKET_TAP_RADIUS = 0.1;

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

interface Playback { shot: ShotBroadcast; tracks: Map<number, TrackPoint[]>; start: number; gone: Map<number, number> }

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

const balls = (): BallPos[] => game?.balls ?? [];
const cueBall = () => balls().find((b) => b.id === 0);
const myTeam = () => (game ? game.teamOf[seat] : 0);
const shooting = () => !!game && !playback && !waiting && (game.phase === 'break' || game.phase === 'play') && currentSeat(game) === seat;
const mustCall = () => shooting() && game!.phase === 'play' && isOnEight(game!, myTeam());

function setGame(next: GameState) {
  game = next;
  previewKey = '';
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
  const gone = new Map<number, number>();
  for (const e of shot.events) if (e.type === 'pot' || e.type === 'off') gone.set(e.a, e.t);
  playback = { shot, tracks: buildTracks(balls(), shot.frames), start: performance.now(), gone };
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
  setPower(0);
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
  preview = aimPreview(mode, balls(), { angle, power: p, hitX, hitY });
}

function frame(now: number) {
  const v = fit(canvas);
  drawTable(v, mustCall(), called);
  if (playback) {
    const t = (now - playback.start) / 1000;
    for (const [id, track] of playback.tracks) {
      const goneAt = playback.gone.get(id);
      if (goneAt !== undefined && t >= goneAt) continue;
      const pos = sampleTrack(track, t);
      drawBall(v, id, pos.x, pos.y);
    }
    if (t >= playback.shot.duration) finishPlayback(playback);
  } else {
    drawBalls(v, balls());
    const cue = cueBall();
    if (shooting() && cue) {
      updatePreview();
      if (preview) drawPreview(v, preview);
      drawCue(v, cue, angle, power);
    }
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
  if (!shooting()) return;
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

let pullFrom = 0;
powerEl.addEventListener('pointerdown', (e) => {
  if (!shooting()) return;
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

el('newGame').addEventListener('click', () => {
  playback = null;
  waiting = false;
  called = null;
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

setHit(0, 0);
renderStatus();
requestAnimationFrame(frame);
