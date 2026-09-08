# Tasks-Stage Review: websocket-delivery-time-authorization

**Reviewer:** Marcus Delgado, Business Analyst
**Stage:** Tasks (tasks.md, checked against proposal.md, design.md, and the delta spec)
**Date:** 2026-09-07
**Prior artifacts reviewed:** `propose-review-ba.md` (Propose stage, mine), `design-review-engineer.md` and `design-review-security.md` (Design stage, incorporated into design.md and tasks.md before this review)

---

## 0. Bottom line

This is the closest this proposal has come to "an implementer opens tasks.md and doesn't come back to me." I went looking specifically for the two failure modes that matter at this stage: a decision from design.md with nowhere to land in tasks.md, and a spec scenario nobody wrote a task to verify. I did not find either. Every decision D1–D10, the Blocking Dependency section, and every scenario added across all three review rounds — including the vote-submission audit-logging scenario Tomás caught and I didn't — traces to at least one task, most to several, with the blocked/unblocked status of each honestly annotated inline rather than glossed over.

I found one real issue, and it's not in tasks.md — it's a leftover in the delta spec that tasks.md's own fix exposes by contrast:

1. **The delta spec still contains the stale "Path 1 or Path 2" numbering that design.md explicitly diagnosed as wrong and that tasks.md 4.5 was corrected to drop.** Design.md's Design-stage disposition says outright that the spec's requirement text "already correctly states" member-or-facilitator — true for the plain-English clause, but the parenthetical citing "Path 1 or Path 2" is the same drifted terminology design.md fixed everywhere else it appeared. Nobody caught that the spec itself still carries it. Section 2 below.

Two smaller items worth a look before this leaves my desk, neither blocking: a spec-completeness asymmetry where `session_state_change` — one of the four named events — has no dedicated acceptance scenario even though tasks.md gives it more test coverage than the other three combined (Section 3), and one task (9.1) whose own "done" condition is softer than the gate built on top of it (Section 4).

None of this should hold up Tasks. All three are either spec-hygiene or acceptance-criteria tightening, not missing coverage.

---

## 1. Decision-to-task traceability: D1–D10 and the Blocking Dependency, checked one at a time

I built this as a checklist and went through it in order rather than sampling. Every row has at least one task; most have several, and I've noted where a decision's sub-parts land in more than one place.

| Decision | Task coverage | Notes |
|---|---|---|
| **D1** — Transport: `@fastify/websocket`, not Socket.IO | 1.1, 1.2 | Direct. |
| **D2** — Fan-out: Redis pub/sub via `ioredis`, required | 1.3 (channel topology), 1.4 (publisher + `redis.duplicate()` subscriber + reconnect-gap logging), 3.1–3.4 (registry lifecycle), 3.5 (`.send()` readyState verification) | All five sub-decisions named under D2 have a landing task. See below for the one sub-decision (dual-role admin+member trade-off) that lands only as a test, not a doc task — I checked whether that's a gap and concluded it isn't. |
| **D3** — Delivery-time check placement, concurrency model, per-event mapping, drift risk, `evaluateSessionSubscriberAccess` | 2.1–2.4 (sibling helper), 4.1 (concurrent `Promise.all`), 4.2–4.5 (per-event mapping), 4.6 (drift-risk code-review gate) | Direct, and 4.6 specifically operationalizes the "tell" design.md names for catching a regression to subscription-time caching. |
| **D4** — `vote_revealed` reuses the serializer, no parallel logic | 4.4, 5.8 | Direct. |
| **D5** — Cross-recipient delivery-skew measurement | 6.3, 6.4, 6.5 | Direct. |
| **D6** — Acceptance test plan (7 items: latency p95/p99, threshold confirmation, skew measurement, documentation, pub/sub-hop revocation test, admin-rejection test, four-event authorized/unauthorized matrix) | 6.1, 6.2, 6.3/6.4, 6.6, 5.2, 5.6, 5.1/5.3 respectively | All seven items map one-to-one. |
| **D7** — Audit logging (schema-corrected; vote-submission, reveal, session-state-change; transaction-pattern refactor) | 7.1–7.7 | All four triggering actions covered, including the transaction-refactor requirement stated explicitly at the top of Group 7 and repeated per-task (7.2, 7.3, 7.6). |
| **D8** — SEC-25/26 tracked to companion effort + compensating absolute-lifetime bound | 8.1–8.4 (companion tracking), 3.2/3.6/4.1/5.10 (compensating control: capture, force-close, delivery-time rejection, test) | Direct, and correctly split across two groups since the tracking and the compensating control are different mechanisms per D8's own text. |
| **D9** — Origin/CSWSH validation | 1.2a | Direct. |
| **D10** — Redis hardening assumptions (AUTH/ACL, network isolation, command logging, TLS) | 1.6 | Direct, and the single task's four sub-clauses map to D10's three numbered items plus the deployment-confirmation framing. |
| **Blocking Dependency (Group 0)** | 0.1–0.6 | The section's own six components — issue filed, linked, per-task blocked/unblocked accounting, the E2E gate, the `TODO(#26)` comment convention, and Tomás's future code-guard recommendation — each get their own subtask rather than being compressed into one bullet. |

