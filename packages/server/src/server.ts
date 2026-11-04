import { createServer } from 'node:http';
import { currentSeat, type Difficulty, type GameState, type Mode, type RoomView } from '@chalkline/shared';
import { Server, type Socket } from 'socket.io';
import { chooseAfterBreak, chooseMove } from './bot';
import { Match } from './match';

const HUMAN_SEAT = 0;
const BOT_SEAT = 1;
const BOT_MIN_WAIT = 1000;
const BOT_WAIT_RANGE = 1000;

interface BotRoom { match: Match; mode: Mode; difficulty: Difficulty; timer?: NodeJS.Timeout }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseStart(raw: unknown): { mode: Mode; difficulty: Difficulty } | null {
  if (!isRecord(raw)) return null;
  const { mode, difficulty } = raw;
  if (mode !== 'assist' && mode !== 'hard') return null;
  if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') return null;
  return { mode, difficulty };
}

// shortcut: one bot game per socket, with no rooms or codes yet. Milestone 6 adds rooms around Match.
function serveSocket(socket: Socket) {
  let room: BotRoom | null = null;

  const view = (game: GameState, mode: Mode): RoomView => ({ game, mode, seat: HUMAN_SEAT });
  const sendState = (r: BotRoom) => socket.emit('state', view(r.match.state, r.mode));

  function scheduleBot(r: BotRoom) {
    clearTimeout(r.timer);
    const s = r.match.state;
    if (s.phase === 'over' || currentSeat(s) !== BOT_SEAT) return;
    const wait = Math.max(0, r.match.busyUntil - Date.now()) + BOT_MIN_WAIT + Math.random() * BOT_WAIT_RANGE;
    r.timer = setTimeout(() => botTurn(r), wait);
  }

  function botTurn(r: BotRoom) {
    const { match } = r;
    const now = Date.now();
    if (match.state.phase === 'breakChoice') {
      match.choose(BOT_SEAT, { choice: chooseAfterBreak(match.state) }, now);
      sendState(r);
      scheduleBot(r);
      return;
    }
    const move = chooseMove(match.state, r.difficulty);
    if (move.place) match.place(BOT_SEAT, move.place, now);
    if (move.called !== null) match.call(BOT_SEAT, { pocket: move.called }, now);
    if (move.place) sendState(r);
    const result = match.shoot(BOT_SEAT, move.shot, now);
    if (typeof result === 'string') {
      console.error('bot move refused:', result);
      match.expire();
      sendState(r);
    } else {
      socket.emit('shotResult', result);
    }
    scheduleBot(r);
  }

  /** Run a human move. A refusal resends state, so a client that drew something optimistically snaps back. */
  function humanMove(refusal: (r: BotRoom) => string | null) {
    if (!room) return socket.emit('rejected', 'no game');
    const reason = refusal(room);
    if (reason) {
      socket.emit('rejected', reason);
      sendState(room);
      return;
    }
    sendState(room);
    scheduleBot(room);
  }

  socket.on('startBot', (raw: unknown) => {
    const start = parseStart(raw);
    if (!start) return socket.emit('rejected', 'bad game settings');
    if (room) clearTimeout(room.timer);
    room = { match: new Match('bot'), ...start };
    sendState(room);
  });
  socket.on('place', (raw: unknown) => humanMove((r) => r.match.place(HUMAN_SEAT, raw, Date.now())));
  socket.on('call', (raw: unknown) => humanMove((r) => r.match.call(HUMAN_SEAT, raw, Date.now())));
  socket.on('choose', (raw: unknown) => humanMove((r) => r.match.choose(HUMAN_SEAT, raw, Date.now())));
  socket.on('shot', (raw: unknown) => {
    if (!room) return socket.emit('rejected', 'no game');
    const result = room.match.shoot(HUMAN_SEAT, raw, Date.now());
    if (typeof result === 'string') {
      socket.emit('rejected', result);
      sendState(room);
      return;
    }
    socket.emit('shotResult', result);
    scheduleBot(room);
  });
  socket.on('disconnect', () => {
    if (room) clearTimeout(room.timer);
    room = null;
  });
}

export function createGameServer() {
  const http = createServer();
  const io = new Server(http);
  io.on('connection', serveSocket);
  return { http, io };
}
