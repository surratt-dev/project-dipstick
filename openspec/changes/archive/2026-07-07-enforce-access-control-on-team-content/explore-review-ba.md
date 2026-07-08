# BA Review: Exploration Notes — Enforce Access Control on Team Content
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-07-07
**Source reviewed:** openspec/changes/enforce-access-control-on-team-content/exploration-notes.md

---

## Summary Assessment

Devon's notes are substantive. The ritual-integrity framing in Section 2 is exactly what a developer needs to understand why they cannot cut corners on this change. The SQL check patterns in Sections 3 and 9 are the right level of specificity for architecture-level decisions. The warning in Section 13 about a single `isAuthorized` boolean collapsing the role-specific data filtering is a sharp observation that should survive into the proposal.

That said, several areas read as precise but are not. They use defined-sounding terms — "aggregate vote distributions," "meaningful intervals," "appropriate to their role" — without supplying the definitions. A developer who receives a proposal built on those phrases will implement the phrase, not the intent. The list below is where I need sharper language before a proposal can be written.

---

## 1. Open Questions: Ranking Problem and Two Missing Questions

**The ranking problem.** Devon numbers Q1 through Q6, with Q6 (scope of deliverable: new infrastructure vs. audit of prior changes) labeled "Scope question" at the end. But Section 14 explicitly says "the scope question is the one that should be resolved first." A proposal author reading Q1 through Q6 in order will address the Application Admin decision before knowing what the change is supposed to build. That inverts the logical dependency. The questions should be renumbered with scope first.

Recommended reranking:

| Priority | Question | Devon's label | My assessment |
|---|---|---|---|
| 1 (Blocking) | What is this change's deliverable scope? | Q6 | Blocking — everything else depends on scope |
| 2 (Blocking) | What is the Application Admin access profile for session content? | Q1 | Blocking |
| 3 (Design prerequisite) | Confirm the content type access matrix | Q2 | Design prerequisite |
| 4 (Design prerequisite) | Facilitator access after session close | Q5 | Design prerequisite, not just "clarification needed" — see below |
| 5 (Design prerequisite) | WebSocket authorization scope | Q3 | Design prerequisite |
| 6 (Implementation decision before build, not during) | Consistent 403/404 behavior | Q4 | Must be decided before implementation begins |

**Q5 is understated.** Devon labels it "Clarification needed." It is not a clarification — it is a design prerequisite. Whether a facilitator retains any post-session access determines whether the SQL check for Path 3 includes a terminal status value or excludes all non-active statuses. That is an endpoint behavior decision that must be made before the proposal can define an acceptance criterion. Renaming it "Design prerequisite" and promoting it accordingly.

**Two missing questions that would block a proposal:**

Q-missing-A: **What is the authorization cache policy?** Section 12 states that "cached authorization results are not acceptable" and role changes must take effect immediately. This is stated as a constraint, not as an open question. But "not cached" means three different things depending on implementation layer: no HTTP response cache headers on content endpoints, no ORM-level query cache on authorization checks, no application-level session cache of resolved permissions. If the implementation team adds HTTP caching middleware to content endpoints and the authorization check is baked into the response, they have violated the constraint without realizing it. This needs to be a named question with a named owner — not an assertion that is easy to affirm and easy to miss.

Q-missing-B: **What is the error response format for access denial?** Section 13 says "the user must see an error that tells them they do not have access to that team" and "must not silently serve empty results." Both constraints are correct. Neither is specified. For the API: does a 403 response include a structured error body (and if so, what fields)? For the UI: is the denial a toast notification, a full-page error state, a redirect to a landing page? A developer building the frontend cannot implement "the user must see an error" without knowing what the error presentation looks like. This is not an aesthetic question — the requirement that the error not leak existence information constrains the error message content.

---

## 2. Application Admin Gap: Framing Is Close But Not Proposal-Ready

Devon frames this well: two options, a stated position (Option B), a BRD citation to support it. That is the right structure. Three things are still missing before this becomes a proposal-ready decision.

