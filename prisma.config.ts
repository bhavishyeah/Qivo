import "dotenv/config";
import { defineConfig } from "prisma/config";

// Read DIRECT_URL lazily via process.env instead of prisma's env() helper.
// env() throws if the var is missing, which breaks `prisma generate` at Docker
// build time (no DB env there). generate does not need a datasource URL; only
// `migrate deploy` does, and DIRECT_URL is present at runtime.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});

