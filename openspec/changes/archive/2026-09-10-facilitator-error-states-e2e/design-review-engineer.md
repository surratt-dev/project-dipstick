# Design Review — Full Stack Engineer (Marcus Oyelaran)

Reviewed: `design.md`, `proposal.md`, `tasks.md` against the actual code in
`packages/backend/src/realtime/__tests__/ws-pubsub-integration.test.ts`,
`packages/backend/src/routes/__tests__/facilitator-error-states.test.ts`,
`packages/backend/src/routes/facilitator-sessions.ts`, `content.ts`,
`ws-pubsub.ts`, `session-subscriber-access-helper.ts`, the migrations, and
the docker-compose / CI infra.

Overall: the harness-boundary decisions (D1/D2/D4) are sound and the
`ws-pubsub-integration.test.ts` precedent is faithfully reused, not
reinvented. I don't have to fight the test-infra approach. But I found one
blocking implementability defect and two should-fix gaps that a first
implementation pass will hit directly, plus one thing the design already got
right that's worth confirming explicitly.

## Blocker

**Task 3.1's REVOKE-privilege mechanism for Error State 2 does not work
against this codebase's Postgres role.** The app (and every test, per D2/D4)
connects as `dipstick` — `DATABASE_URL=postgresql://dipstick:dipstick@localhost:5433/dipstick`
in both `.env.example` and `docker-compose.yml`/`integration.yml`, where
`dipstick` is set via the official `postgres` image's `POSTGRES_USER`. That
image creates `POSTGRES_USER` as a **superuser**, and there is no
`CREATE ROLE`/`GRANT`/`REVOKE` anywhere in `packages/backend/migrations/` to
provision a second, lower-privileged role. Postgres superusers bypass all
privilege checks, including `REVOKE`. So `REVOKE SELECT ... FROM dipstick`
(task 3.1's proposed forced-failure mechanism) is a silent no-op: the
subsequent `SELECT` in `content.ts`'s session-history query will still
succeed, the route will return real `200` data instead of throwing, and the
test's assertion on `historical_data_unavailable`/`sessionActive: true`/empty
`sessions` will fail — not because the app is broken, but because the test
never actually forced the exception it's supposed to be testing.

This needs to be resolved before Group 3 can be implemented as tasks.md
currently specifies. Two ways out, either is fine:
- Provision a genuinely restricted second Postgres role (a small migration
  or a test-setup SQL block: `CREATE ROLE dipstick_readonly_test ...`,
  `GRANT CONNECT` but not `SELECT` on `session_topics`) and open a second
  `pg.Pool` against it for just this one assertion.
- Force the exception a different way that doesn't depend on privilege
  checks — e.g., temporarily rename/drop a column the query selects,
  or point a throwaway second pool at a nonexistent `search_path` — anything
  that fails inside the route's existing `try/catch` without depending on
  GRANT/REVOKE semantics against a superuser.

Worth flagging in tasks.md explicitly rather than discovering this mid-PR:
the note in task 3.1 ("e.g., by revoking...") reads as settled but isn't
implementable as literally written.

## Should-fix

**1. Error State 3's real-infra coverage never touches the endpoint that
actually produces the spec text.** `GET /facilitator-state`
(`facilitator-sessions.ts:1476`) is the code that computes `bannerState`,
the exact required message (`"Session state has changed. ${status}. Resume
or review."`), and `displayType: "banner"` — this is what the mocked
suite's Task 10.3 tests (5 tests, `facilitator-error-states.test.ts:499-659`)
exercise, and it's a synchronous per-request DB read, not an event push.
Group 4's new real-infra test instead proves that `publishSessionStateChange`
round-trips over real Redis to a WS subscriber — a general content-update
broadcast (`ws-pubsub.ts:68-73`) shared by `topics/advance`'s topic-to-topic
branch, `begin-voting`, `advance` (draft→lobby), and `complete`. Design.md's
Context section calls this "Error State 3's actual production trigger," but
nothing in the codebase confirms the eventual frontend (issue #38) will
drive the banner off this WS event rather than by polling
`/facilitator-state` directly — that binding doesn't exist yet. It's a
reasonable architectural guess, not a verified fact.

Net effect: after this change ships, the one piece of code that literally
produces Error State 3's required display text still has zero real-Postgres
coverage — only the mocked suite touches it. That's the exact gap this
whole change exists to close for the other five states. Recommend adding a
trivial real-Postgres test of `GET /facilitator-state` to Group 3 (same
fixture shape as Group 2, no WS harness needed — just a session fixture in
`wrap_up`/`complete`/`abandoned` and one in `active`) alongside the WS
pub/sub proof, or explicitly stating in design.md why the pub/sub proof
alone is considered sufficient closure for 11.10's Error-State-3 language.

**2. Group 4's `/complete` trigger (task 4.3) will not deliver to a
facilitator-registered subscriber, by design of the delivery-time
authorization model — and tasks.md doesn't call this out.**
`evaluateSessionSubscriberAccess`'s Path 3 (facilitator) requires
`sessions.status IN LIVE_FACILITATOR_STATUSES` (`lobby, pre_session, active,
wrap_up`) at the moment the dispatcher re-checks authorization for each
delivered message (`session-subscriber-access-helper.ts:55,119-130`). The
`topics/advance` wrap-up-entry trigger (task 4.2) leaves the session in
`wrap_up` — still live-authorized, so a facilitator subscriber works there.
But `/complete` (task 4.3) leaves the session in `complete`, which is
**deliberately excluded** from `LIVE_FACILITATOR_STATUSES`. If the
implementer reuses the same facilitator-as-subscriber setup from 4.2 for
4.3 (the natural reading of "repeat 4.2 using the `.../complete` trigger
path"), the dispatcher will correctly deny delivery — same mechanism
`ws-pubsub-integration.test.ts` proves for participant revocation — and the
test will fail, not because Redis or the route is broken, but because the
test picked the wrong grant path for this specific trigger.

Path 1 (participant) has no session-status gate at all, so a
participant-registered subscriber would receive the `/complete` publish
correctly. Task 4.1/4.3 should say explicitly: use a **participant**
subscriber for the `/complete` case, not a facilitator, or the assertion
will spuriously fail against fully-correct application code. This is worth
a one-line addition to task 4.3 so whoever implements this doesn't burn an
afternoon debugging what looks like a Redis flake.

**3. Fixture cleanup doesn't account for `audit_log`, and unlike the copied
precedent, this change's tests actually write to it.** `audit_log.team_id`
and `actor_user_id` are deliberately not foreign keys — migration
`8_audit_log.sql`'s own comment: "not FKs, so records remain stable even if
the referenced user is later deactivated or deleted." `ws-pubsub-integration.test.ts`
never touches an endpoint that writes `audit_log`, so its `finally` block
cleanup (delete session_participants → sessions → team_memberships → teams
→ users) never had to think about this. This change's tests do exercise
`reveal` (successful path → `recordRevealTriggeredAudit`), `topics/advance`,
and `complete` — all of which `INSERT INTO audit_log` in the same
transaction as the state write. Because there's no FK, deleting the
team/session/user rows in `finally` will not cascade-clean those audit rows;
every real-Postgres CI run of this suite will permanently accumulate
`audit_log` rows with no relationship left to anything. Not a test
correctness bug, but exactly the kind of "test suite quietly leaves droppings
in a shared table forever" thing worth avoiding. Add an explicit
`DELETE FROM audit_log WHERE team_id = $1` (or by captured session_id in
metadata) to each `finally` block in Groups 2 and 4.

## Confirmed correct (worth stating, since I went looking for problems)

- D5's characterization of Error State 2's real trigger mechanism is exactly
  right: `content.ts:298-335`'s `try/catch` only reaches the
  `historical_data_unavailable` branch on a genuine post-authorization
  query/serialization exception, and a non-matching membership/session row
  produces a null grant → `denyNullGrant` → Error State 4's 403 path instead,
  not this one. Task 3.1's note correctly documents the distinction Marcus's
  propose-stage correction identified. Good catch already made; it held up
  against the real code.
- The reveal (`/reveal`) and advance (`/topics/advance`) authorization checks
  both run and return before any already-revealed/advance-blocked
  precondition check is reached (`facilitator-sessions.ts:964-993` and
  `1165-1196`) — task 2.6's ordering assertion is implementable exactly as
  described.
- No vitest `include`/`exclude` restrictions gate which directories get
  picked up by `npm run test` (`vitest.config.ts` has no `test.include`), so
  the Open Question about file placement (`routes/__tests__/` vs.
  `realtime/__tests__/`) is genuinely free either way — CI will run it
  regardless, matching the proposal's "no CI changes needed" claim.
- `evaluateSessionSubscriberAccess` does grant a facilitator connection
  session-event delivery for `wrap_up` (see should-fix #2), so D3's
  WS-subscriber approach is sound for the `topics/advance` trigger case —
  it's specifically the `/complete` case that needs a different subscriber
  identity.

## Not blockers, just noted for whoever implements

- `topics_team_order UNIQUE (team_id, display_order, status)` and
  `session_topics_session_order UNIQUE (session_id, display_order)` mean
  Group 4's wrap-up-entry fixture (a session with exactly one topic at the
  last `display_order`) needs a little care in the raw-SQL fixture builder,
  but nothing that changes the design — just flagging it's not a
  copy-paste-trivial fixture the way Group 2's single-topic reveal fixtures
  are.
