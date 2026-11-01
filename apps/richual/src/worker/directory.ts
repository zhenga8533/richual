import { DurableObject } from "cloudflare:workers";
import type { PublicLobby } from "@richual/protocol";

/**
 * Listings older than this are hidden and pruned. Lobbies refresh their listing
 * on every change, so this only catches ones that vanished without removing it.
 */
export const LISTING_TTL_MS = 2 * 60 * 60 * 1000;

export type Listing = Omit<PublicLobby, "updatedAt">;

/** The single list of public lobbies waiting for players (one instance, "directory"). */
export class DirectoryDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS listings (
         code TEXT PRIMARY KEY,
         host_name TEXT NOT NULL,
         players INTEGER NOT NULL,
         max_players INTEGER NOT NULL,
         mode TEXT NOT NULL,
         speed_die INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       );`,
    );
  }

  async upsert(listing: Listing): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO listings (code, host_name, players, max_players, mode, speed_die, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET host_name = excluded.host_name, players = excluded.players,
         max_players = excluded.max_players, mode = excluded.mode, speed_die = excluded.speed_die,
         updated_at = excluded.updated_at`,
      listing.code,
      listing.hostName,
      listing.players,
      listing.maxPlayers,
      listing.mode,
      listing.speedDie ? 1 : 0,
      Date.now(),
    );
  }

  async remove(code: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM listings WHERE code = ?", code);
  }

  /** Newest first, after pruning listings past their TTL. */
  async list(limit: number): Promise<PublicLobby[]> {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM listings WHERE updated_at <= ?", Date.now() - LISTING_TTL_MS);
    return sql
      .exec<{
        code: string;
        host_name: string;
        players: number;
        max_players: number;
        mode: string;
        speed_die: number;
        updated_at: number;
      }>("SELECT * FROM listings ORDER BY updated_at DESC LIMIT ?", limit)
      .toArray()
      .map((row) => ({
        code: row.code,
        hostName: row.host_name,
        players: row.players,
        maxPlayers: row.max_players,
        mode: row.mode === "quick" ? "quick" : "classic",
        speedDie: row.speed_die === 1,
        updatedAt: row.updated_at,
      }));
  }
}
