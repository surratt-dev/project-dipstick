# Security Design Review: Create Session for an Existing Team

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-09-23
**Documents reviewed:** design.md, proposal.md
**Status:** CONDITIONAL SIGN-OFF — implementation blocked pending resolution of items marked [REQUIRED]

---

## Summary

This change does something I want to acknowledge before I get to the findings: it fixes a real, previously-unenforced authorization gap and does so honestly — the proposal states plainly that `POST /draft` checks nothing but `global_role`, that no test exercises the self-team case, and that a correctly-filtered picker UI would have made the gap invisible in a demo. That is exactly the failure mode I distrust most — a control that looks satisfied because the UI happens not to exercise the missing path — and the team caught it before I had to.

The core mechanics are sound. D1's inline membership check, read live from the database against the specific `teamId` in the path, is the correct shape — it checks "is this user a member of *this* team," not "is this user a facilitator somewhere," which is the distinction that made the `assign-role-to-team-member` review's R1 finding necessary on a different endpoint. D3's partial unique index with a caught, name-matched constraint violation is the correct answer to the check-then-insert race, and it correctly cites the `session-participation` dual-check precedent for why. D4 correctly declines to put `globalRole` on `AuthSession` and follows the `canAssignRoles` precedent instead.

What's missing is audit logging. This design introduces a new server-side denial for a security-relevant boundary (a facilitator attempting to create a session for their own team — precisely the bypass path the companion use case exists to describe) and a new cross-team data-access grant (a facilitator gaining draft-mode read access to a team's historical data), and neither is audited. This codebase has a well-established, specific precedent for exactly this situation — `team.role_change_denied` was added because "a fix that closes the gap but leaves attempts against it invisible to audit repeats the exact blind spot that made the original bug severe." That reasoning applies here without modification. I am not willing to sign off on an enforcement fix for a named security gap that leaves the fix itself unauditable.

The rest of this review covers that finding in detail, the eligible-teams disclosure question your lead asked me to look at specifically, and several smaller items.

---

## 1. `POST /draft` Enforcement Fix (D1)

**Finding:** Correct authorization shape. Missing audit trail for both denial paths and the success path.

