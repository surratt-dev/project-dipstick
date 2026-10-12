import { describe, it, expect, vi } from "vitest";
import { assertSafeToDropIndex, withDroppedActiveOrderIndex } from "./template-lock.js";

describe("assertSafeToDropIndex (#215 3.4 guard)", () => {
  it("allows NODE_ENV=test on localhost and 127.0.0.1", () => {
    expect(() => assertSafeToDropIndex({ NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@localhost:5433/d" })).not.toThrow();
    expect(() => assertSafeToDropIndex({ NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@127.0.0.1/d" })).not.toThrow();
  });
  it("throws for a non-test environment", () => {
    expect(() => assertSafeToDropIndex({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost/d" })).toThrow(/NODE_ENV/);
  });
  it("throws for a non-local host", () => {
    expect(() => assertSafeToDropIndex({ NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@db.prod.example.com/d" })).toThrow(/non-local/);
  });
  it("throws for a missing or invalid DATABASE_URL", () => {
    expect(() => assertSafeToDropIndex({ NODE_ENV: "test" })).toThrow();
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
