import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { currentSeat, type RoomView, type ShotBroadcast } from '@chalkline/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { parseCode, parseName, type RoomOptions } from './rooms';
import { createGameServer, originAllowed } from './server';

const FEEBLE = { angle: 0.02, power: 0.02, hitX: 0, hitY: 0 };
const SLOW = { clockMs: 60_000, graceMs: 60_000 };

interface Client {
  s: Socket;
  view: RoomView | null;
  joined: { code: string; token: string; playerId: string } | null;
  rejections: string[];
  left: string[];
}

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

async function serve(options: Partial<RoomOptions> = {}) {
  const server = createGameServer({ botMinWait: 0, botWaitRange: 0, ...options });
  await new Promise<void>((r) => server.http.listen(0, r));
  const url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
  cleanup.push(server.close);
  const client = async (): Promise<Client> => {
    const s = connect(url, { transports: ['websocket'], reconnection: false });
    const c: Client = { s, view: null, joined: null, rejections: [], left: [] };
    s.on('room', (v: RoomView) => (c.view = v));
    s.on('joined', (j) => (c.joined = j));
    s.on('rejected', (r: string) => c.rejections.push(r));
    s.on('left', (r: string) => c.left.push(r));
    cleanup.push(async () => void s.close());
    await new Promise<void>((r) => s.once('connect', () => r()));
    return c;
  };
  return { ...server, client };
}

