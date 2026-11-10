import type { RoomView } from '@chalkline/shared';

const FORMAT_TEXT: Record<string, string> = { bot: 'vs Bot', '1v1': '1 vs 1', '1v2': '1 vs 2', '2v2': '2 vs 2' };
export const TEAM_NAMES = ['Team A', 'Team B'];

const make = (tag: string, cls: string, text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

/** Seats grouped by team, with sit buttons on empty seats. Names go in as text only. */
export function renderLobby(v: RoomView, me: string | null, sit: (seat: number) => void) {
  document.getElementById('roomCode')!.textContent = v.code;
  document.getElementById('lobbyInfo')!.textContent = `${FORMAT_TEXT[v.format]} · ${v.mode === 'hard' ? 'Hard' : 'Assist'} mode`;
  for (const team of [0, 1]) {
    const col = document.getElementById(`lt${team}`)!;
    const rows: HTMLElement[] = [make('h3', '', TEAM_NAMES[team])];
    v.seats.forEach((p, i) => {
      if (v.teams[i] !== team) return;
      const row = make('div', `seat${p ? '' : ' empty'}${p?.id === me ? ' me' : ''}`);
      if (!p) {
        row.append(make('span', 'nm', 'Empty seat'));
        const b = make('button', '', 'Sit here');
        b.addEventListener('click', () => sit(i));
        row.append(b);
      } else {
        row.append(make('span', 'nm', p.id === me ? `${p.name} (you)` : p.name));
        const badges = make('span', 'row');
        if (p.id === v.hostId) badges.append(make('span', 'badge host', 'host'));
        if (!p.connected) badges.append(make('span', 'badge', 'reconnecting'));
        else if (p.id !== v.hostId) badges.append(make('span', `badge${p.ready ? ' ok' : ''}`, p.ready ? 'ready' : 'not ready'));
        row.append(badges);
      }
      rows.push(row);
    });
    col.replaceChildren(...rows);
  }
  const mine = v.seats.find((p) => p?.id === me);
  const host = v.hostId === me;
  const readyBtn = document.getElementById('readyBtn') as HTMLButtonElement;
  readyBtn.hidden = host;
  readyBtn.textContent = mine?.ready ? 'Not ready' : 'Ready';
  readyBtn.setAttribute('aria-pressed', String(!!mine?.ready));
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  startBtn.hidden = !host;
  const missing = v.seats.filter((p) => !p).length;
  const waiting = v.seats.filter((p) => p && p.id !== v.hostId && !p.ready).length;
  startBtn.disabled = missing > 0 || waiting > 0;
  document.getElementById('lobbyNote')!.textContent = missing
    ? `Waiting for ${missing} more player${missing > 1 ? 's' : ''}. Share the code or link.`
    : waiting
      ? 'Waiting for everyone to be ready.'
      : host ? 'Everyone is here. Start when you like.' : 'Waiting for the host to start.';
}
