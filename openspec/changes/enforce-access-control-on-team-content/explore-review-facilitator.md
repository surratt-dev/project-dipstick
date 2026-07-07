# Explore Review: Enforce Access Control on Team Content
**Reviewer:** Priya Nair, Facilitator (Subject Matter Expert)
**Exploration Author:** Devon Calloway
**Date:** 2026-07-07

---

## How I'm Reading This

Devon's notes are meticulous about the authorization model being technically correct. The dual-check pattern, the SQL queries, the WebSocket gap, the EM vote attribution boundary — all of it reflects a careful reading of the requirements. From a system integrity standpoint, I think the right concerns are on the table.

What I don't see in these notes is what it feels like to be the person running a session under this model. Devon is reasoning about correctness. I need to reason about experience. My review covers what I expect to encounter as a facilitator — and where I expect the model as described to create friction at the exact moments when I can least afford it.

---

## Observations

### 1. The pre-session preparation window is missing from the model

The access check for a facilitator is scoped to a session with status in `('lobby', 'pre_session', 'active', 'wrap_up')`. That means I need to have already created a session in order to see the team's historical data.

In practice, I prepare before I create the session. I review the last three sessions' trends, look at which action items are still open, and check whether the outlier pattern from the previous session repeated itself. I do all of that to decide how I want to frame this session — which topic to start with, whether there's something I want to address directly before the vote. If historical data is only available after I've started a session, the model forces me to create the session as a prerequisite to preparation. That reverses the natural workflow.

This is not a minor friction point. Preparation time is qualitatively different from session time. I am not "in facilitation mode" yet when I'm preparing. I may be doing it at my desk the day before, not in the room with the team. The access model should either recognize a "preparing" state or allow a short read-only historical access window that is not coupled to an active session.

### 2. The post-session access cliff is abrupt and will cause real problems

Devon's notes (Section 9 and Q5) acknowledge that access ends when the session closes. That's stated as the correct behavior. ADR-007 confirms it. But nobody has thought through what I'm doing in the ten minutes after a session.

After the reveal, the room is discussing. An action item gets added. I'm watching the trend line for this topic, comparing it to last quarter. I may be mid-thought when the session wraps up and I close it. The moment I close the session, historical access ends. If I'm mid-comparison — looking at this session's result alongside the trend data — I've just lost context.

More importantly: I may realize during wrap-up that I want to refer back to a previous session's action item. If I close the session to mark it complete before I've finished that reference, I've locked myself out. The system is punishing me for the act of completing the session.

The proposal should either define a short post-session grace window (15-30 minutes, clearly bounded) during which the facilitator retains read-only access to the team's history, or it should establish that closing a session does not immediately revoke access — perhaps the facilitator's session row transitions through a `closing` state that retains access for a defined period.

Q5 in Devon's notes frames this as a clarification question. I'm framing it as a design prerequisite. The behavior at session close is not a detail — it's a moment the facilitator will encounter every single session.

### 3. Error handling during live sessions is completely unaddressed

Devon's notes identify what should be denied and how denial should be structured (consistent 403/404 behavior, no existence disclosure, no silent degradation). None of that addresses what a facilitator sees when something goes wrong during a live session.

If an access control check fails — perhaps because the session status transitioned unexpectedly, or because of a server-side issue — what does the facilitator's view show? An error modal? A blank panel? A stale view from before the failure?

I am in a room with eight engineers. The vote has just happened. I need to see the results. If the screen goes blank, or if I get an error message that makes no sense to a non-technical facilitator, the session has just derailed in the worst possible way. The reveal moment is exactly when the psychological stakes are highest. That is not the moment for an opaque error state.

The exploration notes say "a denial must be explicit" and "must not silently serve empty results." Both of those are stated from a security and correctness standpoint. Neither addresses the UX of that denial in a live facilitation context. The proposal must specify what error states look like from the facilitator's view and — critically — which errors are recoverable without ending the session.

### 4. The facilitator-scoped access creates a bootstrapping dependency

To see a team's history, I must have an active session. To create a session intelligently, I need to see the team's history. This is a circular dependency that the access model does not resolve.

In the physical version of the ritual, I bring my notes from last time. In the application, my "notes" are the historical data. If the application gates that data behind session creation, it is requiring me to open the room before I've reviewed what happened last time.

This concern compounds for teams I haven't facilitated recently. When I'm returning to a team after a gap — or when a facilitator is picking up a team they've never run before — the history is exactly what they need before the session opens. Blocking it until a session is active makes the handoff value Devon described (see exploration notes Section 9) much harder to realize.

### 5. Session status transitions create access windows that are too narrow

The access check includes `('lobby', 'pre_session', 'active', 'wrap_up')`. That covers the session arc, which is right. But the transitions between these states are places where things go wrong.

What happens if:
- I accidentally advance from `wrap_up` to a terminal state (`completed`) instead of a transitional state?
- The session status transitions automatically due to a timeout or system event while I'm mid-flow?
- A connection drop happens and the session status becomes ambiguous while I'm reconnecting?

In any of these cases, historical access would be revoked mid-session. The facilitator is not thinking about session state transitions — they're thinking about the room. Any mechanism that can silently change session state should be examined for its effect on facilitator access.

