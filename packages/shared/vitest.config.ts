import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/types/**",
        "src/index.ts",
      ],
      thresholds: { lines: 90 },
    },
  },
});
