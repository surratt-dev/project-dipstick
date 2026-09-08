# Propose-Stage Review: websocket-delivery-time-authorization

**Reviewer:** Marcus Delgado, Business Analyst
**Stage:** Propose (proposal.md, design.md, tasks.md, delta spec)
**Date:** 2026-09-07
**Prior artifact reviewed:** `explore-review-ba.md` (Explore stage, two clarification rounds against exploration-notes.md)

---

## 0. Bottom line

The headline decision from Explore survived Propose intact, and most of what I flagged in the Explore review got resolved the way I'd have resolved it — the admin-grant rejection is now normative in the spec with its own scenario, the concurrency model is named, the skew measurement exists, and SEC-25/26 got a real tracking requirement instead of a footnote. That part of this is buildable.

But I went and did the thing Devon's document asked Propose to do — verify against actual code rather than assume — for two things beyond what was asked, and both turned up problems that change my assessment from "buildable as written" to "buildable after two corrections and one scope conversation the team needs to have before Tasks starts."

1. **D7's audit-logging spec doesn't match the actual `audit_log` table or the actual helper it says it reuses.** This isn't a nitpick — an engineer implementing task 7.2 exactly as design.md D7 describes it will write a query that fails, because the columns named don't exist. Section 3 below has the specifics.
2. **A bigger one: the "triggering actions" this whole design assumes already commit a state transition to Postgres — reveal, topic advance / action-item finalization, and membership removal — mostly don't exist yet in the codebase.** Only session creation, the lobby advance, and session completion have real `UPDATE` statements behind them. The reveal endpoint is confirmed, in its own code comment, to be an authorization/validation stub that does not flip any topic's reveal status. I could not find a route anywhere that sets `team_memberships.removed_at`, and no code writes an action item or finalizes one. This is the most important finding in this review and it isn't a documentation gap — it's a sequencing gap that Group 9's tasks don't name. See Section 2.

Neither of these should surprise anyone once stated, and neither invalidates the transport/fan-out decision. But if Tasks is cut from this proposal as written, an implementer hits both walls mid-sprint instead of before starting, which is exactly the "come back and ask what did you mean" outcome I try to prevent.

---

## 1. Out-of-Scope section vs. tasks.md — where I looked for drift, and what I found

I read the four Out-of-Scope bullets against every task group looking for a task that silently treats something the proposal calls deferred as already-handled, or vice versa. Here's the accounting:

| Out-of-scope item | tasks.md treatment | Drift? |
|---|---|---|
| SEC-25 heartbeat / SEC-26 token-refresh mechanism design | Group 8 (8.1–8.4): files a companion issue, names an owner, gates archival on both existing. Does not design the mechanism. | **No drift.** Task language matches the deferral exactly — 8.1–8.4 are about the *destination* existing, not the mechanism. |
| Generic client-facing staleness signal | Group 9 (9.1–9.2): 9.1 files the Design-stage deliverable; 9.2 is a *negative* assertion (confirm no cause-disclosure was added), not a design task. | **No drift**, but see the caveat below — 9.2 is testable, 9.1 is not a task this change's own completion can be verified against (it's "file something," with no gate comparable to Group 8's 8.4). |
| Re-deriving the 60-second fallback bound | Task 6.7 names it as a gate condition ("if 6.1/6.2 shows unacceptable latency, escalate") but does not invoke or re-derive it. | **No drift.** |
| Cause-disclosure of revocation (non-goal) | 9.2 explicitly tests for its absence. | **No drift.** |

So the four explicit Out-of-Scope bullets are honored. The drift I found is not inside this table — it's a fifth thing that was never named as in-scope *or* out-of-scope, because Explore and Design both wrote around it as a background assumption:

**The triggering actions themselves are treated as pre-existing.** Proposal.md's Impact section says the Redis publisher is "invoked from the existing HTTP action handlers." Design.md's architecture diagram literally starts with "Postgres commit (vote lock-in / reveal / topic advance / membership change)" as the top box, arrow down to "triggers event." Migration Plan step 4 says the same: "invoked from the existing HTTP action handlers — reveal, topic advance, session close, membership change — after their state transition commits." tasks.md 1.4 inherits this uncritically: "publishes to `ws:events` from the triggering action handlers."

Every one of these documents treats "the state transition commits, and then we publish" as a wiring problem — find the existing commit point, add a publish call after it. I checked, and for three of the four events, there is no existing commit point to wire into:

