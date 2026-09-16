# Architecture Review — pre-session-action-item-review implementation

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Basis:** design.md (this change), read against the actual code in
`packages/backend/src/routes/facilitator-sessions.ts`,
`packages/frontend/src/pages/SessionLobbyPage.tsx`,
`packages/frontend/src/components/PreSessionActionItemReview.tsx`,
`packages/shared/src/types/session.ts`, `copy.md`, and supporting test files.
Every claim below was checked against the code directly, not taken from
tasks.md's prose.

## Verdict

**Matches the design.** No boundary violations, no undocumented deviation
from the decisions record, and the two items design.md itself flagged as
unresolved (item ordering, copy sign-off) are still correctly presented as
open — not quietly settled by the implementation. I have one naming/location
nit and one soft observation on copy tone; neither blocks this.

## Verified against design.md, point by point

**Decision 7 — `computeStalenessLevel` fixed mapping.** Confirmed at
`facilitator-sessions.ts:89-96`: compares the literal 1/2/3 boundaries
(`>=3` red, `>=2` orange, `>=1` yellow, else none), no `threshold` parameter,
no read of `application_settings.staleness_threshold_sessions`. The
orphaned-setting consequence design.md names explicitly is accurate — the
setting's row is untouched and genuinely unread. Test coverage
(`facilitator-sessions.test.ts:106-131`) asserts all four boundaries plus a
unary-arity guard against a future signature drift. This is a real fix, not
a relabeling — `POST /start` and the new GET share the same
`fetchPreSessionActionItems` → `computeStalenessLevel` path, so both
surfaces get the corrected mapping, as design.md's "consequences named
explicitly" section requires.

**New endpoint, `GET /api/v1/sessions/:sessionId/action-items-review`.**
Confirmed at `facilitator-sessions.ts:546-595`. Session-scoped path, no
`teamId`, matching the existing `/start`/`begin-voting` pattern rather than
the team-scoped facilitator routes — consistent boundary choice.
`evaluateSessionSubscriberAccess` is called unmodified (checked its own file
and its git history: last touched by an unrelated prior change, #28,
nothing here alters its contract or its no-admin-path/EM-exclusion
behavior). `fetchPreSessionActionItems` is exported and called with no
signature change beyond what Decision 7 already covers. The `409` gate is a
single uniform status read applied to both grant variants, exactly as
Decision 1 step 3 specifies — no branching on `grant.path` to decide whether
to run the query.

**`applyTimingFloor()` / `Cache-Control: no-store` on all three paths.**
Confirmed inline at each return site — 404 (line 556-557), 409 (580-581),
200 (591-592) — matching `content.ts`'s established pattern (clock started
at handler entry, floor applied immediately before every response, header
set on every path). Test file has dedicated regression coverage for exactly
this (`facilitator-sessions.test.ts:734-799`): timing floor invoked on all
three paths, `Cache-Control: no-store` asserted on all three status codes.
This is the right place to have put that coverage — it's the kind of
property that erodes silently if only spot-checked by hand.

**409 body — `currentSessionStatus` + `isFacilitator`.** Confirmed in
`ActionItemsReviewWrongStatusResponse` (`session.ts:113-116`) and populated
at `facilitator-sessions.ts:582-586`, with `isFacilitator` resolved from
`grant.path` before the status gate runs (line 567), independent of which
status is ultimately returned — matches Decision 1's claim that this field
"costs nothing" to include at every status, not only `pre_session`.
`currentSessionStatus` genuinely reuses the field name convention
`RevealFailureResponse`'s non-recoverable variant established, not just in
spirit — same field name, same type (`SessionStatus`).

**Frontend: single source of truth, no second status endpoint.**
`SessionLobbyPage.tsx` branches entirely off the one GET (lines 71-104):
`200` → `pre_session`, `409`/`lobby` → `lobby` branch, `409`/other →
`left`, `404` → `no-access`, network/5xx → `error`. No second call to
`evaluateTeamAccess` or any team-scoped status route exists anywhere in this
file. This is the resolution Decision 3 committed to over Marcus Oyelaran's
literal suggestion of a second endpoint, and it was actually built that way.

**Subscribe-before-fetch ordering.** Confirmed: `useConnectionHealth(connect)`
is invoked unconditionally in the same render (line 111), and the initial
`fetchReview()` effect (lines 113-115) does not gate on or wait for the
socket. Both start in the same render pass — the race design.md flags
(fetch resolves and renders a branch before the subscription is live,
stranding a participant on a stale branch) is closed the way Decision 3
specifies, not merely narrowed. The re-fetch-on-event handler (117-142)
re-runs the same `fetchReview` rather than trusting the WS payload directly,
which is the more conservative of the two options tasks.md 4.7 explicitly
permitted — one source of truth for branch determination, reinforced.

