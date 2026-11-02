import { exports } from "cloudflare:workers";
import type { LobbySnapshot, PublicLobbiesResponse } from "@richual/protocol";
import { describe, expect, it } from "vitest";
import { PASSCODE_MAX_FAILURES } from "../src/worker/lobby";
import { BASE, connect, createLobby, post, type TestSocket } from "./helpers";

const join = (code: string, passcode?: string) =>
  post(`/api/lobbies/${code}/join`, { name: "Guest", passcode });

async function waitFor(socket: TestSocket, ok: (lobby: LobbySnapshot) => boolean) {
  for (;;) {
    const { lobby } = await socket.until("lobby");
    if (ok(lobby)) return lobby;
  }
}

async function lockedLobby(passcode = "hunter22") {
  const session = await createLobby("Keeper");
  const { socket, lobby } = await connect(session);
  socket.send({
    type: "updateSettings",
    settings: { ...lobby.settings, visibility: "passcode" },
    passcode,
  });
  const locked = await waitFor(socket, (l) => l.settings.visibility === "passcode");
  return { session, socket, lobby: locked };
}

describe("passcode lobbies", () => {
  it("can't switch to a passcode without one", async () => {
    const session = await createLobby();
    const { socket, lobby } = await connect(session);
    socket.send({
      type: "updateSettings",
      settings: { ...lobby.settings, visibility: "passcode" },
    });
    expect(await socket.until("error")).toMatchObject({ error: "rejected" });
    expect((await join(session.code)).status).toBe(201);
  });

  it("refuses passcodes that are too short", async () => {
    const session = await createLobby();
    const { socket, lobby } = await connect(session);
    socket.send({
      type: "updateSettings",
      settings: { ...lobby.settings, visibility: "passcode" },
      passcode: "abc",
    });
    expect(await socket.until("error")).toMatchObject({ error: "bad_request" });
  });

  it("lets in only joiners with the passcode", async () => {
    const { session } = await lockedLobby();
    const missing = await join(session.code);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ error: "passcode_required" });
    const wrong = await join(session.code, "hunter23");
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ error: "wrong_passcode" });
    expect((await join(session.code, "  hunter22 ")).status).toBe(201);
  });

  it("tells the join page it is locked, without the passcode", async () => {
    const { session } = await lockedLobby();
    const res = await exports.default.fetch(`${BASE}/api/lobbies/${session.code}`);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ locked: true });
    expect(body).not.toContain("hunter22");
  });

  it("never sends the passcode to players", async () => {
    const { socket, lobby } = await lockedLobby("s3cret-word");
    socket.send({ type: "chat", text: "hi" });
    const next = await socket.until("lobby");
    expect(JSON.stringify(lobby)).not.toContain("s3cret-word");
    expect(JSON.stringify(next)).not.toContain("s3cret-word");
  });

  it("keeps the passcode when other settings change, and replaces it when set again", async () => {
    const { session, socket, lobby } = await lockedLobby("first-code");
    socket.send({ type: "updateSettings", settings: { ...lobby.settings, startingCash: 2000 } });
    const changed = await waitFor(socket, (l) => l.settings.startingCash === 2000);
    expect((await join(session.code)).status).toBe(401);

    socket.send({ type: "updateSettings", settings: changed.settings, passcode: "second-code" });
    await socket.until("lobby");
    expect((await join(session.code, "first-code")).status).toBe(403);
    expect((await join(session.code, "second-code")).status).toBe(201);
  });

  it("drops the passcode when the lobby goes private", async () => {
    const { session, socket, lobby } = await lockedLobby();
    socket.send({ type: "updateSettings", settings: { ...lobby.settings, visibility: "private" } });
    await waitFor(socket, (l) => l.settings.visibility === "private");
    expect((await join(session.code)).status).toBe(201);

    // Going back to a passcode needs a new one.
    socket.send({
      type: "updateSettings",
      settings: { ...lobby.settings, visibility: "passcode" },
    });
    expect(await socket.until("error")).toMatchObject({ error: "rejected" });
  });

  it("stops taking guesses after too many wrong passcodes", async () => {
    const { session } = await lockedLobby();
    for (let i = 0; i < PASSCODE_MAX_FAILURES; i++) {
      expect((await join(session.code, `guess-${i}`)).status).toBe(403);
    }
    const locked = await join(session.code, "hunter22");
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: "rate_limited" });
  });

  it("shows as locked on the Browse list", async () => {
    const { session } = await lockedLobby();
    let listing: PublicLobbiesResponse["lobbies"][number] | undefined;
    // Directory writes land after the lobby replies.
    for (let i = 0; i < 50 && !listing; i++) {
      const res = await exports.default.fetch(`${BASE}/api/lobbies/public`);
      listing = ((await res.json()) as PublicLobbiesResponse).lobbies.find(
        (l) => l.code === session.code,
      );
      if (!listing) await new Promise((r) => setTimeout(r, 20));
    }
    expect(listing).toMatchObject({ locked: true, hostName: "Keeper" });
  });
});
