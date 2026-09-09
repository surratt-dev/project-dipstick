# BA Review: session-lifecycle-transitions Proposal

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewed:** proposal.md, design.md, tasks.md, specs/session-topic-lifecycle/spec.md, specs/team-content-access/spec.md
**Cross-checked against:** BRD.md (FR-3, FR-4.6/4.6.1/4.7, FR-6.1, FR-8.2/8.3), REST API Contract.md (SESSION-004/005/006, VOTE-003, Appendix D)

## Overall

This is buildable. The delta spec's Given/When/Then scenarios for SESSION-004, SESSION-005, reveal, and SESSION-012 are explicit enough that I would not expect an implementer to come back and ask what a scenario means — that's the bar I hold this to, and it clears it for the state-machine mechanics themselves. The two places I'd stop this from moving forward as-is are below: one is a genuine spec gap (SESSION-012's success response isn't designed anywhere), and one is a factual imprecision in the topic-skip rationale that will mislead a facilitator reading the eventual documentation. Everything else is a request for exact text rather than a substantive objection.

## Blocking

### 1. SESSION-012's success response shape does not exist anywhere in this proposal

The reviewer's question was whether the two client-visible outcomes of `SESSION-012` (advanced to next topic vs. entered `wrap_up`) are distinguishable enough in the response shape to be traceable. I can't answer that, because **there is no response shape** — for either branch.

Design.md's Decision D3 gives exact TypeScript for both 409 error states (`RevealAlreadyRevealedResponse`, `TopicAdvanceBlockedResponse`). Decision D4 gives exact SQL for both success branches. But nowhere — not in design.md, not in the spec delta, not in tasks.md — is there a `200 OK` response interface for `SESSION-012`. Compare this to `SESSION-004`/`SESSION-005` above it in the same contract, which both have a full `interface ...Response` block (`StartSessionResponse`, `BeginVotingResponse`) already documented. `SESSION-012` gets no equivalent treatment anywhere upstream of the contract document itself.

Task 6.1 then asks the contract-writing step to produce "response shapes for both branches" as if that's a transcription task. It isn't — nothing has designed what a topic-advance response contains (does it echo the new topic like `BeginVotingResponse.currentTopic` does? does the wrap-up branch return anything beyond `status: 'wrap_up'`?). This is design work, not documentation work, and it's currently unassigned to any task or decision.

**What I need:** a Decision D4a (or an extension to D4) in design.md giving the exact success-response interface for both `SESSION-012` branches, with the same precision given to the 409 shapes. Until that exists, task 6.1 can't be executed as written — whoever picks it up will be inventing a response shape at documentation time, which is exactly the kind of undocumented decision this proposal is otherwise careful to avoid.

### 2. The topic-skip rationale cites the wrong point in time — "before the session starts" is not when the topic list is locked in

Proposal.md's Topic-Skip Decision says: "A topic that no longer applies to a team must be removed from the topic list before the session starts, per FR-8.2." Design.md and the spec delta (`Mid-session topic-skipping is not supported`) repeat this framing without adding precision.

FR-8.2 itself says nothing about timing relative to "session start" — it just says the facilitator/admin can add/remove/reorder topics for a team after its first session. The actual timing constraint comes from `SESSION-001`'s own notes in the REST API Contract (line ~1019): topic list snapshotting into `session_topics` happens **at session creation**, not at session start. `SESSION-004` (session start, lobby → pre_session) happens after a session already exists and its topics are already snapshotted. The contract is explicit that "after archiving, the topic no longer appears in **future session snapshots**" (line 785) — meaning a topic edit made after a session is created has zero effect on that session, even if the session is still sitting in `lobby` and hasn't been "started" yet by any definition a facilitator would recognize.

Concretely: a facilitator creates a session Monday (lobby), realizes Wednesday — before clicking "start" — that a topic is stale, and edits the team's topic list per FR-8.2. Under the proposal's stated rationale ("before the session starts"), this looks like it should work. It won't — the session was already created Monday, its `session_topics` rows already exist, and the edit only affects *future* session creations. The topic-skip decision's own escape hatch doesn't actually cover the timing window it implies it covers.

This isn't a reason to reverse the topic-skip decision — ruling out mid-session skip is still the right scope call, and I agree with the reasoning that a real skip path is new authorization surface this change doesn't have room for. But the stated workaround needs to say "before the session is **created**" (i.e., before `SESSION-001`), not "before the session starts." As written, it will produce confused facilitators and, eventually, a bug report that reads like a topic-skip feature request when it's actually a documentation-precision issue.

