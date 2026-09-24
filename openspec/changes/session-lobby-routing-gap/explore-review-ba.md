# BA review — exploration notes, issue #164

Reviewed by Marcus Delgado (Business Analyst). I verified the exploration's code and
spec citations directly rather than taking them on faith — that's turned up one
citation I can't substantiate (item 2 below) and a couple of acceptance-condition gaps
that need to close before this is proposal-ready. Priya's review already covers the
facilitator-experience/UX seam in depth; I'm not duplicating that. My lens is: can an
implementer build directly from what's written here without coming back to ask what I
meant, and does every "SHALL" trace to a real, checkable condition.

## Overall take

The diagnosis (section 0-4) is solid and well-evidenced — every claim I spot-checked
against the actual code and archived specs held up, with one exception. The
recommendation (section 5) is directionally right but has one acceptance condition
that isn't buildable as written (item 1) and one gap the open questions section
under-states (item 3). Neither is a large fix, but both need to be resolved before
this goes into a proposal, not carried forward as open questions.

## 1. The DraftSessionHost Start Session control is under-specified on "what happens after"

Section 5 says: "Add a minimal 'Start Session' control to `DraftSessionHost`'s
`live-readiness-view` when `currentSessionState === 'lobby'`, same shape as the
existing 'Open the room' button, calling the existing `POST /start` directly."

The "when it appears" half is concrete and I have no notes on it — `DraftSessionHost`
is already facilitator-only by authorization (`facilitator_id === caller` on
`facilitator-state`, confirmed in the route comment), so there's no separate
`isFacilitator` gate to spec the way `SessionLobbyPage`'s control needed one. Good,
reuse that.

The "what does it do" half is not concrete enough to build from, and I think the
exploration notes themselves surface why without naming it as a blocker. I traced
`openTheRoom()` (`DraftSessionHost.tsx:98-125`) — the pattern "same shape as Open the
room" is pointing at is: on success, update `currentSessionState` in local state
in-place, no navigation, no WebSocket subscription (`DraftSessionHost` has none at
all today). Applying that same pattern to Start Session means: click succeeds, session
status flips to `pre_session` in local state, and the component re-renders
`live-readiness-view` with `currentSessionState === 'pre_session'` — which today
renders exactly the same static "The room is open. Session status: pre_session." with
no review content and no further control.

That is a second dead end, one status later, introduced by this change's own
recommendation. It is not hypothetical — it is what the existing branch renders today
for any non-`draft` status, verified by reading the render logic (`DraftSessionHost.tsx:184-208`),
and the notes confirm this same branch is what a facilitator lands on for *every*
post-draft status including `active`, with no link anywhere on the page toward
`/session/:sessionId`. A facilitator who clicks the new Start Session button has no
way — none — to reach the action-item review that's already built and shipped on
`SessionLobbyPage`, unless they separately know to navigate there by hand.

**This isn't safely deferrable to "design stage decides whether `DraftSessionHost`
renders the review."** That framing (open question 1, and section 5's parenthetical)
treats it as a nice-to-have completeness question. It's actually a correctness
condition for *this* change's own acceptance criteria: you cannot write a testable
"WHEN the facilitator clicks Start Session THEN ___" scenario without first deciding
what the ___ is, and "nothing, they're stuck" isn't an acceptable answer for a change
whose entire premise is fixing a stuck session. At minimum, the proposal needs one of:

