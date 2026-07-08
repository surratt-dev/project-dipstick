# BA Review: Enforce Access Control on Team Content
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-07-07
**Artifacts reviewed:** proposal.md, design.md, tasks.md
**Reference documents:** requirements/use cases/01 - Identity and Access - Use Cases.md, requirements/BRD.md

---

## Overall Assessment

The design is technically precise and the tasks are well-decomposed. The decisions section is the most rigorously written part of the package — the rationale for each decision is clear and the alternatives are documented. My concerns are at the boundaries: where the proposal diverges from the documented use case without explicitly flagging the divergence, where capabilities are named but not specified precisely enough to build acceptance tests from, and where a few specific claims are not testable as stated.

None of these are blocking on their own. Several need to be resolved before the acceptance criteria for this change can be finalized.

---

## 1. Conflicts with the Documented Use Case

The use case "Enforce Access Control on Team Content" (UC-01, section 5) is the requirements baseline this change is implementing. The proposal introduces at least two behaviors that directly contradict the use case as written. These are not small gaps — they require either amending the use case before implementation begins or documenting an explicit, reviewed exception.

### 1.1 Facilitator grace window contradicts the use case Notes section

The use case Notes state: "Access does not persist after the session ends."

The proposal introduces a 30-minute post-session grace window via `facilitator_access_expires_at`. This is a direct contradiction. The design's Decision 4 has a sensible rationale — facilitators are often still in the room after close, capturing action items and responding to questions — and I think the grace window is the right call. But the use case, as currently written, explicitly prohibits it.

This is not a detail the proposal can absorb silently. The use case must be amended to acknowledge that facilitator access extends to `completed_at + 30 minutes` before the task list is started. Until that amendment is in place, the use case and the implementation are in conflict.

**Required action:** Amend the use case Notes section to replace "Access does not persist after the session ends" with language that reflects the grace window and its bound. The amendment must be explicit, not implicit in the implementation.

### 1.2 `draft` session status is not reflected anywhere in the use case

The use case Alternate Flows state: "A facilitator's access to a team's content is scoped to sessions they are actively facilitating."

A `draft` session is not a session in active facilitation. It is a preparation artifact that doesn't involve participants and has not reached the lobby state. Under the proposed access model, creating a `draft` session is sufficient to unlock read-only historical access. This is a reasonable workflow improvement, but "sessions they are actively facilitating" does not describe it and could be read to exclude it.

Additionally, OR-6.3 states: "The facilitator briefing view must be accessible without starting or creating a new session." Creating a `draft` session is still creating a session. If `draft` is descoped (per the fallback in Decision 3), facilitators must create a `lobby`-state session to access historical data — which directly violates OR-6.3. The proposal acknowledges this fallback but does not name the OR-6.3 conflict.

**Required action:** Either amend the use case alternate flow to reflect that `draft` sessions are a valid access path, or surface the OR-6.3 conflict as an open issue requiring resolution. If the fallback is invoked and `draft` is removed, OR-6.3 cannot be satisfied. That decision must be made explicitly, not left as a known limitation buried in the risk section.

### 1.3 Application Admin access path is absent from the use case Main Flow

The use case Main Flow step 2 enumerates three authorization paths: team member, associated EM, active session facilitator. Application Admin is not listed. The proposal correctly implements Option B (admins blocked from session content), which is consistent with BRD Constraint 1. But the use case is incomplete: it does not state what happens when an Application Admin makes a request. A reader of the use case cannot determine from it what the expected behavior is.

This is less urgent than items 1.1 and 1.2 because the proposal's behavior is consistent with the BRD. But the use case needs an Alternate Flow entry: "User is an Application Admin: The application evaluates the admin's request against the administrative data boundary. Session content (votes, scores, trend data, action items, live session state) is denied (403). Administrative data (membership lists, role assignments, EM associations, topic configuration metadata) is served."

### 1.4 Use case Main Flow lists Facilitator as a team membership role — this is incorrect

The use case Main Flow step 2 asks: "Is the user a member of the team (Engineer, Facilitator, or Engineering Manager role on this team)?" This is inconsistent with the data model. Facilitators are not team members — they access teams through `sessions.facilitator_id`, not through a `team_memberships` row. The proposal correctly models this as a separate authorization path, but it doesn't flag that the use case contains a factual error about the data model.

This is a pre-existing error in the use case, not introduced by this proposal. But because this proposal is the one that formalizes the three authorization paths, it is the right moment to correct it. The use case's step 2 should distinguish the three paths clearly rather than collapsing all three into "team member."

---

## 2. Capabilities with Ambiguous or Non-Testable Acceptance Criteria

The proposal names three capabilities. Two of them have acceptance criteria that are either ambiguous, bundled too broadly, or contain non-testable language.

