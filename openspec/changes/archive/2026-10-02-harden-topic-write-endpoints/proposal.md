## Why

*Written by Devon Calloway (Internal Champion). Source: GitHub #184, which collects the deferred findings from the reorder-topics security and architect reviews (L1, L2, F5, F7, I1, m5). The decisions are recorded in `exploration-notes.md` §6.*

Topic customization only works if facilitators trust it. They need to be able to tailor a team's topics after its first session and always get back to the default set. Since the reorder review, the five topic-write endpoints have had several defects. Writes have no rate limit at all. A malformed `topicId` returns a 500. The template-team guard is safe only because the sentinel ID happens to contain no hex letters. And "team not found" comes back in four different shapes across the codebase. None of these is an incident today. All of them are the kind of thing that makes the next team re-litigate a review. I want them closed now, while the reorder context is still fresh, and closed in a way that **cannot leak into session runtime**. Room open shares the topic advisory lock, and if this change ever slows down or blocks a live session, the ritual starts to feel like software.

The ground has moved since #184 was filed. #175, #176 and #188 already landed the case-insensitive lock key (L1) and the `teamId` boundary check (L2). This proposal starts from the code on `main`, not from the issue text.

## What Changes

- **Per-actor topic-write rate limiter (new, F5).** One shared Redis sliding-window budget covers all five topic-write routes: TOPIC-003 add, 004 archive (both the pre-flight and the `?confirm=true` call), 005 restore, 006 reorder and 007 annotation. The budget is keyed on `session.userId`. The limits are 120 requests per rolling 10 minutes and 400 per rolling 24 hours, written into the spec, with no global limit. Any later change must keep burst ≥ 100 and daily ≥ 200 (the ritual floor; 100 covers a 90-request two-team baseline restore with margin). Security signs off on the values in the Stage 3 design security review. The limiter runs after authorization and before team existence. A breach gets 429 + `Retry-After` and a durable audit row. A Redis error or a check slower than 500 ms gets 503 (fail-closed). A request that is rejected with 429 does not count against the budget.
- **Ordering cascade gains one step.** Every topic-write endpoint's documented check order now reads: non-canonical `teamId` 404 → authz 403 → **limiter 503/429** → team existence / template 404 → lock 409 → body / topic 404/422. The 429 is identical for an existing team, a non-existent team and the template team, so it cannot be used to tell whether a team exists.
- **`teamId` is lowercased at handler entry** in all five handlers. Audit rows, logs, limiter metadata and responses then carry one spelling, and the template guard is proven case-insensitive by a test, not by accident.
- **A malformed id never returns a 5xx on any topic route.** Archive and restore answer a malformed `topicId` with 404 `TOPIC_NOT_FOUND` and no query, as annotation already does. `GET /teams/:teamId/topics` gains the `teamId` boundary that `/topics/all` already has.
- **Lock canonicalization (L1) gets its missing acceptance test**: concurrent uppercase and lowercase path requests serialize on all four lock-taking handlers and against room open (a test only; `facilitator-sessions.ts` is not changed).
- **One `TEAM_NOT_FOUND` envelope everywhere.** `teamNotFoundEnvelope()` moves to `error-envelope.ts`. The 404s in `facilitator-sessions.ts` and `teams.ts` switch to it. **BREAKING (minor, API only):** `GET /api/v1/teams/:teamId` and `GET /api/v1/teams/:teamId/members` change their 404 `category` from `invalid_request` to `not_found` and gain `code: TEAM_NOT_FOUND`. This is an envelope swap only, in its own revertible commit. Task 1.2 verifies that no frontend code branches on the old category; if any does, that branch is updated in the same commit. The swap is required by acceptance criterion 4 and is not deferrable.
- **`ErrorCategory` gains `rate_limited` and `service_unavailable`.** TEAM-006's inline literals move onto `buildErrorEnvelope`, and its response bodies stay byte-identical.
- **The sliding-window mechanism is extracted** from `teams.ts` into a shared module. TEAM-006 thresholds, codes, messages, audit names and key prefixes are unchanged.
- **Topic Management screen handles 429/503.** The message is shown in the error region each control already uses, in plain words, with the wait given in minutes. Unsaved input is kept, the archive escalated confirmation stays open, and no request is retried automatically.
- **Deferred to follow-up issues:** F7 and I1 (informational in #184), the canonical-UUID boundary on the `teams.ts` GET routes, and an 80% early-warning event.

**Time box:** one PR, about four engineering days. Every task serves one of #184's four acceptance criteria, so there is no drop list; if the box is exceeded, scope is raised with the Executive. The `teams.ts` envelope swap is the last code commit, so it can be reverted alone.

**Constraints this change must preserve (non-negotiable):**
1. The limiter, its timeout and any new hook **never** touch `facilitator-sessions.ts`, room open / advance, voting or any other session-runtime route, even though room open takes the same per-team advisory lock. CI enforces this with a structural test and a behavioural test.
2. A facilitator can restore every archived default topic (at most 11) and annotate all 12 in one sitting, on two teams back to back, and then still make pre-session edits, without a 429.
3. TEAM-006 limiter behaviour does not change.
4. A malformed `teamId` still gets 404 *before* 403 (#175 M1). There is no Fastify route-param schema for ids. Both choices are deliberate and are not reopened here.
5. A 429 or 503 never reveals whether a team exists.

## Capabilities

### New Capabilities
- `topic-write-rate-limiting`: the shared per-actor budget across the five topic-write routes. Covers thresholds and the ritual floor, the counting rule, placement in the cascade, the 429/503 contracts and copy, audit (including audit-failure behaviour) and structured events, independence from TEAM-006, and exclusion from session runtime.
- `topic-write-request-hygiene`: identifier handling on topic routes. Covers `teamId` lowercasing at entry, malformed `teamId`/`topicId` never causing a 5xx on any topic route, the recorded no-schema / 404-before-403 decisions, and case-insensitive lock serialization, including against room open.
- `team-not-found-envelope`: one canonical `TEAM_NOT_FOUND` 404 envelope for every team-scoped route in the backend.

### Modified Capabilities
- `add-custom-topic`: the fixed check order gains the rate-limit step between identity/role and team existence.
- `remove-topic`: the fixed check order gains the rate-limit step. A malformed `topicId` is answered 404 `TOPIC_NOT_FOUND` with no query.
- `restore-topic`: the fixed check order gains the rate-limit step. A malformed `topicId` is answered 404 `TOPIC_NOT_FOUND` with no query.
- `reorder-topics`: the fixed check order gains the rate-limit step.
- `topic-annotation`: the fixed check order gains the rate-limit step.
- `topic-management-screen`: adds 429/503 handling on every topic-write control, with the wait shown in minutes, input preserved and the archive escalated confirmation kept open.

## Impact

- **Backend:** `routes/topics.ts` (five handlers, `checkTopicExists*` helpers), a new `auth/sliding-window-limiter.ts` and a topic-write limiter helper, `routes/teams.ts` (extraction only for TEAM-006, plus the envelope swap on three 404s), `routes/facilitator-sessions.ts` (envelope only, **no limiter**), `routes/content.ts` (shared envelope import, `teamId` boundary on `GET /topics`), `routes/error-envelope.ts`, `auth/audit-logger.ts` (new event names).
- **Frontend:** `TopicManagementPage.tsx` and its error-message helpers.
- **API:** a new 429/503 surface on five routes, and the `category` change on two `teams.ts` 404s.
- **Ops:** new Redis keys under a distinct `dipstick:ratelimit:topic-write:` prefix. New audit operation `topic.write_rate_limited`. New events `topic.write_rate_limit_exceeded` and `topic.write_rate_limit_check_failed`. Topic writes now fail closed when Redis is unreachable; the PR description flags this for whoever runs the shared Redis. Session runtime does not.
- **No new dependencies.** `@fastify/rate-limit` stays rejected, following Q6.
- **Governance:** no separate decision record. Thresholds are pinned in the spec, and security co-signs them, the counting rule and the fail-closed bound in the Stage 3 design security review. Follow-up issues (task 1.1): bulk "Restore default topics" (the real adoption win, flagged for milestone priority), F7/I1, the `teams.ts` GET UUID boundary, the `teams.ts` 401/403 category, the 80% warning event, and three items from the #184 follow-up comment (403 denial audit, bidi/zero-width topic text, `teamId` URL encoding).

## Feedback disposition

*Reviews: `propose-review-ba.md` (Marcus) and `propose-review-exec.md` (Rachel). My bias: anything that keeps a facilitator from being tripped during setup stays in; anything that only adds ceremony to a Low-severity issue goes.*

### Accepted

| Item | Change |
|---|---|
| BA R1 (blocking): burst floor 80 is below the 90-request two-team scenario | **Option (a).** The floor is raised to **≥ 100**. A two-team back-to-back sitting is a real cross-team pattern, and I will not ship a floor that lets it be tuned into a 429. The pinned value of 120 still leaves 30 requests of headroom over that scenario. |
| BA R2: scenarios hard-code values that "the decision record" sets | The values (120 / 400) are now normative in the requirement text. The floor clause only constrains future changes. With the decision record gone (Exec C5), there is nothing left to drift from. |
| BA R4: `Retry-After` when both windows are breached; reproducible daily setup | Daily code, message and `Retry-After` win. Added a both-breached scenario (`Retry-After` > 600) and a daily setup of 400 requests over more than 40 minutes. |
| BA R5: audit-failure behaviour only in tasks.md | Narrowed to "the admission check issues no DB query". The breach path uses the existing fail-open audit path (`AUDIT_WRITE_TIMEOUT_MS` = 500 ms, `auth.audit_write_failed`), with a scenario. No new event name. |
| BA R6: daily copy promises an admin remedy that doesn't exist | **Option (b).** The copy now ends "You can continue tomorrow." I won't invent an ops override procedure for a Low item. |
| BA C1, C2, C3, C4, C7, C8, C9, C10, C11, C12 | Exact 78-request fixture; a 250 ms bound in place of "scheduling slack"; admins get 403 on TOPIC-007; a room-open lock scenario (test only, no `facilitator-sessions.ts` change); archive/restore over-budget scenarios fixed, articles fixed; 503 copy says earlier changes are kept; escalated archive dialog keeps its state (task 6.5); pinned server message in frontend tests; `TEAM_NOT_FOUND` in add-custom-topic; constraint 2 reworded. |
| BA C5: "any topic route" includes GETs | Accepted, and it turned up a real gap: `GET /teams/:teamId/topics` has no boundary and passes the raw id into a `uuid` column. Added scenario and task 3.9. |
| Exec C1 / condition 1: time box and drop order | One PR, about four days. The `teams.ts` envelope swap was first on the drop order; the tasks review removed it, because AC4 requires every team-not-found 404 to be consistent. It stays the last, separately revertible commit. Everything maps directly to #184's four acceptance criteria. |
| Exec C2: isolate the `teams.ts` change | It is now an envelope swap only, in its own commit, gated on the frontend grep. The `teams.ts` GET UUID boundary is deferred: it is not a topic route, and dropping it also removes BA C6. |
| Exec C3 / condition 3: 503 copy and Ops | 503 copy says "try again shortly" and that earlier changes are kept. The PR description flags fail-closed Redis for whoever runs it. |
| Exec C4: F7/I1 droppable by default | Went further: **deferred** to a follow-up issue. Both are informational, carry no data and serve none of the four acceptance criteria. Requirement and task group 7 removed. |
| Exec C5 / condition 2: governance must not block | The co-signed `q7` decision record is **dropped**. Values are pinned in the spec, and security co-signs in the Stage 3 design security review, which was going to look at the same diff anyway. Nothing is blocked on governance. |
| Exec condition 4: bulk restore follow-up | Kept as task 1.1(a), flagged for milestone priority. |

### Rejected or made moot

| Item | Why |
|---|---|
| BA R3: define "once per crossing" for the 80% warning | Moot. The warning event is **deferred**: it serves no #184 criterion, and every breach is already a durable audit row. Marcus's equality rule is recorded here for the follow-up, because it is the right definition. |
| BA C6: check order for malformed ids on `teams.ts` GETs | Moot. The `teams.ts` GET boundary is out of scope; those routes keep their current order. |
| BA R2's "update spec values after Q7" step in task 1.1 | Not needed once the values are in the spec and there is no Q7. |
| Old task 1.4 (measure Redis `eval` p99 before the limiter) | Dropped as ceremony. The 500 ms bound matches the existing `AUDIT_WRITE_TIMEOUT_MS`, and security can revisit it in Stage 3 by changing one constant. |
| Moving the limiter onto any session, room or voting route, in any form | Not proposed by either reviewer, and restated as non-negotiable: the limiter stays on the five topic-write handlers, enforced by the structural and behavioural tests. |

