import type { CookieOptions } from "express";

/**
 * Cookie configuration for session tokens.
 *
 * In production with cross-domain deployment (e.g., Vercel frontend + Railway API),
 * we need sameSite: "none" + secure: true so the cookie is sent cross-origin.
 *
 * In development (same localhost), sameSite: "lax" is fine.
 */
export function getSessionCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === "production";
  const maxAge = Number(process.env.SESSION_DAYS || 30) * 24 * 60 * 60 * 1000;

  if (isProduction) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge,
      path: "/",
    };
  }

  return {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge,
    path: "/",
  };
}

export function getClearCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    };
  }

  return {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
  };
}
