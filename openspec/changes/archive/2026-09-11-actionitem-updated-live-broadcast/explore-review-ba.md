# BA Review — Exploration Notes: `actionitem-updated-live-broadcast` (#64 + #95, combined)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `exploration-notes.md`, this change
**Grounded against:** `requirements/BRD.md` (FR-3.1–FR-3.5, FR-7), `requirements/use cases/07 - Action Item Management - Use Cases.md`, `requirements/use cases/03 - Pre-Session Action Item Review - Use Cases.md`, `packages/backend/migrations/2_create_tables.sql`, `openspec/specs/websocket-specification/spec.md`

---

## Overall read

Devon's exploration is thorough and the dependency finding in §2 is correct and important — I agree #64 and #95 need to ship together, and I agree with the Option B call in §9. The delivery-pattern analysis (§4) and the ritual-fidelity note (§7) are both good and need no rework from me.

Where I want more before this goes into proposal.md: the notes correctly identify the *existence* of several open questions (ownership enforcement, no-op semantics, history row shape, session context) but in a few places they resolve just far enough to sound decided without actually being buildable. §9 in particular reads as a scope summary, not a requirements summary — it tells the team *what* ships but not always *how it behaves at the boundaries*, which is where engineers come back to me. Below is what I'd tighten before tasks.md gets written, organized by the five areas the team asked me to focus on, plus one gap I found that wasn't on that list but is load-bearing (status-transition validity).

---

## 1. Ownership enforcement / 403 behavior

**What's in the notes:** §9 says "server-side ownership enforcement (403 if not owner), facilitator-any-on-team." That's a correct outcome statement but it elides a real authorization-model question underneath it.

**What's vague:** "facilitator-any-on-team" is doing a lot of work in that phrase, and the two source use cases don't agree on what it means:

- `07 - Action Item Management - Use Cases.md`, "Engineer Updates Status of an Action Item They Own" — trigger explicitly includes updates made **outside of any session** ("either during the Pre-Session Action Item Review or, if supported, outside of a session"). This is a generic, session-independent REST capability for the owner.
- `03 - Pre-Session Action Item Review - Use Cases.md`, "Facilitator Updates Status of Any Action Item" — the facilitator's authority is framed as **session-scoped**, explicitly: *"The facilitator is from a different team than the one being assessed. Their ability to update items here is a session-scoped permission, not a general administrative one."*

