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
} as const;

export type Env = typeof env;
