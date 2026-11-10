import { BALL_R, HALF_L, HALF_W, RACK_GAP } from './constants';
import type { BallPos, SimResult } from './physics';
import { FOOT_SPOT_X, HEAD_STRING_X } from './table';

/** Fisher-Yates, in place. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Triangle at the foot spot: 8 in the centre, a solid and a stripe in the back corners, the rest random. */
export function rackBalls(random: () => number = Math.random): BallPos[] {
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7], random);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], random);
  const corners = shuffle([solids.pop()!, stripes.pop()!], random);
  const rest = shuffle([...solids, ...stripes], random);
  const balls: BallPos[] = [{ id: 0, x: HEAD_STRING_X, y: 0 }];
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      let id: number;
      if (row === 2 && j === 1) id = 8;
      else if (row === 4 && j === 0) id = corners[0];
      else if (row === 4 && j === 4) id = corners[1];
      else id = rest.pop()!;
      balls.push({
        id,
        x: FOOT_SPOT_X + row * (Math.sqrt(3) * BALL_R + RACK_GAP),
        y: (j - row / 2) * (2 * BALL_R + RACK_GAP),
      });
    }
  }
  return balls;
}

/** Ball in hand: on the playing surface, clear of every other ball, and behind the head string for a break. */
export function canPlaceCue(balls: readonly BallPos[], x: number, y: number, behindHeadString: boolean): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (Math.abs(x) > HALF_L - BALL_R || Math.abs(y) > HALF_W - BALL_R) return false;
  if (behindHeadString && x > HEAD_STRING_X) return false;
  return balls.every((b) => b.id === 0 || Math.hypot(b.x - x, b.y - y) >= 2 * BALL_R);
}

/** Nearest legal spot to the head string's centre, for a scratched cue ball. */
export function freeCueSpot(balls: readonly BallPos[]): { x: number; y: number } {
  const step = 2.2 * BALL_R;
  const spots: { x: number; y: number }[] = [];
  for (let i = -20; i <= 20; i++) {
    for (let j = -10; j <= 10; j++) spots.push({ x: HEAD_STRING_X + i * step, y: j * step });
  }
  spots.sort((a, b) => Math.hypot(a.x - HEAD_STRING_X, a.y) - Math.hypot(b.x - HEAD_STRING_X, b.y));
  const spot = spots.find((s) => canPlaceCue(balls, s.x, s.y, false));
  if (!spot) throw new Error('no free spot'); // 15 balls can't cover the table
  return spot;
}

export type Format = 'bot' | '1v1' | '1v2' | '2v2';
export type Group = 'solids' | 'stripes';
export type Phase = 'break' | 'breakChoice' | 'play' | 'over';
export type Foul = 'scratch' | 'wrongBall' | 'noContact' | 'noCushion' | 'offTable';
export type EndReason = 'potted8' | 'early8' | 'wrongPocket' | 'foulOn8' | 'forfeit';

export interface GameState {
  /** Seats in shooting order; a seat appears twice when it shoots every team turn. */
  order: number[];
  /** Team (0 or 1) of each seat. */
  teamOf: number[];
  turn: number;
  phase: Phase;
  balls: BallPos[];
  solidsTeam: 0 | 1 | null;
  ballInHand: boolean;
  winner: 0 | 1 | null;
  endReason: EndReason | null;
}

export interface ShotOutcome {
  fouls: Foul[];
  potted: number[];
  /** The same seat shoots again. */
  continues: boolean;
}

type ShotResult = Pick<SimResult, 'events' | 'balls'>;

const ROTATIONS: Record<Format, { order: number[]; teamOf: number[] }> = {
  bot: { order: [0, 1], teamOf: [0, 1] },
  '1v1': { order: [0, 1], teamOf: [0, 1] },
  '1v2': { order: [0, 1, 0, 2], teamOf: [0, 1, 1] },
  '2v2': { order: [0, 1, 2, 3], teamOf: [0, 1, 0, 1] },
};

/** Team (0 or 1) of each seat for a format. */
export const seatTeams = (format: Format): readonly number[] => ROTATIONS[format].teamOf;

export function newGame(format: Format, random: () => number = Math.random): GameState {
  const { order, teamOf } = ROTATIONS[format];
  return {
    order, teamOf, turn: 0, phase: 'break', balls: rackBalls(random),
    solidsTeam: null, ballInHand: true, winner: null, endReason: null,
  };
}

export const currentSeat = (s: GameState) => s.order[s.turn];
export const currentTeam = (s: GameState) => s.teamOf[currentSeat(s)] as 0 | 1;
const nextTurn = (s: GameState) => (s.turn + 1) % s.order.length;
const inGroup = (id: number, group: Group) => (group === 'solids' ? id >= 1 && id <= 7 : id >= 9 && id <= 15);

export function groupOf(s: GameState, team: number): Group | null {
  if (s.solidsTeam === null) return null;
  return s.solidsTeam === team ? 'solids' : 'stripes';
}

/** The team has no balls left but the 8. Decided before a shot, so clearing and potting the 8 together loses. */
export function isOnEight(s: GameState, team: number): boolean {
  const group = groupOf(s, team);
  return !s.balls.some((b) => b.id !== 0 && b.id !== 8 && (group === null || inGroup(b.id, group)));
}

/** Ball in hand stays open until the shot, so the shooter can re-place freely. Returns null if refused. */
export function placeCue(s: GameState, x: number, y: number): GameState | null {
  if (!s.ballInHand || !canPlaceCue(s.balls, x, y, s.phase === 'break')) return null;
  return { ...s, balls: s.balls.map((b) => (b.id === 0 ? { id: 0, x, y } : b)) };
}

