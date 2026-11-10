import { currentSeat, groupOf, type GameState } from '@chalkline/shared';
import { ballCss, ballPattern } from './sphere';

export interface HudSeat { name: string; team: number; connected: boolean; gone: boolean }

const CLOCK_LEN = 2 * Math.PI * 19; // matches the ring's r in index.html

function chip(id: number, gone = false): HTMLElement {
  const c = document.createElement('span');
  const pattern = ballPattern(id);
  c.className = `chip${pattern === 'stripe' ? ' st' : pattern === 'cap' ? ' cap' : ''}${gone ? ' gone' : ''}`;
  c.style.setProperty('--c', ballCss(id));
  const n = document.createElement('i');
  n.textContent = String(id);
  c.append(n);
  c.title = `Ball ${id}`;
  return c;
}

/** Team cards: who is in each team, who is up, and each team's group with the balls it has left. */
export function renderTeams(game: GameState | null, seats: HudSeat[], mySeat: number) {
  const up = game && game.phase !== 'over' ? currentSeat(game) : -1;
  for (const team of [0, 1]) {
    const card = document.getElementById(`team${team}`)!;
    const players = card.querySelector('.players')!;
    players.replaceChildren(
      ...seats.flatMap((s, i) => {
        if (s.team !== team) return [];
        const row = document.createElement('div');
        row.className = `pl${i === up ? ' up' : ''}${s.gone || !s.connected ? ' off' : ''}`;
        const name = document.createElement('span');
        name.textContent = i === mySeat ? `${s.name} (you)` : s.name;
        row.append(name);
        return [row];
      }),
    );
    card.classList.toggle('active', up !== -1 && seats[up]?.team === team);
    const group = game ? groupOf(game, team) : null;
    card.querySelector('.glabel')!.textContent = group ?? 'open table';
    const onTable = new Set(game?.balls.map((b) => b.id));
    const ids = group === 'solids' ? [1, 2, 3, 4, 5, 6, 7, 8] : group === 'stripes' ? [9, 10, 11, 12, 13, 14, 15, 8] : [];
    card.querySelector('.chips')!.replaceChildren(...ids.map((id) => chip(id, !onTable.has(id))));
  }
}

/** Free-for-all scoreboard: every player's name, points, turn and connection, with the leaders marked. */
export function renderScores(game: GameState, seats: HudSeat[], mySeat: number) {
  const up = game.phase !== 'over' ? currentSeat(game) : -1;
  const best = Math.max(...game.scores);
  const board = document.getElementById('scores')!;
  board.style.setProperty('--n', String(seats.length));
  board.replaceChildren(
    ...seats.map((s, i) => {
      const lead = best > 0 && game.scores[i] === best;
      const cell = document.createElement('div');
      cell.className = `sc${i === up ? ' up' : ''}${lead ? ' lead' : ''}${s.gone || !s.connected ? ' off' : ''}`;
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = i === mySeat ? `${s.name} (you)` : s.name;
      const pts = document.createElement('b');
      pts.textContent = String(game.scores[i]);
      const state = document.createElement('span');
      state.className = 'st8';
      state.textContent = s.gone ? 'left' : !s.connected ? 'away' : lead ? 'leads' : i === up ? 'up' : '';
      cell.append(name, pts, state);
      cell.setAttribute('aria-label', `${name.textContent}: ${game.scores[i]} points${state.textContent ? `, ${state.textContent}` : ''}`);
      return cell;
    }),
  );
}

export function renderTray(potted: readonly number[]) {
  document.getElementById('tray')!.replaceChildren(...potted.map((id) => chip(id)));
}

let lastClock = '';
/** Remaining time as a ring and whole seconds; null hides it. Touches the DOM only when the shown value changes. */
export function renderClock(leftMs: number | null, totalMs: number) {
  const key = leftMs === null ? '' : String(Math.ceil(leftMs / 100));
  if (key === lastClock) return;
  lastClock = key;
  const clock = document.getElementById('clock')!;
  clock.hidden = leftMs === null;
  if (leftMs === null) return;
  const left = Math.max(0, leftMs);
  document.getElementById('clockArc')!.setAttribute('stroke-dashoffset', String(CLOCK_LEN * (1 - left / totalMs)));
  document.getElementById('clockText')!.textContent = String(Math.ceil(left / 1000));
  clock.classList.toggle('low', left < 10000);
}
