# Executive Review — Rachel Okonkwo, VP Engineering

**Change:** `http-session-expiry-reauth-parity` (closes #146)
**Reviewer role:** Executive Stakeholder — strategic alignment and scope proportionality only. I'm not weighing in on the technical design; that's the implementation team's call.

## Verdict

**Approve.** Scope is proportional to the value at stake, and the `SessionCreationPage.tsx` / `MemberManagement.tsx` split is the right call. No changes requested.

## Strategic alignment

This is exactly the kind of work I want time spent on and don't want to have to ask for: a named, promised follow-up to a shipped change, closed on schedule, with the scope boundary re-justified rather than copy-pasted from the original ticket. When I approved `session-timeout-continuity`, part of what made deferring the HTTP-side half defensible was the explicit commitment to come back for it. A VP notices when "we'll file a follow-up" turns into a follow-up that never gets picked up — this one did, and that's worth more to me than the specific bug being fixed.

The underlying failure mode — a facilitator's session times out mid-click and the app tells them to "try again" forever, with no way out — sits squarely on the facilitator's critical path: starting a session, opening voting, advancing to the room, creating the session in the first place. Those are the actions my adoption story depends on. A facilitator hitting a dead end during their first few sessions is exactly the kind of paper cut that kills a champion's willingness to keep running the ritual for their team. Fixing it is reliability work in service of adoption, not a nice-to-have.

## Scope: `SessionCreationPage.tsx` in, `MemberManagement.tsx` out

This is the one judgment call in the proposal that wasn't handed to them pre-decided, and I think they got it right on both sides:

- **`SessionCreationPage.tsx` in scope is correct, not creep.** The proposal's test is the same one I'd apply: is this the same actor, same journey, same failure mode as the call site we're already committed to fixing? Yes — a facilitator picking a team and creating a draft session is the immediate predecessor step to opening the room in `DraftSessionHost.tsx`, which is already in scope. Shipping the fix on step two of a two-step flow and leaving step one broken would be a half-measure a facilitator would notice and be confused by. That's not scope creep, that's finishing the sentence.
- **`MemberManagement.tsx` and the EM pages deferred is also correct.** These are read-only, no facilitator-triggered POST, no "try again forever" dead end at stake — a stale roster or a stale trend chart is not the same failure class as a stuck ritual action. Bundling in the `teams.ts` category-label fix would have added a second, unrelated bug fix to a change that's supposed to be about reauth parity, for a surface this change doesn't even touch. Filing it as a separate tracked issue (tasks.md 6.1) rather than letting it quietly disappear is the right way to defer it — I'd have flagged it if it had been dropped silently instead.

The original issue (#146) scoped itself as "at minimum" the three `SessionLobbyPage.tsx` sites plus other `session_expired`-emitting routes, deliberately leaving room for judgment on the rest. This proposal used that room to extend the fix exactly as far as the facilitator's continuous journey goes, and no further. That's the proportionality I want to see on a reliability fix: scope driven by "does this complete the user-facing guarantee," not by "what else could we clean up while we're in here."

## One thing worth naming, not a blocker

Design.md is upfront that this ships without live-app reproduction of the failure mode — it's built from a direct code read, not an observed incident. Tasks.md 7.1 requires a manual/integration confirmation before this is considered done, which is the right mitigation. I'm noting it only because it means this is proactive reliability investment against a scenario we believe is real (the WS-side twin of this bug was real enough to fix), not one we've confirmed a facilitator has actually hit. That's a fine trade for a change this small; it wouldn't be for something bigger.

## What I'm not commenting on

The dual-signal detection design, the allow-list regex shapes, the shared-helper contract, and the confirm-dialog visual layout risk on `DraftSessionHost.tsx` are all implementation-team calls. They look like the team is taking the "don't silently assume" discipline seriously (Decision 4's no-partial-execution note, Decision 6's mock-review task), which is the kind of rigor I want on anything touching auth — but that's a design review, not mine to grade.
