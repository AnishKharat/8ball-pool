import { randomInt, randomUUID } from 'node:crypto';
import {
  CODE_ALPHABET, CODE_LENGTH, currentSeat, forfeit, mayAct, NAME_MAX, RECONNECT_GRACE_MS, seatTeams, SHOT_CLOCK_MS,
  type Difficulty, type Format, type Mode, type RoomFormat, type RoomView,
} from '@chalkline/shared';
import type { Server, Socket } from 'socket.io';
import { chooseAfterBreak, chooseMove } from './bot';
import { Match } from './match';

export interface RoomOptions {
  clockMs: number;
  graceMs: number;
  /** A room with no connected human is deleted after this long. */
  emptyMs: number;
  /** A finished game's room is deleted after this long. */
  finishedMs: number;
  maxRooms: number;
  botMinWait: number;
  botWaitRange: number;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  clockMs: SHOT_CLOCK_MS,
  graceMs: RECONNECT_GRACE_MS,
  emptyMs: RECONNECT_GRACE_MS,
  finishedMs: 5 * 60_000,
  maxRooms: 500,
  botMinWait: 1000,
  botWaitRange: 1000,
};

interface Player {
  id: string;
  name: string;
  token: string;
  socketId: string | null;
  ready: boolean;
  bot: boolean;
  gone: boolean;
  grace?: NodeJS.Timeout;
}

interface Room {
  code: string;
  format: Format;
  mode: Mode;
  difficulty: Difficulty | null;
  seats: (Player | null)[];
  teams: readonly number[];
  hostId: string | null;
  match: Match | null;
  deadline: number | null;
  clockTimer?: NodeJS.Timeout;
  botTimer?: NodeJS.Timeout;
  emptySince: number | null;
  overAt: number | null;
}

interface SocketData { code?: string; playerId?: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isMode = (v: unknown): v is Mode => v === 'assist' || v === 'hard';
const isDifficulty = (v: unknown): v is Difficulty => v === 'easy' || v === 'medium' || v === 'hard';
const isRoomFormat = (v: unknown): v is RoomFormat => v === '1v1' || v === '1v2' || v === '2v2';
const connected = (p: Player) => p.bot || p.socketId !== null;

/** Printable, trimmed, at most NAME_MAX characters. Clients render names as text, never HTML. */
export function parseName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.replace(/[\p{C}]/gu, '').trim().slice(0, NAME_MAX).trim();
  return name || null;
}

