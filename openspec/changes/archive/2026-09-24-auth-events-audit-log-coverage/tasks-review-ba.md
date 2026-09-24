# BA Review: tasks.md coverage against proposal.md

**Reviewer:** Marcus Delgado, Business Analyst
**Scope:** Does tasks.md, taken as a whole, cover every capability proposal.md commits to? Is anything lost in translating the requirement into buildable tasks?

## Bottom line

Coverage is strong. Every event proposal.md names — the seven getting a DB row, the four staying deferred, and the two adjacent field-completeness fixes — has a corresponding task, and the cross-referencing back to design.md's decisions (D1–D7) and the Engineer/Security review findings is unusually tight for a tasks document. I traced every "Get a DB row" bullet, every "Modified Capabilities" clause, and every delta-spec requirement to at least one task, plus the two tracked-issue confirmations (#156, #157) and the #131 comment. I did not find a capability that tasks.md drops entirely.

I found four specific things worth fixing or at least flagging before implementation starts — none of them block starting the work, but two of them are exactly the kind of "obvious once pointed out, easy to miss otherwise" gap this change's own design.md keeps warning about, so I'd rather name them now than have them surface as a mid-implementation question back to me.

## Capability-by-capability trace

| Proposal commitment | Task(s) | Verdict |
|---|---|---|
| `auth.success` gets a DB row (fail-open) | 2.2 | Covered |
| `auth.session_created` gets a DB row (fail-open) | 2.1 | Covered |
| `auth.first_access_created` gets a DB row (transactional) | 3.1–3.2 | Covered |
| `auth.role_claim_mapped` gets a DB row + `previousRole` (transactional) | 3.1, 3.3, 1.3 | Covered |
| `auth.idp_logout_failed` gets a DB row (fail-open) | 4.1 | Covered |
| `join.link_created` gets a DB row (transactional) | 5.1–5.2 | Covered |
| `join.link_redeemed`, both call sites (transactional) | 6.1–6.3 | Covered, see Finding 1 |
| `auth.authorization_initiated`/`callback_received`/`auth.failure`/`join.link_rejected` stay log-only, tracked as #156 | 8.1 | Covered |
| `role_claim_mapped` reversion blind spot tracked as #157 | 8.2 | Covered |
| #131 comment naming this change's new signals | 8.3 | Covered |
| `AuditWriteError`, `internal_error` category, sanitizer/mapper branches, `AuthErrorPage.tsx` | 1.5 | Covered |
| Shared `withTimeout` extraction (no behavior change) | 1.1 | Covered |
| Shared `writeFailOpenAuditRow` | 1.2 | Covered, see Finding 3 |
| Shared `withAuditTransaction` + `statement_timeout` fix | 1.2a | Covered |
| `idp_logout_failed` gains `sourceIp`; `executeJoinFlow`'s `link_rejected` gains `userId` (D6) | 4.2, 7.1–7.2 | Covered |
| Structured logs fire only after commit, not before (Engineer Finding 3) | 3.2, 3.3, 5.2, 6.1, 6.2, 9.9 | Covered |
| `docs/deployment.md` at-risk-event list updated | 10.2 | Covered |
| Spec deltas match shipped behavior | 10.1 | Covered |
| Proposal's Impact section documentation-completeness check (SEC-15, reliability posture) | 10.4 | Covered |
| No new admin surface / no schema migration | — (correctly, no task exists to build one; design.md step 7 states none is needed) | Correctly absent |
| `join.link_redeemed`'s `role='participant'` mismatch — explicitly not this change's job | — (correctly, no task attempts to fix it) | Correctly absent |
| "Who signs off on field-shape completeness" — explicitly unassigned, unresolved by this proposal | — (correctly, no task invents an owner) | Correctly absent |

That last three rows matter as much as the covered ones: proposal.md is explicit about what it is *not* doing, and tasks.md doesn't quietly try to do those things anyway or quietly skip stating that it isn't. That discipline is exactly what I'd want to see.

## Findings

### Finding 1 (real gap): `join.link_redeemed`'s `metadata.linkId` isn't named in Section 6's tasks

The join-link delta spec is explicit: *"`metadata` SHALL include `linkId` on both events, and `expiresAt` on `join.link_created`"* (specs/join-link/spec.md, line 14) — "both events" meaning `join.link_created` **and** `join.link_redeemed`.