/** A scratched cue ball returns to the table straight away, so state always has one. */
function withCue(balls: BallPos[]): BallPos[] {
  return balls.some((b) => b.id === 0) ? balls : [{ id: 0, ...freeCueSpot(balls) }, ...balls];
}

function rerack(s: GameState, random: () => number): GameState {
  return { ...s, phase: 'break', balls: rackBalls(random), ballInHand: true };
}

function applyBreak(s: GameState, r: ShotResult, random: () => number): { state: GameState; outcome: ShotOutcome } {
  const potted = r.events.flatMap((e) => (e.type === 'pot' ? [e.a] : []));
  const off = r.events.flatMap((e) => (e.type === 'off' ? [e.a] : []));
  if (potted.includes(8) || off.includes(8)) {
    return { state: rerack(s, random), outcome: { fouls: [], potted, continues: true } };
  }
  const fouls: Foul[] = [];
  if (potted.includes(0)) fouls.push('scratch');
  if (off.length) fouls.push('offTable');
  const objectPotted = potted.some((id) => id !== 0);
  const railed = new Set(r.events.flatMap((e) => (e.type === 'cushion' && e.a !== 0 ? [e.a] : [])));
  const balls = withCue(r.balls);
  if (!objectPotted && railed.size < 4) {
    const state: GameState = { ...s, balls, turn: nextTurn(s), phase: 'breakChoice', ballInHand: fouls.length > 0 };
    return { state, outcome: { fouls, potted, continues: false } };
  }
  const continues = objectPotted && fouls.length === 0;
  const state: GameState = { ...s, balls, phase: 'play', turn: continues ? s.turn : nextTurn(s), ballInHand: fouls.length > 0 };
  return { state, outcome: { fouls, potted, continues } };
}

/** Rules for a finished shot. `called` is the pocket named for the 8, if any. The input state is not mutated. */
export function applyShot(
  s: GameState, r: ShotResult, called: number | null, random: () => number = Math.random,
): { state: GameState; outcome: ShotOutcome } {
  if (s.phase === 'break') return applyBreak(s, r, random);

  const team = currentTeam(s);
  const group = groupOf(s, team);
  const onEight = isOnEight(s, team);
  const pots = r.events.flatMap((e) => (e.type === 'pot' ? [e] : []));
  const potted = pots.map((e) => e.a);
  const off = r.events.flatMap((e) => (e.type === 'off' ? [e.a] : []));

  const fouls: Foul[] = [];
  if (potted.includes(0)) fouls.push('scratch');
  if (off.length) fouls.push('offTable');
  const contactAt = r.events.findIndex((e) => e.type === 'ball');
  const contact = r.events[contactAt];
  if (contact?.type !== 'ball') {
    fouls.push('noContact');
  } else {
    const first = contact.a === 0 ? contact.b : contact.a;
    const legalFirst = onEight ? first === 8 : first !== 8 && (group === null || inGroup(first, group));
    if (!legalFirst) fouls.push('wrongBall');
    const after = r.events.slice(contactAt + 1);
    if (!after.some((e) => e.type === 'cushion' || e.type === 'pot')) fouls.push('noCushion');
  }

  const eightPot = pots.find((e) => e.a === 8);
  if (eightPot || off.includes(8)) {
    let endReason: EndReason = 'potted8';
    if (!onEight) endReason = 'early8';
    else if (fouls.length) endReason = 'foulOn8';
    else if (eightPot?.pocket !== called) endReason = 'wrongPocket';
    const winner = (endReason === 'potted8' ? team : 1 - team) as 0 | 1;
    const state: GameState = { ...s, balls: r.balls, phase: 'over', winner, endReason };
    return { state, outcome: { fouls, potted, continues: false } };
  }

  const balls = withCue(r.balls);
  if (fouls.length) {
    return { state: { ...s, balls, turn: nextTurn(s), ballInHand: true }, outcome: { fouls, potted, continues: false } };
  }

  let solidsTeam = s.solidsTeam;
  const firstObject = potted.find((id) => id !== 0);
  if (solidsTeam === null && firstObject !== undefined) {
    solidsTeam = (inGroup(firstObject, 'solids') ? team : 1 - team) as 0 | 1;
  }
  const mine = solidsTeam === null ? null : solidsTeam === team ? 'solids' : 'stripes';
  const continues = mine !== null && potted.some((id) => inGroup(id, mine));
  const state: GameState = { ...s, balls, solidsTeam, ballInHand: false, turn: continues ? s.turn : nextTurn(s) };
  return { state, outcome: { fouls, potted, continues } };
}

/** The player facing an illegal break re-racks and breaks, or plays the table as it lies. */
export function chooseAfterIllegalBreak(s: GameState, choice: 'rerack' | 'playOn', random: () => number = Math.random): GameState {
  if (s.phase !== 'breakChoice') return s;
  return choice === 'rerack' ? rerack(s, random) : { ...s, phase: 'play' };
}

/** Foul: the next player gets ball in hand. An unbroken rack just passes the break on. */
export function applyShotClockExpiry(s: GameState): GameState {
  if (s.phase === 'over') return s;
  return { ...s, turn: nextTurn(s), ballInHand: true, phase: s.phase === 'break' ? 'break' : 'play' };
}

/** A team with nobody left loses. */
export function forfeit(s: GameState, team: number): GameState {
  if (s.phase === 'over') return s;
  return { ...s, phase: 'over', winner: (1 - team) as 0 | 1, endReason: 'forfeit' };
}