**On the one D2 sub-decision I flagged above:** design.md records the admin+member dual-role trade-off as "confirmed intentional... documented here rather than discoverable only by reading the spec's scenario text closely," and explicitly says the onboarding-guidance follow-on is "outside this change's deliverable." There's no tasks.md item that says "document the trade-off" — but there doesn't need to be one, because design.md *is* that documentation, and it already exists. What tasks.md does add is verification that the behavior actually holds: task 5.6 explicitly tests "an Application Admin subscribed to a team's event stream does NOT receive `topic_history_update` events, **including when the admin is also independently a team member or facilitator**." That's the right thing to task — behavior, not prose — so I'm treating this as covered, not a gap.

**Conclusion on Section 1: no decision in D1–D10 or the Blocking Dependency section is missing task coverage.**

---

## 2. Spec scenario-to-task traceability, and the one leftover I found

Walking every scenario added or modified across all three review rounds:

| Spec requirement / scenario | Task(s) | Status |
|---|---|---|
| `vote_readiness_update` delivered only to active facilitator | 4.2, 5.1, 5.7 | Covered |
| `vote_revealed` delivered to all authorized subscribers | 4.4, 5.1, 5.8 | Covered |
| `topic_history_update` delivered only to team members | 4.5, 5.1 | Covered |
| Application Admin does not receive `topic_history_update` (incl. dual-role) | 5.6, 5.9 | Covered — 5.9 is a named regression test specifically guarding against the table-drift error Marcus Oyelaran caught |
| Cross-recipient delivery skew bounded, measured | 6.3, 6.4, 6.5, 6.6 | Covered |
| Per-pod concurrency model explicit and documented, worst-case fan-out width stated | 4.1 (implementation); the width itself is stated in design.md D3's prose | Covered, though see note below |
| Vote submission is audit-logged | 7.6, 7.7 | Covered |
| Reveal action is audit-logged | 7.2, 7.4 | Covered (correctly annotated as blocked on #26 for true E2E) |
| Session state change is audit-logged | 7.3, 7.5 | Covered |
| SEC-25 idle-connection gap tracked, not satisfied by delivery-time checks alone | (descriptive scenario — no task needed; see below) | Covered by design |
| SEC-25 compensating bound: idle connection closed at absolute lifetime cap | 3.2, 3.6, 4.1, 5.10 | Covered |
| Companion tracking effort exists before completeness | 8.1–8.4 | Covered |

Two notes on this table, neither a missing-task problem:

- **The "idle connection is not re-authorized" scenario** (spec.md, "An idle connection is not re-authorized by delivery-time checks") describes an absence — nothing runs because nothing is pushed — which isn't something a task can verify in the normal sense; it's true by construction of the delivery-time-only design. I don't think this needs a task, and I'm not asking for one. Flagging only so it's clear I looked at it and didn't just skip it because it looked awkward to trace.
- **The per-pod concurrency model / worst-case fan-out width scenario** is satisfied by design.md's own prose (D3: "single digits... per the ritual's own small-team design") rather than by a tasks.md deliverable. That's fine for this change's own completion, but nothing in Group 10 (Spec and Documentation Finalization) explicitly carries that stated width forward into the synced spec or an equivalent durable location once this change archives and design.md stops being the live reference. Minor — I'd add one line to 10.1 or 10.2 saying "confirm the stated worst-case fan-out width is captured in the archived spec's own text, not only in this change's design.md," so the number doesn't become undiscoverable the day this folder gets archived. Not blocking.

**The one real finding in this section is not a missing task — it's a spec-text leftover that a task correctly fixed around, but nobody fixed at the source:**

Delta spec, line 14 (the `topic_history_update` row of the delivery-time authorization table):

> The subscriber MUST pass the same team membership check as the corresponding HTTP endpoint (**Path 1 or Path 2** of the team-content-access authorization helper — i.e. `evaluateTeamAccess` returns `grant.path === 'member'` or `grant.path === 'facilitator'`), and an `admin`-path grant MUST be rejected

Design.md's own Design-stage disposition explains exactly why "Path 1 or Path 2" is wrong: the archived HTTP design's numbering calls the facilitator grant **"Path 3,"** not Path 2. Design.md says this drift showed up in two places — its own D3 table and tasks.md 4.5 — and that both were "fixed here... to drop the numbered-path terminology entirely." I checked both: design.md's D3 table now reads "`member` or `facilitator` grant paths" with no numbering, and tasks.md 4.5 reads the same way — no numbering. Both fixes are real and correct.

But the delta spec's own requirement table — the document design.md and tasks.md both cite as the source of truth they're being corrected *to match* — still has the "(Path 1 or Path 2...)" parenthetical sitting right there, unfixed, in the same sentence design.md quotes approvingly as "already correct." The "i.e." clause that follows makes the operative rule unambiguous (`member` or `facilitator`, admin rejected), so no implementer following tasks.md 4.5 will build the wrong thing — this is not a functional gap. But it's exactly the kind of loose end my own success criteria exist to catch: a future reader reconciling spec.md against design.md's own discussion of "Path 3 = facilitator" will hit a sentence in the spec that uses a numbering design.md itself says is wrong, sourced from a table design.md says was fixed. That's a paper cut, not a wound, but it's cheap to fix and I'd rather it not be the thing someone emails me about in three months.

**Recommendation:** drop the "(Path 1 or Path 2...)" parenthetical from spec.md's `topic_history_update` row entirely (matching how design.md's own table now reads), keeping only the `grant.path === 'member' or grant.path === 'facilitator'` clause. One-line edit, no task needed to justify it — I'd just ask whoever owns the spec file to make it before this change is finalized, or add it as a one-line addendum to Group 10 (10.1/10.2) since that's already where spec text gets touched.

