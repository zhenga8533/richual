# Richual

A web-based multiplayer board game in the spirit of classic property-trading games, set in the
supernatural 1930s New York of Valve's _Deadlock_. Built for playing with friends while waiting in
matchmaking queues: games persist across sessions and can be paused, resumed and ended early.

> **Unofficial fan project.** Not affiliated with or endorsed by Valve Corporation. _Deadlock_ names
> and lore belong to Valve. All artwork, icons and card text in this repository are original. This is
> a non-commercial project; review Valve's and Hasbro's IP terms before making it publicly available.

## Features

- Private lobbies for 2–6 players by invite link; guest names, no accounts
- Classic and Quick modes, optional round or play-time limits scored by net worth
- Auctions, building, sealing, trading, raising funds and bankruptcy, all enforced by the server
- Host pause/resume and end-early, optional turn timer with safe auto-play, host handover
- Bots to fill seats, or to take over a player who has to leave; rematch in one click
- Optional Speed Die (on in Quick mode)
- Reconnect from the same browser at any time, or move your seat to another device with a
  one-time code or QR; games are kept for 7 days of inactivity
- Per-client rate limits and a daily cap on new lobbies keep the free tier from being exhausted
- Chat, turn alerts, and a layout that works on a second monitor or a phone

Player rules: [docs/RULES.md](docs/RULES.md).

## Stack

| Layer       | Choice                                                                              |
| ----------- | ----------------------------------------------------------------------------------- |
| Client      | React 19, TypeScript, Vite, Tailwind CSS v4, Zustand                                |
| Server      | Cloudflare Workers (Hono) + one Durable Object per lobby, WebSocket Hibernation API |
| Persistence | Durable Object SQLite                                                               |
| Validation  | Zod schemas shared between client and server                                        |
| Tooling     | pnpm workspaces, Biome (lint + format), Vitest, `@cloudflare/vitest-plugin`         |

## Repository layout

```
apps/richual/        Deployable Worker: src/worker (API + LobbyDO), src/client (SPA), test/, e2e/
packages/engine/     Pure, deterministic game rules (no IO, seeded RNG), scoring, simulator
packages/protocol/   Client/server message schemas, lobby settings and protocol version
docs/                Player-facing rules
```

## Development

Requires Node 22+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

Opens the app at http://localhost:5173 with the Worker and Durable Objects running locally in
workerd. Lobby state is stored under `apps/richual/.wrangler/`.

| Command           | Does                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`       | Biome lint + format check (`pnpm format` to fix)                                                                              |
| `pnpm typecheck`  | TypeScript across all packages                                                                                                |
| `pnpm test`       | Unit tests, plus Worker/Durable Object integration tests in workerd                                                           |
| `pnpm e2e`        | Playwright multiplayer tests; starts its own dev server (first run: `pnpm --filter richual exec playwright install chromium`) |
| `pnpm build`      | Production build of the Worker and SPA                                                                                        |
| `pnpm run deploy` | Build and deploy to Cloudflare (note `run`: `pnpm deploy` is a pnpm builtin)                                                  |

After changing `apps/richual/wrangler.jsonc`, regenerate binding types with
`pnpm --filter richual cf-typegen`.

## Deployment

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every PR and push. Pushes
to `main` then deploy to `richual.<account>.workers.dev`. This needs two repository secrets in a
`production` environment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: a token created from the **Edit Cloudflare Workers** template

Everything runs within the Cloudflare Workers free plan at friend-group scale. Security headers
(including a strict Content Security Policy) are set for the static site in
`apps/richual/public/_headers`.

## Architecture notes

- **The engine is the only rules authority.** `applyAction` is pure and deterministic: the seeded RNG
  lives in the game state, so a game replays exactly from its seed and actions. The client imports the
  engine only to show which actions are legal. Bots (`packages/engine/src/bot.ts`) are a pure
  function of the same state, so they can only ever play legal moves.
- **One Durable Object per lobby** serializes every message, validates it with Zod and the engine,
  and persists the new state, recent events and version in one SQLite transaction (two row writes
  per action, to stay within the free tier). Clients send the
  version they acted on; stale actions are refused with a fresh snapshot, and resent actions are
  acknowledged without being applied twice.
- **One alarm** drives every deadline: decision timers, the time limit, host handover, bot moves
  (one per wake-up, 900 ms apart) and idle cleanup.
- **A gatekeeper Durable Object** counts requests per hashed client address (raw IPs are never
  stored) and the global daily lobby cap.
- **Client errors** are reported to `POST /api/client-errors` and appear in Workers logs, as does a
  one-line summary of every finished game.
- **Schemas evolve append-only**: `apps/richual/src/worker/schema.ts` for lobby storage and
  `packages/engine/src/migrations.ts` for saved games.
