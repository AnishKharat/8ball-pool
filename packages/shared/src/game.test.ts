import { describe, expect, it } from 'vitest';
import { BALL_R } from './constants';
import { simulateShot, type BallPos, type SimEvent } from './physics';
import {
  applyShot, applyShotClockExpiry, chooseAfterIllegalBreak, currentSeat, freeCueSpot, groupOf, isOnEight, newGame, placeCue,
  type Foul, type Format, type GameState,
} from './rules';
import { HEAD_STRING_X } from './table';

const hit = (b: number): SimEvent => ({ type: 'ball', t: 0.1, a: 0, b, speed: 1, x: 0, y: 0, bx: 0, by: 0 });
const rail = (a: number): SimEvent => ({ type: 'cushion', t: 0.2, a, speed: 1 });
const pot = (a: number, pocket = 0): SimEvent => ({ type: 'pot', t: 0.3, a, pocket, speed: 1 });
const off = (a: number): SimEvent => ({ type: 'off', t: 0.3, a });

const spread = (ids: number[]): BallPos[] => ids.map((id, i) => ({ id, x: -1 + i * 0.1, y: 0.3 }));

function play(format: Format = '1v1', ids = [0, 1, 2, 8, 9, 10], solidsTeam: 0 | 1 | null = 0): GameState {
  return { ...newGame(format), phase: 'play', balls: spread(ids), solidsTeam, ballInHand: false };
}

/** Run a shot from these events; final balls are the state's balls less whatever left the table. */
function shoot(s: GameState, events: SimEvent[], called: number | null = null) {
  const gone = new Set(events.flatMap((e) => (e.type === 'pot' || e.type === 'off' ? [e.a] : [])));
  return applyShot(s, { events, balls: s.balls.filter((b) => !gone.has(b.id)) }, called);
}

describe('fouls give the next team ball in hand', () => {
  const cases: [string, SimEvent[], Foul][] = [
    ['scratch', [hit(1), rail(1), pot(0)], 'scratch'],
    ['wrong ball first', [hit(9), rail(9)], 'wrongBall'],
    ['the 8 first while not on it', [hit(8), rail(8)], 'wrongBall'],
    ['no contact', [rail(0)], 'noContact'],
    ['no cushion after contact', [rail(0), hit(1)], 'noCushion'],
    ['ball off the table', [hit(1), rail(1), off(2)], 'offTable'],
  ];
  it.each(cases)('%s', (_name, events, foul) => {
    const { state, outcome } = shoot(play(), events);
    expect(outcome.fouls).toContain(foul);
    expect(state).toMatchObject({ turn: 1, ballInHand: true, phase: 'play' });
  });

  it('a clean shot has no fouls and no ball in hand', () => {
    const { state, outcome } = shoot(play(), [hit(1), rail(1)]);
    expect(outcome.fouls).toEqual([]);
    expect(state.ballInHand).toBe(false);
  });

  it('a pot satisfies the cushion requirement', () => {
    expect(shoot(play(), [hit(1), pot(1)]).outcome.fouls).toEqual([]);
  });

  it('a scratched cue ball comes back on a free spot', () => {
    const { state } = shoot(play(), [hit(1), rail(1), pot(0)]);
    expect(state.balls.filter((b) => b.id === 0)).toHaveLength(1);
  });

  it('potting your ball on a foul does not keep the turn', () => {
    const { state, outcome } = shoot(play(), [hit(1), pot(1), pot(0)]);
    expect(outcome.continues).toBe(false);
    expect(state.turn).toBe(1);
  });

  it('shot clock expiry is a foul that passes the turn with ball in hand', () => {
    expect(applyShotClockExpiry(play())).toMatchObject({ turn: 1, ballInHand: true, phase: 'play' });
  });

  it('shot clock expiry on the break passes the break on, and in the choice plays on', () => {
    expect(applyShotClockExpiry(newGame('1v1'))).toMatchObject({ phase: 'break', turn: 1, ballInHand: true });
    expect(applyShotClockExpiry({ ...play(), phase: 'breakChoice', turn: 1 })).toMatchObject({ phase: 'play', turn: 0, ballInHand: true });
  });
});

