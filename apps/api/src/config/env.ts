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

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: Number(optional("PORT", "3000")),
  DATABASE_URL: required("DATABASE_URL"),
  WEB_URL: optional("WEB_URL", "http://localhost:5173"),
  SESSION_COOKIE_NAME: optional("SESSION_COOKIE_NAME", "qivo_session"),
  SESSION_DAYS: Number(optional("SESSION_DAYS", "30")),
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
