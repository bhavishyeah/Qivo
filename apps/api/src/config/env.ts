import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function positiveInt(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: Number(optional("PORT", "3000")),
  DATABASE_URL: required("DATABASE_URL"),
  WEB_URL: optional("WEB_URL", "http://localhost:5173"),
  SESSION_COOKIE_NAME: optional("SESSION_COOKIE_NAME", "qivo_session"),
  SESSION_DAYS: Number(optional("SESSION_DAYS", "30")),
  // Rate limits per 15-minute window. See .env.example.
  RATE_LIMIT_MAX: positiveInt("RATE_LIMIT_MAX", 2000),
  RATE_LIMIT_IP_MAX: positiveInt("RATE_LIMIT_IP_MAX", 10000),
  RATE_LIMIT_PUBLIC_MAX: positiveInt("RATE_LIMIT_PUBLIC_MAX", 1000),
  TRUST_PROXY_HOPS: positiveInt("TRUST_PROXY_HOPS", 1),
  RESPONSE_EDIT_SECRET: optional(
    "RESPONSE_EDIT_SECRET",
    "dev-insecure-response-edit-secret-change-me",
  ),
} as const;

// Same-session response-edit tokens are HMAC-signed with RESPONSE_EDIT_SECRET.
// In production an unset secret falls back to a well-known insecure default, so
// warn loudly rather than crash (editing is opt-in per form, so a hard throw
// would take down the whole server for a feature most forms won't use).
if (
  env.NODE_ENV === "production" &&
  !process.env.RESPONSE_EDIT_SECRET
) {
  console.warn(
    "[env] RESPONSE_EDIT_SECRET is unset in production; same-session " +
      "response-edit tokens use an insecure dev default. Set a random value.",
  );
}

export type Env = typeof env;
