# Exploration Notes: Enforce Access Control on Team Content
**Perspective:** Devon Calloway, Internal Champion
**Use Case Source:** requirements/use cases/01 - Identity and Access - Use Cases.md (lines 304–361)
**Related Specs:** openspec/changes/archive/2026-07-06-assign-role-to-team-member/specs/session-participation/spec.md, openspec/changes/archive/2026-07-07-establish-manager-team-relationship/specs/manager-team-association/spec.md
**Related Architecture:** requirements/High-Level Architecture.md (section 6, ADR-007)
**Date:** 2026-07-07
**Revised:** 2026-07-07 (incorporating review feedback from Priya Nair and Marcus Delgado)

---

## 1. What This Use Case Is Trying to Accomplish

Every previous change in this sequence — Sign In, First Access, Join a Team, Assign a Role, Establish Manager/Team Relationship — created and shaped relationships: who is on which team, what role they hold, what the EM-to-team mapping looks like. This use case is different. It is not about creating or changing relationships. It is about enforcing them at the moment data is requested.

Put plainly: this use case answers the question "should this authenticated user be allowed to see this team's content?" and the answer must be checked server-side on every request for every piece of team-scoped data. Not checked once at login. Not cached from the last check. Not enforced only in the UI layer. Every request. Every time.

The content types in scope are broad: session data (live and historical), trend history, action items, and topic configuration. Each has a different access profile depending on the role of the requesting user. The use case correctly says that what each role can see within its permitted team is defined per feature set — but that still leaves the "is this user authorized to see this team's content at all" question as the threshold check that every content endpoint must pass.

This use case establishes and locks down that threshold check. Everything else downstream depends on it holding.

---

## 2. Why It Matters for the Ritual and Product Intent

The ritual's psychological safety guarantee rests on a single belief that engineers must hold: their vote is not being seen by anyone who could use it against them. That belief requires the access control layer to actually work — not to appear to work in the UI while being bypassable through a direct API call.

The feature sets have gone to significant lengths to protect vote data:
- Votes are held in Redis opaque until the facilitator triggers the reveal
- EMs see only aggregate vote distributions, never individual attribution
- Facilitators see readiness (who locked in) but not vote content before the reveal
- Participant views do not show outlier flags

All of that protective work is undone the moment an unauthorized user can get raw session data through any path — an unprotected endpoint, a WebSocket channel that doesn't check authorization, a frontend route that doesn't gate its API call properly.

There is something I have seen in organizations before: access control that was designed carefully for the known paths but left unchecked for the paths nobody thought about. A 403 on the dashboard endpoint, but a 200 on the session history API endpoint with no auth check because "the frontend doesn't render that data for this role anyway." That gap is where the surveillance perception gets born. One engineer discovers the bypass, tells others, and suddenly the ritual is running inside an application that no one trusts.

Objective 4 in the BRD says this plainly: "Zero engineers will raise a concern — through any channel — that session data is being used in a way that feels like individual performance evaluation or management surveillance. This outcome is binary." That is not a UX problem. That is an access control problem. This use case is where we prevent it.

---

## 3. What Has Been Built Already and Why It Matters Here

The prior five changes were not just feature builds. They created the data model that this change must query correctly.

**From Sign In and First Access:** Every user has a `users` record with a `global_role`. EMs arrive with `global_role = 'engineering_manager'` via the IdP claim mapping implemented in first-access. That field is what the session participation spec checks first.

**From Join a Team:** Every team membership is a `team_memberships` row with `role = 'participant'`. A user who follows a join link gets one of these rows. The access control check for "is this user a team member" is checking for the existence of this row.

**From Assign a Role:** A team member's `team_memberships.role` may be `'engineering_manager'` even if their `users.global_role` is `'engineer'`. The session participation spec established that BOTH fields must be checked — checking only one creates a bypass path. This dual-check pattern is load-bearing and must not be simplified away in this change.

**From Establish Manager/Team Relationship:** An EM who was never an engineer on the team has a `team_memberships` row with `role = 'engineering_manager'` created by TEAM-006. The EM-facing read-only access to history, trends, and action items depends on this row. The vote attribution boundary was defined and confirmed in that change's design. This change must enforce that boundary at every endpoint that returns session or vote data to an EM.

**ADR-007 (High-Level Architecture):** The facilitator access model is context-scoped to an active session. A facilitator who has run sessions for many teams should not have permanent accumulated read access to all those teams. The access check for a facilitator requesting historical team data is:

```
sessions.facilitator_id = $current_user AND sessions.team_id = $requested_team AND sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')
```

This is the correct check. The inclusion of `lobby` in the status set is intentional and deliberate: a facilitator who has been assigned to a session that has not yet opened should be able to review the team's historical data before the room fills. That preparation window is valuable and it is already baked into the SQL check by including `lobby`. This choice must be stated explicitly in the proposal because the alternative — beginning historical access only when the session moves to `pre_session` — is a legitimate design choice that produces a different check. I am confirming the former. The proposal must carry that confirmation, not leave it as an inferred behavior.

This check must not be simplified to "is this user a facilitator?" because that grants permanent cross-team access to anyone with `global_role = 'facilitator'`. That is a material weakening of the data containment model.

---

## 4. The Three Authorization Paths — and Why They Are Not Equivalent

The use case identifies three conditions under which access is granted:

1. The user is a member of the team (Engineer, Facilitator-as-team-member, or Engineering Manager role on this team)
2. The user is the Engineering Manager associated with this team
3. The user is the facilitator of an active session for this team

