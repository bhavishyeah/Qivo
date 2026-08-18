import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// In production (Railway, etc.), env vars are injected directly.
// In development, load from .env file.
if (!process.env.DATABASE_URL) {
  const envPath = existsSync(resolve(process.cwd(), ".env"))
    ? resolve(process.cwd(), ".env")
    : resolve(process.cwd(), "../../.env");

  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

export default prisma;