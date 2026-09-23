# Champion Sign-Off — session-creation-existing-team

**Reviewer:** Devon Calloway (Internal Champion / SME)
**Scope:** Final read of the archived change — proposal, design, tasks, and the exploration notes that started it — against the ritual's protective constraints: no-manager participation, simultaneous reveal, facilitator-from-another-team.

## Verdict: SIGN OFF

This is the version of this feature I was worried I wouldn't get. My exploration notes flagged that the facilitator-from-another-team rule was a hard, no-exceptions requirement on paper and completely unenforced at the one endpoint that creates sessions — a gap a correctly-filtered picker would have hidden forever, not surfaced. That gap is closed, not patched around: `POST /draft` now runs the membership check server-side, rejects with a named error regardless of whether the request comes through the picker or hits the API directly, and — the part I didn't originally ask for but am glad landed — writes an audit row on both the denial and the grant. A constraint with no enforcement and no audit trail is a constraint that only exists in a requirements document. This one now exists in the database and in the log.

## Constraints in scope for this change

**Facilitator-from-another-team — strengthened, not just preserved.** This was the whole reason I flagged this change as needing to fix the endpoint rather than file a follow-up ticket. It's a real hard block now: active membership → 403, named error, no session row created, re-checked live at submission regardless of what the eligible-teams list showed a moment earlier. The direct-API-bypass scenario I specifically asked to be a named test (not just implied by the picker case) is in the spec and in the test suite. Security's sign-off confirms the audit rows are transactionally correct, not best-effort. This is exactly the "structural, not preferential" posture I care about — the block lives in a server-side query and a database transaction, not in a client picker's filtering logic that a future caller could route around.

**No-manager-participation rule — untouched, correctly.** Nothing in this change adjusts who may enter a session as a participant. It's out of scope, and it should be — this feature is about who may *create* a session, not who may join one. I checked for it anyway because it's the constraint I'd notice fastest if it moved, and it didn't.

**Simultaneous reveal — untouched.** Also out of scope, also correctly so. Nothing here touches vote submission or reveal timing.

**Concurrent-session block — a new structural protection I didn't ask for but endorse.** Two facilitators independently starting sessions for the same team was always going to happen eventually, and the design didn't leave it as a warn-and-proceed checkbox — it's a database-level partial unique index, not an app-level check-then-insert. That's the right shape for a protection that needs to hold under real concurrency, and it's the same discipline I want applied to the constraints I actually named.

## D6 — draft-landing vs. auto-advance

I want this on record because it's a small decision with outsized relevance to "the app disappears into the background": the original lean was to auto-advance straight to an open lobby, which would have quietly deleted the pre-session review window ADR-007 exists to protect, for the one case (an existing team) where there's actually history to review. Priya pushed back, the decision reversed, and the confirm screen stayed thin rather than growing into a dashboard nobody asked for at that step. That's the correct trade-off — an extra click for the facilitator, in exchange for not turning session creation into a one-click event with no chance to notice you picked the wrong team. Priya's sign-off is conditional on the eventual trend/history capability landing on this same control view rather than a new one; I'll hold the team to that when that capability gets built, not before.

## The drift worth naming

I was told the facilitator no-team routing carve-out was initially wired only into `AuthenticatedLanding`'s client-side branch and not into the actual server-side sign-in redirect a facilitator with zero team memberships would hit first — meaning the fix could pass its own tests while never actually firing for a real sign-in. That is precisely the failure mode I'm most allergic to: a control that's correct in the code path someone tested and absent in the path a real user takes. I'm glad this was caught and fixed before archiving rather than after, and the current `first-access` spec delta is explicit that the callback-level redirect and the `AuthenticatedLanding` carve-out are two separate mechanisms that both need to agree — that explicitness is what should prevent this specific drift from recurring silently.

## One loose thread, not blocking

`canFacilitateSessions`-gated carve-out logic is duplicated across two frontend files rather than living in one place. Non-blocking, but I'd rather see it consolidated soon than have the two copies quietly diverge the next time someone touches one and not the other — that's exactly the kind of small inconsistency that turns into "wait, why does this work differently here" eighteen months from now. Log it, don't let it sit past the next touch to either file.

## Bottom line

The ritual's intent is intact. The one constraint this change existed to fix is now a real, tested, audited server-side block instead of a filtered dropdown. Nothing in scope touched the no-manager rule or simultaneous reveal, and the new concurrent-session protection was built with the same structural discipline I want applied everywhere else. I'm signing off.