I want to be precise about what these mean in terms of data model checks and which content types each path should unlock. The use case does not distinguish between content types, but the implementation must.

### Path 1: Team member

A user has an active `team_memberships` row with `removed_at IS NULL` for this team.

Sub-cases:
- `membership_role = 'participant'` — can see their team's session history, trends, and action items; participates in live sessions
- `membership_role = 'engineering_manager'` — same access profile as a standalone EM association (see Path 2); cannot participate in live sessions; sees aggregate vote distributions only

These are different content access profiles and must not be merged.

**Defining "participant view" of historical session data.** Section 4 has used this phrase without defining it. A participant's view of a completed session's history is not the same data shape as their live session view. The definition for purposes of this change is:

- The aggregate vote distribution for each topic in the session: the count of votes at each score value (e.g., "2 votes at 2, 4 votes at 3, 1 vote at 4"), without individual attribution
- The team score per topic (average, or equivalent summary statistic per the session spec)
- Trend data: how this topic's score compares to prior sessions
- The participant's own individual vote for each topic they participated in — they can see what they voted, but not what anyone else voted

What the participant view does not include: any mapping of vote value to individual engineer identity for other engineers. After a session's votes are revealed, participants in the room see the aggregate distribution. The historical view should be consistent with what they saw in the room — the distribution, not individual attribution. The proposal must specify this as the session history endpoint's response contract for the Engineer role.

**Resolving the vote attribution contradiction.** The matrix in Section 8 shows "Yes (for completed sessions they participated in)" for Engineer access to individual vote attribution. My Q2 (now Q3) flagged this for confirmation. Those two claims are in conflict: the matrix carries a definitive cell for something I marked as unresolved. My resolution, stated now: Engineers can see their own individual vote in the history. They cannot see other engineers' individual vote attribution. The matrix cell should read "Own vote only; aggregate distribution for the team" and Q3 should reflect this as resolved. The proposal must carry this as a confirmed design decision, not a TBD.

### Path 2: Engineering Manager by explicit association

This is the TEAM-006 path. The user has `global_role = 'engineering_manager'` AND a `team_memberships` row with `role = 'engineering_manager'` for this team.

Authorized content: session history (aggregate vote distributions, not individual attribution), trend data, action items (title, status, assignee name). Forbidden: live session data, individual vote attribution, write access to anything.

**Defining "aggregate vote distributions."** This phrase appears throughout the notes, the prior specs, and the use case acceptance criteria as if it carries a shared definition. It does not — no document I can point to defines the data shape. I am defining it here.

"Aggregate vote distributions" means: the count of votes cast at each score value for a given topic and session, presented as a histogram or count-per-bucket without any mapping of vote value to individual engineer identity. This includes summary statistics (team average, score range, outlier count) derived from that distribution. It explicitly excludes: the identity of which engineer cast which vote, ranked orderings that would allow inference of individual engineers' votes by process of elimination, and any data that would allow an EM to reconstruct individual vote attribution indirectly.

The complement framing from the manager-team-association spec is: "EM-facing endpoints must never return individual vote attribution." The affirmative definition above is the complement of that constraint: what EMs do see is count-per-bucket histograms and summary statistics, nothing further.

This definition must appear in the manager-team-association spec (as the source spec for the EM access boundary) or in this change's proposal. Either location is acceptable. It must not remain undefined when the proposal is written.

### Path 3: Facilitator of an active session

