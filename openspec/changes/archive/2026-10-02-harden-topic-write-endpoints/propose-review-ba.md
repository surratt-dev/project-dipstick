# Propose Review (BA): harden-topic-write-endpoints (#184)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-10-02
**Reviewed:** `proposal.md` and the nine spec deltas under `specs/` (with `tasks.md` and `exploration-notes.md` §6 read for context)
**Checked against:** GitHub #184 acceptance criteria, `Feature Sets.md` §8, use case 08, my explore review (`explore-review-ba.md`)
**Focus:** Can each capability be built and tested from the text alone? Are acceptance criteria explicit? Where is the language vague?

---

## Verdict

**Approve with changes.** The proposal took up nearly every item from my explore review. The decisions are now requirements rather than leanings, the cascade is stated once per endpoint, and the ritual-floor scenarios trace to use case 08. This is close to build-ready.

I found **one internal contradiction that blocks approval** (R1). There are also five places where an engineer would have to come back and ask "what did you mean?" (R2–R6), and a set of smaller wording fixes (section C).

---

## A. Traceability to #184 acceptance criteria

| #184 AC | Where it is covered | Status |
|---|---|---|
| All four topic write handlers serialize on a case-insensitive lock key, with an uppercase-`teamId` integration test | `topic-write-request-hygiene`: "serialize on the same lock" (two scenarios); tasks 3.6 and 3.7 | **Covered**, and widened to the full set of lock-takers. The requirement also says "and against room open", but **no scenario tests room open** (see C4). |
| A non-UUID `teamId` on any topic route returns 4xx, not 500 | `topic-write-request-hygiene`: "No team-scoped topic route returns 5xx…" | **Covered for writes.** The requirement says "any team-scoped topic route", but its scenarios only exercise writes. The AC says *any* topic route, so add one GET scenario (C5). The issue asked for a route-param schema. The proposal rejects that deliberately and still meets the AC. Good, and recorded. |
| Topic write routes are covered by a shared per-actor rate limiter | `topic-write-rate-limiting` (whole capability) | **Covered.** It goes from four routes to five (adding TOPIC-007), and the proposal states the change. |
| Every team-not-found 404 carries `code: "TEAM_NOT_FOUND"` and a consistent category | `team-not-found-envelope` | **Covered.** I grepped `packages/backend/src`. Every `"Team not found."` site today is in `teams.ts` (426, 577, 1188), `facilitator-sessions.ts` (300, 344), `topics.ts:137` or `content.ts:565`, and all of them are in scope. The structural grep test will keep it that way. |
| F7 and I1 (informational in #184) | `topic-write-request-hygiene` last requirement; tasks group 7 | Covered, as separately droppable tasks. Good. That was my B8. |

Traceability to `Feature Sets.md` §8 (customization only after the first session) and use case 08 (12 defaults) is correct. Migration 11 is cited as the source of the count.

---

## B. Required changes

### R1. The ritual floor contradicts the two-team scenario (BLOCKING)

`topic-write-rate-limiting` says that, whatever the decision record sets, "the burst threshold SHALL NOT be lower than **80**". The same spec's scenario "Restoring the default baseline on two teams in one sitting is never limited" sends **90** requests within 10 minutes (2 × (22 + 11 + 12)) and requires that none of them returns 429.

If Q7 picks 80, which the spec allows, that scenario fails by construction. Either the floor or the scenario is wrong. The tailoring scenario (~78) also passes at 80 with only 2 requests to spare, and that tailoring total already *includes* ~5 retries after 422s.

**Suggested fix (pick one, and record it in Q7):**
- (a) Raise the burst floor to **≥ 100**. That is the 90-request two-team sitting plus about 10% margin. This is my recommendation, because the two-team facilitator is a real cross-team pattern from the explore notes.
- (b) Keep a floor of 80 and make the two-team scenario conditional ("…when the burst threshold is ≥ 90"). The decision record must then say plainly that a two-team back-to-back sitting can hit a 429.

### R2. Scenarios hard-code values that the requirement says are set elsewhere

The requirement says the thresholds "SHALL be those recorded in the co-signed decision record". Yet the scenarios hard-code 120, 121, 96 and 320, and the frontend copy test uses `Retry-After: 290`. If Q7 lands on any other number, the spec contradicts itself the day it merges.

**Suggested fix:** once Q7 is signed, write the signed values *into* the requirement text ("Burst: 120 per rolling 10 minutes…"), and remove "SHALL be those recorded in the decision record" as the normative source. Keep the floor clause as the documented constraint on future changes. Task 1.1 should add a step to "update spec values to match Q7 before group 5 starts".

### R3. "Once per crossing" for the 80% warning is undefined in a sliding window

In a sliding window the count goes up and down continuously. Is it a new "crossing" when the count goes 96 → 95 (an entry ages out) → 96? The current text requires state ("not on every later request") but does not define it.

**Suggested fix (stateless and testable):**
> The system SHALL emit `topic.write_rate_limit_warning` for a window when, and only when, the request just recorded makes that window's count exactly equal to `ceil(0.8 × limit)` (96 for burst, 320 for daily).
>
> Scenario: counts 95 → 96 emit once. 96 → 97 do not emit. An entry ages out (97 → 96 after trim) and the next recorded request makes 97: no event. The count falls to 95 and the next recorded request makes 96: one new event.

Because a request is recorded only while the window is under its limit, and each recorded request adds exactly 1, this equality fires exactly once per upward crossing and needs no extra Redis key.

### R4. When both windows are breached, `Retry-After` is ambiguous

"Daily takes precedence when both are breached" settles the *code*. But `Retry-After` is defined as the time until "the oldest counted entry leaves **the breached window**", and when both are breached, two windows qualify. There is also no scenario for the both-breached case.

**Suggested fix:** "When both windows are at their limit, the response SHALL use the daily code, the daily message and the daily window's `Retry-After`." Add the scenario: *an actor whose daily window is full and whose burst window is full receives `TOPIC_WRITE_DAILY_LIMIT_EXCEEDED` with a `Retry-After` greater than 600.* Also add a setup to the daily scenario that a tester can actually reproduce, for example "400 counted requests spread over more than 40 minutes so that burst is never breached; the 401st returns the daily code".

### R5. The 429 audit-row failure behaviour lives only in tasks.md

Task 5.3 says "fail-open on audit error, never a 500". The spec says only that the row SHALL be written synchronously before the response. A spec reader would conclude the opposite: if the row cannot be written, the 429 cannot be sent. The behaviour also conflicts on its face with "The limiter SHALL issue no database query" in the placement requirement.

**Suggested fix:**
- Narrow the placement requirement: "The limiter's admission check SHALL issue no database query. The breach path writes the audit row described below."
- Add to the breach requirement: "If the audit write fails or exceeds `<N>` ms, the system SHALL still respond `429` with the same contract and SHALL emit `<event>`." Name the bound and the event explicitly. "Fail-open" alone is not testable.

### R6. The daily message promises a remedy the system does not have

The daily copy is "…or ask your administrator if you need more today." Nothing in the proposal gives an administrator a way to grant more: no override, no reset endpoint, no documented procedure. A facilitator who follows the instruction reaches an admin who cannot help, and in the facilitator's eyes the tool is now broken *and* the admin is unhelpful.

**Suggested fix:** pick one and record it in Q7.
- (a) Document an ops procedure in the decision record. Name who runs it, and how they clear `topic-write:daily:<userId>`. Keep the copy.
- (b) Change the copy to "…You can continue tomorrow." and drop the administrator clause.

Task 1.1 already mentions "a named owner and trigger for reviewing a facilitator's 429", so (a) is nearly there. It needs to be stated as part of the requirement.

---

## C. Vague language and smaller fixes

| # | Location | As written | Problem | Suggested condition |
|---|---|---|---|---|
| C1 | rate-limiting, "A full tailoring pass…" scenario | "about 63 requests… about 15 pre-session edits" | "About" cannot be asserted. Two engineers will build two different fixtures. | Spell out the fixture: 11 archive pre-flights + 11 confirms + 11 restores + 5 adds + 17 annotations + 3 reorders + 5 adds rejected 422 = **63**; then 15 edits = 5 annotations + 1 definition clear + 4 archives (pre-flight + confirm) + 4 restores + 1 reorder. Total **78**, all on one unlocked team, within 10 minutes. (Or put the exact list in a fixture file and cite it.) |
| C2 | rate-limiting, "Redis hangs" | "no later than the timing floor plus 500 ms plus scheduling slack" | "Scheduling slack" is unbounded, so the test can never fail. | State the tolerance: "≤ floor + 500 ms + 250 ms". |
| C3 | rate-limiting, "Identical 429…" scenario | "an over-budget `application_admin` writes to…" | On TOPIC-007, admins fail identity/role (the annotation spec says admin → 403). The scenario cannot hold across all five routes for an admin. | Add "on TOPIC-003 to 006; on TOPIC-007 an over-budget `application_admin` receives `403`." |
| C4 | hygiene, lock serialization | "…and against room open" | This is the constraint the proposal cares about most, and no scenario covers it. | Add a scenario: "a reorder on an UPPERCASE `teamId` path waits while room open holds the team lock, and room open waits while that reorder holds it." |
| C5 | hygiene, 5xx requirement | Scenarios cover writes only | #184 AC says "any topic route". | Add: `GET /api/v1/teams/not-a-uuid/topics` (and any other team-scoped topic GET) → `404 TEAM_NOT_FOUND`, never 5xx. |
| C6 | team-not-found-envelope, teams.ts GET boundary | "check `teamId` with `isCanonicalUuid` before any query" | Task 2.4 says "without moving the 401/403 checks", but those checks issue queries. Does a malformed id get 404 or 403 first on these GETs? Topic routes answer 404 before 403. The spec has to say which order these routes use. | State the order explicitly, for example "401/403 as today, then the canonical check, then existence", and add a scenario for a non-member caller sending a malformed id. |
| C7 | remove-topic and restore-topic, "over-budget" scenarios | "…or with an invalid body" | Archive and restore take no body (copied from the add/reorder template). | Replace with "…or a non-canonical or nonexistent `topicId`". Also fix "a archive" / "a add-custom-topic" / "a annotation" to "an". |
| C8 | topic-management-screen, 503 copy | "Your topics are unchanged." | Part-way through a series of restores, k−1 restores *did* change topics, so this message reads as "nothing was saved". The burst copy handles this case ("Changes so far are saved"); the 503 copy does not. | Change the 503 copy to "This change wasn't saved. Changes you made earlier are kept. Please try again shortly." Make the same edit to the server message in the rate-limiting spec so the two stay identical. |
| C9 | topic-management-screen, archive confirm | "the escalated confirmation stays open" | Today `submitArchive` sets `removeState` to `{status:"error"}` on any non-OK response, which closes the escalated dialog and drops `openActionItems`. This is a new UI state, not reuse of the "existing error region". | Say so in the requirement, and add task 6.x: keep `awaiting_open_items_confirmation` and add an `error` field for 429/503. Scenario: after a 429 on confirm, the open-action-items list is still shown and Confirm is enabled. |
| C10 | topic-management-screen | message built by replacing "a few minutes" in the server string | The frontend depends on the server's exact wording. If someone edits the copy, the frontend silently falls back. That is acceptable, but nothing enforces the coupling. | Add a frontend test that imports or pins the server's burst message, so a copy change breaks a test rather than silently degrading. |
| C11 | add-custom-topic, check (2) | "team existence (`404 Not Found`)" with no code | The other four specs say `TEAM_NOT_FOUND`. This change is about envelope consistency. | Add `TEAM_NOT_FOUND` to check (2) and to the nonexistent-team scenarios in add-custom-topic. |
| C12 | proposal, constraint 2 | "restore the full 12-topic default set in one sitting" | The last-active guard means at most 11 can have been archived. The scenario correctly uses 11. | Reword: "restore every archived default topic (at most 11) and annotate all 12…". This is minor, but it stops someone re-deriving 12 × 2. |

---

## D. What I checked and found sound

- **Counting rule.** It is explicit about inclusions (404/409/422, pre-flight) and exclusions (403, non-canonical, 429, 503), and atomicity is stated. That was my B2–B4.
- **Enumeration safety.** Placement is after authorization and before existence, and the identical-429 scenario covers all three team kinds. It closes the question I left open in explore C3: facilitators pass the membership sub-check on a nonexistent team, so cases (b) and (c) can be reached.
- **Session-runtime exclusion.** There is a structural test *and* a behavioural one ("an exhausted budget does not block a session"). This is the constraint I care about most, and it is testable as written.
- **TEAM-006 independence.** It has a byte-identical body test and requires the existing tests to pass with only import edits.
- **Frontend.** It says no auto-retry, no raw seconds, no page-wide banner, and that input is kept. The singular/plural minute rule is precise. Good.
- **`audit_log.team_id`.** It has no FK (`migrations/8_audit_log.sql:38`), so writing an unverified lowercase `team_id` on a 429 for a nonexistent team will not fail.

---

## E. Summary for the author

| Priority | Item |
|---|---|
| Blocking | R1: the burst floor (80) is below the 90-request two-team scenario |
| Required | R2 values pinned into spec after Q7 · R3 define warning "crossing" · R4 both-breached `Retry-After` + daily setup · R5 audit-failure behaviour into spec · R6 daily copy vs. no admin remedy |
| Should fix | C1 exact fixture · C2 bounded tolerance · C3 admin on TOPIC-007 · C4 room-open lock scenario · C6 teams.ts GET order · C8 503 copy mid-series · C9 escalated dialog state |
| Nice to have | C5, C7, C10, C11, C12 |

— Marcus
