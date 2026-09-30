import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test-setup.ts"],
      thresholds: { lines: 90 },
    },
  },
});