Task 5.2 (`join.link_created`) spells this out: `metadata: { linkId: row.id, expiresAt: row.expires_at.toISOString() }`. Tasks 6.1–6.3 (`join.link_redeemed`, both call sites) never mention `metadata` at all — they name `team_id: link.team_id` and `actor_user_id: session.userId` explicitly, and 6.3 covers `actor_global_role` resolution in detail, but the audit row's `metadata` shape for `join.link_redeemed` is left unstated in the implementation tasks. It's the one event-specific field in the whole "Get a DB row" list that's named in the spec and in every sibling task (2.1, 2.2, 3.2, 3.3, 4.1, 5.2) but not in its own.

This is caught downstream — task 9.1's test explicitly cross-references "metadata shape stated in the delta specs" — so it won't ship silently wrong. But an implementer working section 6 top-to-bottom, before reaching section 9, has no explicit instruction to include `linkId` in the `join.link_redeemed` INSERT, only an instruction to include it in `join.link_created`'s. I'd add one line to 6.1 or 6.3: *"`metadata` includes `linkId: link.id` at both call sites, per the join-link delta spec."*

### Finding 2 (minor, worth a one-line addition): the new `SELECT global_role` at `join-links.ts`'s `GET /api/join/:token` isn't scoped to plain-pool-vs-transaction-client

Task 6.2 is explicit that `executeJoinFlow`'s surrounding validation/redirect `SELECT`s "stay on the plain pool — only the membership-insert-plus-audit-insert span is transactional." Task 6.3's parallel instruction for `join-links.ts`'s new `SELECT global_role FROM users WHERE id = $1` doesn't say whether that read happens before `withAuditTransaction` opens (plain pool) or inside it (transaction client). It almost certainly needs to run before the transaction opens, since the resolved role has to be available when the `auditInsert` closure runs — but design.md's Decision D5 doesn't pin this down either, so tasks.md inherited the ambiguity rather than introduced it. Worth a one-line clarification in 6.3 so it isn't reinvented differently at the one call site versus the other.

### Finding 3 (documentation inconsistency, not a coverage gap): `writeFailOpenAuditRow`'s signature differs between design.md and task 1.2

Design.md's code snippet for `writeFailOpenAuditRow` (Decision D2, ~line 51) lists only `operation, userId, actorIp, metadata, log, failureAuditFields` — no `actorGlobalRole`, no `teamId` as typed parameters, even though the surrounding prose in the same section says both are resolved/passed per-call. Task 1.2 states the fuller, correct signature (`operation, userId, actorGlobalRole, actorIp, teamId, metadata, log, failureAuditFields`) and adds a rule design.md's snippet doesn't spell out at all: `actorGlobalRole` is a **required** parameter, never resolved internally by the helper itself — callers resolve it (via `resolveActorGlobalRole` or a value already in scope) before calling.

Task 1.2's version is the more complete and internally consistent one, and it's what tasks 2.1/2.2/4.1 are actually written against, so implementation won't be blocked by this. But if someone opens design.md mid-implementation expecting it to match tasks.md exactly, the two won't line up on this function's signature. Since design.md is the artifact of record for "why," I'd rather this get reconciled (even just updating design.md's snippet) than have it sit as a live discrepancy between two documents in the same change.

### Finding 4 (test-coverage completeness, not a missing capability): the "brand-new user has no `previousRole`" scenario has no named test

The auth-error-handling delta spec carries a scenario for this explicitly: *"A brand-new user has no previous role to record... no `previousRole` field is expected or required."* Task 1.3 states the mechanism correctly (`previousGlobalRole: string | null`, `null` when `isNewUser` is true). Task 9.4 tests `previousRole` across a role change and a same-role repeat login, but doesn't name the new-user-gets-null case as its own assertion, and task 9.1's per-event metadata-shape test for `first_access_created` would only incidentally catch this (by omission — `previousRole` simply isn't in that event's expected metadata at all, per spec) rather than directly asserting the CTE's null-handling for a first-ever login. Cheap to add explicitly to 9.4 or 9.1's `first_access_created` case; I wouldn't block on it, but I'd ask for it before calling coverage complete.

## What I'd tell the team

Nothing here is a "stop and come back to me" gap — the deferred-scope boundaries (issue #156, #157, the role-mismatch non-fix, the unassigned sign-off question) are all handled exactly the way I'd want: named, tracked, and not silently absorbed or silently dropped. Finding 1 is the one I'd actually ask to see fixed before someone starts section 6, since it's a spec-mandated field missing from its own task while present on every sibling task — precisely the kind of "the diff looks smaller if you don't" omission this change's own design.md calls out (Engineer Finding 3) in a different spot. Findings 2–4 are polish: worth a line each, not worth a re-review cycle.
