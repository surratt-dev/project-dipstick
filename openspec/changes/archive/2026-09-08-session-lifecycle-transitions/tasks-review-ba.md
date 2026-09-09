# BA Review — tasks.md (session-lifecycle-transitions)

**Reviewer:** Marcus Delgado, Senior BA
**Scope:** Does tasks.md fully cover proposal.md's capabilities? Is anything lost in translation from spec deltas / design.md into the task list?

## Verdict

Close, but not clean. The task list is unusually well-annotated with explicit design.md citations, which made this traceability pass easier than most — I could check almost every task against a specific Decision. Two things are missing, though, and both are the kind of gap that turns into a scope dispute three weeks from now if they stay silent: one is a build gap (a response type that's fully designed but never gets a task to actually create it), the other is a tracking gap (a follow-on we explicitly agreed to defer, but only one of the two deferred items got the "file it so it doesn't evaporate" treatment).

---

## Finding 1 (Blocking): `TopicAdvanceResponse` has no task that creates it as a shared type

Design.md Decision D4a fully specifies `TopicAdvanceResponse` as a new TypeScript interface — same treatment as `StartSessionResponse` and `BeginVotingResponse` get in Decision D1. Those two got their own dedicated tasks:

- Task 1.4: "Add `StartSessionResponse` to `packages/shared/src/types/session.ts` ... export it from `packages/shared/src/index.ts` ... and return it from 1.1/1.2's handler."
- Task 1.7: same treatment for `BeginVotingResponse`.
- Task 3.6: same treatment for the two new `team-content-access.ts` error variants (`RevealAlreadyRevealedResponse`, `TopicAdvanceBlockedResponse`).

Group 4 has no equivalent. Tasks 4.5 and 4.6 both say "return a `TopicAdvanceResponse`" as though the type already exists in `packages/shared/src/types/session.ts` — it doesn't; D4a is explicit that this change is what creates it, following the same convention D1 establishes. Nothing in tasks.md instructs anyone to actually write the interface or export it from `packages/shared/src/index.ts`.

This is exactly the "requirement that's accurate but ambiguous" trap I try hardest to keep out of things I sign off on. An implementer working strictly off tasks.md, in isolation from design.md, will hit task 4.5, need a type that isn't there, and either invent field names on the spot (drifting from D4a's already-settled shape) or go back to design.md and reconstruct the missing task themselves. Either way, that's a "what did you mean by this" trip back to the document that a dedicated task would have prevented.

**Recommend:** insert a task between 4.1 and 4.5 (parallel to 1.4/1.7/3.6):
> Add `TopicAdvanceResponse` to `packages/shared/src/types/session.ts` (design.md Decision D4a's exact field list), export it from `packages/shared/src/index.ts`. `currentTopic.sessionTopicId` is `nextSessionTopicId`, never `nextTopicId` — mirrors the 1.7/4.5 id-space rule.

## Finding 2 (Should-fix): the topic-skip caveat's named follow-on isn't tracked anywhere in tasks.md

Proposal.md names two pieces of deferred, out-of-scope work:

1. Team membership removal — **tracked**: task 7.4 explicitly files it as its own OpenSpec change stub, with an owner (me) and a reference to the dependency on issue #23.
2. The topic-skip / creation-time topic-list-signal follow-on — the one Devon's caveat in the "Topic-Skip Decision" section surfaces (a facilitator who creates a session early gets no signal that a later topic-list edit silently didn't take), bundled in the proposal with Priya's facilitator-initiated-skip scenario, explicitly called "a candidate for a future, narrowly-scoped follow-on change, not silently dropped."

Item 2 has no equivalent to task 7.4. Task 6.6 is the only task that touches this territory, and it only confirms that the *wording correction* ("before the session is created," not "before it starts") survives into the synced spec — it says nothing about filing or otherwise tracking the follow-on work itself. Nothing in Group 7 files a stub for it the way 7.4 does for membership removal.

I raised this exact caveat during propose-stage review and Devon's response (preserved in the proposal) was that it's "worth naming plainly rather than smoothing over" and "deserves a named follow-on rather than getting fixed by a word change alone." That's precisely the outcome I don't want to see happen by accident: the caveat got the word-change fix (task 6.6), but not the named follow-on. If this doesn't get filed now, while the context for it is still fresh in this change, it's the kind of thing that quietly stops existing the moment this change archives — nobody re-reads an archived proposal's caveat paragraph looking for orphaned commitments.

