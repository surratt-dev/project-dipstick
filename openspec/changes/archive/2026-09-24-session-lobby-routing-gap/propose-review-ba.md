# BA review — proposal, issue #164 (session-lobby-routing-gap)

Reviewed by Marcus Delgado (Business Analyst). I re-verified against the actual code
and against `requirements/` rather than trusting the prose — same standard I applied
at exploration stage. Two of my three exploration-stage findings closed cleanly. The
third (the seven-status enumeration) is correctly carried into the delta spec text,
but the proposal ships a decision on `wrap_up` that the design doc itself says still
needs confirmation, and I found requirements evidence that decision may be wrong. That's
the one blocking item below.

## Overall take

Capabilities are specific and the delta specs are, almost entirely, buildable without
further judgment calls — this is a well-scoped proposal for what it says it is. My
exploration-stage DraftSessionHost finding and bad-citation finding are both correctly
resolved. The gap is process, not prose: task 1.1 is written as a gate on a decision
the proposal has already made, silently, inside its own delta spec — which means the
gate doesn't actually gate anything, and the decision it "defers" was never actually
checked against the one place that could confirm or contradict it (Priya, or the
wrap-up use case doc). See item 3.

## 1. SessionStatus enumeration — matches, carried through correctly

Confirmed against `packages/shared/src/types/session.ts`: `SessionStatus` is exactly
`draft | lobby | pre_session | active | wrap_up | complete | abandoned`, seven values.
`specs/join-link/spec.md`'s replaced requirement enumerates all seven, exhaustively
partitioned into the two buckets I drafted at exploration stage, word-for-word:
`lobby`/`pre_session`/`active` → `/session/:sessionId`; `draft`/`wrap_up`/`complete`/
`abandoned`/no-session → `/team/:teamId`. Each of the seven values has its own scenario
in the delta spec (not collapsed into an "other" catch-all), which is exactly the
buildable, no-inference form I asked for at exploration stage. No notes — this item is
closed.

## 2. DraftSessionHost Start Session control — buildable as written, one loose edge worth tightening

`specs/session-creation/spec.md`'s two new requirements are concrete: gating (none
beyond existing facilitator-only auth), the exact endpoint, the in-place state update
on success (matching `openTheRoom`'s established pattern), and the inline-retry
failure mode. I traced this against `DraftSessionHost.tsx`'s actual `openTheRoom()`
implementation and the pattern described is the pattern that exists — an implementer
can build requirement 1 directly from the spec text with no additional decisions.

The navigate-link requirement is also concrete, but note one place where the proposal
is *looser* than the delta spec it produces, worth tightening before implementation
rather than leaving as a latent inconsistency:

- `proposal.md` line 8 and `design.md` D2 both say the link renders "whenever
  `currentSessionState` is `pre_session` or later" — read literally, "or later"
  includes `complete` and `abandoned`.
- `specs/session-creation/spec.md`'s actual requirement text (and `tasks.md` 3.1) is
  more precise: "`pre_session` or a later **non-terminal** status (`active`,
  `wrap_up`)" — explicitly excluding `complete`/`abandoned`.

The spec text is the one I'd build from, and I have no objection to it — leaving the
facilitator on the existing static "Session status: complete." text with no link for a
genuinely terminal session is reasonable, not a new dead end. But `proposal.md`'s
looser phrasing should be tightened to match the spec before this is read by anyone
who only skims the proposal, not the delta spec. **Non-blocking, cheap.**

## 3. Task 1.1's `wrap_up` checkpoint is a no-op as currently sequenced — blocking

This is the important finding. `tasks.md` Section 1 (task 1.1) instructs whoever picks
this up to confirm with the Facilitator persona whether `wrap_up` should land on
`/team/:teamId`, "before the delta spec is finalized for implementation." `design.md`'s
Open Questions section says the same thing — this is explicitly named as unresolved,
with a recommendation to resolve it before the enumeration text is finalized.

But `specs/join-link/spec.md` — the delta spec shipped **in this same proposal
packet** — already contains the finalized answer: `wrap_up` → `/team/:teamId`, written
as a firm `SHALL` with its own scenario ("Only a wrap-up session exists at join time").
There is no marker in the spec text, the proposal, or anywhere else in this change
indicating that cell is provisional or pending confirmation. The decision has already
been made and written as settled requirement text, in the very artifact task 1.1 claims
still needs to happen before finalization.

Two consequences:

- **The checkpoint doesn't gate anything.** By the time someone would execute task
  1.1, the thing it's supposed to gate — finalizing the delta spec — has already
  happened. Checking task 1.1 off after implementation starts doesn't change the spec
  text; the enumeration is already committed. As sequenced, task 1.1 can only ever
  rubber-stamp a decision already made, not inform it.
- **The confirmation this checkpoint calls for never actually happened.** I read
  Priya's exploration-stage review (`explore-review-facilitator.md`) in full looking
  for a `wrap_up`-specific opinion — she wasn't asked about it; her review predates
  this open question being raised and doesn't mention `wrap_up` at all. So the
  "confirm with Priya" instruction in task 1.1 is not describing something that
  already happened elsewhere in this packet; it's describing something that still
  needs to happen, on an artifact that no longer treats it as open.

I also checked whether the `wrap_up` → `/team/:teamId` bucket assignment is actually
right, since I had the chance to check it against real requirements rather than just
flag the sequencing problem. `requirements/use cases/06 - Session Wrap-up - Use
Cases.md` describes `wrap_up` as a phase where "Participants' views update to indicate
the session is in wrap-up" and explicitly notes: "The application should make clear to
participants that the session is in its closing phase, **not that it is over**." That
use case is written for participants already in the session when it transitions, not
for someone freshly following a join link — but the framing it establishes (wrap_up is
an active, observable, in-progress phase, meaningfully different from `complete`) cuts
against bucketing it with `draft`/`complete`/`abandoned` as "nothing to show, land on
`/team/:teamId`." An Engineer who follows a join link while the session is
closing-but-not-over gets bounced to the team page with no indication a session
happened at all today — which is arguably the "silently excludes a legitimate case"
outcome design.md's own Open Questions section warned about.

