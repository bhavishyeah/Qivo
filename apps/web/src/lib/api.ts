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
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: "GET" });
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
