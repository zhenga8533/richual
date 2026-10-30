import { exports } from "cloudflare:workers";
import { CLIENT_ERROR_MAX_BYTES } from "@richual/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../src/worker/gatekeeper";
import { BASE } from "./helpers";

const report = (body: string, ip?: string) =>
  exports.default.fetch(`${BASE}/api/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(ip && { "CF-Connecting-IP": ip }) },
    body,
  });

const valid = JSON.stringify({ kind: "render", message: "boom", path: "/l/ABC123", version: "6" });

describe("client error reports", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a valid report", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await report(valid)).status).toBe(204);
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      event: "clientError",
      message: "boom",
    });
  });

  it("refuses malformed and oversized reports", async () => {
    expect((await report("{not json")).status).toBe(400);
    expect((await report(JSON.stringify({ kind: "other" }))).status).toBe(400);
    expect((await report("x".repeat(CLIENT_ERROR_MAX_BYTES + 1))).status).toBe(413);
  });

  it("rate-limits reports per client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ip = "203.0.113.90";
    for (let i = 0; i < LIMITS.clientError.limit; i++) {
      expect((await report(valid, ip)).status).toBe(204);
    }
    expect((await report(valid, ip)).status).toBe(429);
  });
});
