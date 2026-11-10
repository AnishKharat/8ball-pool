import {
  chooseAfterIllegalBreak, currentSeat, currentTeam, isOnEight, MAX_HIT, placeCue, POCKETS, rulesFor, simulateShot,
  type Format, type GameState, type Phase, type RuleSet, type ShotBroadcast, type ShotIntent,
} from '@chalkline/shared';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseShot(raw: unknown): ShotIntent | null {
  if (!isRecord(raw)) return null;
  const { angle, power, hitX, hitY } = raw;
  if (!finite(angle) || !finite(power) || !finite(hitX) || !finite(hitY)) return null;
  if (Math.abs(angle) > 2 * Math.PI || power <= 0 || power > 1) return null;
  if (Math.hypot(hitX, hitY) > MAX_HIT + 1e-9) return null;
  return { angle, power, hitX, hitY };
}

/** One game's authority. Every move, human or bot, comes through these methods. They return a refusal reason or a result. */
export class Match {
  state: GameState;
  called: number | null = null;
  /** No moves until the shot's playback has finished. */
  busyUntil = 0;
  private rules: RuleSet;

  constructor(format: Format, private random: () => number = Math.random) {
    this.rules = rulesFor(format);
    this.state = this.rules.newGame(random);
  }

  private refusal(seat: number, now: number, phases: Phase[]): string | null {
    if (now < this.busyUntil) return 'shot still playing';
    if (!phases.includes(this.state.phase)) return 'not allowed now';
    if (currentSeat(this.state) !== seat) return 'not your turn';
    return null;
  }

  place(seat: number, raw: unknown, now: number): string | null {
    const no = this.refusal(seat, now, ['break', 'play']);
    if (no) return no;
    if (!isRecord(raw) || !finite(raw.x) || !finite(raw.y)) return 'bad placement';
    const next = placeCue(this.state, raw.x, raw.y);
    if (!next) return 'illegal placement';
    this.state = next;
    return null;
  }

  call(seat: number, raw: unknown, now: number): string | null {
    const no = this.refusal(seat, now, ['play']);
    if (no) return no;
    if (!isOnEight(this.state, currentTeam(this.state))) return 'not on the 8';
    const pocket = isRecord(raw) ? raw.pocket : null;
    if (!Number.isInteger(pocket) || (pocket as number) < 0 || (pocket as number) >= POCKETS.length) return 'bad pocket';
    this.called = pocket as number;
    return null;
  }

  choose(seat: number, raw: unknown, now: number): string | null {
    const no = this.refusal(seat, now, ['breakChoice']);
    if (no) return no;
    const choice = isRecord(raw) ? raw.choice : null;
    if (choice !== 'rerack' && choice !== 'playOn') return 'bad choice';
    this.state = chooseAfterIllegalBreak(this.state, choice, this.random);
    return null;
  }

  shoot(seat: number, raw: unknown, now: number): ShotBroadcast | string {
    const no = this.refusal(seat, now, ['break', 'play']);
    if (no) return no;
    const shot = parseShot(raw);
    if (!shot) return 'bad shot';
    if (this.state.phase === 'play' && this.called === null && isOnEight(this.state, currentTeam(this.state))) {
      return 'call a pocket first';
    }
    const { frames, events, balls, duration } = simulateShot(this.state.balls, shot);
    const { state, outcome } = this.rules.applyShot(this.state, { events, balls }, this.called, this.random);
    this.state = state;
    this.called = null;
    this.busyUntil = now + duration * 1000;
    return { frames, events, duration, state, outcome };
  }

  /** Foul for running out of time, and the way out if a seat can't produce a legal move. */
  expire(): void {
    this.state = this.rules.expire(this.state);
    this.called = null;
  }

  /** A seat gave up (after the reconnect grace period) or came back. */
  setAbsent(seat: number, absent: boolean): void {
    this.state = this.rules.setAbsent(this.state, seat, absent);
  }
}
