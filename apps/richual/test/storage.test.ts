import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { migrate, SCHEMA_VERSION } from "../src/worker/schema";
import { connect, createLobby, currentPlayerId, joinLobby } from "./helpers";

type Column = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

/** Every user table with its columns and indexes, for comparing two databases. */
function describeSchema(sql: SqlStorage) {
  const tables = sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .toArray()
    .map((t) => t.name);
  return Object.fromEntries(
    tables.map((table) => [
      table,
      {
        columns: sql.exec<Column>(`PRAGMA table_info(${table})`).toArray(),
        indexes: sql
          .exec<{ unique: number; origin: string }>(`PRAGMA index_list(${table})`)
          .toArray()
          .map((i) => `${i.origin}:${i.unique}`)
          .sort(),
      },
    ]),
  );
}

describe("lobby storage", () => {
  it("creates new lobbies with exactly the schema all migrations produce", async () => {
    const { code } = await createLobby();
    const fresh = await runInDurableObject(env.LOBBY.getByName(code), (_, state) =>
      describeSchema(state.storage.sql),
    );
    const migrated = await runInDurableObject(
      env.LOBBY.getByName("migration-check"),
      (_, state) => {
        migrate(state.storage);
        return describeSchema(state.storage.sql);
      },
    );
    expect(fresh).toEqual(migrated);

    const version = await runInDurableObject(env.LOBBY.getByName(code), (_, state) =>
      state.storage.sql
        .exec<{ value: number }>("SELECT value FROM _meta WHERE key = 'schema_version'")
        .one(),
    );
    expect(version.value).toBe(SCHEMA_VERSION);
  });

  it("writes no more than the game and lobby rows for an action", async () => {
    const hostSession = await createLobby();
    const guestSession = await joinLobby(hostSession.code, "Guest");
    const host = await connect(hostSession);
    const guest = await connect(guestSession);
    host.socket.send({ type: "startGame" });
    const { lobby } = await guest.socket.until("lobby");
    const current = currentPlayerId(lobby) === hostSession.playerId ? host : guest;

    const changes = () =>
      runInDurableObject(env.LOBBY.getByName(hostSession.code), (_, state) =>
        state.storage.sql.exec<{ n: number }>("SELECT total_changes() AS n").one(),
      ).then((r) => r.n);
    const before = await changes();
    current.socket.send({
      type: "action",
      clientActionId: crypto.randomUUID(),
      expectedVersion: lobby.version,
      action: { type: "roll" },
    });
    await current.socket.until("ack");
    expect((await changes()) - before).toBeLessThanOrEqual(2);
  });
});
