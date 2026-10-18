import { describe, it, expect } from "vitest";
import { assertSafeTestDatabase } from "./maintenance-test-hygiene.js";

// admin-default-topic-maintenance (#216) tasks.md 2.1: the cleanup helper that
// deletes audit rows refuses to run anywhere but the local test database.
describe("assertSafeTestDatabase", () => {
  const ok = { VITEST: "true", DATABASE_URL: "postgresql://u:p@localhost:5433/dipstick" };
  it("allows the local test database under Vitest", () => {
    expect(() => assertSafeTestDatabase(ok)).not.toThrow();
    expect(() => assertSafeTestDatabase({ ...ok, DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/dipstick_test" })).not.toThrow();
  });
  it("refuses outside Vitest", () => {
    expect(() => assertSafeTestDatabase({ DATABASE_URL: ok.DATABASE_URL })).toThrow(/outside Vitest/);
  });
  it("refuses a non-local host", () => {
    expect(() => assertSafeTestDatabase({ ...ok, DATABASE_URL: "postgresql://u:p@db.internal:5432/dipstick" })).toThrow(/non-local/);
  });
  it("refuses a database that is not the test database", () => {
    expect(() => assertSafeTestDatabase({ ...ok, DATABASE_URL: "postgresql://u:p@localhost:5433/production" })).toThrow(/not the test database/);
  });
  it("refuses a missing or invalid URL", () => {
    expect(() => assertSafeTestDatabase({ VITEST: "1" })).toThrow(/not a valid URL/);
  });
});
