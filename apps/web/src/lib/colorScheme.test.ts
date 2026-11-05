import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyScheme,
  COLOR_SCHEME_KEY,
  getStoredScheme,
  resolveInitialScheme,
  setStoredScheme,
} from "./colorScheme";

// Minimal DOM/storage/matchMedia stubs so colorScheme can be exercised under
// the web suite's plain `node` test environment (no jsdom), mirroring the
// installDocumentStub pattern in theme.test.ts.

function installStubs(opts?: { prefersDark?: boolean }) {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  const docEl = { dataset: {} as Record<string, string> };
  (globalThis as { document?: unknown }).document = {
    documentElement: docEl,
  };

  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => ({
      matches: query.includes("dark") ? Boolean(opts?.prefersDark) : false,
    }),
  };

  return {
    store,
    docEl,
    teardown() {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      delete (globalThis as { document?: unknown }).document;
      delete (globalThis as { window?: unknown }).window;
    },
  };
}

describe("getStoredScheme / setStoredScheme", () => {
  let env: ReturnType<typeof installStubs>;
  beforeEach(() => {
    env = installStubs();
  });
  afterEach(() => env.teardown());

  it("round-trips a stored scheme", () => {
    expect(getStoredScheme()).toBeNull();
    setStoredScheme("dark");
    expect(env.store.get(COLOR_SCHEME_KEY)).toBe("dark");
    expect(getStoredScheme()).toBe("dark");
    setStoredScheme("light");
    expect(getStoredScheme()).toBe("light");
  });

  it("returns null for an invalid stored value", () => {
    env.store.set(COLOR_SCHEME_KEY, "purple");
    expect(getStoredScheme()).toBeNull();
  });
});

describe("resolveInitialScheme", () => {
  let env: ReturnType<typeof installStubs>;
  afterEach(() => env.teardown());

  it("prefers a stored choice over OS preference", () => {
    env = installStubs({ prefersDark: true });
    setStoredScheme("light");
    expect(resolveInitialScheme()).toBe("light");
  });

  it("falls back to matchMedia when nothing is stored", () => {
    env = installStubs({ prefersDark: true });
    expect(resolveInitialScheme()).toBe("dark");
  });

  it("falls back to light when nothing stored and OS is not dark", () => {
    env = installStubs({ prefersDark: false });
    expect(resolveInitialScheme()).toBe("light");
  });
});

describe("applyScheme", () => {
  let env: ReturnType<typeof installStubs>;
  beforeEach(() => {
    env = installStubs();
  });
  afterEach(() => env.teardown());

  it("sets documentElement.dataset.colorScheme", () => {
    applyScheme("dark");
    expect(env.docEl.dataset.colorScheme).toBe("dark");
    applyScheme("light");
    expect(env.docEl.dataset.colorScheme).toBe("light");
  });
});
