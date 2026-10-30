import { DurableObject } from "cloudflare:workers";

export type TakeResult = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * A sliding-window counter. One instance per client (keyed by a hash of their
 * IP) limits how often that client may act; one shared instance enforces the
 * global daily cap that keeps the free-tier quota safe.
 */
export class GatekeeperDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS hits (kind TEXT NOT NULL, at INTEGER NOT NULL);
       CREATE INDEX IF NOT EXISTS hits_by_kind ON hits (kind, at);`,
    );
  }

  /** Records one use of `kind` if fewer than `limit` happened in the last `windowMs`. */
  async take(kind: string, limit: number, windowMs: number): Promise<TakeResult> {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM hits WHERE kind = ? AND at <= ?", kind, now - windowMs);
    const { count, oldest } = sql
      .exec<{ count: number; oldest: number | null }>(
        "SELECT COUNT(*) AS count, MIN(at) AS oldest FROM hits WHERE kind = ?",
        kind,
      )
      .one();
    if (count >= limit) {
      return { ok: false, retryAfterMs: Math.max(0, (oldest ?? now) + windowMs - now) };
    }
    sql.exec("INSERT INTO hits (kind, at) VALUES (?, ?)", kind, now);
    // Clean up once this client goes quiet, so idle instances hold no storage.
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + windowMs);
    }
    return { ok: true };
  }

  override async alarm(): Promise<void> {
    const newest = this.ctx.storage.sql
      .exec<{ newest: number | null }>("SELECT MAX(at) AS newest FROM hits")
      .one().newest;
    // Every limit's window is at most a day, so anything older is irrelevant.
    if (newest === null || Date.now() - newest > DAY_MS) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(newest + DAY_MS);
  }
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How often a single client may do each thing, and the global cap on new lobbies. */
export const LIMITS = {
  createLobby: { limit: 5, windowMs: 10 * MINUTE_MS },
  joinLobby: { limit: 20, windowMs: 10 * MINUTE_MS },
  claimSeat: { limit: 10, windowMs: 10 * MINUTE_MS },
  clientError: { limit: 30, windowMs: 10 * MINUTE_MS },
  lobbiesPerDay: { limit: 300, windowMs: DAY_MS },
} as const;
