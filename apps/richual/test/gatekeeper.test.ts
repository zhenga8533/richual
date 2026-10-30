import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/worker/crypto";
import { LIMITS } from "../src/worker/gatekeeper";
import { BASE } from "./helpers";

function createAs(ip: string | null) {
  return exports.default.fetch(`${BASE}/api/lobbies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ip ? { "CF-Connecting-IP": ip } : {}),
    },
    body: JSON.stringify({ name: "Spammer" }),
  });
}

const hitCount = (name: string) =>
  runInDurableObject(env.GATEKEEPER.getByName(name), (_, state) =>
    state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM hits").one(),
  ).then((row) => row.n);

describe("lobby creation limits", () => {
  it("allows a few lobbies per client, then refuses with Retry-After", async () => {
    for (let i = 0; i < LIMITS.createLobby.limit; i++) {
      expect((await createAs("203.0.113.1")).status).toBe(201);
    }
    const refused = await createAs("203.0.113.1");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "rate_limited" });
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);

    // Another client is unaffected.
    expect((await createAs("203.0.113.2")).status).toBe(201);
  });

  it("lets a client create again once the window has passed", async () => {
    const ip = "203.0.113.3";
    for (let i = 0; i < LIMITS.createLobby.limit; i++) await createAs(ip);
    expect((await createAs(ip)).status).toBe(429);

    await runInDurableObject(env.GATEKEEPER.getByName(`ip:${await sha256Hex(ip)}`), (_, state) => {
      state.storage.sql.exec("UPDATE hits SET at = at - ?", LIMITS.createLobby.windowMs);
    });
    expect((await createAs(ip)).status).toBe(201);
  });

  it("stores only a hash of the client's address", async () => {
    const ip = "203.0.113.4";
    await createAs(ip);
    expect(await hitCount(`ip:${await sha256Hex(ip)}`)).toBe(1);
    expect(await hitCount(`ip:${ip}`)).toBe(0);
  });

  it("enforces the global daily cap across all clients", async () => {
    await runInDurableObject(env.GATEKEEPER.getByName("global"), (_, state) => {
      const now = Date.now();
      for (let i = 0; i < LIMITS.lobbiesPerDay.limit; i++) {
        state.storage.sql.exec("INSERT INTO hits (kind, at) VALUES ('lobbiesPerDay', ?)", now - i);
      }
    });
    const refused = await createAs("203.0.113.5");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ message: expect.stringMatching(/daily limit/) });
  });

  it("does not limit requests without a client address (local development)", async () => {
    for (let i = 0; i < LIMITS.createLobby.limit + 2; i++) {
      expect((await createAs(null)).status).toBe(201);
    }
  });
});

describe("join limits", () => {
  it("refuses a client that joins too often", async () => {
    const created = (await (await createAs(null)).json()) as { code: string };
    const join = () =>
      exports.default.fetch(`${BASE}/api/lobbies/${created.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify({ name: "Joiner" }),
      });
    const statuses: number[] = [];
    for (let i = 0; i <= LIMITS.joinLobby.limit; i++) statuses.push((await join()).status);
    // Seats run out first (409), but every attempt counts towards the limit.
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
  });
});