describe('ball in hand placement through the state', () => {
  it('is refused without ball in hand, on overlap, and past the head string on a break', () => {
    expect(placeCue(play(), 0, 0)).toBeNull();
    const foul = { ...play(), ballInHand: true };
    const other = foul.balls[1];
    expect(placeCue(foul, other.x + BALL_R, other.y)).toBeNull();
    expect(placeCue(foul, 0.5, -0.2)?.balls.find((b) => b.id === 0)).toMatchObject({ x: 0.5, y: -0.2 });
    const brk = newGame('1v1');
    expect(placeCue(brk, HEAD_STRING_X + 0.1, 0.2)).toBeNull();
    expect(placeCue(brk, HEAD_STRING_X - 0.1, 0.2)).not.toBeNull();
  });

  it('freeCueSpot finds room even when the head string is blocked', () => {
    const wall = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, x: HEAD_STRING_X, y: -0.5 + i * (2 * BALL_R + 0.01) }));
    const spot = freeCueSpot(wall);
    for (const b of wall) expect(Math.hypot(b.x - spot.x, b.y - spot.y)).toBeGreaterThanOrEqual(2 * BALL_R);
  });
});

describe('break', () => {
  const railed = [1, 2, 3, 4].map(rail);
  const brk = () => newGame('1v1');

  it('a pot is legal: same shooter, table stays open', () => {
    const { state, outcome } = shoot(brk(), [hit(1), pot(3)]);
    expect(outcome.continues).toBe(true);
    expect(state).toMatchObject({ phase: 'play', turn: 0, solidsTeam: null, ballInHand: false });
  });

  it('four balls to a cushion is legal: the turn passes, table open', () => {
    expect(shoot(brk(), [hit(1), ...railed]).state).toMatchObject({ phase: 'play', turn: 1, solidsTeam: null });
  });

  it('three balls to a cushion, or the cue ball as the fourth, is illegal: the opponent chooses', () => {
    expect(shoot(brk(), [hit(1), rail(1), rail(2), rail(3)]).state).toMatchObject({ phase: 'breakChoice', turn: 1 });
    expect(shoot(brk(), [hit(1), rail(1), rail(2), rail(3), rail(0)]).state.phase).toBe('breakChoice');
  });

  it('the choice: re-rack makes the chooser break, play on keeps the table', () => {
    const { state } = shoot(brk(), [hit(1), rail(1)]);
    const again = chooseAfterIllegalBreak(state, 'rerack');
    expect(again).toMatchObject({ phase: 'break', turn: 1, ballInHand: true });
    expect(again.balls).toHaveLength(16);
    const on = chooseAfterIllegalBreak(state, 'playOn');
    expect(on).toMatchObject({ phase: 'play', turn: 1, ballInHand: false });
    expect(on.balls).toBe(state.balls);
    expect(chooseAfterIllegalBreak(on, 'rerack')).toBe(on);
  });

  it('the 8 on the break re-racks for the same breaker', () => {
    const { state } = shoot(brk(), [hit(1), rail(1), pot(8)]);
    expect(state).toMatchObject({ phase: 'break', turn: 0, ballInHand: true, winner: null });
    expect(state.balls).toHaveLength(16);
  });

  it('a scratch on a legal break is a foul, with the table still open', () => {
    const { state, outcome } = shoot(brk(), [hit(1), pot(3), pot(0)]);
    expect(outcome.fouls).toContain('scratch');
    expect(state).toMatchObject({ phase: 'play', turn: 1, ballInHand: true, solidsTeam: null });
  });

  it('a scratch on an illegal break gives the chooser ball in hand if they play on', () => {
    const { state } = shoot(brk(), [hit(1), rail(1), pot(0)]);
    expect(chooseAfterIllegalBreak(state, 'playOn')).toMatchObject({ phase: 'play', ballInHand: true });
  });
});

