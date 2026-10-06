import { describe, it, expect } from "vitest";
// The stub IdP's own fixture, imported rather than copied, so this check
// cannot drift from what the local OIDC provider actually issues.
// @ts-expect-error -- plain-JS fixture of the stub IdP; it ships no type declarations.
import { accounts } from "../../../../../docker/oidc/accounts.js";
import { DEFAULT_ROLE_MAP, resolveGlobalRole } from "../role-map.js";

// ---------------------------------------------------------------------------
// configurable-oidc-role-map (#243) task 5.2(a), design D9/C8 — the mapping
// half of the R15 acceptance check: under the default role map (local dev,
// no OIDC_ROLE_MAP), the stub's facilitator-001 role claim resolves to a real
// facilitator. The gate half (a facilitator can create a draft session) is
// routes/__tests__/stub-facilitator-session-create-integration.test.ts. This
// is not a browser end-to-end test: the backend suite mocks handleCallback.
// ---------------------------------------------------------------------------
describe("stub accounts under the default role map", () => {
  it("facilitator-001 resolves to facilitator", () => {
    expect(resolveGlobalRole(accounts["facilitator-001"].role, DEFAULT_ROLE_MAP).role).toBe("facilitator");
  });

  it("manager-001, admin-001 and participant-001 resolve as before", () => {
    expect(resolveGlobalRole(accounts["manager-001"].role, DEFAULT_ROLE_MAP).role).toBe("engineering_manager");
    expect(resolveGlobalRole(accounts["admin-001"].role, DEFAULT_ROLE_MAP).role).toBe("application_admin");
    expect(resolveGlobalRole((accounts["participant-001"] as { role?: string }).role, DEFAULT_ROLE_MAP).role).toBe("engineer");
  });
});
