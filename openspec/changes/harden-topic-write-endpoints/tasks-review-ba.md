# Tasks Review: harden-topic-write-endpoints (Business Analyst)

*Reviewer: Marcus Delgado, Senior Business Analyst. Reviewed `tasks.md` against `proposal.md`, the nine spec deltas under `specs/`, GitHub #184 (body and its follow-up comment) and the ritual checklist in `exploration-notes.md` §7. I checked the current code where a task's claim depends on it.*

## Verdict

**Approve with changes.** The task list is well built. Every capability in the proposal has an implementing task. Each of the four #184 acceptance criteria traces to at least one task that produces a test. The ritual constraints (no limiter on session runtime, the 90- and 78-request fixtures, the identical 429) are each pinned to a named test, so nobody has to rely on good intentions.

Most of what is lost in translation is at the scenario level. Several spec scenarios have an implementing task but no test task that asserts what the scenario actually says. One item is structural: the time-box drop order (drop task 2.4) contradicts the spec and would break task 2.6's own test. That one needs fixing before implementation starts. The rest can be fixed by adding a clause to existing tasks.

---

## 1. #184 acceptance criteria traceability

| # | Acceptance criterion (#184) | Implementing tasks | Test tasks | Status |
|---|---|---|---|---|
| AC1 | All four topic-write handlers serialize on a case-insensitive lock key, proven by an integration test with an uppercase `teamId` | 3.1 | 3.6 (archive, mixed case, real DB), 3.7 (add, restore, reorder), 3.8 (vs room open) | **Traced.** Covers all four lock-taking handlers. Annotation correctly takes no lock. |
| AC2 | A non-UUID `teamId` on any topic route returns a 4xx, not a 500 | 3.9 (`GET /topics`); writes and `/topics/all` already done in #175 | 3.9 (both read routes); existing `topics.test.ts` "non-canonical teamId (M1)" block covers all five writes | **Traced**, with one gap: 3.9's test does not assert "no query issued", which the spec scenario requires (see C6). Spec and tasks also go further than the AC by covering a malformed `topicId` (3.4, 3.5). |
| AC3 | Topic-write routes are covered by a shared per-actor rate limiter | 4.1, 4.2, 5.1–5.5 | 4.3, 5.6–5.11 | **Traced.** This is the most thoroughly tested part of the change. |
| AC4 | Every team-not-found 404 carries `code: TEAM_NOT_FOUND` and a consistent category | 2.2, 2.3, 2.4 | 2.6 (grep guard), 2.4 (updated `teams.test.ts`) | **Traced, but conditional.** No test task for 2.3, and the drop order turns AC4 into a partial delivery without saying so. See R1 and R2. |

---

## 2. Required changes

### R1. The time-box drop order conflicts with the spec and with task 2.6 (blocking)

The header and the proposal say that if the time box is exceeded, task 2.4 (the `teams.ts` envelope swap) is dropped first. Task 1.2 can also defer it. Neither path says what happens to the artifacts that depend on it.

- `specs/team-not-found-envelope/spec.md` names `GET /api/v1/teams/:teamId`, `/members` and `POST /:teamId/managers` as normative, with the scenario "teams.ts GET routes use not_found". If 2.4 is dropped, the change archives a spec the code does not meet.
- Task 2.6's grep test fails as written. `"Team not found."` is still in `teams.ts` at lines 426, 577 and 1188 today.
- AC4 would ship only partly met, and #184 would need to stay open or be closed incorrectly.

**Fix:** add a contingency task, for example "2.4a: if 2.4 is deferred (by 1.2 or the time box), (i) amend the `team-not-found-envelope` delta to drop the three `teams.ts` routes and that scenario; (ii) give 2.6 a single named `teams.ts` exemption that cites the follow-up issue; (iii) file the follow-up issue and add it to 1.1; (iv) state in the PR that #184 AC4 is partly met and leave #184 open, or link the follow-up to it."

### R2. Task 2.3 has no test

The spec scenario "Draft session creation uses the canonical code" (for both a non-existent and a non-canonical `teamId`) traces to no test task. `facilitator-sessions.test.ts:286` asserts `category` and `message` today but not `code`. Its existence-check counterpart needs the same assertion.

