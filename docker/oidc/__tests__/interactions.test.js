import { describe, it, expect } from "vitest";
import { resolveKnownAccountId } from "../interactions.js";
import { accounts } from "../accounts.js";

// persona-login tasks.md 3.5: an absent login_hint and an unrecognized
// login_hint are two distinct conditions and must both exercise the same
// fallback branch -- asserted here as two separate cases rather than one.
describe("resolveKnownAccountId", () => {
  it("returns the account id when login_hint matches a known seeded account", () => {
    expect(resolveKnownAccountId("manager-001", accounts)).toBe("manager-001");
    expect(resolveKnownAccountId("admin-001", accounts)).toBe("admin-001");
    expect(resolveKnownAccountId("facilitator-001", accounts)).toBe("facilitator-001");
    expect(resolveKnownAccountId("participant-001", accounts)).toBe("participant-001");
  });

  it("returns undefined when login_hint is absent", () => {
    expect(resolveKnownAccountId(undefined, accounts)).toBeUndefined();
    expect(resolveKnownAccountId("", accounts)).toBeUndefined();
  });

  it("returns undefined when login_hint does not match a known account (unrecognized, not absent)", () => {
    expect(resolveKnownAccountId("not-a-real-account", accounts)).toBeUndefined();
  });

  it("does not fall prey to Object.prototype pollution via a well-known property name", () => {
    expect(resolveKnownAccountId("toString", accounts)).toBeUndefined();
    expect(resolveKnownAccountId("constructor", accounts)).toBeUndefined();
  });
});

describe("accounts", () => {
  it("carries a role claim only on manager-001 and admin-001", () => {
    expect(accounts["manager-001"].role).toBe("engineering_manager");
    expect(accounts["admin-001"].role).toBe("application_admin");
    expect(accounts["facilitator-001"].role).toBeUndefined();
    expect(accounts["participant-001"].role).toBeUndefined();
  });
});
