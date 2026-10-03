# Exploration Notes: harden-topic-write-endpoints (#184)

**Explorer:** Devon Calloway (Internal Champion / founding advisor)
**Date:** 2026-10-02 (revised same day after BA and facilitator explore reviews; see §8)
**Branch:** `agent-team/184-harden-topic-write-endpoints`
**Sources:** GitHub #184; `openspec/changes/archive/2026-09-30-reorder-topics/implementation-review-security.md` (L1, L2, I1, I2/F5), `implementation-review-architect.md` (m5), reorder `design.md` (Decision 2, Decision 6, F5/F7 dispositions); `openspec/changes/archive/2026-07-07-establish-manager-team-relationship/q6-rate-limit-decision.md`; `packages/backend/src/routes/topics.ts`, `teams.ts`, `facilitator-sessions.ts`, `content.ts`, `error-envelope.ts`, `uuid.ts`, `sessions/session-topic-snapshot.ts`; `requirements/Feature Sets.md` §8; `migrations/11_default_topics_correction.sql`; `auth/standing-facilitator-access-helper.ts`; `explore-review-ba.md`; `explore-review-facilitator.md`.

---

## 0. My stance on this change

This is plumbing, and I'm glad it's plumbing. None of the four items touches the
load-bearing parts of the ritual (no-manager rule, simultaneous reveal,
facilitator-from-another-team). That makes it low-risk for the ritual. It also
makes it easy for the work to drift into something that does touch it. The
risks I'm watching for are:

1. A rate limiter that gets in the way of a facilitator doing legitimate topic
   work. Topic flexibility within guardrails is one of the properties I care
   about, and "I can always restore the baseline" is part of that promise.
2. A limiter or lock change that leaks into **session runtime**. Room open
   (`facilitator-sessions.ts` POST /advance) takes the *same* per-team advisory
   lock. If anything here slows down or blocks a live session, the ritual
   starts to feel like software, which is the thing I least want.
3. The ordering cascade (403 → 404 → 409 lock → 422) exists for
   enumeration resistance. A new 429 step must not reveal whether a team
   exists.

---

## 1. The ground has moved since the review. Items 1 and 2 are mostly done.

The reviews were written against PR #183 (`d252f00`). Three commits have
landed on main since then: #175 (`e0aaee3`), #176 (`ad861a6`) and #188
(`992645f`). Those commits already fixed the core of L1 and L2. **The
proposal must start from the current code, not from the issue text.**

### Item 1, L1 (case-insensitive lock key): the fix is in, but the acceptance test is missing