The user has `global_role = 'facilitator'` (or a team from which they're facilitating another team) AND `sessions.facilitator_id = $current_user AND sessions.team_id = $requested_team AND sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')`.

Authorized content: all historical session data for this team (session history, trends, action items) for the duration of the active session. The notes in the use case confirm this: "A facilitator can access the current session and the facilitated team's full historical data (session history, trends, action items) for the duration of their facilitation." After the session ends or is closed, this access path is no longer valid (see Section 10 for the post-session access policy, which carves out a bounded exception to this rule).

**What the facilitator does not see before the reveal.** This constraint must be explicit in the access model, not assumed. The facilitator's elevated access during an active session does not include vote values for any topic that has not yet been revealed. During the pre-reveal phase of an active topic, the facilitator sees the readiness grid — who has locked in their vote — and nothing more. Vote values are not returned to the facilitator, regardless of the fact that their session-scoped access grant is broad.

This constraint must be enforced at two layers:
1. The authorization layer correctly identifies the facilitator as authorized for live session data
2. The serialization layer enforces the pre-reveal / post-reveal distinction in what data is included in the response

These are not the same check. An authorization check that correctly grants the facilitator access to "live session data" does not automatically restrict what shape that data takes. The serializer must know the topic's reveal status and exclude vote values accordingly. The proposal must specify both enforcement points and name them as separate acceptance criteria.

**What the proposal must resolve:** Path 3 grants full historical read access, while Path 2 grants aggregated-only read access. They must not be conflated in implementation. A facilitator running a session can see individual vote data in revealed topics. An EM cannot. Both paths authorize "access to session history" — but the data they receive must be different.

---

## 5. The Application Admin Case — An Omission in the Use Case

The use case does not mention Application Admins. This is a gap.

Application Admins are the actors who establish team memberships, assign roles, and perform TEAM-006. They necessarily need access to team administration views. Whether that access extends to full session content (vote history, trend data) is unclear from the use case text.

There are two design options:
- **Option A:** Application Admins have blanket access to all team content across all teams. This would be consistent with their administrative authority but creates a large access footprint that introduces a surveillance risk. An admin can see all team history across the entire organization.
- **Option B:** Application Admins have access to team administrative data (membership lists, role assignments, EM associations) but not session content unless they hold a separate team membership. Session content remains scoped to team relationships.

My position is Option B. The no-cross-team-visibility constraint in the organizational constraints (Constraint 1 in the BRD) says: "Session data, vote history, trend charts, and action items for a given team are visible only to the engineers on that team, the team's Engineering Manager, and the facilitator assigned to a given session." Application Admins are not in that list. If we grant them session content access by default, we have created an organization-wide surveillance path through the admin account. Every admin becomes a potential window into every team's data.

**Affirmative scope of Option B.** The current framing tells the team what admins cannot access. That is not sufficient — the implementation team needs to know what endpoints an Application Admin may call, not just which ones they may not. Reasoning by exclusion creates gaps. The affirmative scope is:

- Team metadata: team name, creation date, active/archived status
- Team membership lists: member user IDs, display names, assigned roles, join date, active/removed status
- Role assignments: current `membership_role` for each team member
- Engineering Manager associations: which EM is associated with which team
- Topic configurations: topic names and descriptions, including team-level customizations (no session data attached)

Application Admin access under Option B explicitly excludes everything in the BRD's enumerated list of session-scoped content: votes, scores, readiness state, topic-level results (live or historical), trend data, action items, and any other data that is generated by or derived from a session.

This list defines the TBD cells in the matrix (Section 8) for the Application Admin column. Any endpoint that does not fall within the affirmative scope list above should return 403 for Application Admin callers.

**Audit logging under Option B.** Section 15 ("What Must Not Come Out") states that "if Application Admins are given access to session content, that access must be audited." Under Option B, they are not given session content access — so that condition is never triggered. But that does not mean admin activity on administrative data should go unlogged.

The manager-team-association change established audit logging for EM content access. Admin access to membership records, role assignments, and EM associations must be captured in the same audit log. An Application Admin who manipulates team membership — adding themselves to a team, for example — to gain indirect access to session content should be detectable from the audit trail. The proposal must specify that admin reads and writes of team administrative data are logged with the same fields as EM content access events: timestamp, actor identity, action taken, resource accessed.

This must be an explicit design decision before the proposal is written. It is not an implementation detail.

---

## 6. Server-Side Enforcement as a Non-Negotiable Constraint

The BRD is unambiguous: "Authorization must be enforced server-side on every API endpoint, independently of any access control logic in the frontend. The frontend's presentation of controls is not an authorization control." (SEC-7, NFR-AUTH-003)

The architecture document says the same: "Authorization decisions must be enforced server-side on every protected request and WebSocket event. The server must not rely on the frontend to enforce access control." (NFR-AUTH-003)

This use case's acceptance criteria reflect this: "Access control is enforced server-side; it is not dependent solely on UI visibility."

I want to name what "not solely UI visibility" actually means in implementation terms, because the phrase is easy to affirm and hard to verify:

1. **Route-level guards are not sufficient.** A route guard that redirects an unauthorized user away from a dashboard page does not prevent that user from calling the underlying API endpoint directly with a crafted request. Every API endpoint that returns team content must independently verify authorization, not rely on the calling client having already been gated elsewhere.

2. **Checking at the query level, not filtering afterward.** SEC-10 requires that the team boundary be enforced at the query level — not enforced by retrieving a broader result set and then filtering out unauthorized data. A query that pulls all sessions and then checks `WHERE team_id IN (select teams for this user)` is acceptable. A query that pulls all sessions for all teams and then strips the unauthorized ones in application code is not — it may still leak data through timing or size characteristics, and it is a maintenance liability.

3. **WebSocket content-access events must be named and checked at delivery time.**

Saying "every WebSocket event must be authorized the same way as the corresponding HTTP endpoint" is a principle, not a requirement. A developer cannot implement a principle. The events in scope for content-access enforcement are distinct from the privileged action events named in OAQ-005 (reveal trigger, session close, topic advance). The content-access WebSocket events this change must cover are:

- **`vote_readiness_update`** — pushed to the facilitator's connection when a participant locks in their vote; confirms a participant has submitted without revealing their vote value. The subscriber must be the active facilitator for this session.
- **`session_state_change`** — pushed to session participants and the facilitator when session status transitions. The subscriber must be an active participant or the active facilitator for this session.
- **`vote_revealed`** — pushed to all session participants and the facilitator when a topic's votes are revealed by the facilitator. The subscriber must hold a valid participant or facilitator authorization for this session.
- **`topic_history_update`** — pushed to team event stream subscribers when historical session data is updated (e.g., action items added during wrap-up). The subscriber must pass the same team membership check as the corresponding HTTP endpoint.

There are three distinct authorization check points in a WebSocket connection lifecycle, and they are not equivalent:

- **Connection time:** Validates that the user is authenticated and has some relationship to the server. Necessary but not sufficient. Does not catch role changes that happen after the connection is established.
- **Subscription time:** Validates that the user is authorized to subscribe to a specific team or session event stream. Catches the moment they join a channel, but like connection-time checks, does not re-validate as the session proceeds.
- **Delivery time:** Validates authorization on each event before it is pushed to the subscriber. This is the only check that satisfies SEC-25's re-authorization requirement. A user whose team membership is revoked mid-connection must stop receiving events. Only delivery-time checks enforce this without requiring a reconnect.

The proposal must specify that all content-access WebSocket events listed above use delivery-time authorization checks. Connection-time and subscription-time checks may exist in addition to delivery-time checks, but they cannot substitute for them.

4. **Re-validation: named mechanism and specific bound.**

"Meaningful intervals" (SEC-25, cited in the architecture document) is not testable and must not appear in the proposal as written. The proposal must specify two things: the check mechanism and the maximum latency bound.

The mechanism I am recommending: delivery-time authorization on each content-access event, which provides a latency of zero — a subscriber who loses team membership receives at most one more event (the one in flight at the moment their membership row changes). This is the cleanest model and requires no additional timer or polling infrastructure.

The bound, stated as a testable acceptance criterion stub:

> "When a user's `team_memberships.removed_at` is set while the user is connected via WebSocket to that team's session event stream: the server must stop delivering events to that subscriber. No further content-access events will be delivered after the membership change is committed."

If the implementation team cannot achieve zero-latency revocation and requires a timer-based re-check instead, the proposal must name a specific bound — 60 seconds is a reasonable starting point, but the team must commit to a number, not a phrase. "Meaningful intervals" will be implemented differently by different engineers and will produce gaps.

---

## 7. The Information Disclosure Problem

The use case says: "The denial is not exploitable to infer what teams or sessions exist."

This is easy to state and surprisingly hard to implement consistently. The ways it can go wrong:

- **404 vs. 403 inconsistency.** If an authorized user requesting a nonexistent team gets 404, and an unauthorized user requesting a real-but-forbidden team also gets 404, that's consistent and correct. But if an unauthorized user gets 403 for a team that exists and 404 for a team that does not, the response code reveals existence. For teams and sessions, the response to an unauthorized request should be consistent regardless of whether the resource exists.

- **TEAM-006 already addressed this.** The design for Establish Manager/Team Relationship included a "404 information exposure constraint" in Decision 4: "A 404 for 'team not found' must be indistinguishable from a 404 for 'team found but caller is not authorized to know it exists' when the caller is not an Application Admin. Error responses must not leak existence information beyond what is authorized." This same principle must be applied uniformly across all team content endpoints. It cannot be applied to some endpoints and not others.

- **Response size and timing.** If a 403 response returns faster than a 200 response (because the authorization check returns early without hitting the database), an attacker can infer from response time whether a resource exists. This is a timing oracle. The implementation should be designed to avoid this, or at minimum it should be documented as a known limitation if unavoidable.

---

## 8. The Content Type Access Matrix — What the Proposal Must Define

The use case is written at the team-access level, but the implementation operates at the content-type level. Before a proposal can be written, the authorization matrix must be defined precisely. What I am flagging is that it has not been done explicitly anywhere in the requirements.

Here is my working draft. Cells marked with `[?]` are not yet confirmed decisions and must not be read as settled. The proposal must resolve all `[?]` cells before acceptance criteria can be written.

| Content Type | Engineer (team member) | Facilitator (active session) | EM (associated) | Application Admin |
|---|---|---|---|---|
| Live session data (votes pre-reveal, readiness grid) | Readiness grid only (own status) | Readiness grid only — vote values excluded regardless of access level | None | None |
| Live session data (post-reveal votes) | Aggregate distribution + own vote | Full revealed distribution with individual attribution | None | None |
| Session history (aggregate vote distributions) | Yes | Yes (during active session only) | Yes | No |
| Session history (own individual vote) | Yes | Yes (during active session only) | No | No |
| Session history (other engineers' individual vote attribution) | No | Yes (during active session only, for revealed topics) | No | No |
| Trend data | Yes | Yes (during active session only) | Yes | No |
| Action items | Yes | Yes | Yes (read-only) | No |
| Topic configuration | Read only | Read/Write during session setup | None | Read only (metadata, no session data) |
| Team membership list | Read only | Read only | None | Yes (full) |
| Role assignments | Read only (own role) | Read only | None | Yes (full) |
| EM associations | None | None | Read only (own association) | Yes (full) |

**Notes on the Facilitator column:** The pre-reveal / post-reveal distinction is now explicit. "Readiness grid only" for pre-reveal data is not a permissions downgrade — it is the correct facilitator view. The facilitator's elevated access does not include vote values until after they trigger the reveal. This is a load-bearing ritual constraint (the simultaneous reveal mechanic), not a security boundary. The two rows for live session data that previously showed "Facilitator view" (undefined) now carry specific definitions.

**Notes on unconfirmed cells:** The matrix previously showed "Yes (for completed sessions they participated in)" for Engineer access to individual vote attribution, while Q2 marked this as unconfirmed. That contradiction is resolved above — the Engineer row is now split into own-vote access (Yes) and other engineers' attribution (No). Both are confirmed. The proposal should not carry TBD cells for these rows.

The Application Admin column is now populated based on the Option B affirmative scope defined in Section 5.

---

## 9. The Facilitator Scoping Question — Carrying Forward ADR-007

ADR-007 is one of the most careful design decisions in the architecture document. It says:

> A facilitator's access to a team's historical session data is context-scoped to an active session, not a persistent permission.

This is exactly right from a ritual integrity standpoint. A facilitator who has run sessions for a dozen teams over three years should not have accumulated standing read access to all of those teams' complete session histories. That would make the facilitator role a backdoor into the full organizational dataset.

The challenge for this change is that ADR-007 is stated in the architecture document but the enforcement mechanism — checking for an active session row before returning historical data to a facilitator — must be implemented in every endpoint that serves historical team content. It is easy to implement the facilitator access as a simple `global_role = 'facilitator'` check and grant broad access. That would be faster to implement and wrong.

The correct implementation is described in ADR-007:

```sql
-- Path 1: Team member check
team_memberships.user_id = $current_user AND team_memberships.team_id = $requested_team AND team_memberships.removed_at IS NULL