**Problem 1: Option B is not operationally defined.**
"Application Admins have access to team administrative data but not session content" is a clear policy statement. It is not a clear endpoint specification. What does an Application Admin see when they call the team administration views? Devon's matrix in Section 8 shows "Yes (full)" for team membership lists and "TBD" for everything session-related — but does not define what "team administrative data" includes for endpoints that sit between those two categories. Topic configuration, for example. EM association records. Action item titles without vote context. The proposal cannot be written without knowing the affirmative scope of Option B, not just what it excludes.

Suggested addition to the Option B framing: add a sentence that enumerates the administrative endpoints an App Admin may access, so the TBD cells in the matrix can be filled with definitive answers rather than deferred.

**Problem 2: Audit logging scope is unanchored.**
Section 13 states: "If Application Admins are given access to session content, that access must be audited." This is the right instinct. But Option B (Devon's preferred option) doesn't grant session content access to Admins at all — so the audit logging statement only applies if we choose Option A. If Option B is chosen, what audit logging exists for Admin access to administrative data? The manager-team-association spec established audit logging for EM content access. Does that same log capture Admin access to membership records? If not, the proposal needs to include audit logging for the administrative access that Admins do have. That requirement is not stated anywhere.

**Problem 3: No acceptance criterion stub.**
For a decision this consequential — one that Devon correctly says involves Rachel Okonkwo and Tomás Ferreira — the exploration notes should carry at least a testable stub that the proposal can refine. The following is an example of what that looks like:

> "Given an authenticated user with `global_role = 'application_admin'` and no `team_memberships` row for Team A: a request to GET /teams/:id/sessions returns 403. The response body confirms access is denied but does not indicate whether Team A exists."

That one-sentence criterion is missing. Without it, the proposal author does not know what behavior to specify. The decision and the criterion must travel together.

---

## 3. The Three Authorization Paths: Specificity Assessment

### Path 1 (Team member) — insufficient in two places

Devon defines the membership row check correctly (`team_memberships.user_id = $current_user AND removed_at IS NULL`). The sub-case for `membership_role = 'participant'` says they "can see their team's session history, trends, and action items." That is not specific enough for implementation.

**First gap: individual vote attribution in completed session history.** The matrix in Section 8 shows "Yes (for completed sessions they participated in)" for Engineer access to individual vote attribution. Devon's Q2 says this needs to be confirmed before design begins. There is a contradiction between those two claims. The matrix should not carry a definitive cell value for something Q2 marks as unresolved. Either the matrix carries the question mark or Q2 removes it from the list — not both.

The substantive question: after a session's votes are revealed, can an engineer on that team view the full vote distribution with individual attribution (which engineer voted what), or can they only see their own vote and the aggregate? This has implications for how the session history endpoint serializes data for the Engineer role. It must be answered before the proposal can define the endpoint's response contract.

**Second gap: "participant view" is undefined.** Section 4 uses this phrase without defining it. The session participation spec presumably defines what a participant sees during a live session. But "participant view of session history" (completed sessions) may be a different thing. Does a participant viewing historical data see the same data shape as during the session, just for a concluded vote? Or is the history view a different endpoint with a different response contract? This must be clear before any content access matrix is finalized.

### Path 2 (EM by explicit association) — "aggregate vote distributions" is undefined

The phrase "aggregate vote distributions" appears in Devon's notes, the prior specs, and the use case acceptance criteria. It is used as if it carries a shared definition. I do not have that definition in any document I can point to.

Does "aggregate vote distributions" mean:
- A histogram of how many engineers voted in each range (e.g., "3 engineers voted 3, 2 engineers voted 4")?
- Only summary statistics — team average, standard deviation, outlier count?
- The same data a participant would see during the reveal, minus the individual name-to-vote mapping?

These produce different data shapes and different endpoint implementations. Before the proposal for this change is written, the manager-team-association spec must explicitly define this phrase, or this change's proposal must define it. Either location is acceptable. Both being vague is not.

I will note the correct precedent here: the manager-team-association spec documented the vote attribution boundary ("EM-facing endpoints must never return individual vote attribution"). The *complement* of that — what EMs do see — is not equivalently defined. That is the gap.

### Path 3 (Facilitator of active session) — strongest, two gaps remain

The SQL check is given (Section 9, repeated in Section 3). The access-revocation behavior is described. This is the closest of the three paths to proposal-ready. Two things need to be added.

**First gap: the `lobby` status and pre-session data access.** The SQL check includes `sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')`. This means a facilitator assigned to a session that has not yet started (status = `lobby`) can already access the team's full historical data. Devon does not confirm or deny this as intentional. It is probably intentional — a facilitator needs context before the session begins, not only after it starts. But it should be stated explicitly, because the alternative interpretation (historical access begins only when the session moves to `pre_session` or `active`) is a legitimate design choice that produces a different SQL check. The proposal must state which is correct.

**Second gap: "session close revokes access" needs an acceptance criterion, not just prose.** Section 9 describes this behavior correctly in prose: when the session transitions to a terminal status, the facilitator loses historical data access. This must become a testable acceptance criterion in the proposal. Example:

> "Given a facilitator with an active session for Team A in 'wrap_up' status: when the session transitions to 'completed', a subsequent HTTP request from that facilitator to GET /teams/:id/sessions returns 403."

Devon has the right analysis. The proposal must carry it forward as a criterion, not an explanation.

---

## 4. WebSocket Authorization: Not Concrete Enough to Become an Acceptance Criterion

This is the most under-specified area. Devon correctly identifies the gap and cites OAQ-005 and SEC-25. The concern is legitimate. But the current framing gives a developer nothing concrete to implement or test.

The statement "every WebSocket subscription to a session or a team's event stream must be authorized the same way the corresponding HTTP endpoint is authorized" is a principle, not a requirement. It cannot be tested without specifying what WebSocket events exist and which check applies to each.

**What is missing:**

**1. A list of the WebSocket events in scope for content access enforcement.**
Devon mentions "reveal trigger, session close, topic advance" (from OAQ-005) — those are privileged action events, not content access events. The events in scope for this use case are different: subscription to live vote readiness updates, subscription to team event streams for live session updates. Without a list of events, the proposal cannot specify what must be checked. The implementation team will be left to infer what "every WebSocket event" means, and different engineers will draw the line differently.

**2. When does the authorization check occur?**
Devon says WebSocket events must be checked "the same way" as HTTP endpoints. HTTP checks happen at request time. For WebSockets there are three distinct points where a check could occur: at connection handshake, at subscription time, and at event delivery time. These are not equivalent. Connection-time checks mean a subscriber who loses team membership mid-connection continues to receive events until they reconnect. Delivery-time checks mean every pushed event carries an authorization check — which is the only option that satisfies the re-validation concern in Section 6.

The phrase "meaningful intervals" (from SEC-25, cited in Devon's notes) does not resolve this. "Meaningful intervals" is not testable. The proposal must specify: (a) whether checks happen at delivery time or on a polling interval, and (b) what the maximum latency is between a membership revocation and the subscriber no longer receiving events. Example:

> "When a user's team_memberships row has removed_at set while the user is connected via WebSocket to that team's session event stream: the server must stop delivering events to that connection and close the channel within 30 seconds of the membership change being committed."

The `30 seconds` is a placeholder. The proposal must replace it with a deliberate number. But the structure — specific event, specific trigger, specific behavior, specific bound — is what an acceptance criterion requires.

**3. The re-validation mechanism must be named.**
Devon correctly states the concern (Section 6, item 4). The notes do not specify what mechanism produces re-validation. Options include: periodic re-check on a timer, re-check on every delivered event, re-check triggered by a membership-change event from the database. The security analyst must name an approach before the proposal is written. "The authorization model must have a mechanism for this" (Devon's language) is analysis, not a requirement.

**Suggested path forward:** Require the proposal to include a table mapping each WebSocket event type to its authorization check and the timing of that check. If the implementation team cannot produce that table during proposal design, the WebSocket enforcement should be scoped as a separate change and explicitly excluded from this one. Half-specified WebSocket requirements produce half-secured connections.

---

## 5. Additional Vague Areas That Would Block Implementation

**The content type matrix (Section 8) has cells that should not be answered yet.**
The matrix shows "Yes (for completed sessions they participated in)" for Engineer access to individual vote attribution. As noted above, Devon's Q2 says this is unconfirmed. A matrix with a mix of confirmed and unconfirmed cells, with no visual distinction between them, will be read as fully confirmed. Mark unconfirmed cells explicitly — a question mark or an italicized "needs confirmation" notation — so the proposal author knows which cells are settled decisions and which are working drafts.

**"No caching" needs a defined constraint scope.**
Sections 6 and 12 both state that cached authorization results are not acceptable. This is a requirement, not a preference. But it is not scoped to a specific layer. HTTP caching, ORM-level query caching, and application-level session caching are three different mechanisms, each of which could violate the constraint independently. The acceptance criterion must specify which caching mechanisms are excluded, not just that caching is excluded.

**Section 13 is analysis masquerading as requirements.**
"What Must Not Come Out of This Change" contains four real constraints:
- No single `isAuthorized` boolean that bypasses role-specific data filtering
- No permanent facilitator access based on `global_role` alone
- No unaudited admin access to session content
- No silent denial responses

Each of these is testable. None of them is an acceptance criterion in the current framing. They will be lost if the proposal author treats Section 13 as background context rather than as the source of acceptance criteria. I am flagging this explicitly: these four items must be translated into acceptance criteria in the proposal, with the same specificity applied to the authorization path checks in Sections 4 and 9.

---

## 6. What Is Ready for a Proposal (If Scope Is Resolved First)

Once Q6 (scope) is answered, the following elements are proposal-ready with minor additions:

- The dual-check SQL pattern for team membership (Section 3) — ready, but must be explicitly cited as a required implementation pattern, not a reference example.
- The EM vote attribution boundary (no individual attribution, aggregate only) — ready, once "aggregate vote distributions" is defined.
- The facilitator SQL check pattern (Section 9) — ready, but needs the acceptance criterion for post-session revocation.
- The information disclosure requirement (Section 7) — ready. Devon correctly references the TEAM-006 precedent (Decision 4) and correctly states it must apply uniformly. This can carry directly into the proposal as a system-wide constraint, not a per-endpoint decision.
- The no-manager-in-sessions rule (Section 10) — ready. The constraint is clear and the enforcement mechanism is described.

---

## Summary of Items That Must Be Resolved Before a Proposal Is Written

| Item | Section | What's needed |
|---|---|---|
| Reorder open questions with Q6 (scope) first | Section 11 | Renumbering only |
| Add cache policy as a named open question | New | Owner assignment and specific layer scoping |
| Add error response format as a named open question | New | UI and API contract both needed |
| Promote Q5 (facilitator post-session) to design prerequisite | Section 11 | Renaming only, but signals urgency correctly |
| Define "aggregate vote distributions" | Section 4, Section 8 | Precise data shape — either cite the source spec or define here |
| Resolve contradiction between matrix cell and Q2 for Engineer individual vote attribution | Section 8, Section 11 | Confirm or mark as unconfirmed in matrix |
| Define "participant view" of historical session data | Section 4 | Distinct from live session participant view? |
| Add App Admin acceptance criterion stub | Section 5 | One line, placeholder, refinable in proposal |
| Clarify facilitator access starting at `lobby` vs. `active` | Section 3 | One sentence, deliberate choice |
| Convert facilitator access revocation behavior to acceptance criterion | Section 9 | One testable criterion |
| Add list of WebSocket events in scope | Section 6 | Required for any acceptance criteria |
| Specify authorization check timing for WebSocket events | Section 6 | Connection, subscription, or delivery time |
| Specify re-validation mechanism and maximum latency bound | Section 6 | Replace "meaningful intervals" with a specific number |
| Convert Section 13 constraints to acceptance criteria | Section 13 | Four items, each testable |

I am available to confirm the access matrix before design begins, the same way I confirmed the vote attribution boundary for the manager-team-association change. The matrix review should happen after the scope question is answered and after "aggregate vote distributions" has a definition — otherwise we will be filling in cells against an undefined term and confirming nothing.
