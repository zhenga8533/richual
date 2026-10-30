import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { GameState } from "@richual/engine";
import { LobbySettings, type LobbySnapshot } from "@richual/protocol";
import { describe, expect, it } from "vitest";
import { connect, createLobby, currentPlayerId, joinLobby, type TestSocket } from "./helpers";

const stub = (code: string) => env.LOBBY.getByName(code);

function sql(code: string, query: string, ...params: (string | number | null)[]) {
  return runInDurableObject(stub(code), (_, state) => {
    state.storage.sql.exec(query, ...params);
  });
}

function mutateGame(code: string, change: (game: GameState) => void) {
  return runInDurableObject(stub(code), (_, state) => {
    const row = state.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM game").one();
    const game = JSON.parse(row.state_json) as GameState;
    change(game);
    state.storage.sql.exec("UPDATE game SET state_json = ?", JSON.stringify(game));
  });
}

/** Waits for a snapshot newer than `version`. */
async function nextVersion(socket: TestSocket, version: number) {
  for (;;) {
    const msg = await socket.until("lobby");
    if (msg.lobby.version > version) return msg;
  }
}

async function game(settings: Partial<LobbySettings> = {}) {
  const hostSession = await createLobby("Host");
  const guestSession = await joinLobby(hostSession.code, "Guest");
  const host = await connect(hostSession);
  const guest = await connect(guestSession);
  await host.socket.until("lobby");
  host.socket.send({ type: "updateSettings", settings: LobbySettings.parse(settings) });
  await guest.socket.until("lobby");
  host.socket.send({ type: "startGame" });
  const { lobby } = await guest.socket.until("lobby");
  await host.socket.until("lobby");
  const code = hostSession.code;
  const currentId = currentPlayerId(lobby);
  const byId: Record<string, TestSocket> = {
    [hostSession.playerId]: host.socket,
    [guestSession.playerId]: guest.socket,
  };
  return {
    code,
    hostSession,
    lobby,
    host: host.socket,
    guest: guest.socket,
    hostId: hostSession.playerId,
    guestId: guestSession.playerId,
    current: byId[currentId] as TestSocket,
  };
}

const roll = (lobby: LobbySnapshot) => ({
  type: "action" as const,
  clientActionId: crypto.randomUUID(),
  expectedVersion: lobby.version,
  action: { type: "roll" as const },
});

describe("pause and resume", () => {
  it("stops game actions but allows trade talk", async () => {
    const { lobby, host, guest, current, hostId, guestId } = await game();
    guest.send({ type: "pause" });
    expect(await guest.until("error")).toMatchObject({ error: "forbidden" });

    host.send({ type: "pause" });
    const paused = (await nextVersion(guest, lobby.version)).lobby;
    expect(paused.paused).toBe(true);
    expect(paused.clock.resumedAt).toBeNull();

    current.send(roll(paused));
    expect(await current.until("error")).toMatchObject({ error: "paused" });

    const otherId = current === host ? guestId : hostId;
    const other = current === host ? guest : host;
    other.send({
      type: "action",
      clientActionId: crypto.randomUUID(),
      expectedVersion: paused.version,
      action: {
        type: "proposeTrade",
        to: current === host ? hostId : guestId,
        offer: { cash: 10, spaces: [], getOutCards: [] },
        request: { cash: 0, spaces: [], getOutCards: [] },
      },
    });
    const proposed = (await nextVersion(current, paused.version)).lobby;
    expect(proposed.game?.trades).toHaveLength(1);
    expect(proposed.game?.trades[0]?.from).toBe(otherId);

    host.send({ type: "resume" });
    const resumed = (await nextVersion(current, proposed.version)).lobby;
    expect(resumed.paused).toBe(false);
    expect(resumed.clock.resumedAt).not.toBeNull();
    current.send(roll(resumed));
    expect(await current.until("ack")).toBeDefined();
  });
});

describe("ending early", () => {
  it("scores the game by net worth when the host ends it", async () => {
    const { lobby, host, guest } = await game();
    guest.send({ type: "endGame" });
    expect(await guest.until("error")).toMatchObject({ error: "forbidden" });

    host.send({ type: "endGame" });
    const { lobby: ended, events } = await nextVersion(guest, lobby.version);
    expect(ended.status).toBe("finished");
    expect(ended.game?.phase).toMatchObject({ kind: "gameOver", reason: "endedEarly" });
    if (ended.game?.phase.kind !== "gameOver") throw new Error("unreachable");
    expect(ended.game.phase.standings).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "gameOver" }));
    expect(ended.actionDeadline).toBeNull();
  });
});

