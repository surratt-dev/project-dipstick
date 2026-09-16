# Exploration Notes: Pre-Session Action Item Review

**Explored by:** Devon Calloway (Internal Champion / SME persona)
**GitHub issue:** #69 — "Build pre-session action item review screen (facilitator + engineer view)"
**Scope for this change:** READ-ONLY review screen only. List of open/in-progress action items with owner + staleness, a facilitator-only "Begin First Topic" control, and a skip/empty-state path. Status-update controls (owner or facilitator changing an item's status from this screen) are explicitly OUT of scope here — see "Scope discipline" below for the concrete follow-up commitment and why this is a named partial implementation of UC1, not routine phasing.

---

## Why I care about this screen specifically

This is the one moment in the whole application where the tool has to *say something back* to the team about whether last session's commitments actually happened. Everything else in the ritual — voting, the simultaneous reveal, the facilitator from another team — is about getting an honest read on how the team feels *right now*. This screen is where the accountability loop *starts* to close — surfacing what's open, who owns it, how stale it's gotten. If this screen is weak, sloppy, or absent, action items become a thing people write down and never think about again, and the whole "trend dashboard shows sustained improvement" story I've been selling to the VP has no mechanism underneath it.

**Correction to my own framing, per BA review:** a read-only screen *displays* the loop's current state; it doesn't *close* it. Closing it requires the status-update interaction this change defers (see "Scope discipline" below). Read-only-first is still the right build sequence, but whoever signs off on the proposal should know explicitly that the value proposition I'm describing here isn't fully realized until the deferred write path ships — this change is a necessary step, not the whole mechanism.

So the bar isn't "does it render a list." The bar is: does it make the accountability loop feel real without turning into a status report a manager would ask for.

Two of my standing concerns are directly in play here:

- **Not a performance tool.** This screen shows an owner's name next to an item that's been open for three sessions. That is close to the line I care about most. It's fine *because* it's scoped to one team's own session, visible only to that team's own engineers and a facilitator who isn't from this team — never aggregated, never comparable across teams or across owners. I checked this structurally, not just by assumption (see below).
- **Disappearing into the background.** Staleness color-coding is useful, but it's exactly the kind of feature that turns into a shame-inducing dashboard if the visual treatment or copy leans punitive. "This has been open a while" reads differently than a red badge with no explanation. This is a design-review-time concern, not a blocker, but it should show up in design.md.

---

## What's actually already there (backend)

`fetchPreSessionActionItems` in `packages/backend/src/routes/facilitator-sessions.ts` (SESSION-004) is real and does the right query: `status IN ('open','in_progress')`, joined only against `sessions.status = 'complete'` (so an in-flight wrap-up's draft items don't leak in), ordered oldest-first, staleness computed live off `application_settings.staleness_threshold_sessions` (default 2) stepped at 1x/2x/3x into none/yellow/orange/red. This is returned as the body of `POST /api/v1/sessions/:sessionId/start`.

**Correction to the framing I was handed:** the task brief says write/status-update controls depend on "the Action Item Management milestone's status-update endpoint issue... not yet landed." That's stale. `PATCH /api/v1/action-items/:actionItemId/status` (packages/backend/src/routes/action-items.ts) already shipped — it's in the current `main` branch history (issues #64/#65/#95, commit `de07cea`, "implement action-item status updates and live pre-session broadcast"). It already handles owner-or-facilitator authorization, valid-transition checks, resolution notes, audit logging, and a live broadcast (`publishActionItemStatusUpdated`) gated to sessions in `pre_session`/`active` status.

This doesn't change the scoping instruction I was given — ship read-only first is still the right call for *this* change, both because it's a smaller, cleaner PR and because the review screen's own layout/interaction design shouldn't be built and then immediately reworked to bolt on inline controls. But whoever writes the proposal should know the dependency they're deferring against **already exists**, so "get write controls once that lands" is really "wire write controls into this screen in a fast, cheap follow-up," not "wait on someone else's milestone." Worth saying explicitly in proposal.md so it isn't scoped as a large unknown.

**Per BA review, "fast, cheap follow-up" needs to be a commitment, not a hope.** Recommend proposal.md (or tasks.md) require filing a follow-up issue against this change *before merge*, scoped explicitly to: (a) rendering the already-built owner/facilitator status controls on this screen, (b) wiring them to the already-shipped `PATCH /api/v1/action-items/:actionItemId/status`, (c) no new backend work required. That turns "fast follow" from an intention into something traceable.

**Also per BA review — this deferral needs to be named against the requirements doc, not just described as an implementation phasing choice.** `requirements/use cases/03 - Pre-Session Action Item Review - Use Cases.md`, UC1 ("Surface Open Action Items at Session Start"), Main Flow steps 6–7 read:
> 6. Owners of action items are presented with inline controls to update the status of their own items.
> 7. The facilitator is presented with a control to advance past the review.

This change implements UC1 steps 1–5 and 7 in full, and defers step 6 (plus all of UC2 and UC3) to the follow-up above. That's a legitimate, deliberate scope reduction — but proposal.md should state it as exactly that, by name, not fold it into ordinary in-scope/out-of-scope bullets as if it were routine phasing. Six months from now, "why doesn't the review screen let me update anything" should have a documented answer.

## What's actually missing (this is the real finding)

The task brief undersells this as "render what the backend already gives you." That's true only for the facilitator, and only for the instant they click "Start." Here's the gap:

```
Facilitator clicks "Start Session"
        │
        ▼
  POST /sessions/:id/start  ──────► response body carries actionItems[] directly
        │                            (facilitator has everything, in-memory, right now)
        │
        ▼
  publishSessionStateChange (WS)
        │
        ▼
  session_state_change event ──────► delivered to OTHER participants
                                      (engineers already sitting in the lobby)
                                      payload = { previousStatus, newStatus, changedAt }
                                      NO action items in this payload
```

Engineers on `SessionLobbyPage` learn "we're in pre_session now" over the WebSocket, but there is **no REST endpoint they're allowed to call to actually fetch the action items list.** I checked the obvious candidate — `GET /api/v1/teams/:teamId/action-items` (content.ts, Task 5.3) — and it's the wrong shape: returns *all* items regardless of status, no staleness computation, no originating-session-number, ordered newest-first. It's built for a different purpose (looks like a general team content view) and isn't a drop-in.

Same gap applies to the "participant joins late during the review" alternate flow in the use case doc — a late joiner has no way to reconstruct current state on page load at all; there's nothing to fetch.

**This means the change needs a small backend addition, not just a frontend render:** a GET endpoint (e.g. `GET /api/v1/sessions/:sessionId/action-items-review` or similar) that:
- authorizes via `evaluateSessionSubscriberAccess(userId, sessionId)` (packages/backend/src/auth/session-subscriber-access-helper.ts) — already returns `{ path: 'facilitator' | 'participant', teamId, ... }` and already structurally excludes Engineering Managers (see next section), so this is reuse, not new authorization logic
- gates on session status being `pre_session` only (see "Scope discipline" below for the resolved default and rationale)
- calls the same `fetchPreSessionActionItems(teamId)` logic already in facilitator-sessions.ts (would need exporting/sharing, not rewriting)
- returns `{ actionItems, isFacilitator: grant.path === 'facilitator' }` — the `isFacilitator` flag doubles as the answer to the next gap

## Exit transition, verified: `begin-voting` already broadcasts the same way entry does

BA review flagged that I'd traced the *entry* transition (lobby → pre_session, via `session_state_change`) but never checked the *exit* transition — whether participants still sitting on the review screen actually get moved off it when the facilitator advances, per UC: Facilitator Advances ("transitions all participants' screens to the first topic simultaneously"). I checked. `POST /begin-voting` (facilitator-sessions.ts, ~line 704) calls `publishSessionStateChange(sessionId, { previousStatus: "pre_session", newStatus: "active", ... })` after commit — the identical mechanism and event shape used for the lobby→pre_session entry. So this isn't a gap: the frontend work for "leave the review screen on advance" is the same subscribe-and-react logic as "enter the review screen on start," just keyed on a different `newStatus`. Worth stating explicitly in design.md as one code path handling both transitions, not two.

## The other real gap: the frontend has no concept of "am I this session's facilitator"

`SessionLobbyPage.tsx` today renders a static message and nothing else — no session-state fetch, no role check, no WebSocket connection. `AuthSession` (packages/frontend/src/auth) carries global identity and per-team membership role, never per-session facilitator identity. The existing `/session/:sessionId/facilitator` route (FacilitatorConnectionHost) sidesteps this by being a separate route entirely — and even that host has a comment in App.tsx flagging it as a **known deferred gap**: no client-side facilitator check, tolerated today only because it renders hardcoded stub rows.

For this screen, "Begin First Topic" is facilitator-only per the use case's acceptance criteria ("Only the facilitator sees and can activate the control"). The backend already enforces this server-side on `/begin-voting` (checks `facilitator_id`), so a client-side bypass isn't a security hole — but the screen still needs to know whether to *render* the control at all, for every participant, not just the facilitator. The `isFacilitator` flag from the new GET endpoint above is the cleanest source for that, and conveniently reuses a check the codebase already trusts rather than inventing a second one.

## No-manager-in-session check: verified, not just assumed

I traced `evaluateSessionSubscriberAccess` directly rather than taking "it's session-scoped so it's fine" on faith. It has no admin path and explicitly rejects a caller whose `users.global_role` or `team_memberships.role` is `engineering_manager` on the participant path — matching the same dual-check pattern already used at session-participant registration and vote lock-in. An EM cannot be granted `facilitator` or `participant` access to this endpoint's data through any code path I found. Good — this screen doesn't need its own new EM-exclusion logic; it inherits a boundary the codebase already enforces correctly. This is the one place I looked hardest, given how much weight I put on this rule.

## Facilitator-from-another-team: not this screen's problem, confirmed

That constraint is enforced at session-creation / draft-eligibility time (`global_role = 'facilitator'` check in the `/draft` endpoint) and doesn't need re-litigating here. Noting only so whoever designs this doesn't feel obligated to re-derive it.

## A pre-existing rough edge worth flagging, not fixing here

`POST /begin-voting`'s "no topic configured" case (use case's alternate flow: "the application prevents the advance and surfaces an error indicating no topics are available") currently throws a bare `Error` inside the transaction, which will surface as an unstructured 500, not the graceful error the use case describes. This is a SESSION-005 gap, not something this change introduced or is obligated to fix — but the "Begin First Topic" control's error-handling design should not assume it gets a clean 4xx here. Worth a one-line mention in design.md's risks so nobody is surprised when the error path looks uglier than expected.

---

## Scope discipline for this change (explicit, for propose stage)

**In scope:**
- New frontend view (likely extending/replacing the pre_session-state rendering inside `SessionLobbyPage.tsx`, or a new page it routes to on the `pre_session` status) showing: description, owner display name, status label, originating session number, staleness color, for all open/in_progress items — read-only.
- Empty state ("no open action items") per the Skip Review use case, shown identically to engineers and the facilitator (minus the advance control for engineers).
- Facilitator-only "Begin First Topic" control wired to `POST /begin-voting`, which already broadcasts the exit transition via the same `session_state_change` mechanism used for entry (verified above) — no new event type needed.
- The new participant-facing GET endpoint described above (backend), since without it engineers structurally cannot see this screen's content at all. Per BA review, this endpoint's session-status gating should be settled now, not left open: **default to `pre_session`-only** (404/409 for a session in any other status). Rationale — UC1 frames the review as a one-way transition; a participant joining after voting has started sees the current topic, not a closed review. If that default is wrong, it needs its own acceptance criteria for what a late joiner sees instead, not a bullet inside an endpoint spec.
- A one-line, always-visible legend/tooltip explaining what the staleness colors mean (1/2/3+ sessions → yellow/orange/red), so a participant's first encounter with a red badge doesn't require the facilitator to explain it live. Raised by facilitator review — the color scale is fixed and already a decided requirement, so this is a copy/UI addition, not new logic.
- A one-line, non-judgmental summary at the top of the list (e.g. "3 items need attention") so the facilitator can absorb the state of the room before reading line by line, rather than scanning a long list for the stale ones. Raised by facilitator review, same "reduce what the facilitator has to hold in their head" principle already applied to the readiness grid elsewhere in the product.
- Defined error/failure states, per BA review — the use cases specify these and nothing in this change's scope covered them until now:
  - Participant-facing GET endpoint fails → explicit error state shown to that participant, not a blank screen or infinite spinner.
  - Facilitator's `POST /start` action-items payload is missing/errored → "Begin First Topic" stays disabled until data loads successfully (session must not advance to voting on a failed query, per UC1's postcondition).
  - A staleness-computation failure degrades to "no indicator shown" for that item, not a blocked screen.
