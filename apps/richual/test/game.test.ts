import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { CloseCode, type LobbySnapshot } from "@richual/protocol";
import { describe, expect, it } from "vitest";
import {
  connect,
  createLobby,
  currentPlayerId,
  joinLobby,
  openSocket,
  post,
  type TestSocket,
} from "./helpers";

async function twoPlayerLobby() {
  const hostSession = await createLobby("Host");
  const guestSession = await joinLobby(hostSession.code, "Guest");
  const host = await connect(hostSession);
  const guest = await connect(guestSession);
  await host.socket.until("lobby"); // guest's arrival
  return { hostSession, guestSession, host: host.socket, guest: guest.socket, lobby: guest.lobby };
}

async function startedGame() {
  const setup = await twoPlayerLobby();
  setup.host.send({ type: "startGame" });
  const { lobby } = await setup.host.until("lobby");
  await setup.guest.until("lobby");
  const sockets: Record<string, TestSocket> = {
    [setup.hostSession.playerId]: setup.host,
    [setup.guestSession.playerId]: setup.guest,
  };
  const currentId = currentPlayerId(lobby);
  const otherId = Object.keys(sockets).find((id) => id !== currentId) as string;
  return {
    ...setup,
    lobby,
    current: { id: currentId, socket: sockets[currentId] as TestSocket },
    other: { id: otherId, socket: sockets[otherId] as TestSocket },
  };
}

const actionCount = (code: string) =>
  runInDurableObject(env.LOBBY.getByName(code), (_, state) =>
    state.storage.sql.exec("SELECT COUNT(*) AS n FROM actions").one(),
  ).then((row) => row.n);

describe("lobby setup", () => {
  it("assigns distinct default heroes", async () => {
    const { lobby } = await twoPlayerLobby();
    const heroes = lobby.players.map((p) => p.hero);
    expect(heroes.every((h) => h !== null)).toBe(true);
    expect(new Set(heroes).size).toBe(2);
  });

  it("lets players change hero but not take one that is claimed", async () => {
    const { host, guest, lobby } = await twoPlayerLobby();
    guest.send({ type: "setHero", hero: "haze" });
    const update = await host.until("lobby");
    expect(update.lobby.players.map((p) => p.hero)).toContain("haze");
    expect(update.lobby.version).toBe(lobby.version + 1);

    host.send({ type: "setHero", hero: "haze" });
    expect(await host.until("error")).toMatchObject({ error: "rejected" });
  });

  it("only lets the host change settings", async () => {
    const { host, guest } = await twoPlayerLobby();
    const settings = {
      startingCash: 2000,
      doubleOnExactGo: false,
      freeParkingJackpot: false,
      auctions: false,
      evenBuilding: false,
    };
    guest.send({ type: "updateSettings", settings });
    expect(await guest.until("error")).toMatchObject({ error: "forbidden" });

    host.send({ type: "updateSettings", settings });
    expect((await guest.until("lobby")).lobby.settings).toEqual(settings);
  });

  it("rejects invalid settings", async () => {
    const { host } = await twoPlayerLobby();
    host.ws.send(
      JSON.stringify({
        type: "updateSettings",
        settings: { startingCash: 123, doubleOnExactGo: true, freeParkingJackpot: true },
      }),
    );
    expect(await host.until("error")).toMatchObject({ error: "bad_request" });
  });

  it("requires a hello before anything else", async () => {
    const { code } = await createLobby();
    const socket = await openSocket(code);
    socket.send({ type: "startGame" });
    expect(await socket.until("error")).toMatchObject({ error: "unauthorized" });
    expect((await socket.closed).code).toBe(CloseCode.Unauthorized);
  });
});

describe("starting a game", () => {
  it("only lets the host start, with at least two players", async () => {
    const solo = await createLobby();
    const { socket } = await connect(solo);
    socket.send({ type: "startGame" });
    expect(await socket.until("error")).toMatchObject({ error: "rejected" });

    const { guest } = await twoPlayerLobby();
    guest.send({ type: "startGame" });
    expect(await guest.until("error")).toMatchObject({ error: "forbidden" });
  });

  it("starts with the lobby settings and hides deck order", async () => {
    const setup = await twoPlayerLobby();
    setup.host.send({
      type: "updateSettings",
      settings: {
        startingCash: 2000,
        doubleOnExactGo: true,
        freeParkingJackpot: true,
        auctions: true,
        evenBuilding: true,
      },
    });
    await setup.guest.until("lobby");
    setup.host.send({ type: "startGame" });
    const { lobby, events } = await setup.guest.until("lobby");
    expect(lobby.status).toBe("playing");
    expect(lobby.game?.players.map((p) => p.cash)).toEqual([2000, 2000]);
    expect(lobby.game?.decks).toEqual({ oracle: { remaining: 16 }, coven: { remaining: 16 } });
    expect(JSON.stringify(lobby.game)).not.toContain("drawPile");
    expect(JSON.stringify(lobby.game)).not.toContain('"rng"');
    expect(events).toEqual([{ type: "turnStarted", playerId: currentPlayerId(lobby) }]);
  });

  it("closes the lobby to new players", async () => {
    const { hostSession } = await startedGame();
    const res = await post(`/api/lobbies/${hostSession.code}/join`, { name: "Late" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "game_in_progress" });
  });
});

