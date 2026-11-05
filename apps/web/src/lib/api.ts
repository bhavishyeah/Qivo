const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "";

type ApiResponse<T> = {
  success: true;
  data: T;
};

type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

type ApiResult<T> = ApiResponse<T> | ApiError;

export class ApiRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApiRequestError";
  }
}

/**
 * Parse a fetch Response into our API envelope, turning ANY failure into an
 * ApiRequestError. Handles the cases the old code didn't: non-JSON bodies
 * (gateway 502/504 HTML pages, proxy errors), empty/204 responses, and network
 * hiccups. Also fires the session-expired event on a 401 regardless of body
 * shape. Returns the unwrapped `data` on success.
 */
async function parseApiResponse<T>(response: Response): Promise<T> {
  // 204 No Content (or an empty body) — success with nothing to unwrap.
  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text();
  let body: ApiResult<T> | null = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as ApiResult<T>;
    } catch {
      body = null; // Non-JSON response (e.g. an HTML error page from a proxy).
    }
  }

  if (!response.ok || !body || body.success !== true) {
    if (response.status === 401) {
      // Let the app surface the "session expired" banner. Fires even when the
      // 401 body isn't our JSON envelope (e.g. a gateway-level 401).
      window.dispatchEvent(new CustomEvent("qivo:session-expired"));
    }

    if (body && body.success === false) {
      throw new ApiRequestError(
        body.error?.code ?? "UNKNOWN",
        body.error?.message ?? "Something went wrong.",
      );
    }

    // No usable JSON envelope — synthesize an error from the HTTP status.
    throw new ApiRequestError(
      body === null && raw ? "PARSE_ERROR" : "UNKNOWN",
      response.status >= 500
        ? "The server is temporarily unavailable. Please try again."
        : "Something went wrong.",
    );
  }

  return body.data;
}

// Session token stored in memory + localStorage for persistence
let sessionToken: string | null = localStorage.getItem("qivo_token");

export function setToken(token: string | null) {
  sessionToken = token;
  if (token) {
    localStorage.setItem("qivo_token", token);
  } else {
    localStorage.removeItem("qivo_token");
  }
}

export function getToken(): string | null {
  return sessionToken;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  }

  // Spread caller options FIRST, then set headers, so a caller passing its own
  // `headers` in options can't accidentally clobber the merged auth headers.
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  return parseApiResponse<T>(response);
}

export const api = {
  get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T> {
    return request<T>(path, {
      method: "GET",
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
  },

  post<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  patch<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};

// Public API (no auth token needed)
export async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
  });

  return parseApiResponse<T>(response);
}

export async function publicPost<T>(
  path: string,
  data: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  return parseApiResponse<T>(response);
}

// Create a Razorpay order for a payment-enabled form. No body is sent — the
// amount is computed server-side from stored settings. In respondent mode the
// client sends `requestedAmount` (integer PAISE), which the server validates
// against the form's bounds; it is ignored in fixed mode.
export async function createPaymentOrder(
  slug: string,
  body: {
    answers: Record<string, unknown>;
    email?: string;
    requestedAmount?: number;
  },
): Promise<{
  orderId: string;
  amount: number;
  currency: string;
  keyId: string | null;
}> {
  return publicPost(`/api/forms/public/${slug}/payment/order`, body);
}

// Pre-Checkout duplicate pre-check. Boolean-only; called before opening
// Checkout on collectEmail && !allowMultipleResponses forms.
export async function checkResponseExists(
  slug: string,
  email: string,
): Promise<{ alreadyResponded: boolean }> {
  return publicPost(`/api/forms/public/${slug}/response-check`, { email });
}

// ---------------------------------------------------------------------------
// Partial save / resume later — draft helpers.
// ---------------------------------------------------------------------------

// Save (create or update) a draft of the in-progress answers. No token → the
// server creates a new draft and returns a fresh token; a valid token → update.
export async function saveDraft(
  slug: string,
  body: {
    answers: Record<string, unknown>;
    email?: string;
    currentSection?: number;
    token?: string;
  },
): Promise<{ token: string; expiresAt: string }> {
  return publicPost(`/api/forms/public/${slug}/draft`, body);
}

// Load a saved draft by token. Rejects (ApiRequestError) on an unknown/expired
// token so the caller can show a friendly "start fresh" notice.
export async function loadDraft(
  slug: string,
  token: string,
): Promise<{
  answers: Record<string, unknown>;
  email: string | null;
  currentSection: number | null;
}> {
  return publicGet(
    `/api/forms/public/${slug}/draft?token=${encodeURIComponent(token)}`,
  );
}

// Best-effort delete of a draft after a successful submit. Uses a raw fetch
// because publicPost is POST-only and the endpoint expects DELETE + a body.
// Swallows all errors — a failed prune just leaves the row for the 30-day sweep.
export async function deleteDraft(slug: string, token: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/forms/public/${slug}/draft`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => {});
}

// Best-effort "email me the resume link". The link is always shown on-screen too,
// so any failure here is swallowed.
export async function emailResumeLink(
  slug: string,
  token: string,
  email: string,
): Promise<void> {
  await publicPost(`/api/forms/public/${slug}/draft/email`, {
    token,
    email,
  }).catch(() => {});
}