**Recommend:** add a task alongside 7.4:
> 7.5 File the topic-skip / creation-time topic-list-confirmation follow-on as its own OpenSpec change stub, referencing this change's "Topic-Skip Decision" caveat (facilitators get no signal a post-creation topic-list edit didn't take) and Priya Nair's facilitator-initiated-skip scenario. Owner: Marcus Delgado (BA), per the same exploration-notes recommendation that names ownership for 7.4.

---

## What I checked and found clean

**Capability-by-capability traceability (proposal.md → tasks.md):**

| Proposal capability | Tasks | Verdict |
|---|---|---|
| SESSION-004 (lobby → pre_session) | 1.1–1.4, 1.8 | Covered, including empty-action-items pass-through (1.2) |
| SESSION-005 (pre_session → active, dual-table write) | 1.5–1.8 | Covered, including the id-space regression test (1.8) |
| Reveal write + `already_revealed` precondition | 3.1–3.9, 3.11 | Covered, including concurrent-reveal and auth-ordering tests |
| Vote lock-in / reveal race fix (prerequisite) | 2.1–2.4 | Covered, correctly sequenced ahead of Group 3 |
| SESSION-012, both branches, `advance_blocked` precondition | 4.1–4.13 (minus Finding 1) | Covered structurally; response-type gap noted above |
| Appendix D + `VOTE-003` + **SESSION-005's own entry** correction | 6.2, 6.3 | Covered — 6.2 explicitly calls out the SESSION-005 entry, not just Appendix D's two rows |
| Topic-skip decision (ruled out) + caveat wording | spec.md requirement, task 6.6 | Wording correction covered; follow-on tracking is Finding 2 |
| ~2xx response shapes (Start/BeginVoting/TopicAdvance) | 1.4, 1.7, (missing for TopicAdvance) | Two of three covered — Finding 1 |

**Out-of-scope boundary:** clean. No task in Groups 1–8 implements membership removal, touches `VOTE-004`'s reassignment authorization, or adds an `action_items` finalization write. Task 6.4 is a comment/issue-text correction only, explicitly scoped as "no code change" — consistent with the proposal's "not a separate deliverable" framing. Task 7.4 files the membership-removal stub without designing it. Good discipline here.

**Design-stage additions, checked as first-class tasks (not prose bolted onto design.md):**
- Shared types for D1 (1.4, 1.7) and D3 (3.6) — real tasks with acceptance conditions. ✓
- Task 4.1's team-id + facilitator-id cross-check — both checks named explicitly, not "facilitator only." ✓
- Tasks 3.11 / 4.10a (non-facilitator 409 must stay generic, never leak `already_revealed`/`advance_blocked`) — both present as their own integration tests. ✓
- Wrap-up branch's `completed_session_topic_id` audit fix — present in task 4.6's metadata, matching the topic-to-topic branch. ✓

**E2E loop-closing for issue #26:** confirmed. Task 3.10 re-runs the WebSocket change's blocked `vote_revealed` E2E task against this implementation; task 4.13 does the same for `topic_history_update`. Both are scoped as "confirm it now passes," not just "confirm the code path exists" — that's the actual closing of the loop issue #26 opened, not a restatement of it. Group 8's full run-through (8.1–8.3) is a broader regression pass and correctly doesn't duplicate 3.10/4.13.

## Minor note, non-blocking

Task 6.5 and task 7.3 both describe applying the same `websocket-session-authorization` Purpose-section correction — 6.5 says to do it "once Groups 3 and 4 are wired in" (a sequencing note inside the REST API Contract Corrections group), and 7.3 restates it inside Spec and Documentation Finalization. Not a coverage gap — the correction is named, not lost — but as written it reads like the same action appears twice under two different task IDs. Worth a one-line clarification on whether 7.3 is meant to be the actual execution point (with 6.5 stating the sequencing constraint that gates it) or whether one of the two is redundant. I'd rather flag this now than have someone do the edit twice, or skip it because they think the other task already covered it.
