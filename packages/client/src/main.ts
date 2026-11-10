import {
  BALL_R, canPlaceCue, currentSeat, groupOf, isOnEight, mayAct, MAX_HIT, POCKETS, SHOT_CLOCK_MS,
  type BallPos, type ClientMessages, type EndReason, type Foul, type GameState, type Mode, type RoomFormat, type RoomView,
  type ServerMessages, type ShotBroadcast,
} from '@chalkline/shared';
import { io, type Socket } from 'socket.io-client';
import { renderClock, renderTeams, renderTray, type HudSeat } from './hud';
import { renderLobby, TEAM_NAMES } from './lobby';
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
const SESSION_KEY = 'chalkline.session';
const NAME_KEY = 'chalkline.name';
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
  forfeit: 'a team had nobody left at the table',
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
const nameInput = el<HTMLInputElement>('name');
const codeInput = el<HTMLInputElement>('code');

interface Playback {
  shot: ShotBroadcast;
  tracks: (TrackPoint[] | undefined)[]; // by ball id
  start: number;
  end: number;
  goneAt: Float64Array; // by ball id; Infinity if it stays up
  pocket: Int8Array; // by ball id; -1 unless potted
  shooter: number; // seat
}

const socket: Socket<ServerMessages, ClientMessages> = io();
let room: RoomView | null = null;
let playerId: string | null = null;
let game: GameState | null = null;
let mode: Mode = 'assist';
let seat = -1;
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

const balls = (): BallPos[] => game?.balls ?? [];
const cueBall = () => balls().find((b) => b.id === 0);
const myTeam = () => (game ? game.teamOf[seat] : 0);
const shooting = () => !!game && !!room && !playback && !waiting && (game.phase === 'break' || game.phase === 'play') && mayAct(game, room.seats, seat);
const mustCall = () => shooting() && game!.phase === 'play' && isOnEight(game!, myTeam());
const seatName = (i: number) => {
  const p = room?.seats[i];
  if (!p) return 'Empty seat';
  return p.bot ? 'The bot' : i === seat ? 'You' : p.name;
};
const hudSeats = (): HudSeat[] => (room?.seats ?? []).map((p, i) => ({
  name: p ? (p.bot ? `Bot \u00b7 ${room!.difficulty}` : p.name) : 'Empty seat',
  team: room!.teams[i],
  connected: !!p?.connected,
  gone: !!p?.gone,
}));

// ---- storage: sessionStorage holds the seat token per tab; localStorage only remembers the name ----

function saved(): { code: string; token: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function save(session: { code: string; token: string } | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be off in private modes; a reload then just can't resume.
  }
}

function myName(): string {
  const name = nameInput.value.trim() || 'Player';
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // see save()
  }
  return name;
}

// ---- screens ----

function show(screen: 'menu' | 'lobby' | 'game') {
  for (const id of ['menu', 'lobby', 'game']) el(id).hidden = id !== screen;
  if (screen !== 'game') el('overlay').hidden = true;
}

function resetTable() {
  game = null;
  playback = null;
  waiting = false;
  strike = null;
  called = null;
  potted = [];
  angle = 0;
  deadline = null;
  noteEl.textContent = '';
  el('overlay').hidden = true;
  setPower(0);
}

function toMenu(reason = '') {
  room = null;
  save(null);
  resetTable();
  show('menu');
  el('menuNote').textContent = reason;
  if (location.pathname !== '/') history.replaceState(null, '', '/');
}

function setGame(next: GameState) {
  game = next;
  previewKey = '';
  const up = new Set(next.balls.map((b) => b.id));
  potted = potted.filter((id) => !up.has(id));
  for (let id = 1; id < 16; id++) if (!up.has(id) && !potted.includes(id)) potted.push(id);
  renderTray(potted);
  renderTeams(next, hudSeats(), seat);
  renderStatus();
  if (next.phase === 'over') showResult(next);
}

function showResult(g: GameState) {
  const won = g.winner === myTeam();
  const solo = room?.format === 'bot' || room?.format === '1v1';
  el('overTitle').textContent = won ? 'You win' : 'You lose';
  const winner = solo ? seatName(g.teamOf.indexOf(g.winner!)) : TEAM_NAMES[g.winner!];
  el('overText').textContent = `${winner === 'You' ? 'You win' : `${winner} wins`}: ${END_TEXT[g.endReason!]}.`;
  el('overlay').hidden = false;
  el('backToMenu').focus();
}

