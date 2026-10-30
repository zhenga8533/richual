/**
 * Append-only list of schema migrations for a lobby's SQLite database.
 * Never edit a shipped entry: existing lobbies have already applied it.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE lobby (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     code TEXT NOT NULL,
     host_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_active_at INTEGER NOT NULL
   );
   CREATE TABLE players (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     seat INTEGER NOT NULL UNIQUE,
     token_hash TEXT NOT NULL UNIQUE,
     joined_at INTEGER NOT NULL
   );`,
  `ALTER TABLE lobby ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
   ALTER TABLE lobby ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE lobby ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE players ADD COLUMN hero TEXT;
   CREATE TABLE game (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     state_json TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE actions (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     player_id TEXT NOT NULL,
     client_action_id TEXT NOT NULL,
     action_json TEXT NOT NULL,
     at INTEGER NOT NULL,
     UNIQUE (player_id, client_action_id)
   );`,
  `ALTER TABLE lobby ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE lobby ADD COLUMN play_ms INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE lobby ADD COLUMN resumed_at INTEGER;
   ALTER TABLE lobby ADD COLUMN action_deadline INTEGER;
   ALTER TABLE lobby ADD COLUMN host_check_at INTEGER;
   CREATE TABLE chat (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     player_id TEXT NOT NULL,
     text TEXT NOT NULL,
     at INTEGER NOT NULL
   );`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function isInitialized(sql: SqlStorage): boolean {
  return (
    sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_meta'").toArray()
      .length > 0
  );
}

export function migrate(storage: DurableObjectStorage): void {
  const { sql } = storage;
  storage.transactionSync(() => {
    sql.exec("CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)");
    const current =
      sql
        .exec<{ value: number }>("SELECT value FROM _meta WHERE key = 'schema_version'")
        .toArray()[0]?.value ?? 0;
    if (current > MIGRATIONS.length) {
      throw new Error(`stored schema v${current} is newer than code v${MIGRATIONS.length}`);
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      sql.exec(MIGRATIONS[v] as string);
    }
    sql.exec(
      "INSERT INTO _meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      MIGRATIONS.length,
    );
  });
}
