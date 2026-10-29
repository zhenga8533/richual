import {
  CreateLobbyRequest,
  type ErrorCode,
  type ErrorResponse,
  JoinLobbyRequest,
  LobbyCode,
} from "@richual/protocol";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { generateLobbyCode } from "./crypto";

export { LobbyDO } from "./lobby";

const CREATE_ATTEMPTS = 5;

const app = new Hono<{ Bindings: Env }>();

const errorBody = (error: ErrorCode, message: string): ErrorResponse => ({ error, message });

const errorStatus: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  lobby_full: 409,
  protocol_mismatch: 426,
  internal: 500,
};

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

  const result = await c.env.LOBBY.getByName(code.data).join(body.data.name);
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