### 2.1 `team-content-access` bundles too many distinct behaviors

The capability description says it covers "the three authorization paths, the content type access matrix (with role-specific response shapes), Application Admin boundaries, consistent 403/404 behavior, and the no-caching constraint." That is five distinct behaviors in one capability name.

The problem is that "covers" is not an acceptance criterion. A capability spec should answer: what does this capability do, and how do I know it's done correctly? As written, I cannot write acceptance tests for `team-content-access` because I don't know:

- What the content type access matrix looks like for each role on each content type. The matrix is implied by tasks 6.2 through 6.4 but is not stated in the capability. "Distinct response shapes for Engineer, EM, Facilitator, and Application Admin roles" is a description of intent, not a testable condition.
- What "no-caching constraint" means in a testable form. Decision 6 is precise (three layers, specific prohibitions). The capability should reference those conditions, not just say the constraint is "scoped to HTTP, ORM, and application-session layers."
- Which endpoints are in scope. The proposal's Impact section lists them; the capability does not. An engineer reading only the capability list cannot determine which endpoints must be updated.

**Specific recommendation:** The content type access matrix belongs in the capability spec, not just in the serializer tasks. At minimum: "Engineer receives aggregate distribution plus their own individual vote. EM receives aggregate distribution only (no individual vote attribution or row-per-voter representation). Facilitator on revealed topics receives individual attribution. Facilitator on unrevealed topics receives readiness grid only." This is the testable form.

### 2.2 "Zero-latency revocation" in `websocket-session-authorization` is not testable

The capability description states "zero-latency revocation when a user's team membership is removed mid-connection."

Zero latency is not a testable condition. Decision 5 in the design is more precise and more honest: "No further events will be delivered after the membership change is committed to the database." That is testable. There is an observable event (membership change committed) and an observable outcome (no further events delivered). The alternative case (timer-based fallback) defines a bound of 60 seconds from the database commit.

The capability should state the testable criterion, not the aspirational one: "When `team_memberships.removed_at` is set for a connected subscriber, no content-access events for that team are delivered to that connection after the membership change is committed to the database." If the implementation uses the timer-based fallback, the maximum latency bound must be stated in the capability.

"Zero-latency" also creates a potential problem downstream: if a test is written to verify "zero-latency revocation" and the implementation uses the timer fallback, the test will fail a specification that was never intended to be absolute.

### 2.3 Modified capability `session-participation` has no acceptance criterion

The modified capability says the dual-check pattern "is used by the new authorization helper for all content access checks, not only at session join time." This is a design constraint, not an acceptance criterion. How do I test this?

A testable form would be: "An HTTP request for team content from a user whose `users.global_role` and `team_memberships.role` have diverged (e.g., `global_role = 'engineer'` and `team_memberships.role = 'engineering_manager'`) is served the EM response shape, not the Engineer response shape." Or: "A change to `team_memberships.role` that is not reflected in `users.global_role` takes effect on the next content request without re-authentication." Task 10.7 covers this, but it's in tasks, not in the capability spec.

---

## 3. Capability Missing from the Proposal

### 3.1 Facilitator error states have no capability

The proposal's "What Changes" section lists as a new item: "Named facilitator-facing error states for live session contexts (authorization failure during reveal, historical data unavailable, session status transition, cross-team denial), distinct from general 403/404 handling."

This maps to all of Task 9 (nine subtasks). But the Capabilities section does not include a capability for it. There is no `facilitator-live-session-error-states` capability, no `session-facilitation-error-handling` capability, nothing. Task 9 is orphaned from the capability model.

This matters because capabilities are the unit by which this change is described in the system's capability graph. If there is no capability for the facilitator error states, there is no way to trace a future regression in that behavior back to this change. It also means there is no spec-level contract for what the four error states must produce — only task-level implementation instructions.

**Required action:** Add a capability for the four named facilitator error states. The capability description should state: the four error conditions, the required message for each, and whether each is a recoverable or non-recoverable state. The cross-team denial case (Error State 4) is particularly important to specify at the capability level because it has a privacy requirement: the response must not confirm Team A's existence or name it.

---

## 4. Claims Without Testable Conditions Attached

### 4.1 "no cache, no client-supplied claims" in What Changes

This is accurate but not testable as stated. The design (Decision 6) provides the testable form. The proposal's What Changes list should reference the three specific prohibitions: HTTP response cache, ORM/query cache, application-session cache. As written, it reads as a design intention rather than a verifiable requirement.

### 4.2 Consistent 403/404 behavior — "same response code and body"

