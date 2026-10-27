import { defineConfig } from "vitest/config";

// Minimal Vitest setup scoped to the pure library unit tests. The piping
// resolver is DOM-free, so a plain node environment is sufficient.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
