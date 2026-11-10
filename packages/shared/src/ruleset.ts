import { applyFfaShot, ffaShotClockExpiry, newFfaGame, setFfaAbsent } from './ffa';
import type { SimResult } from './physics';
import {
  applyShot, applyShotClockExpiry, isFreeForAll, newGame, seatTeams, setAbsent, type Format, type GameState, type ShotOutcome,
} from './rules';

/** What `Match` needs from a game's rules, so one authority class runs every format. */
export interface RuleSet {
  newGame(random: () => number): GameState;
  applyShot(s: GameState, r: Pick<SimResult, 'events' | 'balls'>, called: number | null, random: () => number): { state: GameState; outcome: ShotOutcome };
  expire(s: GameState): GameState;
  setAbsent(s: GameState, seat: number, absent: boolean): GameState;
}

export function rulesFor(format: Format): RuleSet {
  if (isFreeForAll(format)) {
    const players = seatTeams(format).length;
    return {
      newGame: (random) => newFfaGame(players, random),
      applyShot: (s, r) => applyFfaShot(s, r),
      expire: ffaShotClockExpiry,
      setAbsent: setFfaAbsent,
    };
  }
  return { newGame: (random) => newGame(format, random), applyShot, expire: applyShotClockExpiry, setAbsent };
}
