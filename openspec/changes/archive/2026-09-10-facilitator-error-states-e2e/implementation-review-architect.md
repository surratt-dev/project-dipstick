# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `facilitator-error-states-e2e`
**Scope of this review:** architectural conformance of the delivered implementation against `design.md` — boundary respect, pattern consistency, and the two specific technical claims the implementer flagged for verification.

## Verdict

**Approved.** The implementation matches the design faithfully. Both deviations the implementer called out — the `buildApp()` substitution and the migration-tooling bug — are real, correctly reasoned, and correctly scoped as out-of-band findings rather than silently absorbed into this change's diff. I verified both independently rather than taking the tasks.md prose at face value; both hold up. I am escalating the migration bug beyond what task 5.1 currently does — see below.

## 1. The `buildApp()` deviation (tasks.md 3.1 vs. the implementation)

Tasks.md step 3.1.3 literally says to dynamically import "`db.js`/`config.js`/`app.ts`'s `buildApp`" for the restricted-role test. The implementation instead builds `Fastify()` directly and registers only `contentRoutes` (`facilitator-error-state-2-restricted-role.test.ts:211-217`), matching the same minimal-app pattern the main integration file uses (`facilitator-error-states-integration.test.ts:148-166`).

I read `app.ts` directly rather than trusting the comment. `buildApp()` registers `@fastify/cookie`, then `@fastify/session` with a Redis-backed store (`createRedisStore(redis)`, secret from `config.SESSION_SECRET`), then `authMiddleware(app)`. I then read `auth/middleware.ts`: the session shape it operates on is `SessionData` — encrypted OIDC token pairs, refresh logic (`refreshSessionTokens`, `TOKEN_REFRESH_THRESHOLD_S`, `REFRESH_MAX_RETRIES`), an absolute lifetime bound, and audit emission on refresh/revocation. A bare `request.session = { userId }` object does not satisfy this — `authMiddleware`'s onRequest hook would either reject the request or throw trying to read token fields that don't exist. Standing up a real session through `buildApp()` requires an actual OIDC login/callback round trip (or a hand-rolled `SessionData` object deep enough to fool token-refresh logic, which is worse than not doing it).

Design.md's Non-Goal is explicit and I wrote it: *"No exercise of real authentication. The harness establishes `request.session = {userId}` directly... not a real OIDC login/cookie round-trip."* Using `buildApp()` as tasks.md's literal text instructs would have violated this Non-Goal directly, not incidentally. The implementer's deviation is the design-conformant choice; the literal tasks.md instruction was the error here, inherited from the main file's task 1.1 pattern without re-checking it against `app.ts`'s actual composition for the one file where it mattered (the restricted-role test lives at a slightly different construction point than the main file, but the same Non-Goal applies to both, and the implementation is consistent across both — `buildFacilitatorApp`/`buildContentApp` in the main file use the identical minimal-`Fastify()`-plus-one-route-module shape).

This is exactly what D1/D2/D7's "reuse the existing pattern" instinct should have produced without needing a literal instruction — the fact that tasks.md drifted from it and the implementer caught the drift and self-corrected against the design doc, rather than against the task list, is the right instinct. No further action needed.

## 2. The migration-tooling bug (tasks.md 5.1)

I did not take the finding on faith. I reproduced it twice:

- **Against the already-running dev containers** (`project-dipstick-postgres-1`): `SELECT name, run_on FROM pgmigrations ORDER BY run_on` shows `8_audit_log`, `8_rollback`, `9_draft_session_and_facilitator_expiry` in that exact sequence, all at the same timestamp (single `up` invocation). `audit_log` currently exists on that instance only because of the implementer's disclosed, out-of-diff manual workaround (`role_change_audit` also currently exists, which is only possible if something recreated `audit_log` after `8_rollback.sql` dropped it — consistent with their account).
- **Against a fully fresh, isolated Postgres container** (no shared state, no workaround applied, `docker run postgres:16-alpine` + `npm run db:migrate` verbatim): same three-migration sequence in the same order. End state: `to_regclass('public.audit_log')` → NULL. `to_regclass('public.role_change_audit')` → present. This is a clean, from-nothing reproduction of exactly what the implementer described.

The mechanism is real and simple: `node-pg-migrate -m migrations up` (the literal `db:migrate` script) has no ignore-pattern or allowlist — it runs every `.sql` file in the directory in filename order. `8_rollback.sql` sorts immediately after `8_audit_log.sql` (`"8_a" < "8_r"`), so a script written as a manual, opt-in disaster-recovery procedure — its own header says "must be validated in a non-production environment before the production deployment gate is cleared" and assumes a human runs it deliberately, with a pre-existing backup — instead executes automatically and unconditionally on every fresh migrate, everywhere, including `.github/workflows/integration.yml`'s `npm run db:migrate --workspace=packages/backend` step, which uses the identical unqualified command.

**Assessment of severity, and why task 5.1's documentation alone is insufficient:**

