# Explore Review — Business Analyst (Marcus Delgado)

**Reviewing:** `exploration-notes.md` (Devon Calloway), GitHub issue #19 / archived task 11.10
**Verified against:** archived `enforce-access-control-on-team-content/tasks.md` (Groups 0, 9, 10, 11), archived `websocket-delivery-time-authorization/tasks.md` (Group 0, tasks 4.4/4.5/9.3/11.1/11.2), archived `websocket-staleness-signal/tasks.md` (Group 5.3, Group 6), `openspec/specs/team-content-access/spec.md`, `openspec/specs/websocket-session-authorization/spec.md`, GitHub issue #19 text.

## Bottom line

The frontend inventory and the sign-off-mistaken-identity finding are both correct and well-sourced — I checked the primary documents myself rather than taking the notes' word for it, and they hold up. The piece-1/piece-2 split is the right shape and mirrors precedent this project has already established (`websocket-staleness-signal` Group 6). It is close to buildable but not there yet: one factual claim about the issue #26 dependency needs correcting before it goes into a proposal, and several places that read as decided are actually still open questions wearing decided language. I'd send this back for one more pass, not because the thinking is wrong, but because a couple of the load-bearing claims are more specific than the evidence supports, and a proposal built on them would need to be re-scoped mid-flight.

---

## 1. Correction needed: Error State 3 is not blocked by issue #26 the way Error State 1 is

This is the one place I think the notes get a verifiable fact wrong, and it changes the shape of piece 1.

Section 4 groups Error States 1 and 3 together as sitting "right on top of" the issue #26 gap, and Section 6's piece-1 description proposes the same treatment for both: HTTP authorization/state-check paths plus "a real WebSocket subscriber asserting the correct payload arrives... for a directly-invoked or manually-published event."

I traced the actual event mapping:

- Error State 3's trigger, per `spec.md` line 390, is explicitly "system timeout, accidental state advance, WebSocket connection drop" — and per `websocket-session-authorization/spec.md` line 26, the event it rides is `session_state_change`, "pushed... when session status transitions."
- `websocket-delivery-time-authorization`'s Group 0, task 0.3, states plainly: "`session_state_change` for lobby-advance/session-close are unaffected and fully buildable now." Only `vote_revealed` (reveal) and `topic_history_update` (topic-advance/action-item-finalization) are named as blocked on #26.
- Lobby-advance and session-complete are real endpoints that commit real writes today (task 1.4 of that same change confirms the publisher is wired into "vote lock-in, lobby advance, session close" — not stubbed, not deferred).

That means the "accidental state advance" trigger variant for Error State 3 has a real, already-committing production trigger available right now. A piece-1 test can call the actual lobby-advance or session-complete endpoint while a subscriber is attached and assert the real `session_state_change` push — no directly-invoked or manually-published stand-in required, and no re-run-later commitment needed once #26 lands. That's a stronger and simpler test than what's proposed, and it belongs in piece 1's Error-State-3 acceptance criteria as the primary case, not the fallback.

The "system timeout" trigger variant is genuinely not testable today — but that's because no timeout-driven auto-transition mechanism exists at all, which is a different, unnamed gap, not an issue-#26 consequence. If piece 1 doesn't test that variant, the proposal should say so explicitly and name why (no scheduled-transition mechanism exists), rather than letting it fall silently into the same "blocked on #26" bucket as the reveal path. Conflating the two would misdirect whoever eventually builds the timeout mechanism — they'd go look at issue #26 and find nothing relevant there.

**Action:** rewrite Section 6's piece-1 description to split Error States 1 and 3 apart instead of pairing them: State 1 keeps the "HTTP authorization/state-check paths now, full WS re-test after #26" treatment; State 3 gets full real-trigger, real-WS treatment now (same rigor as States 2 and 4), with a separately named, separately owned gap for the timeout-variant.

## 2. Section 7's open questions are proposal blockers, not follow-up questions