export function parseCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(private io: Server, private opt: RoomOptions = DEFAULT_ROOM_OPTIONS) {}

  // ---- entering and leaving ----

  playBot(socket: Socket, raw: unknown) {
    if (!isRecord(raw) || !isMode(raw.mode) || !isDifficulty(raw.difficulty)) return this.reject(socket, 'bad game settings');
    const name = parseName(raw.name);
    if (!name) return this.reject(socket, 'bad name');
    const room = this.newRoom(socket, 'bot', raw.mode, raw.difficulty);
    if (!room) return;
    const player = this.newPlayer(name);
    room.seats[0] = player;
    room.seats[1] = { ...this.newPlayer('Bot'), bot: true, ready: true };
    room.hostId = player.id;
    this.attach(socket, room, player);
    this.startMatch(room);
  }

  createRoom(socket: Socket, raw: unknown) {
    if (!isRecord(raw) || !isMode(raw.mode) || !isRoomFormat(raw.format)) return this.reject(socket, 'bad room settings');
    const name = parseName(raw.name);
    if (!name) return this.reject(socket, 'bad name');
    const room = this.newRoom(socket, raw.format, raw.mode, null);
    if (!room) return;
    const player = this.newPlayer(name);
    room.seats[0] = player;
    room.hostId = player.id;
    this.attach(socket, room, player);
    this.broadcast(room);
  }

  joinRoom(socket: Socket, raw: unknown) {
    if (!isRecord(raw)) return this.reject(socket, 'bad request');
    const code = parseCode(raw.code);
    if (!code) return this.reject(socket, 'bad code');
    const name = parseName(raw.name);
    if (!name) return this.reject(socket, 'bad name');
    const room = this.rooms.get(code);
    if (!room) return this.reject(socket, 'no such room');
    if (room.match) return this.reject(socket, 'game already started');
    const seat = room.seats.indexOf(null);
    if (seat === -1) return this.reject(socket, 'room is full');
    this.leave(socket);
    const player = this.newPlayer(name);
    room.seats[seat] = player;
    this.attach(socket, room, player);
    this.broadcast(room);
  }

  /** Take back a seat with its token, within the grace period or after it. */
  resume(socket: Socket, raw: unknown) {
    const code = isRecord(raw) ? parseCode(raw.code) : null;
    const token = isRecord(raw) && typeof raw.token === 'string' ? raw.token : null;
    const room = code ? this.rooms.get(code) : undefined;
    const player = room?.seats.find((p) => p && !p.bot && p.token === token);
    if (!room || !player) return void socket.emit('left', 'that game has ended');
    if (this.data(socket).playerId !== player.id) this.leave(socket);
    // A second tab with the same token takes the seat over.
    if (player.socketId && player.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(player.socketId);
      if (old) {
        old.leave(room.code);
        old.data = {};
        old.emit('left', 'opened in another tab');
      }
    }
    clearTimeout(player.grace);
    player.gone = false;
    this.attach(socket, room, player);
    this.broadcast(room);
  }

  /** Leaving a lobby frees the seat; leaving a game gives it up at once, as if the grace period ran out. */
  leave(socket: Socket) {
    const found = this.find(socket);
    socket.data = {};
    if (!found) return;
    const { room, player } = found;
    socket.leave(room.code);
    player.socketId = null;
    this.giveUp(room, player);
  }

  disconnect(socket: Socket) {
    const found = this.find(socket);
    if (!found || found.player.socketId !== socket.id) return;
    const { room, player } = found;
    player.socketId = null;
    player.grace = setTimeout(() => this.giveUp(room, player), this.opt.graceMs);
    this.broadcast(room);
  }

  private giveUp(room: Room, player: Player) {
    clearTimeout(player.grace);
    if (!this.rooms.has(room.code)) return;
    if (!room.match) {
      room.seats[room.seats.indexOf(player)] = null;
      if (room.hostId === player.id) room.hostId = room.seats.find((p) => p && !p.bot)?.id ?? null;
      if (!room.hostId) return this.delete(room);
      for (const p of room.seats) if (p) p.ready = false;
      return this.broadcast(room);
    }
    player.gone = true;
    const team = room.teams[room.seats.indexOf(player)];
    if (room.seats.every((p, i) => room.teams[i] !== team || p!.gone)) {
      room.match.state = forfeit(room.match.state, team);
    }
    this.afterTurn(room);
  }

  // ---- lobby ----

  sit(socket: Socket, raw: unknown) {
    const found = this.lobby(socket);
    if (!found) return;
    const { room, player } = found;
    const seat = isRecord(raw) ? raw.seat : null;
    if (!Number.isInteger(seat) || (seat as number) < 0 || (seat as number) >= room.seats.length) return this.reject(socket, 'bad seat');
    if (room.seats[seat as number]) return this.reject(socket, 'seat taken');
    room.seats[room.seats.indexOf(player)] = null;
    room.seats[seat as number] = player;
    player.ready = false;
    this.broadcast(room);
  }

  ready(socket: Socket, raw: unknown) {
    const found = this.lobby(socket);
    if (!found) return;
    if (!isRecord(raw) || typeof raw.ready !== 'boolean') return this.reject(socket, 'bad request');
    found.player.ready = raw.ready;
    this.broadcast(found.room);
  }

  start(socket: Socket) {
    const found = this.lobby(socket);
    if (!found) return;
    const { room, player } = found;
    if (room.hostId !== player.id) return this.reject(socket, 'only the host can start');
    if (room.seats.some((p) => !p)) return this.reject(socket, 'every seat must be filled');
    if (room.seats.some((p) => p!.id !== player.id && !p!.ready)) return this.reject(socket, 'everyone must be ready');
    this.startMatch(room);
  }

  // ---- play ----

  /** A game move from a human. The bot calls Match directly with its own seat. */
  move(socket: Socket, kind: 'shot' | 'place' | 'call' | 'choose', raw: unknown) {
    const found = this.find(socket);
    if (!found?.room.match) return this.reject(socket, 'no game');
    const { room, player } = found;
    const match = room.match!;
    const seats = this.view(room).seats;
    const own = room.seats.indexOf(player);
    if (!mayAct(match.state, seats, own)) return this.refuse(socket, room, 'not your turn');
    const seat = currentSeat(match.state);
    const now = Date.now();
    if (kind === 'shot') {
      const result = match.shoot(seat, raw, now);
      if (typeof result === 'string') return this.refuse(socket, room, result);
      this.io.to(room.code).emit('shotResult', result);
      return this.afterTurn(room);
    }
    const reason = kind === 'place' ? match.place(seat, raw, now) : kind === 'call' ? match.call(seat, raw, now) : match.choose(seat, raw, now);
    if (reason) return this.refuse(socket, room, reason);
    if (kind === 'choose') this.afterTurn(room);
    else this.broadcast(room);
  }

  // ---- housekeeping ----

  /** Delete rooms nobody is in and finished rooms, once their time is up. Run periodically. */
  sweep(now: number) {
    for (const room of this.rooms.values()) {
      const anyone = room.seats.some((p) => p && !p.bot && p.socketId);
      if (anyone) room.emptySince = null;
      else room.emptySince ??= now;
      if (room.emptySince !== null && now - room.emptySince >= this.opt.emptyMs) this.delete(room);
      else if (room.overAt !== null && now - room.overAt >= this.opt.finishedMs) this.delete(room);
    }
  }

  /** Stop every timer, for shutdown and tests. */
  close() {
    for (const room of [...this.rooms.values()]) this.delete(room);
  }

  // ---- internals ----

  private reject(socket: Socket, reason: string) {
    socket.emit('rejected', reason);
  }

  /** A refused move resends the room, so a client that drew something optimistically snaps back. */
  private refuse(socket: Socket, room: Room, reason: string) {
    socket.emit('rejected', reason);
    socket.emit('room', this.view(room));
  }

  private data(socket: Socket): SocketData {
    return socket.data as SocketData;
  }

  private find(socket: Socket): { room: Room; player: Player } | null {
    const { code, playerId } = this.data(socket);
    const room = code ? this.rooms.get(code) : undefined;
    const player = room?.seats.find((p) => p?.id === playerId);
    return room && player ? { room, player } : null;
  }

  private lobby(socket: Socket) {
    const found = this.find(socket);
    if (!found) return void this.reject(socket, 'not in a room');
    if (found.room.match) return void this.reject(socket, 'game already started');
    return found;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private newRoom(socket: Socket, format: Format, mode: Mode, difficulty: Difficulty | null): Room | null {
    this.leave(socket);
    if (this.rooms.size >= this.opt.maxRooms) {
      this.reject(socket, 'the server is full, try again soon');
      return null;
    }
    const teams = seatTeams(format);
    const room: Room = {
      code: this.newCode(), format, mode, difficulty, teams, seats: teams.map(() => null), hostId: null,
      match: null, deadline: null, emptySince: null, overAt: null,
    };
    this.rooms.set(room.code, room);
    return room;
  }

  private newPlayer(name: string): Player {
    return { id: randomUUID(), name, token: randomUUID(), socketId: null, ready: false, bot: false, gone: false };
  }

  private attach(socket: Socket, room: Room, player: Player) {
    player.socketId = socket.id;
    socket.data = { code: room.code, playerId: player.id } satisfies SocketData;
    socket.join(room.code);
    socket.emit('joined', { code: room.code, token: player.token, playerId: player.id });
  }

  private startMatch(room: Room) {
    room.match = new Match(room.format);
    this.afterTurn(room);
  }

  /** A new turn may have begun: restart the shot clock, wake the bot, and tell everyone. */
  private afterTurn(room: Room) {
    clearTimeout(room.clockTimer);
    clearTimeout(room.botTimer);
    const match = room.match!;
    if (match.state.phase === 'over') {
      room.deadline = null;
      room.overAt ??= Date.now();
      return this.broadcast(room);
    }
    room.deadline = Math.max(Date.now(), match.busyUntil) + this.opt.clockMs;
    room.clockTimer = setTimeout(() => {
      match.expire();
      this.afterTurn(room);
    }, room.deadline - Date.now());
    const up = room.seats[currentSeat(match.state)];
    if (up?.bot) {
      const wait = Math.max(0, match.busyUntil - Date.now()) + this.opt.botMinWait + Math.random() * this.opt.botWaitRange;
      room.botTimer = setTimeout(() => this.botTurn(room), wait);
    }
    this.broadcast(room);
  }

  private botTurn(room: Room) {
    const match = room.match!;
    const seat = currentSeat(match.state);
    const now = Date.now();
    if (match.state.phase === 'breakChoice') {
      match.choose(seat, { choice: chooseAfterBreak(match.state) }, now);
      return this.afterTurn(room);
    }
    const move = chooseMove(match.state, room.difficulty ?? 'medium');
    if (move.place) match.place(seat, move.place, now);
    if (move.called !== null) match.call(seat, { pocket: move.called }, now);
    if (move.place) this.broadcast(room);
    const result = match.shoot(seat, move.shot, now);
    if (typeof result === 'string') {
      console.error('bot move refused:', result);
      match.expire();
    } else {
      this.io.to(room.code).emit('shotResult', result);
    }
    this.afterTurn(room);
  }

  private view(room: Room): RoomView {
    return {
      code: room.code,
      format: room.format,
      mode: room.mode,
      difficulty: room.difficulty,
      hostId: room.hostId,
      seats: room.seats.map((p, i) => p && {
        id: p.id, name: p.name, team: room.teams[i], connected: connected(p), gone: p.gone, ready: p.ready, bot: p.bot,
      }),
      teams: room.teams,
      game: room.match?.state ?? null,
      clock: room.deadline === null ? null : { deadline: room.deadline, now: Date.now() },
    };
  }

  private broadcast(room: Room) {
    if (this.rooms.has(room.code)) this.io.to(room.code).emit('room', this.view(room));
  }

  private delete(room: Room) {
    clearTimeout(room.clockTimer);
    clearTimeout(room.botTimer);
    this.rooms.delete(room.code);
    for (const p of room.seats) {
      if (!p) continue;
      clearTimeout(p.grace);
      const socket = p.socketId ? this.io.sockets.sockets.get(p.socketId) : undefined;
      if (socket) {
        socket.leave(room.code);
        socket.data = {};
        socket.emit('left', 'the room has closed');
      }
    }
  }
}