**Fix:** extend 2.3: "Update `facilitator-sessions.test.ts` so both draft 404s (non-canonical and non-existent) assert `code: "TEAM_NOT_FOUND"` and `category: "not_found"`." Because this is the one touch on `facilitator-sessions.ts`, the test also shows the change there was envelope-only.

### R3. The per-endpoint "over budget" scenarios are only partly tested

Each of the five modified specs has the scenario "An over-budget actor receives 429 before team existence, template, lock or body checks". Its WHEN clause lists a nonexistent team, the template team, **a locked team**, and **an invalid body** (or a **non-canonical or nonexistent `topicId`** on archive and restore). Its THEN clause includes "no `topic.write_denied_locked` row is written". Task 5.9 tests only existing, non-existent and template teams. 5.6 tests only the non-existent team.

**Fix:** extend 5.9 to cover the locked-team, invalid-body and malformed-`topicId` cases on the relevant routes, and assert that no `topic.write_denied_template` or `topic.write_denied_locked` row exists.

### R4. "Failed but authorized requests are counted" is never tested at the route level

The spec says that 404, 409 and 422 outcomes and the archive pre-flight that returns `requiresConfirmation` all count. The 78-request fixture includes 5 adds rejected with 422, but 5.8 runs it **against the limiter function directly**, so the fixture never proves that a 422 at the route consumes budget. No other task does either. The counting rule is the part security co-signed, and it diverges from TEAM-006, so it needs a route-level test.

**Fix:** add to 5.8 or 5.9: "at route level, one 422, one 404 `TOPIC_NOT_FOUND`, one 409 lock and one archive pre-flight each add exactly one entry to both windows (ZCARD before and after)."

### R5. The structural exclusion test is a deny-list; the spec is an allow-list

Spec scenario "Structural exclusion": the limiter module "is imported only by `routes/topics.ts` (and its own tests)". Task 5.7 says it "is not imported by `facilitator-sessions.ts` or any session/voting/WebSocket module". A deny-list misses the next runtime module nobody thought to list. The allow-list is stronger and is what the spec says.

**Fix:** reword 5.7 as an allow-list: the only non-test importer of `topic-write-rate-limit.ts` and `sliding-window-limiter.ts`'s topic-write wrapper is `routes/topics.ts`. `teams.ts` is allowed for the shared TEAM-006 primitives. Test files are exempt, including the `vi.mock` helper from 5.4a.

---

## 3. Recommended changes (scenario clauses with no asserting task)

Each item below has an implementing task. What's missing is a test that asserts the clause, so a regression would pass CI.

- **C1. 429 audit row contents (5.3 / 5.8).** The burst-breach scenario requires the row to be written **before** the response, with `metadata.team_verified = false`. The requirement also lists `limit`, `windows`, `observedCount`, `endpoint`, `actor_global_role`, `actor_ip` and the lowercase `team_id`. 5.8 counts rows ("exactly one") but checks none of these fields. Add one route-level assertion of the full row shape, including the lowercase `team_id` from an UPPERCASE path. That last check also covers the "limiter metadata" clause of the lowercasing requirement.
- **C2. Structured events.** No task asserts that `topic.write_rate_limit_exceeded` is emitted on **every** 429 with a growing `suppressedCount` (scenario "Later 429s in the same episode write no audit row", third AND clause). No task asserts that `topic.write_rate_limit_check_failed` is emitted on a 503. Add both to 5.8 and 5.10.
- **C3. The audit-failure scenario (5.8).** The spec asserts a latency bound (floor + 500 ms + 250 ms) and that `auth.audit_write_failed` is emitted. 5.8 asserts only "still gives the 429". Add both checks.
- **C4. A new episode is audited again.** 4.3 proves the marker expires at the script level. No route-level test shows that a second episode writes a second row. Add a case to 5.8 using injected `nowMs` or pre-seeded ZSETs.
- **C5. No lockout after the window clears, and no limit on GETs.** Neither scenario has a test. Both are cheap to add to 5.8 or 5.9: once the window clears, the next write reaches the cascade (for example, a 201); an over-budget actor's `GET /topics` returns 200.
- **C6. Task 3.9 should assert "no query issued for that `teamId`"**, as the spec scenario says and as the existing write-route M1 tests already do (`mockDbQuery` not called).
- **C7. Lowercasing beyond the audit row (3.3).** The requirement covers "every structured log `teamId`" and "response bodies". 3.3 tests only the audit row. Add a log-capture assertion. The response body check can reuse the reorder spec's existing uppercase scenario.
- **C8. 503 path writes nothing to the database (5.10).** The spec says "No topic, audit or other database write". 5.10 asserts only that topic rows are unchanged. Add "no `audit_log` row".
- **C9. Frontend copy cases (6.1 / 6.3).**
  - The spec scenario pins `Retry-After: 290` → "Please wait about 5 minutes and try again."
  - The requirement also needs the singular ("about 1 minute") and minimum-1 cases, for example `Retry-After: 1` and `60`.
  - Add a daily 429 that shows the server message unchanged.
  - The proposal's disposition accepted BA C9, "pinned server message in frontend tests". No task carries it. Pin the 503 string from the "Add form input survives a 503" scenario and the shared burst constant in the component tests.

