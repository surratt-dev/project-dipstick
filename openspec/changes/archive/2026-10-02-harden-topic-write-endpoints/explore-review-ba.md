# Explore Review (BA): harden-topic-write-endpoints (#184)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-10-02
**Reviewed:** `exploration-notes.md` (Devon Calloway)
**Focus:** Can each idea become a testable requirement as written? Where not, what should the requirement say?

---

## Overall

Devon's notes are a strong base. The "the ground has moved" reset (items 1–2 mostly shipped by #175/#176/#188) is the most useful finding in the document, and the ritual-integrity checklist in §7 is close to acceptance-ready. Where the notes fall short is the same place they defer on purpose: almost every decision in §6 is phrased as a question or a lean ("I'd say yes", "I lean towards (a)", "rough number ≥ 60"). A proposal can't carry a lean. Below I turn each one into a requirement statement with a concrete acceptance condition. Where I'm proposing numbers, they are my BA position for the Q6-style joint decision with security, not a final value.

I also found one factual error that changes the threshold maths, and one gap in item 2 that the notes call "done".

---

## A. Factual corrections (fix before the proposal is written)

### A1. The default topic set is 12, not "roughly 15–20"

Migration `11_default_topics_correction.sql` deletes migration 4's six rows and inserts **twelve** defaults (per the Topic Management AC, use case 08 line 39). The threshold reasoning in §2 ("default-set size × 2 + margin ⇒ ≥ 60") is built on 15–20. With 12 the worst case is smaller. See C1 for the recomputed numbers. The proposal should cite migration 11 as the source of the count, so nobody re-derives it from migration 4 again.

### A2. Item 2 is not fully done: non-UUID `topicId` on archive and restore

The notes say "Item 2 is done for topic routes." That holds for `teamId` only. `checkTopicExistsAndActive` (`topics.ts:~529`) and the restore equivalent (`:~600`) pass `topicId` straight into `WHERE id = $1` with no `isCanonicalUuid` check. Annotation guards `topicId` (`:1725`), but archive (`DELETE …/topics/:topicId`) and restore (`POST …/topics/:topicId/restore`) do not appear to. A path like `/api/v1/teams/<valid>/topics/not-a-uuid` would raise Postgres 22P02, which becomes a 500. That is the same defect class L2 was raised for.

**Action:** verify with a test. If it reproduces, it's in scope under item 2 (see C5).

---

## B. Clarifications needed (decisions the proposal must make, not defer)

| # | Question | Why it blocks a requirement | My recommended answer |
|---|---|---|---|
| B1 | Which endpoints are "topic writes"? | The issue says 003–006, the notes recommend adding 007. The limiter's bucket and the structural test depend on the exact list. | Exactly five: `POST /teams/:teamId/topics` (003), `DELETE /teams/:teamId/topics/:topicId` (004, both the unconfirmed and `?confirm=true` calls), `POST /teams/:teamId/topics/:topicId/restore` (005), `PUT /teams/:teamId/topics/order` (006), `PUT /teams/:teamId/topics/:topicId/annotation` (007). No GETs. No `facilitator-sessions.ts` routes. |
| B2 | Does the archive confirmation pre-flight (the call that returns `requiresConfirmation`) consume budget? | It decides whether one archive costs 1 or 2 units, which feeds the threshold maths. | Yes, it counts. It is a request to a write endpoint, and keeping the counting rule simple ("every request that passes authz on these five routes") is easier to test and audit. The threshold in C1 is sized for it. |
| B3 | Do requests that fail *after* the limiter (404, 409, 422) consume budget? | Unspecified. Matters for both testing and fairness. | Yes. The limiter records the request when it admits it, as TEAM-006 does. State this explicitly. |
| B4 | Does a 429'd request itself consume budget? | Unspecified. If it does, a client that retries locks itself out for longer. | No. Rejected requests are not added to the window. Match TEAM-006's behaviour; the proposal should cite the line that proves it. |
| B5 | Placement: per-handler helper after authz, or plugin `preHandler`? | Changes the response ordering contract (403 vs 429 precedence). | Per-handler helper after authz, option (a). It's the Q6 precedent. The requirement is the *ordering*, stated below in C3, and the structural test enforces it. |
| B6 | Lowercase at entry, or case-insensitive compare? | Each one gives different audit/log content, so the acceptance test differs. | Lowercase at entry. It's the only option that also makes audit `teamId` values uniform, which is a traceability requirement in its own right. |
| B7 | Item 4 reach: are `teams.ts` GET `/:teamId` and `/members` in, and is the `teams.ts:405` 403 category in? | "File it or include it" is not a scope. | Include the 404 envelope fix *and* the `isCanonicalUuid` boundary on those two GETs, because item 4 already edits those handlers. **Exclude** the 403 `invalid_request` at `:405`/`:560`, and also the 401 `invalid_request` "User not found." at `:395`/`:546`/`:1069`, which the notes missed. File both as one follow-up issue and link it from the proposal's Non-Goals. |
| B8 | F7 and I1: in or deferred? | "Include them if the proposal stays small" is not decidable. | In scope, as separate tasks that are explicitly droppable. The proposal lists them with their own acceptance criteria, so dropping them is a visible decision rather than silent attrition. |
| B9 | Frontend 429 handling: in scope? | The notes call it an adoption risk, and I agree. Without it, the limiter's first real trigger is reported as a bug. | In scope. A limiter that facilitators experience as "the tool broke" fails the requirement it exists for. Acceptance criteria in C6. |
| B10 | Global secondary limit: yes or no? | Devon questions it, and it has to be decided either way. | No global limit for topic writes. Justify it in the decision record: the blast radius is one team's topic list, which restore can recover; the population is wide; and the per-actor daily cap bounds a single credential. Security can overrule, but then they must supply the number and its sizing rationale. |