Section 7 lists three items as "what I'd want confirmed before this goes to Design." Two of them aren't confirmable in Design — they're inputs a proposal needs before its acceptance criteria can be written, and leaving them as post-hoc confirmations invites the proposal to get written twice:

- **CI infrastructure for piece 1** ("whether CI needs [docker compose Postgres/Redis] wired up for real for this issue to close"). `ws-pubsub-integration.test.ts` self-skips without live Redis/Postgres today. If piece 1's acceptance criteria say "runs against real DB/Redis," and CI can't actually run it, the task will land in the same state as that file — written, correct, and never verified in the pipeline that's supposed to gate merges. This needs a yes/no answer before piece 1 is scoped, not an open question inside it.
- **Re-run commitment on issue #26 landing.** Per my correction above, this narrows to Error State 1 only (and, separately, the topic-advance portion of whatever piece 2 eventually needs from `topic_history_update` for a fuller Error-State-2-adjacent scenario, if any — the notes don't claim one, and I don't see one in spec.md, so I'd leave that alone). State 3 doesn't need this commitment at all under my correction. State this precisely rather than bundling "1 and 3."

The Priya-owner question (bullet 1) is legitimately a Design-stage question — that one I'd leave as-is.

## 3. Piece 1 / piece 2 split: specific enough to scope, with three gaps to close first

The split itself is sound and I'd approve the shape of it. Three things need to be nailed down before it's specific enough to become two proposals' acceptance criteria:

**a. Per-state acceptance conditions, not a paragraph.** Section 6's piece-1 description is currently one dense paragraph covering four states. A proposal needs this as four (or five, counting 1a/1b from spec.md, which the notes don't mention at all — see item 4 below) discrete acceptance conditions, each naming: the endpoint or event under test, the fixture/trigger mechanism (real call vs. manual publish, per my correction), the real infra required (DB, Redis), and the specific string or status code asserted. Right now the level of specificity Devon reached for Error State 4 ("does not leak Team A's ID, name, or existence") is exactly right — I'd hold every state to that bar, not just the one Devon happened to detail most.

**b. Task 11.10's disposition needs a named mechanism, not "split it explicitly."** See Section 4 below — this is specific enough as a principle but not as an instruction.

**c. Piece 2's UI work needs to inherit the Group 6 gate *structure*, named explicitly, not just its spirit.** The notes say piece 2 "would need... a real Priya sign-off," which is correct but under-specified next to the precedent it's citing. `websocket-staleness-signal` Group 6 didn't ship one sign-off gate — it shipped four (6.1 copy sign-off, 6.2 visual-register mock sign-off, 6.3 live usability test, 6.4 hard pre-pilot gate blocking on all three), plus an explicit "may ship to non-pilot/staging before the gate closes" carve-out. If piece 2's proposal is scoped as "build UI, get sign-off" without naming that four-gate shape up front, whoever writes piece 2's tasks.md either reinvents it from scratch or — worse — ships a single "get sign-off" checkbox that's easier to wave through than the precedent it's supposed to match. Given Section 4's own argument about gates quietly eroding, I'd make this explicit in the piece-2 scoping rather than trusting it to get reconstructed faithfully later.

## 4. Task 11.10 disposition: needs a precise mechanism, and I have a recommendation

Devon's instinct — don't mark 11.10 complete under piece 1 alone — is correct and I'd defend it strongly; a green checkmark that outruns what shipped is exactly the failure mode I'd flag even without Devon naming it first. But "split it explicitly in the archive, or leave it open with a clear note" gives the implementer two options without saying which, and neither is described precisely enough to execute against.

Concretely, I'd recommend the **explicit split**, for traceability reasons that sit squarely in my own concerns: a single checkbox that stays unchecked for two proposals in sequence makes it harder to trace "which change closed what" later, which is exactly the kind of scope-dispute risk I care about closing off before it happens. Proposed mechanism, consistent with this project's existing annotation convention (Group 9's "RESOLVED by," 11.10's own current "PARTIALLY UNBLOCKED by" annotation):

