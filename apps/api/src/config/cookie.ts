import type { CookieOptions } from "express";

/**
 * Cookie configuration for session tokens.
 *
 * Using sameSite: "lax" with secure: true in production.
 * This works because Vercel proxies /api/* requests to Railway,
 * so cookies are first-party (same domain).
 */
export function getSessionCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === "production";
  const maxAge = Number(process.env.SESSION_DAYS || 30) * 24 * 60 * 60 * 1000;

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge,
    path: "/",
  };
}

export function getClearCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  };
}
