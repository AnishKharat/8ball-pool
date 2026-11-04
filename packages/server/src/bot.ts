import {
  applyShot, BALL_R, canPlaceCue, currentTeam, FOOT_SPOT_X, groupOf, isOnEight, POCKETS, simulateShot,
  type BallPos, type Difficulty, type GameState, type ShotIntent,
} from '@chalkline/shared';

const DEG = Math.PI / 180;
const NOISE: Record<Difficulty, { angle: number; power: number }> = {
  easy: { angle: 1.5 * DEG, power: 0.1 },
  medium: { angle: 0.6 * DEG, power: 0.05 },
  hard: { angle: 0.15 * DEG, power: 0.02 },
};
const MIN_CUT_COS = 0.25; // past about 75 degrees of cut, a ghost ball aim isn't a real shot
const MAX_SIMULATED = 6; // candidates that get real physics; each costs simulations on the shared server thread
const POWERS = [0.2, 0.35, 0.6];
const BREAK_POWER = 1;
const SAFETY_POWER = 0.3;
const FAN_ANGLES = 24; // tried when no ball can be hit directly, so a rail kick can still be found
const FAN_POWER = 0.4;
const PLACE_BEHIND = 0.25; // ball in hand: distance behind the ghost ball, straight in
const WIN = 1000;
const FOUL = -100;
const KEEP_TURN = 100;
const OWN_SHOT_VALUE = 5; // per pottable ball left for us after a shot that keeps the turn
const THEIR_SHOT_VALUE = -2; // per pottable ball left for the opponent

export interface BotMove {
  place?: { x: number; y: number };
  called: number | null;
  shot: ShotIntent;
}

interface Candidate { cueX: number; cueY: number; angle: number; pocket: number; ease: number }

function clearOf(balls: readonly BallPos[], ax: number, ay: number, bx: number, by: number, skip: number[]): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  return balls.every((b) => {
    if (skip.includes(b.id)) return true;
    const u = Math.max(0, Math.min(1, ((b.x - ax) * dx + (b.y - ay) * dy) / len2));
    return Math.hypot(b.x - ax - u * dx, b.y - ay - u * dy) >= 2 * BALL_R;
  });
}

function legalTargets(s: GameState): BallPos[] {
  const team = currentTeam(s);
  if (isOnEight(s, team)) return s.balls.filter((b) => b.id === 8);
  const group = groupOf(s, team);
  return s.balls.filter((b) => {
    if (b.id === 0 || b.id === 8) return false;
    return group === null || (group === 'solids') === b.id < 8;
  });
}

/** Ghost ball aim for each legal ball and pocket, with blocked lines filtered out, easiest first. */
export function listCandidates(s: GameState): Candidate[] {
  const cue = s.balls.find((b) => b.id === 0);
  const out: Candidate[] = [];
  if (!cue) return out;
  for (const t of legalTargets(s)) {
    POCKETS.forEach((p, pocket) => {
      const toPocket = Math.hypot(p.aimX - t.x, p.aimY - t.y);
      const dx = (p.aimX - t.x) / toPocket;
      const dy = (p.aimY - t.y) / toPocket;
      const ghostX = t.x - dx * 2 * BALL_R;
      const ghostY = t.y - dy * 2 * BALL_R;
      const cueX = s.ballInHand ? ghostX - dx * PLACE_BEHIND : cue.x;
      const cueY = s.ballInHand ? ghostY - dy * PLACE_BEHIND : cue.y;
      if (s.ballInHand && !canPlaceCue(s.balls, cueX, cueY, false)) return;
      const toGhost = Math.hypot(ghostX - cueX, ghostY - cueY);
      if (toGhost < 1e-6) return;
      const cos = ((ghostX - cueX) * dx + (ghostY - cueY) * dy) / toGhost;
      if (cos < MIN_CUT_COS) return;
      if (!clearOf(s.balls, cueX, cueY, ghostX, ghostY, [0, t.id])) return;
      if (!clearOf(s.balls, t.x, t.y, p.aimX, p.aimY, [0, t.id])) return;
      out.push({ cueX, cueY, pocket, angle: Math.atan2(ghostY - cueY, ghostX - cueX), ease: cos / (1 + toGhost + toPocket) });
    });
  }
  return out.sort((a, b) => b.ease - a.ease);
}

