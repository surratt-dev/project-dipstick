# Spec-Sync Verification — join-team-invite-link

**Reviewer:** Marcus Delgado, Business Analyst
**Date:** 2026-07-06
**Verdict:** ALIGNED (after merging delta and correcting three gaps)

---

## Merged from Delta

The following requirements were in the delta file (`openspec/changes/join-team-invite-link/specs/join-link/spec.md`) but had not yet been merged into the main spec (`openspec/specs/join-link/spec.md`) when the sync was interrupted. They are now present in the main spec.

**Accurate `sourceIp` in join audit events (ADDED)**
The delta required that `join.link_redeemed` and `join.link_rejected` events carry `request.ip` on both paths, and that `executeJoinFlow` accept `sourceIp` as a required (non-optional) parameter to make omission a type error. This requirement and its two scenarios were not yet in the main spec and have been added under "Requirement: Accurate `sourceIp` in join audit events."

---

## Drift — Resolved

**Log redaction not captured in delta.**
The Fastify request serializer in `packages/backend/src/app.ts` (lines 28–39) redacts join tokens from all request log lines for two URL patterns: `/api/join/<token>` and `/auth/login?joinToken=<token>`. This is a security-relevant implementation detail — it means tokens cannot appear in application logs regardless of which path a request follows. The delta file omitted this behavior entirely. It has been added to the main spec as a bold implementation note within "Requirement: Join-link-through-authentication flow" under the heading "Join token log redaction."

**?newMember=true asymmetry underdocumented.**
The main spec (post-prior-partial-sync) already said the `?newMember=true` parameter is "appended by the through-auth path's `executeJoinFlow`," which correctly excluded the direct path. But it did not state the exclusion explicitly, nor explain why. Reading `packages/backend/src/routes/join-links.ts` confirmed: the direct path appends `?alreadyMember=true` for existing members and no outcome parameter for new members. A "Path asymmetry" paragraph has been added to "Requirement: New-member confirmation on team page" documenting both the behavior and the rationale (user clicked the link deliberately; outcome is self-evident; a banner adds no value).

---

## Already Aligned (Prior Partial Sync)

The following items from the delta were already present in the main spec before this sync resumed. They are confirmed aligned and required no changes.

- **Through-auth error delivery:** `executeJoinFlow` returns `{ redirectUrl: string }` (never null); errors route to `/join-error?joinError=expired` or `/join-error?joinError=invalid`, not `/auth/error` or `/no-team`. Confirmed in `auth.ts` lines 459, 475. Main spec requirement "Through-auth join error delivery" is accurate.
- **OIDC state retrieval atomicity (`redis.getdel`):** Confirmed in `auth.ts` line 87 with the correct explanatory comment. Main spec documents this under the through-auth flow requirement.
- **Already-a-member parity (`?alreadyMember=true` on through-auth path):** Confirmed in `auth.ts` line 518. Main spec "Already-a-member handling" covers both paths with explicit scenarios for each.
- **Role vocabulary (`participant` = Engineer):** Both insert sites carry the required inline comment. `join-links.ts` lines 158–163; `auth.ts` lines 479–484. Main spec "Role vocabulary" requirement is accurate.
- **Revocation deferral rationale:** Documented in the main spec under "Role vocabulary" with the 7-day expiry rationale and the link-management-UI prerequisite for revocation. No revocation endpoint exists in either route file; consistent with spec.

---

## Session-Participation Spec Verification

**File reviewed:** `packages/backend/src/routes/auth.ts`
**Spec reviewed:** `openspec/specs/session-participation/spec.md`

The session-participation spec is a first-entry stub documenting future requirements surfaced during this change. Its core constraint is that EM non-participation enforcement must happen at the session participation endpoint, NOT at join time.

**Confirmed:** `auth.ts` join flow (the `executeJoinFlow` function) inserts all users as `participant` without any `global_role` check. Engineering Managers who follow a join link are correctly added to `team_memberships` — the spec's rationale ("filtering EMs at join time would create a state where an EM is associated with a team but not listed as a member") is borne out by the implementation's design. The session participation endpoint does not yet exist; the stub is accurate.

The facilitator-from-another-team constraint and mid-session arrival decision are similarly deferred. No implementation in `auth.ts` or `join-links.ts` touches these. The stub correctly describes them as hard prerequisites for future design.

**Session-participation spec: ALIGNED with implementation intent.**

---

## Final Verdict

ALIGNED. Three gaps resolved: the `sourceIp` requirement (from the delta, not yet merged), log redaction (in implementation, missing from delta), and the `?newMember=true` path asymmetry rationale (underspecified in main spec). The session-participation stub accurately describes future requirements and is consistent with current implementation behavior.