This is not a test-scope bug. `audit_log` is the audit trail for `team.role_changed` events and every `emitAuditEvent` call this codebase makes (reveal, advance, complete, admin reads — per this change's own D4 and the `enforce-access-control-on-team-content` archive's Task 3.4/5.11). The archived change's Task 5.11 explicitly requires admin-access audit writes "regardless of HTTP response code," and Task 3.6 requires audit writes to have transactional guarantees. None of that matters if the table these writes land in does not exist. Per the fresh-container reproduction, **it does not exist on any environment that has ever run `npm run db:migrate` from a clean database** — which describes CI on every PR since migration 8 merged (2026-07-07, per the archived change's commit), and describes production if production was ever provisioned via this same migration path rather than restored from a pre-existing instance. This is a silent, total loss of the audit trail this project's own architecture review (Task 3.4, 3.6, 5.11, 11.9) treated as load-bearing for compliance and incident response — exactly the "explainable, demonstrable controls" property I named as a success criterion in the original review.

That it was invisible until now is itself informative: `ws-pubsub-integration.test.ts` never writes `audit_log`, and apparently nothing else in the real-infra test layer exercises a code path that writes it either — this change's tests are the first real-infra tests in the repository to touch it. That is a coverage gap independent of the migration bug, worth noting but not this change's responsibility to close.

Task 5.1's documentation is accurate, complete, and appropriately restrained about scope (correctly declines to fix a route/migration bug inside a test-only change — consistent with design.md's stated Non-Goal on handler changes). But documentation buried in an archived change's task file is not how a production-impacting, silently-total data-loss bug gets seen by anyone who isn't specifically reading this change's tasks.md. This project's established pattern is to name discovered/deferred issues explicitly as their own numbered GitHub issues (#26, #38 are both referenced repeatedly throughout this design and the archived change specifically to avoid exactly this kind of knowledge getting lost in a document nobody re-reads). This finding meets that bar and should get the same treatment — as its own issue, filed now, not deferred to "whatever closes issue #19" doing so incidentally. I'd frame it roughly as: **"node-pg-migrate auto-runs `8_rollback.sql`, permanently dropping `audit_log` on every fresh migrate — CI and any clean environment provisioning included."** Severity: high (silent audit-trail loss, not a functional regression a user would notice). This is a recommendation for the team to act on, not a blocker on this change — the fix belongs in a migration/tooling change, not here.

## 3. Real infra vs. accidental mock fallback

Verified directly, not just read:

- Neither new test file appears in the repository's list of files using `vi.mock` against `db.js` (`grep -l` across `routes/__tests__` and `realtime/__tests__` — 18 files matched, both new files absent from that list).
- No `vitest.config.ts` in any workspace declares `setupFiles`/`globalSetup`, so there is no possibility of a global mock silently applying underneath either file.
- I ran both new files plus `ws-pubsub-integration.test.ts` against the live `docker compose` stack: **12/12 tests passed**, real Postgres round-trips and a real Redis `PUBLISH`/`SUBSCRIBE` hop (WS delivery assertions for both the facilitator and participant subscriber variants passed, matching D3's asymmetry claim).
- I then re-ran both new files with `DATABASE_URL`/`REDIS_URL` pointed at unreachable ports (not touching the shared dev containers): both files skip cleanly, 11/11 tests skipped, with the same clear `SKIPPED — ... not available. Run docker compose up ...` console message pattern `ws-pubsub-integration.test.ts` established. No failure, no silent pass.

This matches the established precedent exactly, per D2 (copied verbatim, not abstracted) and D1 (new file, existing mocked suite untouched).

## 4. Task 11.10 annotation

Read directly against the archive file. The annotation is accurate to what this change actually delivers — it correctly scopes the claim to "backend/WebSocket half," correctly lists the states covered (1 both paths, 1a, 1b backend-contract, 2, 3 real-trigger, 4), correctly excludes the timeout variant with the issue #26 disclaimer this change's own tests also carry verbatim, and correctly links forward to issue #38. **The checkbox is genuinely unchecked** (`- [ ] 11.10`), consistent with D6 and with the explicit instruction in this change's own tasks.md 6.2 that only the change delivering frontend rendering may check that box. No discrepancy between what's claimed and what's true.

## Boundary and pattern conformance — general

- **D1 boundary respected:** `facilitator-error-states.test.ts`'s 22 mocked tests are untouched; I did not find any edit to that file in this change's diff, and tasks.md 7.4 (confirming they still pass) is checked.
- **D7 boundary respected:** the restricted-role mechanism is fully contained to its own file, defensively self-heals (`DROP OWNED BY` / `DROP ROLE IF EXISTS` guarded by a `pg_roles` existence check before creating), and includes its own teardown-verification test (`"leaves no dipstick_restricted_probe role behind"`). This is the connection-isolation risk D7's Risks section flagged as the one category-different risk in this change, and it's handled with the belt-and-suspenders the design called for (both Vitest's per-file module isolation and an explicit `finally`-block `DATABASE_URL` restore).
- **D3's authorization asymmetry** (facilitator excluded from `/complete` delivery) is not just asserted, it's asserted *correctly* — task 4.5's test explicitly registers a participant subscriber, with an in-code comment explaining why a facilitator subscriber would produce a spurious failure. This is the kind of detail that's easy to get subtly wrong (assert against the wrong subscriber, get a false "it works" or a confusing false failure) and it's done right.
- **No handler/spec changes:** confirmed this is test-file-and-documentation only, consistent with the Migration Plan section's "no rollback plan needed beyond reverting the new test file."

## Items not requiring my sign-off

Tasks 6.3 and 7.3 (GitHub-comment wording on issue #19 closure, and confirming CI actually runs these tests post-push) are correctly left unchecked — they're post-merge/communication steps, not implementation gaps. I have no architectural concern with either being open at this stage.
