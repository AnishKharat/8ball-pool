# Project Context: Multiplayer 8-Ball Pool

A browser-based 8-ball pool game with real ball physics, online multiplayer, and a bot opponent, packaged for deployment as one Docker service.

This file is the spec. Progress lives in [MEMORY.md](MEMORY.md). Working rules live in [CLAUDE.md](CLAUDE.md).

## Requirements

### Match formats

| Format | Players | Shooting order |
|---|---|---|
| 1 vs Bot | 1 human, 1 bot | H, Bot |
| 1v1 | 2 humans | A, B |
| 1v2 | 3 humans | A, B1, A, B2 (the solo player shoots every team turn) |
| 2v2 | 4 humans | A1, B1, A2, B2 |

A player who pots legally shoots again. When the turn passes, the next player in the rotation shoots.

### Shot controls

- **Aim angle:** full 360° horizontal direction, with fine adjustment.
- **Cue ball hit point:** a draggable dot on a ball diagram, giving side offset (english) and vertical offset (follow/draw). Limited to 0.5 R from centre, the real-world miscue limit.
- **Power:** a pull-back slider that maps to cue speed.
- Mouse and touch must both work.

### Difficulty modes (chosen when the room is created, applies to all players)

| | Assist mode | Hard mode |
|---|---|---|
| Cue stick and short fixed-length aim line | Yes | Yes |
| Ghost ball at first contact | Yes | No |
| Target ball trajectory after contact | Yes | No |
| Cue ball path after contact | Yes | No |

### Multiplayer

- Create a room and get a shareable code and link. No accounts.
- Lobby shows seats and teams; the host starts the match when all seats are filled.
- 45-second shot clock. Expiry is a foul that gives the opponent ball in hand.
- A disconnected player can rejoin within 60 seconds using a token stored in `sessionStorage`. Their shot clock keeps running.
- After the grace period, a teammate covers the missing player's turns. A team with nobody left forfeits.

## Architecture

```
packages/
  shared/   physics, rules state machine, protocol types (no DOM or Node APIs)
  server/   Node + Socket.IO: rooms, turn authority, bot; serves the built client
  client/   Vite + TypeScript + Canvas 2D: rendering, input, UI
```

- **Stack:** TypeScript, npm workspaces, Vite, Socket.IO, Vitest, Canvas 2D (top-down view).
- **The server is authoritative.** A client sends only shot intent: `{ angle, power, hitX, hitY }`. The server validates it, simulates the whole shot, applies the rules, and broadcasts a result.
- **Shot playback:** the server simulates faster than real time, then sends keyframes (about 30 Hz, moving balls only, positions rounded to 0.1 mm), plus events (collisions, pots) and the final state. Clients interpolate the keyframes. Clients never run their own authoritative simulation, so they can't diverge.
- **Why keyframes rather than replaying on each client:** `Math.sin` and `Math.cos` are not guaranteed identical across JS engines, and one chaotic rounding difference changes which balls drop.
- **Aim preview** runs the shared physics on the client and only affects what is drawn.
- **State:** rooms are held in memory on one instance. No database. A restart ends live matches. Deploy a single instance only.

## Multiplayer architecture

`RoomManager` (`server/src/rooms.ts`) owns every room in memory. A room holds its code, settings (format, mode, bot difficulty), seats, host, a `Match` and the shot timer. Each seat holds a player id, name, team, a live socket id or none, a reconnect token, a ready flag and a `gone` flag. A bot game is a room with the bot in seat 1. Each room is a Socket.IO room named by its code, and every update goes to the whole room.

**Lifecycle**

1. *Lobby.* The creator takes seat 0 and becomes host. Joiners take the first empty seat. Players can switch to an empty seat and toggle ready. The host starts once every seat is filled and every other player is ready. If the host leaves, host passes to the next player in seat order. When the last player leaves, the room is deleted.
2. *Playing.* `Match` validates and applies every move. After each shot, break choice or expiry, the server sets the shot clock to `max(now, end of playback) + 45 s` and broadcasts the deadline, not ticks. Expiry calls `Match.expire()`.
3. *Over.* The room stays for 5 minutes so players can read the result, then it is deleted. A sweep every 10 s also deletes any room that has had no connected human for 60 s. Room codes are 6 characters from `crypto.randomInt` over a 29-letter alphabet with no 0/O, 1/I/L or 5/S. The total room count is capped at 500.

