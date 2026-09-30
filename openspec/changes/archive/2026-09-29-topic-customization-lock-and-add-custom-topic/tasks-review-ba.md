# Tasks Review — Business Analyst (Marcus Delgado)

**Change:** `topic-customization-lock-and-add-custom-topic`
**Reviewing:** `tasks.md` against `proposal.md`, `design.md` (post two-round incorporation), `specs/topic-customization-lock/spec.md`, `specs/add-custom-topic/spec.md`
**Question asked:** taken together, do the tasks cover every capability/requirement now stated, with nothing lost in translation across two rounds of review incorporation?

## Verdict

Close. This is an unusually well-cited task list — nearly every task quotes back to a specific design.md Decision number, which is exactly the kind of traceability I ask for, and it means most of my usual complaint ("where did this requirement go?") doesn't apply here. I found **one real gap** (a requirement narrowed in translation from design.md/spec into tasks.md), **two soft gaps** (spec scenarios with no explicitly named test task — likely covered incidentally, but not called out the way every sibling scenario is), and **one asymmetry** worth a decision, not necessarily a fix. All three "did the incorporation-pass decisions survive" checks the assignment asked about by number (11, 12, 13) came through — two of them (12, 13) are explicitly represented as confirmation tasks in Section 7, which is the right pattern; the one that isn't (Decision 7) is a defensible omission, explained below. The three-corrections documentation work is fully represented, including the fourth, lower-priority note the proposal was careful not to call a fourth correction.

---

## 1. Design.md's named incorporation-pass decisions (11, 12, 13) — the assignment's specific ask

