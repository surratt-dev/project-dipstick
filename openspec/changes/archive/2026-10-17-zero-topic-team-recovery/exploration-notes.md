# Exploration notes: zero-topic-team-recovery (#200)

Voice: Devon Calloway (Internal Champion). Exploration only, no code.

Revision 2: updated after the facilitator (Priya Nair) and BA (Marcus Delgado) reviews. Items marked **recommended default** are my decisions made in place of the product owner, who could not be reached; the PO may overturn any of them. Section 9 records what I accepted and what I pushed back on, and why.

## 1. Where the issue stands today (verified in the code)

| Claim in #200 | Status | Evidence |
|---|---|---|
| Team creation silently succeeds with zero topics | FIXED | `POST /api/v1/teams` (facilitator-sessions.ts ~L590-L790) copies defaults (`copyCanonicalDefaults`, sessions/default-topics.ts), takes `lockTeamTopics`, then `snapshotSessionTopics` throws `NoActiveTopicsError` on zero rows. The whole transaction rolls back and the caller gets a fixed 500 with a logged `templateTeamId`. The use case text already says "no team or session is created" (#175). |
| Nothing is logged | FIXED (log only) | `request.log.error(... "default topic template is empty")`. Deliberately no `audit_log` row, because it would roll back with the transaction. |
| Session cannot start for a team with no topics | VERIFIED, with one soft spot | `POST .../sessions/draft` (L332) creates a draft only. `POST .../sessions/:id/advance` (L852) snapshots at room open and returns `409 NO_ACTIVE_TOPICS` with message "Add or restore a topic on Topic Management before opening the room." `POST /api/v1/sessions/:id/start` (L1135) requires status `lobby`, and `lobby` is reachable only through those two snapshotting paths. Soft spot: `/start` itself does not re-check `session_topics`. Only a pre-#175 legacy session sitting in `lobby` with no snapshot could slip through. Needs a one-query check against real data, not a code change by default. |
| No endpoint copies defaults onto an existing team | STILL TRUE | The only topic writes are add (`POST /teams/:id/topics`), archive (`DELETE`), restore (`POST .../:topicId/restore`), reorder (`PUT .../order`), and annotation. All of them except annotation are lock-gated (409 `TOPIC_CUSTOMIZATION_LOCKED`). |
| The team is locked so nobody can add topics | STILL TRUE, and it is a deadlock | `getTopicLockState` (auth/topic-lock-state.ts) is `first_session` until `hasCompletedFirstSession`. A zero-topic team can never complete a session (advance returns 409), so it never unlocks. Admins included (FR-8.2 admin write access is gated by the same lock; see #176 comment). |

So half of the issue's first acceptance bullet ("can't silently be created") is done. The second half ("or a documented in-app way to fix one") is only needed if such teams can still exist.

## 2. Can a zero-topic team actually exist?

Paths that produce an active-topic count of zero:
1. Pre-#175/#215 team creation against an empty template. Legacy. In this repo the template is seeded by migrations 4/11, so this requires a deploy whose template was emptied or whose seed failed. I found no evidence of one, but I cannot see production data.
2. Template drift after creation, for example someone deactivating or deleting `is_default` rows. This only affects future creations (now rolled back), not existing teams.
3. Manual DB operations or data drift on an existing team. The advance handler's own comment calls this "unreachable through the API", because `TOPIC_LAST_ACTIVE` prevents archiving the last topic and the lock prevents the rest.
4. Teams created by other flows (migrations-manual, seed scripts). Worth one grep, not a design.

Devon's read: the population is probably zero in any real environment. That argues for a diagnostic first, then a small tool. It does not argue for a big feature.

Open question for the PO: is there a deployed environment with such a team? One SQL query answers it:
`SELECT t.id FROM teams t WHERE t.id <> '00000000-0000-0000-0000-000000000001' AND NOT EXISTS (SELECT 1 FROM topics WHERE team_id = t.id AND status = 'active');`

## 3. Options

A. Do nothing in code; document the manual SQL runbook and reword the empty-state copy to be honest ("contact your administrator" is wrong for admins; see 5). Satisfies acceptance bullet 1 only via "prevent"; weak on bullet 1's "or documented in-app way" and leaves FR-8.6 [HARD] broken for this one state. Cheapest, but a hand-run DB fix is exactly what the issue calls out.

B. Admin-only "assign default topics" action (recommended). One new endpoint plus one button on the existing Topic Management empty state, shown to application admins only.

C. Open the lock for admins when active topics are zero (let the existing add/restore endpoints work). Rejected: it changes the semantics of the lock gate (`checkCustomizationLockGate`) across four endpoints, and "add a custom topic" is the wrong fix, because the team's first session is supposed to run the canonical set. The lock exists to guarantee that.

D. A repair job or migration that backfills all zero-topic teams. Only worth it if the diagnostic query finds rows, and then it is a one-off script (migrations-manual/ has the pattern), not product surface.

E. Cover teams with SOME but not all defaults. Out of scope; see 6.

## 4. Recommended design (Option B)

Endpoint (**recommended default, settled**): `POST /api/v1/teams/:teamId/topics/assign-defaults`. I chose `assign-defaults` over `restore-defaults` because it matches the button label and the audit operation, and because "restore" already means the per-topic `.../:topicId/restore` flow. Not configurable, no flag.

Guards, in the established check order (compare the add endpoint, topics.ts L877):
1. Canonical team id check (`rejectNonCanonicalTeamId`), lowercase the id.
2. Authorization: application_admin ONLY. Not `checkStandingFacilitatorOrAdminAuthorization`: a facilitator must not do this, since the use case Actor is "Application" and the issue says admin-only. 403 with machine-readable code `NOT_AN_ADMIN` (**recommended default, settled**; same vocabulary and shape as the #263 codes `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER`). "Application admin" is the existing application_admin role, the same population as in #208. Team membership is irrelevant: an admin who is on the team, on another team, or on no team is treated identically. This is a stated requirement, not an aside.
3. Shared topic-write rate limit (`enforceTopicWriteRateLimit`), after the 403 and before team lookup, as in #184.
4. `checkWritableTeam`: a missing team gets 404 `TEAM_NOT_FOUND` (#265), and the template team gets 404 plus `topic.write_denied_template` audit (#188/#214). The template must never be a target.
5. NO customization-lock gate. This is the one deliberate exception, and the justification is the precondition below, not the caller's role.
6. Precondition inside the transaction, after `lockTeamTopics`: the team has zero ACTIVE topics. If it has any, answer `409 TEAM_HAS_ACTIVE_TOPICS` (**recommended default, settled**) and change nothing. This is both the idempotency rule and the safety rule: a double click, a second admin, or a stale button all land here. Observable requirement: two simultaneous calls on a zero-active team yield exactly one success and one 409, and the team ends with exactly the template's topic count. (Add/restore cannot race with this at all, because the lock blocks them for a locked team; the only racers are other assign calls and room open, which the topic lock serializes. Drop any add/restore race test.)
7. Copy via the existing `copyCanonicalDefaults(client, teamId)`. It renumbers 1..n, excludes annotation columns, and only the ACTIVE rows are unique on `(team_id, display_order)` (migration 18), so pre-existing archived rows cannot collide. Zero rows copied (empty template) means throw `NoActiveTopicsError`, roll back, and answer 500 (see 4a for the body). Copied topics appear in template display order, numbered 1..n, with no annotation fields, identical to those on a freshly created team. Existing archived rows are left untouched; an active/archived pair with the same text is acceptable (archive is history, and the active row is the canonical one).
8. `audit_log` row in the same transaction: operation `topic.defaults_assigned` (new, add to audit-logging-operations spec), metadata `{ topic_count }` only, ids and counts and never topic text. Plus `emitAuditEvent` after COMMIT. Denials reuse existing operations (`topic.write_denied_template`; non-admin gets the same 403 audit treatment as sibling endpoints).
9. **201** (**recommended default, settled**: it creates topic rows) with `{ topicCount }`, where `topicCount` is the number of topics created. The list is not returned; the frontend refetches TOPIC-002.

### 4a. Outcome and audit table (**recommended default**)

| Outcome | Status / code | Audit | Notes |
|---|---|---|---|
| Success | 201 `{ topicCount }` | `audit_log` row `topic.defaults_assigned`, metadata `{ topic_count }`, same transaction, plus `emitAuditEvent` after COMMIT | Team stays in `first_session` lock |
| Non-admin | 403 `NOT_AN_ADMIN` | Same 403 audit treatment as the sibling non-admin denials | |
| Template team | 404 | `topic.write_denied_template` (existing) | Never a target, in UI or API |
| Missing team (well-formed id) | 404 `TEAM_NOT_FOUND` | None, as siblings | |
| Team has active topics | 409 `TEAM_HAS_ACTIVE_TOPICS` | None (no state change) | |
| Empty template | 500 `DEFAULT_TOPICS_UNAVAILABLE` | Log line only (`request.log.error`, template id in the log, never in the body); no `audit_log` row because it would roll back | Same accepted gap as team creation (#175); flagged to compliance in the proposal |
| Rate limited | Shared topic-write limit, inherited unchanged | As siblings | No new limit values |

Responses never include the template team id or topic text. Timing floor and fixed-shape errors copied from siblings.

Empty-template admin experience (**recommended default**): the caller is an authenticated admin, so the 500 carries its own code `DEFAULT_TOPICS_UNAVAILABLE` and a sentence: "The default topic template is empty, so nothing could be assigned. This is a configuration problem, not something this page can fix. Contact whoever operates this deployment and check the server logs." No template id. The button stays available for retry. Rejected alternative: a generic 500 for the one person who can act on it.

Why the lock exception is consistent with the lock's purpose: the lock guarantees "the first session runs the canonical set". A zero-active-topic team has no first-session-eligible configuration at all, so assigning the canonical set restores the invariant instead of violating it. Customizing is still blocked, because the endpoint can only ever write the canonical set. It is not a bypass of customization, so it does not conflict with the lock use case's "no bypass or override mechanism" out-of-scope line, but that line should be amended to name this carve-out so nobody reads it as a contradiction. FR-8.6 [HARD] ("restorable for any team at any time") is satisfied for this state.

After assignment the team remains customization-locked until its first session completes. Recovery does not unlock; the recovered team behaves exactly like a brand-new team (lock stays, first-session explanations present). No notification is sent to the team's facilitator (decision, not omission). No undo of an assignment.

Protective constraints (Devon's checklist):
- No-manager rule: unaffected. The endpoint touches topics only, never membership or participation. Admin write access regardless of membership is the existing #208 decision; do not widen to engineering managers by global role.
- Facilitator-from-another-team: unaffected.
- Not configurable: no flag, no env toggle. The precondition is structural.
- Template guard (#214): the template team is refused at step 4 and the source-inspection test style (teams/__tests__/template-team-guard-source.test.ts) should cover the new route.
- Timing floor and non-leaky errors: copy sibling endpoints (`applyTimingFloor`, fixed 500 body, correlationId, never echo the template id).

## 5. Copy and viewer outcomes (#55), settled strings

All strings below are **recommended defaults**; the spec holds them verbatim, as the existing spec does. H1 is loosened for the zero-topic locked variant only: the copy may name "an application administrator". A named role is something an engineer can go and find; the vague phrase has been an escalation magnet. The existing prohibition on "an application role" wording stays everywhere else.

Topic Management (ActiveTopicsEmptyState), locked, zero active topics:

- Non-admin viewer (facilitator or other): "This team has no active topics, so its sessions can't run. Ask an application administrator to assign the default topics, then refresh this page." No button.
- Application admin viewer: "This team has no active topics, so its sessions can't run. Assign the default topics to restore the standard set." Primary button "Assign default topics". No sentence directing the viewer to ask an administrator.
- Unlocked variants: unchanged.

Room-open 409 `NO_ACTIVE_TOPICS` (advance handler). Keep the code. Make the message viewer- and state-specific when the team is locked with zero active topics:

- Non-admin caller: "This team has no active topics, so the room can't open yet. Ask an application administrator to assign the default topics, then try again. Your session is saved."
- Admin caller: "This team has no active topics, so the room can't open yet. Assign the default topics on Topic Management, then open the room again."
- Unlocked team (add/restore possible): current message, unchanged: "Add or restore a topic on Topic Management before opening the room."

The failed open must leave the session in draft so the facilitator can retry without recreating it (verified by test, see 8).

Server flag: the TOPIC-002 response includes `canAssignDefaults: boolean` (**settled**, not "or equivalent"). It is `true` only when the caller is an application admin and the team has zero active topics and is not the template team; in every other case it is `false` or absent and the UI renders no button (fail-closed, as `canAddTopics`). Tests: admin with active topics, non-admin with zero topics, template team, each yields no button.

Button behaviour: no confirmation dialog (decided; the action is additive and refuses on a non-empty team). One click sends the request; no intermediate prompt; the button is disabled while in flight and its label may show the count of defaults, for example "Assign default topics" with the success line below.

- 201: refetch TOPIC-002, show the standard topic list, no stale empty state, one-line confirmation "12 default topics assigned." (using `topicCount`).
- 409 `TEAM_HAS_ACTIVE_TOPICS`: refetch, show the current list, brief neutral notice "This team already has topics." Not an error banner.
- 500 `DEFAULT_TOPICS_UNAVAILABLE` (or other 5xx): the failure sentence from 4a; button remains available.
- 403/404: generic failure message; should not occur through the UI.

Freshness for the facilitator: no polling and no push. After the admin acts, the facilitator's copy already says "refresh this page", Topic Management refetches TOPIC-002 on load, and the room-open retry reads live topic state. A stale "no topics" view cannot cause a wrong action, because the server decides at open time. If the page already refetches on window focus, keep that; do not add it.

Admin who is also a facilitator on that team: sees the admin variant on the same screen (the variant is decided by role, not membership), so no one needs to be in a different place.

Participants: no change and no new participant copy. A session that cannot open stays in draft, which participants cannot enter; the lobby is never rendered half-open. To be confirmed by a test that a draft is not joinable (8). Only the facilitator's response carries the explanation.

## 6. Is SOME-but-not-zero in scope?

No. A team with one to eleven active topics is not broken: the add/restore/archive paths work for it once unlocked, and FR-8.6's "restore defaults" for a customized team is already covered by `defaultTopicsNotActive` in TOPIC-002 and the per-topic restore flow. Extending the new endpoint to "fill in missing defaults" invents a policy question (what about topics the team deliberately archived, and what about renamed ones?) that the use case Notes answer with "existing teams retain their assigned configuration". Hold the line at zero ACTIVE topics. A team whose topics are all archived is zero-active: if it is unlocked it can restore and add already; if it is locked (only possible by drift) it is in scope and the archived rows are left as they are.

One boundary question: "zero active" or "zero rows at all"? Recommend zero active. It covers both, and the unique index only constrains active rows.

## 7. Decisions (formerly open questions)

1. Problem population: the proposal justifies the work under option (b): FR-8.6 [HARD] ("restorable for any team at any time") mandates an in-app recovery for the zero-active state independent of how many teams are affected. We build B because FR-8.6 is otherwise unmet for that state. The diagnostic query (section 2) is still run and its count recorded in the change, but it does not gate the build. **Recommended default.**
2. Endpoint `POST /api/v1/teams/:teamId/topics/assign-defaults`, 201, codes `NOT_AN_ADMIN` (403), `TEAM_HAS_ACTIVE_TOPICS` (409), `DEFAULT_TOPICS_UNAVAILABLE` (500), `TEAM_NOT_FOUND` (404, existing). **Recommended default, settled.**
3. Spec carve-out text. Replace the lock use case's out-of-scope "no bypass or override mechanism" line with: "The lock can be released for a team only by completing a first session, except that an application administrator may assign the canonical default set to a team with zero active topics (see Recover Zero-Topic Team). This does not permit customization." Replace the "Assign Default Topic Set" Failure postcondition ("the team exists but has no topic configuration", stale since #175) with: "No team or session is created; a team that nonetheless has zero active topics is recovered through Recover Zero-Topic Team."
4. New use case **Recover Zero-Topic Team** (recommended default, for traceability to FR-8.6). Actor: Application Admin (application_admin role, any membership). Precondition: the target is not the template team and has zero active topics. Main flow: admin opens Topic Management for the team, sees the admin empty state, selects "Assign default topics"; the system copies the canonical set in template order under the topic lock, audits it, and shows the standard list with a count confirmation. Alternates: team has active topics (409, refetch and notice); empty template (500, failure message, retry); non-admin or template (refused). Postcondition: the team has exactly the template's active topics, archived rows unchanged, and remains customization-locked.
5. H1 loosened for this variant only (section 5). **Recommended default.**
6. Audit operation `topic.defaults_assigned` is new: delta to `audit-logging-operations`.
7. `/start` check: a conditional that cannot be silently dropped, written into tasks. Run the legacy-lobby query. If it returns zero rows, record that in the change and add no guard. If it returns rows, add a task with acceptance: `/start` returns 409 `NO_ACTIVE_TOPICS` for a lobby session with an empty snapshot.

## 8. Scope recommendation (smallest thing that meets the acceptance criteria)

Intent in one sentence: we build Option B because FR-8.6 [HARD] is otherwise unmet for the zero-active state. Acceptance bullet 1's first half ("can't silently be created") is already true; Option A would close the bullet on paper but leaves recovery to a hand-run DB fix, which the issue calls out. The cost is small because every piece exists (`copyCanonicalDefaults`, `lockTeamTopics`, the admin authorization helper, the template guard, the audit pattern).

Classification: full pipeline. It adds an authorization path that bypasses the customization lock, plus frontend, spec and audit deltas. (The earlier hedge about lightweight is withdrawn: without the button there is no in-app way, so skipping the frontend does not satisfy FR-8.6.)

Recommended change, in this order:
1. Backend: the endpoint with precondition-in-lock design. Tests: 403 `NOT_AN_ADMIN`; 404 missing team; template 404 plus audit; non-admin who is a team member; admin on no team; idempotent 409; empty template 500 with distinct code and no template id; two simultaneous calls (one 201, one 409, exact template count); audit row; response contains no template id or topic text; template-guard source test covers the new route.
2. TOPIC-002: `canAssignDefaults` with the fail-closed tests in section 5.
3. Room-open: role- and state-specific `NO_ACTIVE_TOPICS` message; test that a failed open leaves the session in draft; test that a draft created before recovery snapshots the newly assigned topics at room open (snapshot happens at open, so it is not bound to an empty set). Confirm no state other than draft can exist for such a team (legacy lobby aside, covered by 7.7).
4. Frontend: button, in-flight, success, 409 and failure states, both copy variants in `ActiveTopicsEmptyState`; spec delta to `topic-management-screen` (the variant table gains rows).
5. Spec and use-case deltas: `topic-customization-lock`, `audit-logging-operations`, `topic-management-screen`, new use case, and the 7.3 amendments.
6. Runbook (short, kept from Option A because detection is manual): the diagnostic query, plus how to find `topic.defaults_assigned` audit rows.
7. Verification, no code: run the diagnostic query and the `/start` legacy-lobby query; record both counts.
8. Usability walk-through (Priya has offered): facilitator variant end to end on a staging team with a real admin: blocked at room open, ask admin, admin assigns, facilitator returns and opens the room. Plain-words acceptance: after recovery, a facilitator can open the room without recreating the session and without a confusing reload.

Explicitly out of scope: partial-set top-up (agreed with the facilitator; teams deliberately archive topics, so this is a policy question), a bulk repair job, a UI for editing the template, an EM/facilitator trigger, a "who are the admins" directory, a notification to the facilitator, undo of an assignment, any change to reorder or annotation behaviour, any change to the lock gate itself, any new support-channel concept.

## 9. Response to reviews

Accepted, with where it landed:
- Facilitator 1, 3: room-open message revised, role named (sections 5, 8). Facilitator 4, 5, 6, 7, 8, 9: refresh wording, draft-snapshot test, participants, recovered team behaves as new, count confirmation (sections 4, 5, 8).
- Facilitator Q2, Q4, Q5: answered in sections 5 and 4a. Usability walk-through and plain-words criterion added (8).
- BA A1-A6, B1-B8, C, D: decided in 4, 4a, 5, 7, 8. Template-empty admin message given a distinct code. Short runbook kept. `/start` conditional made a task.

Pushed back or narrowed:
- Facilitator Q1 (ship copy fixes alone regardless): declined as a separate change. Copy that tells a facilitator to ask an administrator to assign defaults is only true once admins can. Shipped separately it would point at a button that does not exist, and the copy is a tiny part of the cost of B. If the PO defers B, the honest holding action is the Option A runbook, with the room-open message at least saying who to contact.
- Facilitator Q3 and "find the admin": a "who are the admins" display is out of scope. It makes the application a directory and an escalation surface; naming the role is the agreed boundary. Large organizations resolve admins through their own channels.
- Facilitator suggestion of a facilitator-facing line on the session draft page: not added. The state is expected to be near-zero population, and the room-open message plus the draft staying intact already costs the facilitator one retry, not a lost session. Adding persistent chrome to the prep page for a rare case works against keeping the application in the background. Revisit only if the diagnostic query finds real teams.
- Facilitator suggestion of refetch on focus or polling: not added beyond what exists (section 5). The server decides at open time, so staleness cannot cause a wrong action.
- BA "fail-closed field, name it, test each combination": accepted fully. BA suggestion of a durable audit row for the 500 path: declined for now. The row would have to be written outside the rolled-back transaction, which introduces a new audit pattern for a rare, admin-only failure, and the same gap exists in team creation (#175). Flagged to compliance in the proposal, with the log line as the record.
- None of the feedback asked for a configurable toggle, a manager path or a facilitator trigger, so no core constraint was in tension. No-manager rule, facilitator-from-another-team, and the lock remain structural.
