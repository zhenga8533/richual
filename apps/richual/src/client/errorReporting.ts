import { type ClientErrorReport, PROTOCOL_VERSION } from "@richual/protocol";

/** One broken render can throw in a loop; a handful of reports per page load is plenty. */
const MAX_REPORTS = 5;
let sent = 0;
const seen = new Set<string>();

export function reportError(kind: ClientErrorReport["kind"], error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const key = `${kind}:${err.message}`;
  if (sent >= MAX_REPORTS || seen.has(key)) return;
  seen.add(key);
  sent++;
  const report: ClientErrorReport = {
    kind,
    message: err.message.slice(0, 500),
    stack: err.stack?.slice(0, 3000),
    // The fragment can hold a seat code, so only the path is sent.
    path: location.pathname.slice(0, 200),
    version: String(PROTOCOL_VERSION),
  };
  fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch((sendError: unknown) => {
    console.warn("could not report an error", sendError);
  });
}

export function installErrorReporting(): void {
  window.addEventListener("error", (e) => reportError("error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportError("rejection", e.reason));
}
