# Memory: Progress Tracker

Update this at the end of every working session. Keep it short and current. Rewrite stale entries rather than piling on.

## Status

**Current milestone:** 8, deployment readiness
**Next step:** Serve the built client and /healthz from `npm start`, graceful shutdown, then build the Docker image and play against it.
**Last updated:** 2026-11-11 (redesign and milestone 6 done)

## Milestones

### 1. Scaffold
- [x] npm workspaces (`shared`, `server`, `client`), strict TypeScript, Vitest
- [x] Root scripts: `dev`, `test`, `typecheck`, `build`, `start`
- [x] `git init`, `.gitignore`, first commit

### 2. Physics core (`shared`)
- [x] Constants, ball state, cue strike
- [x] Sliding, rolling and spin motion
- [x] Ball-ball collisions with throw and spin transfer
- [x] Cushion collisions (Han model)
- [x] Pockets with jaws and capture
- [x] Time-of-impact stepping and `simulateShot()` returning keyframes and events
- [x] All physics tests from CLAUDE.md pass

### 3. Local playable table (`client`)
- [x] Canvas table, balls and keyframe playback
- [x] Aim, hit point and power controls (mouse and touch)
- [x] Assist preview and Hard mode
- [x] Ball-in-hand placement and 8-ball pocket calling

### 4. Rules (`shared`)
- [x] Rack, break, open table, group assignment
- [x] Fouls, ball in hand, win and loss
- [x] Turn rotation for all four formats
- [x] All rules tests from CLAUDE.md pass

### 5. Bot
- [x] Candidate shots, simulated scoring, noise by difficulty
- [x] Playable 1 vs Bot through the server

### 6a. Visual redesign (client only)
- [x] Centred, aspect-true table that refits on resize and DPR change; portrait turns the table vertical
- [x] HUD around the table: teams, groups with balls left, turn, shot clock ring, power, spin selector, potted tray
- [x] Lit balls with contact shadow; stripes and numbers roll with a per-ball quaternion
- [x] Wood rails with bevels, lit cushions, cloth weave and vignette, deep pockets, diamonds; static table pre-rendered
- [x] Shaded cue that draws back with power and strikes; potted balls sink and darken
- [x] Reduced motion; frame cost checked at 4x CPU throttle on a 390x844 @3x viewport

### 6. Multiplayer
- [x] Rooms, codes, lobby, seats and teams
- [x] Validated shot flow and result broadcast
- [x] Shot clock, reconnect, teammate cover, forfeit
- [x] 1v1, 1v2 and 2v2 each played through in multiple browser tabs

### 7. Polish
- [ ] Original visual style, sounds from collision events
- [ ] Responsive layout, mobile check, accessible menus
- [x] Error and disconnected states in the UI

### 8. Deployment readiness
- [ ] Dockerfile, `/healthz`, `.env.example`, graceful shutdown
- [x] Rate limits, origin check, room caps
- [x] GitHub Actions CI (written; runs on the first push, not yet seen running)
- [ ] Host config and README deployment steps
- [ ] Docker image built and a full match played against it

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-11 | Assist shows the ghost ball and only 0.2 m of the target ball's direction; the cue ball path after contact is gone | User asked for less assist. Spec table in PROJECT_CONTEXT.md updated to match. |
| 2026-11-11 | A socket handshake with no Origin header is allowed even when ALLOWED_ORIGIN is set | Browsers omit Origin on same-origin GETs, so the deployed game refused every player. Cross-site pages and WebSocket upgrades always send it. |
| 2026-11-05 | The server sends shot keyframes; clients don't simulate results | Avoids divergence between JS engines |
| 2026-11-05 | 1v2 order is A, B1, A, B2 | Gives each side the same number of turns (user can change this) |
| 2026-11-05 | Hard mode hides ghost ball and post-contact paths, keeps a short aim line | The request was to hide the target ball's trajectory |
| 2026-11-05 | Horizontal cue only in v1 | Jump and masse need 3D ball flight |
| 2026-11-05 | Ball in hand is a flag, not a phase: drag the cue ball or aim, with no confirm step | Fewer taps, same validation through `canPlaceCue` |
| 2026-11-05 | Working title is Chalkline | Already in package names; avoids Miniclip branding |
| 2026-11-05 | Keeping the turn requires potting your own group; potting only the other group is legal but ends it | Spec says "pots legally"; this is the standard 8-ball reading (user can change this) |
| 2026-11-05 | If both groups drop on an open table, the first ball down decides | Spec is silent; simplest unambiguous rule |
| 2026-11-05 | The 8 on the break re-racks even with a scratch; a break has no wrong-ball or no-cushion foul | Spec gives the break its own legality test |
| 2026-11-05 | Shot clock expiry on an unbroken rack passes the break on; in the illegal-break choice it means play on with ball in hand | An unbroken rack can't be played as open table |
| 2026-11-05 | Teammate cover and forfeit are left to milestone 6 | They depend on connection state, which only the server has |
| 2026-11-05 | Ball in hand and the called pocket are separate validated messages (`place`, `call`); `shot` carries only the four intent fields | Keeps the shot message to exactly what CLAUDE.md allows |
| 2026-11-05 | Bot has no bank shot candidates; it only finds kicks through a fan of simulated angles when no ball can be hit directly | Spec says banks only "if cheap" |