- Draft copy for the empty state and each staleness tier (badge/label text, not just the color) reviewed and approved before this change is considered ready for implementation — per BA review, this was previously an aspiration in my own concerns section, not a gate. Making it one.

**Deliberately left as an open design.md decision, not scope, not settled here:**
- Item ordering. UC1's own Notes flag oldest-first as an unconfirmed assumption, and the exploration doesn't get to resolve it by observing what the code already does. Facilitator review pushes for stale-first (red → orange → yellow → none, age as tiebreaker), arguing chronological order makes the facilitator do the scanning the color-coding exists to save them from. I find that argument compelling but it's a stakeholder-confirmation item per the use case's own note, not something exploration should decide unilaterally — proposal.md should record whichever ordering is chosen as a **confirmed product decision**, with Priya's input as part of that confirmation, not carry it forward as an inherited default a second time.
- Whether this screen is purely informational or allows the facilitator to flag an item for live discussion the way outlier votes get flagged during voting. Facilitator review raised this, and I'm deliberately **not** folding it into this change's scope, for two reasons that both matter to me: (1) this would be a third interactive capability layered onto a screen that was scoped read-only specifically so its layout wouldn't need reworking for inline controls, and BA review has already flagged this change's scope boundary as something to state carefully rather than let drift; (2) every control this screen grows is a control that has to earn its place against my standing worry that this application makes the ritual feel like software being run on engineers rather than a conversation they're having — a discussion-flag affordance is exactly the kind of small, well-intentioned addition that accumulates into UI chrome if nobody is asked to justify it first. Neither reason means the idea is wrong. It means it needs its own acceptance criteria and a deliberate decision, not a default addition because it's easy to imagine. If design.md rules it out for this change, say so explicitly so it isn't rediscovered as a gap later, per Priya's own framing.
- Where this screen lives structurally (extend `SessionLobbyPage` to branch on session status vs. a new route/page for `pre_session`). Per BA review, this is an architecture question the use cases don't speak to at all — it shouldn't be carried into propose as an "open question" alongside genuinely unresolved product decisions like ordering or the discussion-flag question above. design.md should own it outright with a recommendation.
- Fetch-then-subscribe race: what happens to a status update landing in the gap between a client's initial GET and its WS subscription going live — for *every* initial page load, not just the late-joiner case. Facilitator review raised this as the same category of risk as trusting a stale snapshot with no reconciliation; it doesn't need vote-reveal-level rigor since nothing here is secret or simultaneous by requirement, but it does need an answer so two participants can't transiently see different lists.