- (a) `DraftSessionHost` renders a link/CTA to `/session/:sessionId` whenever
  `currentSessionState` is `pre_session` or later (cheapest fix — a few lines, no new
  data fetch, `SessionLobbyPage` already handles the destination correctly per the
  exploration's own section 5 finding), or
- (b) `DraftSessionHost` fetches and renders the review itself (the "second data
  fetch" option the notes already name and correctly scope as the bigger lift).

I'd push for (a) as the acceptance condition for *this* change and let (b) stay a
genuine design-stage question for a later change, since (a) is small enough to hold
this change to "no new dead ends" without absorbing the full facilitator-UX
unification Priya is asking for.

**Suggested rewrite for section 5's facilitator recommendation:**

> Add a "Start Session" control to `DraftSessionHost`'s `live-readiness-view`, visible
> whenever `currentSessionState === 'lobby'` (no additional gating needed —
> `DraftSessionHost` is already facilitator-only by authorization). On click, call
> `POST /api/v1/sessions/:sessionId/start`; on success, update `currentSessionState`
> to `'pre_session'` in local state (same in-place-update pattern as `openTheRoom`, no
> navigation); on failure, show inline retry and remain on `lobby` (same failure
> pattern as `openTheRoom`). Additionally: whenever `currentSessionState` is
> `'pre_session'` or later, render a link/button that navigates to
> `/session/:sessionId`, so the facilitator has a way to reach the review screen —
> without this, the fix relocates the dead end instead of closing it.

## 2. Citation I could not verify: "Decision 8" / "task 7.1" / "required in both lobby and team view"

Section 5 (line ~157) and section 6 (line ~174) both lean on a specific citation —
"the access-model statement is already spec'd as required 'in both' surfaces
unconditionally (Decision 8, `pre-session-action-item-review` task 7.1)" — to support
treating `SessionLobbyPage`'s facilitator Start Session path as intentionally
defensive/secondary rather than something needing active exercise.

I read the archived `pre-session-action-item-review` design.md and tasks.md in full
looking for this. **Neither exists as cited.** `design.md`'s decisions run 1 through 7
(Decision 7 is the staleness-mapping fix); there is no Decision 8. `tasks.md`'s
sections run 1 through 6, with task numbering topping out at 6.7; there is no task
7.1. I also grepped both documents, and the whole `openspec/` tree, for the exact
phrase "required in both" — the only hit is the exploration notes themselves quoting
it. I can't find where this quote is supposed to come from.

This doesn't undermine the underlying point, which I think is basically right on its
own merits (Decision 3 in the real design.md does establish that facilitator standing
on `SessionLobbyPage` is real and pre-existing, not something this change invents).
But a citation that doesn't resolve to a real document is exactly the kind of thing
that becomes a scope dispute later — someone will go looking for "Decision 8" during
implementation review and not find it, and then have to re-derive whether the
"defensive, not primary" framing was ever actually decided or is Devon's own read.
**Before this goes into a proposal: either find the real source for this claim, or
rewrite it as what it actually is — an inference from Decision 3's "facilitator
already has standing" language, not a cited, separately-numbered decision.** I'd
rather see "I'm inferring X from Y" than a specific-sounding citation that doesn't
check out; the former is honest about its own confidence level, the latter reads as
more settled than it is.

## 3. Join-link landing rule change: conflict is real but the rewrite needs to enumerate all statuses, not just two

I read `join-link/spec.md`'s "Session-aware join link landing" requirement directly
(lines 296-304 in the current spec). Confirmed: it is genuinely worded around a binary
— "if an active session exists (status `active`) ... else land on `/team/:teamId`" —
and the exploration's proposed extension to `lobby` and `pre_session` does conflict
with that literal wording as written, not just its intent. This isn't a
misunderstanding on the exploration's part; it's a real spec change, correctly
identified.

What's missing: `SessionStatus` has seven values, not three —
`draft | lobby | pre_session | active | wrap_up | complete | abandoned`
(`packages/shared/src/types/session.ts`). The exploration's proposed rule only
addresses three of them (implicitly: `draft` → no redirect, unchanged;
`lobby`/`pre_session` → redirect, new; `active` → redirect, unchanged) and says
nothing about `wrap_up`, `complete`, or `abandoned`. I'd assume those should behave
like `draft` today (land on `/team/:teamId`, nothing to join) — but "I'd assume" is
exactly the gap Marcus-the-persona exists to close before it becomes an implementer's
guess. **The rewritten requirement needs to enumerate the full set explicitly**, e.g.:

> If a session exists for the team whose status is `lobby`, `pre_session`, or
> `active`, the user SHALL be directed to `/session/:sessionId`. If the team's most
> recent session (if any) is in `draft`, `wrap_up`, `complete`, or `abandoned` status,
> or no session exists at all, the user SHALL land on `/team/:teamId`.

That also surfaces a question the current draft doesn't address at all: what happens
if a team has a `wrap_up` (in-progress-but-past-voting) session — is landing on
`/team/:teamId` actually still correct there, or does that silently exclude a
legitimate case? I don't know the answer; I'm flagging that the current binary framing
lets that question go unasked, and the sevenfold enumeration forces it to get an
explicit answer during design rather than falling out of whatever the implementer
happens to write.

**On the scope-boundary question (does this rule change belong to this change or to
`join-link`'s own spec):** I agree with the exploration's lean — this change owns it.
The reasoning holds up: this change is the direct cause of the gap, `join-link`'s spec
already frames session-awareness as a capability that gets extended over time (it
doesn't read as a closed/frozen requirement), and routing the rule change through a
separate `join-link` proposal would just be process overhead for a two-line delta.
No objection there — just make sure the delta spec for this change targets
`join-link/spec.md`'s existing requirement with a full replacement text (per the
sevenfold enumeration above), not a patch that only mentions the two new statuses and
leaves the reader to infer the rest by diffing against the old wording.

## 4. On the third open question (TeamPage session-blindness) — agree with deferring, one caveat

I agree this is correctly named as adjacent-but-not-caused-by-this-issue, and I don't
think it needs to be pulled into scope. One thing worth adding to the deferral note so
it doesn't get lost the way the exploration is (rightly) worried about elsewhere: this
gap means a team member who is *already* a team member (not following a fresh
join-link) has **zero** way to discover a session that's in `lobby` or `pre_session`
today, even after this change ships — the join-link rule fix only helps someone
clicking a link, and `TeamPage` has no session awareness at all per the exploration's
own section 1 finding. That's worth one sentence in this change's proposal.md Impact
or Non-Goals section (not a fix, just a named, explicit non-goal with the reason),
so it's traceable as a deliberate scope decision rather than something nobody noticed.
This is the exact pattern I flagged in my persona notes under "edge cases discovered
late become scope disputes" — naming it explicitly now costs one sentence; leaving it
silent costs a future argument about whether it was overlooked or excluded on purpose.

## Summary — what needs to close before this becomes a proposal

1. **Blocking:** Resolve what happens after `DraftSessionHost`'s Start Session control
   succeeds — at minimum, add the navigate-to-`/session/:sessionId` link for
   `pre_session`-and-later states (item 1 above). Without this, the change doesn't
   fully fix the issue it's named for.
2. **Blocking:** Fix or drop the "Decision 8 / task 7.1 / required in both" citation
   (item 2). Either find the real source or rewrite the claim as an inference.
3. **Blocking:** Rewrite the join-link landing rule as a full enumeration of all seven
   `SessionStatus` values, not a two-status patch on the existing binary wording
   (item 3).
4. **Non-blocking, cheap:** Add one sentence naming `TeamPage` session-blindness as an
   explicit, deliberate non-goal in the proposal (item 4).

Everything else in the exploration — the core diagnosis, the "don't delete
`SessionLobbyPage`" reasoning, the authorization-model incompatibility argument for
why `DraftSessionHost` can't just absorb `SessionLobbyPage`'s job wholesale — is
well-evidenced and I have no notes on it.