**Messages** (types in `shared/src/protocol.ts`)

| Client to server | Payload | Allowed when |
|---|---|---|
| `playBot` | name, mode, difficulty | any time (leaves the current room) |
| `createRoom` | name, mode, format (1v1, 1v2, 2v2) | any time (leaves the current room) |
| `joinRoom` | name, code | room exists, in lobby, has a free seat |
| `resume` | code, token | token matches a seat in that room |
| `leave` | none | in a room |
| `sit` | seat index | lobby, seat empty |
| `ready` | boolean | lobby |
| `start` | none | lobby, host, all seats filled and others ready |
| `shot` | angle, power, hitX, hitY | playing, your turn or covering |
| `place` | x, y | ball in hand, your turn |
| `call` | pocket | on the 8, your turn |
| `choose` | rerack or playOn | illegal-break choice, your turn |

| Server to client | Payload |
|---|---|
| `joined` | code, token, playerId (the client keeps code and token in `sessionStorage`) |
| `room` | `RoomView`: seats, teams, host, game state, clock `{ deadline, now }` |
| `shotResult` | keyframes, events, final state, outcome |
| `rejected` | reason |
| `left` | reason (room closed, token no longer valid, seat taken over by another tab) |

Every inbound message is rate-limited per socket (token bucket: burst 30, 15 per second). Its payload is schema-checked, and names are stripped of control characters and cut to 20. The server also checks room membership, seat, turn (with cover) and phase. `ALLOWED_ORIGIN` is checked on the handshake, which also covers WebSocket upgrades.

**Reconnect, cover and forfeit**

- On disconnect the seat shows as away and a 60 s grace timer starts. The shot clock keeps running, so an away player's turn can expire as a foul.
- Within the grace period (or later, while the room exists), `resume` with the token takes the seat back. A second tab resuming the same token takes the seat over.
- When grace runs out, or a player chooses to leave mid-game, the seat is `gone`. A connected, not-gone teammate may then play that seat's turns (`mayAct` in `protocol.ts`, shared by client and server). In a lobby, an expired seat is simply freed.
- A team whose every seat is gone forfeits: `phase: 'over'`, the other team wins, `endReason: 'forfeit'`.

## Physics spec

Simulate each ball as a rigid sphere with 2D position, 2D velocity and full 3D angular velocity. Use SI units. Origin at table centre, x along the length, y across, z up.

### Constants (starting values; tune the friction and restitution values)

| Quantity | Value |
|---|---|
| Ball radius R | 0.028575 m |
| Ball mass m | 0.17 kg |
| Moment of inertia I | 2/5 m R² |
| Table playing surface | 2.54 × 1.27 m (9 ft) |
| Pocket mouth | corner about 0.114 m, side about 0.127 m |
| Gravity g | 9.81 m/s² |
| Sliding friction μs | 0.2 |
| Rolling friction μr | 0.01 |
| Spin friction μsp | 0.044 |
| Ball-ball restitution / friction | 0.95 / 0.06 |
| Cushion restitution / friction | 0.85 / 0.2 |
| Cushion contact height | 7/5 R above the table |
| Cue mass M | 0.54 kg |
| Cue speed V | 0.3 to 7.5 m/s |

### Cue strike

Horizontal cue with aim direction d and side direction s. Hit offsets `a` (side) and `b` (vertical) are in metres.

```
J = 2 m V / (1 + m/M + 5(a² + b²) / (2R²))
v = (J / m) d
r = a s + b z − sqrt(R² − a² − b²) d
ω = (r × J d) / I
```

### Ball motion on cloth

Contact point slip velocity: `u = (vx − R ωy, vy + R ωx)`.

- **Sliding (|u| > ε):** `dv/dt = −μs g û`, `dωx/dt = −(5/2)(μs g / R) ûy`, `dωy/dt = (5/2)(μs g / R) ûx`. Slip reaches zero at `t = 2|u₀| / (7 μs g)`.
- **Rolling (|u| ≈ 0):** `v` decelerates at `μr g`, with `ωx` and `ωy` held consistent with rolling.
- **All phases:** `ωz` decays toward zero at `5 μsp g / (2R)`.

