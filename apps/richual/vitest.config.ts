import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["test/**/*.test.ts"],
    // Each test makes several Durable Object round trips, and rate-limit tests dozens;
    // with every file running in parallel, 5 s is too tight on slower machines.
    testTimeout: 30_000,
  },
});
