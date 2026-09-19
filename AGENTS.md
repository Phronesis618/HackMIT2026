# AGENTS.md — working rules for every agent in this repo

Three humans each run one coding agent against this repository. GitHub is the source of
truth. Nobody waits for the whole game to exist; everyone builds against the committed
contracts and fixtures. **Codex and Devin: read this file and your START prompt in full
before editing anything — you will not see Cursor-specific rules.**

## Who owns what

| Agent            | Branch              | Owned paths                                                                                                                                                                                                                       |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** Fable      | `feat/core`         | `src/shared/`, `src/sim/`, `src/client/main.tsx`, `src/client/game/`, `src/client/transport/`, `src/server/index.ts`, `src/server/app.ts`, `src/server/config.ts`, `src/server/network/`, root config, `package.json` + lockfile, `.github/`, `tests/shared/`, `tests/sim/`, `tests/integration/` |
| **B** Codex      | `feat/generation`   | `src/server/generation/`, `prompts/runtime/`, `fixtures/worlds/`, `tests/generation/`, `docs/handoffs/B.md`, `docs/evidence/codex.md`                                                                                            |
| **C** Devin      | `feat/presentation` | `src/client/render/`, `src/client/audio/`, `src/client/ui/`, `src/client/styles/`, `src/chronicle/`, `src/client/chronicle/`, `design/`, `tests/presentation/`, `docs/handoffs/C.md`, `docs/evidence/devin.md`                    |

Everything not listed belongs to A. A is the integration/merge owner.

## Hard rules

1. **Only A edits shared contracts and root dependencies.** That means `src/shared/**`,
   `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
   `.github/**`. Need a change? Post an *integration request*: a comment on your workstream
   issue (or a new issue) titled `[integration] <what>` with the smallest patch that would
   unblock you and why. A applies it on `main` quickly. Meanwhile, keep working against the
   current contract. (Small **additive** changes you urgently need may be pushed directly if
   `npm run check` stays green — say so in the commit message so A can review.)
2. **Validate at boundaries, never trust generated content.** Model output is data
   (`WorldRecipe`), compiled by trusted code into `RoomSpec`/`ArtRecipe`, validated with the
   Zod schemas in `src/shared/contracts.ts`. No generated HTML/JS/SVG/URLs/expressions, ever.
3. **Registry IDs are closed.** B emits only IDs in `src/shared/registry.ts`. C renders every
   ID there and never renames one. Adding an ID is an integration request to A.
4. **Be honest in data and prose.** Fixture content is labelled fixture
   (`GenerationProvenance.source`). Memories derive only from real `GameEvent`s. Never invent
   players, runs, rescues or history. In handoffs and PRs, separate **implemented / mocked /
   unverified**.
5. **Simulation is pure.** `src/sim` imports nothing from Phaser, React, DOM, HTTP or timers.
   Renderer draws snapshots; UI sends `UiActions`; neither mutates game state.
6. **No second app.** B does not start another HTTP server; C does not build another engine
   or scaffold a new frontend. No new frameworks, databases, auth, or speculative deps.
7. **Keep `main` runnable.** `npm run check` (typecheck + tests + build) must pass before you
   merge into `main`. Tests are non-interactive and make no network or paid API calls.
8. **Push early, push often — no pull requests needed.** This is a hackathon: commit small,
   push your branch every few minutes, and merge into `main` yourself as soon as your slice
   runs. Teammates are watching GitHub for updates.

## Git workflow (hackathon mode: direct merges, no PRs)

```bash
git clone https://github.com/Phronesis618/HackMIT2026.git relay && cd relay
npm ci
git checkout <your-branch>          # feat/core | feat/generation | feat/presentation
# ... work, commit small, push often ...
git push origin <your-branch>

# when a slice works, merge it into main yourself:
git fetch origin && git merge origin/main      # take everyone else's work first; fix conflicts in YOUR files
npm run check                                  # must be green
git checkout main && git pull && git merge <your-branch> && git push origin main
git checkout <your-branch>
```

- Never force-push a shared branch. Never rebase `main`. Never commit `.env` or secrets.
- Merge conflicts only happen in files you both touched — ownership above makes that rare. If
  a conflict is in another owner's file, keep THEIR version and tell them.
- If `main` breaks, whoever notices fixes or reverts it immediately; A is the backstop.
- After each merge, update **your own** handoff file (`docs/handoffs/<A|B|C>.md`) — one file per
  agent so nobody edits the same status doc concurrently.
- B and C record what their tool actually did in `docs/evidence/codex.md` / `devin.md`
  (real commits, tests). Do not invent sponsor evidence.

## Where things are

- Contracts + schemas: `src/shared/contracts.ts` · registry: `src/shared/registry.ts`
- Conventions (coordinates, tick, depth, input, event ids): `src/shared/conventions.ts`
- Session interface: `src/shared/session.ts` · UI model/actions: `src/shared/ui.ts`
- Renderer interface: `src/shared/render.ts` · WebSocket protocol: `src/shared/protocol.ts`
- Visual tokens: keys `src/shared/tokens.ts`, values `design/tokens.json`
- Sample snapshot/events/contributions: `src/shared/samples.ts`
- Fixture world: `fixtures/worlds/vantage-spire.json`
- Product + architecture + art direction + plan: `docs/`

## Definition of "done" for any slice

Implemented → run locally → tests added/passing → `npm run check` green → PR with how-to-test
→ handoff updated with exact test results and known limitations.
