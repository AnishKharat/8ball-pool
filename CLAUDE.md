# CLAUDE.md

Browser 8-ball pool: real physics, online multiplayer (1 vs Bot, 1v1, 1v2, 2v2), Assist and Hard modes, deployable as one Docker service.

## Every session

1. Read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) (the spec) and [MEMORY.md](MEMORY.md) (current state).
2. Work on the first unchecked milestone in MEMORY.md, unless told otherwise.
3. Before ending, update MEMORY.md: tick finished items, log decisions and known issues, and set "Next step".

## Commands

These apply once milestone 1 exists. Update this list if they change.

```bash
npm install
npm run dev        # client and server with reload
npm test           # Vitest, all workspaces
npm run typecheck
npm run build
npm start          # production server, serves the built client
docker build -t pool . && docker run -p 3000:3000 pool
```

## Rules that must not break

- `packages/shared` has no DOM or Node imports. Physics and rules live only there.
- The server is authoritative. Clients send only shot intent `{ angle, power, hitX, hitY }`, never positions or results.
- Validate every inbound socket message on the server: schema, finite numbers, ranges, turn ownership, game phase.
- The bot shoots through the same validated shot path as a human.
- Physics uses SI units and follows the formulas in PROJECT_CONTEXT.md. Don't replace it with a game-engine physics library, and don't fake spin with hacks.
- Tune physics only through named constants. Don't add per-case fudge factors.
- Hard mode must not render the ghost ball, target ball trajectory or cue ball path after contact.
- Original name and assets only. Nothing copied from Miniclip's 8 Ball Pool.

## Testing

Physics and rules changes need tests in the same change. Required physics checks:

- Sliding-to-rolling time matches `2|u₀| / (7 μs g)`.
- A head-on stun shot stops the cue ball and transfers nearly all speed.
- Follow continues forward after contact, and draw comes back.
- A 90° rule check: a rolling or stun cut leaves the balls at the expected separation.
- Side spin changes the cushion rebound angle.
- Total kinetic energy never rises during a shot. Momentum is conserved in ball-ball contact.
- Balls never tunnel at maximum speed, and a shot always terminates.

Required rules checks: every foul, group assignment, each win and loss path, and turn rotation for all four formats, including 1v2.

Before calling a feature done, run tests and typecheck. For UI or multiplayer work, run it and play it in a browser, using two or more tabs for multiplayer.

## Style

- TypeScript strict mode.
- Prefer the smallest change that fully works. No speculative options or abstractions.
- Add a dependency only if it saves real work.
- Comment only the reason code can't show.
- Commit per finished milestone item, with a short message about why.
