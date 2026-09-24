# Security Review: `inline-team-creation` (design.md)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `design.md`, `proposal.md`, `tasks.md`, `specs/session-creation/spec.md`, `specs/default-topic-provisioning/spec.md`
**Reference reading:** `packages/backend/src/routes/facilitator-sessions.ts` (existing `POST /draft` pattern this design extends), `packages/backend/src/auth/middleware.ts`, `packages/backend/src/auth/account-resolver.ts`, `packages/backend/src/routes/teams.ts` (TEAM-006 precedent), `packages/backend/migrations/2_create_tables.sql`

**Verdict:** No blocking findings. Two Medium items worth resolving before implementation sign-off (F1, F2); two Low/informational items to close out for completeness (F3, F4). The design's core authorization, transactional, and audit-write shape correctly follows this codebase's established patterns.

---

## What's done well

- **Authorization is explicit, not implicit.** `POST /api/v1/teams` is gated on `users.global_role === 'facilitator'` (design D3, spec Requirement "New-team creation," tasks 3.2), matching the existing `POST /draft` check. `global_role` is IdP-asserted and written by `account-resolver.ts` on every sign-in from the mapped role claim — a caller cannot self-elevate to `facilitator` by any path this change touches. This is server-side authorization, independently enforced of anything the frontend renders, which is the bar I hold every endpoint to.
- **No single-IdP assumption.** This design adds no authentication code of its own — it inherits the existing global `onRequest` auth hook (`middleware.ts`, `PUBLIC_ROUTES` gate) and the existing IdP-agnostic role-claim mapping (`account-resolver.ts`). Per the project's standing multi-provider requirement, nothing here special-cases Entra or any single provider. No finding.
- **Facilitator-neutrality is stated as a named negative requirement**, not left to be inferred from `teams.created_by_user_id` existing. D6, the spec's "Team creation does not establish membership for the creating Facilitator" requirement, and tasks 3.8/7.1 all call this out explicitly and independently. This is the right instinct — see F2 below for where I think the enforcement mechanism itself should go one step further.
- **Uniqueness enforcement correctly rejects the app-level-pre-check-only design** (D4). The reasoning — a plain pre-check race-conditions two concurrent normalized-duplicate submissions — is correct, and the fix (a functional unique index, `23505` caught by `err.constraint`) matches this codebase's own established principle that the database, not application discipline, is the actual enforcement point (`sessions_team_active_unique` is the direct precedent). Good instinct also on leaving the old exact-match constraint in place rather than dropping it.
- **The transaction boundary is correct and matches precedent.** Team insert, topic copy, session insert, and the audit row all in one transaction, modeled directly on `POST /draft`. A partial-state team (with topics but no session, or vice versa) cannot exist.
- **CSRF is a non-issue for this endpoint** — the session cookie is already `httpOnly`, signed, and `sameSite: "strict"` (`app.ts`), applied globally; this design doesn't need its own mitigation.
- **No injection surface in the topic-copy query.** The `SELECT ... FROM topics WHERE team_id = '00000000-0000-0000-0000-000000000001'` sentinel ID is a hardcoded literal, not user input, and the rest of the insert is parameterized. No finding.

---

## Findings

### F1 (Medium) — Only the success path is audited; rejected attempts against this endpoint are not

Design D3 and tasks 3.7 specify an `audit_log` row for the **successful** creation path only (`team.created_with_session`). Neither `design.md`, the spec deltas, nor `tasks.md` mention an audit row for:
- a `403` non-facilitator rejection, or
- a `409`/validation-class name-collision rejection.

This is inconsistent with the pattern already established elsewhere in this codebase for exactly this class of event. `POST /draft`'s facilitator-from-another-team rejection writes `session.draft_denied_membership_conflict` to `audit_log` *specifically because it's a security-relevant denial*, not just a business-rule miss. `join-links.ts` similarly audits `join.link_rejected`. TEAM-006 audits rate-limit rejections. The precedent in this codebase is: **a rejection driven by a security/authorization check gets its own audit row**, not just the success case.

A repeated `403` from `POST /api/v1/teams` against a single actor is a meaningful signal — either a misconfigured client, a role-mapping bug, or a user probing an endpoint they don't have access to. Right now, per this design, that signal produces no durable record. The name-collision case is lower-severity but the same argument applies more weakly (repeated collision attempts against the same normalized name could indicate probing, see F on enumeration below — resolved as low risk, but "low risk" and "worth zero audit trail" aren't the same claim).

**Recommendation:** add an explicit requirement/scenario to `specs/session-creation/spec.md` (or a short design note) specifying whether the `403` non-facilitator rejection is audited, matching `session.draft_denied_membership_conflict`'s pattern. If the team decides it's genuinely not warranted (e.g., because this is a low-traffic, facilitator-only surface), say so explicitly as a decision with a reason — right now it reads as an omission, not a decision.

### F2 (Medium) — Facilitator-neutrality is enforced by *absence of code*, not a structural guarantee, and the design applies a different rigor standard here than it does to D4

D4 explicitly rejects "the app-level pre-check usually catches it" as insufficient for name-uniqueness, on the grounds that this codebase's principle is "the database is the actual enforcement point," and adds a schema-level unique index specifically so a future concurrent request *cannot* violate the invariant no matter what application code does.