**[REQUIRED] The membership-violation rejection must write an audit record.** This is the single most important finding in this review. The scenario this check exists to reject — a user with `global_role = 'facilitator'` who has an active `team_memberships` row for the target team attempting to create a draft session for it — is not a routine 403. It is the specific bypass path the companion use case ("Facilitator Team Membership Constraint Violation") was written to describe, and it is the exact gap this change is shipped to close. An application that closes a named authorization gap but has no record of anyone tripping the new check has no way to distinguish "this never happens" from "this happens and nobody can see it." The precedent is `team.role_change_denied` (`packages/backend/src/auth/audit-logger.ts`), added for the structurally identical reason on the role-assignment endpoint: a blocked privileged-boundary attempt at human-scale volume gets a synchronous `audit_log` row, not just a 403 response. I want the same treatment here — a new operation value (e.g. `session.draft_denied_membership_conflict` or similar; naming is implementation's call) written synchronously in the same request as the 403, with `actor_user_id`, `actor_global_role`, `actor_ip`, and `team_id` at minimum.

**[REQUIRED] Successful draft-session creation for another team must write an audit record.** This is a new cross-team data-access grant, not merely a row insert. The existing `facilitator-sessions.ts` docstring is explicit that a draft session gives the facilitator read access to the target team's historical data before the room opens. Granting that access to a team the facilitator doesn't belong to is exactly the class of event `team.manager_established` was created to record ("the authoritative audit record ... written in the same transaction as the team_memberships row"). I expect the same pattern: an `audit_log` row in the same transaction as the `INSERT INTO sessions`, carrying `actor_user_id`, `team_id`, and the new `session_id`. Without this, a post-incident review asking "which teams' historical data has this facilitator account accessed" has no answer.

**[RECOMMENDED] The `global_role !== 'facilitator'` rejection (the pre-existing check) should also get a distinct audit event**, for the same reason `team.role_change_denied` covers denials generally rather than only the newly-added check. Lower priority than the two items above since this branch isn't the gap this change is closing, but leaving one denial path audited and the other not is an inconsistency I'd rather not hand to the next person to "clean up" by removing the one that got added.

**[OBSERVATION] The distinct-wording requirement between the two rejection messages is correct and should stay.** D1's requirement that the two 403 messages never share wording, to keep the acceptance-criteria scenarios distinguishable, has no information-disclosure downside I can find — the caller already knows their own global role and their own team memberships, so neither message discloses anything about a third party.

**[OBSERVATION] Per-team scoping is correctly done.** The check queries `team_memberships` for the specific `teamId` in the URL path, not "is this user a member of any team" or "is this user a facilitator anywhere." That's the right answer to the cross-team URL-manipulation class of bug flagged in the `assign-role-to-team-member` review (section 2d there). Confirming it's correct here, not re-raising it as a gap.

---

## 2. `GET /api/v1/teams/eligible-for-session` (D2)

I was specifically asked to look at whether this endpoint leaks team existence/membership information to unauthorized-adjacent callers. Here's my read.

**[OBSERVATION — accepted, but should be stated explicitly] Org-wide team-name visibility to any facilitator is a deliberate feature, not a leak, but the design should say so instead of leaving it implicit.** The use case document is unambiguous: "The application displays a list of teams available to facilitate (teams the Facilitator is not a member of)" — the entire point of this feature is that a facilitator with `global_role = 'facilitator'` can see and act on *any* team in the organization they don't belong to, not a scoped subset. So a facilitator seeing every other team's name and last-session date is the feature working as designed, not an authorization boundary failure — there is no narrower "authorized-adjacent" set to leak beyond. That said: this is exactly the kind of implicit data-classification decision my persona exists to force into the open. `teamName` and `lastSessionAt` for every team in the organization, exposed to every account with `global_role = 'facilitator'`, is a real disclosure surface (org structure, which teams exist, how recently they've been active) even if the individual fields are low-sensitivity. I want one sentence in the design stating explicitly that this is an accepted, intentional scope — "any facilitator may enumerate all teams in the organization via this endpoint" — so a future reviewer doesn't have to reconstruct that conclusion from the use case doc the way I just did.

**[REQUIRED] The endpoint's own `403`-vs-`200` authorization gate must be a live database read, not derived from cached session/token state, and the design must say so.** This is the sharper version of the concern above. Every other authorization decision in this codebase that depends on a role or membership value is explicitly specified to read live from the database on every call — `session-participation`'s dual-check, `team-content-access`'s `evaluateTeamAccess`, and D1's own inline check in this same design all do this deliberately, precisely to avoid a window where a revoked or downgraded role still grants access via a cached value. D4 states that `canFacilitateSessions` is computed fresh on every `/auth/session` call and is "never cached in the Redis session blob" — good — but that's a statement about the value surfaced to the *frontend* for routing. It does not say what `GET /eligible-for-session` itself reads to decide its own `403`. If the handler trusts a `canFacilitateSessions` (or raw role) value that was attached to the request's session object at login time, rather than re-querying `users.global_role` the way `POST /draft`'s own handler does today, then a facilitator whose role is downgraded mid-session retains the ability to enumerate every team in the organization until their session happens to refresh. Given this endpoint is net-new, there's no excuse for it not to follow the codebase's own established pattern from day one. I want the design to state explicitly: this handler queries `users.global_role` from the database on every call, exactly as `POST /draft` does, and does not trust any value carried on `request.session`.

**[OBSERVATION] `callerHasTeamMemberships` and the deliberate omission of a `sessions` join are sound.** Distinguishing the two empty-state reasons via a boolean rather than overloading the HTTP status is a clean shape, and I have no authorization concern with it. Declining to filter out teams with a live non-terminal session (D2's "Resolved" note) is also fine from a security standpoint — D3 enforces that boundary unconditionally and correctly at the point that actually matters (the write), so a stale read in the listing creates no exploitable gap, only a UX one that's explicitly acknowledged and accepted.

---

## 3. Concurrent-Session Protection (D3)

**Finding:** The right mechanism, correctly reasoned. Two items to tighten.

The partial unique index plus catch-and-translate-by-constraint-name is the correct fix for the TOCTOU window a naive select-then-insert would have, and the design explicitly and correctly rejects that naive alternative by name, citing the right precedent. The risk analysis in the design (broad-catch misattribution, migration failing against pre-existing production violations) is exactly the analysis I'd want to see, and both come with real mitigations rather than hand-waving.

**[RECOMMENDED] Confirm, in writing, that the five statuses named in the partial index are the complete non-terminal set.** `session_status` has seven values: `draft`, `lobby`, `pre_session`, `active`, `wrap_up`, `complete`, `abandoned`. The index covers the first five. I checked the codebase for where a session transitions to `abandoned` and found none today — it's a defined terminal outcome (grouped with `complete` in the facilitator-state banner logic as a "transition state" the facilitator must resume-or-review, not a live state) — so excluding it from the blocking index is currently correct. But the design doesn't state this reasoning anywhere; it just lists five statuses without saying why those five and not seven. A future change that starts writing `abandoned` mid-session (e.g., an idle-timeout auto-abandon feature) could silently reopen the exact race D3 exists to close, because nothing ties the index's status list to an authoritative definition of "terminal." One sentence — "the two terminal statuses, `complete` and `abandoned`, are excluded; all five others are blocking" — closes that gap for the next person who touches this enum.

**[RECOMMENDED] The pre-check gate should be an automated, blocking step in the migration process, not a documented manual one.** The design's mitigation for "index migration fails against existing production violations" is "a pre-check query ... run and confirmed clean before the index is added." Who runs it, and what stops the index migration from running before someone remembers to? This is precisely the pattern my persona's "secure defaults that don't require discipline" concern is about: a control that depends on an operator remembering an out-of-band step is weaker than one the tooling enforces. I'd rather see the pre-check as a migration-time assertion (fail the `db:migrate` run automatically if the query returns rows) than a runbook instruction. Not a blocker — this is an operational deploy-time control, not a code-level authorization gap — but I want it tightened before this ships to production, not left as a step someone has to remember under deploy pressure.

---

## 4. `AuthSession.canFacilitateSessions` (D4)

**Finding:** Correct, and I want to say so plainly rather than bury the approval in qualifiers.

This is the right fix for what the exploration notes got wrong. `role-assignment`'s prohibition on exposing raw `globalRole` to the frontend exists for exactly the reason D4 cites, and computing a purpose-specific boolean capability flag live on every `/auth/session` call, never cached in Redis, is the same shape as `canAssignRoles`. Nothing further needed here — I'd only add that whoever implements this should route the `GET /eligible-for-session` authorization check (section 2 above) through the same "always live, never cached" discipline this decision already commits to for the flag itself.

---

## 5. Routing Carve-Out and Draft-Landing Control View (D5, D6)

**[OBSERVATION] No new authentication or authorization surface here** — D5 is client-side routing behavior gated on a value that's already computed server-side and correctly (per D4), and D6 reuses the existing `POST /advance` endpoint rather than introducing a new state-mutating path. I have no findings against either decision as authorization mechanisms. My only note: the draft control view's "join link visible, session not yet joinable" state is exactly the state the existing `enforce-access-control-on-team-content` design already reasoned about (facilitator draft-mode access, 24-hour lazy expiry) — this change is building a front door onto an access model that's already been reviewed, not inventing a new one. Good.

**[OBSERVATION — confirming a non-issue] No new WebSocket surface is introduced by this change.** The flow this design describes ends at "draft" status with an explicit, separate "Open the room" action; no WebSocket connection is established until that later `POST /advance` call takes the session to `lobby`, which is out of this design's scope and already covered by the existing connection-reauthorization machinery (`session.facilitator_connected`, the periodic re-authorization sweep, etc.). I looked for a gap here given how much of my standing concern list is WebSocket-shaped, and I don't find one specific to this change.

---

## 6. Additional Findings

### 6a. Rate limiting on session creation across teams

**[RECOMMENDED]** Neither `POST /draft` nor `GET /eligible-for-session` has any stated rate limit. `TEAM-006` (establishing a manager-team relationship — a comparably-scoped cross-team privilege action) shipped with rate limiting after an explicit sign-off decision, on the reasoning that a compromised facilitator account should be throttled and alerted on, not just permitted at whatever speed the attacker can script. Creating a session for an arbitrary team grants that same account read access to that team's historical data (see section 1). Given the small expected population and internal threat model, I'm not making this a blocker, but a conservative limit (a handful of draft-session creations per minute per actor) would be cheap insurance and consistent with how the codebase has already decided to treat a structurally similar action.

### 6b. CSRF — confirmed as already covered, no new exposure

**[OBSERVATION]** `POST /draft` is an existing endpoint whose enforcement this change tightens, not a new state-changing endpoint; the application already has SameSite cookie configuration at the app level (`packages/backend/src/app.ts`). I don't see this change introducing a new CSRF-relevant surface. Flagging only so it's visible that I checked, not because I found a gap.

### 6c. Data returned on the `409` concurrent-session response

**[OBSERVATION]** D3's follow-up `SELECT` on unique-violation returns the existing session's `id` and `status` to the caller so the frontend can offer navigation to it. Since this only fires for a caller who already passed the membership check for this exact team (i.e., is themselves eligible to know a session exists for this team), this doesn't cross an authorization boundary. No finding, just confirming I traced it.

---

## 7. Summary: Items Requiring Resolution Before Sign-Off

| # | Item | Where Addressed |
|---|---|---|
| R1 | Membership-violation rejection on `POST /draft` writes a synchronous `audit_log` row | Section 1 |
| R2 | Successful draft-session creation for another team writes a synchronous `audit_log` row, same transaction as the insert | Section 1 |
| R3 | `GET /eligible-for-session`'s own `403`/`200` authorization gate is specified as a live `users.global_role` database read, not derived from cached session/token state | Section 2 |

Items marked [RECOMMENDED] should be addressed in this change but do not block sign-off:
- R4: `global_role` rejection branch on `POST /draft` also gets a distinct audit event (Section 1)
- R5: Design states explicitly that org-wide team enumeration by any facilitator is an accepted, intentional disclosure scope (Section 2)
- R6: Design states explicitly which `session_status` values are terminal and why the partial index covers exactly five (Section 3)
- R7: Migration pre-check for D3 is an automated, blocking gate rather than a documented manual step (Section 3)
- R8: Rate limiting considered for `POST /draft` and `GET /eligible-for-session` (Section 6a)

Items marked [OBSERVATION] are recorded for awareness and require no action.

---

## 8. Sign-Off Position

I will sign off on this design as soon as R1–R3 are reflected in an updated design document. These are not new mechanisms to invent — the audit-logging pattern for R1/R2 already exists twice in this codebase (`team.role_change_denied`, `team.manager_established`) and the live-read pattern for R3 already exists in the very handler this design amends (`POST /draft`'s own `global_role` query). This is application of established precedent, not new design work, and I'd expect it to be quick to fold in.

The authorization logic itself — D1's inline check, D3's index-based race protection, D4's capability-flag discipline — is well-reasoned and I have no changes to request there. My objection is entirely that a fix for a named, previously-unenforced gap ships with no way to see anyone hit the fixed boundary, and a new endpoint's own gate isn't yet pinned to the same "always live, never cached" discipline the rest of this design correctly applies everywhere else. Both are specification gaps, not implementation difficulty — they can be closed in the design document itself.

I'm available to review the updated design once R1–R3 are addressed, and to consult during implementation on the audit event shape if that's useful.