- **Reveal** (`POST /api/v1/teams/:teamId/sessions/:sessionId/reveal`, `packages/backend/src/routes/facilitator-sessions.ts` lines 319–434): the handler's own comment says it plainly — *"The topic state transition (voting → revealed) is the business logic of the session state machine. This endpoint... signals that the authorization and session-state preconditions are met."* No `UPDATE` to `session_topics`/`topics` reveal status appears anywhere in `packages/backend/src` outside tests. `reveal_status` is read in `content.ts` and `team-content-serializers.ts`, never written.
- **Topic advance / action item finalization** (the trigger named for `topic_history_update`): no route, no `UPDATE session_topics ... SET status`, no action-item write anywhere in `packages/backend/src` outside tests. `action_item`/`finaliz` only appear as read references in `content.ts`, `em-views.ts`, and a comment in `audit-logger.ts`.
- **Membership removal** (`team_memberships.removed_at`): read in dozens of `WHERE removed_at IS NULL` clauses across `teams.ts`, never set. No route sets it.

Only two of the named triggers are real today: the lobby advance (`UPDATE sessions SET status = 'lobby'`, line 196) and session completion (`UPDATE sessions SET status = 'complete', ...`, line 276).

This matters because it isn't cosmetic — it's load-bearing for the two most-emphasized correctness properties in this proposal:

- **D7's audit logging** (and task 7.2/7.3) says to add the `audit_log` write "at the point the reveal action is authorized and executed." There currently is no point at which the reveal action is *executed* — only a point at which its preconditions are validated. If a task-writer takes 7.2 literally, they'll add the audit row to the existing stub and call it done, while the actual reveal (the thing that should also fire the `vote_revealed` publish) still doesn't exist. The audit row and the WebSocket event would both be attached to a no-op.
- **The admin-grant-rejection scenario and the acceptance tests in Group 5** (5.6, 5.1) all assume `topic_history_update` fires when "an action item is finalized during wrap-up" — an event this codebase cannot produce yet.

**What I'm asking for, not deciding myself:** I don't own the engineering sequencing call — whether "implement the reveal/topic-advance/action-item state machine" belongs inside this change's scope, as a hard prerequisite change, or gets treated as a `[Blocked by: ...]` dependency the way the archived change's Group 9 was gate-blocked on WebSocket infrastructure. What I'm not willing to let pass silently is Tasks being approved with 1.4, 7.2, 7.3, 4.4, and 4.5 written as if the commit point already exists. At minimum, tasks.md needs a task-zero item: "Confirm/implement the state-transition write this event's publish call attaches to," per event, before the publish-wiring tasks that depend on it. Whoever picks this up should decide whether that's this change's job or a named prerequisite — but it can't be left implicit, because right now it reads as if it's already done, and it is not.

---

## 2. Is D7 (WebSocket audit logging) fully specified? No — it doesn't match the schema or the helper it claims to reuse.

Design.md D7 says: *"Add an `audit_log` write (using the existing `emitAuditEvent` helper and `audit_log` table, same fields as other content-access audit entries: `timestamp`, `actor_user_id`, `actor_global_role`, `actor_ip`, `action`, `resource_type`, `resource_id`)."*

I read `packages/backend/src/auth/audit-logger.ts` and the migration that created the table (`packages/backend/migrations/8_audit_log.sql`), plus every current call site (`content.ts`, `teams.ts`, `em-views.ts`). Two separate things are wrong with D7's field list and mechanism, and an implementer would hit both:

**(a) `emitAuditEvent` does not write to the `audit_log` table.** It's a structured-log (pino) emitter — the code's own comments call it "the operational alert path," explicitly distinct from "the authoritative audit record." Every real `audit_log` row in this codebase is written by a hand-written `INSERT INTO audit_log (...)` executed via `db.query` (or `client.query` inside a transaction), immediately *alongside* — not instead of — a separate `emitAuditEvent` call. D7's phrasing ("using the existing `emitAuditEvent` helper... to write the audit_log table") reads as if the helper does the DB write. It doesn't. Task 7.2 gets this right in passing ("via `emitAuditEvent` and a direct `audit_log` INSERT") but D7 in design.md is the document an implementer is told to treat as authoritative, and it's the one that's wrong.

**(b) The field list doesn't match the actual table.** The real schema (migration 8):

