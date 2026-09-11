# Propose Review — Business Analyst (Marcus Delgado)

**Reviewing:** `proposal.md`, `design.md`, `tasks.md`, `specs/team-content-access/spec.md` (this change's delta)
**Verified against:** `openspec/specs/team-content-access/spec.md` (main synced spec), `openspec/changes/archive/2026-07-07-enforce-access-control-on-team-content/tasks.md`, `exploration-notes.md` (including my own prior explore-stage review, `explore-review-ba.md`)

## Bottom line

The seven items I raised at explore stage all landed correctly — I checked each one against the actual proposal text rather than trusting the "adopted" claim in the exploration notes' disposition section, and it holds up: task 11.10's mechanism is precise and matches what I asked for, the piece-1/piece-2 split is intact, and 1a/1b are in scope with the right backend-contract framing. That's the good news. But this pass surfaced one real defect that wasn't present at explore stage: **the spec delta adds two new scenarios that the proposal's own "no scenario changes" claim says don't exist.** That's not a wording nitpick — it's a proposal whose stated scope and actual diff disagree, which is exactly the kind of drift that turns into a scope dispute later. I'd send this back for one correction before sign-off. Two smaller tightening items below it.

---

## 1. Defect: the spec delta contradicts the proposal's own "no scenario changes" claim

`proposal.md` states this twice, unambiguously:

- Line 19 (What Changes): "Add an implementation note to `team-content-access/spec.md`'s... requirement... **No required display text, MUST/MUST NOT behavior, or scenario changes.**"
- Line 29 (Modified Capabilities): "`team-content-access`: **No requirement text, display behavior, or scenario changes.** Adds an implementation note..."

`design.md` D6 agrees: "The archive annotation and **the spec implementation note** are hand-written prose edits" — singular, an implementation note, nothing else. `tasks.md` 6.1 agrees too: "adjust **the implementation note** if the final test set differs" — again, only the implementation note is described as changing.

But `specs/team-content-access/spec.md` in this change directory (lines 75–84) adds two scenarios that do not exist in the main synced spec (I checked — I grepped every `#### Scenario:` heading in `openspec/specs/team-content-access/spec.md` and neither title appears there):

- "Reveal failure states are proven against real Postgres, not a mocked query layer"
- "Session status transition is proven through its real production trigger, full stack"

These aren't cosmetic. They're net-new scenario blocks under a requirement whose delta header is `## MODIFIED Requirements` — meaning, per this project's own OpenSpec convention, they will merge into the main spec on archive/sync as permanent requirement content, not as a one-line implementation note.

Two problems with this, not one:

**a. It contradicts what three other documents in this same change say is happening.** A reviewer or future implementer who reads `proposal.md`'s Impact section ("Specs: ...one implementation note added; no requirement or scenario text changes") and then diffs the actual spec file will find that claim is false. That's the traceability failure I care about most — the documents are supposed to be the thing people trust instead of re-deriving intent from a diff.

**b. Scenarios describe product behavior, not test methodology, and these two don't.** Every other scenario under this requirement (and everywhere else in `spec.md`) is a WHEN/THEN statement about what the *facilitator observes*. These two are WHEN/THEN statements about *what infrastructure the test runs against* — "called against a real database with a fixture engineered to fail authorization," "a real WebSocket subscriber connected... not a directly-invoked or manually-published stand-in." That's implementation-note material (which is exactly where this same information already correctly lives, at line 7 of the delta), not a durable product requirement. If these two scenarios survive to archive, the spec will contain a permanent scenario whose "THEN" is about mock-vs-real infrastructure — which will read as bizarre to anyone consulting this spec two years from now with no memory of this change's test-layering problem.

**Recommendation:** delete both scenarios from the spec delta. The implementation note at line 7 already says everything these two scenarios say, more precisely and in the right register. If the team wants the real-Postgres/real-Redis proof points captured as durable, traceable facts, that belongs in `tasks.md` (where Groups 2 and 4 already state it per-test) or stays in the implementation note — not as spec scenarios that outlive the note's context.

## 2. Design.md's timeout non-goal is missing the explicit issue-#26 disclaimer proposal.md has

This was the "trap" the exploration notes spent real effort naming precisely (Section 4: "I'd rather the gate go unresolved... than get quietly waved through" — same instinct, different topic, but the document is clear that precision on this exact point matters). `proposal.md` gets it right:

> "this is a separate, unbuilt mechanism, **not a consequence of issue #26** or anything this change resolves."

`design.md`'s Non-Goals section, covering the identical point, drops the clause:

> "No timeout-driven auto-transition mechanism exists in this codebase; there is nothing to trigger."

True as far as it goes, but it doesn't rule out the misreading it's supposed to prevent. `tasks.md` 4.4 inherits the same gap — the in-code comment it specifies ("naming Error State 3's 'system timeout' trigger variant as explicitly out of scope, with the reason...") doesn't carry the "not a consequence of #26" clause into the actual test file either.

This matters more for `design.md` and `tasks.md` than it does for `proposal.md`, not less — an engineer picking up Group 4's tasks is going to be reading `design.md` and the in-code comment, not necessarily `proposal.md`'s Why section. If the whole point of naming this explicitly was to stop a future reader from going to look at issue #26 and finding nothing relevant, the document closest to that future reader's actual workflow is the one most in need of saying it out loud.

**Recommendation:** add the same clause to `design.md`'s Non-Goals bullet and to the task 4.4 code-comment instruction in `tasks.md`, so all three documents (and the eventual in-code comment) say the same thing rather than the strongest version living only in `proposal.md`.

## 3. Error State 2's fixture/trigger mechanism is still underspecified

At explore stage I asked for every state to be held to the specificity bar Devon reached for State 4: endpoint, trigger mechanism, infra, and the specific string/status asserted. Five of six states/sub-states in `tasks.md` clear that bar:

- 2.2/2.3 (reveal recoverable/non-recoverable) — exact fixture condition named ("fail the authorization check," "status is not in the active set")
- 2.4/2.5 (1a/1b) — exact fixture condition named (`status = 'revealed'`, `status = 'voting'`)
- 4.1–4.3 (State 3) — exact endpoint, exact branch ("wrap-up-entry branch fires"), exact both trigger paths
- 3.2/3.3 (State 4) — exact cross-team fixture, exact non-disclosure assertion

Task 3.1 (State 2) doesn't:

> "called during a fixture session with `status = 'active'`, against a condition that would otherwise deny access"

"A condition that would otherwise deny access" doesn't name what that condition is. Every other fixture in this document says exactly what's broken (which row, which field, which value). This one doesn't, and it's the only one that doesn't. To be fair, this ambiguity isn't new to this proposal stage — it was already present in `exploration-notes.md` Section 6 item 3 in the same vague form, and `spec.md`'s own Error State 2 trigger language ("an authorization check fails or the data endpoint returns an error") is itself non-specific about the mechanism. So this isn't a regression introduced by this proposal — but it's also never been resolved, and this is the last stage before implementation where resolving it is cheap.

**Recommendation:** before this goes to implementation, task 3.1 should name the actual fixture condition (e.g., a session/team membership row that doesn't match, matching the shape of 2.2's "facilitator row that doesn't match" pattern) — something concrete enough that whoever implements Group 3 isn't left inventing the mechanism themselves.

## 4. Confirmed correct: task 6.2 matches exploration notes' Section 6 disposition for task 11.10

This is the one item I want to affirmatively sign off on rather than just not-flag. Exploration notes Section 6 says, precisely: annotate the existing checkbox (not a new one), state which states/scenarios have real coverage, state the infra, state that the task stays unchecked pending piece 2 (issue #38) — and that only the change delivering the frontend rendering may check the box.

`tasks.md` 6.2 matches this exactly: it names the same six states/sub-states (1 both paths, 1a, 1b backend-contract, 2, 3 real-trigger case, 4), names the infra (real Postgres + real Redis via the `integration` CI workflow), states the task stays unchecked pending issue #38, and explicitly says "Do not check the box — per design.md D6 and the exploration notes, only the change that delivers the frontend rendering may check task 11.10." No softening, no drift. This is exactly the "instruction, not an either/or" I asked for at explore stage, and it's carried through faithfully.

## Everything else from my explore-stage review

Items 2 (CI decision made, not deferred), 5 (`App.tsx` facilitator-role check assigned to piece 2/issue #38, not this change), and 6 (1a/1b confirmed in scope, backend-contract-only, correctly following `spec.md`'s own framing) all check out in this proposal package and don't need further comment. Item 4's four-gate structure (copy sign-off / visual mock / usability test / pre-pilot hard gate) is piece 2's responsibility and correctly out of scope here — nothing in this proposal package should be carrying that, and nothing does.

## Summary of what needs fixing before this is ready

1. **Delete the two new scenarios from `specs/team-content-access/spec.md`** (lines 75–84 of the delta) — they contradict the proposal's own "no scenario changes" claim and describe test infrastructure, not product behavior. The implementation note already covers this content correctly.
2. **Add the "not a consequence of issue #26" clause** to `design.md`'s Non-Goals bullet and to `tasks.md` 4.4's code-comment instruction, matching `proposal.md`'s existing language, so the disclaimer that matters most is present in the documents engineers will actually be reading during implementation.
3. **Name the actual fixture condition for Error State 2** in `tasks.md` 3.1, at the same specificity level as 2.2–2.5 and 4.1–4.3.

None of this contradicts the shape of the proposal — piece 1's scope, the real-infra approach, and the task-11.10 disposition are all sound and ready to build against. Item 1 is the one I'd treat as a blocker; items 2 and 3 I'd want fixed before implementation starts but wouldn't hold up sign-off on their own.
