import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/app.ts", "src/config.ts", "src/db.ts", "src/redis.ts"],
      thresholds: { lines: 90 },
    },
  },
});