-- Path 2: Active facilitator session check (for historical data access)
sessions.facilitator_id = $current_user AND sessions.team_id = $requested_team AND sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')
```

The proposal must require this check, not assume it. It must be an acceptance criterion that a facilitator who has previously run a session for Team A cannot access Team A's historical data through the same session history endpoints after their session for Team A has ended.

Section 10 addresses two boundary cases that are not handled by the SQL check above: what happens before a session exists (pre-session preparation), and what happens in the minutes after session close (the post-session access cliff). Both require a design decision that the SQL check above cannot resolve on its own.

---

## 10. Pre-Session Preparation and Post-Session Access Policy

Two timing questions about facilitator access have surfaced through this exploration and must be answered before the proposal is written. Both concern the outer boundaries of the facilitator's time-scoped access: where it begins, and where it ends. Neither is a detail. Both affect the SQL check in Section 9 and must produce acceptance criteria in the proposal.

### Pre-Session Preparation Window

The SQL check in Section 9 includes `sessions.status = 'lobby'`, which means a facilitator gains historical read access as soon as a session record exists for this team. That is intentional (see Section 3). But it does not fully resolve the preparation problem.

In practice, facilitators review the team's recent session history before deciding how to structure the session they are about to create — which topic to start with, whether to address a prior action item directly, whether an outlier pattern from last quarter repeated. That review happens before session creation. Under the current model, a facilitator must create a session record to access the historical data they need to decide how to create the session. That is a circular dependency, and it reverses the natural preparation workflow.

The access model currently has no state that grants facilitator-scoped historical read access without requiring a session to exist first. Fixing this requires either adding a state or accepting the workflow inversion as a known constraint.

**My position:** I recommend adding a `draft` session status that allows a facilitator to read historical data for a named team before the session opens. A `draft` session record expires automatically — and is deleted without transitioning to `lobby` — if the facilitator does not advance it within 24 hours. The facilitator must associate the draft session with a specific team before any historical data is returned. This preserves the team-scoping principle and the session-association principle from ADR-007. It does not create open-ended historical browsing access. A facilitator cannot create a `draft` session for a team without being an authorized facilitator in the system.

The SQL check expands to:

```sql
sessions.facilitator_id = $current_user AND sessions.team_id = $requested_team
AND sessions.status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')
```

If the implementation team judges the `draft` status to be out of scope for this change, the alternative — accepting that session creation is the access gate — is acceptable but must be documented as a known workflow constraint, not an invisible design decision. The behavior at session creation (facilitator creates a session to unlock historical data, then structures the session based on what they find) must be described in the facilitator onboarding material.

**This is a design prerequisite.** Whether `draft` is in scope determines the SQL check. The proposal cannot define facilitator access without resolving it.

### Post-Session Access Cliff

When a facilitator closes a session, the session transitions to a terminal status (`completed`). The SQL check fails. Historical access ends immediately. That is the correct behavior under ADR-007.

The problem is the ten-to-thirty minutes after session close. The facilitator is often still in the room: an action item gets added, a participant asks about a prior session pattern, the facilitator wants to verify that the wrap-up note captured the result correctly. The moment they close the session — which is the natural completion step — they lose the access they need to finish that work. The system penalizes the act of completing the session.

This is not a hypothetical edge case. A facilitator who closes the session prematurely to mark it done and then realizes they need the historical data to respond to a question is locked out. Reopening the session (if that is even possible) is not a graceful recovery.

**My position:** A short, time-bounded post-session grace window is acceptable if and only if it meets three conditions:

1. It is defined explicitly in the proposal and tested as a named acceptance criterion — not an informal behavior
2. It is bounded to a maximum of 30 minutes from the session close event
3. It is read-only — no write access of any kind during the grace window

The mechanism I recommend: add a `facilitator_access_expires_at` timestamp column to the `sessions` table. When a session transitions to `completed`, this field is set to `completed_at + 30 minutes`. The SQL check for Path 3 expands to:

```sql
sessions.facilitator_id = $current_user AND sessions.team_id = $requested_team AND (
  sessions.status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')
  OR (sessions.status = 'completed' AND sessions.facilitator_access_expires_at > NOW())
)
```

This is a deliberate, time-bounded extension of the ADR-007 model. It does not create permanent access. It does not accumulate across sessions. A facilitator who ran Team A's session two weeks ago and whose grace window has expired has no access to Team A's data, as ADR-007 requires. The grace window applies only to the most recently closed session, and only for 30 minutes.

If the implementation team chooses not to implement the grace window, that is acceptable — but the workflow cost must be acknowledged in the proposal and the session close behavior must be documented as a known friction point. Facilitators must be instructed to complete all post-session work before closing, which means the session close action needs UX framing that makes this expectation clear.

**This is a design prerequisite.** The post-session SQL check depends on this decision. It must be resolved before the proposal can define the facilitator access revocation acceptance criterion.

---

## 11. Error Handling During Live Sessions

The exploration notes addressed denial behavior from a security standpoint: consistent 403/404 responses, no existence disclosure, no silent degradation. That is correct for the general case. It is incomplete for the live facilitation context.

A facilitator running an active session is in a room with eight engineers. The reveal moment — when the vote results appear — is the highest psychological stakes moment in the ritual. An access control failure at that moment is not a routine error that the user can navigate to another screen to investigate. It is a session-ending event if it presents as opaque or disorienting.

The proposal must specify facilitator-facing error states for live session contexts. These are named states, not general error handling.

### Error State 1: Authorization failure during vote reveal

**Trigger:** The facilitator triggers the reveal. The backend authorization check fails — the session status transitioned unexpectedly, the facilitator's session row is not found, or a server-side error occurs.

**What the facilitator must not see:** A generic error modal, a blank results panel, or any state that does not tell them whether the session is still recoverable.

**What the facilitator must see:** An error that distinguishes between two cases:
- *Transient / recoverable:* "The reveal could not be completed. Your session is still active. Try again." The facilitator dismisses this, the panel remains visible, they retry.
- *Non-recoverable:* "This session is no longer in an active state. Please review the session status." The facilitator knows to check session state before retrying.

The error must not include technical details. It must not hint at the existence or state of other sessions. It must contain the minimum information needed to decide whether to retry.

### Error State 2: Historical data unavailable during active session

**Trigger:** The facilitator is viewing historical trend data during the session — comparing this topic's current vote to prior results. An authorization check fails or the data endpoint returns an error.

**What the facilitator must not see:** "You do not have access to this data." In a live session context, that phrasing will be interpreted as a session problem, and the facilitator may end the session unnecessarily.

**What the facilitator must see:** An empty state labeled "Historical data is temporarily unavailable. Your session is still active." This communicates a transient data availability issue, not a denial of access. The facilitator can proceed with the session and revisit historical data later.

### Error State 3: Session status transition during live facilitation

**Trigger:** The session status changes while the facilitator is mid-flow — due to a system timeout, an accidental state advance, or a WebSocket connection drop that causes the frontend to lose session state.

**What the facilitator must not see:** A modal that blocks the screen. In a room with eight engineers watching, a screen-blocking modal is disruptive in a way that cannot be recovered gracefully.

**What the facilitator must see:** A persistent banner — non-blocking, visible above or alongside the session view — that states the current session state and offers a clear action: "Session state has changed. [Current state]. Resume or review." The facilitator can see the participant grid and topic state while the banner is displayed and decide how to proceed.

### Error State 4: Denied access to another team's data during an active session

**Trigger:** A facilitator operating across multiple teams attempts to access Team A's history while in a session for Team B. This is the correct denial behavior — the containment model working as intended.

**What the facilitator must not see:** "You do not have access to Team A's session history." That reveals Team A's existence and that it has session data.

**What the facilitator must see:** "This data is not available in your current session." The phrasing correctly communicates that the constraint is contextual — the current session, not the facilitator's general permissions — without leaking information about the requested team.

### Implementation requirement

The proposal must specify that the facilitator view has distinct, named error states for live session contexts. These states are not the same as the generic 403/404 error handling used for non-live contexts, and they must not inherit the general error presentation without adaptation. An authorization failure during a live session is a UX emergency. The implementation team should treat it as such, with the same care given to the reveal mechanic and the simultaneous vote experience.

---

## 12. Ritual Constraints That Must Not Be Weakened by This Change

**The no-manager-in-sessions rule.** The session participation spec established that EMs cannot join sessions, enforced via dual-check on `global_role` and `membership_role`. This change must not create any access path through which an EM gets live session data. The distinction is important: an EM can access session history (completed, revealed data); they cannot access live session state (in-progress votes, readiness grid, connected participants). These are different endpoints, different data, and the enforcement must be different. Granting "access to team content" must not accidentally include live session data in the grant.

**The vote attribution boundary.** Established in the manager-team-association change and confirmed in writing. EM-facing endpoints must never return individual vote attribution. This change must maintain that boundary across every content endpoint it governs. If the proposal defines a generic "team content access" authorization layer, that layer must not accidentally collapse the EM view and the Engineer view into the same response shape.

**The facilitator-from-another-team requirement.** FR-2.2 says a facilitator cannot create a session for a team they belong to as a Participant or EM. This change is not about session creation, but if the access control logic grants facilitators access to their own team's content through the "facilitator of an active session" path, there would be a subtle inconsistency: a facilitator who creates a session for Team B (which they can, because they're not a Team B member) gets Team B's historical data; but a facilitator who is a member of Team A gets Team A's historical data through their team membership path. Both are correct. The issue would be if the implementation inadvertently allows a facilitator to use an active session for Team B to also browse Team A's historical data. The access check must scope the session path strictly to the team of the active session.

**The simultaneous reveal.** Not directly in scope here, but this change governs the endpoint that serves vote data. That endpoint must return nothing until the session status is `revealed` for the relevant topic. The session participation spec handles vote submission and lock-in; this change governs what can be read back. The constraint — no vote values returned before reveal — must be enforced here too.

**The facilitator does not see vote values before the reveal, even during a session they are running.** This is explicitly restated here because it is easy to assume the facilitator's elevated access includes vote values. It does not. The access grant ("facilitator of an active session may access live session data") and the content restriction ("vote values are excluded from pre-reveal responses") are orthogonal constraints. The authorization check and the serialization contract must both implement this. Neither one alone is sufficient. The proposal must name both enforcement points as separate acceptance criteria.

---

## 13. Open Questions to Resolve Before a Proposal Is Written

Questions are ordered by blocking priority. Questions that govern scope and architecture are listed first. Questions that cannot be answered until earlier ones are resolved appear later.

**Q1 (Blocking — resolve before all other questions): Does this change implement new enforcement infrastructure or audit existing enforcement?**

The prior changes have built individual enforcement points: the session participation spec governs session joining; the manager-team-association spec governs EM-facing content endpoints. This "Enforce Access Control on Team Content" use case reads like a cross-cutting concern — it must apply to every team content endpoint, not just specific ones.

The implementation team needs to understand what this change's deliverable is:
- Is this a change that creates new middleware, a reusable authorization helper, or a shared query function that all existing and future content endpoints will use?
- Or is this a change that audits and verifies the enforcement points already implemented in prior changes and documents the remaining gaps?

These are different scopes and different implementation approaches. The proposal cannot be written until this is resolved. Everything else — how many endpoints are in scope, whether new infrastructure is built, how long the change takes — depends on the answer to this question. Owner: engineering lead, in consultation with Rachel Okonkwo.

**Q2 (Blocking): What is the Application Admin's access profile for session content?**

The use case does not address it. The organizational constraint in the BRD scopes session data to "the engineers on that team, the team's Engineering Manager, and the facilitator assigned to a given session." Application Admins are not named. My position is Option B (administrative data only, no session content). The affirmative scope of Option B is defined in Section 5. This must be a deliberate decision with a named owner, not an inference. Owner: Marcus Delgado (BA) in consultation with Rachel Okonkwo (VP Engineering) and Tomás Ferreira (security).

Acceptance criterion stub for Option B:
> "Given an authenticated user with `global_role = 'application_admin'` and no `team_memberships` row for Team A: a request to GET /teams/:id/sessions returns 403. The response body confirms access is denied but does not indicate whether Team A exists or has any session records."

**Q3 (Design prerequisite): Confirm the content type access matrix.**

The draft matrix in Section 8 must be reviewed and confirmed before design begins. The following cells were previously unresolved and are now addressed:
- Engineer access to individual vote attribution: resolved as "own vote only; aggregate distribution for the team" (see Section 4)
- Facilitator pre-reveal vs. post-reveal access: resolved in the updated matrix (see Section 8)
- Application Admin access: resolved per Option B affirmative scope (see Section 5)

Marcus should confirm the matrix before design begins, as he did for the vote attribution boundary in the manager-team-association change. The matrix should not be treated as settled until that confirmation is on record.

**Q4 (Design prerequisite): Pre-session preparation window and post-session access policy.**

This was previously labeled "Clarification needed" (Q5). It is a design prerequisite. The SQL check for Path 3 depends on whether `draft` status is added and whether a `facilitator_access_expires_at` grace window is implemented. Neither can be inferred from the existing SQL check — both require a deliberate decision.

My positions on both are stated in Section 10. The implementation team should confirm or challenge them before the proposal is written. Owner: engineering lead, with input from Priya Nair as the facilitation SME.

**Q5 (Design prerequisite): WebSocket authorization scope.**

Every WebSocket subscription to team content must be authorized with delivery-time checks on each content-access event. The specific events in scope are named in Section 6. The proposal must explicitly map which WebSocket events require which authorization checks and confirm delivery-time as the required check timing. OAQ-005 in the BRD flagged this as unresolved. This change is the right place to resolve it, at least for the content access layer. Owner: solution architect and security analyst jointly.

**Q6 (Implementation decision before build): Consistent 403/404 behavior.**

How should the application handle existence disclosure in denial responses? The TEAM-006 design established a pattern for one endpoint. This change must either establish it as a system-wide rule or document per-endpoint decisions. The security analyst should own this recommendation. The implementation team should not build content endpoints without a named policy.

**Q7 (Blocking): What is the authorization cache policy, and which caching layers does it cover?**

Section 12 states that "cached authorization results are not acceptable" and role changes must take effect immediately. This is stated as a constraint, not as a question — but it is not scoped to a specific layer. HTTP caching, ORM-level query caching, and application-level session caching are three different mechanisms, each of which could independently violate the constraint. The implementation team may affirm "no caching" at one layer while unknowingly violating it at another.

The proposal must specify which caching mechanisms are excluded by name. An acceptance criterion that says "authorization checks are not cached" is only testable if it names the layers. Owner: engineering lead, who can enumerate the relevant layers for the implementation stack in use.

**Q8 (Implementation decision before build): What is the error response format for access denial?**

Section 15 says "the user must see an error that tells them they do not have access to that team" and "must not silently serve empty results." Both constraints are correct but unspecified. For the API: does a 403 response include a structured error body, and if so, what fields? For the UI: is the denial a toast notification, a full-page error state, a redirect? Section 11 defines error states specific to live facilitation contexts; those are distinct from the general denial error format. A developer building the frontend cannot implement "the user must see an error" without knowing the error presentation shape. Owner: BA (Marcus) for API contract, frontend engineer for UI treatment.

---

## 14. How This Fits With the Adjacent Use Cases

**Sign In:** The authentication foundation. This use case does not function without a valid authenticated session. The access control checks in this use case must be applied only after authentication is confirmed. This is already the pattern established in the architecture (NFR-AUTH-003: "on every protected request"). The dependency is clear and implementation is mature from the Sign In change.

**First Access:** Establishes `users.global_role`. The dual-check pattern in the session participation spec depends on `users.global_role` being correct. This change inherits that dependency. If First Access incorrectly assigns `global_role = 'engineer'` to someone who should be `global_role = 'engineering_manager'`, the EM cannot access team content through the global_role check path. But they can still be denied the correct EM read access even if they have the correct `team_memberships` row. The two-field check provides the redundancy. Both must be correct.

**Join a Team:** Creates the `team_memberships` row with `role = 'participant'`. The team-membership authorization check in this use case queries for exactly this row. No edge cases from Join a Team that I can see — a user who followed a join link and was admitted has the row; a user who didn't doesn't.

**Assign a Role:** Changed the `team_memberships.role` field for existing members. The session participation spec established that role changes take effect on the next request and that the dual-check must read from the database, not a cache. This change must maintain that requirement: cached authorization results are not acceptable. The role change → access change effect must be immediate, not deferred to the next login or session refresh.

**Establish Manager/Team Relationship:** This is the most tightly coupled adjacent change. The access control check for "Is this user the Engineering Manager associated with this team?" answers to the `team_memberships` row created by TEAM-006. The manager-team-association spec explicitly documented this dependency: "The access control check for the question 'Is this user the Engineering Manager associated with this team?' is answered exclusively by the `team_memberships` row written by TEAM-006."

That spec also established the dual-check SQL pattern — which must be the same pattern used in this change for all EM content authorization. If this change implements a different authorization query for EM access, there will be inconsistency between what TEAM-006 intends to grant and what the content endpoints actually check.

---

## 15. What Must Not Come Out of This Change

**No single "isAuthorized" boolean that hides the role-specific data filtering.** The authorization check tells you whether the user can access a team's content. But it cannot tell you what shape that content should have for their role. If the proposal produces an authorization helper that returns `true/false` and then passes that through to a single content serializer, the EM's aggregate-only view requirement will be lost. The data filtering is part of the access control, not separate from it. The authorization check and the content serialization strategy must be considered together.

This concern extends to the facilitator view as well. An authorization check that correctly grants the facilitator access to "live session data" does not automatically restrict what shape that data takes. The serializer must know whether the topic has been revealed before deciding what to include. A single `isAuthorized = true` on the facilitator's connection that then passes through to a generic session data serializer will incorrectly include vote values in the pre-reveal response. The proposal must require that the serializer implements the pre-reveal / post-reveal distinction independently of the authorization check.

**No permanent facilitator access.** Any implementation that grants a facilitator access to a team's content based only on `global_role = 'facilitator'` and team membership is wrong. ADR-007 is explicit. I have already stated this and I am repeating it because it is the kind of simplification that looks obviously wrong in a spec but can easily be implemented as a convenience during feature build.

**No bypass path for Application Admins to session content without accountability.** Under Option B (my recommendation), Application Admins do not have session content access. Under Option A, any admin access to session content must be audited. Either way, admin access to team administrative data must be logged (see Section 5). Unaudited access to team data by any privileged role is a risk I will flag to Rachel.

**No silent degradation of denial responses.** A denial must be explicit. The user must see an error that tells them they do not have access to that team. The error must not leak the existence or content of the denied resource. But it also must not silently serve empty results — that is worse than a 403 because it creates a false signal about data availability.

The four constraints above are testable. The proposal must translate each of them into an acceptance criterion with the same specificity applied to the authorization path checks in Sections 4 and 9. Treating Section 15 as background context rather than as the source of acceptance criteria will cause these constraints to be lost in implementation.

---

## 16. Summary Assessment

This use case is the floor of the access control model. Every feature that comes after it — session setup, live voting, trend dashboard, action item management — depends on this layer holding.

The risk I am most concerned about is scope inflation disguised as thoroughness. A team building this change could reasonably interpret it as "implement authorization middleware for all content endpoints" and spend a cycle refactoring existing endpoints, documenting the model, and building new infrastructure. That would be appropriate and valuable. Or they could interpret it more narrowly as "verify and test that the specific endpoints built in prior changes correctly enforce the authorization rules that were already specified." Both are legitimate readings of the use case.

Q1 (scope of deliverable) is the question that must be resolved first. The answer shapes everything else about what the proposal looks like and how long the change takes. The open questions in Section 13 are ordered accordingly.

The ritual integrity questions that I am most concerned about:
1. The EM content access matrix — is the vote attribution boundary enforced in every endpoint that serves data to an EM? The definition of "aggregate vote distributions" is now stated in Section 4. The proposal must carry it.
2. The facilitator scoping — is ADR-007's context-scoped model enforced at the implementation level, not just stated in the architecture document? The pre-session and post-session boundary decisions in Section 10 are prerequisites to writing the SQL check correctly.
3. The facilitator pre-reveal constraint — is it enforced at the serializer, not only at the authorization layer? These are different enforcement points and must be named separately in the proposal.
4. The WebSocket gap — are live session events also subject to delivery-time authorization checks? The events are now named. The proposal must map each one to its check.
5. The Application Admin question — is there a clear decision, with a named risk owner, about whether admins get session content access? My position is Option B. That must become a confirmed decision before the proposal is written.

None of these are implementation preferences. They are the difference between an access control model that works and one that appears to work until someone finds the gap.

I will be available to confirm the authorization matrix before design begins, the same way I confirmed the vote attribution boundary for the manager-team-association change. This should not be treated as a documentation task that the BA can close independently. The ritual intent must drive the content access decisions, and that is the area where the team should consult me.