D6 does not apply that same standard to itself. Today, `POST /api/v1/teams` not inserting a `team_memberships` row is true only because the handler's transaction body doesn't contain that `INSERT`. Nothing in the schema would reject such an insert if a future change added one back — which D6's own text names as the likely failure mode ("`teams.created_by_user_id`... makes it easy to reflexively also insert a membership row"). The only safety net is tasks 7.1's regression test ("no membership row created").

I'm not asking for an unenforceable database constraint — "no row was ever inserted" isn't expressible as a `CHECK`. But given this is precisely the facilitator-neutrality / no-manager-rule invariant the exploration notes flagged as a real risk, I want the regression test treated as a **security-critical test**, not an ordinary functional assertion that could be quietly weakened or dropped in a future refactor without anyone clocking the security implication. This codebase already has a convention for this: `facilitator-sessions.ts` and `audit-logger.ts` carry extensive inline comments naming the specific design decision and risk a piece of code or test protects against (e.g., the `sessions_team_active_unique` and TEAM-006 rate-limit comment blocks). Task 7.1's "no membership row created" assertion should get the same treatment — an explicit comment at the test site naming D6 and the facilitator-from-another-team constraint it protects, so a future editor sees the security rationale before touching it, not just a green/red assertion.

**Recommendation:** tasks.md 7.1 (or the eventual test file) should comment-annotate the "no membership row created" assertion as protecting the facilitator-neutrality constraint, cross-referencing D6, the same way other security-critical tests in this codebase are annotated. Not a design change — a documentation/implementation-discipline note worth carrying into tasks.md now so it isn't lost.

### F3 (Low) — No rate limiting considered, despite a direct precedent for this exact route family

`design.md` and `tasks.md` don't mention rate limiting for `POST /api/v1/teams`. This codebase already has a security-reviewed precedent for exactly this shape of concern: TEAM-006's manager-association endpoint (`packages/backend/src/routes/teams.ts` — the same file this new route may land in, per tasks 3.1's own undecided placement) implements fail-closed rate limiting (burst + daily + global), explicitly because it creates persistent relationship rows and was jointly signed off by the BA and this reviewer (per the Q6 decision referenced in `audit-logger.ts`).

`POST /api/v1/teams` is lower-risk than TEAM-006's endpoint (it's gated to `facilitator` role only, doesn't establish a cross-user relationship, and per D2/D3's own framing team creation is meant to be "a one-time, unrepeatable moment" for legitimate use) — so I'm not calling this blocking. But "one-time, unrepeatable" describes the *intended* usage, not an enforced limit: nothing stops a single compromised or misbehaving facilitator credential from creating an unbounded number of teams, each with its own session, join link, and 12-row topic copy. Per my own standing position, "internal" and "low expected volume" are not the same as "no threat model" — a compromised facilitator credential is exactly the insider/lateral-movement threat model I hold internal apps to.

**Recommendation:** not a blocker for this change, but flag it explicitly as a considered-and-deferred decision (with a reason — e.g., "facilitator role is a scarce, IdP-managed privilege, so abuse requires a compromised facilitator account already") rather than an unconsidered gap, and consider a lightweight backstop (even a generous global rate limit) if this endpoint lands in `teams.ts` alongside TEAM-006's existing rate-limit infrastructure, where the marginal cost of reusing it is small.

### F4 (Low / informational) — Enumeration risk is bounded but check-ordering isn't a spec-level guarantee

On the team lead's specific question: can an unauthenticated or under-authorized user probe team-name existence via the `409`/collision response? As specified, **no** — `POST /api/v1/teams` sits behind the global auth middleware (session required) and the `facilitator`-role check, and `tasks.md`'s own step ordering (3.2 role check, then 3.3 empty-name, then 3.4 uniqueness) puts authorization ahead of the uniqueness check. Team names also aren't confidential — they're visible to anyone who joins a session. So the actual exposure, as designed, is: an already-authenticated `facilitator` can learn whether a given normalized name is taken. That's an acceptable, low-severity disclosure for this data class and this actor set.

The caveat: that check ordering lives only in `tasks.md`'s prose sequencing, not as an explicit requirement in `specs/session-creation/spec.md`. If an implementer reordered the checks (e.g., validated the name and returned the collision error before resolving the caller's role — a plausible refactor if someone extracts a shared "validate the request body" helper), a non-facilitator authenticated user could probe name existence pre-authorization. Low severity given the data isn't sensitive, but cheap to close.

**Recommendation:** make check ordering (authenticate → authorize role → validate name → check uniqueness) an explicit requirement in `specs/session-creation/spec.md`, not just an artifact of `tasks.md`'s list order, matching how the existing `POST /draft` handler's own inline comment documents its check order as deliberate ("Check order, made explicit").

---

## Items explicitly confirmed out of scope for this review (per the design's own non-goals)

- WebSocket re-authorization: not applicable — this change adds no WebSocket surface.
- Secrets management, dependency hygiene: not applicable — no new dependencies or credentials introduced.
- Data classification of session content (votes/trends/action items): not applicable — this change creates no session content, only the team/topic/session shell.

## Summary for sign-off

Structurally sound. Authorization is real, server-side, and IdP-agnostic; the transaction and uniqueness design correctly follow this codebase's "database is the enforcement point" principle. Before implementation sign-off, I'd like F1 and F2 explicitly resolved (either designed-in or explicitly deferred with a stated reason) — both are about audit trail and regression-test durability for the two properties (unauthorized-attempt visibility, facilitator-neutrality) this change itself identifies as the ones that matter most. F3 and F4 are cheap to close and I'd fold them into the same pass rather than opening separate follow-ups.
