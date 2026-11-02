import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { botAction } from "@richual/engine";
import { CloseCode, type LobbySnapshot, type SessionResponse } from "@richual/protocol";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/worker/gatekeeper";
import { BASE, connect, createLobby, hello, joinLobby, post, type TestSocket } from "./helpers";

async function hostWithBot() {
  const hostSession = await createLobby("Host");
  const { socket: host } = await connect(hostSession);
  host.send({ type: "addBot", level: "normal" });
  const { lobby } = await host.until("lobby");
  return { hostSession, host, lobby };
}

const botOf = (lobby: LobbySnapshot) => lobby.players.find((p) => p.bot);

/** Makes a pending bot move due now, then runs the alarm. */
async function playDueBotMove(code: string) {
  const stub = env.LOBBY.getByName(code);
  const due = await runInDurableObject(stub, (_, state) => {
    const row = state.storage.sql
      .exec<{ bot_due_at: number | null }>("SELECT bot_due_at FROM lobby")
      .toArray()[0];
    state.storage.sql.exec("UPDATE lobby SET bot_due_at = ? WHERE bot_due_at IS NOT NULL", 0);
    return row?.bot_due_at ?? null;
  });
  await runDurableObjectAlarm(stub);
  return due;
}

const claim = (code: string, seatCode: string, ip?: string) =>
  exports.default.fetch(`${BASE}/api/lobbies/${code}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(ip && { "CF-Connecting-IP": ip }) },
    body: JSON.stringify({ seatCode }),
  });

describe("bots", () => {
  it("joins as a named bot that never counts as connected", async () => {
    const { lobby } = await hostWithBot();
    const bot = botOf(lobby);
    expect(bot).toMatchObject({ bot: true, connected: false });
    expect(bot?.name).toMatch(/^Bot · /);
  });

  it("adds Normal bots unless a level is chosen", async () => {
    const { host, lobby } = await hostWithBot();
    expect(botOf(lobby)?.botLevel).toBe("normal");
    host.send({ type: "addBot", level: "hard" });
    let next = (await host.until("lobby")).lobby;
    while (next.players.length < 3) next = (await host.until("lobby")).lobby;
    expect(next.players.filter((p) => p.bot).map((p) => p.botLevel)).toEqual(["normal", "hard"]);
  });

  it("lets the host change a bot's level, before and during the game", async () => {
    const { host, lobby } = await hostWithBot();
    const botId = botOf(lobby)?.id ?? "";
    host.send({ type: "setBotLevel", playerId: botId, level: "easy" });
    let next = (await host.until("lobby")).lobby;
    while (botOf(next)?.botLevel !== "easy") next = (await host.until("lobby")).lobby;

    host.send({ type: "startGame" });
    while (next.status !== "playing") next = (await host.until("lobby")).lobby;
    host.send({ type: "setBotLevel", playerId: botId, level: "hard" });
    while (botOf(next)?.botLevel !== "hard") next = (await host.until("lobby")).lobby;
    expect(botOf(next)?.botLevel).toBe("hard");
  });

  it("only changes the level of bots, and only for the host", async () => {
    const { hostSession, host, lobby } = await hostWithBot();
    host.send({ type: "setBotLevel", playerId: hostSession.playerId, level: "hard" });
    expect(await host.until("error")).toMatchObject({ error: "not_found" });

    const guest = await connect(await joinLobby(hostSession.code, "Guest"));
    guest.socket.send({ type: "setBotLevel", playerId: botOf(lobby)?.id ?? "", level: "easy" });
    expect(await guest.socket.until("error")).toMatchObject({ error: "forbidden" });
  });

  it("only lets the host add bots", async () => {
    const hostSession = await createLobby("Host");
    const guest = await connect(await joinLobby(hostSession.code, "Guest"));
    guest.socket.send({ type: "addBot", level: "normal" });
    expect(await guest.socket.until("error")).toMatchObject({ error: "forbidden" });
  });

  it("plays its turns on the alarm, one move per wake-up", async () => {
    const { hostSession, host } = await hostWithBot();
    host.send({ type: "startGame" });
    let { lobby } = await host.until("lobby");
    const botId = botOf(lobby)?.id;
    let botRolled = false;
    for (let i = 0; i < 40 && !botRolled; i++) {
      const game = lobby.game;
      if (!game) throw new Error("no game");
      // The human plays like a bot too, so the test only waits on the server.
      const mine = botAction(game, hostSession.playerId);
      if (mine) {
        host.send({
          type: "action",
          clientActionId: crypto.randomUUID(),
          expectedVersion: lobby.version,
          action: mine,
        });
      } else {
        expect(await playDueBotMove(hostSession.code)).not.toBeNull();
      }
      const msg = await host.until("lobby");
      lobby = msg.lobby;
      botRolled = msg.events.some((e) => e.type === "rolled" && e.playerId === botId);
    }
    expect(botRolled).toBe(true);
  });

  it("schedules no bot move while paused, and no turn timer for a bot", async () => {
    const { hostSession, host, lobby: setup } = await hostWithBot();
    host.send({ type: "updateSettings", settings: { ...setup.settings, turnTimerSeconds: 60 } });
    expect((await host.until("lobby")).lobby.settings.turnTimerSeconds).toBe(60);
    host.send({ type: "startGame" });
    await host.until("lobby");
    const stub = env.LOBBY.getByName(hostSession.code);
    const row = () =>
      runInDurableObject(
        stub,
        (_, state) =>
          state.storage.sql
            .exec<{ bot_due_at: number | null; action_deadline: number | null }>(
              "SELECT bot_due_at, action_deadline FROM lobby",
            )
            .toArray()[0],
      );
    host.send({ type: "pause" });
    await host.until("lobby");
    expect((await row())?.bot_due_at).toBeNull();

    host.send({ type: "resume" });
    const { lobby } = await host.until("lobby");
    const botTurn = lobby.game?.players[lobby.game.turn.playerIndex]?.id === botOf(lobby)?.id;
    const now = await row();
    if (botTurn) {
      expect(now?.bot_due_at).not.toBeNull();
      expect(now?.action_deadline).toBeNull();
    } else {
      expect(now?.action_deadline).not.toBeNull();
    }
  });
});

describe("host tools", () => {
  it("lets the host close the lobby for everyone, deleting it", async () => {
    const hostSession = await createLobby("Host");
    const guestSession = await joinLobby(hostSession.code, "Guest");
    const { socket: host } = await connect(hostSession);
    const { socket: guest } = await connect(guestSession);
    host.send({ type: "closeLobby" });
    expect((await host.closed).code).toBe(CloseCode.LobbyClosed);
    expect((await guest.closed).code).toBe(CloseCode.LobbyClosed);

    const tables = await runInDurableObject(env.LOBBY.getByName(hostSession.code), (_, state) =>
      state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .filter((t) => !t.name.startsWith("_cf")),
    );
    expect(tables).toEqual([]);
    const rejoin = await post(`/api/lobbies/${hostSession.code}/join`, { name: "Late" });
    expect(rejoin.status).toBe(404);
  });

  it("only lets the host close the lobby", async () => {
    const hostSession = await createLobby("Host");
    const guest = await connect(await joinLobby(hostSession.code, "Guest"));
    guest.socket.send({ type: "closeLobby" });
    expect(await guest.socket.until("error")).toMatchObject({ error: "forbidden" });
  });

  it("lets the host close the lobby from outside it, with their saved token", async () => {
    const hostSession = await createLobby("Host");
    const { socket: guest } = await connect(await joinLobby(hostSession.code, "Guest"));
    const res = await post(`/api/lobbies/${hostSession.code}/close`, { token: hostSession.token });
    expect(res.status).toBe(204);
    expect((await guest.closed).code).toBe(CloseCode.LobbyClosed);
    const again = await post(`/api/lobbies/${hostSession.code}/close`, {
      token: hostSession.token,
    });
    expect(again.status).toBe(404);
  });

  it("refuses to close a lobby for a guest, a wrong token or a malformed request", async () => {
    const hostSession = await createLobby("Host");
    const guestSession = await joinLobby(hostSession.code, "Guest");
    const close = (body: unknown) => post(`/api/lobbies/${hostSession.code}/close`, body);
    expect((await close({ token: guestSession.token })).status).toBe(403);
    expect((await close({ token: "not-a-seat" })).status).toBe(401);
    expect((await close({})).status).toBe(400);
    // Nothing was deleted along the way.
    expect((await joinLobby(hostSession.code, "Late")).code).toBe(hostSession.code);
  });

  it("rate-limits closing from outside the lobby", async () => {
    const ip = "203.0.113.140";
    const close = () =>
      exports.default.fetch(`${BASE}/api/lobbies/ABC234/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ token: "t" }),
      });
    for (let i = 0; i < LIMITS.closeLobby.limit; i++) expect((await close()).status).toBe(404);
    expect((await close()).status).toBe(429);
  });

  it("removes a player before the game and closes their socket", async () => {
    const hostSession = await createLobby("Host");
    const guestSession = await joinLobby(hostSession.code, "Guest");
    const { socket: host } = await connect(hostSession);
    const { socket: guest } = await connect(guestSession);
    host.send({ type: "removePlayer", playerId: guestSession.playerId });
    expect((await guest.closed).code).toBe(CloseCode.Removed);
    let lobby: LobbySnapshot;
    do ({ lobby } = await host.until("lobby"));
    while (lobby.players.length > 1);
    expect(lobby.players.map((p) => p.id)).toEqual([hostSession.playerId]);
  });

  it("replaces a player with a bot mid-game", async () => {
    const hostSession = await createLobby("Host");
    const guestSession = await joinLobby(hostSession.code, "Guest");
    const { socket: host } = await connect(hostSession);
    const { socket: guest } = await connect(guestSession);
    host.send({ type: "startGame" });
    await host.until("lobby");
    host.send({ type: "replaceWithBot", playerId: guestSession.playerId, level: "normal" });
    expect((await guest.closed).code).toBe(CloseCode.Removed);
    let lobby: LobbySnapshot;
    do ({ lobby } = await host.until("lobby"));
    while (!lobby.players.find((p) => p.id === guestSession.playerId)?.bot);
    expect(lobby.status).toBe("playing");
    // The old session no longer works.
    const again = await hello(guestSession.code, guestSession.token);
    expect((await again.closed).code).toBe(CloseCode.Unauthorized);
  });

  it("hands the host role to another person, never to a bot", async () => {
    const { hostSession, host, lobby } = await hostWithBot();
    host.send({ type: "setHost", playerId: botOf(lobby)?.id as string });
    expect(await host.until("error")).toMatchObject({ error: "rejected" });

    const guestSession = await joinLobby(hostSession.code, "Guest");
    await host.until("lobby");
    host.send({ type: "setHost", playerId: guestSession.playerId });
    const { lobby: after } = await host.until("lobby");
    expect(after.hostId).toBe(guestSession.playerId);
  });

  it("rematches with the same seats and settings", async () => {
    const { hostSession, host, lobby } = await hostWithBot();
    host.send({ type: "startGame" });
    await host.until("lobby");
    await runInDurableObject(env.LOBBY.getByName(hostSession.code), (_, state) => {
      state.storage.sql.exec("UPDATE lobby SET status = 'finished', bot_due_at = NULL");
    });
    host.send({ type: "rematch" });
    let after: LobbySnapshot;
    do ({ lobby: after } = await host.until("lobby"));
    while (after.status !== "playing");
    expect(after.players.map((p) => p.id)).toEqual(lobby.players.map((p) => p.id));
    expect(after.game?.turn.round).toBe(1);
  });
});