```
audit_log (
  id, actor_user_id, actor_global_role, actor_ip,
  operation,            -- NOT "action"
  target_user_id,       -- nullable
  team_id,              -- nullable
  timestamp,            -- default now()
  metadata              -- JSONB, operation-specific fields go here
)
```

There is no `action`, `resource_type`, or `resource_id` column. Every existing call site uses `operation` (a dot-namespaced string like `admin.team_detail_accessed`, `team.role_changed`, `em.session_detail_accessed`) and puts anything endpoint-specific — including, precedent-setting for this exact case, a session identifier — into `metadata` as JSON. `em-views.ts` line 380 is the direct precedent: `JSON.stringify({ session_id: sessionId })`. D7's instruction to include "the session identifier" is right in spirit but the mechanism it names (a `resource_id` column) doesn't exist; it has to go in `metadata`, following the em-views.ts pattern.

**Also unaddressed: `AuditEventName` is a closed union type**, not a free-form string. `packages/backend/src/auth/audit-logger.ts` types `emitAuditEvent`'s second argument as a specific enumerated union (`auth.*`, `join.*`, `team.*`, `em.*`, `admin.*`). Two new `operation` values are needed for this change — something like `session.reveal_triggered` and `session.state_changed` — and they need to be added to that union, following the existing naming convention, with the same kind of "structured-log counterpart to the audit_log DB row" comment the other entries carry. Neither design.md nor tasks.md names what the new operation string(s) should be. That's a one-line omission but it's exactly the kind of thing that produces a Slack message to whoever owns this file if left for the implementer to guess, and per my own success criteria, the requirements documents should be the first place the answer is found — not a guess made at the keyboard.

**Concrete rewrite I'd make to D7 (and task 7.2/7.3) before this moves to Tasks:**

> Add an `audit_log` row via a direct `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata) VALUES (...)`, executed in the same statement/transaction as [whatever write finally implements the reveal/state-transition — see Section 2 above], with a new `operation` value (`session.reveal_triggered` for the reveal action, `session.state_changed` for topic-advance/session-close transitions) added to the `AuditEventName` union in `audit-logger.ts`. Include the session identifier in `metadata` as `{ session_id: sessionId, ... }`, following the `em.session_detail_accessed` precedent. Call `emitAuditEvent` immediately after the INSERT with the same operation name and fields, as the structured-log counterpart — not as a substitute for the INSERT.

This is a small fix in terms of lines of code, but it's the difference between an implementer copying design.md D7 verbatim and writing a query against columns that don't exist, versus copying an existing, working pattern in the same file family.

**One more thing worth naming, not blocking:** Decision D7's "Alternative considered" section (log once per triggering action, not once per WebSocket recipient) is the right call and is well-argued — I have no notes there. The scenario tests in the delta spec (78–89) and tasks 7.4/7.5 correctly test for "exactly one row regardless of recipient count." That part is genuinely well specified once the field-list and mechanism corrections above are made.

---

## 3. Is the admin-grant-rejection requirement for `topic_history_update` testable as written?

Yes, and this is one of the better-specified parts of the delta spec. The scenario at spec.md lines 43–49 gives a concrete WHEN/AND/THEN with an explicit edge case called out ("this holds regardless of whether the Application Admin is also, separately, a team member or facilitator") — that's exactly the kind of edge case I'd have had to ask for if it weren't already there, because "admin who is also a member" is the case a naive implementation gets wrong (short-circuiting on the first truthy grant path rather than checking which path was returned). Task 5.6 restates it as a concrete integration test with the same edge case named. Task 4.5 tells the implementer exactly what to call (`evaluateTeamAccess`) and exactly what to check (`grant.path !== 'admin'`), with an explicit "do not deliver regardless of any other path" instruction.

I verified this against the actual helper (`packages/backend/src/auth/team-content-access-helper.ts`): `evaluateTeamAccess` does return a discriminated union with `path: 'admin' | 'member' | 'facilitator'` (or `null`), evaluated in priority order with admin checked first. So "inspect `grant.path`" is a real, callable thing today, not a placeholder — the capability is implementable exactly as described, not just as described in the abstract.

