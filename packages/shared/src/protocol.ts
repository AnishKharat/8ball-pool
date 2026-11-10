import type { Keyframe, ShotIntent, SimEvent } from './physics';
import { currentSeat, type Format, type GameState, type ShotOutcome } from './rules';

export type Mode = 'assist' | 'hard';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type RoomFormat = Exclude<Format, 'bot'>;

export const NAME_MAX = 20;
export const CODE_LENGTH = 6;
/** No 0/O, 1/I/L or 5/S, so a code read aloud or off a screen is unambiguous. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
export const SHOT_CLOCK_MS = 45_000;
export const RECONNECT_GRACE_MS = 60_000;

export interface SeatView {
  id: string;
  name: string;
  team: number;
  /** Has a live socket (bots always do). */
  connected: boolean;
  /** Left, or missed the reconnect grace period; a connected teammate covers this seat's turns. */
  gone: boolean;
  ready: boolean;
  bot: boolean;
}

/** Sent on 'room' to everyone in the room whenever anything changes. `game` is null in the lobby. */
export interface RoomView {
  code: string;
  format: Format;
  mode: Mode;
  difficulty: Difficulty | null;
  hostId: string | null;
  seats: (SeatView | null)[];
  /** Team of each seat, filled or not. */
  teams: readonly number[];
  game: GameState | null;
  /** Shot clock: the server's deadline and its clock when it sent this, so clients count down without ticks. */
  clock: { deadline: number; now: number } | null;
}

/** Sent on 'shotResult'. `state` applies once playback ends. */
export interface ShotBroadcast {
  frames: Keyframe[];
  events: SimEvent[];
  duration: number;
  state: GameState;
  outcome: ShotOutcome;
}

/** Client to server. Every payload is validated on the server; these types are what a well-behaved client sends. */
export interface ClientMessages {
  playBot: (m: { name: string; mode: Mode; difficulty: Difficulty }) => void;
  createRoom: (m: { name: string; mode: Mode; format: RoomFormat }) => void;
  joinRoom: (m: { name: string; code: string }) => void;
  resume: (m: { code: string; token: string }) => void;
  leave: () => void;
  sit: (m: { seat: number }) => void;
  ready: (m: { ready: boolean }) => void;
  start: () => void;
  shot: (m: ShotIntent) => void;
  place: (m: { x: number; y: number }) => void;
  call: (m: { pocket: number }) => void;
  choose: (m: { choice: 'rerack' | 'playOn' }) => void;
}

/** Server to client. */
export interface ServerMessages {
  /** You hold a seat: keep the token to resume after a disconnect. */
  joined: (m: { code: string; token: string; playerId: string }) => void;
  room: (v: RoomView) => void;
  shotResult: (b: ShotBroadcast) => void;
  rejected: (reason: string) => void;
  /** You are no longer in a room, with the reason. */
  left: (reason: string) => void;
}

/**
 * The seat on turn plays its own shots. Once a player is gone, a connected teammate plays theirs.
 * Shared so the client shows controls exactly when the server will accept them.
 */
export function mayAct(game: GameState, seats: readonly (SeatView | null)[], seat: number): boolean {
  const up = currentSeat(game);
  if (seat === up) return true;
  const me = seats[seat];
  return !!seats[up]?.gone && !!me && me.connected && !me.gone && game.teamOf[seat] === game.teamOf[up];
}
