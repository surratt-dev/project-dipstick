# Implementation Review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** 232-topic-002-admin-read-audit-no-manager (#232)
**Scope:** whether the implementation matches design.md (D1–D8), whether the boundaries hold, whether the code follows existing patterns, and whether the docs agree with the code
**Verdict:** **Approve.** Nothing blocks. Five non-blocking notes, plus one pre-merge step carried over from task 8.2.

---

## What I checked

- `git diff` of all 12 modified files, plus the new `topic-002-admin-audit-integration.test.ts`.
- `git diff main --stat -- packages/backend/src/auth/standing-facilitator-access-helper.ts packages/backend/src/routes/topics.ts packages/backend/src/auth/team-content-access-helper.ts`: **empty**.
- I compared the code with the precedents: `teams.ts` admin reads (L425–450, L588–612), `insertSignInAuditRow` (`auth.ts` L107), `readActiveMembershipRole` (`team-content-access-helper.ts` L275), `parseRoleArray` (`role-map.ts` L357), and TOPIC-002's existing `403` branch.
- I ran these myself:
  - `content.test.ts` and `topic-add-flag-parity.test.ts`: 101/101 pass.
  - `topic-002-admin-audit-integration.test.ts` and `topic-annotation-integration.test.ts` against real Postgres: 27/27 pass. They executed and were not skipped.
  - The `TopicManagementPage` and `TeamPage` frontend tests: 37/37 pass.
  - `tsc --noEmit` on both packages: no errors in the production files this change touches (`content.ts`, `audit-logger.ts`, `TopicManagementPage.tsx`). The test-file errors it reports follow patterns that were already there (see N5).

## Boundaries

| Boundary | Status |
|---|---|
| Shared helper `standing-facilitator-access-helper.ts`: no diff (D2, D6) | Held. Empty against `main`. |
| `topics.ts` TOPIC-003..006 wrappers: no diff (D6) | Held. Empty against `main`. |
| `content.ts` runs no SQL against `team_memberships` (access-control Decision 8) | Held. The membership role comes only from `readActiveMembershipRole`. The new local query reads `users` (the role set), which Decision 8 allows. The handler comment explains why there is no join. |
| Facilitators gain no query | Held. The admin block is gated on `decision.actorGlobalRole === "application_admin"`. This is pinned twice: the parity test asserts `servedMembershipRoles` is `[]` for non-admins, and unit test 3.6 checks the `team_memberships` call count by SQL text. |
| Migration 21's boundary: `users.roles` never feeds admission | Held. `actorRoles` feeds only the row, the event and the derived flag. A comment at the derivation site states this. |
| No applied migration edited | Held. |

## Design conformance

- **D2 handler order.** The order matches the design: helper → membership read → predicate → role-set read (on both outcomes) → branch. Both tails run insert → `emitAuditEvent` → `applyTimingFloor` → send. Unit tests pin the order with `invocationCallOrder` (`expectAuditTailOrder`) on both branches. The insert never sits between the floor and the send.
- **Predicate.** `evaluateAdminTopicConfigRead` is pure, not exported, and an allow-list. Its discriminated-union result carries `membershipRole: null | "participant"` into the access metadata, so the type system rules out an access row that records `engineering_manager` (Engineer nit honoured). The comment block covers allow-list, unconditional, TOPIC-002 only, #208, and "adding an enum value must revisit".
- **D3 messages.** These are exported constants, and the unit tests and the integration test import them.
- **D4 deny branch.** It matches the shape of the existing `403`: `noStore`, `category: "forbidden"`, `correlationId`. It runs no team, topic or lock query, and that is asserted by SQL text, never by mock position, along with `mockGetTopicLockState` not being called.
- **D5 rows and events.**
  - Column list and `$7::text[]` last both follow the `insertSignInAuditRow` convention (`[...roles]` spread, `JSON.stringify(metadata)`).
  - Metadata and event key sets match D5 exactly, and tests assert the exact key sets and that both are text-free.
  - `team_found` comes from the existing team lookup and adds no query.
  - `annotated_count` covers active and archived entries.
  - Zero rows from the role-set read throws. The `!` after the explicit length check is fine: the design ruled out *defaulting*, and this does not default.
- **D5b.** `withAdminAuditFailureSignal` wraps exactly the role-set read and the two inserts. The membership read is not wrapped, as designed. It records only the SQLSTATE string, or `null` (for example when `parseRoleArray` throws), never `err.message` or `err.detail`. It rethrows. Unit test 3.4 covers all six failure modes, including "membership failure emits none".
- **D6 parity fake.** Routes are matched in the specified order: the membership query first, and the role-set route kept apart from the helper's `FROM users u`. The fake records the role it served and asserts it per row. The `{ get: 403; post: 201 }` exception is confined to the one row. Its comment says not to "fix" it and cites #208. The existing admin-member row is pinned to `participant`.
- **D7 frontend.** `res.json().catch(() => null)` guards the parse, and `hasEnvelopeMessage` is reused. The fallback string is unchanged and the refetch path is untouched. Three body types are tested, and each test asserts no buttons, no textboxes and no definition block. `TeamPage` has a #232 comment and no client-side role guard.
- **Real-Postgres evidence (5.1/5.2).** It sits in a separate, findable file. Users are created with explicit `roles`. The `{application_admin,engineering_manager}` case proves the `::text[]` cast decodes to an array. The TOPIC-004 regression proves the write boundary for both membership roles.