**Decision 11 (deactivated teams not filtered by the write endpoint's existence check).** Fully reflected. Task 3.2 states the `SELECT id FROM teams WHERE id = $1` query "SHALL NOT filter on `deactivated_at`" and cites Decision 11 by number; Task 3.5 adds the negative test ("a standing, non-member facilitator against a *deactivated but existing* team is not rejected `404` for deactivation alone"). This matches the spec's own scenario ("A deactivated team is not treated as nonexistent") verbatim in intent.

**Decision 12 (read/write authorization asymmetry — accepted, not reconciled).** Fully reflected, and correctly implemented as a *documentation/confirmation* task rather than a code task, which is the right shape for an "accepted as-is" decision. Task 7.4: "Confirm `GET /api/v1/teams/:teamId/topics`'s authorization (`evaluateTeamAccess`) was not widened as part of this change... this is a stated decision (design.md Decision 12), not something to 'fix' opportunistically during implementation." This is exactly the kind of guardrail-against-well-meaning-scope-creep I want to see for an accepted trade-off — an engineer mid-implementation who notices the asymmetry and is tempted to "just fix it" is explicitly told not to, with the decision cited.

**Decision 13 (no rate limiter, no audit-write-failure handling change).** Reflected, but **narrower than the decision it traces to.** Task 7.3: "Confirm no rate limiter and no `withTimeout` guard were added to the `409` denial path or its audit write... this is a stated decision (design.md Decision 13)." Decision 13's actual text is broader — it says "Decision 8's (**and Decision 8's amendment's**) audit writes remain plain, unguarded... with no `withTimeout`" — i.e., it explicitly covers *both* the denial-path audit write (`topic.write_denied_locked`, Task 4.1) *and* the success-path audit write (`topic.custom_added`, Task 4.5/5.4). Task 7.3 only names the denial path. A literal reading of Task 7.3 would let someone add a `withTimeout` guard to the success-path audit write during implementation without technically violating what the task says to confirm — even though design.md Decision 13 already closed that door for both paths. Small fix: broaden Task 7.3 to say "...on the `409` denial path or the success path, or either's audit write."

## 2. Decisions not named in the assignment, checked anyway

**Decision 1–6, 8–10** all trace cleanly to tasks: 1→1.1, 6→1.2, 2→3.1-3.4/6.2/6.4, 3→3.1/6.3, 4→3.4, 5→5.1/2.5, 8→4.1-4.6, 9→3.1-3.7/5.2/5.3/5.4 (including the M2 addendum's instruction to reuse `facilitator-sessions.ts`'s `POST /draft` query verbatim, which Task 3.1 quotes almost word for word), 10→5.4/5.7 (the corrected advisory-lock SQL in Task 5.4 matches design.md's code block exactly, including writing the success-audit row inside the same transaction).

**Decision 7 (no real-time unlock push) has no corresponding Section 7 confirmation task**, unlike 12 and 13. I don't think this is a real gap: unlike 12/13, there's no code path in this change's Impact section (no frontend, no WebSocket layer touched at all) that an engineer could plausibly drift into building by accident, so there's nothing analogous to "don't opportunistically fix this" to guard against. Proposal.md's "Not changing: ... no frontend UI" already states it at the proposal level. I'd leave this one alone, but flag it so it isn't rediscovered as "the one design decision with no task-level trace" — now it's on the record that the omission was considered and is fine.

## 3. Timing-floor requirement — real gap

Design.md Decision 9's security-review (Finding 1) amendment states the timing floor applies "at every early-return path in the new `topics.ts` handler — the `403`... the `404`... the `409`... and the `422`..." and explicitly extends the test requirement: "Task 5.6's tests are extended with a timing-side-channel assertion... that the `403` path is not detectably faster than the `404`/`409`/`422` paths." The `add-custom-topic` spec's own "evaluates checks in a fixed order" requirement repeats this: "so that this ordering's status-code-level anti-enumeration guarantee is not reopened through response-latency differences... A status-code ordering alone is not sufficient for this requirement to be considered met."

Task 3.7 — the only task that actually instructs writing a timing-side-channel test — narrows this to: "asserting the `403` response is not detectably faster than the `404`/`409` responses." **The `422` comparison is missing.** This isn't pedantic: it's the exact three-way comparison design.md and the spec both state by name, and Task 5.6 (which implements/tests the `422` path) doesn't pick up the slack — it lists functional validation-failure tests, not a timing assertion. As written, an implementer could satisfy every literal task and still ship a `422` path that responds measurably faster than `403`/`404`/`409` without failing any test that tasks.md instructs writing, even though `topic-customization-lock`'s own capability spec was written specifically to prevent exactly that outcome.

Recommendation: extend Task 3.7 (or add a line to Task 5.6) to assert the `422` response is also not detectably faster than the `403`/`404`/`409` responses, matching design.md's three-way framing exactly.

## 4. Two spec scenarios with no explicitly named test task (likely incidental coverage, not called out)

Every other scenario in both spec deltas got an explicit, named test task somewhere in `tasks.md` (locked/unlocked flag, each 403/404/409/422 branch, duplicate prompts, deactivated team, concurrency, audit rows on both paths). Two scenarios did not get the same explicit treatment:

- **`add-custom-topic` spec, "Add Custom Topic is available regardless of which facilitator has run sessions for the team."** Task 5.6's list of endpoint tests doesn't name this scenario the way it names "403 for non-facilitator" or "409 for locked team." It's almost certainly satisfied incidentally by "valid creation" using a standing, non-member facilitator (which is the only kind of facilitator this authorization model recognizes), so I don't think anything is actually missing in the built behavior — but since this is the one scenario in the spec that exists specifically to make Decision 3's breadth ("no requirement that they have ever run a session for that team") testable and visible, I'd want it named explicitly rather than left to be "probably covered by the happy-path test."
- **`topic-customization-lock` spec, "Denied attempts against different endpoints all use the same audit operation... distinguished from each other only by their metadata."** This scenario is forward-looking (today there's exactly one topic-write endpoint), but it states a constraint on `metadata` shape that later `TOPIC-004`–`007` work will depend on. No task calls out asserting `metadata` (not `operation`) is what distinguishes endpoints. Not urgent for this change, but worth a one-line mention in Task 4.1 or 4.3 so the metadata-shape constraint doesn't get silently narrowed when the next topic-write endpoint is built against it.

Neither of these blocks sign-off; both are the kind of thing that's cheap to add now and mildly annoying to reconstruct later.

## 5. Three-corrections documentation work — fully represented

Proposal.md names three corrections plus one explicitly-not-a-fourth related note. All four have tasks:
- `name` field gap → Task 6.1
- REST API Contract's blanket-403 text → Task 6.2
- Precondition-text correction (standing facilitator model) → Task 6.3
- Alternate-flow "authorization error" wording (the related, lower-priority note) → Task 6.4

Task 6.3's wording ("Align the wording with 'View Active Topic Configuration''s existing... phrasing") matches design.md Decision 3's correction almost verbatim, including the specific sibling use case it points to. Nothing here was lost or merged incorrectly.

## 6. Capabilities and non-goals — correctly bounded

- No task exists for either Open Question (TEAM-002 lock exposure, `created_by` attribution column) or for the FR-8.2 Application Administrator traceability note — correct, since design.md explicitly defers all three rather than resolving them in this change.
- No task touches `default-topic-provisioning`'s spec — correct, per proposal.md's "Modified Capabilities (none)."
- No task adds remove/reorder/annotate/re-add endpoints, a schema migration, or frontend work — correct, all explicitly out of scope.

## Summary of actionable findings

1. **Real gap:** Task 3.7's timing-side-channel test omits the `422` comparison that design.md Decision 9's amendment and the `add-custom-topic` spec both explicitly require (403 vs. 404/409/**422**). Fix by extending Task 3.7 or adding a line to Task 5.6.
2. **Narrow confirmation task:** Task 7.3 traces to Decision 13 but only names the denial-path audit write; Decision 13's text explicitly covers the success-path audit write too. Broaden Task 7.3's wording.
3. **Soft gap (naming, not behavior):** the "available regardless of prior session history" scenario and the "endpoints distinguished by metadata, not operation name" scenario aren't named as explicit test tasks, unlike every sibling scenario. Low priority; cheap to add.
4. **No finding, but worth recording:** Decision 7 (no real-time unlock push) has no Section-7 confirmation task, unlike Decisions 12/13 — considered and judged not necessary, since this change touches no frontend/WebSocket code that could drift into violating it.

None of these are, in my judgment, blocking for implementation to begin — items 1 and 2 are small, precise edits to existing tasks, not missing tasks. I'd want 1 fixed before Section 3/5's tests are considered done, since it's a stated, reviewed security requirement with a concrete "how to verify" already written down in design.md that just didn't fully make it into the task text.
