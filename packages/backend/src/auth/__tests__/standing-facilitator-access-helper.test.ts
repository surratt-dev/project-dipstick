import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbQuery = vi.fn();
vi.mock("../../db.js", () => ({ db: { query: (...args: unknown[]) => mockDbQuery(...args) } }));

import { checkStandingFacilitatorOrAdminAuthorization } from "../standing-facilitator-access-helper.js";

// #264 task 1.1: a direct assertion on the three denied return sites. The
// actorGlobalRole field is audit-only (TOPIC-002); this is the only direct
// test of the helper's decision values.
describe("checkStandingFacilitatorOrAdminAuthorization -- denied variant carries actorGlobalRole (#264)", () => {
  beforeEach(() => mockDbQuery.mockReset());

  it("no users row: NOT_A_FACILITATOR with actorGlobalRole null", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await checkStandingFacilitatorOrAdminAuthorization("u", "t")).toEqual({
      authorized: false,
      reason: "NOT_A_FACILITATOR",
      actorGlobalRole: null,
    });
  });

  it("a non-facilitator: NOT_A_FACILITATOR with that role", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineering_manager", is_member: true }] });
    expect(await checkStandingFacilitatorOrAdminAuthorization("u", "t")).toEqual({
      authorized: false,
      reason: "NOT_A_FACILITATOR",
      actorGlobalRole: "engineering_manager",
    });
  });

  it("a member facilitator: FACILITATOR_IS_TEAM_MEMBER with facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "facilitator", is_member: true }] });
    expect(await checkStandingFacilitatorOrAdminAuthorization("u", "t")).toEqual({
      authorized: false,
      reason: "FACILITATOR_IS_TEAM_MEMBER",
      actorGlobalRole: "facilitator",
    });
  });

  it("the authorized variant is unchanged", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "facilitator", is_member: false }] });
    expect(await checkStandingFacilitatorOrAdminAuthorization("u", "t")).toEqual({
      authorized: true,
      actorGlobalRole: "facilitator",
    });
  });
});
