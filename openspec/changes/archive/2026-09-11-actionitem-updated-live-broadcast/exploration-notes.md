# Exploration Notes — Live `actionitem.updated` WebSocket Broadcast (FR-3.3, issue #95)

**Explored by:** Devon Calloway (Internal Champion / founding SME), in `opsx:explore` mode.
**Change slug:** `actionitem-updated-live-broadcast`

This is thinking-time, not a proposal. Nothing here is committed. My read of this one is that the issue as written is solvable, but it is scoped as if it stands alone, and it doesn't — it has a silent prerequisite that isn't named anywhere in #95 itself. That's the finding I most want the BA and architect to see before anyone starts writing tasks.md.

---

## 1. Grounding: what FR-3.3 is actually for

BRD, FR-3.1–FR-3.5 is one cohesive use case ("prior commitments are reviewed before new ones are made"):

- FR-3.1 [HARD] — surface open/in-progress action items before the first topic
- FR-3.2 [HARD] — the *owner* (or the facilitator, for any team item) can transition status: Open→In Progress, Open→Resolved, In Progress→Resolved
- **FR-3.3 [PREF]** — those status changes should appear live to everyone else in the room, no refresh
- FR-3.4 [HARD] — facilitator (only) advances past review
- FR-3.5 [HARD] — empty-state fast path

FR-3.3 is the softest requirement in that cluster by design — it's a "nice, but the ritual survives without it" property. The one instance of it already deferred once (issue #91 → split into #94 + #95) precisely because it wasn't proportionate scope next to a [HARD] compliance gap. That history matters: this is the second time this event has been offered up as "small enough to bolt on," and both times it turned out to have more attached to it than the headline suggests. I want to make sure this pass doesn't repeat that.

The mechanics here don't touch any of the five load-bearing ritual constraints I care most about (simultaneous reveal, no-manager participation, facilitator-from-another-team, topic-default restorability, cross-person comparison). Action item status is team backlog housekeeping, not psychological-safety content. So this isn't a "protect the ritual's teeth" review. It's a "don't let plumbing drift out of the spec's own conventions" review — which is its own kind of fidelity problem, just a quieter one.

---

## 2. The finding: #95 has no event to broadcast without #64

I went looking for where `action_items.status` actually gets written today. There is no write path anywhere in the codebase:

```
packages/backend/src/routes/content.ts     — GET only (read-only team action items)
packages/backend/src/routes/em-views.ts    — GET only, explicitly read-only EM view
packages/backend/src/routes/facilitator-sessions.ts — reads action items for pre-session
                                               display (fetchPreSessionActionItems);
                                               no status mutation anywhere in the file
```

`grep -rn "UPDATE action_items"` across `packages/backend/src` returns nothing. The `action_item_status_update` endpoint is a *separate, open, unscheduled* issue — **#64**, "Implement action item status update endpoint (engineer-owns-own, facilitator-any-on-team)," milestone "Action Item Management." It is the only place FR-3.2's status transition exists at all.

**#95 broadcasts a status change. #64 is the only thing that produces one.** Without #64, there is no trigger event, full stop — this isn't a "nice to have landed first," it's structurally required. #95's own issue body mentions #69 ("likely relevant") but never mentions #64. That's a gap I want named explicitly before this becomes a proposal, because it's exactly the kind of thing that turns into me getting pulled in mid-implementation to explain why the ticket doesn't make sense on its own — which is the outcome I've told the BA directly I don't want to be the failure mode here.

Worth noting for sequencing, not as a blocker on the exploration itself: #69 (the pre-session review screen, the actual *consumer* of this event) is also open and unscheduled, and its own issue text says it "can ship read-only first and get write controls once [#64] lands." So the realistic dependency shape is:

```
        (HARD, unscheduled)          (PREF, this change)         (HARD, unscheduled)
            #64  ───────status exists────▶  #95  ──────powers "live"────▶  #69
   status mutation endpoint          live broadcast              review screen (UI)
   + action_item_history row                                     can ship read-only
                                                                   without either
```

