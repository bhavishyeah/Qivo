// Side-effect module: install a minimal localStorage stub BEFORE any module
// that reads it at import time (src/lib/api.ts reads localStorage.getItem at
// top level). Imported first by PublicFormPage.a11y.test.tsx so the stub is in
// place when the page module graph loads under the plain `node` test env.
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}
