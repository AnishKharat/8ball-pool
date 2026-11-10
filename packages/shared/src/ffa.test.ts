import { describe, expect, it } from 'vitest';
import { BALL_R } from './constants';
import { applyFfaShot, ffaShotClockExpiry, FFA_BALLS, newFfaGame, rackFfa, setFfaAbsent } from './ffa';
import type { BallPos, SimEvent } from './physics';
import { currentSeat, placeCue, type Foul, type GameState } from './rules';
import { rulesFor } from './ruleset';
import { FOOT_SPOT_X } from './table';

const hit = (b: number): SimEvent => ({ type: 'ball', t: 0.1, a: 0, b, speed: 1, x: 0, y: 0, bx: 0, by: 0 });
const rail = (a: number): SimEvent => ({ type: 'cushion', t: 0.2, a, speed: 1 });
const pot = (a: number, pocket = 0): SimEvent => ({ type: 'pot', t: 0.3, a, pocket, speed: 1 });
const off = (a: number): SimEvent => ({ type: 'off', t: 0.3, a });
const spread = (ids: number[]): BallPos[] => ids.map((id, i) => ({ id, x: -1 + i * 0.08, y: 0.3 }));

/** Mid-game: seat `turn` is up, with these balls on the table and these scores. */
function play(players: number, opts: { turn?: number; ids?: number[]; scores?: number[]; absent?: boolean[] } = {}): GameState {
  const s = newFfaGame(players, () => 0);
  return {
    ...s, phase: 'play', ballInHand: false, turn: opts.turn ?? 0, balls: spread(opts.ids ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    scores: opts.scores ?? s.scores, absent: opts.absent ?? s.absent,
  };
}

function shoot(s: GameState, events: SimEvent[]) {
  const gone = new Set(events.flatMap((e) => (e.type === 'pot' || e.type === 'off' ? [e.a] : [])));
  return applyFfaShot(s, { events, balls: s.balls.filter((b) => !gone.has(b.id)) });
}

describe('free-for-all rack', () => {
  it('has 21 numbered balls in a six-row triangle from the foot spot, none overlapping, order random', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const balls = rackFfa(random);
    const objects = balls.filter((b) => b.id !== 0);
    expect(objects).toHaveLength(FFA_BALLS);
    expect(new Set(objects.map((b) => b.id))).toEqual(new Set(Array.from({ length: 21 }, (_, i) => i + 1)));
    expect(Math.min(...objects.map((b) => b.x))).toBeCloseTo(FOOT_SPOT_X, 9);
    expect(new Set(objects.map((b) => b.x.toFixed(6))).size).toBe(6);
    for (const a of balls) for (const b of balls) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * BALL_R);
    expect(rackFfa(random).map((b) => b.id)).not.toEqual(balls.map((b) => b.id));
  });

  it('starts with a random breaker, ball in hand behind the head string, and zero scores', () => {
    expect(newFfaGame(3, () => 0.99)).toMatchObject({ rules: 'ffa', turn: 2, phase: 'break', ballInHand: true, scores: [0, 0, 0] });
    expect(newFfaGame(4, () => 0.3).turn).toBe(1);
    const s = newFfaGame(3, () => 0);
    expect(placeCue(s, 0, 0)).toBeNull();
    expect(placeCue(s, -0.9, 0.2)).not.toBeNull();
  });
});

describe('free-for-all scoring and turns', () => {
  it('scores a point a ball on a legal shot and keeps the turn; any ball first is legal', () => {
    const { state, outcome } = shoot(play(3), [hit(8), pot(8), hit(3), pot(3, 2)]);
    expect(outcome).toEqual({ fouls: [], potted: [8, 3], continues: true });
    expect(state).toMatchObject({ scores: [2, 0, 0], turn: 0, ballInHand: false, phase: 'play' });
  });

  it('passes the turn after a legal miss', () => {
    const { state } = shoot(play(3, { turn: 1 }), [hit(5), rail(5)]);
    expect(state).toMatchObject({ scores: [0, 0, 0], turn: 2, ballInHand: false });
  });

  const fouls: [string, SimEvent[], Foul][] = [
    ['scratch', [hit(1), pot(1), pot(0)], 'scratch'],
    ['no contact', [rail(0)], 'noContact'],
    ['no cushion after contact', [rail(0), hit(1)], 'noCushion'],
    ['ball off the table', [hit(1), pot(2), off(3)], 'offTable'],
  ];
  it.each(fouls)('a foul (%s) scores nothing, leaves pots down, and gives the next player ball in hand', (_n, events, foul) => {
    const { state, outcome } = shoot(play(4, { turn: 3, scores: [1, 0, 0, 2] }), events);
    expect(outcome.fouls).toContain(foul);
    expect(state).toMatchObject({ scores: [1, 0, 0, 2], turn: 0, ballInHand: true, phase: 'play' });
    for (const e of events) if (e.type === 'pot' && e.a !== 0) expect(state.balls.some((b) => b.id === e.a)).toBe(false);
    expect(state.balls.some((b) => b.id === 0)).toBe(true);
  });

  it('a shot clock expiry is a foul: next player, ball in hand', () => {
    expect(ffaShotClockExpiry(play(3, { turn: 2 }))).toMatchObject({ turn: 0, ballInHand: true });
  });

  it('rotates through 3 and 4 seats in seat order', () => {
    for (const n of [3, 4]) {
      let s = play(n);
      const seen: number[] = [];
      for (let i = 0; i < n + 1; i++) {
        seen.push(currentSeat(s));
        s = shoot(s, [hit(5), rail(5)]).state;
      }
      expect(seen).toEqual([...Array.from({ length: n }, (_, i) => i), 0]);
    }
  });

  it('skips absent players, who keep their score; a returning player is back in the rotation', () => {
    let s = setFfaAbsent(play(4, { scores: [0, 3, 0, 0] }), 1, true);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(currentSeat(s));
      s = shoot(s, [hit(5), rail(5)]).state;
    }
    expect(seen).toEqual([0, 2, 3, 0]);
    expect(s.scores[1]).toBe(3);
    s = setFfaAbsent(s, 1, false);
    const back: number[] = [];
    for (let i = 0; i < 4; i++) {
      back.push(currentSeat(s));
      s = shoot(s, [hit(5), rail(5)]).state;
    }
    expect(back).toEqual([2, 3, 0, 1]);
  });

  it('passes the turn on at once when the player up goes absent', () => {
    expect(currentSeat(setFfaAbsent(play(3, { turn: 1 }), 1, true))).toBe(2);
  });
});