None of these three are scheduled. That's fine — it's not my job to schedule work — but whoever picks this up needs to see the chain, because implementing #95 against a mutation endpoint that doesn't exist yet means either (a) blocking, or (b) building #64's minimal write path as an unstated prerequisite inside what's supposed to be a WebSocket-catalog change. I'd rather that be a visible proposal decision than something discovered mid-task.

---

## 3. A second, sharper risk: #64 already claims "real-time propagation" as its own acceptance criterion

Issue #64's bullet list includes, verbatim: *"Real-time propagation to other session participants when viewed in a shared context."*

That's the same capability #95 exists to build. Two open issues currently each believe they own this. If #64 gets picked up first by someone who hasn't read #95, the natural thing to do is bolt on *some* real-time mechanism to satisfy that bullet — and there is no guarantee it follows the WebSocket spec's catalog conventions (typed envelope on `ws:events`, per-candidate delivery-time authorization inside the dispatcher, publish-after-commit ordering, a Registry row). The whole point of `websocket-specification` (issue #24) was to be the *one place* this catalog lives, specifically because five earlier specialist changes had already drifted on event naming before that document existed. An ad hoc broadcast built inside #64 without reference to this catalog is precisely the kind of drift that document was written to stop.

This needs a scope-boundary decision, and it needs to be visible in both tickets, not just resolved tacitly in someone's head:

- **Option A** — #64 ships the mutation + `action_item_history` row only; its "real-time propagation" bullet is edited to point at #95 as the tracked follow-on, not built inline.
- **Option B** — #95 is folded into #64 as one combined change, so the endpoint and its broadcast ship atomically and there's no window where the mutation exists without the event.

I lean toward B for the same reason I don't love "ship half a ritual mechanic and hope the other half follows": FR-3.2 [HARD] shipping without FR-3.3 [PREF] is a perfectly fine intermediate state (participants just refresh), but FR-3.2 shipping with a *second, non-catalog* real-time mechanism bolted on, which #95 later has to either adopt or rip out, is a worse outcome than either shipping separately in the right order or shipping together. But this is a proposal-stage sequencing call, not mine to make unilaterally — I'd want the BA and whoever's driving #64 to weigh in. What I do want captured now, in whichever change proposal moves first, is that #64's real-time bullet and #95's scope are the *same capability* and only one of them should implement it.

---

## 4. Delivery pattern: which existing event is this actually like?

I read through `ws-event-dispatcher.ts` to see which of the six existing dispatch patterns this new event should follow. It's not a clean match to any one of them, which is useful to notice up front:

| Event | Scope | Recipients | Phase gate |
|---|---|---|---|
| `vote_readiness_update` | session | facilitator only | pre_session/active |
| `session_state_change` | session | any valid grant (participant or facilitator) | none |
| `vote_revealed` | session | any valid grant | none (reveal-status gated per-topic) |
| `topic_history_update` | **team** | member or facilitator, **explicitly excludes admin** | none |
| `participant_joined`/`left` | session | **facilitator only** | none |

FR-3.3's own language — "visible to all session participants" — points at `session_state_change`'s shape: session-scoped, any valid grant (both participants and the facilitator see it), not facilitator-only like `participant_joined`. That's a meaningfully different recipient set than the two most recently-shipped events (#94's `participant_joined`/`left`), which are facilitator-only — I'd flag that explicitly so whoever implements this doesn't pattern-match to the most recent precedent instead of the correct one.

On phase gating: FR-3.1 is explicit that this review happens "before the first voting topic is presented" — i.e., strictly `pre_session`. I'd expect the dispatcher to gate on `sessionStatus === "pre_session"` the way `vote_readiness_update` gates on `pre_session`/`active`, just with a narrower window and a wider recipient set (all grant paths, not just facilitator).