/** Resolve on the first room view (current or future) that passes. */
function until(c: Client, pass: (v: RoomView) => boolean, ms = 3000): Promise<RoomView> {
  if (c.view && pass(c.view)) return Promise.resolve(c.view);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; last view ${JSON.stringify(c.view?.seats)}`)), ms);
    const on = (v: RoomView) => {
      if (!pass(v)) return;
      clearTimeout(timer);
      c.s.off('room', on);
      resolve(v);
    };
    c.s.on('room', on);
  });
}

function next<T>(c: Client, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), ms);
    c.s.once(event, (v: T) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

/** Host creates a room, everyone else joins and readies, the host starts. Clients come back in seat order. */
async function startedGame(server: Awaited<ReturnType<typeof serve>>, format: '1v1' | '1v2' | '2v2') {
  const n = { '1v1': 2, '1v2': 3, '2v2': 4 }[format];
  const host = await server.client();
  host.s.emit('createRoom', { name: 'Host', mode: 'assist', format });
  const { code } = await until(host, (v) => !!v.code);
  const players = [host];
  for (let i = 1; i < n; i++) {
    const c = await server.client();
    c.s.emit('joinRoom', { name: `P${i}`, code });
    await until(c, (v) => v.seats[i]?.name === `P${i}`);
    c.s.emit('ready', { ready: true });
    await until(host, (v) => !!v.seats[i]?.ready);
    players.push(c);
  }
  host.s.emit('start');
  await Promise.all(players.map((c) => until(c, (v) => v.game !== null)));
  return { code, players };
}

describe('input parsing', () => {
  it('cleans names and codes', () => {
    expect(parseName('  Ann  ')).toBe('Ann');
    expect(parseName('a'.repeat(40))).toHaveLength(20);
    expect(parseName('Bo\u0000b\n')).toBe('Bob');
    expect(parseName('<b>x</b>')).toBe('<b>x</b>'); // kept as text; the client renders names with textContent
    expect(parseName('   ')).toBeNull();
    expect(parseName(42)).toBeNull();
    expect(parseCode('abcdef')).toBe('ABCDEF');
    expect(parseCode('ABCDE')).toBeNull();
    expect(parseCode('ABCDE0')).toBeNull(); // 0 is not in the alphabet
    expect(parseCode({})).toBeNull();
  });

  it('checks the origin only when ALLOWED_ORIGIN is set', () => {
    const req = (origin?: string) => ({ headers: { origin } }) as never;
    expect(originAllowed(undefined, req('http://evil.test'))).toBe(true);
    expect(originAllowed('https://a.test, https://b.test', req('https://b.test'))).toBe(true);
    expect(originAllowed('https://a.test', req('https://evil.test'))).toBe(false);
    expect(originAllowed('https://a.test', req())).toBe(false);
  });
});

describe('rooms over real sockets', () => {
  it('creates, joins, refuses a full room and bad codes, and passes host on leave', async () => {
    const server = await serve(SLOW);
    const a = await server.client();
    a.s.emit('createRoom', { name: 'Ann', mode: 'hard', format: '1v1' });
    const created = await until(a, (v) => !!v.code);
    expect(created.seats.map((p) => p?.name ?? null)).toEqual(['Ann', null]);
    expect(created.hostId).toBe(a.joined!.playerId);
    expect(created.code).toMatch(/^[A-Z2-9]{6}$/);

    const b = await server.client();
    b.s.emit('joinRoom', { name: 'Ben', code: created.code.toLowerCase() });
    await until(a, (v) => v.seats[1]?.name === 'Ben');

    const c = await server.client();
    c.s.emit('joinRoom', { name: 'Cat', code: created.code });
    expect(await next(c, 'rejected')).toBe('room is full');
    c.s.emit('joinRoom', { name: 'Cat', code: 'ZZZZZZ' });
    expect(await next(c, 'rejected')).toBe('no such room');
    c.s.emit('joinRoom', { name: 'Cat', code: '<img>' });
    expect(await next(c, 'rejected')).toBe('bad code');
    c.s.emit('joinRoom', { name: '', code: created.code });
    expect(await next(c, 'rejected')).toBe('bad name');

    a.s.emit('leave');
    const after = await until(b, (v) => v.seats[0] === null);
    expect(after.hostId).toBe(b.joined!.playerId);
    b.s.emit('leave');
    await until(b, () => true);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.rooms.rooms.size).toBe(0);
  });

  it('only the host starts, only with every seat filled and ready; seats can be switched', async () => {
    const server = await serve(SLOW);
    const a = await server.client();
    a.s.emit('createRoom', { name: 'Ann', mode: 'assist', format: '2v2' });
    const { code } = await until(a, (v) => !!v.code);
    a.s.emit('start');
    expect(await next(a, 'rejected')).toBe('every seat must be filled');

    const others = [];
    for (const name of ['Ben', 'Cat', 'Dan']) {
      const c = await server.client();
      c.s.emit('joinRoom', { name, code });
      await until(a, (v) => v.seats.some((p) => p?.name === name));
      others.push(c);
    }
    const [ben] = others;
    ben.s.emit('start');
    expect(await next(ben, 'rejected')).toBe('only the host can start');
    a.s.emit('start');
    expect(await next(a, 'rejected')).toBe('everyone must be ready');

    // Free a seat, then move into it: Dan leaves seat 3, Ben moves from 1 to 3.
    others[2].s.emit('leave');
    await until(a, (v) => v.seats[3] === null);
    ben.s.emit('sit', { seat: 3 });
    const moved = await until(a, (v) => v.seats[3]?.name === 'Ben');
    expect(moved.seats[1]).toBeNull();
    expect(moved.seats[3]!.team).toBe(1);
    ben.s.emit('sit', { seat: 0 });
    expect(await next(ben, 'rejected')).toBe('seat taken');
    ben.s.emit('sit', { seat: 9 });
    expect(await next(ben, 'rejected')).toBe('bad seat');

    const dan = await server.client();
    dan.s.emit('joinRoom', { name: 'Dan', code });
    await until(a, (v) => v.seats[1]?.name === 'Dan');
    for (const c of [ben, others[1], dan]) c.s.emit('ready', { ready: true });
    await until(a, (v) => v.seats.every((p) => p && (p.ready || p.name === 'Ann')));
    a.s.emit('start');
    await until(a, (v) => v.game !== null);

    const late = await server.client();
    late.s.emit('joinRoom', { name: 'Eve', code });
    expect(await next(late, 'rejected')).toBe('game already started');
  });

  it('caps the number of rooms', async () => {
    const server = await serve({ ...SLOW, maxRooms: 1 });
    const a = await server.client();
    a.s.emit('createRoom', { name: 'Ann', mode: 'assist', format: '1v1' });
    await until(a, (v) => !!v.code);
    const b = await server.client();
    b.s.emit('createRoom', { name: 'Ben', mode: 'assist', format: '1v1' });
    expect(await next(b, 'rejected')).toMatch(/server is full/);
  });

  it('rejects junk and moves outside a game', async () => {
    const server = await serve(SLOW);
    const c = await server.client();
    c.s.emit('shot', FEEBLE);
    expect(await next(c, 'rejected')).toBe('no game');
    c.s.emit('ready', { ready: true });
    expect(await next(c, 'rejected')).toBe('not in a room');
    c.s.emit('playBot', { name: 'X', mode: 'cheat', difficulty: 'hard' });
    expect(await next(c, 'rejected')).toBe('bad game settings');
    c.s.emit('createRoom', { name: 'X', mode: 'hard', format: 'bot' });
    expect(await next(c, 'rejected')).toBe('bad room settings');
    c.s.emit('playBot', { name: 'X', mode: 'hard', difficulty: 'easy' });
    await until(c, (v) => v.game !== null);
    c.s.emit('shot', { angle: 'x', power: Infinity, positions: [] });
    expect(await next(c, 'rejected')).toBe('bad shot');
  });

  it('rate limits a flooding socket', async () => {
    const server = await serve(SLOW);
    const c = await server.client();
    for (let i = 0; i < 60; i++) c.s.emit('ready', { ready: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(c.rejections).toContain('too many messages, slow down');
  });

  it('refuses a shot out of turn and broadcasts a legal one to the whole room', async () => {
    const server = await serve(SLOW);
    const { players: [a, b] } = await startedGame(server, '1v1');
    expect(currentSeat(a.view!.game!)).toBe(0);
    b.s.emit('shot', FEEBLE);
    expect(await next(b, 'rejected')).toBe('not your turn');
    const both = Promise.all([next<ShotBroadcast>(a, 'shotResult'), next<ShotBroadcast>(b, 'shotResult')]);
    a.s.emit('shot', FEEBLE);
    const [ra, rb] = await both;
    expect(ra.frames.length).toBeGreaterThan(0);
    expect(rb.state).toEqual(ra.state);
    expect(a.view!.clock!.deadline).toBeGreaterThan(a.view!.clock!.now);
  });

  it.each([
    ['1v1', [0, 1, 0, 1, 0]],
    ['1v2', [0, 1, 0, 2, 0]],
    ['2v2', [0, 1, 2, 3, 0]],
  ] as const)('%s rotates turns through the shot clock', async (format, order) => {
    const server = await serve({ clockMs: 120, graceMs: 60_000 });
    const { players } = await startedGame(server, format);
    const seen: number[] = [currentSeat(players[0].view!.game!)];
    await new Promise<void>((resolve) => {
      players[0].s.on('room', (v: RoomView) => {
        seen.push(currentSeat(v.game!));
        if (seen.length === order.length) resolve();
      });
    });
    expect(seen).toEqual(order);
    // Every client sees the same turn.
    for (const c of players) await until(c, (v) => currentSeat(v.game!) === currentSeat(players[0].view!.game!));
  });

  it('takes a seat back with the token inside the grace period, and the game goes on', async () => {
    const server = await serve({ clockMs: 60_000, graceMs: 400 });
    const { code, players: [a, b] } = await startedGame(server, '1v1');
    const token = b.joined!.token;
    b.s.close();
    await until(a, (v) => v.seats[1]!.connected === false);
    const back = await server.client();
    back.s.emit('resume', { code, token });
    const view = await until(back, (v) => v.seats[1]?.connected === true);
    expect(back.joined!.playerId).toBe(b.joined!.playerId);
    expect(view.game).not.toBeNull();
    await new Promise((r) => setTimeout(r, 500));
    expect(a.view!.game!.phase).not.toBe('over');
    expect(a.view!.seats[1]!.gone).toBe(false);

    const stranger = await server.client();
    stranger.s.emit('resume', { code, token: 'not-a-token' });
    expect(await next(stranger, 'left')).toBe('that game has ended');
  });

  it('lets a teammate cover a gone player, but not an opponent', async () => {
    const server = await serve({ clockMs: 500, graceMs: 100 });
    const { players } = await startedGame(server, '2v2');
    players[1].s.close();
    await until(players[0], (v) => v.seats[1]!.gone);
    await until(players[3], (v) => currentSeat(v.game!) === 1, 2000);
    players[2].s.emit('shot', FEEBLE);
    expect(await next(players[2], 'rejected')).toBe('not your turn');
    const result = next<ShotBroadcast>(players[0], 'shotResult');
    players[3].s.emit('shot', FEEBLE);
    expect((await result).frames.length).toBeGreaterThan(0);
  });

  it('forfeits a team once nobody on it is left', async () => {
    const server = await serve({ clockMs: 60_000, graceMs: 100 });
    const one = await startedGame(server, '1v1');
    one.players[1].s.close();
    const over = await until(one.players[0], (v) => v.game!.phase === 'over');
    expect(over.game).toMatchObject({ winner: 0, endReason: 'forfeit' });

    // 2v2: one gone player isn't enough; the second is.
    const two = await startedGame(server, '2v2');
    two.players[0].s.emit('leave');
    await until(two.players[1], (v) => v.seats[0]!.gone);
    expect(two.players[1].view!.game!.phase).not.toBe('over');
    two.players[2].s.close();
    const lost = await until(two.players[1], (v) => v.game!.phase === 'over');
    expect(lost.game).toMatchObject({ winner: 1, endReason: 'forfeit' });

    // 1v2: the solo player leaving forfeits at once.
    const solo = await startedGame(server, '1v2');
    solo.players[0].s.emit('leave');
    expect((await until(solo.players[2], (v) => v.game!.phase === 'over')).game!.winner).toBe(1);
  });

  it('deletes finished and empty rooms when their time is up', async () => {
    const server = await serve({ clockMs: 60_000, graceMs: 50, emptyMs: 1000, finishedMs: 5000 });
    const { code, players: [a, b] } = await startedGame(server, '1v1');
    b.s.close();
    await until(a, (v) => v.game!.phase === 'over');
    const now = Date.now();
    server.rooms.sweep(now + 4000);
    expect(server.rooms.rooms.has(code)).toBe(true);
    const closed = next<string>(a, 'left');
    server.rooms.sweep(now + 5000);
    expect(server.rooms.rooms.has(code)).toBe(false);
    expect(await closed).toBe('the room has closed');

    // A bot game whose only human disappears.
    const c = await server.client();
    c.s.emit('playBot', { name: 'Cy', mode: 'assist', difficulty: 'easy' });
    const bot = await until(c, (v) => v.game !== null);
    c.s.close();
    await new Promise((r) => setTimeout(r, 30));
    const t = Date.now();
    server.rooms.sweep(t);
    expect(server.rooms.rooms.has(bot.code)).toBe(true);
    server.rooms.sweep(t + 1000);
    expect(server.rooms.rooms.has(bot.code)).toBe(false);

    // A lobby whose only player's grace runs out is deleted straight away.
    const d = await server.client();
    d.s.emit('createRoom', { name: 'Di', mode: 'assist', format: '1v1' });
    const lobby = await until(d, (v) => !!v.code);
    d.s.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(server.rooms.rooms.has(lobby.code)).toBe(false);
  });

  it('plays a human shot, then the bot answers through the same path', async () => {
    const server = await serve(SLOW);
    const c = await server.client();
    c.s.emit('playBot', { name: 'Ann', mode: 'assist', difficulty: 'medium' });
    const start = await until(c, (v) => v.game !== null);
    expect(start.seats[1]).toMatchObject({ bot: true, connected: true });
    // A feeble break is illegal, so the bot has to choose and then shoot.
    const first = next<ShotBroadcast>(c, 'shotResult');
    c.s.emit('shot', FEEBLE);
    const r = await first;
    expect(r.state.phase).toBe('breakChoice');
    expect(currentSeat(r.state)).toBe(1);
    c.s.emit('shot', FEEBLE);
    expect(await next(c, 'rejected')).toMatch(/not your turn/);
    const reply = await next<ShotBroadcast>(c, 'shotResult', 20000);
    expect(reply.frames.length).toBeGreaterThan(0);
  }, 30000);
});
