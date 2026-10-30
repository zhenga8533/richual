import {
  ClaimSeatRequest,
  CreateLobbyRequest,
  type ErrorCode,
  type ErrorResponse,
  JoinLobbyRequest,
  LobbyCode,
} from "@richual/protocol";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { generateLobbyCode, sha256Hex } from "./crypto";
import { LIMITS } from "./gatekeeper";

export { GatekeeperDO } from "./gatekeeper";
export { LobbyDO } from "./lobby";

const CREATE_ATTEMPTS = 5;

const app = new Hono<{ Bindings: Env }>();

const errorBody = (error: ErrorCode, message: string): ErrorResponse => ({ error, message });

const errorStatus: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  forbidden: 403,
  lobby_full: 409,
  game_in_progress: 409,
  stale: 409,
  rejected: 422,
  paused: 409,
  rate_limited: 429,
  protocol_mismatch: 426,
  internal: 500,
};

type LimitName = keyof typeof LIMITS;

/**
 * Charges `names` against the caller's limits. Returns a 429 response when one is
 * exhausted, or null to go ahead. Requests without CF-Connecting-IP (local dev and
 * tests) are not limited; Cloudflare always sets it in production.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

async function rateLimit(env: Env, request: Request, names: LimitName[]): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  // Cloudflare's edge always sends a public address; loopback only comes from local dev and tests.
  if (!ip || LOOPBACK.has(ip)) return null;
  const client = env.GATEKEEPER.getByName(`ip:${await sha256Hex(ip)}`);
  for (const name of names) {
    const { limit, windowMs } = LIMITS[name];
    // The daily lobby cap is shared by everyone; the rest are per client.
    const counter = name === "lobbiesPerDay" ? env.GATEKEEPER.getByName("global") : client;
    const result = await counter.take(name, limit, windowMs);
    if (!result.ok) {
      const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60_000));
      const message =
        name === "lobbiesPerDay"
          ? "Richual has hit its daily limit on new games. Please try again later."
          : `Too many requests. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
      return Response.json(errorBody("rate_limited", message), {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) },
      });
    }
  }
  return null;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

app.post("/api/lobbies", async (c) => {
  const body = CreateLobbyRequest.safeParse(await readJson(c.req.raw));
  if (!body.success)
    return c.json(errorBody("bad_request", body.error.issues[0]?.message ?? ""), 400);
  const limited = await rateLimit(c.env, c.req.raw, ["createLobby", "lobbiesPerDay"]);
  if (limited) return limited;

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateLobbyCode();
    const session = await c.env.LOBBY.getByName(code).create(code, body.data.name);
    if (session) return c.json(session, 201);
  }
  console.error("could not allocate a free lobby code");
  return c.json(errorBody("internal", "Could not create a lobby, please retry"), 500);
});

app.post("/api/lobbies/:code/join", async (c) => {
  const code = LobbyCode.safeParse(c.req.param("code"));
  if (!code.success) return c.json(errorBody("not_found", "Lobby not found"), 404);
  const body = JoinLobbyRequest.safeParse(await readJson(c.req.raw));
  if (!body.success)
    return c.json(errorBody("bad_request", body.error.issues[0]?.message ?? ""), 400);
  const limited = await rateLimit(c.env, c.req.raw, ["joinLobby"]);
  if (limited) return limited;

  const result = await c.env.LOBBY.getByName(code.data).join(body.data.name);
  if (!result.ok) return c.json(errorBody(result.error, result.message), errorStatus[result.error]);
  return c.json(result.session, 201);
});

app.post("/api/lobbies/:code/claim", async (c) => {
  const code = LobbyCode.safeParse(c.req.param("code"));
  if (!code.success) return c.json(errorBody("not_found", "Lobby not found"), 404);
  const body = ClaimSeatRequest.safeParse(await readJson(c.req.raw));
  if (!body.success) return c.json(errorBody("bad_request", "That isn't a seat code"), 400);
  const limited = await rateLimit(c.env, c.req.raw, ["claimSeat"]);
  if (limited) return limited;

  const result = await c.env.LOBBY.getByName(code.data).claimSeat(body.data.seatCode);
  if (!result.ok) return c.json(errorBody(result.error, result.message), errorStatus[result.error]);
  return c.json(result.session, 201);
});

app.get("/api/lobbies/:code/ws", async (c) => {
  const code = LobbyCode.safeParse(c.req.param("code"));
  if (!code.success) return c.json(errorBody("not_found", "Lobby not found"), 404);
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }
  // Browsers always send Origin on WebSocket upgrades; reject cross-site pages.
  const origin = c.req.header("Origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) {
    return c.json(errorBody("unauthorized", "Cross-origin connection refused"), 403);
  }
  return c.env.LOBBY.getByName(code.data).fetch(c.req.raw);
});

app.all("/api/*", (c) => c.json(errorBody("not_found", "No such endpoint"), 404));

app.onError((error, c) => {
  console.error("unhandled worker error", error);
  return c.json(errorBody("internal", "Internal error"), 500);
});

export default app satisfies ExportedHandler<Env>;