**Facilitator-only Start Session control, unmodified `POST /start`.**
Confirmed `handleStartSession` (144-166) calls `POST
/api/v1/sessions/:sessionId/start` with no new body/params, and the route
handler itself (`facilitator-sessions.ts:404-529`) is line-for-line the same
authorize→409-on-wrong-status→BEGIN/UPDATE/audit/COMMIT→publish shape as the
pre-existing `draft→lobby` handler — no behavioral change, exactly as
proposal.md's "no changes to `POST /start`'s... transition behavior"
commitment requires. The frontend explicitly does not consume this
response's `actionItems` payload (comment at line 157-160) — matches
Decision 3/4's reconciliation that the rendered screen is always fed by the
GET, never by `/start`'s response.

**`PreSessionActionItemReview.tsx` — read-only, matches Decision 4/5.**
Legend, summary line, empty state, per-item staleness badge all present and
sourced from `copy.md`'s approved-bar text (component comment at lines
12-16 is honest about sign-off status — see below). "Begin First Topic" is
gated on `isFacilitator` alone (no second gate against a `/start` payload
that was already reconciled away in Decision 4) and disabled while
`beginVotingPending`; `SessionLobbyPage` only renders this component at all
once the GET has already succeeded (branch `pre_session`), which is what
actually implements "disabled until the review GET has succeeded" — there
is no redundant loading flag threaded through, the component's mere
presence *is* the gate. That's a cleaner realization of Decision 5's
requirement than a literal boolean prop would have been.

**Shared types.** `ActionItemsReviewResponse` and
`ActionItemsReviewWrongStatusResponse` (`session.ts:99-116`) match the
response shapes Decision 1 specifies, including the deliberate reuse of
`StartSessionResponse["actionItems"]` as the item shape rather than
redeclaring it — one less place for the two payloads to drift apart.

## copy.md and Decision 6 — outstanding items correctly flagged, not settled

Both of Rachel Okonkwo's and the stakeholder-confirmation gates are honestly
represented as open, in the artifact itself and in the code that consumes
it:

- `copy.md`'s header states plainly that Rachel's sign-off "has NOT yet been
  recorded" and that this is "a documented gap, not a silent assumption of
  approval." `PreSessionActionItemReview.tsx`'s own header comment (lines
  12-16) repeats this rather than presenting the copy as final. Good —
  a reviewer skimming only the component wouldn't be misled into thinking
  this shipped with sign-off.
- Item ordering (Decision 6 / `sortForReview`) is documented the same way:
  design.md calls it "NOT a live stakeholder confirmation," and the
  component comment (lines 18-22) repeats that framing and points at the
  one function to flip if the answer comes back the other way. That
  isolation claim checks out — `sortForReview` (lines 63-69) is a pure
  function operating only on the already-fetched array; reverting to
  chronological is a one-line change with no ripple into the fetch, the
  endpoint, or the type shapes.

Neither of these reads as quietly settled. Both are named as decisions
pending real confirmation, in the place someone would actually look.

**One soft observation on tone, not a blocker:** copy.md's own stated
constraint is "descriptive, not evaluative... no judgment framing." The
summary line's stale variant — "N items need attention" — sits closer to
evaluative than the rest of the copy (the staleness tiers and empty state
are cleanly descriptive: "carried over N sessions"). "Need attention"
implies a should, which is a mild step toward the performance-tool framing
Rachel's concern was about. This is exactly the kind of judgment call her
sign-off exists to make, and the gate is already correctly open — I'm
flagging it so it's on her radar as a specific line to look at, not
asserting it needs to change.

## Boundary and pattern consistency

- Session-scoped vs. team-scoped route pattern: respected (Decision 1's
  stated reasoning holds up against the actual route table in this file).
- No authorization logic duplicated or reimplemented in the frontend —
  `isFacilitator` is a rendering signal only, and both `/start` and
  `begin-voting` independently re-check `facilitator_id` server-side
  (confirmed at lines 438-446 and 646-654). A client bypass of the button's
  visibility cannot reach a state the server wouldn't already reject.
- No admin path, no EM path added anywhere in this endpoint — inherits
  `evaluateSessionSubscriberAccess`'s existing exclusions rather than
  reintroducing a parallel check.
- F3's accepted trade-off (participant grant path re-reads session status
  as a second query, small TOCTOU window against the grant's own snapshot)
  is exactly the trade-off named in design.md's Risks section, and the
  alternative it rejected (adding `sessionStatus` to the shared
  `SessionSubscriberGrant` participant variant) was correctly left alone —
  I checked `ws-event-dispatcher.ts`'s `dispatchActionItemStatusUpdated`
  comment referenced there, and it does document reliance on that field's
  absence, so not touching it was the right call.

## One nit — non-blocking

Design.md Decision 6 names the sort step's location as
"`packages/frontend/src/pages/ReviewList`'s sort step." No such file
exists; `sortForReview` actually lives in
`packages/frontend/src/components/PreSessionActionItemReview.tsx`. The
function itself, its isolation, and its behavior all match the decision —
only the file path in the prose is stale, most likely because the
component's final location/name settled after that paragraph was written.
Worth a one-line fix to design.md so a future reader isn't sent looking for
a file that isn't there, but it's a documentation-accuracy issue, not an
implementation defect.

## Items outside my scope, noted only for completeness

Copy sign-off and ordering confirmation are Rachel Okonkwo's and the
product stakeholders' calls, not mine — my only interest above is that the
implementation didn't quietly close either gate on its own.
