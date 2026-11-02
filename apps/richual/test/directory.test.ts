import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { LobbySnapshot, PublicLobbiesResponse } from "@richual/protocol";
import { describe, expect, it } from "vitest";
import { LISTING_TTL_MS } from "../src/worker/directory";
import { LIMITS } from "../src/worker/gatekeeper";
import { LISTING_REFRESH_MS } from "../src/worker/lobby";
import { BASE, connect, createLobby, joinLobby, type TestSocket } from "./helpers";

const browse = (ip?: string) =>
  exports.default.fetch(`${BASE}/api/lobbies/public`, {
    headers: ip ? { "CF-Connecting-IP": ip } : {},
  });

const listedCodes = async () => {
  const res = await browse();
  expect(res.status).toBe(200);
  return ((await res.json()) as PublicLobbiesResponse).lobbies.map((l) => l.code);
};

/** Directory writes run after the lobby replies, so give them a moment to land. */
async function eventually(check: (codes: string[]) => boolean): Promise<string[]> {
  let codes: string[] = [];
  for (let i = 0; i < 50; i++) {
    codes = await listedCodes();
    if (check(codes)) return codes;
    await new Promise((r) => setTimeout(r, 20));
  }
  return codes;
}

async function waitFor(socket: TestSocket, ok: (lobby: LobbySnapshot) => boolean) {
  for (;;) {
    const { lobby } = await socket.until("lobby");
    if (ok(lobby)) return lobby;
  }
}

async function publicLobby() {
  const session = await createLobby("Lister");
  const { socket, lobby } = await connect(session);
  socket.send({
    type: "updateSettings",
    settings: { ...lobby.settings, visibility: "public" },
  });
  const listed = await waitFor(socket, (l) => l.settings.visibility === "public");
  return { session, socket, lobby: listed };
}

describe("public lobbies", () => {
  it("lists a public lobby while it waits, with its host's name and seats", async () => {
    const { session } = await publicLobby();
    await eventually((codes) => codes.includes(session.code));
    const res = (await (await browse()).json()) as PublicLobbiesResponse;
    expect(res.lobbies.find((l) => l.code === session.code)).toMatchObject({
      hostName: "Lister",
      players: 1,
      maxPlayers: 6,
      mode: "classic",
    });
  });

  it("never lists a private lobby", async () => {
    const session = await createLobby("Private");
    await connect(session);
    expect(await listedCodes()).not.toContain(session.code);
  });

  it("takes the listing down when the lobby goes private", async () => {
    const { session, socket, lobby } = await publicLobby();
    await eventually((codes) => codes.includes(session.code));
    socket.send({ type: "updateSettings", settings: { ...lobby.settings, visibility: "private" } });
    expect(await eventually((codes) => !codes.includes(session.code))).not.toContain(session.code);
  });

  it("takes the listing down once the game starts", async () => {
    const { session, socket } = await publicLobby();
    await joinLobby(session.code, "Guest");
    await eventually((codes) => codes.includes(session.code));
    socket.send({ type: "startGame" });
    await waitFor(socket, (l) => l.status === "playing");
    expect(await eventually((codes) => !codes.includes(session.code))).not.toContain(session.code);
  });

  it("takes the listing down when the lobby is full", async () => {
    const { session } = await publicLobby();
    for (let i = 0; i < 5; i++) await joinLobby(session.code, `Guest ${i}`);
    expect(await eventually((codes) => !codes.includes(session.code))).not.toContain(session.code);
  });

  it("takes the listing down while the host is away", async () => {
    const { session, socket } = await publicLobby();
    await eventually((codes) => codes.includes(session.code));
    socket.ws.close(1000, "bye");
    expect(await eventually((codes) => !codes.includes(session.code))).not.toContain(session.code);
  });

  it("takes the listing down when the host closes the lobby", async () => {
    const { session, socket } = await publicLobby();
    await eventually((codes) => codes.includes(session.code));
    socket.send({ type: "closeLobby" });
    await socket.closed;
    expect(await listedCodes()).not.toContain(session.code);
  });

  it("hides and prunes listings that went stale", async () => {
    const { session } = await publicLobby();
    await eventually((codes) => codes.includes(session.code));
    await runInDurableObject(env.DIRECTORY.getByName("directory"), (_, state) => {
      state.storage.sql.exec(
        "UPDATE listings SET updated_at = ? WHERE code = ?",
        Date.now() - LISTING_TTL_MS - 1,
        session.code,
      );
    });
    expect(await listedCodes()).not.toContain(session.code);
  });

  it("keeps a quiet lobby listed by refreshing it before the TTL", async () => {
    const { session } = await publicLobby();
    await eventually((codes) => codes.includes(session.code));
    const directory = env.DIRECTORY.getByName("directory");
    const stub = env.LOBBY.getByName(session.code);
    // Nothing has happened in the lobby for most of the TTL.
    const old = Date.now() - LISTING_REFRESH_MS - 1;
    await runInDurableObject(directory, (_, state) => {
      state.storage.sql.exec(
        "UPDATE listings SET updated_at = ? WHERE code = ?",
        old,
        session.code,
      );
    });
    await runInDurableObject(stub, (instance) => {
      (instance as unknown as { listedAt: number }).listedAt = old;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const updatedAt = () =>
      runInDurableObject(
        directory,
        (_, state) =>
          state.storage.sql
            .exec<{ updated_at: number }>(
              "SELECT updated_at FROM listings WHERE code = ?",
              session.code,
            )
            .toArray()[0]?.updated_at ?? 0,
      );
    // The refresh is sent after the alarm returns.
    for (let i = 0; i < 50 && (await updatedAt()) <= old; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await updatedAt()).toBeGreaterThan(old);
  });

  it("is rate-limited per client", async () => {
    const ip = "203.0.113.140";
    for (let i = 0; i < LIMITS.browse.limit; i++) expect((await browse(ip)).status).toBe(200);
    expect((await browse(ip)).status).toBe(429);
  });
});