The exploration notes (Section 6.4) address re-authorization during long-lived WebSocket connections for role changes. The same thinking should apply to session state changes: if a session state transition affects a facilitator's authorization, how and when is that reflected in the facilitator's active view?

### 6. Multi-team facilitators will navigate this access model constantly

I facilitate for three teams on a rotating schedule. Under the model as described, my access to each team's historical data is gated by whether I have an active session for that team.

If I'm facilitating Team B right now, I have access to Team B's history. If a question comes up that would be informed by something I remember from Team A's pattern — not to reveal Team A's data, just to calibrate my facilitation judgment — I have no access to Team A. That's correct. That's the containment model working as intended.

What I want the proposal to acknowledge is that multi-team facilitators will be navigating this constantly. The access model is correct, but the UX of that model needs to make it clear which team's context I'm currently operating in and not create confusion about why I can't see history I know exists. The error state (denied access to Team A's history while facilitating Team B) should be informative, not opaque.

### 7. The exploration notes treat facilitator access as a permission expansion, not a different view architecture

Devon's framework identifies facilitators as one of three authorization paths and describes what they're allowed to see. What's missing is the point from Priya's concerns that the facilitator view needs to be a different UX architecture, not just participant view with extra data access.

The access control model as described grants the facilitator "full historical read access" during a session. But the facilitator's view of that data is fundamentally different from what any other role sees. They need at-a-glance trend comparison during reveal. They need session history formatted for preparation, not for retrospective review. They need outlier flags that are advisory, not prominent.

If the access control model is defined as "what data the facilitator can query" without also specifying what the facilitator's view of that data looks like, the implementation risk Devon flagged in Section 13 (a single `isAuthorized` boolean that hides role-specific data filtering) extends to the facilitator view too. The proposal should note that facilitator access to historical data is not just a permission grant — it's a different read path with a different presentation contract.

### 8. The content type matrix doesn't capture live session state from the facilitator's perspective

The draft matrix in Section 8 distinguishes between "live session data (votes pre-reveal)" and "live session data (post-reveal votes)" for each role. For the Facilitator column, both show "Facilitator view" — which is correct but unspecified.

What does "Facilitator view" mean for pre-reveal live session data? It should mean: readiness grid (who has locked in), not vote values. That is load-bearing for the ritual. The facilitator must never see vote values before the reveal, even though they have elevated access. The current matrix doesn't capture this distinction — it collapses "what the facilitator can access" into a single cell when the facilitator's pre-reveal and post-reveal views are fundamentally different.

This matters for implementation because the access control layer may correctly grant the facilitator access to live session data while the data serializer incorrectly includes vote values in that response. The proposal should make the pre-reveal / post-reveal distinction explicit in the facilitator's access profile.

---

## Questions

**Q-F1:** Is there a session state or mechanism that allows facilitator preparation before a session is in `lobby` status? If not, how should the workflow handle the need to review history before creating the session?

**Q-F2:** What does the facilitator see in their view when an access control check fails during a live session? Is there a recovery path that doesn't require ending the session?

**Q-F3:** Is there a post-session grace period for facilitator historical access? If so, how long, how is it bounded, and what triggers its end?

**Q-F4:** If the session status transitions unexpectedly during a live session (due to a server event, timeout, or error), does the facilitator's historical access break? What does the facilitator see?

**Q-F5:** The matrix shows "Facilitator view" for pre-reveal live session data. Is there an explicit constraint in the proposal that prevents the facilitator from seeing vote values before the reveal, even though they have elevated session access? Where is that constraint enforced — access layer, serializer, both?

**Q-F6:** For a returning facilitator or a new facilitator picking up a team, how do they access the team's history to prepare if they haven't yet created a session? Is the onboarding value of the session history (Devon's Section 9 continuity argument) realizable under this access model?

---

## Suggested Additions

**1. A "preparation window" design decision.**
The proposal should explicitly address whether facilitators need pre-session access to historical data and, if so, what the access mechanism is. Options: a read-only "preparation mode" that precedes session creation; allowing facilitators to create a session in a `draft` status that grants history access without opening the room; or accepting that facilitators must create a session to access history and documenting this as a known workflow constraint. The choice should be deliberate, not a side effect of the authorization model.

**2. A post-session access policy.**
Define whether the facilitator retains read-only access to session history after closing a session and for how long. This should be a named, bounded policy, not an undefined edge case. The proposal should specify the expected behavior and make it an acceptance criterion.

**3. Facilitator-facing error states for live sessions.**
The proposal should specify what the facilitator's view shows when access control fails or session state becomes invalid during a live session. Error states must not be disruptive in a way that derails the session. Recoverable errors should have a clear recovery path. The UX of denial is as important as the correctness of denial, and right now the exploration notes address only the latter.

**4. Pre-reveal / post-reveal distinction in the facilitator access profile.**
The content type matrix should separate "live session data (pre-reveal)" and "live session data (post-reveal)" for the Facilitator role and specify explicitly that pre-reveal access does not include vote values. This constraint should be enforced in the data serializer, not only in the authorization check, and the proposal should name both enforcement points.

**5. Multi-team facilitator UX acknowledgment.**
The proposal should acknowledge that facilitators operating across multiple teams will regularly encounter access scope transitions — accessing one team's data while in a session for another. The UX of this boundary (what the facilitator sees, how errors are presented) should be specified so the implementation doesn't produce confusing or opaque states for a common facilitator workflow.
