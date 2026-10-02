# Design Review: Security, topic-003-admin-authorization (#176)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Artifacts reviewed:** `proposal.md`, `design.md`, `tasks.md`
**Code verified against:** `packages/backend/src/routes/topics.ts`, `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/backend/src/auth/account-resolver.ts`, `packages/backend/src/routes/content.ts`

**Verdict:** Approved with conditions. **No blocking findings.** Two should-fix items (S1, S2) correct the design's account of where the risk actually sits. They don't change the code.

---

## 1. What I verified in code

| Design claim | Verified? | Evidence |
|---|---|---|
| TOPIC-003 currently calls the facilitator-only, reply-writing `checkStandingFacilitatorAuthorization` | Yes | `topics.ts`, TOPIC-003 handler, the `checkStandingFacilitatorAuthorization(..., ADD_CUSTOM_TOPIC_AUTH_MESSAGES)` call |
| That function has exactly two callers (TOPIC-003, TOPIC-007), so widening it would admit admins to TOPIC-007 | Yes | Only `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` and `ANNOTATION_AUTH_MESSAGES` are passed to it. D1's decision to leave it alone is correct. |
| `checkStandingFacilitatorOrAdminAuthorization` is decision-only and does **not** apply the timing floor | Yes | Header comment and body in `standing-facilitator-access-helper.ts`. The new wrapper must call `applyTimingFloor` on **both** reject branches, as `checkArchiveTopicAuthorization` does. D1 and task 3.5 cover this. |
| The admin arm admits regardless of membership, and is evaluated before the membership check | Yes | The `grant.globalRole === "application_admin"` early return comes before the `isMember` test. This is why member-admins get through (D5/F1). |
| Lock-denial and success audits already record `authResult.actorGlobalRole`, so no new plumbing is needed | Yes | `checkCustomizationLockGate` → `writeLockDenialAudit`, and the in-transaction `topic.custom_added` INSERT plus `emitAuditEvent` both read `authResult.actorGlobalRole`. |
| The success audit is in the same transaction as the topic INSERT | Yes | Inside `BEGIN … COMMIT` after `lockTeamTopics`. If the audit write fails, the insert rolls back. |
| Check order is 403 → 404 → 409 → 422, with the floor on every exit | Yes | Unchanged by the swap. The canonical-UUID 404 still runs before auth, and that was already reviewed (M1). |
| Admin add exposes no session state | Yes | TOPIC-003 never calls `readOpenSessionCreatedAt`. The 201 body has only topic fields, so the "admins are denied session content" boundary holds. |
| Role is read live and uncached from `users` on every request | Yes | `evaluateStandingFacilitatorAccess`. But see S2 for when that row changes. |

The mechanics are right. D1 copies an established, reviewed pattern and keeps the dangerous change (widening the shared function) off the table. I have no concerns about the authorization code path itself.

---

## 2. Threat model impact

**Who gains a capability:** holders of `global_role = 'application_admin'`. They can now insert a participant-visible topic (name and prompt) into **any** team's ritual, including teams they belong to. Before, they could only archive, restore and reorder.

**What changes:** an admin moves from *subtractive* control of a team's topic list to *generative* control. The new prompt text reaches participants in the next room. That makes a compromised or misused admin account an injection point for content into every team's retro, not just a disruption point. The authority is the same as a standing facilitator's, but scoped org-wide and with no membership bar.

**What doesn't change:** TOPIC-007 stays facilitator-only. The lock still applies. The open-room snapshot (#175/#205) still isolates live sessions. Input validation is the same path as for facilitators, so stored-content handling (XSS and similar) is no different from today.

**Enumeration:** an admin can tell 404 from 409 from 201 for any team ID. That reveals team existence and lock state, which admins can already read through TOPIC-002 and the team endpoints. No new oracle.

---

## 3. Findings

### S1 (should-fix, design text): the "admin population" control does not live where the design says it does

The Risks section says the low-risk argument depends on `application_admin` staying small and outside the management line, and it names VP Engineering as **policy owner**. That is the right risk, but the design implies the control is an application-level policy. It isn't. `account-resolver.ts` maps `application_admin` straight from the signed ID token's `OIDC_ROLE_CLAIM` (allowlist: `engineer`, `engineering_manager`, `application_admin`) and re-evaluates it on **every sign-in**. So the real control is **whoever administers the IdP app-role or group assignment**. Nothing in this application can stop an IdP admin from granting `application_admin` to an Engineering Manager "for convenience during rollout", and the next sign-in makes that grant effective.

Multiple IdPs are a supported direction (Entra is primary, not the only one). Each additional provider's role-claim mapping becomes another independent path to `application_admin`, and so to topic injection on every team.