describe("decision timers", () => {
  it("auto-plays an idle player when the turn timer runs out", async () => {
    const { code, lobby, guest } = await game({ turnTimerSeconds: 30 });
    expect(lobby.actionDeadline).toBeGreaterThan(Date.now() + 25_000);

    await sql(code, "UPDATE lobby SET action_deadline = ?", Date.now() - 1);
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    const { lobby: after, events } = await nextVersion(guest, lobby.version);
    expect(events[0]).toMatchObject({ type: "timedOut" });
    expect(after.game?.turn.lastRoll).not.toBeNull();
  });

  it("has no turn timer unless the host sets one", async () => {
    const { lobby } = await game();
    expect(lobby.actionDeadline).toBeNull();
  });

  it("always times auctions", async () => {
    const { code, lobby, guest, hostId, guestId } = await game();
    await mutateGame(code, (g) => {
      g.phase = {
        kind: "auction",
        space: 3,
        highBid: 0,
        highBidder: null,
        bidders: [hostId, guestId],
      };
    });
    await sql(code, "UPDATE lobby SET action_deadline = ?", Date.now() - 1);
    await runDurableObjectAlarm(stub(code));
    const { lobby: after, events } = await nextVersion(guest, lobby.version);
    expect(events).toContainEqual({ type: "auctionUnsold", space: 3 });
    expect(after.game?.phase.kind).not.toBe("auction");
  });

  it("does not fire while paused", async () => {
    const { code, lobby, host, guest } = await game({ turnTimerSeconds: 30 });
    host.send({ type: "pause" });
    const paused = (await nextVersion(guest, lobby.version)).lobby;
    expect(paused.actionDeadline).toBeNull();
    await runDurableObjectAlarm(stub(code));
    const version = await runInDurableObject(stub(code), (_, state) =>
      state.storage.sql.exec<{ version: number }>("SELECT version FROM lobby").one(),
    );
    expect(version.version).toBe(paused.version);
  });
});

describe("time limit", () => {
  it("starts the final round once active play time runs out", async () => {
    const { code, lobby, guest } = await game({ limit: { kind: "minutes", minutes: 10 } });
    expect(lobby.clock.limitMs).toBe(600_000);
    await sql(code, "UPDATE lobby SET resumed_at = ?", Date.now() - 600_001);
    await runDurableObjectAlarm(stub(code));
    const { lobby: after, events } = await nextVersion(guest, lobby.version);
    expect(events).toEqual([{ type: "finalRound", round: 1 }]);
    expect(after.game?.finalRound).toBe(1);
  });

  it("applies a round limit through the engine rules", async () => {
    const { lobby } = await game({ limit: { kind: "rounds", rounds: 12 } });
    expect(lobby.game?.config.roundLimit).toBe(12);
  });

  it("plays Quick mode with dealt properties", async () => {
    const { lobby } = await game({ mode: "quick" });
    expect(lobby.game?.owners.filter((o) => o !== null)).toHaveLength(4);
    expect(lobby.game?.config).toMatchObject({ guardiansPerWalker: 3, bankruptciesToEnd: 2 });
  });
});

describe("host handover", () => {
  it("passes hosting on when the host stays away", async () => {
    const { code, lobby, host, guest, guestId } = await game();
    host.ws.close(1000);
    const left = await guest.until("lobby");
    expect(left.lobby.players.find((p) => p.id !== guestId)?.connected).toBe(false);

    await sql(code, "UPDATE lobby SET host_check_at = ?", Date.now() - 1);
    await runDurableObjectAlarm(stub(code));
    const { lobby: after } = await nextVersion(guest, lobby.version);
    expect(after.hostId).toBe(guestId);
  });

  it("keeps the host who comes back in time", async () => {
    const { code, host, guest, hostSession, hostId } = await game();
    host.ws.close(1000);
    await guest.until("lobby");
    await connect(hostSession);
    const pending = await runInDurableObject(stub(code), (_, state) =>
      state.storage.sql
        .exec<{ host_check_at: number | null }>("SELECT host_check_at FROM lobby")
        .one(),
    );
    expect(pending.host_check_at).toBeNull();
    await runDurableObjectAlarm(stub(code));
    const after = await runInDurableObject(stub(code), (_, state) =>
      state.storage.sql.exec<{ host_id: string }>("SELECT host_id FROM lobby").one(),
    );
    expect(after.host_id).toBe(hostId);
  });
});

describe("chat", () => {
  it("broadcasts messages without bumping the version", async () => {
    const { lobby, host, guest, hostId } = await game();
    host.send({ type: "chat", text: "  gg queue popped  " });
    const { lobby: after } = await guest.until("lobby");
    expect(after.version).toBe(lobby.version);
    expect(after.chat).toEqual([
      expect.objectContaining({ playerId: hostId, text: "gg queue popped" }),
    ]);
  });

  it("rejects empty and overlong messages", async () => {
    const { host } = await game();
    host.send({ type: "chat", text: "   " });
    expect(await host.until("error")).toMatchObject({ error: "bad_request" });
    host.ws.send(JSON.stringify({ type: "chat", text: "x".repeat(201) }));
    expect(await host.until("error")).toMatchObject({ error: "bad_request" });
  });
});

describe("rate limiting", () => {
  it("drops floods of messages from one socket", async () => {
    const { host } = await game();
    for (let i = 0; i < 40; i++) host.send({ type: "chat", text: `spam ${i}` });
    expect(await host.until("error")).toMatchObject({ error: "rate_limited" });
  });
});