## Pattern consistency

- **Audit insert.** It is consistent with `teams.ts`: a plain awaited `db.query`, no transaction, no catch, before the send. It is factored into a local, typed `insertTopic002AdminAuditRow` instead of being inlined twice. I agree with that: one column list for two operations cannot drift.
- **Timing floor.** Every early return applies the floor once and before the send, which is consistent with the handler's other `403`s and with TOPIC-001.
- **Test fixtures.** The SQL-routed fixture (`routeTopic002`) is a new pattern in `content.test.ts`. It is scoped correctly to admin tests, and facilitator tests keep their queues. The unrouted-SQL guard (`unroutedSql` + `afterEach`) is the right defence against the vacuous-pass problem raised in design review S3.

## Docs vs code

| Doc | Consistent? |
|---|---|
| REST API Contract, TOPIC-002 Authorization, 403 rows, Notes, audit note | Yes. Messages are byte-identical to the constants. The fail-closed set matches the code: membership read, role-set read and both inserts. "Every `403` carries `Cache-Control: no-store` and the timing floor" is true of all three `403` branches. |
| REST API Contract, TOPIC-001 #187 note, Appendix B row | Yes. |
| BRD FR-8.7 rationale, Constraint 2 | Yes. |
| Use case 08 | Yes. The `topic-customization-lock` pointer is correct: that delta owns the admin arm. |
| `docs/deployment.md` Logging | Yes. The admin-reads clause is moved out of "same transaction". The `actor_roles` writer list matches a grep (`auth.ts` L99/L101, `content.ts` L273, and no other writer). The log-only counts are re-derived to Eight/six/14, which matches the list (14 bullets' worth of events). The review queries are present. The owner is written exactly as "Proposed … Pending owner confirmation." |
| `audit-logger.ts` comment blocks | Yes. They match D5/D5b, including the backfill limit and the distinction from `admin.session_content_denied` and `auth.audit_write_failed`. |

---

## Blocking findings

None.

## Non-blocking findings

**N1. Pre-existing contract inconsistency that this change sits next to.** TOPIC-002's error table still lists `404 Not Found | Team does not exist`. The code (unchanged here, and pinned by integration test 5.1) answers `200` with `teamName: ""` for a canonical UUID that names no team. Only a non-canonical id gets `404`. The new audit note documents `team_found`, which makes the gap easier to notice. **Suggested fix:** narrow the 404 row's wording to "`teamId` is not a canonical UUID" now, or attach it to optional follow-up 6 (404 for unknown team ids) in `handoff-drafts.md`. It does not need to be fixed in this PR.

**N2. `actorIdpRolesIncludeEm` is computed twice.** It is derived once in the admin block and again on the access tail. Both derivations come from the same `actorRoles` array, so they cannot disagree and D5's "one array" guarantee holds. Carrying the boolean in `adminAudit` would remove the duplicate. Cosmetic.

**N3. `docs/deployment.md` still lists "EM data-access reads" under "in the same transaction as the state change".** This is pre-existing and outside #232. I did not verify whether it is true. If it is not, it has the same flaw this change corrected for admin reads. It is worth a one-line check by whoever next edits that paragraph.

**N4. Module-level `afterEach(() => mockDbQuery.mockReset())` in `content.test.ts`.** This applies to every `describe` in the file, not only the #232 blocks. It is needed because `vi.clearAllMocks()` does not clear a persistent `mockImplementation`, and it is harmless here because `mockDbQuery` is a bare `vi.fn()`. It is still a file-wide behaviour change hidden in a fixture section. A one-line comment at the top of the file would stop the next author from being surprised.

**N5. Test files have `tsc` errors.** All of them repeat errors that were already in those files: `decorateRequest("session", null)`, `possibly 'undefined'`, and fixtures missing `lockReason`/`canFacilitateSessions`. The new `buildAppWithReplySpy` copies the `decorateRequest` pattern, so it inherits the same error. Production code is clean. This is not this change's to fix, but the test tree is not type-checked by any gate. A follow-up should either gate it or exclude it on purpose.

## Pre-merge step (carried from task 8.2, not a finding)

`openspec validate 232-topic-002-admin-read-audit-no-manager --strict` has not been run, because the CLI is not installed here. The orchestrator or a human must run it before merge. The human decisions in `handoff-drafts.md` also still stand: the review-query owner, the AC1 deviation sentence, and scheduling #208.

— Ingrid Sollenberger
