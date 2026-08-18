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

const port = Number(process.env.PORT ?? 3000);

console.log("Starting Qivo API...");

app.listen(port, () => {
  console.log(`Qivo API running at http://localhost:${port}`);
});