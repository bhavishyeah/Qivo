const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3000";

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

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  const body: ApiResult<T> = await response.json();

  if (!response.ok || !body.success) {
    const err = body as ApiError;
    throw new ApiRequestError(
      err.error?.code ?? "UNKNOWN",
      err.error?.message ?? "Something went wrong.",
    );
  }

  return body.data;
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

// Public API (no auth cookie needed, no content-type default)
export async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
  });

  const body: ApiResult<T> = await response.json();

  if (!response.ok || !body.success) {
    const err = body as ApiError;
    throw new ApiRequestError(
      err.error?.code ?? "UNKNOWN",
      err.error?.message ?? "Something went wrong.",
    );
  }

  return body.data;
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

  const body: ApiResult<T> = await response.json();

  if (!response.ok || !body.success) {
    const err = body as ApiError;
    throw new ApiRequestError(
      err.error?.code ?? "UNKNOWN",
      err.error?.message ?? "Something went wrong.",
    );
  }

  return body.data;
}