**Open question this raises, not answered by the BRD:** should the event fire at all once the session leaves `pre_session`? I'd assume no — once voting starts there's no more review screen open to receive it, so it's a moot point in practice, but it's worth a design.md line rather than leaving it implicit, since a late status change made through some *other* surface (the EM action-items view, say) while a session happens to be mid-vote shouldn't awkwardly try to reach a screen nobody has open.

---

## 5. The harder architecture question: which session does the event belong to?

This is the one I think is genuinely unresolved and needs a design decision, not just a convention match.

`action_items.session_id` is the item's *originating* session — the session it was created in. It is **not** "the session currently reviewing it." Action items get reviewed at the start of whatever session happens to run next for that team, which is a different session entirely from the one they were created in. `fetchPreSessionActionItems` already reflects this — it queries by `team_id`, across sessions, not by any single `session_id`.

So when a status-change PATCH comes in, the mutation itself doesn't inherently know "which live pre-session-review screen, if any, is currently open and should hear about this." Every other session-scoped event in the catalog gets its `sessionId` for free, because it's triggered by something that's already happening inside that session's own request handler (a reveal, a topic advance, a connect/disconnect on that session's WS route). This one doesn't have that — the triggering action is a status PATCH keyed by `action_item_id`, not by session.

Two ways I can see to close that gap:

- **The frontend supplies session context.** The pre-session review screen already knows its own `sessionId` (it's the current session in `pre_session`); have the PATCH request carry it (route param or body field), validate that it's actually the requesting team's currently-pre_session session, and publish session-scoped to that ID. Matches every other session-scoped publish's shape most closely.
- **Team-scoped, `topic_history_update`-style.** Publish team-scoped instead of session-scoped; let dispatch reach anyone with a live team-content grant. Simpler trigger-side (no session-context plumbing needed on the mutation), but delivers to *any* connected team member, not just "session participants" as FR-3.3 literally says — e.g., someone with an idle EM-dashboard connection open would also receive it. That's a real deviation from the requirement's own wording, even if harmless in practice.

I'd lean toward the first — it matches FR-3.3's actual text and the session-scoped precedent every other pre-session-relevant event uses — but this needs the architect's eyes, not mine, since it also touches #64's endpoint contract (does the PATCH require a `sessionId`, and if so, is it validated against anything, or trusted from the client?). This is exactly the kind of decision I don't want made informally inside an implementation PR; it belongs in design.md with a stated rationale, the same way the `serverTimestamp` dispatch-time-vs-publish-time question got corrected on design-stage review rather than discovered in code review.

**Marcus (BA review) agreed with the lean and added the boundary cases the paragraph above doesn't cover — these need stated answers before tasks.md, not just the happy path:**

- **No session context supplied at all** (the FR-7.3 "owner updates outside of a session" case). Expected answer: the mutation succeeds normally; no broadcast is published, because there's no session channel to publish to. This should be a stated line, not inferred — "no `sessionId` → no broadcast" and "no `sessionId` → 400" are both plausible readings of an unstated requirement and produce very different endpoints.
- **A `sessionId` is supplied but doesn't validate** — team mismatch, session not currently `pre_session`, or session doesn't exist. My read, and Marcus's: the status mutation is authoritative and always succeeds on its own merits; a bad or stale `sessionId` only ever affects whether the broadcast fires, never whether the PATCH succeeds. This is the same "the mutation is the source of truth, the broadcast is a best-effort add-on" posture the participant-presence events already establish (§ ws-pubsub.ts's own comment: presence events aren't governed by publish-after-commit because there's no transaction backing them) — worth stating explicitly rather than assuming everyone reaches the same conclusion independently.
- **Mutation success must never depend on broadcast success**, full stop, as its own acceptance line — not just implied by the two bullets above. If the Redis publish fails for any reason, the PATCH still returns 200 and the status is still changed and history-logged. This mirrors the existing publish-after-commit discipline in `ws-pubsub.ts` (publish only ever happens after a successful commit, never the other way around, and a publish failure was never designed to roll back or block the write it followed).
- **Where does `sessionId` live on the request** — route param, body field, or query param? Pick one before tasks.md; it also determines what the REST API Contract doc entry (see §9 below) needs to show.

---

## 6. Payload shape and naming

Following the corrected-names convention this catalog already establishes (`participant.joined` → `participant_joined`, etc.), `actionitem.updated` is the *prior/conceptual* dot-notation name, not a wire name — same table pattern already used for `reveal.trigger`, `vote.locked`, `topic.advance`, etc. Whatever ships needs a real snake_case `WsEventType` member distinct from `topic_history_update` (which is a different, team-scoped, durable-history mechanism already spoken for). Something like `action_item_status_updated`, scoped to this event only — I'm not picking the literal string, just flagging that it must not collide with or be folded into `topic_history_update`'s existing `action_item_finalized` updateType, which is a different case (wrap-up finalization, not pre-session live update) despite the superficially similar name.

On fields: every existing payload in this catalog is minimal by convention — identity + status/timing, never more than the event needs (`VoteReadinessUpdatePayload` structurally excludes vote value; `ParticipantJoinedPayload` is identity + timestamp only).

**Resolved (BA review):** resolution note is excluded, full stop, for this change. Resolution-note capture is issue #65, unscheduled and separate, and — per §9 below — this change's own mutation only ever writes `resolution_note = NULL` to `action_item_history` regardless, so there'd be nothing to include even if the minimalism convention argument were weaker than it is. No longer an open question.

**One field decision the original pass under-specified, caught in review:** new status only, or previous + new? `session_state_change` — the delivery-pattern precedent §4 already recommends following — carries both `previousStatus` and `newStatus`, not just the new value. I'd expect this event to match that shape rather than newStatus-only: the mutation already has both values in hand, it costs nothing to include, and "Item X moved from In Progress to Resolved" is a better client-side render than "Item X is now Resolved" (which can't distinguish a forward transition from, say, a page that just missed an earlier update). Payload should carry `previousStatus` + `newStatus`, matching `SessionStateChangePayload`'s own shape.