`ωz` does not enter the slip velocity, so side spin alone doesn't curve the ball's path across the cloth. That is correct for a horizontal cue. Side spin shows up at cushions and ball contacts.

### Collisions

- **Ball-ball:** normal impulse with restitution, plus a Coulomb-limited tangential impulse from the surface slip at the contact. This must produce cut-induced throw, spin-induced throw, and spin transfer.
- **Cushion:** impulse at the cushion contact height (Han 2005 model), so that side spin changes the rebound angle and spin changes on impact.
- **Pockets:** rounded jaw segments the ball can rattle off, and a capture test when the ball's centre passes the drop point. A ball is not captured merely by overlapping the mouth.

### Integration

- Fixed 1 ms step, with the closed-form per-phase update above.
- Inside each step, find the earliest ball-ball or cushion time of impact and advance exactly to it. Overlap detection after the fact would shift contact normals and make cut angles wrong.
- The shot ends when all balls are at rest. Hard cap of 60 s simulated time.

### References

Han, "On the Motion of a Pool Ball" (2005). Leckie & Greenspan, "An Event-Based Pool Physics Simulator" (2006). Alciatore, Dr. Dave's technical proofs (billiards.colostate.edu).

## Rules (8-ball, WPA-based with stated simplifications)

- **Rack:** standard triangle with the 8 in the centre and one solid and one stripe in the back corners. Randomised otherwise. The server generates it.
- **Break:** from behind the head string. Legal if a ball is potted or at least 4 object balls reach a cushion. An illegal break gives the opponent the choice to re-rack and break, or play on.
- **8 potted on the break:** re-rack, same breaker.
- **Open table:** after the break until a player legally pots a ball on a non-break shot. That assigns groups to the whole team.
- **Legal shot:** the cue ball first hits a ball of your group (any non-8 ball on an open table). Then a ball is potted or any ball hits a cushion.
- **Fouls:** scratch, wrong ball first, no contact, no cushion after contact, ball off the table, shot clock expiry. The opponent gets ball in hand anywhere on the table. Validate that placement doesn't overlap another ball.
- **Calling:** only the 8 must be called, by clicking a pocket.
- **Win:** pot the 8 in the called pocket on a legal shot after clearing your group.
- **Loss:** pot the 8 early, into the wrong pocket, or together with a foul.

## Bot

Runs on the server and uses only the same shot intent as a human.

1. List candidate shots (ghost ball aim for each legal ball and pocket pair, plus bank shots if cheap).
2. Filter out blocked lines.
3. Simulate the best candidates with the real physics, and score them by result and cue ball position.
4. Add Gaussian noise to the angle and power according to difficulty (easy, medium, hard).
5. Wait 1 to 2 seconds before shooting so it reads as a turn.

## Security and validation (server)

- Validate every inbound message: schema, finite numbers, ranges, room membership, whose turn it is, game phase.
- Rate limit by socket. Cap room count and name length. Escape names when rendering.
- Room codes must be hard to guess (`crypto.randomInt`, at least 6 characters from an unambiguous alphabet).
- Set `ALLOWED_ORIGIN` from the environment in production.
- Known limit: Assist preview is client-side, so a modified client could draw a preview in Hard mode. This is accepted because the physics has to ship to the client either way.

## Deployment

- Multi-stage `Dockerfile`, non-root user. One process serves the client and the WebSocket on `PORT`.
- `GET /healthz` for health checks.
- Environment variables: `PORT`, `ALLOWED_ORIGIN`. Document them in `.env.example`.
- Graceful shutdown on `SIGTERM`.
- GitHub Actions CI: typecheck, test, build.
- Config for one host (Render by default; check its current WebSocket support and free-tier idle behaviour first). README has the deployment steps.
- Run one instance. Horizontal scaling would need a Redis adapter and shared room state, which is out of scope.

## Out of scope for v1

Accounts, rankings, persistence, spectators, chat, bots filling seats in team matches, 3D rendering, elevated cue shots (jump and true masse), other game types.

## Legal and branding

8-ball is a public cue sport, so the rules and physics are free to use. The working title must not use the "8 Ball Pool" branding owned by Miniclip. Do not copy its art, UI, sounds or progression. All assets must be original or properly licensed.
