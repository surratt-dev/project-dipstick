# Champion Sign-off — session-lobby-routing-gap

**Reviewer:** Devon Calloway, Internal Champion
**Verdict:** Approved to ship. Ritual intent is preserved. One follow-through item below is not optional — it needs an owner and a date, not just a line in an archived design doc.

## Ritual intent — preserved

I went looking for anything in this diff that touches the load-bearing mechanics: the no-manager-participation rule, the simultaneous reveal, the facilitator-from-another-team requirement. None of them are touched. This change is entirely about *where a browser tab ends up* after `lobby`/`pre_session`/`active` — it doesn't touch who gets to be in the room, how votes are revealed, or who can facilitate. `POST /start`'s own `facilitator_id !== caller` check (D1) and `evaluateSessionSubscriberAccess`'s EM-exclusion path (referenced in D7) are both explicitly left alone, and the architect review confirmed the `session_participants` `422` gate wasn't quietly relaxed as a shortcut. Good — that's exactly the discipline I care about most: don't bolt a fix for one problem onto a boundary that deserves its own review.

## The severity-1 fix itself

No session created could progress past `lobby` through any reachable UI path. I want to be blunt about what that means: it's not a papercut, it's the ritual not existing. Every motivation I have — the tool carrying the knowledge I used to carry by hand, a team I've never spoken to adopting this without me — depends on a session someone starts actually being able to run. A tool where the facilitator clicks "Start Session" and hits static text is worse than no tool, because it looks like it should work and doesn't. Fixing this is squarely in scope for what I asked the VP to fund. Ship it.

## D7 (participant registration gap) — scoped correctly, not a reason to hold this PR

The design doc's handling of this is exactly right, and I mean that as a compliment, not a formality: a first-time joiner hitting `404`/`CLOSE_UNAUTHORIZED` during `lobby`/`pre_session` is a real gap, it's pre-existing (not introduced by this change), and closing it means picking an actual authorization-boundary design — which independently has to replicate the EM-exclusion check — not a query patch riding along on a routing fix under time pressure. That's the same principle I'd apply myself: these constraints are structural, and structural things get their own review, not a drive-by fix. Both the design-stage and implementation-stage security reviews already covered this ground and didn't block on it. I'm not going to invent a blocker they didn't raise.

But I'm not going to let it become invisible either. Here's the risk in my terms: a first-time Engineer following a join link into a forming session and getting a 404 is precisely the kind of experience that makes a team quietly stop using the tool and never tell me why. I won't be in the room to explain it away. **The follow-up needs to be filed as a real, tracked issue this week — not left as a paragraph in an archived design doc that nobody will reread.** Whoever owns the next change on this area, file it now.

## Tasks 6.2–6.4 — this is the one place I'm pushing back

Both the architecture and security implementation reviews already flagged this, and I agree with the architect's read more than the security review's: I do not consider this change *actually done* — as opposed to *merged* — until someone runs the manual walkthrough, especially 6.4, against a real environment. Not because I doubt the code trace (D7's analysis is careful and I believe it), but because "traced through the code" and "confirmed against the real database and a real WebSocket" are different claims, and this project has a specific failure mode I've watched happen elsewhere: early rollout looks fine, nobody re-checks the thing that was deferred "pending verification," and eighteen months later it's load-bearing folklore again. I don't want to be the guy re-discovering this gap in person during a live session with a team that's already skeptical.

I'm not blocking the merge on this — the routing fix is correct and valuable on its own, and holding it hostage to a dev-server scheduling conflict in a shared session would be the wrong trade. But I want it on record, in my voice, alongside the architect's and security's: **run 6.2–6.4 against a clean environment before this is called production-ready, and either check them off with the observed result or convert 6.4's confirmed finding directly into the D7 follow-up issue.** If nobody's done this within a couple of weeks, that's the kind of thing I expect to be looped in on.

## Bottom line

- Ship the routing fix. It closes a real severity-1 dead end and doesn't touch any of the ritual's protected mechanics.
- File the D7 follow-up as a tracked issue now, not later.
- Run tasks 6.2–6.4 for real before anyone calls this fully closed out. I'm trusting the team to close the loop without me chasing it — that's the whole point of writing things down this thoroughly.