function renderStatus() {
  chooseBar.hidden = !(game?.phase === 'breakChoice' && !playback && room && mayAct(game, room.seats, seat));
  if (!game) return void (statusEl.textContent = '');
  if (playback) return void (statusEl.textContent = '');
  const group = groupOf(game, myTeam());
  const yours = group ? ` You have ${group}.` : ' The table is open.';
  const up = currentSeat(game);
  const cover = up !== seat ? `Covering for ${seatName(up)}. ` : '';
  if (game.phase === 'over') {
    const won = game.winner === myTeam();
    statusEl.textContent = `${won ? 'You win' : 'You lose'}: ${END_TEXT[game.endReason!]}.`;
  } else if (!room || !mayAct(game, room.seats, seat)) {
    const p = room?.seats[up];
    statusEl.textContent = p?.bot ? `The bot is thinking.${yours}` : `${seatName(up)} is up${p && !p.connected ? ' (reconnecting)' : ''}.${yours}`;
  } else if (game.phase === 'breakChoice') {
    statusEl.textContent = `${cover}Illegal break. Re-rack and break, or play on?`;
  } else if (game.phase === 'break') {
    statusEl.textContent = `${cover}Your break. Drag the cue ball behind the line if you like, then aim.`;
  } else if (mustCall() && called === null) {
    statusEl.textContent = `${cover}Your shot, on the 8. Tap a pocket to call it.`;
  } else {
    statusEl.textContent = `${cover}Your shot.${game.ballInHand ? ' Ball in hand: drag the cue ball anywhere.' : ''}${yours}`;
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
  const start = Math.max(performance.now(), strike && waiting && !reducedMotion.matches ? strike.start + STRIKE_MS : 0);
  playback = { shot, tracks, start, end, goneAt, pocket, shooter: game ? currentSeat(game) : -1 };
  waiting = false;
  called = null;
  noteEl.textContent = '';
  renderStatus();
}

function finishPlayback(p: Playback) {
  playback = null;
  strike = null;
  const { fouls } = p.shot.outcome;
  const who = seatName(p.shooter);
  noteEl.textContent = fouls.length ? `${who === 'You' ? 'You' : who} fouled: ${fouls.map((f) => FOUL_TEXT[f]).join(', ')}.` : '';
  setGame(p.shot.state);
}

function onRoom(v: RoomView) {
  const fresh = room?.code !== v.code;
  room = v;
  mode = v.mode;
  seat = v.seats.findIndex((p) => p?.id === playerId);
  // The server sends its deadline with its own clock reading, so skew between the clocks cancels out.
  deadline = v.clock ? Date.now() + (v.clock.deadline - v.clock.now) : null;
  if (!v.game) {
    if (fresh || game) resetTable();
    show('lobby');
    renderLobby(v, playerId, (i) => socket.emit('sit', { seat: i }));
    return;
  }
  show('game');
  // A state sent during playback describes the table after it, so it replaces what playback will end on.
  if (playback) playback.shot.state = v.game;
  else setGame(v.game);
  renderTeams(game, hudSeats(), seat);
}

socket.on('connect', () => {
  el('banner').hidden = true;
  const session = saved();
  if (session) socket.emit('resume', session);
});
socket.on('disconnect', () => {
  if (room) el('banner').hidden = false;
  waiting = false;
});
socket.on('joined', (j) => {
  playerId = j.playerId;
  save({ code: j.code, token: j.token });
  if (location.pathname !== `/r/${j.code}`) history.replaceState(null, '', `/r/${j.code}`);
});
socket.on('room', onRoom);
socket.on('shotResult', startPlayback);
socket.on('rejected', (reason) => {
  waiting = false;
  const target = !room ? 'menuNote' : room.game ? 'note' : 'lobbyNote';
  el(target).textContent = `Refused: ${reason}.`;
});
socket.on('left', (reason) => toMenu(reason.charAt(0).toUpperCase() + reason.slice(1) + '.'));

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
  renderClock(deadline === null || game?.phase === 'over' ? null : Math.min(SHOT_CLOCK_MS, deadline - Date.now()), SHOT_CLOCK_MS);
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || e.target === powerEl || el('game').hidden) return;
  if (e.key === 'ArrowLeft') angle += FINE_STEP;
  else if (e.key === 'ArrowRight') angle -= FINE_STEP;
});

