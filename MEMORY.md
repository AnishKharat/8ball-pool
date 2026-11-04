# Memory: Progress Tracker

Update this at the end of every working session. Keep it short and current. Rewrite stale entries rather than piling on.

## Status

**Current milestone:** 4, not started
**Next step:** Rules state machine in `packages/shared/src/rules.ts`: break, open table, groups, fouls, win and loss, turn rotation. `rackBalls` and `canPlaceCue` already exist there.
**Last updated:** 2026-11-05 (milestones 1-3 done)

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
- [ ] Break, open table, group assignment (rack is done)
- [ ] Fouls, ball in hand, win and loss
- [ ] Turn rotation for all four formats
- [ ] All rules tests from CLAUDE.md pass

### 5. Bot
- [ ] Candidate shots, simulated scoring, noise by difficulty
- [ ] Playable 1 vs Bot through the server

### 6. Multiplayer
- [ ] Rooms, codes, lobby, seats and teams
- [ ] Validated shot flow and result broadcast
- [ ] Shot clock, reconnect, teammate cover, forfeit
- [ ] 1v1, 1v2 and 2v2 each played through in multiple browser tabs

### 7. Polish
- [ ] Original visual style, sounds from collision events
- [ ] Responsive layout, mobile check, accessible menus
- [ ] Error and disconnected states in the UI

### 8. Deployment readiness
- [ ] Dockerfile, `/healthz`, `.env.example`, graceful shutdown
- [ ] Rate limits, origin check, room caps
- [ ] GitHub Actions CI
- [ ] Host config and README deployment steps
- [ ] Docker image built and a full match played against it

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-05 | The server sends shot keyframes; clients don't simulate results | Avoids divergence between JS engines |
| 2026-11-05 | 1v2 order is A, B1, A, B2 | Gives each side the same number of turns (user can change this) |
| 2026-11-05 | Hard mode hides ghost ball and post-contact paths, keeps a short aim line | The request was to hide the target ball's trajectory |
| 2026-11-05 | Horizontal cue only in v1 | Jump and masse need 3D ball flight |
| 2026-11-05 | Ball in hand is a flag, not a phase: drag the cue ball or aim, with no confirm step | Fewer taps, same validation through `canPlaceCue` |
| 2026-11-05 | Working title is Chalkline | Already in package names; avoids Miniclip branding |

## Physics tuning log

Record constant changes and what prompted them.

(none yet)

## Known issues

- **Weak-looking break (decision needed).** At 95% power the rack barely spreads: median ball moves about 5 cm, though breaks stay legal (about 5.9 balls reach a rail, about 1 pot, 12 trials). Cause measured: sequential pairwise contacts act like a Newton's cradle, so one ball leaves at 8.3 m/s while most stay near 0, and the rails take 51% of the energy (ball impacts 23%, cloth 22%). Restitution 0.95-0.98 and rack gap 0.1-2 mm make no difference, so don't tune those. A real fix means resolving near-simultaneous contacts together, which changes the integration spec.
- Client simulates shots locally and the bar's Ball in hand and Call the 8 buttons stand in for rules (`shortcut:` in `client/src/main.ts`). Replace in milestones 4-6.
- Cosmetic, for milestone 7: pocket facing lines overlap the rail; no portrait layout yet.

## Session log

- 2026-11-05: Wrote PROJECT_CONTEXT.md, CLAUDE.md and MEMORY.md. Built milestones 1-2 (this file wasn't updated then).
- 2026-11-05: Milestone 3. Table, controls, assist and hard preview, ball in hand, pocket calling. Played in headless Chrome over DevTools with real mouse, touch and keyboard input, since the Chrome extension wasn't connected. Not tried on a physical phone.
