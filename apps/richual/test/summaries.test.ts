import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { MAX_SUMMARIES, type SummariesResponse } from "@richual/protocol";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/worker/gatekeeper";
import { BASE, connect, createLobby, joinLobby } from "./helpers";

type Session = { code: string; token: string };

const summaries = (sessions: Session[], ip?: string) =>
  exports.default.fetch(`${BASE}/api/lobbies/summaries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(ip && { "CF-Connecting-IP": ip }) },
    body: JSON.stringify({ sessions }),
  });

const resultsFor = async (sessions: Session[]) => {
  const res = await summaries(sessions);
  expect(res.status).toBe(200);
  return ((await res.json()) as SummariesResponse).results;
};

describe("lobby summaries", () => {
  it("describes each seat this browser holds", async () => {
    const host = await createLobby("Host");
    const guest = await joinLobby(host.code, "Guest");
    const [asHost, asGuest] = await resultsFor([host, guest]);
    expect(asHost).toMatchObject({
      code: host.code,
      ok: true,
      summary: {
        status: "open",
        paused: false,
        round: null,
        you: "Host",
        isHost: true,
        players: [
          { name: "Host", bot: false },
          { name: "Guest", bot: false },
        ],
      },
    });
    expect(asGuest).toMatchObject({ ok: true, summary: { you: "Guest", isHost: false } });
  });

  it("reports the round once the game has started", async () => {
    const host = await createLobby("Host");
    await joinLobby(host.code, "Guest");
    const { socket } = await connect(host);
    socket.send({ type: "startGame" });
    let { lobby } = await socket.until("lobby");
    while (lobby.status !== "playing") ({ lobby } = await socket.until("lobby"));
    const [result] = await resultsFor([host]);
    expect(result).toMatchObject({ ok: true, summary: { status: "playing", round: 1 } });
  });

  it("answers not_found for an expired lobby without creating it", async () => {
    const [result] = await resultsFor([{ code: "ZZZZZZ", token: "whatever" }]);
    expect(result).toEqual({ code: "ZZZZZZ", ok: false, error: "not_found" });
    const tables = await runInDurableObject(env.LOBBY.getByName("ZZZZZZ"), (_, state) =>
      state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray(),
    );
    expect(tables.filter((t) => !t.name.startsWith("_cf"))).toEqual([]);
  });

  it("answers unauthorized for a seat that moved or a wrong token", async () => {
    const host = await createLobby("Host");
    const [result] = await resultsFor([{ code: host.code, token: "not-the-token" }]);
    expect(result).toEqual({ code: host.code, ok: false, error: "unauthorized" });
  });

  it("refuses more sessions than the cap, and malformed bodies", async () => {
    const many = Array.from({ length: MAX_SUMMARIES + 1 }, () => ({
      code: "ABC123",
      token: "t",
    }));
    expect((await summaries(many)).status).toBe(400);
    expect((await summaries([])).status).toBe(400);
    expect((await summaries([{ code: "nope", token: "t" }])).status).toBe(400);
  });

  it("is rate-limited per client", async () => {
    const host = await createLobby("Host");
    const ip = "203.0.113.120";
    for (let i = 0; i < LIMITS.summaries.limit; i++) {
      expect((await summaries([host], ip)).status).toBe(200);
    }
    expect((await summaries([host], ip)).status).toBe(429);
  });
});