**Explicitly out of scope (defer to a fast follow, not a distant milestone — see the concrete follow-up commitment above):**
- Inline status-update controls (owner changes their own item; facilitator changes any item). The endpoint for this already exists and works — this is a wiring task, not a design unknown, so it shouldn't be scoped with the caution due an unbuilt dependency. When this fast-follow lands, it should also resolve the use case's other open "assumed but should be confirmed" item: what a losing concurrent update (owner and facilitator racing to update the same item) surfaces to the person who lost the race. Facilitator review flagged this as the same "don't let the system silently decide something a human should be told about" principle behind reveal integrity — worth deciding before that follow-up is built, not discovered by a confused engineer mid-session.
- Any change to how staleness thresholds are configured.
- Any change to the "no topic configured" error path noted above.
- Reconciling `SessionConnectionHost`/`FacilitatorConnectionHost`'s stub/demo status into a real end-to-end session journey — this change only needs to solve the pre_session phase, not the whole lobby→active routing story.

---

## Open questions I'd want answered before this goes to propose

1. ~~Does a late joiner arriving during `active` need to see the resolved pre-session review?~~ **Resolved above**, per BA review: default is no — the endpoint gates on `pre_session` only. Recorded as a default, not a permanent answer; revisit if a real late-joiner-during-voting scenario turns up demand for something else.
2. ~~Where does this screen live structurally?~~ **Reframed above**, per BA review: this is a design.md architecture decision, not an open requirements question. Still unresolved, but it's design's to own with a recommendation, not propose's to answer.
3. Item ordering — chronological (as currently implemented) vs. stale-first (as facilitator review argues for). See "Scope discipline" above; needs explicit stakeholder confirmation per UC1's own Notes section, not an inherited default.
4. Is there room for the facilitator to flag an item for discussion from this screen, or is it intentionally read-and-advance only? See "Scope discipline" above — I'm deliberately not adding this to scope, but design.md should answer it explicitly either way.
5. Fetch-then-subscribe timing: what does a client do with a status update that lands between its initial GET and its WS subscription going live? Applies to every page load, not just the late-joiner case.
6. When the deferred write path lands: does a losing concurrent update (owner vs. facilitator racing on the same item) surface any signal to whoever lost the race, or does it just silently not take effect?

## Feedback resolved, for the record

One open item from UC2/UC3's own Notes section is answered by this exploration, incidentally: whether facilitator/owner status changes get audit-logged. They do — the shipped `PATCH /api/v1/action-items/:actionItemId/status` endpoint already logs them. Worth recording as answered when UC2/UC3 are eventually revisited for their own proposal, so it isn't re-asked.