The capability for `team-content-access` says consistent 403/404 behavior is included. Decision 7 says: "The response body for unauthorized requests does not include the team ID, session ID, or any identifier that confirms the resource exists." This is the testable form. The capability description should state it explicitly, not leave it to the reader to find it in the design decisions.

### 4.3 Application Admin audit logging — scope not stated at the capability level

Decision 2 specifies what must be logged for Application Admin access: reads and writes of administrative data, with the same fields as the TEAM-006 audit log. This is not stated at the capability level. The capability says admin access is "audited" but does not enumerate which events trigger a write or what fields are required. A developer implementing admin audit logging without reading Decision 2 would not know what to build.

---

## 5. Traceability Summary

| Capability / What Changes Item | Tasks that implement it | Notes |
|---|---|---|
| `team-content-access` — authorization helper | Task 2 | Covered |
| `team-content-access` — access matrix / serializer | Task 6 | Covered |
| `team-content-access` — Admin boundary | Task 3 | Covered |
| `team-content-access` — 403/404 consistency | Task 5 | Covered |
| `team-content-access` — cache prohibition | Task 4.7 | Partially covered (HTTP only; ORM and session-layer prohibition not explicitly tasked) |
| `websocket-session-authorization` | Task 8 | Covered |
| `session-participation` (modified) | Task 2.3 | Partially covered; no task explicitly requires testing the dual-check as a system-wide rule |
| Draft session + grace window | Task 7 | Covered |
| Facilitator error states (named in What Changes) | Task 9 | No capability in proposal; Task 9 is orphaned |
| `facilitator_access_expires_at` column | Tasks 1.2, 7.7, 7.8, 7.9 | Covered |

**Gap:** Task 4 covers integrating the authorization helper into HTTP endpoints. Task 4.7 requires `Cache-Control: no-store` (HTTP layer). But Decision 6 also prohibits ORM-level query cache and application-session cache. There is no task that requires verifying these two additional cache layers. Task 10.6 tests the behavioral outcome (role change takes effect without re-authentication) but does not explicitly verify at the ORM or session cache level. This is a coverage gap.

---

## 6. Items That Are Correctly Specified

To be direct about what is working well:

- Decision 5's WebSocket authorization table is exactly the form acceptance criteria should take: event name, subscriber requirement, testable SQL check. If every capability in the proposal were this precise, there would be nothing to flag.
- The facilitator SQL check in Decision 3 is precise and directly testable. The grace window boundary condition (at expiry and just before) is called out explicitly in Task 2.7.
- The grant type definition in Decision 8 is a good spec: it makes the serializer/authorization coupling explicit and creates a compile-time enforcement mechanism. Task 6.7 correctly requires verifying this.
- The 403/404 behavior's timing oracle concern (Decision 7) is appropriately scoped as a known limitation to evaluate, not a blocking requirement.
- The migration plan in the design is sound. Backward-compatible schema migration, authorization helper built and tested in isolation before endpoint integration — this is the right order.

---

## 7. Required Actions Before Implementation Begins

The following items must be resolved before tasks are started. They are not requests for more documentation — they are gaps that will produce ambiguous acceptance criteria or implementation decisions made without requirements backing.

1. **Amend the use case "Enforce Access Control on Team Content"** to reflect: (a) the 30-minute facilitator grace window, replacing the current Notes statement that access does not persist after session ends; (b) the `draft` session as a valid access path for facilitator preparation; (c) an Alternate Flow entry for Application Admin requests; (d) correction of Main Flow step 2's incorrect listing of Facilitator as a team membership role.

2. **Add a capability for the facilitator error states** (currently covered only by Task 9). Define the four named states, their required messages, and the privacy constraint on Error State 4.

3. **Replace "zero-latency revocation" in the websocket-session-authorization capability description** with the testable criterion from Decision 5. If the implementation uses the timer-based fallback, the maximum latency bound must be named in the capability.

4. **Add the content type access matrix to the `team-content-access` capability.** The matrix defines what each role sees for each content type. It exists implicitly in the tasks but must be at the capability level to serve as a verifiable specification.

5. **Add a task covering ORM-level and application-session cache prohibition.** Task 4.7 covers HTTP-level Cache-Control headers. Decision 6 requires two additional cache layers to be prohibited. There is no task that requires verifying those layers. Task 10.6 tests the behavioral outcome but not the mechanism.

6. **Resolve the OR-6.3 conflict explicitly.** If `draft` sessions are in scope, the conflict is partially mitigated (creating a draft is not the same as starting a session). If `draft` is descoped, OR-6.3 cannot be satisfied, and that must be documented as an explicit trade-off with a named owner, not buried in the design risk register.

---

*This review reflects requirements and business analysis input only. Technical feasibility, implementation sequence, and security control adequacy are in scope for other reviewers on this change.*