describe('group assignment', () => {
  const open = () => play('2v2', [0, 1, 2, 8, 9, 10], null);

  it('a legal pot on an open table gives the group to the whole team', () => {
    const { state, outcome } = shoot(open(), [hit(9), pot(9)]);
    expect(outcome.continues).toBe(true);
    expect(state.turn).toBe(0);
    expect(groupOf(state, 0)).toBe('stripes');
    expect(groupOf(state, 1)).toBe('solids');
    expect(groupOf(state, state.teamOf[2])).toBe('stripes');
  });

  it('solids go to the shooter too, when a team 1 seat pots', () => {
    expect(groupOf(shoot({ ...open(), turn: 1 }, [hit(1), pot(1)]).state, 1)).toBe('solids');
  });

  it('the first ball down decides when both groups drop', () => {
    expect(groupOf(shoot(open(), [hit(1), pot(9), pot(1)]).state, 0)).toBe('stripes');
  });

  it('a foul pot assigns nothing, and neither does a miss', () => {
    expect(shoot(open(), [hit(1), pot(1), pot(0)]).state.solidsTeam).toBeNull();
    expect(shoot(open(), [hit(1), rail(1)]).state.solidsTeam).toBeNull();
  });

  it('on an open table any ball but the 8 is legal first', () => {
    expect(shoot(open(), [hit(9), rail(9)]).outcome.fouls).toEqual([]);
    expect(shoot(open(), [hit(1), rail(1)]).outcome.fouls).toEqual([]);
    expect(shoot(open(), [hit(8), rail(8)]).outcome.fouls).toContain('wrongBall');
  });

  it('potting only the other group is legal but ends the turn', () => {
    const { state, outcome } = shoot(play(), [hit(1), pot(9)]);
    expect(outcome).toMatchObject({ fouls: [], continues: false });
    expect(state.turn).toBe(1);
  });

  it('potting your own keeps the turn', () => {
    expect(shoot(play(), [hit(1), pot(2)]).state.turn).toBe(0);
  });
});

describe('win and loss', () => {
  const onEight = () => play('1v1', [0, 8, 9, 10]);

  it('isOnEight follows the group', () => {
    expect(isOnEight(onEight(), 0)).toBe(true);
    expect(isOnEight(onEight(), 1)).toBe(false);
    expect(isOnEight(play('1v1', [0, 8, 9], null), 0)).toBe(false);
    expect(isOnEight(play('1v1', [0, 8], null), 0)).toBe(true);
  });

  it('win: the 8 in the called pocket on a legal shot', () => {
    expect(shoot(onEight(), [hit(8), pot(8, 4)], 4).state).toMatchObject({ phase: 'over', winner: 0, endReason: 'potted8' });
  });

  it('loss: the 8 in the wrong pocket', () => {
    expect(shoot(onEight(), [hit(8), pot(8, 4)], 2).state).toMatchObject({ phase: 'over', winner: 1, endReason: 'wrongPocket' });
  });

  it('loss: the 8 with no pocket called', () => {
    expect(shoot(onEight(), [hit(8), pot(8, 4)], null).state).toMatchObject({ winner: 1, endReason: 'wrongPocket' });
  });

  it('loss: the 8 early, even in the called pocket', () => {
    expect(shoot(play(), [hit(1), pot(8, 4)], 4).state).toMatchObject({ phase: 'over', winner: 1, endReason: 'early8' });
  });

  it('loss: clearing your last ball and the 8 on one shot', () => {
    const s = play('1v1', [0, 1, 8, 9]);
    expect(shoot(s, [hit(1), pot(1), pot(8, 4)], 4).state).toMatchObject({ winner: 1, endReason: 'early8' });
  });

  it('loss: the 8 with a scratch, or off a wrong ball first', () => {
    expect(shoot(onEight(), [hit(8), pot(8, 4), pot(0)], 4).state).toMatchObject({ winner: 1, endReason: 'foulOn8' });
    expect(shoot(onEight(), [hit(9), pot(8, 4)], 4).state).toMatchObject({ winner: 1, endReason: 'foulOn8' });
  });

  it('loss: the 8 off the table', () => {
    expect(shoot(onEight(), [hit(8), off(8)], 4).state).toMatchObject({ phase: 'over', winner: 1 });
  });

  it('a team 1 seat wins and loses for its team', () => {
    const on = { ...play('2v2', [0, 8, 1], 0), turn: 1 };
    expect(shoot({ ...on, solidsTeam: 0, balls: spread([0, 8, 1]) }, [hit(8), pot(8, 1)], 1).state.winner).toBe(1);
    const early = { ...play('2v2', [0, 8, 1, 9], 0), turn: 1 };
    expect(shoot(early, [hit(9), pot(8, 1)], 1).state.winner).toBe(0);
  });

  it('on the 8, missing it is a plain turn change and hitting another ball first is a foul', () => {
    expect(shoot(onEight(), [hit(8), rail(8)]).outcome.fouls).toEqual([]);
    expect(shoot(onEight(), [hit(9), rail(9)]).outcome.fouls).toContain('wrongBall');
  });
});