**What I need:** proposal.md's Topic-Skip Decision and the spec delta's "Mid-session topic-skipping is not supported" requirement text corrected to reference session-creation time, with a one-line pointer to `SESSION-001`'s snapshotting behavior as the mechanism. This is a text fix, not a design fix — small, but I want it in tasks.md as an explicit sub-step (e.g., under Group 6) so it doesn't get silently dropped along with the Appendix D corrections.

## Non-blocking — needs exact text before an implementer touches Appendix D

Task 6.2 says: "Rewrite Appendix D's `reveal.trigger` and `topic.advance` rows to describe the actual architecture... Narrow the rationale column so it no longer implies the trigger transport itself is the integrity mechanism." That's a description of the *goal* of the edit, not the edit. Every other task in this document that touches code gives exact SQL, exact TypeScript, or an exact audit `operation` string. This is the one place where "rewrite to describe the actual architecture" is left to the implementer's judgment on a document Marcus considers load-bearing for traceability (BRD 6.1 is cited directly in Appendix D's current, soon-to-be-wrong text).

I'd also flag that Appendix D's rows are currently keyed to WebSocket message names (`reveal.trigger`, `topic.advance`) that don't exist anywhere in the actual `WsEventType` union this codebase implements (`vote_revealed`, `topic_history_update`, `session_state_change`, etc., per design.md's own references). The correction isn't just re-wording the rationale column — it's replacing the row's *key* with the real REST endpoint IDs (`SESSION-004`/`005`/`012`, the reveal endpoint) and the real WS event names. Task 6.2 doesn't say this explicitly, though it's implied by "describe the actual architecture."

**What I need:** either exact before/after row text in tasks.md, or an explicit instruction that the row's leftmost column changes from a WebSocket-message name to a REST-endpoint-ID + WS-event-name pair. Low effort, but I don't want this left to whoever's typing at the time — Appendix D is the document a future BA or engineer will trust at face value.

**Same finding applies to `SESSION-005`'s own contract entry, which task 6.2 doesn't mention:** `SESSION-005`'s current "Description" and "Notes" (REST API Contract lines 1268, 1316) say it "triggers the WebSocket `topic.advanced` broadcast" — the same stale pre-architecture event name Appendix D uses, not `publishSessionStateChange` (what design.md Decision D1 actually specifies `SESSION-005` calls). This is the same category of error as the Appendix D rows, in the same document, and it's currently untouched by any task. Add it to task 6.2 or give it its own sub-task.

## Confirms — things I checked that hold up

- **The `already_revealed` and `advance_blocked` 409s are correctly identified as new contract additions, not "already implied."** I confirmed no endpoint ID exists for the reveal trigger anywhere in the contract's endpoint list (VOTE-003's note only says reveal happens "via WebSocket," it doesn't assign an ID or a response shape to it) and confirmed `SESSION-012` has no entry at all. Task 6.1 correctly scopes adding a new contract entry rather than treating this as a documentation touch-up. Good.
- **The action-item-finalization out-of-scope claim checks out.** I verified directly: no `finalized`/`finalized_at` column exists on `action_items`, and `SESSION-006` (session-complete) is already in production. The proposal's framing that finalization is a read-time join, not a new write, is accurate and correctly scoped out.
- **The audit event claims in proposal.md and design.md are accurate.** `session.reveal_triggered`, `session.state_changed`, `session.vote_submitted` already exist in `audit-logger.ts`'s `AuditEventName` union exactly as described; `session.topic_advanced` does not yet exist and is correctly scoped as new.
- **The membership-removal and issue #23 boundaries are stated precisely enough.** Both cite specific ownership (admin/EM roster management vs. facilitator session control) and a specific blocking dependency (issue #23). A future reader isn't going to accidentally assume this change covers either — the Out of Scope section is more precise here than most proposals I review, including naming the specific unaffected code paths (`evaluateSessionSubscriberAccess`, the lock-in handler) rather than just asserting "not affected."
- **FR-3.5's pass-through requirement is correctly implemented as a spec scenario**, not just narrative — "Facilitator with no open action items can proceed immediately" is a real Given/When/Then, not left implicit.

## Summary

Two blockers: design the `SESSION-012` success response (both branches), and fix the topic-skip rationale's timing claim to reference session creation, not session start. One text-precision request: exact before/after language for the Appendix D rewrite and the SESSION-005 contract entry, both of which currently point at a WebSocket event name (`topic.advanced`) that doesn't exist in the real implementation. Everything else — the state machine itself, the precondition semantics, the audit/publish wiring, the out-of-scope boundaries — is specific enough to build from without coming back to me.
