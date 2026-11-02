// Fails the build when the scripts the landing page downloads up front grow past the
// budget. The lobby and game load lazily and don't count.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 100;
const dist = fileURLToPath(new URL("../dist/client/", import.meta.url));

const html = readFileSync(join(dist, "index.html"), "utf8");
const scripts = [
  ...html.matchAll(/<script[^>]+src="\/(assets\/[^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/(assets\/[^"]+\.js)"/g),
].map((m) => m[1]);

let total = 0;
for (const file of scripts) {
  const kb = gzipSync(readFileSync(join(dist, file))).length / 1024;
  total += kb;
  console.log(`  ${file}  ${kb.toFixed(1)} KB gzip`);
}
console.log(`Landing page scripts: ${total.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (scripts.length === 0 || total > BUDGET_KB) {
  console.error(
    scripts.length === 0 ? "No landing scripts found in index.html" : "Over the landing budget",
  );
  process.exit(1);
}
