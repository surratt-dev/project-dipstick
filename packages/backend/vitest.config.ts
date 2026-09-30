import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/app.ts",
        "src/config.ts",
        "src/db.ts",
        "src/redis.ts",
        "src/**/__tests__/**",
        "src/**/*.test.ts",
      ],
      thresholds: { lines: 90 },
    },
  },
});