---

## 4. Lost in translation from #184 itself

The follow-up comment on #184 (from #55 / PR #196) routed five items here. Item 1 (TOPIC-003 rate limit) is addressed by group 5, and item 5 (lock case on TOPIC-003) by 3.1 and 3.7. The other three are not in scope and not in task 1.1's follow-up list, and I found no existing issue for them:

1. **403 denials on topic endpoints are not audited.** A repeated `FACILITATOR_IS_TEAM_MEMBER` is the signal of someone trying to curate their own team's topics.
2. **Bidi and zero-width characters in topic name and prompt.** #195 covers team definitions only.
3. **Unencoded `teamId` in `TopicManagementPage.tsx` fetch paths.** The comment says this is "worth fixing alongside this issue's `teamId` UUID validation", and this change already edits that file in group 6.

None of these needs to be in this PR. But if #184 is closed by this change, they disappear. **Fix:** add them to 1.1 as items (h), (i) and (j), or record them in the proposal's Deferred list with an issue link. Item 3 is a one-line `encodeURIComponent` in a file group 6 already touches. I'd take it in scope if Devon is willing, but I won't push it.

---

## 5. Smaller notes

- **1.2:** "Record the result here" should name where: a sub-bullet under 1.2 in this file is fine. It needs to be visible to the 2.4 reviewer.
- **2.4:** the spec's normative list includes `POST /:teamId/managers`, but no scenario covers it. 2.4's updated `teams.test.ts` assertions should include it.
- **5.6 vs spec:** 5.6 enumerates routes "with `onRoute`" but does not say how a topic-write route is recognized. Say it explicitly (method ∈ {POST, PUT, DELETE} and URL under `/api/v1/teams/:teamId/topics`). Then a sixth write route added later is caught, and GETs are excluded on purpose.
- **7.2** is the right closing step. It would be stronger if the §7 checklist were copied into the PR description with each item's test name. The §7 floor text still says "≥ 80 burst" and "full default topic set (12)", both now superseded (≥ 100; 11 restores plus 12 annotations across two teams). Update §7 or tell the walker that the spec wins.

---

## 6. Spec-scenario coverage summary

| Spec | Scenarios | Fully traced to a test task | Partial (see) |
|---|---|---|---|
| topic-write-rate-limiting | 22 | 14 | Counted on 422 (R4), audit row shape (C1), suppressed-count event (C2), new episode (C4), audit failure (C3), no lockout (C5), structural exclusion (R5), Redis error/hang events and audit (C2, C8) |
| topic-write-request-hygiene | 7 | 5 | Audit and log lowercase (C7), read-route no-query (C6) |
| team-not-found-envelope | 4 | 2 | Draft session (R2), teams.ts GET under drop order (R1) |
| add-custom-topic / remove / restore / reorder / annotation | 3 new or changed per spec | 403-never-429 and malformed `topicId` traced | Over-budget cascade cases (R3) |
| topic-management-screen | 6 | 4 | Exact copy (C9) |

With R1–R5 applied, every acceptance criterion and every spec scenario has a test task that asserts what the scenario says.
