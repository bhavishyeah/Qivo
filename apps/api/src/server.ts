import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Only load .env file in development (Railway injects env vars directly)
if (!process.env.DATABASE_URL) {
  const envPath = existsSync(resolve(process.cwd(), ".env"))
    ? resolve(process.cwd(), ".env")
    : resolve(process.cwd(), "../../.env");

  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

import app from "./app.js";
import { publishDueForms } from "./modules/forms/form.service.js";

const port = Number(process.env.PORT ?? 3000);

console.log(`Starting Qivo API... (PORT=${process.env.PORT ?? "unset, using 3000"})`);

// Bind to 0.0.0.0 so Railway's proxy can reach the container (localhost-only
// binds are unreachable from outside the container).
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Qivo API running on 0.0.0.0:${port}`);
});

// Scheduled publishing: promote forms whose scheduledPublishAt has passed.
// Runs on a timer instead of lazily on the public GET (which would mutate state
// on an unauthenticated read). Fire-and-forget; errors are logged, never fatal.
const PUBLISH_SWEEP_MS = 60_000;
async function runPublishSweep() {
  try {
    const count = await publishDueForms();
    if (count > 0) console.log(`[scheduler] published ${count} scheduled form(s)`);
  } catch (err) {
    console.error("[scheduler] publishDueForms failed:", err);
  }
}
const publishTimer = setInterval(() => void runPublishSweep(), PUBLISH_SWEEP_MS);
// Don't let the timer keep the event loop alive on shutdown.
publishTimer.unref();
// Run once shortly after boot so a just-due form doesn't wait a full interval.
setTimeout(() => void runPublishSweep(), 5_000).unref();

server.on("error", (err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Surface anything that would otherwise kill the process silently.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});
