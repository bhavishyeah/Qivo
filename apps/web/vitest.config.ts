import { defineConfig } from "vitest/config";

// Minimal Vitest setup scoped to the pure unit tests. The piping resolver and
// theme helpers are DOM-free; the Chips component is rendered to static markup
// via react-dom/server, so a plain node environment is sufficient.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