---

## 3. `session_state_change` has no dedicated spec scenario — an asymmetry worth naming, not fixing in tasks.md

The delivery-time authorization requirement names four events in its table and gives three of them a dedicated `#### Scenario:` block: `vote_readiness_update`, `vote_revealed`, and `topic_history_update` (twice, counting the admin-rejection scenario). `session_state_change` gets a row in the requirements table and a check to reuse (D3: "Active participant OR active facilitator") but no scenario of its own anywhere in the delta spec.

This is not a tasks.md problem — if anything it's the opposite. Tasks.md actually gives `session_state_change` **more** dedicated test coverage than the other three events get individually: task 4.3 (implementation), 5.1 (general authorized/unauthorized matrix, one instance per event), and 5.5 (the specific role-change-mid-connection scenario: participant → engineering_manager, testing that both `session_state_change` and `vote_readiness_update` stop delivering on the next push). Task 7.3/7.5 also cover its audit-logging side. So an implementer working from tasks.md alone would build and verify this event correctly regardless of the spec gap.

The reason I'm still flagging it: at review time, if anyone goes looking for "where does the spec say what `session_state_change`'s acceptance scenario is," the answer is "nowhere — go read the requirements table and infer it from the pattern the other three scenarios establish." That's a small ambiguity risk for a document meant to be the traceable source, especially since this event participates in the reveal-adjacent state machine the ritual cares about (lobby advance, session close). I'd add one scenario to the delta spec mirroring the `vote_readiness_update` scenario's shape — "WHEN a facilitator advances the session's status... THEN the server evaluates whether each connected subscriber is an active participant or the active facilitator... AND the event is delivered only to..." — largely restating what task 4.3/5.1/5.5 already build and test. This closes the documentation gap without changing any task's scope.