describe('free-for-all break', () => {
  const brk = () => ({ ...newFfaGame(3, () => 0), balls: spread([0, 1, 2, 3, 4, 5, 6, 7]) });

  it('an illegal break passes the turn with ball in hand anywhere', () => {
    const { state, outcome } = shoot(brk(), [hit(1), rail(1), rail(2), rail(3)]);
    expect(outcome.fouls).toEqual(['illegalBreak']);
    expect(state).toMatchObject({ turn: 1, ballInHand: true, phase: 'play', scores: [0, 0, 0] });
    expect(placeCue(state, 0.5, 0)).not.toBeNull();
  });

  it('a legal break by rails passes the turn; pots on a legal break score for the breaker and keep the turn', () => {
    expect(shoot(brk(), [hit(1), rail(1), rail(2), rail(3), rail(4)]).state).toMatchObject({ turn: 1, phase: 'play', ballInHand: false });
    expect(shoot(brk(), [hit(1), pot(4), pot(6)]).state).toMatchObject({ turn: 0, scores: [2, 0, 0], phase: 'play' });
  });

  it('a scratch on the break scores nothing even with a pot', () => {
    const { state, outcome } = shoot(brk(), [hit(1), pot(4), pot(0)]);
    expect(outcome.fouls).toEqual(['scratch']);
    expect(state).toMatchObject({ turn: 1, scores: [0, 0, 0], ballInHand: true });
  });

  it('a shot clock expiry on the unbroken rack passes the break on', () => {
    expect(ffaShotClockExpiry(newFfaGame(3, () => 0))).toMatchObject({ turn: 1, phase: 'break', ballInHand: true });
  });
});

describe('free-for-all end', () => {
  it('ends when every ball is down; the most points wins', () => {
    const { state } = shoot(play(3, { ids: [0, 4], scores: [5, 6, 9] }), [hit(4), pot(4)]);
    expect(state).toMatchObject({ phase: 'over', endReason: 'allDown', scores: [6, 6, 9], winners: [2] });
  });

  it('a foul on the last ball still ends it', () => {
    expect(shoot(play(3, { ids: [0, 4], scores: [5, 6, 9] }), [hit(4), pot(4), pot(0)]).state).toMatchObject({ phase: 'over', endReason: 'allDown', winners: [2] });
  });

  it('ends early once nobody can catch the leader, but not while second place can still tie', () => {
    // Pot one: 3 left, lead 5 - 2 = 3, so second place can still tie. Pot another: 2 left, lead 4: clinched.
    const once = shoot(play(3, { ids: [0, 1, 2, 3, 4], scores: [4, 2, 1] }), [hit(4), pot(4)]).state;
    expect(once).toMatchObject({ phase: 'play', scores: [5, 2, 1] });
    expect(shoot(once, [hit(1), pot(1)]).state).toMatchObject({ phase: 'over', endReason: 'clinched', winners: [0] });
  });

  it('players tied at the top share the win', () => {
    const { state } = shoot(play(4, { ids: [0, 7], scores: [4, 7, 7, 2], turn: 2 }), [hit(7), rail(7)]);
    expect(state.phase).toBe('play');
    expect(shoot(state, [hit(7), pot(7)]).state).toMatchObject({ phase: 'over', winners: [1, 2], endReason: 'allDown' });
  });

  it('ends when only one player is left, on current scores', () => {
    let s = setFfaAbsent(play(3, { scores: [1, 4, 0] }), 1, true);
    expect(s.phase).toBe('play');
    s = setFfaAbsent(s, 2, true);
    expect(s).toMatchObject({ phase: 'over', endReason: 'lastPlayer', winners: [1] });
  });
});

describe('rule sets', () => {
  it('free-for-all formats get the free-for-all rules; eight-ball formats are unchanged', () => {
    expect(rulesFor('1v1v1').newGame(Math.random)).toMatchObject({ rules: 'ffa', order: [0, 1, 2], teamOf: [0, 1, 2] });
    expect(rulesFor('1v1v1v1').newGame(Math.random).balls).toHaveLength(22);
    const eight = rulesFor('2v2').newGame(Math.random);
    expect(eight).toMatchObject({ rules: 'eight', order: [0, 1, 2, 3], teamOf: [0, 1, 0, 1], scores: [] });
    expect(eight.balls).toHaveLength(16);
  });

  it('eight-ball: a team with every seat absent forfeits', () => {
    const r = rulesFor('2v2');
    let s = r.setAbsent(r.newGame(Math.random), 0, true);
    expect(s.phase).toBe('break');
    s = r.setAbsent(s, 2, true);
    expect(s).toMatchObject({ phase: 'over', winner: 1, endReason: 'forfeit' });
  });
});
