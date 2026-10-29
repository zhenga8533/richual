# Richual

A web-based multiplayer board game in the spirit of classic property-trading games, set in the
supernatural 1930s New York of Valve's _Deadlock_. Built for playing with friends while waiting in
matchmaking queues: games persist across sessions and can be paused, resumed and ended early.

> **Unofficial fan project.** Not affiliated with or endorsed by Valve Corporation. _Deadlock_ names
> and lore belong to Valve. All artwork, icons and card text in this repository are original. This is
> a non-commercial project; review Valve's and Hasbro's IP terms before making it publicly available.

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
apps/richual/        Deployable Worker: src/worker (API + LobbyDO), src/client (SPA), test/
packages/engine/     Pure, deterministic game rules (no IO, seeded RNG)
packages/protocol/   Client/server message schemas and protocol version
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

| Command           | Does                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `pnpm lint`       | Biome lint + format check (`pnpm format` to fix)                             |
| `pnpm typecheck`  | TypeScript across all packages                                               |
| `pnpm test`       | Unit tests, plus Worker/Durable Object integration tests in workerd          |
| `pnpm build`      | Production build of the Worker and SPA                                       |
| `pnpm run deploy` | Build and deploy to Cloudflare (note `run`: `pnpm deploy` is a pnpm builtin) |

After changing `apps/richual/wrangler.jsonc`, regenerate binding types with
`pnpm --filter richual cf-typegen`.

## Deployment

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every PR and push. Pushes
to `main` then deploy to `richual.<account>.workers.dev`. This needs two repository secrets in a
`production` environment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: a token created from the **Edit Cloudflare Workers** template

Everything runs within the Cloudflare Workers free plan at friend-group scale.
