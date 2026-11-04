import type { Keyframe, SimEvent } from './physics';
import type { GameState, ShotOutcome } from './rules';

export type Mode = 'assist' | 'hard';
export type Difficulty = 'easy' | 'medium' | 'hard';

/** Sent on 'state' whenever the game changes without a shot. */
export interface RoomView { game: GameState; mode: Mode; seat: number }

/** Sent on 'shotResult'. `state` applies once playback ends. */
export interface ShotBroadcast {
  frames: Keyframe[];
  events: SimEvent[];
  duration: number;
  state: GameState;
  outcome: ShotOutcome;
}
