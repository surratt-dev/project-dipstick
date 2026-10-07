# Design Review: template-team-not-usable (#214), Engineering

*Reviewer: Marcus Oyelaran (Senior Full Stack Engineer). Reviewed `design.md` and `proposal.md`
against the code on `agent-team/214-template-team-not-usable` (head `821df1c`).*

## Verdict: Approve with changes

The design holds up. Guard plus constraint is the right combination. Closing the facilitator grant
in the data instead of guarding read routes one at a time is also right, because I counted ten
consumers of `evaluateTeamAccess`, including three realtime modules, and a per-route list would miss
some. Most of the code claims check out (list below). There are four blocking issues. In each one,
the boundary between the guard's string comparison and what Postgres or the existing handlers
actually do is not what the design assumes. None of them changes the architecture, and each fix is
a sentence or two in D2, D3, D5 or D8.

## Claims verified against the code

| Claim | Result |
|---|---|
| `DEFAULT_TOPICS_TEAM_ID` exported only from `sessions/default-topics.ts`. Literal in `4_seed_data.sql` | True. Also in `11_default_topics_correction.sql`, which doesn't matter |
| Next migration number is 23 | True (`22_audit_log_actor_roles.sql` is the highest). Repo convention is `-- Up Migration` / `-- Down Migration` sections, run `--no-single-transaction` |
| Write sites: draft and facilitator-state via `getOrCreateJoinLink`, managers, `/api/join/:token`, `executeJoinFlow`. Only TEAM-005 UPDATEs `team_memberships` | True. `teams.ts:844` is the only membership UPDATE. Every `UPDATE sessions` is by `id`, so frozen rows are never touched by a broad UPDATE |
| Path 3 of `evaluateTeamAccess` (~l.197-241): non-terminal, draft < 24h, `complete` with unexpired access | True, exactly as described |
| Session sub-routes authorize only on `facilitator_id` after lookup | True for `advance` (l.774+) and `facilitator-state` (l.2302+) |
| TOPIC-001 `content.ts:597`, TOPIC-002 `content.ts:764` | True |
| #188 test seeds in `template-team-topic-writes-integration.test.ts` (session l.137, membership l.147) and `template-team-creation-regression-integration.test.ts` (l.59) | True. No other test seeds template sessions, memberships or join links |
| Prefix regex selects 13 routes: draft, 4 POST sub-routes, facilitator-state, 2 content GETs, members, member role, managers, join-links | True. `em/*` and TEAM-003 `GET /api/v1/teams/:teamId` are not selected. Both are read-only and covered by the D7 checklist |
| `/auth/callback` appears to `onRoute` with its prefix | True. `registerRoutes` mounts `authRoutes` under `/auth` |
| "The shared error handler" (D5) | **False. There is none.** No `setErrorHandler` exists anywhere in `src/`. See B3 |

## Blocking

### B1. `isTemplateTeam` does a string comparison, but most guarded routes never canonicalize `teamId`

#188's comparison is safe only because `rejectNonCanonicalTeamId` runs first in every topics
handler (`topics.ts:154`). Of the routes this change guards, only `draft` has an `isCanonicalUuid`
check on `teamId`. `members`, member role, `managers`, join-link creation and `facilitator-state`
pass the raw string to SQL, and Postgres's `uuid` input also accepts
`00000000000000000000000000000001`, `{00000000-…-000000000001}` and other hyphen groupings. With
`isTemplateTeam(id) === (id === DEFAULT_TOPICS_TEAM_ID)`:

- **`GET …/facilitator-state`**: the facilitator of a frozen, completed template session sends a
  non-canonical template id. The guard misses it, `WHERE id = $1 AND team_id = $2` matches, and
  `getOrCreateJoinLink` tries to insert. The constraint refuses with a `500`, so there is no audit
  row and no parity.
- **`POST …/managers`** (admin): the guard misses, the existence check finds the row, the upsert is
  refused, and the response is `500`.
- **`GET …/members`** (admin): returns `200` with `teamName: "__default_topics__"` and writes an
  `admin.membership_list_accessed` row. That breaks parity.

The constraint keeps writes closed, so nothing is corrupted. But the guard's two jobs, the parity
response and the audit row, are bypassed. The structural test can't see it, because it only sends
the canonical id.

