# Champion Sign-off — vote-compose-recovery (issue #31)

**Reviewer:** Devon Calloway, Internal Champion / founding advisor
**Scope:** Final read of the archived artifacts (proposal, design, spec, tasks, and the security/architect implementation reviews) against the ritual's core intent and against the specific concerns I held during exploration.

## Verdict

Signed off. This is exactly the kind of change I want to see this project ship — a small, structurally-scoped fix to a real gap, that resists every temptation to become bigger than the problem it's solving. Nothing here softens or works around the no-manager rule, the simultaneous reveal, or the facilitator-from-another-team requirement — none of the three are touched by this change at all, and nothing about the mechanism creates a new path to bypass them. Good.

## The four things I said I'd check

**No facilitator-visible signal distinguishing "recovering with a draft" from an ordinary disconnect.** Confirmed. Spec Requirement 5 states this as a hard SHALL, not a preference, and the implementation review (Ingrid) confirms `FacilitatorReadinessGrid.tsx` doesn't even appear in the diff — it was never touched. A participant mid-recovery still reads as one of the same four baseline states everyone else does. This is the one I was most worried would accrete a status dot during implementation, and it didn't.

**Restore/discard resolving before first paint.** Confirmed as a rendering requirement in spec Requirement 5, not a copy note, and the architect review confirms no spinner/flash logic exists anywhere in `voteDraft.ts`. Good — a thirty-second hiccup should never look like the tool noticing anything.

**Locked-in server vote always wins.** Confirmed, and confirmed in the right order: the registration payload arrives first, and only then does restore logic even read storage — not a race resolved by a precedence rule bolted on after the fact. The security review independently traced this at the code level (not just the design prose) and found no path where a stale draft could apply after a lock-in. This was the one piece of my original framing that was underspecified going in, and it's the piece I'm most satisfied got tightened rather than papered over.

**Staying single-use and client-local, not becoming "resume where you left off."** Confirmed, and I want to note explicitly that the proposal held the line I pushed for during exploration: the same-tab manual-refresh case that falls out for free from write-on-change is named once, as an accepted incidental consequence, and the Non-Goals section still says plainly this is not a cross-device or server-backed draft-resume feature. Nobody used the "it's free" argument to justify advertising it as a feature. That restraint is the whole reason I trust this team to build the next one of these correctly without me in the room.

## One thing I'm noting, not blocking on

The backend `session_registration_snapshot` payload (Decision D3) ended up as real, in-scope work for this change rather than staying frontend-only, because the restore logic needed server-authoritative state to check against and nothing existing served that shape. That's a bigger footprint than issue #31 originally implied, but it's justified by the ordering constraint I asked for in exploration (server state first, draft read second) — you can't build that ordering without a payload to wait for. I'd rather see the scope grow honestly to satisfy a real constraint than see the constraint quietly weakened to fit the original scope. No objection.

## What's still open

Task Group 8 (wiring into the actual compose UI, and the integration-level acceptance scenarios) is correctly deferred — it depends on UI that doesn't exist yet and on issue #32. That's not a gap in this change, it's an honestly-labeled follow-up. Whoever builds the compose UI should read spec.md's Requirement 5 scenarios and tasks.md 8.3's checklist before considering that wiring done, since several of the guarantees here (no-flash restore, silent discard) only become testable once that UI exists.

Nothing here needs my involvement to resolve. That's the point.
