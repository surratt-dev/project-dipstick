import { describe, it, expect, vi } from "vitest";
import { assertSafeToDropIndex, withDroppedActiveOrderIndex } from "./template-lock.js";

describe("assertSafeToDropIndex (#215 3.4 guard)", () => {
  it("allows a Vitest run on localhost and 127.0.0.1", () => {
    expect(() => assertSafeToDropIndex({ VITEST: "true", DATABASE_URL: "postgresql://u:p@localhost:5433/d" })).not.toThrow();
    expect(() => assertSafeToDropIndex({ VITEST: "true", DATABASE_URL: "postgresql://u:p@127.0.0.1/d" })).not.toThrow();
  });
  it("throws outside Vitest, whatever NODE_ENV says", () => {
    expect(() => assertSafeToDropIndex({ NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@localhost/d" })).toThrow(/VITEST/);
  });
  it("throws for a non-local host", () => {
    expect(() => assertSafeToDropIndex({ VITEST: "true", DATABASE_URL: "postgresql://u:p@db.prod.example.com/d" })).toThrow(/non-local/);
  });
  it("throws for a missing or invalid DATABASE_URL", () => {
    expect(() => assertSafeToDropIndex({ VITEST: "true" })).toThrow();
  });

  it("withDroppedActiveOrderIndex throws before connecting or running fn when the guard fails", async () => {
    const saved = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = "postgresql://u:p@db.prod.invalid/d";
    const fn = vi.fn();
    try {
      await expect(withDroppedActiveOrderIndex(fn)).rejects.toThrow(/non-local/);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      process.env["DATABASE_URL"] = saved;
    }
  });
});