describe('turn rotation', () => {
  const seats = (format: Format, n: number) => {
    let s = play(format);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(currentSeat(s));
      s = shoot(s, s.teamOf[currentSeat(s)] === 0 ? [hit(1), rail(1)] : [hit(9), rail(9)]).state;
    }
    return out;
  };

  it('1 vs bot: H, Bot', () => expect(seats('bot', 4)).toEqual([0, 1, 0, 1]));
  it('1v1: A, B', () => expect(seats('1v1', 4)).toEqual([0, 1, 0, 1]));
  it('1v2: A, B1, A, B2', () => expect(seats('1v2', 8)).toEqual([0, 1, 0, 2, 0, 1, 0, 2]));
  it('2v2: A1, B1, A2, B2', () => expect(seats('2v2', 8)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]));

  it('teams line up in every format', () => {
    expect(newGame('bot').teamOf).toEqual([0, 1]);
    expect(newGame('1v1').teamOf).toEqual([0, 1]);
    expect(newGame('1v2').teamOf).toEqual([0, 1, 1]);
    expect(newGame('2v2').teamOf).toEqual([0, 1, 0, 1]);
  });

  it('fouls in 1v2 follow the rotation, so B1 and B2 still alternate', () => {
    let s = play('1v2');
    s = shoot(s, [rail(0)]).state;
    expect(currentSeat(s)).toBe(1);
    s = shoot(s, [rail(0)]).state;
    expect(currentSeat(s)).toBe(0);
    s = shoot(s, [rail(0)]).state;
    expect(currentSeat(s)).toBe(2);
  });

  it('a pot keeps the same seat, and the rotation then resumes from it', () => {
    let s: GameState = { ...play('2v2'), turn: 2 };
    s = shoot(s, [hit(1), pot(1)]).state;
    expect(currentSeat(s)).toBe(2);
    s = shoot(s, [hit(2), rail(2)]).state;
    expect(currentSeat(s)).toBe(3);
  });
});

describe('with real physics', () => {
  const state = (balls: BallPos[]): GameState => ({ ...play(), balls });

  it('a straight pot into the side keeps the turn and removes the ball', () => {
    const s = state([{ id: 0, x: 0, y: 0.1 }, { id: 1, x: 0, y: 0.35 }, { id: 8, x: 1, y: 0 }, { id: 9, x: -1, y: 0 }]);
    const { state: after, outcome } = applyShot(s, simulateShot(s.balls, { angle: Math.PI / 2, power: 0.2, hitX: 0, hitY: -0.2 }), null);
    expect(outcome).toMatchObject({ fouls: [], potted: [1], continues: true });
    expect(after.turn).toBe(0);
    expect(after.balls.some((b) => b.id === 1)).toBe(false);
  });

  it('a shot into empty table is a no-contact foul', () => {
    const s = state([{ id: 0, x: 0, y: 0 }, { id: 1, x: 1, y: 0.5 }, { id: 8, x: 1, y: -0.5 }]);
    const { outcome } = applyShot(s, simulateShot(s.balls, { angle: Math.PI / 2 + 0.3, power: 0.1, hitX: 0, hitY: 0 }), null);
    expect(outcome.fouls).toContain('noContact');
  });

  it('every break settles into a valid next state, with a cue ball on the table', () => {
    for (let k = 0; k < 20; k++) {
      const s = newGame('1v1');
      const { state: after } = applyShot(s, simulateShot(s.balls, { angle: (k - 10) * 0.01, power: k / 19, hitX: 0, hitY: 0 }), null);
      expect(['play', 'breakChoice', 'break']).toContain(after.phase);
      expect(after.balls.filter((b) => b.id === 0)).toHaveLength(1);
    }
  });
});
