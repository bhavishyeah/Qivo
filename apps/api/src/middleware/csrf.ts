import type { NextFunction, Request, Response } from "express";

/**
 * Lightweight CSRF protection via Origin/Referer header validation.
 *
 * Since we use SameSite=Lax cookies, cross-origin POST requests from
 * other sites won't include the session cookie. This middleware adds
 * defense-in-depth by rejecting state-changing requests where the
 * Origin doesn't match our allowed origins.
 *
 * GET/HEAD/OPTIONS are safe methods and are always allowed through.
 */
export function csrfProtection(allowedOrigins: string[]) {
  const origins = new Set(
    allowedOrigins.map((o) => o.replace(/\/$/, "")),
  );

  return (req: Request, res: Response, next: NextFunction) => {
    // Safe methods don't need CSRF protection
    const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
    if (safeMethods.has(req.method)) {
      next();
      return;
    }

    // Public form submission endpoints skip CSRF (no cookie auth)
    if (req.path.includes("/public/")) {
      next();
      return;
    }

    // Requests authenticated purely via a Bearer token are not CSRF-able: a
    // malicious cross-site page cannot set a custom Authorization header
    // without a CORS preflight, which our CORS config controls. Only
    // cookie/ambient-credential requests need Origin validation.
    const authHeader = req.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      next();
      return;
    }

    const origin = req.get("Origin") || req.get("Referer");

    // For state-changing, non-Bearer (i.e. cookie/ambient) requests we REQUIRE
    // a valid same-site Origin/Referer. Real browsers always send one on such
    // requests; a missing header is treated as a failed CSRF check rather than
    // being allowed through.
    if (origin) {
      try {
        const requestOrigin = new URL(origin).origin;
        if (origins.has(requestOrigin)) {
          next();
          return;
        }
      } catch {
        // Malformed origin — fall through to rejection.
      }
    }

    res.status(403).json({
      success: false,
      error: {
        code: "CSRF_REJECTED",
        message: "Request origin not allowed.",
      },
    });
  };
}