| 2026-11-11 | Balls are shaded per pixel into one small sprite each, repainted only after the ball rolls | Canvas 2D can't texture a sphere; the per-pixel cost is tiny at ball size, and the lighting table is shared |
| 2026-11-11 | Portrait turns the table 90 degrees, and each ball a quarter turn with it | Numbers stay upright on screen; orientation is visual only |
| 2026-11-11 | Cloth is teal, rails dark walnut, accents chalk blue and brass | Original look, distinct from Miniclip's green and blue |

| 2026-11-11 | Start needs every seat filled and every non-host player ready; the host's Start counts as ready | The lobby shows ready state, so it should gate the start |
| 2026-11-11 | Leaving mid-game gives the seat up at once (as if grace ran out); it takes two taps | A deliberate leave shouldn't hold the game for 60 s |
| 2026-11-11 | A token can resume its seat after the grace period too, while the room exists; a second tab with the same token takes the seat over | Simplest rule; cover and forfeit already handle the gap |
| 2026-11-11 | Shot clock runs in bot games too | Spec gives one 45 s clock; the bot always shoots in 1 to 2 s |
| 2026-11-11 | Deadline sent with the server's clock reading; client counts down from the difference | Cancels clock skew without ticks |
| 2026-11-11 | Rate limit: token bucket per socket, burst 30, 15 per second; names cut to 20 printable characters; room cap 500 | Play sends a few messages per shot, so this only stops floods |
| 2026-11-11 | No rematch button and no live view of the opponent's aim | Not asked for; players return to the menu |
| 2026-11-11 | Bot test seeds its noise | It failed 1 run in 4 and would make CI flaky |

| 2026-11-11 | The client closes its socket on unload (`closeOnBeforeunload`) | Without it a closed tab showed as away only after the 20 to 45 s ping timeout |
| 2026-11-11 | With `ALLOWED_ORIGIN` unset, the server allows only `RENDER_EXTERNAL_URL` when Render sets it, else any origin | Render works with no configuration; a custom domain needs the variable |
| 2026-11-11 | Static files, `/healthz` and the SPA fallback are a small `node:http` handler, no Express | Four routes don't justify a dependency |

## Physics tuning log

Record constant changes and what prompted them.

(none yet)

## Known issues

- **Weak-looking break (decision needed).** At 95% power the rack barely spreads: median ball moves about 5 cm, though breaks stay legal (about 5.9 balls reach a rail, about 1 pot, 12 trials). Cause measured: sequential pairwise contacts act like a Newton's cradle, so one ball leaves at 8.3 m/s while most stay near 0, and the rails take 51% of the energy (ball impacts 23%, cloth 22%). Restitution 0.95-0.98 and rack gap 0.1-2 mm make no difference, so don't tune those. A real fix means resolving near-simultaneous contacts together, which changes the integration spec.
- Bot thinking blocks the server thread: median 79 ms, p95 264 ms, worst 389 ms over 6 bot games. Fine for one game; recheck with many rooms (a worker thread is the likely fix). `MAX_SIMULATED` in `bot.ts` is the cost control.
- Bot strength is lightly measured: hard beat easy 4 of 6, about 22 shots a game. Not tuned against human play.
- Ball numbers on a 390 px-wide phone are about 6 CSS px tall: legible on a 3x screen, small. Not checked on a physical phone.

## Session log

- 2026-11-05: Wrote PROJECT_CONTEXT.md, CLAUDE.md and MEMORY.md. Built milestones 1-2 (this file wasn't updated then).
- 2026-11-05: Milestone 3. Table, controls, assist and hard preview, ball in hand, pocket calling. Played in headless Chrome over DevTools with real mouse, touch and keyboard input, since the Chrome extension wasn't connected. Not tried on a physical phone.
- 2026-11-05: Milestone 4. Rules as pure functions in `shared/src/rules.ts`, 48 tests in `game.test.ts`. 17 deliberate rule breaks were all caught by the tests. No browser replay: the only client change is using the shared `freeCueSpot`.
- 2026-11-05: Milestone 5. `Match` authority class, Socket.IO server, bot, client now server-driven. Played a full game against the hard bot in headless Chrome through the dev server, with no page errors or refused moves. The break issue above is still open and the user hasn't chosen, so bot scoring may need rechecking if the break changes.
- 2026-11-11: Visual redesign (6a) and milestone 6. Room tests run through real sockets. Played complete matches in headless Chrome over CDP, one window per player: 1v1 (16 shots), 1v2 in Hard mode (16), 2v2 (16) and vs Bot (13). A driver (`.scratch/drive.ts`, not committed) planned shots with the bot's planner and entered them through real pointer drags, arrow keys, the spin pad and the power slider. Each multiplayer match included a page close and rejoin from sessionStorage. Every tab agreed on the table after every shot, and there were no page errors. Chrome extension not connected; no physical phone.