function score(s: GameState, balls: BallPos[], shot: ShotIntent, called: number | null): number {
  const { events, balls: end } = simulateShot(balls, shot);
  const team = currentTeam(s);
  const { state, outcome } = applyShot({ ...s, balls }, { events, balls: end }, called);
  if (state.phase === 'over') return state.winner === team ? WIN : -WIN;
  let total = outcome.fouls.length ? FOUL : 0;
  if (outcome.continues) total += KEEP_TURN;
  // Whoever shoots next, count what the table leaves them. Geometry only, so this stays cheap.
  total += listCandidates(state).length * (currentTeam(state) === team ? OWN_SHOT_VALUE : THEIR_SHOT_VALUE);
  return total;
}

function moved(balls: readonly BallPos[], x: number, y: number): BallPos[] {
  return balls.map((b) => (b.id === 0 ? { id: 0, x, y } : b));
}

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function withNoise(shot: ShotIntent, difficulty: Difficulty, random: () => number): ShotIntent {
  const n = NOISE[difficulty];
  const angle = shot.angle + gaussian(random) * n.angle;
  return {
    ...shot,
    // atan2 brings the angle back into range for the server's validation.
    angle: Math.atan2(Math.sin(angle), Math.cos(angle)),
    power: Math.max(0.01, Math.min(1, shot.power * (1 + gaussian(random) * n.power))),
  };
}

function nearestPocket(x: number, y: number): number {
  let best = 0;
  POCKETS.forEach((p, i) => {
    if (Math.hypot(p.aimX - x, p.aimY - y) < Math.hypot(POCKETS[best].aimX - x, POCKETS[best].aimY - y)) best = i;
  });
  return best;
}

function bestWithoutPot(s: GameState, called: number | null): ShotIntent {
  const cue = s.balls.find((b) => b.id === 0)!;
  const direct = legalTargets(s)
    .filter((t) => clearOf(s.balls, cue.x, cue.y, t.x, t.y, [0, t.id]))
    .map((t) => ({ angle: Math.atan2(t.y - cue.y, t.x - cue.x), power: SAFETY_POWER, hitX: 0, hitY: 0 }));
  const shots = direct.length
    ? direct
    : Array.from({ length: FAN_ANGLES }, (_, i) => ({ angle: (i * 2 * Math.PI) / FAN_ANGLES - Math.PI, power: FAN_POWER, hitX: 0, hitY: 0 }));
  let best = shots[0];
  let bestScore = -Infinity;
  for (const shot of shots) {
    const v = score(s, s.balls, shot, called);
    if (v > bestScore) {
      bestScore = v;
      best = shot;
    }
  }
  return best;
}

export function chooseMove(s: GameState, difficulty: Difficulty, random: () => number = Math.random): BotMove {
  if (s.phase === 'break') {
    const cue = s.balls.find((b) => b.id === 0)!;
    const shot = { angle: Math.atan2(-cue.y, FOOT_SPOT_X - cue.x), power: BREAK_POWER, hitX: 0, hitY: 0 };
    return { called: null, shot: withNoise(shot, difficulty, random) };
  }

  const onEight = isOnEight(s, currentTeam(s));
  let bestScore = -Infinity;
  let best: BotMove | null = null;
  for (const c of listCandidates(s).slice(0, MAX_SIMULATED)) {
    const called = onEight ? c.pocket : null;
    const balls = moved(s.balls, c.cueX, c.cueY);
    for (const power of POWERS) {
      const shot = { angle: c.angle, power, hitX: 0, hitY: 0 };
      const v = score(s, balls, shot, called);
      if (v > bestScore) {
        bestScore = v;
        best = { called, shot, place: s.ballInHand ? { x: c.cueX, y: c.cueY } : undefined };
      }
    }
  }

  // A pot that only ever fouls or loses isn't worth more than a safe hit.
  if (!best || bestScore < 0) {
    const eight = s.balls.find((b) => b.id === 8);
    const called = onEight && eight ? nearestPocket(eight.x, eight.y) : null;
    const shot = bestWithoutPot(s, called);
    if (!best || score(s, s.balls, shot, called) > bestScore) best = { called, shot };
  }
  return { ...best, shot: withNoise(best.shot, difficulty, random) };
}

/** Facing an illegal break: play on if there's a shot, otherwise take the re-rack and the break. */
export function chooseAfterBreak(s: GameState): 'rerack' | 'playOn' {
  return listCandidates(s).length ? 'playOn' : 'rerack';
}