// ---- menu and lobby ----

const radio = (name: string) => (document.querySelector(`input[name=${name}]:checked`) as HTMLInputElement).value;
const begin = () => {
  resetTable();
  el('menuNote').textContent = '';
};
el('playBot').addEventListener('click', () => {
  begin();
  socket.emit('playBot', { name: myName(), mode: radio('botMode') as Mode, difficulty: radio('difficulty') as 'easy' });
});
el('createRoom').addEventListener('click', () => {
  begin();
  socket.emit('createRoom', { name: myName(), mode: radio('roomMode') as Mode, format: radio('format') as RoomFormat });
});
const join = () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 6) return void (el('menuNote').textContent = 'Room codes have 6 characters.');
  begin();
  socket.emit('joinRoom', { name: myName(), code });
};
el('joinRoom').addEventListener('click', join);
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

el('readyBtn').addEventListener('click', () => {
  const me = room?.seats.find((p) => p?.id === playerId);
  socket.emit('ready', { ready: !me?.ready });
});
el('startBtn').addEventListener('click', () => socket.emit('start'));
el('leaveLobby').addEventListener('click', () => {
  socket.emit('leave');
  toMenu();
});
el('copyLink').addEventListener('click', async () => {
  const link = `${location.origin}/r/${room?.code}`;
  try {
    await navigator.clipboard.writeText(link);
    el('copyLink').textContent = 'Copied';
    setTimeout(() => (el('copyLink').textContent = 'Copy invite link'), 1500);
  } catch {
    el('lobbyNote').textContent = `Share this link: ${link}`;
  }
});

// Leaving mid-game gives the seat up, so it takes a second tap.
let leaveArmed = 0;
el('leaveGame').addEventListener('click', () => {
  if (game?.phase !== 'over' && !leaveArmed) {
    el('leaveGame').textContent = 'Tap again to leave';
    leaveArmed = window.setTimeout(() => {
      leaveArmed = 0;
      el('leaveGame').textContent = 'Leave';
    }, 3000);
    return;
  }
  clearTimeout(leaveArmed);
  leaveArmed = 0;
  el('leaveGame').textContent = 'Leave';
  socket.emit('leave');
  toMenu();
});
el('backToMenu').addEventListener('click', () => {
  socket.emit('leave');
  toMenu();
});

el('rerack').addEventListener('click', () => socket.emit('choose', { choice: 'rerack' }));
el('playOn').addEventListener('click', () => socket.emit('choose', { choice: 'playOn' }));

const relayout = () => {
  // A hidden screen measures 0 by 0; keep the last view until it shows again.
  if (canvas.clientWidth && canvas.clientHeight) view = layout(canvas);
};
new ResizeObserver(relayout).observe(canvas);
// Zooming or moving to another screen changes the pixel ratio without resizing the box.
const watchDpr = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
  relayout();
  watchDpr();
}, { once: true });
watchDpr();

try {
  nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
} catch {
  // see save()
}
// A shared link fills in the code; a tab that already holds a seat resumes it on connect instead.
const linked = /^\/r\/([A-Za-z0-9]{6})$/.exec(location.pathname);
if (linked && !saved()) codeInput.value = linked[1].toUpperCase();
if (!saved()) {
  show('menu');
  if (linked) (nameInput.value ? el('joinRoom') : nameInput).focus();
} else {
  el('menu').hidden = true;
}

// Dev builds only: lets a test driver read the table and aim. Production builds drop this block.
if (import.meta.env.DEV) {
  Object.assign(window, {
    chalkline: () => ({
      game, room, seat, angle, called, shooting: shooting(), mustCall: mustCall(), busy: !!playback || waiting,
      view: view && { rot: view.rot, ox: view.ox, oy: view.oy, scale: view.scale }, rect: canvas.getBoundingClientRect().toJSON(),
    }),
  });
}

setHit(0, 0);
requestAnimationFrame(frame);
