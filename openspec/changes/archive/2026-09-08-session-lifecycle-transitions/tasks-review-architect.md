# Architect Review: tasks.md — session-lifecycle-transitions

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering and dependency correctness only, per this pass's charge. I am not re-reviewing design.md's technical decisions themselves — I re-checked them only to verify tasks.md sequences them correctly.

## Summary

The group-level structure (1: session-phase entry → 2: lock-in fix → 3: reveal write → 4: topic advance → 5–8: docs/spec/verification) correctly mirrors design.md's Migration Plan, and the explicit "Depends on" / "Sequencing note" headers on Groups 1–4 are accurate. The id-space discipline (`topicId` vs. `sessionTopicId`) that design.md's binding rule establishes is applied correctly and consistently everywhere it's touched — I did not find a single lingering ambiguity there. That part of the prior revision held.

I found one dependency-inversion finding that should block sign-off (§1: task 2.4 tests against a "reveal request" that doesn't functionally exist until Group 3 lands, but is scheduled inside Group 2), and one systemic pattern that appears three times and should be fixed uniformly rather than patched once (§2: shared-type/union additions are consistently sequenced *after* the same-group tasks that reference them). Neither is a full redesign — both are task-list reordering.

---

## 1. Blocking: task 2.4 requires Group 3's reveal write to exist, but is scheduled before Group 3

Task 2.4 (Group 2, "Vote Lock-In / Reveal Race Fix"):

> "a lock-in request **and a reveal request** for the same `session_topic_id`, issued concurrently while the topic is `voting`. Assert the two requests resolve to a single consistent outcome... Assert no vote is ever inserted after the reveal transaction for that topic has committed."

Read literally, "a reveal request" means the live `POST .../reveal` endpoint. But per proposal.md's Why section, before this change the reveal endpoint "returns `200 { revealed: true }` and writes nothing" — there is no state transition to race against until Group 3's conditional `UPDATE` (Decision D2) exists. Group 2 is explicitly sequenced *before* Group 3 ("this must land before the reveal write (Group 3) is exercised in any real end-to-end test"). As written, task 2.4 cannot be meaningfully executed at the point in the task list where it's placed — the "reveal request" it needs to race against is a no-op until two groups later.

This is different from task 2.3, which only needs `session_topics.status = 'revealed'` as a *fixture precondition* (settable by direct SQL, no live endpoint required) — 2.3 is fine where it is. 2.4 needs a second live transaction actually attempting the D2 conditional `UPDATE` concurrently, which is Group 3's deliverable.

**Recommend one of:**
- (a) Move 2.4 to Group 3, positioned after 3.9 (which already covers the reveal-vs-reveal concurrent race) as a "3.9a" — Group 3 is where "a reveal request" first means something. This is consistent with design.md's own text distinguishing it from "Group 3's duplicate-reveal test" — it's a Group 3–adjacent test, not a Group 2 one.
- (b) If the intent was for 2.4 to exercise the row lock directly (two concurrent transactions issuing D2's exact SQL and Decision D5's `SELECT ... FOR UPDATE`, without going through the HTTP reveal endpoint), reword the task to say so explicitly — that version genuinely can run inside Group 2, since it needs only the schema (already present) and Group 2's own lock-in fix.

I'd lean toward (a): the task's own framing ("not a variant of Group 3's duplicate-reveal test") reads as end-to-end, endpoint-level intent, and testing the real endpoint is a stronger regression guard than testing the SQL pattern in isolation.

---

## 2. Systemic pattern: shared-type/union tasks are sequenced after the tasks that need them, three times

This is the same defect recurring in three places. Individually each looks like a minor scheduling nit; together they're a pattern worth fixing at the list level rather than one at a time.

**a) `session.topic_advanced` (Group 4).** Task 4.5 writes `audit_log` with `operation = 'session.topic_advanced'` — a value that only exists in the `AuditEventName` union once task 4.7 runs. 4.7 is sequenced *after* 4.5 and 4.6. This is the sharpest instance: `AuditEventName` is a closed TypeScript union (per design.md's Context section), so as literally sequenced, 4.5's code cannot compile until 4.7 has already happened. **This is the one you specifically asked about in a different form (1.4/1.7) — it recurs here in a stricter, compile-blocking version.**

**b) `StartSessionResponse` / `BeginVotingResponse` (Group 1).** You asked directly whether 1.4/1.7 are sequenced before the SESSION-004/005 tasks that consume them. They are not — 1.4 comes after 1.1–1.3, and its own text ("return it from 1.1/1.2's handler") confirms 1.1/1.2 are being retrofitted to use a type that doesn't exist yet at the point they're written. Same for 1.7 relative to 1.5/1.6. This one is softer than (a) — a handler can return an untyped/inline object shaped correctly and be reconciled to the named type when 1.4/1.7 land, so it's not a hard compile blocker — but it's the same ordering inversion.

**c) `RevealAlreadyRevealedResponse` (Group 3).** Task 3.3 constructs a `409` body shaped exactly like `RevealAlreadyRevealedResponse` (`errorState: "already_revealed"`, `sessionId`, `teamId`, `sessionTopicId`, `revealedAt`) — but that type isn't defined until task 3.6, three tasks later. (Note: `TopicAdvanceBlockedResponse`, defined in the same task 3.6, is fine — its only consumer, task 4.3, is in Group 4, safely after 3.6.)