- Piece 1's change adds an annotation to archived task 11.10 (not a new checkbox — the archive convention here has been to annotate the existing line, see 11.10's current text) stating specifically: which states/scenarios now have real full-stack coverage (2, 4, and 3's real-trigger case per my correction above, plus 1's HTTP-only paths), what infra it runs against, and that the task remains unchecked pending piece 2.
- Piece 2's change is the only one that checks the box, because it's the only one that delivers the literal "through... UI response" scope the task text names. Its tasks.md should say so explicitly (a one-line task: "check archived task 11.10 upon this change's own E2E test passing — no earlier change may check it").

If the team prefers literal `11.10a`/`11.10b` sub-items instead, that's a reasonable alternative, but it's a real precedent decision (this project hasn't split a checkbox that way yet, only annotated it) and shouldn't be decided inside an exploration document — it needs one line of explicit sign-off from whoever owns the archive convention before piece 1's tasks.md is written either way.

## 5. Gap the notes name but don't assign: the missing facilitator-role client-side check

Section 5 flags the deferred `App.tsx` comment (no client-side facilitator-role check on `/session/:sessionId/facilitator`, "harmless today only because the component renders stub data") and says "whoever picks this up should treat that comment as a checklist item, not background noise." That's correct, but it's addressed to nobody. Piece 1 introduces no new frontend surface, so it can't be piece 1's job. It has to be piece 2's, because piece 2 is exactly the change that stops the component from rendering stub data and starts it rendering real facilitator-only content (historical data, reveal state) — which is the precise moment this gap stops being harmless. I'd add this as a named, numbered acceptance condition in piece 2's scope, not leave it as an aside for "whoever." Given how central the facilitator/participant boundary is to this application generally, I'd want this treated as a hard gate on piece 2, not a nice-to-have cleanup item.

## 6. Not mentioned at all: Error States 1a and 1b

`spec.md` names two additional named states under the same "Live session error states" requirement that Group 10's task list and this exploration don't reference anywhere: **1a** (reveal attempted on an already-revealed topic — must render indistinguishably from success) and **1b** (topic-advance attempted before reveal — must offer the reveal action directly via `requiresReveal: true`). I don't know whether issue #19's scope was always meant to be "the four Group-10 states" specifically (task 11.10's own text says "four," so this may be intentional and out of scope by design), or whether 1a/1b were added to spec.md after Group 10 was written and simply never got their own E2E task. Either is plausible from what I can see. This isn't a blocker, but it's a specific gap I'd want one line of confirmation on before piece 1's proposal locks its scope to "four states" — otherwise it's the kind of edge case that surfaces during piece 1's implementation and becomes exactly the scope dispute I'd rather avoid by asking now.

## Summary of what needs tightening before this becomes two proposals

1. Correct the issue-#26 characterization for Error State 3 (Section 1 above) — this changes piece 1's actual test design, not just its wording.
2. Turn Section 7's CI-infrastructure question into a decision made before piece 1 is scoped, not an open question inside it.
3. Write four (or six, pending item 6) discrete per-state acceptance conditions for piece 1, at the specificity level Devon already reached for Error State 4.
4. Name the four-gate structure (copy sign-off / visual mock / usability test / pre-pilot hard gate) explicitly in piece 2's scope, not just "gets sign-off."
5. Pick one mechanism for task 11.10 (I recommend the explicit annotate-now/check-later split in Section 4) and write it as an instruction, not an either/or.
6. Assign the `App.tsx` facilitator-role-check gap to piece 2 explicitly, as a named hard-gate acceptance condition.
7. Get one line confirming whether Error States 1a/1b are in scope for either piece or deliberately excluded.

None of this contradicts Devon's read of the situation — I think the read is right. It needs one more pass to convert "I'd want confirmed" and "should be split explicitly" into the kind of acceptance conditions the implementation team can build against without coming back to ask what was meant.
