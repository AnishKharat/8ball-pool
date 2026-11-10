// Free-for-all: 3 or 4 players, 21 numbered balls, one point a pot, most points wins.
import { BALL_R, RACK_GAP } from './constants';
import type { BallPos, SimResult } from './physics';
import { shuffle, withCue, type Foul, type GameState, type ShotOutcome } from './rules';
import { FOOT_SPOT_X, HEAD_STRING_X } from './table';

export const FFA_BALLS = 21;
const FFA_ROWS = 6; // 1+2+3+4+5+6 = 21

type ShotResult = Pick<SimResult, 'events' | 'balls'>;

/** Six-row triangle, apex on the foot spot, every ball in random order. */
export function rackFfa(random: () => number = Math.random): BallPos[] {
  const ids = shuffle(Array.from({ length: FFA_BALLS }, (_, i) => i + 1), random);
  const balls: BallPos[] = [{ id: 0, x: HEAD_STRING_X, y: 0 }];
  for (let row = 0; row < FFA_ROWS; row++) {
    for (let j = 0; j <= row; j++) {
      balls.push({ id: ids.pop()!, x: FOOT_SPOT_X + row * (Math.sqrt(3) * BALL_R + RACK_GAP), y: (j - row / 2) * (2 * BALL_R + RACK_GAP) });
    }
  }
  return balls;
}

/** Shooting order is seat order; the first breaker is drawn at random. */
export function newFfaGame(players: number, random: () => number = Math.random): GameState {
  const order = Array.from({ length: players }, (_, i) => i);
  return {
    rules: 'ffa', order, teamOf: order.slice(), turn: Math.floor(random() * players), phase: 'break', balls: rackFfa(random),
    solidsTeam: null, ballInHand: true, winner: null, endReason: null,
    scores: order.map(() => 0), absent: order.map(() => false), winners: [],
  };
}

/** The next seat after the current one that is still playing; absent seats are skipped. */
function nextPresent(s: GameState): number {
  for (let k = 1; k <= s.order.length; k++) {
    const t = (s.turn + k) % s.order.length;
    if (!s.absent[s.order[t]]) return t;
  }
  return s.turn;
}

/** Over when the table is empty, when nobody can catch the leader, or when one player is left. Ties share the win. */
function settle(s: GameState): GameState {
  const left = s.balls.filter((b) => b.id !== 0).length;
  const [lead, second = 0] = [...s.scores].sort((a, b) => b - a);
  const present = s.absent.filter((a) => !a).length;
  const endReason = left === 0 ? 'allDown' : left < lead - second ? 'clinched' : present <= 1 ? 'lastPlayer' : null;
  if (!endReason) return s;
  const winners = s.scores.flatMap((v, seat) => (v === lead ? [seat] : []));
  return { ...s, phase: 'over', endReason, winners };
}

export function applyFfaShot(s: GameState, r: ShotResult): { state: GameState; outcome: ShotOutcome } {
  const potted = r.events.flatMap((e) => (e.type === 'pot' ? [e.a] : []));
  const objects = potted.filter((id) => id !== 0);
  const fouls: Foul[] = [];
  if (potted.includes(0)) fouls.push('scratch');
  if (r.events.some((e) => e.type === 'off')) fouls.push('offTable');
  if (s.phase === 'break') {
    const railed = new Set(r.events.flatMap((e) => (e.type === 'cushion' && e.a !== 0 ? [e.a] : [])));
    if (!fouls.length && !objects.length && railed.size < 4) fouls.push('illegalBreak');
  } else {
    const contactAt = r.events.findIndex((e) => e.type === 'ball');
    if (contactAt === -1) fouls.push('noContact');
    else if (!r.events.slice(contactAt + 1).some((e) => e.type === 'cushion' || e.type === 'pot')) fouls.push('noCushion');
  }

  // Balls potted on a foul stay down and score nothing.
  const balls = withCue(r.balls);
  if (fouls.length) {
    const state = settle({ ...s, balls, phase: 'play', turn: nextPresent(s), ballInHand: true });
    return { state, outcome: { fouls, potted, continues: false } };
  }
  const shooter = s.order[s.turn];
  const scores = s.scores.map((v, seat) => (seat === shooter ? v + objects.length : v));
  const continues = objects.length > 0;
  const state = settle({ ...s, balls, scores, phase: 'play', ballInHand: false, turn: continues ? s.turn : nextPresent(s) });
  return { state, outcome: { fouls, potted, continues } };
}

/** A foul: the next player has ball in hand. An unbroken rack passes the break on, as in eight-ball. */
export function ffaShotClockExpiry(s: GameState): GameState {
  if (s.phase === 'over') return s;
  return { ...s, turn: nextPresent(s), ballInHand: true };
}

/** A seat gave up or came back. Absent seats lose their turns but keep their score. */
export function setFfaAbsent(s: GameState, seat: number, absent: boolean): GameState {
  if (s.phase === 'over') return s;
  const next = { ...s, absent: s.absent.map((a, i) => (i === seat ? absent : a)) };
  if (absent && s.order[s.turn] === seat) next.turn = nextPresent(next);
  return settle(next);
}