The one gap I'd flag, minor relative to Section 2's finding: this whole scenario is untestable end-to-end until `topic_history_update`'s trigger (action-item finalization during wrap-up) actually exists in code (see Section 1). The authorization-check unit/integration test (5.6) can be written and passed against a directly-invoked handler without the real trigger existing — so this requirement is testable in isolation — but the "Scenario: topic_history_update is delivered only to team members" and the admin-rejection scenario both open with "an action item is finalized during wrap-up," which today cannot happen. Worth flagging so nobody is surprised when the E2E version of this test (tasks.md 11.1/11.2, or archived tasks 11.3/11.10) can't actually run against a real finalize-action-item flow.

---

## 4. Does the proposal adequately address the SEC-25 "tracked not satisfied" boundary — is ownership and timeline clear, or does this risk permanent deferral?

Partially. The spec requirement itself (`Idle-connection re-authorization (SEC-25) is tracked, not satisfied, by delivery-time checks alone`, spec.md lines 91–108) is well-written and the scenario at 104–108 is genuinely clever as an acceptance criterion — making "the tracking destination exists, with a named owner" the testable condition, rather than trying to test an unbuilt mechanism, is the right move and matches what I'd have asked for.

But I want to be specific about where the teeth actually are, because "tracked, not satisfied" can still turn into "tracked, then forgotten" if the gate is softer than it reads:

- **tasks.md 8.4** is the actual enforcement point: "Gate — before this change is archived: confirm the companion issue exists and has a named owner." This is the one binding mechanism in the entire proposal for preventing permanent deferral. Good — but it depends entirely on whoever runs the archive step actually checking it, the same way Group 8's 10.2 (removing the "gate-blocked" note) depends on someone remembering to do it. Neither is enforced by tooling; both are checklist items a person has to honor. I'm not asking for tooling to be built — that's disproportionate for an internal tool — but I want it named plainly here: **this requirement's only enforcement is human diligence at archive time**, and the proposal should say so rather than implying the spec scenario (104–108) is self-enforcing. It isn't; it's a description of what "complete" means, not a mechanism that prevents "incomplete" from shipping.
- **No timeline is named anywhere** — not in the proposal, not in design.md D8, not in tasks.md 8.1–8.4. "Before this change is archived" is a sequencing constraint, not a timeline. If this change gets implemented and the companion issue gets filed with a named owner but that owner's effort doesn't start for two quarters, every condition in tasks.md 8.1–8.4 is satisfied and SEC-25 is exactly as open as it is today, indefinitely, with a green checkmark next to it. I don't think this proposal needs to solve that — timeline commitments for a companion effort aren't this document's to make, per Devon's own scope reasoning in Section 8 of the exploration notes — but I'd ask that whoever owns triaging the companion issue be told, explicitly, that "exists with a named owner" is a floor, not evidence that the gap is being actively worked. That's a one-sentence addition to task 8.2 or 8.4, not a design change.
- **Who is "whoever triages it"?** Design.md D8 says the companion issue is filed "at the discretion of whoever triages it." That's the one piece of genuinely vague language left in an otherwise well-specified area — it names no person, no role, no queue. I don't need a name (that's legitimately not this document's call, per Devon's own repeated point that he doesn't have standing to assign engineering owners from his seat), but "whoever triages it" should at minimum name the *queue* or *backlog* the issue lands in, so tasks.md 8.1 has a concrete destination rather than an unspecified triage step that could itself stall before an owner is ever named.

**My assessment:** this is not at risk of the silent, no-mechanism-at-all deferral I'd have flagged hardest against — the spec scenario is a real acceptance criterion and 8.4 is a real gate. It is at risk of the softer failure mode: technically satisfied, practically stalled, because "named owner" and "actively scheduled" aren't the same thing and nothing here distinguishes them. I'd add one line to task 8.2: *"Name an owner and a target quarter/milestone for the companion effort to begin, not merely to exist"* — small change, closes the gap between "tracked" and "tracked in a way that's likely to actually happen."

---

## 5. Other capability-specificity notes (vague language flagged, concrete conditions suggested)

Smaller items, roughly in descending order of how likely they are to produce a "what did you mean?" round-trip:

- **tasks.md 7.3** ("any other action that changes `sessions.status` and triggers `session_state_change`") is open-ended by design — design.md's own Risk section (the last one, on audit-logging scope) acknowledges this and says future privileged actions "must be added to the same audit point." That's a reasonable position, but as written, 7.3 doesn't enumerate what "other action" means *today*, given only two status-changing endpoints currently exist (lobby-advance, complete). I'd make 7.3 concrete: name the lobby-advance and complete endpoints explicitly as the two in-scope transitions for this change, and treat "topic advance" as out-of-scope for 7.3 specifically until Section 1's prerequisite gap is resolved (since topic advance doesn't commit anything today). Leaving it as "any other action" invites an implementer to either under-scope (miss lobby-advance) or over-scope (try to audit-log a state transition that doesn't exist yet).
- **Design.md D2's channel topology** ("Each published message is a JSON envelope: `{ eventType, sessionId?, teamId?, payload: unknown }`") types `payload` as `unknown`. For an internal design doc that's fine as a placeholder, but tasks.md never asks for the four concrete payload shapes to be pinned down as part of this change (only that `serializeForFacilitator`/`serializeForMemberParticipant` supply the `vote_revealed` shape). I'd want a task — even a small one — that says "define and document the payload shape for `vote_readiness_update`, `session_state_change`, and `topic_history_update` (the three not already covered by the reused serializers)," since "the subscriber requirement" table in the spec names who receives what but not what's in the envelope for three of four events.
- **tasks.md 6.4** ("Set and document a pass/fail budget for the skew measurement... informed by a UX-sourced figure where available") — "where available" is doing a lot of work. If no UX-sourced figure is available (which, per exploration notes Section 9/10, is the current state — Priya's usability pass hasn't happened yet), does 6.4 pass with an engineer's own guessed number, the same placeholder pattern already flagged once for the ~100ms figure? I'd tighten this to: if no UX-sourced figure exists by the time 6.3's measurement is taken, 6.4's budget is itself labeled a placeholder pending Priya's usability pass (mirroring exactly how 6.2 already handles the ~100ms number) rather than quietly becoming a de facto final number because nobody revisits it. This is the same pattern Devon corrected himself on for the 60-second figure in exploration notes Section 8 — I don't want the same "unlabeled placeholder becomes accepted as validated" drift to happen a second time in this document, one layer down, for skew instead of latency.
- **Delta spec, `topic_history_update` row (spec.md line 14):** "the subscriber MUST pass the same team membership check as the corresponding HTTP endpoint (Path 1 or Path 2...)" — "Path 1 or Path 2" is terminology from the archived design doc, and current code doesn't label its branches that way (`evaluateTeamAccess` returns `path: 'member' | 'facilitator' | 'admin'`, no "Path 1/2/3" labels in the code itself). Not wrong, just a translation an implementer has to do themselves by cross-referencing the archived design doc. A parenthetical mapping ("Path 1/2 = `grant.path === 'member'`") would remove that lookup.

---

## 6. What I'd sign off on as-is, without changes

- The four-event authorization mapping (Section 6 of exploration notes, carried into design.md D3 and the delta spec table) — concrete, testable, traces to real code.
- The admin-grant-rejection requirement and its scenario (Section 3 above) — genuinely well done.
- The concurrency-model decision (D3) and the skew-measurement requirement (D5) — both resolve exactly the ambiguity I flagged at Explore stage, with the right acceptance criteria (D6 items 1–7).
- The `vote_revealed` reveal-serializer reuse requirement (D4) — unambiguous, correctly forbids a parallel implementation, matches the precedent from the archived change's Decision 9.
- SEC-25/26's spec-level treatment as "tracked, not satisfied" — the right disposition, modulo the timeline/enforcement notes in Section 4 above.

---

## 7. Summary of asks before this proceeds to Tasks

1. **Resolve or explicitly scope around the missing state-transition commits** for reveal, topic advance/action-item finalization, and membership removal (Section 1/2). At minimum, name this as a dependency in tasks.md rather than letting Group 1/4/7 read as if the commit points already exist.
2. **Correct D7's field list and mechanism** to match the real `audit_log` schema and the real `emitAuditEvent`/direct-INSERT pattern (Section 2), including naming the new `AuditEventName` values.
3. **Tighten task 7.3's scope** to the two transitions that actually exist today (Section 5).
4. **Add a payload-shape task** for the three events not covered by the reused serializers (Section 5).
5. **Add one line to task 8.2** distinguishing "named owner exists" from "actively scheduled" for the SEC-25/26 companion effort (Section 4).
6. **Label the skew budget (6.4) as a placeholder**, same as the latency figure, if no UX-sourced number exists when the measurement is taken (Section 5).

None of these are headline-decision changes — Devon's transport/fan-out/delivery-time call stands, and I'm not reopening it. These are the kind of gaps that, left as written, turn into exactly the round-trip conversations my own success criteria say the requirements should prevent.