describe("moving a seat", () => {
  async function codeFor(session: SessionResponse): Promise<{ socket: TestSocket; code: string }> {
    const { socket } = await connect(session);
    socket.send({ type: "createSeatCode" });
    const { code } = await socket.until("seatCode");
    return { socket, code };
  }

  it("claims a seat once and signs out the old device", async () => {
    const hostSession = await createLobby("Host");
    const { socket, code } = await codeFor(hostSession);
    const res = await claim(hostSession.code, code);
    expect(res.status).toBe(201);
    const moved = (await res.json()) as SessionResponse;
    expect(moved.playerId).toBe(hostSession.playerId);
    expect(moved.token).not.toBe(hostSession.token);
    expect((await socket.closed).code).toBe(CloseCode.SeatMoved);

    expect((await connect(moved)).lobby.code).toBe(hostSession.code);
    expect((await claim(hostSession.code, code)).status).toBe(401);
  });

  it("rejects wrong and expired codes", async () => {
    const hostSession = await createLobby("Host");
    const { code } = await codeFor(hostSession);
    expect((await claim(hostSession.code, code === "AAAAAA" ? "BBBBBB" : "AAAAAA")).status).toBe(
      401,
    );
    await runInDurableObject(env.LOBBY.getByName(hostSession.code), (_, state) => {
      state.storage.sql.exec("UPDATE players SET seat_code_expires_at = ?", Date.now() - 1);
    });
    expect((await claim(hostSession.code, code)).status).toBe(401);
  });

  it("rate-limits claims per IP", async () => {
    const hostSession = await createLobby("Host");
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await claim(hostSession.code, "ZZZZZZ", ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("refuses a malformed seat code", async () => {
    const hostSession = await createLobby("Host");
    expect((await post(`/api/lobbies/${hostSession.code}/claim`, { seatCode: "!" })).status).toBe(
      400,
    );
  });
});