---

## 4. Rachel Okonkwo's staleness-signal hard gate — confirmed present and unweakened

I checked this specifically because it's the one condition from Propose stage most likely to erode quietly across two more review rounds that didn't originate it. It didn't erode.

Task 9.3 in tasks.md:

> **Gate — before any real pilot team's first live session (added per Executive review, Rachel Okonkwo):** the generic client-facing staleness signal from 9.1... MUST be implemented and shipped. This is a hard gate with the same teeth as Group 8's 8.4, not a soft "named for Design" hand-off that can slip past launch. The WebSocket delivery-time authorization work itself MAY go live in a non-pilot environment before this gate is satisfied; no real team runs a live session until it is.

This is worded as a hard, binary blocking condition — "MUST be implemented and shipped," an explicit "not a soft hand-off" disclaimer, and an explicit carve-out clarifying that the underlying WebSocket work *can* ship elsewhere but a pilot session specifically cannot proceed without it. I traced this backward through both subsequent review rounds:

- **Design-stage review disposition** (design.md, both the engineer's and the security analyst's findings): neither review touches Group 9 or task 9.3 at all. Marcus Oyelaran's five findings are all backend-mechanics (Redis connection modes, transaction patterns, `.send()` behavior, the topic_history_update table drift, the TODO convention). Tomás Ferreira's five findings are audit logging, the idle-window bound, and Redis hardening. Nobody touched the staleness gate, for better or worse — it simply wasn't in scope for either reviewer's expertise, and nothing about it needed correcting.
- Proposal.md's own "What Changes" section restates the same condition in the same terms: "this proposal and its design intentionally do not specify client-visible UX... **this deliverable is a hard gate, not a soft hand-off**."

So the gate is intact, unsoftened, and identically worded across all three stages since Rachel raised it. One adjacent observation, not a finding against 9.3 itself: task 9.1, the task that actually produces the deliverable 9.3 gates on, is phrased as "file a Design-stage deliverable... covering: [four bullet points]" — a filing action, not a shipped-and-verified one. That's fine as far as it goes (9.3 is the actual gate, and it correctly demands the signal be "implemented and shipped," not merely "filed"), but I'd want whoever runs Tasks to notice that 9.1's own checkbox can be ticked (a doc gets filed) well before 9.3's much stronger bar is met, and not let 9.1's completion read as if it satisfies 9.3. This is an acceptance-criteria clarity note, covered further in Section 5.

---

## 5. Acceptance criteria: where "done" is explicit, and the one place it's softer than it should be

Most of tasks.md is written the way I'd want a task written — specific tables, specific column names, specific file line numbers, explicit blocked/unblocked framing per task rather than a blanket disclaimer at the top of the group. Task 5.6 is a good example of the standard: it names the exact scenario, names what's buildable today versus blocked on #26, and cross-references the exact regression it exists to catch (task 5.9). Task 8.2's "name a target quarter/milestone, not merely an owner" is exactly the kind of tightening that prevents a "tracked" checkbox from quietly becoming "tracked, then forgotten" — and I recognize my own Propose-stage ask reflected back in that wording.

Two places where I'd tighten "done" before calling this ready to hand to an implementer:

1. **Task 9.1** ("File a Design-stage deliverable... covering: what a participant/facilitator sees on delivery-time cessation, what a participant sees on a rejected subscription attempt, whether the two are visually distinguishable from ordinary network flakiness, and what the facilitator's readiness grid shows to distinguish 'stale' from 'accurate'"). The four bullet points are precise about *content*, but the task's own completion condition is just "file" — there's no acceptance criterion distinguishing "Priya filed a one-paragraph placeholder" from "Priya filed a deliverable that actually resolves all four bullets." Given that 9.3's gate explicitly depends on the *signal that comes out of* 9.1, and given how much weight this document places on 9.3 not slipping, I'd add one clause to 9.1: something like "reviewed and accepted by [Priya's counterpart or the Facilitator SME sign-off convention already used elsewhere in this project] before 9.3 can be considered satisfied." Small addition, but it closes the gap between "a document exists" and "a document that actually lets 9.3 be verified."

2. **Task 0.3** ("Confirm which of this change's tasks are buildable and fully testable today versus blocked on issue #26 for true end-to-end completion") reads, as written, more like a description than a checkbox — the task text itself already states the answer ("As of this revision: `vote_readiness_update`... and `session_state_change`... are unaffected and fully buildable now... `vote_revealed`'s real trigger... and `topic_history_update`'s real trigger... are not"). That's fine as documentation, but if this is meant to be a task someone checks off, the acceptance criterion should be "this accounting has been re-verified against current code at implementation start, not merely copied from this document" — otherwise it's not a task, it's a paragraph with a checkbox glued on. I'd reword it slightly to make the re-verification the explicit action, since the whole point of this group (per its own opening line) is catching drift between what the documents assume and what the code actually does — the same discipline this document credits me with introducing at Propose stage. It would be an odd place for that discipline to lapse into "restate what was already true instead of re-checking it."

Everything else I reviewed — Groups 1 through 8, 10, and 11 — states its acceptance condition explicitly enough that I don't expect a "what did you mean by this" conversation. The blocked/unblocked annotations throughout (1.4, 4.4, 4.5, 5.6, 7.2, 7.4, 11.1, 11.2) are a particular strength: every task that touches one of the three unimplemented state-transition writes says, in its own text, exactly what can be built and tested now versus what waits on issue #26 — which is precisely the kind of explicitness that prevents the "I built it against a stub and called it done" ambiguity I'd otherwise worry about on a change with a named blocking dependency this large.

---

## 6. Summary of recommended fixes

None of these block Tasks from proceeding. All three are cheap and I'd like them closed before this change archives:

1. **Delta spec, `topic_history_update` row:** drop the stale "(Path 1 or Path 2...)" parenthetical; keep only the `grant.path === 'member' or grant.path === 'facilitator'` clause, matching design.md's own already-corrected table. (Section 2)
2. **Delta spec:** add a dedicated `#### Scenario:` for `session_state_change`, mirroring the shape of the `vote_readiness_update` scenario. Tasks.md already builds and tests this correctly (4.3, 5.1, 5.5) — this is a documentation-completeness fix, not a behavior change. (Section 3)
3. **Task 9.1:** add an explicit sign-off/acceptance condition (not just "file") so 9.3's hard gate has something unambiguous to check against. **Task 0.3:** reword to make re-verification against current code the explicit action, not a restatement of this document's own accounting. (Section 5)

---

## 7. What I did not re-litigate

I did not reopen D1–D4's core architecture (transport, fan-out, check placement, serializer reuse) — both Design-stage reviewers signed off on these against actual code, and nothing in Tasks stage gives me a reason to revisit that. I did not re-check the D7 schema correction line-by-line against the migration file again — I did that at Propose stage, the correction is stable, and tasks 7.1–7.7 read as a faithful implementation of the corrected version. I did not second-guess the owner's call that the Blocking Dependency stays out of this change's scope — that was made explicitly, above my level, and Group 0's tasks implement that call faithfully rather than quietly re-absorbing the state-machine work.