---

## C. Vague areas → suggested rewrites (requirement-ready wording)

### C1. Limiter thresholds (notes §2 "Thresholds")

**As written:** "My rough number is ≥ 60 per 10 minutes. The actual numbers belong to BA and security."

**Worst-case legitimate sitting, recomputed with 12 defaults:**
- Archive 11 defaults with open action items (the last-active guard keeps one): 11 × 2 = 22
- Change mind, restore all 11: 11
- Add 5 custom topics: 5
- Annotate all 12 defaults + 5 custom: 17
- Reorder saves, including a couple of mistakes: 3
- Validation retries (422s count, per B3): ~5
- **Total ≈ 63 requests, in one sitting, for one team.**

One cross-team facilitator tailoring two teams back to back (the notes' scenario) is about 125 in under an hour.

**Suggested rewrite:**

> **Requirement TW-RL-1:** All five topic-write endpoints share a single per-actor budget, keyed on `session.userId`, enforced by a Redis sliding window.
> - Burst: **120 requests per rolling 10 minutes** per actor.
> - Daily: **400 requests per rolling 24 hours** per actor.
> - No global limit (see B10).
> - Early-warning event at 80% of each window (96/10m, 320/24h), following Q6 §2, emitted once per window crossing.
>
> **Acceptance:**
> - A single actor can issue 120 topic-write requests within 10 minutes and none returns 429. The 121st returns 429.
> - A test fixture runs the "full baseline restore" scenario (archive 11 defaults with confirmation, restore 11, annotate 12), about 45 requests, plus the same scenario on a second team with the same actor, about 90 requests total, and gets no 429.
> - The budget is shared: 60 adds plus 60 annotations from the same actor, in the window, and the next request on any of the five routes returns 429.
> - The budget is per actor: actor B is unaffected when actor A is limited.

The 120 figure is roughly 2× the single-team worst case, which covers the two-team facilitator. Security may want it lower; if they do, the floor is ~65 (one team's worst case plus margin), and the decision record must say that a two-team sitting will then hit a 429.

### C2. 429 response contract (notes §2 "Shape I'd expect" – "audit row → 429 + Retry-After")

**Suggested rewrite:**

> **Requirement TW-RL-2:** On breach, respond **HTTP 429** with:
> - Header `Retry-After: <integer seconds>`, the time until the oldest counted request leaves the breached window (≥ 1).
> - Header `Cache-Control: no-store`.
> - Body built with `buildErrorEnvelope`:
>   ```json
>   { "error": { "category": "rate_limited",
>                "code": "TOPIC_WRITE_BURST_LIMIT_EXCEEDED" | "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED",
>                "message": "<see below>",
>                "correlationId": "<uuid>" } }
>   ```
> - Message (burst): "You've made a lot of topic changes in a short time. Wait a few minutes and try again." Message (daily): "You've reached today's limit for topic changes. Try again tomorrow, or contact <support channel> if you need more." Neither message names the team or says whether it exists.
> - A durable `audit_log` row is written synchronously **before** the response: `actor_user_id`, `actor_ip`, `team_id` (the lowercase-normalised path value, as supplied, *not* verified to exist), `operation = 'topic.write_rate_limited'`, metadata `{ limit: "burst"|"daily", observedCount, endpoint }`.
> - Structured event `topic.write_rate_limit_exceeded` is added to `AuditEventName`.
> - No lockout. The actor can write again once the window clears.
> - `applyTimingFloor` is applied.

### C3. Ordering cascade (notes §2 diagram, §7 "comes after the 403 and before the 404")

**Suggested rewrite:**

> **Requirement TW-ORD-1:** For every topic-write endpoint, checks run in this order and the first failure answers:
> 1. Non-canonical `teamId` → 404 `TEAM_NOT_FOUND` (no query, no budget consumed)
> 2. Authorization → 403 (no budget consumed)
> 3. Rate limiter → 503 / 429
> 4. Team existence / template guard → 404 `TEAM_NOT_FOUND`
> 5. Customization lock → 409
> 6. Body / topicId validation → 404 / 422
>
> **Acceptance:**
> - An actor over budget gets **identical** 429 responses (status, headers apart from `Retry-After`/correlationId, body category/code/message) for (a) an existing team they're authorized on, (b) a well-formed UUID of a non-existent team, and (c) the template team ID.
> - An unauthorized actor gets 403, never 429, regardless of how many requests they've made.
> - A non-canonical `teamId` returns 404 even when the actor is over budget, and the window count doesn't change.
> - A structural test fails if any of the five handlers omits the limiter call, or calls it before authorization.

Note that (b) and (c) need the actor to pass step 2 on a team that doesn't exist. The proposal must state what authz *does* with a non-existent team for admins versus facilitators, or the test can't be written. I suspect admins pass authz on any UUID and facilitators fail it. Please confirm.

### C4. Redis outage (notes §2 "Fail-closed or fail-open")

**Suggested rewrite:**

> **Requirement TW-RL-3:** If the limiter can't reach Redis or doesn't get an answer within **500 ms** (applied with `withTimeout`), the request fails closed: **HTTP 503**, `Retry-After: 30`, `Cache-Control: no-store`, envelope `category: "service_unavailable"`, `code: "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE"`, message "Topic changes are temporarily unavailable. Please try again shortly." A structured `topic.write_rate_limit_check_failed` event is emitted. No DB write takes place.
>
> **Acceptance:** with Redis stubbed to throw, and separately to hang, all five routes return 503 with that envelope within the timing floor + 500 ms, and topic rows are unchanged.

The 500 ms value is my placeholder. Engineering should confirm it against the Redis client's own timeouts. The point is that the notes mention `withTimeout` "in passing" and the requirement needs a number.

### C5. Non-UUID ids (notes §1 "Item 2 … fixed")

**Suggested rewrite:**

> **Requirement TW-ID-1:** No team-scoped topic route returns 5xx for a malformed path id.
> - Malformed `teamId` → 404 `TEAM_NOT_FOUND` (existing behaviour, keep it; 404 precedes 403 per #175 M1, and the proposal records that rationale).
> - Malformed `topicId` on archive, restore and annotation → 404 `TOPIC_NOT_FOUND` from `buildErrorEnvelope("not_found", "Topic not found.", "TOPIC_NOT_FOUND")`, with no query issued. It's answered at the topic-existence step (after authz, lock and limiter), so it doesn't reveal anything about the team.
>
> **Acceptance:** a parametrised test over {hyphenless, braced, `not-a-uuid`, empty-ish `%20`} × {archive, restore, annotation} for `topicId` returns 404 `TOPIC_NOT_FOUND` with zero `topics` queries.

The notes reject a Fastify param schema and I agree. The requirement should say "no Fastify route-param schema for ids", so a well-meaning implementer doesn't add one.

### C6. Frontend 429/503 UX (notes §2 "No frontend handling for 429")

**Suggested rewrite:**

> **Requirement TW-UX-1:** On Topic Management, any topic-write action that receives 429 shows a non-modal, inline message in the page's existing message region. Text: "You've made a lot of topic changes quickly. You can try again in about N minutes." N is `ceil(Retry-After / 60)`, minimum 1. If `Retry-After` is missing, use "in a few minutes". The message has no "error"/"failed" wording and offers no automatic retry. The form keeps the user's input, so an unsent custom topic or annotation isn't lost.
> 503 `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE` shows: "Topic changes are temporarily unavailable. Please try again shortly."
>
> **Acceptance:** component tests for add, archive (both calls), restore, reorder save and annotation save, each covering 429 with and without `Retry-After`, and 503. Draft input is preserved in each case.

### C7. Lowercase at entry (notes §1 "Latent hazard")

**Suggested rewrite:**

> **Requirement TW-ID-2:** Each of the five handlers lowercases `teamId` immediately after `rejectNonCanonicalTeamId`. Every downstream use (queries, lock, template-guard compare, audit rows, structured logs, limiter metadata, response bodies) gets the lowercase form.
>
> **Acceptance:**
> - Two concurrent `DELETE …?confirm=true` requests against the team's last two active topics, one on a lowercase path and one on an UPPERCASE path, gated by the `real-db.ts` lock-waiter helper: exactly one succeeds, the other gets 409 `TOPIC_LAST_ACTIVE`, and exactly one active topic remains.
> - An equivalent serialisation test for add, restore and reorder, one UPPERCASE path each, to meet the issue's "all four handlers" criterion.
> - An audit row written from an UPPERCASE-path request stores `team_id` in lowercase.
> - A unit test with the template sentinel temporarily replaced by an ID containing hex letters proves that an uppercase spelling is still rejected. That turns "safe by accident" into "safe by test".

### C8. Extracting the sliding-window mechanism (notes §2 "TEAM-006's … behaviour must not change")

**Suggested rewrite:**

> **Requirement TW-RL-4:** `SLIDING_WINDOW_LUA`, `recordAndCountSlidingWindow` and `retryAfterSeconds` move to a shared module. The TEAM-006 thresholds (20/10m, 100/24h, 100/10m global), codes, messages, audit operation names and Redis key prefixes are unchanged, and topic-write keys use a distinct prefix so the two budgets never share a window.
>
> **Acceptance:** the existing TEAM-006 test files pass with **zero edits** (a diff of `routes/__tests__/teams*.test.ts` limited to import paths is acceptable; assertion changes are not). A test shows that exhausting the topic-write budget doesn't affect TEAM-006 and vice versa.

### C9. TEAM_NOT_FOUND consistency (notes §3)

**Suggested rewrite:**

> **Requirement TW-NF-1:** `teamNotFoundEnvelope()` moves to `error-envelope.ts`. Every response that means "team not found" returns **HTTP 404**, `category: "not_found"`, `code: "TEAM_NOT_FOUND"`, `message: "Team not found."`, built from that one function. In-scope sites: the five rows in the notes' §3 table, plus `content.ts:565` and all `topics.ts` call sites.
>
> **Acceptance:**
> - A grep-based structural test fails if the literal `"Team not found."` appears anywhere except `error-envelope.ts`.
> - The `teams.test.ts` assertions for `category: "invalid_request"` on those 404s are updated in the same commit, and the PR description calls the change out.
> - A frontend grep confirms that no code branches on those 404s' category. Record the result in tasks.md.
> - `ErrorCategory` gains `"rate_limited"` and `"service_unavailable"`. The `as const` literals at `teams.ts:1115`/`:1165` switch to `buildErrorEnvelope`. That switch must keep TEAM-006's bodies byte-identical apart from `correlationId`.

### C10. Session-runtime exclusion (notes §0 risk 2, §7 first checkbox)

**As written:** "must not wrap room open / POST /advance, voting, or any `facilitator-sessions.ts` route."

**Suggested rewrite:**

> **Requirement TW-RL-5:** The topic-write limiter is invoked only from the five handlers in B1. **Acceptance:** a structural test asserts that the limiter helper is not imported by `facilitator-sessions.ts` or any session/voting module. A behavioural test shows that an actor at 100% of the topic-write budget can still open a room and advance a session for a team they facilitate.

This turns Devon's most important ritual concern into something CI enforces, instead of a reviewer checkbox.

### C11. F7 / I1 (notes §4)

> **Requirement TW-HDR-1 (droppable task):** Every response from the five topic-write routes, including Fastify framework rejections (body-parse 400, 415, 413) and thrown-path 500s, carries `Cache-Control: no-store`, and every exit, thrown paths included, passes through `applyTimingFloor`. **Acceptance:** a parametrised test over the five routes covering {malformed JSON body, thrown DB error} asserts the header is present and the elapsed time is ≥ the floor. The `noStore: false` fixtures in `TEMPLATE_ROUTES` flip to `true`, and the header-equality assertion still passes.

---

## D. Traceability gaps

- **Thresholds need a decision record, not a design.md paragraph.** Q6 set the precedent: a co-signed `q?-topic-write-rate-limit-decision.md` (BA + Tomás) in this change folder. The proposal should name it as a blocking artifact for the limiter tasks, as Q6 blocked task 3.10.
- **Link the ritual requirement.** The "restore the baseline in one sitting" acceptance test (C1) traces to use case 08 (Topic Management) and `Feature Sets.md` §8. Cite both, so the threshold can't later be tightened without someone seeing what it protects.
- **Follow-up issue for B7 exclusions** (401/403 `invalid_request` categories in `teams.ts`) must exist before the proposal is approved, and be linked from Non-Goals.

---

## E. What's already requirement-ready (no change needed)

- §7's ritual-integrity checklist. Every item now maps to an acceptance condition above (C1, C3, C7, C8, C9, C10).
- The decision to keep the handler-level UUID check instead of a Fastify schema, and the 404-before-403 rationale for malformed IDs.
- Keying on `session.userId`, not IP. No lockout on breach.
