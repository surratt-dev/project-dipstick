# Exploration notes — issue #164: SessionLobbyPage's lobby branch is unreachable

Devon Calloway, internal champion / founding advisor. Exploring #164 grounded in the
current codebase, not just the issue text.

**Revision note (post-review):** updated after Marcus's (BA) and Priya's (Facilitator)
reviews. Three things changed substantively: (1) the `DraftSessionHost` Start Session
recommendation now specifies what happens after it succeeds, closing the second dead
end Marcus found; (2) the "Decision 8" citation is withdrawn — Marcus checked the
archive directly and it isn't there — and replaced with what the archive actually
supports; (3) the join-link landing rule is now a full seven-status enumeration, not a
two-status patch. I also resolved where the facilitator reviews `pre_session` content
and the two-lobby-view copy mismatch, since Priya's fragmentation concern turned out to
be downstream of the same decision as (1). Nothing in either review touched the
no-manager rule, simultaneous reveal, or facilitator-from-another-team requirement, so
there was nothing to push back on for ritual-fidelity reasons — the calls I made below
are scope/risk calls (declining to build a second, `DraftSessionHost`-native review
render and a facilitator-aware join-link route *right now*), not ritual ones.

## 0. The issue is correct, and it's a bigger problem than it states

The issue frames this as "the `lobby` branch is real, tested code with no live entry
point" — a visibility/dead-code question. Tracing the actual routes and the spec that
built that branch, it's worse than that: **`SessionLobbyPage`'s lobby branch is
currently the only mechanism in the entire running application that can move a
session out of `lobby` status.** Since nothing navigates anyone there, no session
created today can ever progress past `lobby` through any UI path that exists. This
isn't a "facilitator can't find a nice-to-have screen" gap — it's a full dead end in
the session lifecycle.

## 1. Confirmed: no navigation path reaches `/session/:sessionId` during `lobby`

Grepped the whole frontend for navigation targets and `POST /start` call sites:

```
packages/frontend/src/pages/SessionLobbyPage.tsx:199   fetch(`/api/v1/sessions/${sessionId}/start`, ...)
```

That's the only call site for `POST /start` anywhere in `packages/frontend/src`. And
the only navigations toward `/session/:sessionId`-shaped paths are the route
registration itself in `App.tsx:137-144` and its unrelated `/live` and `/facilitator`
sub-routes (explicitly marked non-feature-complete stub surfaces in that file's own
comments).

Traced where a facilitator actually goes after creating a session
(`SessionCreationPage.tsx:175,222` → `navigate(`/team/${teamId}/session/${sessionId}`)`),
every path lands on `DraftSessionHost` at `/team/:teamId/session/:sessionId` — a
different route entirely. `DraftSessionHost.tsx:184-210`'s `live-readiness-view`
branch renders for *any* `currentSessionState !== "draft"` (`lobby`, `pre_session`,
`active`, ...) and shows only: team label, the join link + copy control
(`join-link-display-copy`, shipped today per commit `f60bbd8`), and a static "The room
is open. Session status: {state}." No Start Session control, no action-item review
render — those exist only in `SessionLobbyPage`.

`TeamPage.tsx` (confirmed by full read) has zero session-awareness: team name, member
list, `MemberManagement`, sign-out. No banner, link, or status indicator referencing
any session, active or otherwise.

## 2. Confirmed: the join-link redirect rule excludes `lobby` (and `pre_session`)

`openspec/specs/join-link/spec.md:296-297`, "Session-aware join link landing":

> If an active session exists for the team (status `active`) ... the user SHALL be
> directed to `/session/:sessionId`. If no active session exists, the user SHALL land
> on `/team/:teamId`.

Only `active` triggers the redirect. An Engineer following a join link while the
session is `lobby` **or `pre_session`** lands on `TeamPage` — session-blind, as
confirmed above.