describe("game actions", () => {
  const roll = (lobby: LobbySnapshot, clientActionId = crypto.randomUUID()) => ({
    type: "action" as const,
    clientActionId,
    expectedVersion: lobby.version,
    action: { type: "roll" as const },
  });

  it("applies a legal action and broadcasts the result", async () => {
    const { lobby, current, other } = await startedGame();
    const message = roll(lobby);
    current.socket.send(message);
    expect(await current.socket.until("ack")).toEqual({
      type: "ack",
      clientActionId: message.clientActionId,
    });
    const update = await other.socket.until("lobby");
    expect(update.lobby.version).toBe(lobby.version + 1);
    expect(update.events[0]).toMatchObject({ type: "rolled", playerId: current.id });
    expect(update.lobby.game?.turn.lastRoll).not.toBeNull();
  });

  it("rejects actions out of turn", async () => {
    const { lobby, hostSession, other } = await startedGame();
    const message = roll(lobby);
    other.socket.send(message);
    expect(await other.socket.until("error")).toMatchObject({
      error: "rejected",
      clientActionId: message.clientActionId,
    });
    expect(await actionCount(hostSession.code)).toBe(0);
  });

  it("acknowledges a duplicate without applying it twice", async () => {
    const { lobby, hostSession, current } = await startedGame();
    const message = roll(lobby);
    current.socket.send(message);
    await current.socket.until("ack");
    current.socket.send(message);
    expect(await current.socket.until("ack")).toMatchObject({
      clientActionId: message.clientActionId,
    });
    expect(await actionCount(hostSession.code)).toBe(1);
  });

  it("rejects actions chosen against a stale version and resyncs the client", async () => {
    const { lobby, hostSession, current } = await startedGame();
    current.socket.send({ ...roll(lobby), expectedVersion: lobby.version - 1 });
    expect(await current.socket.until("error")).toMatchObject({ error: "stale" });
    expect((await current.socket.until("lobby")).lobby.version).toBe(lobby.version);
    expect(await actionCount(hostSession.code)).toBe(0);
  });

  it("rejects game actions before the game starts", async () => {
    const { host, lobby } = await twoPlayerLobby();
    host.send(roll(lobby));
    expect(await host.until("error")).toMatchObject({ error: "rejected" });
  });

  it("restores the game after the object is evicted", async () => {
    const { lobby, current, hostSession } = await startedGame();
    current.socket.send(roll(lobby));
    const { lobby: after } = await current.socket.until("lobby");
    await evictDurableObject(env.LOBBY.getByName(hostSession.code));
    const { lobby: restored } = await connect(hostSession);
    expect(restored.version).toBe(after.version);
    expect(restored.game).toEqual(after.game);
  }, 20_000);
});

describe("off-turn actions", () => {
  it("lets a player outside the turn propose a trade the current player accepts", async () => {
    const { lobby, current, other, hostSession } = await startedGame();
    // Give the waiting player a property to trade, straight in storage.
    await runInDurableObject(env.LOBBY.getByName(hostSession.code), (_, state) => {
      const row = state.storage.sql
        .exec<{ state_json: string }>("SELECT state_json FROM game")
        .one();
      const game = JSON.parse(row.state_json);
      game.owners[39] = other.id;
      state.storage.sql.exec("UPDATE game SET state_json = ?", JSON.stringify(game));
    });

    other.socket.send({
      type: "action",
      clientActionId: crypto.randomUUID(),
      expectedVersion: lobby.version,
      action: {
        type: "proposeTrade",
        to: current.id,
        offer: { cash: 0, spaces: [39], getOutCards: [] },
        request: { cash: 300, spaces: [], getOutCards: [] },
      },
    });
    const proposed = await current.socket.until("lobby");
    expect(proposed.lobby.game?.trades).toHaveLength(1);

    current.socket.send({
      type: "action",
      clientActionId: crypto.randomUUID(),
      expectedVersion: proposed.lobby.version,
      action: { type: "acceptTrade", tradeId: 1 },
    });
    let traded = await other.socket.until("lobby");
    while (traded.lobby.version <= proposed.lobby.version)
      traded = await other.socket.until("lobby");
    expect(traded.lobby.game?.owners[39]).toBe(current.id);
    expect(traded.events).toContainEqual({
      type: "tradeAccepted",
      tradeId: 1,
      from: other.id,
      to: current.id,
    });
  });
});

describe("after a game", () => {
  it("lets the host return a finished game to the lobby", async () => {
    const { host, guest, hostSession } = await startedGame();
    host.send({ type: "returnToLobby" });
    expect(await host.until("error")).toMatchObject({ error: "rejected" });

    await runInDurableObject(env.LOBBY.getByName(hostSession.code), (_, state) => {
      state.storage.sql.exec("UPDATE lobby SET status = 'finished'");
    });
    guest.send({ type: "returnToLobby" });
    expect(await guest.until("error")).toMatchObject({ error: "forbidden" });
    host.send({ type: "returnToLobby" });
    const { lobby } = await guest.until("lobby");
    expect(lobby.status).toBe("open");
    expect(lobby.game).toBeNull();
    expect(await actionCount(hostSession.code)).toBe(0);
  });
});