Those two are not the same authorization shape. If the endpoint is a generic `PATCH /api/v1/action-items/:id` (as §9 proposes, matching FR-7.3's "at any time, inside or outside of a session" for owners), then what makes a facilitator "any-on-team" for a *non-session* PATCH call? There's no standing "facilitator of record" for a team in the BRD's role model (FR-1.3 defines Facilitator as someone who *leads sessions* for other teams, not someone permanently assigned to one) — the only facilitator authority described anywhere is scoped to a session they are actively running. OR-6.4 ("multiple facilitators per team... equivalent access to session history") is about *history access*, not about a standing status-update grant outside a session.

**Concrete acceptance conditions I'd want stated before this is buildable:**

- [ ] A facilitator's PATCH succeeds only when they are the facilitator of a session for that team currently in a status that makes pre-session review live (i.e., `pre_session`) — matching the UC's "session-scoped permission" language — **or** the proposal explicitly redefines facilitator authority as team-wide and independent of an active session, and states why that's a deliberate broadening beyond the source use case. Pick one; don't leave both readings alive in the same document.
- [ ] If facilitator authority is session-scoped (my expectation, matching the UC): a facilitator PATCHing outside their own currently-active session for that team gets `403`, with a distinguishable reason from "not the owner" (useful for the frontend to render the right message, and for audit-log fidelity per SEC-13).
- [ ] Engineer-owner path: `403` if the authenticated user is not `action_items.owner_id` for the target item, full stop, regardless of session context — this part of §9 is already unambiguous and matches FR-7.3 and the "Engineer Updates Status" UC's acceptance criteria directly. No change needed here.
- [ ] Application Administrators are not named as an authorized actor for this endpoint anywhere in the source use cases (FR-1.3's Administrator role covers team/topic/threshold management, not action item status). Confirm the endpoint has no Admin bypass — if one is intended, it needs its own acceptance line, because none of the grounding docs currently support it.

---

## 2. Same-status no-op semantics

**What's in the notes:** §9 says "same-status no-ops handled gracefully (reset staleness clock, no spurious event/history row)."

**What's vague:** if no history row is written, *what actually resets the staleness clock?* The staleness computation (per "Flag Stale Action Items," `03`, Notes) is explicitly a **read-time** computation over elapsed completed sessions since last update — and that UC's own implementor recommendation says staleness "should be computed at read time from the session count, not stored as a persistent field." If it's computed from `action_item_history` rows (the natural source, since that table carries `changed_at`), then skipping the history row on a no-op means the staleness clock does *not* actually reset — which contradicts the stated intent directly. The only other candidate is `action_items.updated_at`, which the schema already has (`packages/backend/migrations/2_create_tables.sql:145`) — but the notes don't say that's the field being touched, and if it is, someone still has to define "reset" as "count elapsed sessions since `updated_at`," which isn't stated anywhere in the BRD or either UC file as the staleness formula (both describe it as sessions elapsed since "creation or last status change," not since a generic `updated_at` bump).

**Concrete acceptance conditions I'd want stated:**

- [ ] Name the field the staleness computation actually reads (`action_items.updated_at`, or `MAX(action_item_history.changed_at)`, or something else) — this decision is currently implicit and the two plausible answers produce different behavior for the "no history row" no-op case.
- [ ] If the answer is "no-op still bumps `action_items.updated_at` but writes no history row," say so explicitly as an acceptance line — e.g., *"A same-status PATCH updates `action_items.updated_at` to the current time and returns 200, but writes no `action_item_history` row and publishes no `actionitem_status_updated`/whatever-it's-named event."* That's a testable behavior; "handled gracefully" is not.
- [ ] Clarify whether a no-op still requires the same authorization check as a real transition (I'd assume yes — an owner or facilitator-in-session can no-op their own/any team item, a non-owner participant cannot no-op someone else's item just because "nothing changes"). Worth one line since it's not obvious from "gracefully."
- [ ] Clarify whether a no-op still fires the live broadcast. Both source UCs are silent on this for the no-op case specifically; my instinct (matching §9's "no spurious event") is no broadcast either — nothing observably changed for other participants to see — but this should be a stated line, not inferred from "no spurious event/history row" alone, since "event" there is ambiguous between "broadcast" and "history event."

---

## 3. `action_item_history` row shape

**Good news, and something §9 should cite directly:** this table already exists and is fully defined — `packages/backend/migrations/2_create_tables.sql:152-161`:

```
action_item_history (
  id, action_item_id, changed_by_user_id,
  previous_status, new_status, resolution_note (nullable),
  session_id (nullable), changed_at
)
```

§9 says only "an `action_item_history` row written on every real change," which is correct but under-specified against a table that already has real constraints. Two of its columns are exactly where the exploration's other open questions collide with this schema and need to be pinned down together, not left as separate questions:

**Concrete acceptance conditions I'd want stated:**

- [ ] `resolution_note`: since resolution-note capture (issue #65) is explicitly out of scope for this change (§9, correctly), every history row this change writes should carry `resolution_note = NULL`. Say so — it's a one-line acceptance criterion and it closes off any temptation to half-wire the column now.
- [ ] `session_id`: this column is nullable, which is the right shape for "owner updates outside of a session" (per FR-7.3 and the Action Item Management UC), but the value written when the update *does* happen inside a live pre-session review needs to be tied to whatever §5's session-context resolution decides (see §5 below in this review). Don't leave `session_id` population as an implementation detail separate from the session-context design decision — they're the same decision. State: *"`action_item_history.session_id` is populated with the resolved session ID when the update occurs during an active pre-session review for that team; NULL for out-of-session updates."*
- [ ] `changed_by_user_id`: straightforward (whoever authenticated the PATCH), but worth stating explicitly that this is the *actor*, not the item's `owner_id` — relevant because facilitator-made changes on someone else's item will have `changed_by_user_id != action_items.owner_id`, and "View the History of a Specific Action Item" (UC, `07`) expects the acting user to be visible in the history log ("the actor who made the change (if recorded)"). This change is what finally records that actor — worth calling out as closing that UC's previously-open question, not just as an implementation detail.
- [ ] Confirm history-row writes and the `action_items` row update happen in the same transaction. Not stated anywhere in the exploration notes; given NFR-DATA-002/NFR-DATA-005 conventions elsewhere in this codebase (PostgreSQL as system of record, versioned migrations), I'd expect this is assumed, but "assumed" is exactly the kind of gap that becomes an implementation question if it isn't written down.

---

## 4. Payload minimalism / resolution-note inclusion (§6)

I agree with the lean in §6: status + identity + timestamp only, resolution note excluded, matching every other payload's minimalism convention (`VoteReadinessUpdatePayload`, `ParticipantJoinedPayload`). Since resolution notes are unscheduled (#65) and the mutation itself will only ever write `NULL` for `resolution_note` in this change (per §3 above), there's nothing to include even if the convention argument were weaker than it is. This one is fine as stated — I'd just make it a stated acceptance line instead of "the open question," since I'm resolving it here: **status-only payload, no resolution-note field, full stop, for this change.**

One thing the notes don't cover and should: does the payload carry the **new status only**, or **both previous and new status**? Every other payload in the catalog is forward-only (e.g. `session_state_change` carries both `previousStatus` and `newStatus` — worth checking that precedent directly). Given `session_state_change` is the delivery-pattern precedent §4 already recommends following, I'd expect this event to match that shape (`previousStatus` + `newStatus`), not just `newStatus` alone — a participant's client rendering "Item X moved to Resolved" reads better with both fields, and it's free (the mutation already knows both values). Add this as an explicit payload field decision rather than leaving it to be inferred from the "identity + status/timing" summary.

---

## 5. Session-context plumbing (§5)

This is the sharpest open question in the notes and I think Devon is right that it needs the architect, but I want to give my read as the requirements owner since the notes ask for it.

**I agree with the lean toward option 1** (frontend supplies session context, validated server-side against the team's currently-`pre_session` session) over the team-scoped alternative. My reason, on top of Devon's: FR-3.3's own text is "visible to all session participants," and the UC's own actor list for the review screen ("Surface Open Action Items at Session Start") is explicitly scoped to *that session's* participant set, not the team broadly. An idle EM-dashboard connection receiving this event (the team-scoped alternative's stated tradeoff in §5) is a small but real deviation from "session participants," and deviations from stated requirement text should require an explicit sign-off, not fall out of the simpler implementation path by default.

**What's still missing before this is buildable, beyond what §5 already flags:**

- [ ] What happens when the PATCH is made **without** a session context (the FR-7.3 "outside of a session" case)? §5 discusses only the "frontend supplies session context" path; it doesn't state the no-context case's behavior. I'd expect: mutation succeeds normally, no broadcast is published (nobody's listening to a session channel that was never specified) — but this needs to be a stated line, because "no broadcast" and "400 Bad Request for missing sessionId" are both plausible readings of an unstated requirement, and they're very different to build and test.
- [ ] What happens when a `sessionId` **is** supplied but fails validation — team mismatch, session not in `pre_session` status, or session doesn't exist? Three sub-cases, potentially three different behaviors (reject the whole PATCH with 4xx? succeed the mutation and silently skip the broadcast? something else?). I'd lean toward "the status mutation is authoritative and always succeeds on its own merits; a bad/stale `sessionId` only affects whether the broadcast fires, never the mutation's success" — this keeps the live broadcast in its rightful place as a [PREF] add-on that can't block a [HARD] FR-7.3 mutation. But that's a design-level call, and it should be captured as such rather than left to whoever writes the endpoint handler that week.
- [ ] Is `sessionId` a route param, a body field, or a query param on the PATCH? §5 says "route param or body field" — pick one before tasks.md. This affects the REST contract doc (`requirements/design/REST API Contract.md`), which will need an entry for this endpoint regardless (see below).

---

## 6. Gap not on the original list: status-transition validity at the boundary

Not one of the five areas I was asked to focus on, but it surfaced while checking §9 against FR-7.3 and the UC preconditions, and it's load-bearing enough that I want it flagged now rather than discovered mid-implementation.

FR-7.3 is explicit: *"Status transitions are directed and may not be reversed... Backward transitions (In Progress → Open, Resolved → anything) are not permitted."* The "Engineer Updates Status of an Action Item They Own" UC's preconditions go further: *"The action item has a current status of 'open' or 'in progress' (resolved items cannot be re-opened through this flow)"* — meaning a Resolved item is not just protected against backward transitions, it's arguably not a valid PATCH target **at all**, including a same-status no-op on an already-Resolved item.

§9 doesn't address invalid-transition handling anywhere. Neither does the exploration's ownership/no-op discussion. This needs:

- [ ] An explicit list of what response the endpoint returns for an invalid transition attempt — a backward transition (`In Progress → Open`), or any PATCH targeting an item whose current status is already `Resolved`. This codebase has a existing precedent worth reusing for consistency: FR-7.1a uses `409 Conflict` for a state-invalid delete attempt ("reject a delete request with 409 Conflict if the session status is not wrap_up"). I'd suggest the same status code here for consistency, but that's a call for the architect/proposal author to make explicitly, not to leave to whichever engineer picks up the ticket.
- [ ] Whether a `Resolved`-to-`Resolved` no-op is permitted at all, given the UC precondition scopes the entire status-update flow to items currently `open`/`in progress`. If it's not permitted, that's a meaningful edge case difference from the "same-status no-op" discussion in §9/#2 above, which reads as if it applies uniformly to any status — it shouldn't, if Resolved is terminal.

---

## 7. Sanity-check against BRD / use cases — no material conflicts, two small notes

- FR-3.1–FR-3.5 grounding in §1 is accurate; no issues.
- FR-7.2's required fields (identifier, description, owner, originating session, creation date, status, last-updated date) all map cleanly onto the existing `action_items` schema — no gap introduced by this change.
- One inconsistency in the *source documents themselves*, not this change's fault, but worth a footnote so it doesn't get silently "resolved" by whoever implements staleness reset: FR-7.4 describes staleness as a single flag at a "default: two sessions without a status change" threshold, while both UC files describe a three-color graduated scale (yellow/orange/red at 1/2/3+ sessions). This change touches the no-op reset behavior that feeds staleness computation (§2 above), so whoever builds it should use the UC's graduated scale (the more detailed, more recently developed source) and treat FR-7.4's single-threshold language as superseded — but this change doesn't need to resolve that inconsistency itself, just not accidentally re-introduce the single-threshold reading through the reset logic it's building.
- The REST API Contract document (`requirements/design/REST API Contract.md`) has no entry for this endpoint yet, per the websocket-specification spec's own noted gap pattern (it flagged the same kind of documentation-completeness miss for the reveal-latency endpoint). Proposal.md should include updating that contract doc as a task, not just the WebSocket catalog updates §9.5 already calls out.

---

## 8. What I'd add to proposal.md before this leaves exploration

In addition to what §8/§9 of the exploration notes already list, I'd want:

1. A single, explicit authorization-model statement resolving §1 above (session-scoped facilitator authority vs. team-wide) — this is a prerequisite for writing correct 403 test cases and shouldn't be discoverable only by reading two different use case files against each other.
2. A stated field-level definition of "reset the staleness clock" (§2) — name the column/computation, not just the outcome.
3. The `action_item_history` row's exact contract for this change (§3): `resolution_note` always NULL, `session_id` tied to the §5 resolution, `changed_by_user_id` = acting user (closing the previously-open "actor in history" question from the `07` UC file).
4. Explicit response codes for invalid-transition and no-context/bad-context cases (§5, §6) — I'd suggest reusing `409 Conflict` for invalid transitions, consistent with FR-7.1a's existing precedent, but this is the architect's call to finalize.
5. A REST API Contract doc update as a named task, not just the WebSocket catalog updates.

None of this changes my basic agreement with Devon's read: the combined-change decision (§9, Option B) is the right call, and FR-3.3 stays low-risk to the things I protect most (simultaneous reveal, facilitator/participant view separation, no-manager-participation — none of which this touches). What I don't want is for "session-scoped vs. team-wide facilitator authority" or "what resets the staleness clock" to get decided informally inside a PR because the proposal stage described the *shape* of the endpoint without pinning down its edges. Those are exactly the kind of gaps that turn into a Slack message to me mid-implementation — which is the outcome both Devon and I are trying to avoid here.