**Rewrite decided (incorporating Marcus's BA review, item 3):** `SessionStatus` has
seven values, not the three my first pass implicitly handled —
`draft | lobby | pre_session | active | wrap_up | complete | abandoned`
(`packages/shared/src/types/session.ts`). A patch that only mentions `lobby` and
`pre_session` leaves `wrap_up`, `complete`, and `abandoned` to be inferred by whoever
implements this, which is exactly the kind of gap that turns into a guess. Full
replacement text for `join-link/spec.md`'s "Session-aware join link landing"
requirement (this change's delta spec should carry this as a full replacement of the
requirement, not a diff-shaped patch against the old binary wording):

> If a session exists for the team whose status is `lobby`, `pre_session`, or
> `active`, the user SHALL be directed to `/session/:sessionId`. If the team's most
> recent session (if any) is in `draft`, `wrap_up`, `complete`, or `abandoned` status,
> or no session exists at all, the user SHALL land on `/team/:teamId`.

Left genuinely open, per Marcus: whether a `wrap_up` session landing on
`/team/:teamId` is actually correct, or silently excludes a legitimate case (`wrap_up`
is "in progress, past voting" — not obviously the same as `draft`/`complete` in terms
of what a team member should see). I don't have the answer; flagging it so the design
stage has to answer it explicitly rather than inherit it by default from the
enumeration above.

## 3. The part the issue doesn't mention: this collides with a shipped spec requirement

`openspec/specs/pre-session-action-item-review/spec.md` (archived 2026-09-15, shipped
*before* the routing gap was even filed) contains this requirement, stated plainly:

> Without a frontend trigger for the already-implemented `POST
> /api/v1/sessions/:sessionId/start`, no session can leave `lobby` in the running
> application. The application SHALL render a "Start Session" control on
> `SessionLobbyPage`'s `lobby` branch...

That capability shipped exactly what it promised — `SessionLobbyPage.tsx:300-322` has
the waiting message and a facilitator-gated Start Session button, fully tested
(`SessionLobbyPage.test.tsx`, `describe("4.5/4.6: Start Session control")`). The spec's
own framing treats `SessionLobbyPage` as *the* trigger. It just never reconciled with
the fact that nothing routes a live user there.

Eight days later, `session-creation-existing-team` (archived 2026-09-23) built
`DraftSessionHost` as "the real, refresh-safe route" for the facilitator
(`design.md` Decision D6) — explicitly framed as growing into the facilitator's
durable home for the whole session lifecycle ("it's already the facilitator's own
view of one specific session ... with room to grow"; the trend/history capability is
meant to attach here later per Priya's sign-off condition). D6's design doc never
mentions `SessionLobbyPage` or reconciles with the Start Session control
`pre-session-action-item-review` had shipped eight days earlier onto a page D6 doesn't
route anyone toward. Two capabilities, each built assuming ownership of "what the
facilitator does after opening the room," shipped without ever talking to each other.

Net result, confirmed by code: a facilitator can open the room (`draft` → `lobby`, via
`DraftSessionHost`'s "Open the room" → `POST /advance`) but then has **no UI control
anywhere** to call `POST /start` and move to `pre_session`. The control exists, is
tested, is spec'd as load-bearing — and sits on a page nobody's browser ever
navigates to.

This is exactly the failure mode already named during the #45 exploration
(`openspec/changes/archive/2026-09-24-join-link-display-copy/exploration-notes.md`):
Priya's framing there — "success is a facilitator running a real session sees this,
not the AC passes against an isolated component" — applies with more force here than
it did to that change, because here the missing surface isn't a copy-link
convenience, it's the only exit from `lobby`.

## 4. Why "remove as dead code" doesn't actually work

Deleting `SessionLobbyPage` is not a deletion of dead code — it's the removal of the
only implemented `lobby → pre_session` trigger and the only implemented `pre_session`
review surface, with nothing to replace them. To make deletion viable you'd have to
rebuild, inside `DraftSessionHost`, everything `SessionLobbyPage` already does for
that phase: the Start Session control, the `action-items-review` fetch/branch logic,
the WS `session_state_change` resubscription, and the `PreSessionActionItemReview`
render. That's not a removal, it's a reimplementation of shipped, tested logic inside
a different, more restrictively-scoped component — strictly more work and more risk
than wiring up the missing navigation edges.

It's also the wrong shape architecturally. `DraftSessionHost` is **facilitator-only
and team-scoped** — it fetches `GET /teams/:teamId/sessions/:sessionId/facilitator-state`,
which is authorized on `facilitator_id === caller` (`design.md` D6). `SessionLobbyPage`
is built the opposite way on purpose: its `action-items-review` endpoint is authorized
via `evaluateSessionSubscriberAccess` specifically so "any authorized subscriber to a
session — not only the facilitator" gets the same data
(`pre-session-action-item-review/spec.md`, first requirement). Engineers have no
`teamId`-scoped facilitator-state endpoint to call and never will, by design — that
authorization model is deliberately facilitator-only. `SessionLobbyPage` is the
correct shared surface for facilitator *and* participants; `DraftSessionHost`
structurally cannot become that without forking its own authorization model.

## 5. Recommendation: wire up navigation (issue's option 1), not deletion

Two edges are missing, and they're different for the two audiences — this isn't one
navigation fix, it's two:

**Engineers (non-facilitator participants):** replace the join-link "Session-aware
landing" rule (`join-link/spec.md`) with the full seven-status enumeration in §2 —
redirecting to `/session/:sessionId` for `lobby`, `pre_session`, and `active`.
`SessionLobbyPage` already renders correctly for `lobby` and `pre_session` — the
waiting message with no Start Session control (non-facilitator, confirmed by
`SessionLobbyPage.test.tsx`'s "6.4: no Start Session or advance control is rendered
for a non-facilitator") and the full review UI. This closes the join-link half of the
gap with a spec-level rule change, no new frontend code.

That still leaves existing team members (not freshly following a join link) with no
way to discover a session that's forming, since `TeamPage` has no session-awareness at
all — worth naming as a related-but-distinct gap; the design stage should decide
whether it's in scope here or its own follow-up.

**Facilitator:** given `DraftSessionHost` is explicitly meant to stay the facilitator's
durable home across the session lifecycle (D6's "room to grow" framing, the
trend/history attachment point Priya was promised), the fix keeps the facilitator on
`DraftSessionHost` for the Start Session action itself rather than routing them away.
Concrete control, incorporating Marcus's BA review (item 1) — this is what closes the
dead end he found, not just where the button appears:

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

Without the navigate link, a facilitator who clicks Start Session lands on the exact
same static "Session status: pre_session." text the page renders for every non-`draft`
status today — a second dead end, one status later, introduced by this change's own
recommendation. Marcus traced this in the existing render logic
(`DraftSessionHost.tsx:184-208`) and it's real, not hypothetical.

**Where the facilitator reviews `pre_session` content — resolving open question 1 and
Priya's fragmentation concern together, since they're the same question:** for this
change, the facilitator reaches the review by following the navigate link above, i.e.
on `SessionLobbyPage` — the same page `pre-session-action-item-review`'s Decision 3
already built the review UI on, authorized via the same
`evaluateSessionSubscriberAccess` grant that already gives the facilitator standing
there (see §4). Building a second, `DraftSessionHost`-native render of the review —
Marcus's option (b) — is real, non-trivial work this change doesn't take on:
`DraftSessionHost` has no WebSocket subscription today (§1), and Decision 3 made
subscribe-before-fetch ordering a hard requirement specifically to prevent stranding a
participant on a stale branch after a transition. Reproducing that safely inside
`DraftSessionHost` means reimplementing correctness-sensitive logic a second time, not
copy-pasting a render.

I'm not dismissing Priya's concern by declining that work now, though — she's right
that this means the facilitator's `pre_session` review happens on a screen with a
different heading and voice than `DraftSessionHost`, and that she'll hit that path in
normal use (sharing her own join link), not just via a stale bookmark. My call: this
change closes the dead end via the navigate link, and treats full consolidation onto
`DraftSessionHost` (Marcus's option (b)) as the design stage's next concrete question —
I'd frame the default expectation as "a near-term follow-up change," not an
unscoped someday. Until that follow-up lands, `SessionLobbyPage`'s facilitator Start
Session path (`branch.isFacilitator`) is **not** defensive-only dead code — under this
change's own decision, it's the facilitator's real `pre_session` path, exercised every
time the navigate link is used or a facilitator follows their own join link. I was
wrong to call it "defensive/secondary" in my first pass, for the citation reason below.

**Withdrawing a citation:** I'd justified calling `SessionLobbyPage`'s facilitator path
"defensive/secondary" by citing "the access-model statement... spec'd as required 'in
both' surfaces unconditionally (Decision 8, `pre-session-action-item-review` task
7.1)." Marcus checked this against the archived `design.md`/`tasks.md` directly (BA
review item 2) and it isn't there — decisions run 1 through 7, tasks run through 6.7,
and the phrase "required in both" doesn't appear anywhere in the archive. I re-checked
it myself and confirmed the same thing. Withdrawing that citation entirely. What the
archive actually supports — Decision 3's real language — is narrower but still holds
up: the review endpoint resolves `isFacilitator` at *every* session status, not only
`pre_session`, "so the frontend has one source of truth for 'am I this session's
facilitator'" (Decision 4), and `SessionLobbyPage`'s Start Session control and
facilitator standing there are real and pre-existing, not something this change
invents. That's an inference from Decision 3, not a citation to a decision I can't
produce — and it's the correct basis for the "not dead code, real standing" claim
above, not the withdrawn one.

**Copy/layout reconciliation (Priya's review, §1):** given the decision above — the
facilitator now *will* land on `SessionLobbyPage` in normal use — the heading/copy
mismatch Priya documented (`DraftSessionHost`: team name heading, "The room is open.
Session status: lobby."; `SessionLobbyPage`: "Session Lobby" heading, "Session
{sessionId} — waiting for the facilitator to start.") stops being a latent
inconsistency and becomes something this change's own decisions actively route a
facilitator into. Splitting the scope rather than punting all of it:
- **In scope now:** align the Start Session control's label and the `lobby`-state
  heading/copy on both surfaces closely enough that landing on either one reads as the
  same product mid-transition. This is a copy/labeling change on two components this
  work already touches, not a redesign or a shared-component refactor.
- **In scope now (Priya's §5, smaller ask):** drop the raw `sessionId` from
  `SessionLobbyPage`'s engineer-facing waiting copy and add a one-line reassurance
  ("The facilitator will start the session shortly").
- **Deferred, named explicitly:** making the join-link redirect *facilitator-aware*
  (Priya's Q1 option (a) — a facilitator's own link always lands them on
  `DraftSessionHost` instead of `SessionLobbyPage`) is genuinely separate routing
  logic — it requires the join-link redemption path to resolve facilitator identity
  *before* deciding the redirect target, which the seven-status enumeration in §2
  doesn't touch. Real follow-up, not a copy fix; not folding it into this change.
- **Deferred, named explicitly:** the "N people have joined" presence signal (Priya
  §3) and a line of copy differentiating "Open the room" from "Start Session" (Priya
  §2) are both cheap, both reasonable, and both out of scope for a routing-gap fix —
  logging them as named follow-ups rather than silently absorbing or silently
  dropping them.

## 6. Open questions for the design stage (updated after BA + Facilitator review)

**Resolved in this revision — see §5 for the concrete decisions:**
- Does `DraftSessionHost` need to render the `pre_session` review itself, or is
  directing the facilitator to `SessionLobbyPage` acceptable? Resolved: for this
  change, a navigate link on `DraftSessionHost` sends the facilitator to
  `SessionLobbyPage` for the review. Full consolidation onto `DraftSessionHost`
  (Marcus's option (b)) is named as the design stage's next concrete question, not
  left as an unscoped "someday."
- Should the join-link landing rule change go through `join-link`'s own spec or land
  as a delta inside this change? Resolved: this change owns it, as a full replacement
  of the existing requirement enumerating all seven `SessionStatus` values (§2), not a
  two-status patch.
- Is `SessionLobbyPage`'s facilitator Start Session path defensive or should it be
  actively exercised? Resolved: it's primary, not defensive, under this change's own
  routing decision — exercised via the navigate link and via facilitators following
  their own join link, not left as a "resume" nicety.

**Still open for the design stage:**
- Should the `DraftSessionHost`-native review (Marcus's option (b)) be scoped as a
  concrete near-term follow-up change, or is it far enough out that it goes back into
  the general backlog? I'd push for naming it as a near-term follow-up given Priya's
  fragmentation concern is real, not hypothetical, but the sequencing call belongs to
  the design stage, not exploration.
- Should the join-link redirect become facilitator-aware (Priya's Q1 option (a), a
  facilitator's own link always landing them on `DraftSessionHost`)? Named as a real
  follow-up in §5, not resolved here.
- Whether a `wrap_up`-status session should land on `/team/:teamId` under the
  seven-status rule in §2, or whether that silently excludes a legitimate case —
  Marcus's open question, genuinely unanswered here.
- The scope of copy/layout reconciliation beyond the narrow slice named in-scope in §5
  (heading/button-label alignment, dropped session ID, reassurance line) — e.g.
  whether the two surfaces should eventually share a component for the `lobby` state
  rather than just matching copy independently.
- Presence signal ("N people have joined") and Start-Session-vs-Open-the-room
  differentiating copy (Priya §2/§3) — both named follow-ups, not scheduled.

**Non-goal, explicit (Marcus's item 4):** existing team members who are not following
a fresh join-link click have zero way to discover a session in `lobby` or
`pre_session` — `TeamPage` has no session-awareness at all (§1), and this change's
join-link rule fix only helps someone who clicks a link. This gap predates this issue
and is out of scope here; it should be named as an explicit non-goal, with this
reasoning, in this change's proposal.md rather than left implicit.

## 7. Ritual-fidelity check (my usual pass)

No constraint here touches the no-manager rule, the simultaneous reveal, or the
facilitator-from-another-team requirement — this is plumbing, not ritual mechanics.
The relevant risk is the one I keep coming back to across these explorations: a
feature that is *built and tested* but *not reachable* looks done in every dashboard
that counts commits or test coverage, and isn't done in the one sense that matters —
whether a real team, one I've never talked to, can actually run a session end to end
without it silently stalling in `lobby` forever. That's precisely my "adoption
declared a success too early" concern, and precisely why I want this fixed by
connecting the real thing rather than deleted because nobody happened to be standing
in front of it yet.