I'm not asserting the enumeration is wrong — I don't have enough to make that call
unilaterally, which is exactly why this needs the confirmation task 1.1 describes,
actually done, before the spec ships as final. **What needs to happen:** either (a)
get the actual confirmation (Priya, specifically on this cell) before this proposal is
approved, and adjust `specs/join-link/spec.md`'s `wrap_up` scenario if the answer
differs from what's currently written, or (b) if the team wants to ship the current
`wrap_up` → `/team/:teamId` answer as a considered decision now, rewrite task 1.1 as a
record of that decision (who decided, why, referencing the use-case tension above) and
drop the "before the delta spec is finalized" framing, since that framing is no longer
true. Leaving it as-is means task 1.1 sits in `tasks.md` looking like a real gate while
functioning as decoration.

## 4. TeamPage non-goal — clear enough, no changes needed

`proposal.md`'s non-goal paragraph and `design.md`'s matching Non-Goals bullet both
state the boundary the same way I asked for at exploration stage: named explicitly,
with the reason ("predates this change," "existing team member... has no way to
discover a session"), and an instruction that it should become its own follow-up
rather than be absorbed here. This is concrete enough to stop scope creep during
implementation — an implementer hitting `TeamPage` has clear text telling them not to
touch it for this reason, not just silence. No notes.

## 5. Additional finding, not blocking: the withdrawn "Decision 8" citation survives in shipped code, outside this change's scope

At exploration stage I flagged an unverifiable citation ("Decision 8, `task 7.1`,
required in both") as withdrawn, and confirmed it does not appear anywhere in this
proposal's artifacts (`proposal.md`, `design.md`, `tasks.md`, the three delta specs) —
good, that finding is correctly resolved in what this change ships.

While tracing the routing this proposal touches, I found the same citation still lives
in a route comment in `packages/frontend/src/App.tsx` (lines 131–136, above the
`/session/:sessionId` route): *"The access model statement (Decision 8, task 7.1) is
rendered here as a static contextual note. Both this surface and the team view are
required — Decision 8 uses 'and' not 'or'."* This predates this change, this change
doesn't touch that comment, and I'm not asking this proposal to fix it. Flagging it
only because it confirms the citation's provenance problem is real and lives in the
codebase, not just in exploration notes — worth its own small cleanup ticket
independent of this change.

## 6. Additional finding, not blocking: `active` may not actually have "something to show" on `/session/:sessionId`

`design.md`'s Goals state the intent to give Engineers "a working landing on
`/session/:sessionId` for every `SessionStatus` where that page has something to show
them (`lobby`, `pre_session`, `active`)" — asserting `active` belongs in the
"has something to show" group alongside `lobby`/`pre_session`.

I traced `SessionLobbyPage.tsx`'s actual branch logic (`fetchReview`, lines ~101–144
and the render tree at ~268+). The `action-items-review` endpoint returns 200 only for
`pre_session`; for every other status reachable via a 409 — which includes `active`,
`wrap_up`, `complete`, and `abandoned` alike — the component falls into one
undifferentiated `"left"` branch rendering: *"This session has moved past the
pre-session review."* There is no `active`-specific rendering on this page; an Engineer
landing here during an active voting session sees the same generic "moved past" copy
as someone landing during `wrap_up` or after `complete`. A live voting page does exist
in the app (`/session/:sessionId/live`, `SessionConnectionHost`), but that is a
*different route* that nothing in this change's join-link rule points to.

This is **not a gap this proposal introduces or worsens** — the join-link rule already
routed `active` to `/session/:sessionId` before this change (confirmed in `proposal.md`
line 3: "the join-link landing rule only redirects... when a session is already
active"), and this proposal leaves that branch's rendering untouched. I'm not asking
for a fix here. But `design.md`'s Goals text asserts something about `active` that the
current code doesn't actually support ("has something to show them" — it has a
misleading "moved past" message, not a voting view), and that's exactly the kind of
claim I'd want either corrected in the design doc's framing or named as a real,
pre-existing gap worth its own follow-up — the same treatment this change already gives
`TeamPage` session-blindness and the facilitator-aware redirect. Suggest adding one
line to the Named Follow-ups list in `proposal.md` for this, so it's traceable as
noticed rather than assumed away by the Goals section's wording.

## Summary — what needs to close

1. **Blocking:** Task 1.1's `wrap_up` checkpoint needs to actually gate the decision it
   names, or be rewritten to reflect that the decision has already been made — not left
   pointing at a "before finalization" step that the packet's own delta spec has
   already passed. Get the real confirmation (or make and record the decision
   deliberately) before this proposal is approved for implementation. See item 3.
2. **Non-blocking, cheap:** Tighten `proposal.md`/`design.md`'s "`pre_session` or
   later" phrasing to match the delta spec's precise "non-terminal (`active`,
   `wrap_up`)" wording. See item 2.
3. **Non-blocking, informational:** Consider naming the `active`-status
   `/session/:sessionId` content gap as an explicit follow-up, alongside this
   proposal's other three named follow-ups. See item 6.
4. **Non-blocking, informational:** The withdrawn "Decision 8" citation still exists in
   `App.tsx`'s route comments — a cleanup ticket independent of this change. See item 5.

Everything else — the seven-status enumeration (item 1), the DraftSessionHost
acceptance criteria's core shape (item 2), and the TeamPage non-goal (item 4) — is
buildable as written and I have no further notes.