**Ask:** amend the Risks bullet to say that the boundary is enforced by IdP role assignment, not by this application, and to name who owns that assignment on the IdP side alongside the policy owner. Note that each additional OIDC provider adds a grant path. No code change for #176.

### S2 (should-fix, design text): revocation latency is undocumented

`users.global_role` is rewritten only at sign-in. The authorization read is live, but it reads a value that can be stale for the whole application session. If an admin's role is removed in the IdP, they keep admin authority, now including topic **creation** on every team, until their session ends or they sign in again. This already applies to TOPIC-004/005/006, so it isn't new, but #176 adds a write capability to that window.

**Ask:** add one Risks line stating the revocation window (bounded by session lifetime) and that this change inherits it. A forced re-evaluation on role revocation is out of scope for #176. If nobody owns it today, it belongs with the IdP/session work, not here.

### N1 (non-blocking): attribution relies only on the audit log

`topics` has no `created_by` column. After this change, the `topic.custom_added` row is the **only** durable record that an admin authored a participant-visible prompt. The design says "nothing is lost". That holds only while audit retention is at least as long as topic lifetime. The audit metadata is `{ topic_id }` only, which is fine because the content is on the topic row and the row isn't editable through any endpoint I found. F2 (added-by display) is the right follow-up. When F2 is designed, it should decide whether provenance becomes a column on `topics` rather than a join to `audit_log`, so that retention policy can't erase it.

### N2 (non-blocking): no volume control or detection on admin writes

The add path has no per-team topic cap and no rate limit. That was true for facilitators too, but a facilitator is bound to non-member teams one session at a time, while an admin reaches every team. A compromised admin session could add topics across the whole org in a loop. Audit rows would record it, but nothing would alert. I'm not asking for a rate limit in #176 (the proposal explicitly excludes it). I recommend a detection rule on `topic.custom_added` where `actor_global_role = 'application_admin'` and the row count or the distinct `team_id` count goes over a threshold within a window. File it with the ops/monitoring backlog.

### N3 (non-blocking): deactivated teams accept admin adds

`checkTeamExists` deliberately doesn't filter on `deactivated_at` (existing Decision 11), so an admin can add topics to a deactivated team. This is consistent with facilitators and with TOPIC-004/005/006, and it causes no harm I can see. I'm recording it so it reads as accepted rather than unnoticed.

### N4 (non-blocking): F1 is an authorization boundary that is deferred, not decided

A member-admin can write topics to a team they sit in, and the member-facilitator bar exists to prevent exactly that. The design states the deferral explicitly (D5), applies it consistently across TOPIC-003/004/005/006, and task 6.3 gates the merge on filing F1. That's the right way to defer a security decision. My condition: F1's issue must state that the in-transaction audit row (`actor_global_role = 'application_admin'` with `team_id`) is the only compensating control until it is decided. Task 3.1 and the B3-driven member-admin scenario must keep asserting that row.

---

## 4. Deferred or implicit security decisions

| Decision | Status | Where |
|---|---|---|
| Member-admins bypass the member bar | Explicitly deferred, merge-gated | D5, F1, task 6.3 |
| Who may hold `application_admin` | Explicit but misattributed (application policy vs. IdP control) | Risks, S1 |
| Role revocation latency | **Implicit**, not mentioned | S2 |
| Admin-authored content visibility to facilitators | Explicitly deferred, merge-gated | F2 |
| Rate limit / volume detection for admin writes | Explicitly out of scope; detection not mentioned | N2 |
| Lock-blocked empty team is unrepairable | Explicit, routed to #200 | F4 |
| 403 attempts on TOPIC-003 are not audited | Pre-existing, unchanged; acceptable because an admin can never hit the 403 path | None |

---

## 5. Test expectations (security-relevant subset)

Tasks 3.1–3.10 cover what I'd ask for. I'd emphasise these:

- **3.5 (timing floor on both 403 branches of the new wrapper).** This is the one regression a decision-only helper invites. Keep it.
- **3.10 (TOPIC-007 admin-403 suites unmodified).** This is the real guard for FR-8.7. Any diff to those test files in this PR should fail review.
- **3.9 (parity test).** This is the only thing keeping `canAddTopics` and the endpoint aligned (D3). I accept skipping the shared predicate because the parity test exercises both real authorization paths.
- Add or confirm one assertion that the admin 201 response body contains **no** session fields (no `openSessionCreatedAt`). That pins the "admins are denied session content" boundary for this endpoint.

---

## 6. Conditions for approval

1. S1: amend the Risks section to say the `application_admin` boundary is enforced by IdP role assignment, and name the IdP-side owner. Note that each added OIDC provider is another grant path.
2. S2: add the revocation-latency line to Risks.
3. N4: the F1 issue text names the audit row as the interim compensating control.

None of these block implementation. They are documentation corrections to be made before merge.