**Recommend:** pull the type/union-definition half of each pair to immediately precede its first same-group consumer, rather than trailing the group. Concretely: split 3.6 so `RevealAlreadyRevealedResponse` is defined before 3.3 (e.g., as 3.0/3.1a) and `TopicAdvanceBlockedResponse` stays where convenient (before 4.3); move 4.7 to before 4.5; move 1.4 to before 1.1 and 1.7 to before 1.5, or fold each into the front of its respective handler task. This isn't a design change — every type is already fully specified in design.md D1/D3 — it's purely a task-list reordering to match how a compiler actually needs it.

---

## 3. Group 2 before Group 3 (lock-in fix before reveal write): correctly sequenced

Confirmed against design.md Decision D5 and the Migration Plan ("sequenced before the reveal write becomes callable in a real end-to-end test, so no test run can observe the race it closes") and against proposal.md's framing that shipping the reveal write without this fix first is exploitable. Group 3's header ("Depends on: Group 2") matches. The only issue in this pairing is §1 above (test 2.4's placement), not the group ordering itself.

---

## 4. Authorization task 4.1 and test tasks 3.11 / 4.10a: correctly placed

- 3.11 (non-facilitator vs. already-revealed → still generic 403, never `already_revealed`) sits after 3.1–3.10, all of which it depends on (the precondition-check code and the existing facilitator check it's verifying the ordering of). Correctly placed.
- 4.1's two-check authorization (team-id cross-check, then facilitator-id) is embedded in the endpoint-implementation task itself, ordered before 4.2's precondition check within that same task — matching Decision D3/D4's ordering requirement (auth must complete before either 409 precondition is reachable). Correct.
- 4.10a (team-mismatch 403; non-facilitator vs. not-yet-revealed → still generic 403, never `advance_blocked`) sits after 4.1–4.9, all of which it depends on. Correctly placed.
- I found no test in Groups 3 or 4 that exercises functionality a prior task in the same group hasn't yet built.

---

## 5. Task 6.4's "run right after Group 4" note: correct as far as it goes; Group 6 as a whole is under-specified

6.4 corrects stale "action item finalization" language in issue #26 and in `ws-pubsub.ts`/`ws-event-dispatcher.ts` comments, plus the `audit-logger.ts` `AuditEventName` comment block that currently says the reveal/state-changed operations are "blocked on issue #26." Since Group 4 depends on Group 3 (§3 above), and Group 4 is where the last of the relevant real call sites (`session.topic_advanced`, the wrap-up `state_changed` branch) land, "immediately after Group 4" is sufficient — it does not need to wait for Group 5 (frontend notes, no code dependency), Group 7 (spec sync), or Group 8 (E2E verification). Your proposed alternative — wait until *all* groups land — is broader than necessary for 6.4 specifically.

That said, there's a real gap one level up: **Groups 1–4 each carry an explicit sequencing note; Group 6 as a whole does not**, even though 6.2 corrects text that names `SESSION-005` (a Group 1 endpoint) alongside `reveal.trigger`/`topic.advance` (Group 3/4 concerns). Design.md's own Migration Plan item 5 states documentation corrections "can proceed in parallel with 1–4 once the endpoint shapes are settled" — which they already are, in design.md itself, so 6.1–6.3 don't actually need to wait for any code group to land. Nothing in tasks.md says this; a reader working strictly down the numbered list would infer 6.1–6.3 wait for Groups 1–5 to finish, which is stricter than necessary and inconsistent with the plan's own stated intent. 6.5 already carries its own explicit note ("once Groups 3 and 4 are wired in"); 6.1–6.3 don't, and should.

**Recommend:** add a one-line header note to Group 6 clarifying that 6.1–6.3 (contract text, already fully determined by design.md) may proceed in parallel with Groups 1–4, while 6.4 and 6.5 each carry their own harder dependency (Group 4, and Groups 3+4 respectively) and must wait.

---

## 6. Tasks that should be split or merged

Beyond §2's type-ordering pattern (which is a reorder, not a split/merge), I did not find cases of a task mixing an unrelated schema/query change with a behavior change, or artificially split dependency-adjacent steps. The Group 3/4 decomposition (precondition write → rowCount branch → lookup → per-branch write) matches design.md's own D2/D4 structure step for step, and the atomic-transaction tasks (1.1, 1.5, 3.1–3.5, 4.1–4.6) are correctly kept whole rather than split mid-transaction, consistent with each transition needing to commit-or-not as a unit. Decision D6 (no shared precondition-failure middleware) is correctly reflected by the *absence* of a task attempting to build one — nothing to fix there.

One soft observation, not a defect: task 3.6 bundles two response types that belong to two different groups (`RevealAlreadyRevealedResponse` for Group 3, `TopicAdvanceBlockedResponse` for Group 4) into one Group-3 task. This is only a problem in combination with §2c above (the Group-3 half needs to move earlier); once split for that reason, the natural result is that each half sits with the group that actually needs it, which resolves this too.

---

## Action items, in priority order

1. **Fix §1** — reposition or reword task 2.4 so it doesn't assume a functioning reveal endpoint two groups before one exists.
2. **Fix §2** — resequence 1.4, 1.7, 3.6 (split), and 4.7 to precede their same-group consumers, not follow them. 4.7 is the most urgent of the three (compile-blocking as written).
3. **Fix §5** — add a Group 6 header note distinguishing 6.1–6.3 (no hard dependency) from 6.4/6.5 (Group 4– and Group 3+4–gated, respectively).

None of these require touching design.md — all three are task-list-only corrections.
