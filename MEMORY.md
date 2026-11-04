# Memory: Progress Tracker

Update this at the end of every working session. Keep it short and current. Rewrite stale entries rather than piling on.

## Status

**Current milestone:** 1, not started
**Next step:** Scaffold the npm workspaces and get `npm test` and `npm run typecheck` passing.
**Last updated:** 2026-11-05 (planning docs written; no code yet)

## Milestones

### 1. Scaffold
- [ ] npm workspaces (`shared`, `server`, `client`), strict TypeScript, Vitest
- [ ] Root scripts: `dev`, `test`, `typecheck`, `build`, `start`
- [ ] `git init`, `.gitignore`, first commit

### 2. Physics core (`shared`)
- [ ] Constants, ball state, cue strike
- [ ] Sliding, rolling and spin motion
- [ ] Ball-ball collisions with throw and spin transfer
- [ ] Cushion collisions (Han model)
- [ ] Pockets with jaws and capture
- [ ] Time-of-impact stepping and `simulateShot()` returning keyframes and events
- [ ] All physics tests from CLAUDE.md pass

### 3. Local playable table (`client`)
- [ ] Canvas table, balls and keyframe playback
- [ ] Aim, hit point and power controls (mouse and touch)
- [ ] Assist preview and Hard mode
- [ ] Ball-in-hand placement and 8-ball pocket calling

### 4. Rules (`shared`)
- [ ] Rack, break, open table, group assignment
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

## Physics tuning log

Record constant changes and what prompted them.

(none yet)

## Known issues

(none yet)

## Session log

- 2026-11-05: Wrote PROJECT_CONTEXT.md, CLAUDE.md and MEMORY.md. No code yet.