**Fix:** `isTemplateTeam` normalizes before comparing (strip `{}` and `-`, lowercase, compare 32 hex
characters). Do **not** add `isCanonicalUuid` 404s to these routes. That would change behaviour for
real teams that currently accept non-canonical ids, which breaks the "real teams are unchanged"
constraint. Add one parity test per guarded route that uses the 32-hex spelling. The template id is
all digits, so case is moot, but the normalizer should lowercase anyway.

### B2. Redemption guard placement: "after token lookup" gives the wrong page for every real template link

In both `GET /api/join/:token` (l.84+) and `executeJoinFlow` (`auth.ts` ~l.839), an inactive link
redirects to **`/join-error?joinError=expired`**, not `invalid`. After the migration, every template
link in production is revoked. If the guard sits after the `is_active` / `revoked_at` branch, which
is what "after token lookup" usually means in this code, every old template link lands on the
*expired* page. That contradicts proposal UX #3 and the D3 table. In the direct path, the
unauthenticated branch (`redirect /auth/login?joinToken=…`) also runs before the membership insert,
so a guard placed late would send a logged-out user through a full OIDC round trip for a dead link.

**Fix:** state in D3 that the guard runs **immediately after the row is found, before the
`is_active` check and before the unauthenticated redirect**, in both paths.

This also undercuts part of D8. Revoked template links **do** exist in production after the
migration, so the redemption guard can be reached with a real link there. It cannot be reached on CI,
because the validated constraint refuses the seed, so the stubbed unit tests remain the right proof.
Correct the sentence that says the guard can't be reached at all.

### B3. D5 assumes a shared error handler that doesn't exist, and Fastify's default handler echoes the PG message

There is no `setErrorHandler` in the backend. An uncaught `23514` currently goes to Fastify's default
handler, which returns `{"statusCode":500,"error":"Internal Server Error","message":"new row for
relation \"sessions\" violates check constraint \"sessions_not_template_team\""}`. This codebase has
already treated that echo as a finding (the `advance` handler cites security review SF1 for a `22P02`
echo). Choosing "global handler" also turns this change into a cross-cutting change to the `500`
body of **every** route. That coupling is too large to leave as an implementation choice.

**Fix:** decide it in the design, not in Open Questions. My recommendation is a small wrapper,
`withTemplateConstraintMarker`, at the five writer call sites. It catches `DatabaseError` with
`code === "23514"` and a constraint name ending in `_not_template_team`, logs
`template_constraint_violation: true`, and **rethrows a sanitized error** so the body carries no
constraint name. Match on the `DatabaseError` fields, as the existing `23505` handling in `draft`
does. If you prefer a global handler, register it inside `registerRoutes`, not in `app.ts`.
Otherwise `buildFullApp` (which skips `app.ts`) never sees it, and the structural probe asserts
against a different `500` body than production returns. Either way, add one assertion that the
`500` body contains no `_not_template_team`.

### B4. Structural test: the `refused-before-guard` loophole covers `facilitator-state`

D8 accepts `evidence: "refused-before-guard"` on **any `GET`**. Four GETs are selected:
`facilitator-state`, `members`, and the two content reads. `facilitator-state` is the GET that
**mints join links**, and `members` is a GET the design puts a guard on. A future edit could drop the
guard from either one and pass by marking its table row `refused-before-guard`. That reintroduces the
exemption list the design says it doesn't have.

**Fix:** allow `refused-before-guard` only for an explicit, closed set of keys, the two content
`GET`s plus the two redemption paths, and assert that the set is exactly those four. Every other
selected route, `facilitator-state` and `members` included, must produce `evidence: "audit"`.

## Should fix

**S1. The audit writer's signature doesn't fit two of its callers, and `audit_log` has NOT NULL actor
columns.** `actor_user_id` and `actor_global_role` are `NOT NULL` (`8_audit_log.sql`).
- `executeJoinFlow` has no `request`, only `userId`, `logger`, `sourceIp` and `actorGlobalRole`.
  `writeTemplateAccessDenial({ request, … })` doesn't fit, so take primitives
  (`actorUserId`, `actorGlobalRole`, `actorIp`, `logger`).
- An **unauthenticated** caller of `/api/join/:token` reaching the guard (see B2) has no actor. The
  audit INSERT would fail every time and log `audit_write_failed` noise. State that this branch emits
  only the structured event (as `join.link_rejected` does today) and writes no `audit_log` row, and
  update the `join-link` delta to match.
