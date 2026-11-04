import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BALL_R, currentSeat, simulateShot, type GameState, type RoomView, type ShotBroadcast } from '@chalkline/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { chooseAfterBreak, chooseMove, listCandidates } from './bot';
import { Match, parseShot } from './match';
import { createGameServer } from './server';

const good = { angle: 0, power: 0.5, hitX: 0, hitY: 0 };

function table(balls: { id: number; x: number; y: number }[], extra: Partial<GameState> = {}): GameState {
  return { ...new Match('bot').state, phase: 'play', balls, solidsTeam: 0, ballInHand: false, ...extra };
}

describe('shot validation', () => {
  it('accepts a legal shot', () => {
    expect(parseShot(good)).toEqual(good);
    expect(parseShot({ ...good, hitX: 0.3, hitY: 0.4 })).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['a string', 'shot'],
    ['missing field', { angle: 0, power: 0.5, hitX: 0 }],
    ['string number', { ...good, power: '0.5' }],
    ['NaN', { ...good, angle: NaN }],
    ['Infinity', { ...good, angle: Infinity }],
    ['zero power', { ...good, power: 0 }],
    ['too much power', { ...good, power: 1.01 }],
    ['negative power', { ...good, power: -0.5 }],
    ['angle out of range', { ...good, angle: 7 }],
    ['past the miscue limit', { ...good, hitX: 0.4, hitY: 0.4 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseShot(raw)).toBeNull();
  });

  it('drops anything but the four intent fields', () => {
    expect(parseShot({ ...good, balls: [], winner: 0 })).toEqual(good);
  });
});

describe('match authority', () => {
  it('refuses out-of-turn moves and bad payloads, leaving state alone', () => {
    const m = new Match('1v1');
    const before = m.state;
    expect(m.shoot(1, good, 0)).toBe('not your turn');
    expect(m.place(1, { x: -0.8, y: 0 }, 0)).toBe('not your turn');
    expect(m.place(0, { x: 'a', y: 0 }, 0)).toBe('bad placement');
    expect(m.place(0, { x: 1, y: 0 }, 0)).toBe('illegal placement');
    expect(m.shoot(0, { ...good, power: 2 }, 0)).toBe('bad shot');
    expect(m.state).toBe(before);
  });

  it('refuses moves in the wrong phase and during playback', () => {
    const m = new Match('1v1');
    expect(m.choose(0, { choice: 'rerack' }, 0)).toBe('not allowed now');
    expect(m.call(0, { pocket: 1 }, 0)).toBe('not allowed now');
    const r = m.shoot(0, { angle: 0, power: 0.1, hitX: 0, hitY: 0 }, 0);
    expect(typeof r).toBe('object');
    expect(m.shoot(currentSeat(m.state), good, m.busyUntil - 1)).toBe('shot still playing');
  });

  it('requires a called pocket on the 8, and only then', () => {
    const m = new Match('1v1');
    m.state = table([{ id: 0, x: 0, y: 0 }, { id: 8, x: 0.5, y: 0 }, { id: 9, x: -1, y: 0.4 }]);
    expect(m.call(0, { pocket: 9 }, 0)).toBe('bad pocket');
    expect(m.call(0, { pocket: 1.5 }, 0)).toBe('bad pocket');
    expect(m.shoot(0, good, 0)).toBe('call a pocket first');
    expect(m.call(0, { pocket: 2 }, 0)).toBeNull();
    expect(typeof m.shoot(0, good, 0)).toBe('object');
    expect(m.called).toBeNull();

    const n = new Match('1v1');
    n.state = table([{ id: 0, x: 0, y: 0 }, { id: 1, x: 0.5, y: 0 }, { id: 8, x: -1, y: 0.4 }]);
    expect(n.call(0, { pocket: 2 }, 0)).toBe('not on the 8');
  });
});

describe('bot', () => {
  const straight = [{ id: 0, x: 0, y: -0.2 }, { id: 1, x: 0, y: 0.2 }, { id: 8, x: 1, y: 0 }, { id: 9, x: -1, y: 0 }];

  it('finds a straight pot and makes it, with no noise', () => {
    const s = table(straight);
    const move = chooseMove(s, 'hard', () => 0.5);
    const r = simulateShot(s.balls, move.shot);
    expect(r.events.some((e) => e.type === 'pot' && e.a === 1)).toBe(true);
  });

  it('filters blocked lines', () => {
    const open = listCandidates(table(straight)).filter((c) => c.pocket === 4);
    expect(open).toHaveLength(1);
    const blockedToBall = [...straight, { id: 2, x: 0.005, y: 0 }];
    expect(listCandidates(table(blockedToBall)).filter((c) => c.pocket === 4)).toHaveLength(0);
    const blockedToPocket = [...straight, { id: 10, x: 0, y: 0.45 }];
    expect(listCandidates(table(blockedToPocket)).filter((c) => c.pocket === 4)).toHaveLength(0);
  });

  it('only aims at its own group, and at the 8 once cleared', () => {
    const own = listCandidates(table([{ id: 0, x: 0, y: 0 }, { id: 9, x: 0.5, y: 0.3 }, { id: 8, x: -0.6, y: 0.3 }, { id: 1, x: 0.4, y: -0.3 }]));
    expect(own.length).toBeGreaterThan(0);
    // Solid 1 lies below the cue ball and stripe 9 above, so every aim at the solid points downward.
    expect(own.every((c) => c.angle < 0)).toBe(true);
    const eight = table([{ id: 0, x: 0, y: -0.2 }, { id: 8, x: 0, y: 0.2 }, { id: 9, x: 1, y: 0 }]);
    const move = chooseMove(eight, 'hard', () => 0.5);
    expect(move.called).toBe(4);
  });

  it('calls a pocket on the 8 even with no line to one', () => {
    const wall = [-3, -2, -1, 0, 1, 2, 3].map((i) => ({ id: 9 + i + 3, x: 0.2, y: i * 2.2 * BALL_R }));
    const s = table([{ id: 0, x: -0.2, y: 0 }, { id: 8, x: 0.5, y: 0 }, ...wall]);
    expect(chooseMove(s, 'hard', () => 0.5).called).not.toBeNull();
  });

  it('uses ball in hand to set up a legal placement', () => {
    const s = table([{ id: 0, x: -1, y: 0.5 }, { id: 1, x: 0.3, y: 0.2 }, { id: 8, x: 1, y: 0 }, { id: 9, x: -1, y: 0 }], { ballInHand: true });
    const move = chooseMove(s, 'hard', () => 0.5);
    expect(move.place).toBeDefined();
    const m = new Match('bot');
    m.state = { ...s, turn: 1 };
    expect(m.place(1, move.place, 0)).toBeNull();
  });

  it('more difficulty pots more of a long cut', () => {
    const rate = (d: 'easy' | 'hard') => {
      const s = table([{ id: 0, x: -0.9, y: -0.3 }, { id: 1, x: 0.8, y: 0.3 }, { id: 8, x: 0, y: -0.5 }, { id: 9, x: -1, y: 0.5 }]);
      let pots = 0;
      for (let i = 0; i < 40; i++) {
        const r = simulateShot(s.balls, chooseMove(s, d).shot);
        if (r.events.some((e) => e.type === 'pot' && e.a === 1)) pots++;
      }
      return pots;
    };
    const hard = rate('hard');
    const easy = rate('easy');
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(20);
  }, 60000);

  it('always produces a shot the server accepts', () => {
    const m = new Match('bot');
    m.state = { ...m.state, turn: 1 };
    const move = chooseMove(m.state, 'easy');
    expect(parseShot(move.shot)).not.toBeNull();
  });

  it('chooses play on with a shot available, re-rack without one', () => {
    expect(chooseAfterBreak(table(straight, { solidsTeam: null }))).toBe('playOn');
    const none = table([{ id: 0, x: 0, y: 0 }, { id: 8, x: 0.1, y: 0 }], { solidsTeam: null });
    expect(chooseAfterBreak({ ...none, balls: [none.balls[0], { id: 1, x: 2 * BALL_R, y: 0 }, { id: 2, x: -2 * BALL_R, y: 0 }, { id: 3, x: 0, y: 2 * BALL_R }, { id: 4, x: 0, y: -2 * BALL_R }] })).toBe('rerack');
  });

  it.each(['easy', 'hard'] as const)('%s bots finish a whole game through the validated path', (difficulty) => {
    const m = new Match('1v1');
    let now = 0;
    let shots = 0;
    while (m.state.phase !== 'over' && shots < 400) {
      const seat = currentSeat(m.state);
      if (m.state.phase === 'breakChoice') {
        expect(m.choose(seat, { choice: chooseAfterBreak(m.state) }, now)).toBeNull();
        continue;
      }
      const move = chooseMove(m.state, difficulty);
      if (move.place) expect(m.place(seat, move.place, now)).toBeNull();
      if (move.called !== null) expect(m.call(seat, { pocket: move.called }, now)).toBeNull();
      const r = m.shoot(seat, move.shot, now);
      if (typeof r === 'string') throw new Error(r);
      now = m.busyUntil;
      shots++;
    }
    expect(m.state.phase).toBe('over');
    expect(m.state.winner).not.toBeNull();
  }, 120000);
});

describe('over a real socket', () => {
  const { http, io } = createGameServer();
  let url = '';
  const open: Socket[] = [];

  beforeAll(async () => {
    await new Promise<void>((r) => http.listen(0, r));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    open.forEach((s) => s.close());
    await io.close();
  });

  const client = () => {
    const s = connect(url);
    open.push(s);
    return s;
  };
  const once = <T,>(s: Socket, event: string) => new Promise<T>((r) => s.once(event, r));

  it('rejects junk without crashing, before and after a game starts', async () => {
    const s = client();
    for (const [event, raw] of [['shot', good], ['place', null], ['call', 5], ['choose', {}]] as const) {
      const no = once<string>(s, 'rejected');
      s.emit(event, raw);
      expect(await no).toBe('no game');
    }
    const bad = once<string>(s, 'rejected');
    s.emit('startBot', { mode: 'cheat', difficulty: 'hard' });
    expect(await bad).toBe('bad game settings');
    const started = once<RoomView>(s, 'state');
    s.emit('startBot', { mode: 'hard', difficulty: 'easy' });
    expect((await started).mode).toBe('hard');
    const junk = once<string>(s, 'rejected');
    s.emit('shot', { angle: 'x', power: Infinity, positions: [] });
    expect(await junk).toBe('bad shot');
  });

  it('plays a human shot, then the bot answers through the same path', async () => {
    const s = client();
    const started = once<RoomView>(s, 'state');
    s.emit('startBot', { mode: 'assist', difficulty: 'medium' });
    expect((await started).seat).toBe(0);

    // A feeble break is illegal, so the bot has to choose and then shoot.
    const first = once<ShotBroadcast>(s, 'shotResult');
    s.emit('shot', { angle: 0.02, power: 0.02, hitX: 0, hitY: 0 });
    const r = await first;
    expect(r.state.phase).toBe('breakChoice');
    expect(currentSeat(r.state)).toBe(1);

    const again = once<string>(s, 'rejected');
    s.emit('shot', good);
    expect(await again).toMatch(/still playing|not allowed/);

    const reply = await once<ShotBroadcast>(s, 'shotResult');
    expect(reply.frames.length).toBeGreaterThan(0);
  }, 30000);
});