- `packages/backend/src/sessions/session-topic-snapshot.ts:23`
  `TEAM_TOPICS_LOCK_KEY_SQL = "hashtext($1::uuid::text)"`. This is exactly the
  fix the review recommended (#175 design.md Decision 2a).
- `lockTeamTopics()` (`:32`) is now the only way the lock is taken. The four
  topic writes call it at `topics.ts:940` (add), `:1102` (archive), `:1321`
  (restore) and `:1499` (reorder), and room open calls it at
  `facilitator-sessions.ts:678` and `:923`. No `hashtext($1::text)` remains
  anywhere (grep confirms).
- An existing test covers the **helper**:
  `routes/__tests__/session-topic-snapshot-integration.test.ts:110`, "an
  upper-case and a lower-case team id take the same lock".
- **What's missing against the acceptance criterion:** the issue asks for an
  integration test *with an uppercase path* showing that all four handlers
  serialize. Nothing exercises `/api/v1/teams/<UPPERCASE>/topics…` end-to-end.
  The test that matters most is the real exposure: two concurrent archives
  (`DELETE …?confirm=true`) of a team's last two active topics, one lowercase
  path and one uppercase, must leave exactly one active topic. The
  `real-db.ts` lock-waiter helper (`routes/__tests__/helpers/real-db.ts:313-349`)
  already exists for gating concurrency on this lock.
- `uuid.ts` `isCanonicalUuid` deliberately accepts **either case**
  (`[0-9a-fA-F]`). An uppercase path therefore passes the boundary and reaches
  every query. That is fine because the lock is canonicalized and every column is
  `uuid`. But see the latent hazard below.

**Latent hazard (string comparison on teamId):** `topics.ts:210`
`if (ctx.teamId === DEFAULT_TOPICS_TEAM_ID)` is a JavaScript string compare.
It is safe **only because** the template ID `00000000-0000-0000-0000-000000000001`
contains no hex letters, so it has no case variants. That is safe by
accident. If the sentinel ever changed, an uppercase spelling would bypass the
#188 template guard and silently rewrite every new team's defaults. That's the
"baseline stays restorable" property I care about. Two options: lowercase
`teamId` once at handler entry (the review's alternative fix), or compare
case-insensitively. Lowercasing at entry has a second benefit: audit rows,
structured logs and response bodies would carry one spelling. Today an
uppercase path is echoed as-is into `emitAuditEvent` `teamId` fields, which
fragments log searches for "what happened to team X". **Recommendation:**
normalize to lowercase immediately after `rejectNonCanonicalTeamId`, in all
five team-scoped topic handlers.

### Item 2, L2 (non-UUID teamId → 500): fixed

- `topics.ts:149` `rejectNonCanonicalTeamId()` runs first in every handler
  (`:860`, `:1040`, `:1262`, `:1441`, `:1656`). It answers 404
  `TEAM_NOT_FOUND`, applies the timing floor, and makes no query.
- Unit test: `topics.test.ts:2620` covers hyphenless, braced, `not-a-uuid`
  and template spellings × all five routes, and asserts that no DB call is
  made. Real-DB test: `session-topic-snapshot-integration.test.ts` "rejects a
  non-UUID teamId…without a 500".
- **Ordering question the issue raised** ("4xx after, or consistent with, the
  authorization ordering"): the current code answers **404 before 403**. The
  rationale is recorded in the code comment and came from #175 review M1/MF1:
  a malformed ID names no team, so the 404 depends only on the caller's own
  input and reveals nothing. I accept this. It is *consistent with* the
  ordering's purpose (no team-existence oracle) even though it is not literally
  "after". The proposal should say this explicitly so a reviewer doesn't
  reopen it.
- The issue suggested a Fastify route-param **schema**. The code went with a
  handler-level check instead, and I'd keep that. A schema failure would
  produce a Fastify 400 *before* the handler. That 400 skips the timing floor
  and the house error envelope (the same gap as I1), and it would make the
  malformed-ID response differ from the 404 every other path gives. Don't
  replace it.
- ~~**Item 2 is done for topic routes.**~~ **Corrected (BA A2, verified):**
  item 2 is done for `teamId` only. A non-UUID **`topicId`** on archive
  (`DELETE …/topics/:topicId`) and restore (`POST …/topics/:topicId/restore`)
  still returns a 500. `isCanonicalUuid` is called in `topics.ts` only at
  `:154` (teamId), `:697` (reorder body) and `:1725` (annotation topicId).
  `checkTopicExistsAndActive` (`:528`) and `checkTopicExistsAndArchived`
  (`:599`) pass `topicId` straight into `WHERE id = $1` on a `uuid` column.
  Against the local Postgres, that query raises
  `invalid input syntax for type uuid` (22P02). No `setErrorHandler` exists
  outside tests, so Fastify's default handler turns it into a 500. It is only
  reachable by an authorized actor on a real, unlocked team, because it comes
  after authz, existence and the lock. It is still the same defect class as
  L2. **Fix:** move the `isCanonicalUuid(topicId)` guard *into* both
  `checkTopicExists*` helpers (404 `TOPIC_NOT_FOUND`, timing floor, no
  query). That covers archive, restore and annotation in one place, and
  annotation's inline check at `:1725` becomes redundant.

**Out-of-scope observation:** `teams.ts` `GET /api/v1/teams/:teamId/members`
(`:370`) and `GET /api/v1/teams/:teamId` (`:521`) have no
`isCanonicalUuid` boundary check. A non-UUID there still raises 22P02 → 500.
These aren't topic routes, but item 4 is already editing those exact
handlers. Adding the same boundary check there costs almost nothing and
keeps the "team not found" behavior uniform. This is a scope decision for
the proposer.

---

## 2. Item 3 (rate limiting) is the real work

### Precedent in the codebase

The only limiter is TEAM-006's, inline in `routes/teams.ts:17-300` (handler use
at `:1102-1172`):

- Redis sorted-set **true sliding window**, applied atomically through the Lua
  script `SLIDING_WINDOW_LUA` (`:79`), using the shared `ioredis` client
  (`src/redis.ts`).
- Keyed on `session.userId`, **not IP**: users sit behind corporate NAT, and
  the threat model is a compromised credential.
- Per-actor burst (20/10m), per-actor daily (100/24h), global (100/10m).
- Placed **after authorization, before the team-existence query** (Q6 §1).
  Unauthorized callers don't consume budget, and limited callers don't
  generate DB load.
- **Fails closed** on a Redis error: `Team006RateLimiterUnavailableError` →
  503 `category: "service_unavailable"`, `code: TEAM006_RATE_LIMIT_UNAVAILABLE`.
- On breach: 429 + `Retry-After`, a durable `audit_log` row written
  synchronously *before* the response, a distinct structured event, and no
  lockout.
- **Rejected requests are counted.** `SLIDING_WINDOW_LUA` (`teams.ts:79-95`)
  `ZADD`s unconditionally, *then* returns the count. A 429'd request
  therefore stays in the window and extends the wait. (The BA review's B4
  assumed the opposite. See §6 D4.)
- `src/redis.ts` constructs `new Redis(config.REDIS_URL)` with no
  `commandTimeout`, so a hung Redis can stall the caller. TEAM-006 has no
  bound on that.
- Q6 explicitly **rejected adding `@fastify/rate-limit`**: "a single
  reviewed threshold, not a general cross-cutting policy". Topic writes make
  five routes, so a shared limiter is now justified. Even so, the established
  direction is a small in-house Redis limiter, not a new dependency. That also
  matches my standing preference for few, open-source, on-prem-friendly
  dependencies.
- `withTimeout` (`auth/audit-write-timeout.ts:33`) is only used to bound audit
  writes (`session-invalidation-audit.ts`, `fail-open-audit-write.ts`). The
  issue mentions it in passing. I don't see an obvious target for it on topic
  writes apart from a possible Redis-call timeout inside the limiter.

### Shape I'd expect

```
                    topic write request
                           │
          rejectNonCanonicalTeamId ── 404 (no query)
                           │
          authorization (per-endpoint) ── 403
                           │
     ┌──────── topic-write limiter (per actor, shared bucket) ────────┐
     │  Redis down  → 503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE           │
     │  over limit  → audit row → 429 + Retry-After                    │
     └────────────────────────────────────────────────────────────────┘
                           │
          checkWritableTeam ── 404 TEAM_NOT_FOUND (+ template guard)
                           │
          customization lock ── 409
                           │
          body validation ── 422
                           │
          BEGIN; lockTeamTopics; … COMMIT
```

- **One shared bucket across all topic writes per actor**, not one per route.
  Otherwise an actor spreads the load across five endpoints. This is the
  meaning of "shared per-actor" in the issue.
- **Placement after authorization, before `checkWritableTeam`.** The 429 then
  depends only on the actor's own history and not on whether the team exists,
  so the enumeration cascade holds. The 429 path must also call
  `applyTimingFloor` to stay consistent with "every handled exit".
- Authorization differs per endpoint (TOPIC-007 annotation is
  facilitator-only, while 003–006 admit admins). That rules out a single
  plugin-level `preHandler` *if* we follow Q6's "after authz" placement. The
  realistic options:
  - (a) A shared helper called in each handler right after authz. This is
    explicit and matches the existing per-handler cascade style, at the cost
    of five call sites. The structural test pattern from #188
    (`topic-write-template-guard-structural.test.ts`) could enforce that every
    write route calls it.
  - (b) A plugin-scoped `preHandler` on `topicRoutes`, which runs *before*
    authz. Simpler, but non-facilitators burn their own budget on 403s, and
    the 429 could precede the 403. That isn't an existence oracle (it's
    per-actor), but it does break the "403 first" reading of the cascade.
  - **Decided: (a).** See §6 D5.
- **Extracting the mechanism.** `SLIDING_WINDOW_LUA`,
  `recordAndCountSlidingWindow` and `retryAfterSeconds` should move out of
  `teams.ts` into a shared module (for example `src/auth/sliding-window-limiter.ts`) so
  topics and TEAM-006 share them. **TEAM-006's thresholds, codes, messages
  and behaviour must not change.** The comment at `teams.ts:22` says not to
  change them "without a new decision document superseding Q6". A pure
  refactor is acceptable if the existing TEAM-006 tests pass unchanged.

### Thresholds: where I have a stake

The numbers need a Q6-style BA + security decision. These are the
ritual-side inputs that decision needs:

- Topic customization is **only possible after the team's first completed
  session** (customization lock; `Feature Sets.md` §8). Legitimate bursts
  happen during "post-first-session tailoring", by a cross-team facilitator or
  an admin, and are human-paced.
- Typical legitimate burst: archive several defaults, add a few custom topics,
  one or two reorders, a handful of annotations. **Archive can take two
  requests per action**: the first returns `requiresConfirmation` when open
  action items exist, and the second carries `?confirm=true`. Reorder is one
  explicit Save (`TopicManagementPage.tsx:969`), not one request per move.
- **The worst legitimate case is "restore the baseline".** Restore is
  per-topic, and the default set is **12 topics** (corrected per BA A1:
  `migrations/11_default_topics_correction.sql` deletes migration 4's six
  rows and inserts twelve; the local DB's template team holds 12).
  ~~roughly 15–20~~. The recomputed sizing is in §6 D3. A
  team that archived most of the defaults and wants them back has to be able
  to do that **in one sitting without hitting a 429**. That's the
  "default set visible and easy to restore" property. A burst limit around 20
  per 10 minutes like TEAM-006's would be **too tight** for topic writes. The
  threshold should comfortably exceed (default-set size × 2) + a margin. My
  rough number was ≥ 60 per 10 minutes (superseded by §6 D3). The actual numbers belong to BA and
  security.
- A cross-team facilitator may serve several teams. The limiter is
  per-actor, not per-(actor, team), so one facilitator tailoring three teams
  back-to-back shares a single budget. The threshold has to account for that.
- **Global secondary limit:** TEAM-006 has one because it's an admin-only,
  high-value route. Topic writes are a wider population (every standing
  facilitator), and the blast radius is one team's topic list, which restore
  can recover. I'd question whether a global limit is needed at all. If it
  is, it must be sized so that a busy morning of multiple facilitators can't
  trip it.
- **Fail-closed or fail-open on Redis outage:** TEAM-006 fails closed. Every
  authenticated route already needs Redis for the session, so failing closed
  adds no new fragility. I'm comfortable with fail-closed for topic writes
  because they're not on the live-session path. **Hard constraint:** the
  limiter must not wrap room open / POST /advance, voting, or any
  `facilitator-sessions.ts` route, even though room open shares the advisory
  lock. Room open is ritual runtime.

### Envelope and type gaps the limiter will expose

- `routes/error-envelope.ts` `ErrorCategory` has **no `rate_limited` or
  `service_unavailable`**. `teams.ts:1115` and `:1165` get around this with
  inline `as const` literals. If topics uses `buildErrorEnvelope` (it should),
  the union has to be widened. That's a small, intentional change to a shared
  type.
- **No frontend handling for 429** (grep in `packages/frontend/src` finds no
  `429` or `rate_limited`). The Topic Management page's error paths would show
  a generic failure. The page needs a human, non-alarming message ("You've
  made a lot of topic changes quickly. Try again in N minutes.") that uses
  `Retry-After`. A facilitator who sees "something went wrong" during
  tailoring will assume the tool is broken. That's an adoption risk, not just
  a UX nit.
- New audit operation and event names are needed (for example
  `topic.write_rate_limited` / `topic.write_rate_limit_exceeded` /
  `…_check_failed`) in `auth/audit-logger.ts` `AuditEventName`, following the
  TEAM-006 trio.

---

## 3. Item 4: TEAM_NOT_FOUND consistency

Canonical envelope: `buildErrorEnvelope("not_found", "Team not found.", "TEAM_NOT_FOUND")`
(`topics.ts:136` `teamNotFoundEnvelope()`; `content.ts:565` already uses it).

Sites that don't conform:

| File:line | Route | Category today | Code today |
|---|---|---|---|
| `facilitator-sessions.ts:297-303` | POST `/teams/:teamId/sessions/draft` (non-canonical id) | `not_found` | none |
| `facilitator-sessions.ts:341-347` | same route, existence check | `not_found` | none |
| `teams.ts:422-430` | GET `/teams/:teamId/members` | **`invalid_request`** | none |
| `teams.ts:573-581` | GET `/teams/:teamId` | **`invalid_request`** | none |
| `teams.ts:1184-1192` | POST `/teams/:teamId/managers` (TEAM-006) | `not_found` | none |

Notes:
- Promoting `teamNotFoundEnvelope()` out of `topics.ts` into
  `error-envelope.ts` gives every site a single source of truth. The #188
  architect review (S4) already asked for "one envelope by construction"
  within topics, and this extends that across files.
- Frontend impact looks nil. The only frontend check on a category is
  `AuthErrorPage.tsx:13` (`invalid_request`), which handles auth-flow errors,
  not these 404s. **Verify** that no frontend code branches on the
  `invalid_request` category of the GET `/teams/:teamId` or `/members` 404
  before changing it.
- Existing tests might assert `category: "invalid_request"` for those 404s.
  Check `routes/__tests__/teams.test.ts` and update them deliberately, not
  silently.
- **Adjacent and out of scope, but worth noting:** `teams.ts:405-413` sends a
  **403 with `category: "invalid_request"`** ("You are not a member of this
  team."). This is the same kind of inconsistency. The issue only covers
  team-not-found 404s, so don't let scope creep in silently. File it or
  include it explicitly.

---

## 4. Informational items: in or out?

- **F7, thrown-path timing floor:** `catch { ROLLBACK; throw }` at
  `topics.ts:979-981`, `:1222-1224`, `:1396-1398`, `:1603-1605` (and in
  annotation, `:1841`) skips `applyTimingFloor`. The reviews agree it opens no
  oracle today. If it's done, a single `try/finally` floor, or a plugin
  `onError` hook, should cover all handlers at once. Every review has insisted
  on "all four or none", and I agree.
- **I1, framework rejections without `no-store`:** `topicRoutes` is registered
  as its own encapsulated plugin (`register-routes.ts:33`), so the
  `em-views.ts:80` `onSend` pattern applies directly. **Caveat:** #188's
  template-guard tests record `noStore: false` for add, archive and restore
  (`topics.test.ts` `TEMPLATE_ROUTES`) and assert that the template 404's
  headers *match* the missing-team 404's headers. A plugin-wide hook changes
  those headers uniformly, so the equality still holds, but the
  `noStore: false` fixtures need updating. Reorder (`:1433`) and annotation
  (`:1648`) set the header per handler today, and those calls become
  redundant.
- My view: both are cheap and both make "every topic-write response behaves
  the same" literally true. That makes them easy for the next team to reason
  about without a review archaeology session. Include them if the proposal
  stays small. Defer them if the limiter design needs the attention.

---

## 5. Scope question: does "topic writes" include TOPIC-007 annotation?

The issue says "all four topic write endpoints (003–006)". But
`PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (`topics.ts:1641`) is
a fifth team-scoped write. It is already in the template guard, the
non-canonical check and the structural test. It does **not** take the
advisory lock (last-writer-wins, `:1632`), so L1 doesn't apply to it. F5
does, though: an un-rate-limited write is an un-rate-limited write. My
recommendation: **include annotation in the limiter's shared bucket** and
in any F7/I1 hook. Leaving it out would recreate the "one route is the odd
one out" problem every review has pushed back on.

---

## 6. Decisions (formerly "open questions")

After the reviews, I've turned the leans into decisions wherever the code or
the ritual justifies one. The requirement IDs (TW-*) are the BA's from
`explore-review-ba.md` §C, so the proposal can reuse them. Items still open
are in §6b.

**D1. Scope reset (items 1–2).** Decided. Items 1 and 2 become "verify and
close the gaps", not "build":
- Item 1: add the uppercase-path integration tests (TW-ID-2 acceptance) for
  all four lock-taking handlers. The headline test is two concurrent
  `DELETE …?confirm=true` requests, one lowercase and one UPPERCASE, against
  the last two active topics. Exactly one succeeds and the other gets 409
  `TOPIC_LAST_ACTIVE`.
- Item 2: keep the `teamId` boundary as is. **Add** the `topicId` guard
  inside `checkTopicExistsAndActive`/`checkTopicExistsAndArchived` (TW-ID-1;
  see §1 correction). The parametrised test covers {hyphenless, braced,
  `not-a-uuid`, `%20`} × {archive, restore, annotation} → 404
  `TOPIC_NOT_FOUND`, with zero `topics` queries.
- The proposal states explicitly that there is **no Fastify route-param
  schema for ids** and that **404 precedes 403 for a malformed `teamId`**
  (#175 M1). Both are recorded so nobody reopens them.

**D2. Lowercase `teamId` at entry.** Decided (BA B6/C7; the facilitator
review agrees). This happens in all five handlers, immediately after
`rejectNonCanonicalTeamId`. Every downstream use (queries, lock, template
compare, audit, logs, limiter metadata, response bodies) gets the lowercase
form. A unit test swaps the sentinel for a hex-letter ID and proves that an
uppercase spelling is still rejected, turning "safe by accident" into "safe
by test".

**D3. Thresholds: ritual-side position, to be co-signed.** The sizing below
is recomputed with **12** defaults.

| Sitting | Requests |
|---|---|
| Heavy single-team tailoring (BA C1: archive 11 w/ confirm = 22, restore 11, add 5, annotate 17, 3 reorders, ~5 retries) | ≈ 63 |
| Pre-session prep pass right after it (facilitator O1/O2: restore a topic, add one, fix 2–3 definitions, one reorder) | ≈ 10–15 |
| Multi-team heavy day (facilitator O3: three teams re-tailored in one morning) | ≈ 190 |

- **Burst: 120 per rolling 10 min per actor. Daily: 400 per rolling 24 h per
  actor.** Early-warning events fire at 80% (96 / 320), once per crossing,
  following Q6 §2.
- **Ritual floor (non-negotiable from my side):** burst **≥ 80**, which is a
  full single-team tailoring pass *plus* a pre-session pass or in-room
  definition save without a 429. That is higher than the BA's floor of ~65,
  because the in-room annotation case (O2) is the one place this change can
  make the ritual feel like software. Daily **≥ 200**, which covers a
  three-team facilitator. TEAM-006's 100/24h is explicitly *not* the
  analogy.
- **No global limit** (BA B10). The blast radius is one team's list, which
  restore can recover, and the per-actor daily cap bounds a single
  credential. Security may overrule this, but must then supply the number
  and the sizing rationale in the decision record.
- **Admins share the same bucket and thresholds** (facilitator Q5). Per
  actor, not per role. 400/day covers a multi-team admin cleanup.
- **Per actor, not per (actor, team)** (facilitator Q4). This is the right
  security choice. The 429 copy (D6) says "you've made", never "this team".
- The numbers go into a co-signed **`q?-topic-write-rate-limit-decision.md`**
  (BA + security), which blocks the limiter tasks, as Q6 blocked 3.10
  (BA D). The record cites use case 08 and `Feature Sets.md` §8 next to the
  restore-the-baseline test, so the threshold can't be tightened without
  seeing what it protects.

**D4. Counting rule.** Decided.
- Counted: every request on the five routes that **passes authz**,
  including the archive pre-flight that returns `requiresConfirmation` (B2)
  and requests that later fail with 404/409/422 (B3).
- **Not counted: a request the limiter rejects (429).** This departs from
  TEAM-006, which `ZADD`s before checking (§2), so the BA's "match TEAM-006"
  premise was wrong. I'm still choosing "not counted" on its merits. A
  facilitator who clicks Restore again on a 429 should not push their own
  wait further out, because that is exactly the "the tool is broken" spiral.
  Implementation: a separate topic-write Lua script that checks both windows
  (burst + daily keys) and `ZADD`s to both only if both are under the limit.
  It is atomic and lives in the shared module next to the extracted TEAM-006
  script, which stays byte-for-byte unchanged.

**D5. Placement and ordering.** Decided: a per-handler helper called right
after authz, option (a) (BA B5/C3, Q6 precedent). The ordering is
non-canonical `teamId` 404 → authz 403 → limiter 503/429 → existence and
template 404 → customization lock 409 → topicId/body 404/422. A structural
test fails if any of the five handlers omits the call or calls it before
authz.
- **Answer to BA C3's open point (verified):** both roles pass authz on a
  well-formed UUID of a team that doesn't exist. `evaluateStandingFacilitatorAccess`
  only `LEFT JOIN`s memberships, so a non-existent team yields
  `isMember = false`. A `facilitator` is therefore authorized (it is not
  only admins), and so is an `application_admin`. TOPIC-007's
  facilitator-only check behaves the same way. This means C3's "identical
  429 for existing / non-existent / template team" test can be written for
  both roles.

**D6. 429 / 503 contract and copy.** Decided (BA C2/C4 merged with the
facilitator review's Q1/O7).
- 429: `Retry-After` (integer seconds, ≥ 1), `Cache-Control: no-store`,
  `buildErrorEnvelope("rate_limited", …, "TOPIC_WRITE_BURST_LIMIT_EXCEEDED" |
  "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED")`, the synchronous audit row
  `topic.write_rate_limited` (lowercase `team_id` as supplied, unverified),
  the structured event `topic.write_rate_limit_exceeded`, the timing floor,
  and no lockout.
- Server copy. It has **no N in the body**, so bodies stay identical across
  the C3 team cases. The frontend renders N from `Retry-After`.
  - Burst: *"You've made a lot of topic changes in a short time. Changes so
    far are saved. Please wait a few minutes and try again."*
  - Daily: *"You've reached today's limit for topic changes. Changes so far
    are saved. You can continue tomorrow, or ask your administrator if you
    need more today."*
- 503 on Redis error **or** on no answer within **500 ms** (bounded with
  `withTimeout`). This is justified because `redis.ts` sets no
  `commandTimeout`. Response: `Retry-After: 30`, `no-store`,
  `category: "service_unavailable"`, `code:
  "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE"`, *"Topic changes are temporarily
  unavailable. Your topics are unchanged. Please try again shortly."*, plus
  the event `topic.write_rate_limit_check_failed`. No DB write. Fail-closed
  is acceptable *only* because the limiter is never on the live-session path
  (D9).
- `ErrorCategory` gains `rate_limited` and `service_unavailable`. TEAM-006's
  inline `as const` literals switch to `buildErrorEnvelope`, with bodies
  byte-identical apart from `correlationId`.

**D7. Frontend 429/503 handling is in scope** (BA B9/C6, facilitator
suggestion 3). This is a minimal, copy-led change, not new UI chrome:
- Each write path (add, archive in both calls, restore, reorder save,
  definition save) shows the message **in the error region that control
  already uses** (per-row for archive/restore, near Save for reorder, in the
  editor for definitions). That is where the facilitator is looking
  (facilitator Q3). **No new page-wide banner.** On a 429, the frontend
  replaces the server copy's "a few minutes" with "about N minutes"
  (`ceil(Retry-After/60)`, minimum 1), keeping the "a few minutes" wording
  when the header is missing. It never shows raw seconds and never retries
  automatically.
- Unsaved input survives a 429 or 503: the add form, the reorder draft and
  the definition editor. The editor already keeps `draft` on error
  (`TopicManagementPage.tsx:1090`, `:1119`), and a component test locks
  that in.
- **Mid-batch (facilitator O4):** a test restores N topics, gets limited
  after k, and asserts that the page shows the k restored topics (the
  existing post-write refetch) along with the "Changes so far are saved"
  message.
- **Out of scope:** disabling buttons with a live countdown (facilitator
  Q2). It's a nice-to-have, and with D4 a repeated click doesn't extend the
  wait, so it's no longer harmful.

**D8. Annotation (TOPIC-007) is in the shared bucket** (BA B1). There are
exactly five routes: 003 add, 004 archive (both calls), 005 restore, 006
reorder and 007 annotation. No GETs.

**D9. Session-runtime exclusion is enforced by CI, not by a checkbox** (BA
C10). A structural test asserts that the limiter helper isn't imported by
`facilitator-sessions.ts` or any session/voting module. A behavioural test
shows that an actor at 100% of the topic-write budget can still open a room
and advance a session.

**D10. Extract the mechanism** (BA C8). `SLIDING_WINDOW_LUA`,
`recordAndCountSlidingWindow` and `retryAfterSeconds` move to a shared
module (for example `src/auth/sliding-window-limiter.ts`), with the D4
conditional script alongside them. TEAM-006 thresholds, codes, messages,
audit names and key prefixes are unchanged. `teams*.test.ts` may change
only in its import paths. Topic-write keys use a distinct prefix, and a
test proves the two budgets are independent.

**D11. Item 4 reach** (BA B7/C9). In scope: `teamNotFoundEnvelope()` moves
to `error-envelope.ts`; all five §3 sites plus `content.ts` and `topics.ts`
use it; and `isCanonicalUuid` is added to `teams.ts` GET `/:teamId` and
`/members`. A grep test fails on any `"Team not found."` literal outside
`error-envelope.ts`. **Out of scope** but filed as one follow-up issue and
linked from Non-Goals before approval: the `invalid_request` category on
the 403s at `teams.ts:405`/`:560` and on the 401s at `:395`/`:546`/`:1069`.

**D12. F7 and I1 are in scope as separately droppable tasks** (BA B8/C11),
each with its own acceptance criteria. Dropping one is then a visible
decision, not attrition.

**D13. Follow-ups to file (not this change):**
- (a) A bulk "Restore default topics" action (facilitator suggestion 7).
  It removes the worst case altogether. It is a good ritual feature in its
  own right ("we can always go back to the defaults"), but it is a new
  capability, not hardening.
- (b) The `teams.ts` 401/403 category issue (D11).

### 6b. Still open

1. **Security co-sign on D3's numbers** (120/10m, 400/24h, no global). The
   ritual floor (≥ 80 burst, ≥ 200 daily) is my condition, but the exact
   values belong in the joint decision record.
2. **Security acceptance of D4** (rejected requests not counted), since it
   diverges from TEAM-006. If security insists on TEAM-006 semantics, the
   frontend must then disable write controls until `Retry-After` elapses.
   Facilitator Q2 moves into scope, because otherwise repeated clicks
   extend the wait.
3. **Who reviews a legitimate-facilitator 429** (facilitator Q6). The
   decision record must name an owner and a trigger, for example "any
   `topic.write_rate_limited` row from a user with `global_role =
   facilitator` is reviewed at the next ops review, and a confirmed
   legitimate hit is a threshold bug". Building new alerting infrastructure
   is out of scope. Naming the owner is not.
4. **The 500 ms Redis bound:** engineering to confirm it against observed
   p99 for the `eval` call. The value is decided, but it can be tuned in the
   decision record without reopening the design.

---

## 7. Ritual-integrity checks for reviewers

Each checkbox now maps to a CI-enforced acceptance condition (in brackets).

- [ ] No limiter, timeout or hook is applied to session runtime routes
      (room open / advance / voting), even though they share the advisory
      lock. [D9 structural + behavioural]
- [ ] A facilitator can restore the full default topic set (12) in one
      sitting without a 429. [D3 restore-the-baseline fixture, run on two
      teams with the same actor]
- [ ] A facilitator who has just done a full tailoring pass can still save
      a definition and make small pre-session edits without a 429.
      [D3 fixture: ~63 tailoring + ~15 pre-session < burst]
- [ ] A 429 or 503 never reveals team existence: it comes after the 403 and
      before the 404, with the timing floor applied. [D5 identical-429 test]
- [ ] When a facilitator hits a 429, it reads as a deliberate pause and not
      a failure. The message says changes so far are saved, gives the wait
      in minutes, and keeps unsaved input. [D7 component tests]
- [ ] The template-team guard can't be bypassed by any ID spelling.
      [D2 hex-sentinel test]
- [ ] TEAM-006 limiter thresholds and behavior are unchanged. [D10]
- [ ] Every team-not-found 404 in the codebase is the same envelope. [D11
      grep test]
- [ ] No topic route returns 5xx for a malformed path id. [D1 / TW-ID-1]

---

## 8. Feedback disposition

| Source | Item | Disposition | Why |
|---|---|---|---|
| BA A1 | Default set is 12, not 15–20 | **Accepted, verified** | Migration 11 inserts 12 rows, and the local DB template team has 12. The sizing in D3 is recomputed. |
| BA A2 | Non-UUID `topicId` on archive/restore → 500 | **Accepted, verified** | No guard in `checkTopicExists*`. 22P02 reproduces against the local Postgres, and there is no app error handler, so Fastify returns 500. Fixed in D1 by putting the guard inside the helpers. |
| BA B1, B2, B3, B5, B6, B7, B8, B9, B10 | Scope and ordering decisions | **Accepted** | These match my leans, now firmed up (D1, D2, D4, D5, D8, D11, D12, D7, D3). |
| BA B4 | 429'd requests not counted, "match TEAM-006" | **Accepted with corrected premise** | TEAM-006 *does* count them (`ZADD` before check). I'm keeping "not counted" on facilitator-UX grounds, with a separate conditional script (D4). Security sign-off is open (6b.2). |
| BA C1 | 120/10m, 400/24h, floor ~65 | **Accepted numbers; floor raised to 80** | Facilitator O1/O2: the in-room or pre-session save must survive a full tailoring pass. |
| BA C2, C4 | 429/503 contract | **Accepted, copy merged** | The server body has no N (keeps the C3 identical-body test clean). The frontend renders minutes. The 503 says "Your topics are unchanged" (facilitator O7). |
| BA C3 | Authz on non-existent team: "admins pass, facilitators fail?" | **Answered: both pass** | `evaluateStandingFacilitatorAccess` uses a `LEFT JOIN`, so `isMember = false` for a non-existent team. |
| BA C5–C11, D | Requirement rewrites, decision record, traceability | **Accepted** | All make the work testable without weakening a constraint. The decision record blocks the limiter tasks. |
| BA C6 | "page's existing message region" | **Modified** | The message goes in each control's existing error region, not a single page region (facilitator Q3), and no new banner, so we add no extra UI chrome. |
| Facilitator O1, O2 | Pre-session and in-room moments | **Accepted** | New threshold input and ritual checkbox (D3, §7). This is the most important addition in either review. |
| Facilitator O3 | Daily cap sized for multi-team | **Accepted** | Daily floor ≥ 200, 400 proposed. TEAM-006's 100 is explicitly rejected as an analogy. |
| Facilitator O4, O6 | Mid-batch state, preserve input | **Accepted** | D7 tests. |
| Facilitator O5 | Server copy carries most of the UX | **Accepted** | That's why the copy is fixed in D6, and why D7 stays minimal. |
| Facilitator Q2 | Disable buttons while limited | **Rejected for this change** (conditional) | Unneeded once rejected requests don't count (D4). It comes back into scope if security rejects D4. |
| Facilitator Q3 | Single page-wide "paused" state | **Rejected** | It adds UI chrome. The per-control regions are where the facilitator is already looking. |
| Facilitator Q4, Q5 | Per-actor surprise; admins | **Accepted as-is** | Per actor, same bucket for admins. The copy avoids "this team". |
| Facilitator Q6 | Alert on a legitimate 429 | **Partially accepted** | An owner and review trigger go in the decision record (6b.3). Building new alerting is out of scope. |
| Facilitator sugg. 7 | Bulk "Restore defaults" | **Deferred to a follow-up issue** | A good ritual feature, but a new capability. It is not a reason to lower the thresholds now. |

Nothing in either review asked to relax a load-bearing constraint, so
nothing was rejected on ritual-integrity grounds. The only pushback is on
UI weight (Q2, Q3) and on scope (the bulk restore, the 401/403 categories).