- On the five session sub-routes, the guard runs before any `users` read, so `global_role` isn't in
  scope. The denial path needs one extra `SELECT global_role`. That's fine because it runs only on
  denial, but say so. Otherwise someone will pass `"unknown"` or leave it empty.

**S2. Migration locking.** Step 2 takes `ACCESS EXCLUSIVE` on `sessions`, which is the hottest table
the realtime layer touches, plus `team_memberships` and `join_links`. Step 1's UPDATEs hold row locks
in the same transaction. Follow migration 22's precedent: `SET LOCAL lock_timeout`, so the migration
fails fast and can be retried instead of queueing every session read behind it. Keep `VALIDATE` (which
takes `SHARE UPDATE EXCLUSIVE`) in the same file. Document the retry in the header comment as 22
does.

**S3. The migration bypasses the realtime layer.** Abandoning a live session in SQL emits no
WebSocket event, and the Redis session state stays as it was. The design's risk line ("the
participant sees the existing ended-session handling") assumes that handling fires, but it fires on
app events, not on row changes. With H1 and a maintenance window this is moot. Make the window
**mandatory** when H1 finds a non-terminal template session (the Migration Plan currently says
"schedule", and the proposal says "if"), or list the Redis keys to clear. Don't promise behaviour the
realtime layer won't produce.

**S4. `lockReason` has to go into the shared type layer.** `GetAllTopicsResponse` in
`packages/shared/src/types/topic.ts` carries `isCustomizationLocked`. TOPIC-001's response appears to
have no shared type at all. The design and Impact sections don't mention `packages/shared`. Add
`lockReason` to the shared types for both endpoints, and give TOPIC-001 a type if it lacks one, so
the frontend's choice of copy is checked at build time.

**S5. D9 with ESM in integration tests.** The #188 integration files load modules through
`loadModules()` dynamic imports. `vi.spyOn` on an ESM export won't intercept
`hasCompletedFirstSession`, so it has to be a hoisted `vi.mock("../../auth/topic-lock-helper.js")`.
Also note: in production, **the template already reads as unlocked** wherever frozen completed
sessions exist (`hasCompletedFirstSession(template)` returns true). That is the real reason #188's
guard has to precede the lock. Keep one test that covers the "unlocked" dimension. Don't delete it
because CI can no longer seed that state.

**S6. Migration tests have precedent. Cite it.** `auth/__tests__/users-roles-schema-integration.test.ts`
splits the Up and Down sections and runs them against scratch-schema copies. That is the only
workable way to test "with existing history", because the integration lane has already migrated
`public` and the constraint refuses the seed. The task should say this, and should assert
`convalidated` only in the scratch schema, because a developer's local DB with leftover rows will
legitimately end up `NOT VALID`.

## Minor

- **M1.** Step 1's clamp should be `WHERE status = 'complete'`. `LEAST(NULL, now())` returns `now()`,
  which is harmless but changes rows it doesn't need to.
- **M2.** The probe self-test as described exercises the `500 ≠ 404` mismatch. Also assert the
  **missing-table-entry** failure, which is the primary mechanism. `buildFullApp` has no hook for
  extra routes, so the helper needs an `extraRoutes` option or the probe needs its own app builder.
- **M3.** Session sub-route denials write an audit row for **any** authenticated caller, with no rate
  limit in front. That's acceptable (fail-open, small rows, no dashboard), but say in Risks that it is
  an accepted write-amplification path.
- **M4.** The D3 row for `members` says "in place of the membership check". Write it as "at the
  team-existence step, after the non-member `403`". That gives admins `404 TEAM_NOT_FOUND` and
  non-admins the existing `403`, and it's the #188 placement. "In place of" can be read as replacing
  the `403`.
- **M5.** "Rollback script" should read "the `-- Down Migration` section". This repo uses
  `migrations-manual/` only for operator-run scripts.

## What I'd want in the tasks as a result

1. A normalizing `isTemplateTeam`, plus a non-canonical-id parity test per guarded route (B1).
2. Redemption guard placed before `is_active` and before the unauthenticated redirect, with a test
   that a revoked template link goes to `invalid`, not `expired` (B2).
3. A constraint-violation wrapper with a sanitized body, and an assertion that the body has no
   constraint name (B3).
4. A closed `refused-before-guard` allowlist in the structural test (B4).
5. An audit-writer signature on primitives, with the no-actor branch defined (S1).