---

## 7. Ritual-fidelity constraint (elevated from a note to a hard requirement after facilitator review)

I originally wrote this up as a "worth a sentence" flag. Priya's review is right that this undersells it, and I'm revising it upward — this is the same failure category as an outlier callout reading as surveillance instead of information, just on a different surface, and I already treat that one as load-bearing. If a status flip renders in front of the whole room the instant someone makes it, that's a person's in-progress work becoming a live, watched event. It's not vote content and it's not the no-manager-participation concern, so it doesn't join the five structural ritual constraints — but "the ritual should feel like a conversation, not a tool being run on engineers" is the lens I always apply, and this is squarely inside it.

**design.md needs a stated hard constraint here, not a sentence:**

- No toast, no animation, no sound, no color flash on receipt. The item's own row updates its state indicator, full stop.
- No layout reflow that draws the eye. If the pre-session list groups items by status (Open / In Progress / Resolved — a very natural UI choice for someone who hasn't sat in a live review), a status flip making an item visually jump sections mid-conversation is worse than a static badge changing color in place: it's motion, and motion pulls the room's attention exactly when the facilitator is mid-sentence talking through the list. This needs to be named as an explicit design question before anyone builds a status-grouped list, not discovered after.
- **Attribution, when the facilitator changes someone else's item.** #64's facilitator-any-on-team authority is correct and I'm not questioning it (§9) — but the live-broadcast side raises a question the mutation side doesn't: does the room see *who* made the change, or just that it changed? If the event/UI surfaces "Priya changed Bob's item to Resolved" live, that's not neutral information — it reads as an override performed in front of the team, a different social moment than Bob quietly updating his own item, even when the override is entirely legitimate. I'm not saying suppress attribution (it's sometimes exactly what's needed, e.g. updating on behalf of someone not in the room) — I'm saying design.md needs an explicit decision on whether/how attribution renders, in the same "informative, not performative" register the spec's existing non-spotlight requirement already uses for connection/error states. This is a genuine open design question, not something I'm resolving here.
- **Error states get the same treatment, explicitly.** §"Connection and error states follow a non-spotlight rendering principle" already exists in the shipped spec for connection/error UX — this event's failure path (a 403 because ownership was misjudged, a network blip mid-PATCH) should be named as falling under that same principle rather than left to be inferred. A quiet, local failure indicator on the one row; no room-visible error banner for a failed status update mid-review.
- **Explicit non-goal: informational only, never coupled to pacing.** FR-3.4 — advancing past action-item review — is facilitator-only, and nothing about this broadcast (e.g. "all items now resolved") should auto-advance the review or nudge the facilitator to move on. Worth a sentence in design.md now, specifically so nobody adds it later as a "nice touch" — tools deciding a meeting phase is "done" is exactly the kind of thing that erodes trust in the room.
- **No-op confirmation is a separate axis from room-quiet, and both need to hold.** §9's same-status no-op (no spurious event, no history row) is correct for what the *room* sees — but from the *acting person's* side, a same-status click that visibly does nothing can look indistinguishable from "the button didn't work." Quiet-to-the-room and invisible-to-the-actor are two different properties; I only want the first one. This is an open UX question for whoever builds the frontend piece, not something I'm resolving in this document — some kind of local, low-key acknowledgment (the row itself briefly confirms) rather than either a broadcast or silence.
- Whatever ships here should go through a live usability pass — watching it render during an actual walkthrough, not reviewing it as a static mock — before it goes in front of a real team. Flagging this as a proposal-stage task, not new functional scope.

None of this changes the underlying read: this is low-risk to the ritual's structural mechanics. It's a "make sure the plumbing doesn't quietly start performing at people" review, and I'd rather over-specify the rendering register now than have someone reach for a checkmark animation later because it seemed like a nice touch.

---

## 8. What I'd want captured if/when this becomes a proposal

1. **Explicit dependency on #64** stated in proposal.md, not left implicit — #95 cannot ship a working event without #64's mutation existing to trigger it.
2. **A scope-boundary decision with #64**, visible in both issues, on who builds the actual `ws:events` publish (§3) — my lean is #64 does data + history only, #95 (or a combined change) does the broadcast, but this needs the BA/architect, not just me.
3. **A design.md decision on session-context plumbing** (§5) — how the mutation determines which session-scoped channel to publish to, since `action_items.session_id` doesn't answer that question by itself.
4. **Delivery pattern**: session-scoped, any valid grant (participant + facilitator), gated to `pre_session` — matching `session_state_change`'s recipient breadth, not `participant_joined`'s facilitator-only precedent (§4).
5. **Registry + Requirement flip** in `openspec/specs/websocket-specification/spec.md`: Event Registry row (currently line 28) from NOT IMPLEMENTED → Implemented; corrected-names table row (currently line 50) updated; the "documented future-state entry" Requirement (currently the last one in the file, lines 268–276) rewritten to describe the shipped behavior, mirroring how the `participant_joined`/`participant_left` Requirement reads now. The automated conformance test (`packages/shared/src/__tests__/websocket-spec-conformance.test.ts`) will fail CI the moment the new `WsEventType` member ships without this — that's a reminder built into the process, not a bug, and it's worked exactly as intended the last time this shape of change landed (#94/#98).
6. **Payload minimalism**: status + identity + timestamp by default; resolution-note inclusion is an open question for the BA, not assumed (§6).
7. **A one-line non-spotlight rendering note** for whoever owns the frontend piece of this, if/when it's built (§7).

None of this changes my basic read: FR-3.3 is fine to build, it's genuinely low-risk to the things I protect most, and the [PREF] label is doing its job — this isn't urgent. What I don't want is for it to get picked up as "just a broadcast, we've done five of these already" and then stall half-implemented because the prerequisite endpoint turns out not to exist. That's a worse outcome than just leaving it deferred a while longer.

*(This list predates the scope-fold decision in §9 and the facilitator/BA review pass in §10 — those sections carry the current, more specific set of acceptance conditions. Leaving this list as-is rather than rewriting it, since it's still an accurate record of where the thinking started.)*

---

## 9. Resolution: scope decision (post-exploration)

The scope-boundary question in §3 was put to the user directly. **Decision: fold #64 into this change.** Option B from §3.

This change now delivers, as one atomic unit:

- **From #64** — `PATCH /api/v1/action-items/:id` (or equivalent): engineer-owns-own with server-side ownership enforcement (403 if not owner), facilitator-any-on-team, same-status no-ops handled gracefully (reset staleness clock, no spurious event/history row), and an `action_item_history` row written on every real change. Source use cases: "Engineer Updates Status of an Action Item They Own" and "Facilitator Updates Status of Any Action Item" (`requirements/use cases/07 - Action Item Management - Use Cases.md`, duplicated in `03 - Pre-Session Action Item Review - Use Cases.md`).
- **From #95** — the live `ws:events` broadcast of that status change, following this repo's catalog conventions, per §4–§6 above.

Rationale (unchanged from §3): the mutation should never exist without the correctly-cataloged event sitting next to it. Shipping them together removes the window where someone could bolt an ad hoc real-time mechanism onto #64 that doesn't follow the `websocket-specification` catalog.

Scope explicitly still excludes, per this decision and §6: resolution-note payload inclusion (issue #65, unscheduled, separate feature) and the #69 pre-session review screen UI (separate, unscheduled, consumes this endpoint/event but is not built here).

The proposal stage should treat #64 and #95 as a single combined change and should update both GitHub issues to reflect that they're being delivered together, rather than leaving #64 looking like separate, still-open work once this change ships.

---

## 10. Review pass (Priya, Facilitator SME; Marcus, BA) — what changed and one point of friendly pushback

Both reviews came back well-aligned with the exploration as written — neither pushed back on direction, both added specificity to places where §9 stated an outcome without stating its edges. I've folded the concrete ones inline above (§5's three boundary cases, §6's payload-field decision, §7's elevation to a hard constraint plus attribution/error-state/no-op/pacing additions). This section covers what's left: the items that are genuinely new acceptance conditions rather than rewordings, plus the one place I want to push back rather than just fold in.

**From Marcus (BA) — new acceptance conditions for #64's mutation, not previously stated:**

- **Facilitator authority scope needs one explicit answer, not two live readings.** The two source use cases don't agree: "Engineer Updates Status..." (`07`) frames the owner's path as usable inside or outside a session, while "Facilitator Updates Status of Any Action Item" (`03`) is explicit that *"[the facilitator's] ability to update items here is a session-scoped permission, not a general administrative one."* My own read, for what it's worth beyond just flagging the ambiguity: the session-scoped reading is the one I'd want to win. It matches the same instinct behind the facilitator-from-another-team requirement — facilitator authority in this application is earned by *actively running a session*, not held standing, and a team-wide always-on write grant on another team's backlog is a broader permission than anything else a facilitator holds anywhere else in this system. The proposal needs to pick one explicitly (I'd expect: a facilitator's PATCH succeeds only when they're the facilitator of that team's currently-`pre_session` session; otherwise 403 with a reason distinguishable from "not the owner"), not leave both use cases' language standing unreconciled.
- **Name the field "reset the staleness clock" actually touches.** §9 said "reset the staleness clock" as an outcome; it needs to say `action_items.updated_at` (or the equivalent it resolves to) as the mechanism, since the staleness UC describes a read-time computation over elapsed sessions since last update, and "no history row on a no-op" only leaves the clock correctly reset if some other column is still the one being bumped. This is a one-line acceptance criterion, not a design decision, but it needs to be a stated line.
- **`action_item_history`'s exact contract for this change**, cited against the real schema (`packages/backend/migrations/2_create_tables.sql:152-161`, which already has `previous_status`/`new_status`/`resolution_note`/`session_id`/`changed_by_user_id`/`changed_at`): `resolution_note` always `NULL` here (§6); `session_id` populated with the resolved session ID exactly when §5's session-context decision says a session was in play, `NULL` otherwise; `changed_by_user_id` is the acting user (not the item's `owner_id`) — worth calling out that this is what finally closes the "actor visible in history" open question from the action-item-history UC, not just an implementation detail. Also: history-row write and the `action_items` row update need to be in the same transaction — not stated anywhere in my original pass, should be.
- **Status-transition validity is a real gap I missed entirely.** FR-7.3 forbids backward transitions, and the owner-update UC's precondition goes further — a `Resolved` item isn't a valid PATCH target at all through this flow, which means a same-status no-op on an already-`Resolved` item is a different case from the no-op discussion in §9, not covered by the same "gracefully handled" language. This needs its own stated response code for an invalid-transition attempt. `409 Conflict` has a direct precedent in this codebase (FR-7.1a uses it for a state-invalid delete attempt), and I'd default to reusing it for consistency — but Marcus is right that the final call belongs to the architect, not to either of us informally.
- **The REST API Contract doc** (`requirements/design/REST API Contract.md`) has no entry for this endpoint. That's the same documentation-completeness gap pattern the websocket-specification spec already flagged and left open for the reveal-latency endpoint (§121–125 of that spec) — I don't want this change to repeat it silently a second time. Should be a named proposal task, not folded silently into "build the endpoint."

**Where I'm pushing back, gently: the BRD/UC staleness-threshold inconsistency shouldn't get resolved by implementation choice, even a sensible one.**

Marcus is right that FR-7.4 (single threshold, "two sessions without a status change") and the UC files (three-color graduated scale at 1/2/3+ sessions) don't agree, and right that this change shouldn't regress whichever one is correct. Where I'd add a condition rather than just agree: his recommendation is "use the UC's graduated scale... and treat FR-7.4's language as superseded" — reasonable as a practical default, but that's still a document conflict getting settled by an implementer's judgment call embedded in code, not by the BA formally correcting the source. That's exactly the kind of quiet drift I keep flagging in this document for other reasons (§3's "don't let plumbing drift from the catalog's own conventions"), just applied to the BRD instead of the WebSocket spec. I don't think this change should try to resolve it — Marcus already agrees it shouldn't — but I want the proposal to additionally file the BRD/UC reconciliation itself as a named follow-up documentation task for the BA, not just leave "use the UC reading" as a comment in someone's PR description. And on the implementation side: whatever this change's reset logic writes (§ above — I'd expect `action_items.updated_at`, a plain timestamp) shouldn't itself hard-code either threshold model. Bumping a timestamp is neutral to both readings; that's the right amount of commitment for this change to make.

**Everything else stands as reviewed — no other pushback.** Both reviewers stayed inside FR-3.3's actual footprint, neither proposed anything that broadens what this change touches beyond what #64's own FR-7.3 obligations and #95's broadcast already required, and nothing either of them asked for trades away any of the five structural ritual constraints, the non-spotlight principle, or the facilitator-boundary instincts I came in with. The combined change (§9) has grown a fair amount in this pass — a full authorization-model statement, transition-validity handling, a REST contract doc update, explicit attribution/error-state design constraints — and I want to name that growth rather than let it pass silently, since "proportionate scope" is the exact reasoning that deferred this work the first time (§1). But looking at what actually grew: none of it is net-new functionality. Ownership enforcement, transition validity, and the staleness reset were always implicit in FR-7.3 and #64's own stated scope — this pass just stopped leaving them implicit. That's the right kind of growth for a proposal to absorb at this stage, not scope creep.
