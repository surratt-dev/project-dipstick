# BA Review: Exploration Notes — Join a Team via Invite Link
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Source:** explore-review-ba.md
**Date:** 2026-07-05

---

## Overall Assessment

The exploration is technically thorough and the problem identification is good. Devon has done real work here — the architecture trace in Section 4c, the audit of both join paths, and the ritual constraint analysis in 4a and 4b are exactly the kind of discovery that belongs in an exploration. The structural summary in Section 8 is the clearest part of the document and reflects a genuine understanding of what this change is for.

The issue is the gap between identifying a problem and stating a requirement. Several findings in this document name something real but leave the resolution underspecified to the point where an engineer reading it would not know what to build. Two of these are high-priority: the silent join failure and the role naming discrepancy. The others I flag below at lower priority but they still need resolution before a proposal can be written.

---

## Clarifications Needed

### 1. Silent Join Failure (Section 4c) — High Priority

**What the exploration says:** The through-auth path, when `executeJoinFlow` fails post-authentication, "should emit a user-visible error when the join token fails validation." The two proposed messages are given as alternatives separated by "or." The delivery mechanism is described as "preserved through the redirect, the same as the direct path produces."

**What is missing:**

The problem description is specific and correct. The solution description is not. Before this can become a requirement or a test, four things need answers:

**a. What is the error delivery mechanism?**

The exploration says the error should be "preserved through the redirect" but does not say how. The direct path (`GET /api/join/:token`) redirects to an error page. The through-auth path exits via `GET /auth/callback`, which issues a redirect to a frontend URL. These are not the same code path. How does an error originating in the callback handler reach the user's browser? Options include:

- A query parameter on the redirect URL (e.g., `?joinError=expired`) that the destination page reads and renders
- Routing the callback to the same error page that the direct path uses
- A session-stored flash message

The exploration does not choose. The proposal must choose. Without a specific mechanism, there is no way to write an acceptance scenario or a test.

**b. Which error message maps to which failure reason?**

The existing spec (openspec/specs/join-link/spec.md, "Join link validation" requirement) already defines specific messages:
- Expired or revoked token: "This link has expired. Ask your facilitator for a new one."
- Nonexistent token: "This link is not valid."

The through-auth path surfaces three failure modes: expired, revoked, and nonexistent. The exploration uses "or" between the two messages without mapping them to specific failure states. The proposal should use the same message logic the direct path already specifies, applied to the through-auth failure cases. This is not a decision — it is a consistency requirement. State it that way.

**c. Where does the user land after the error is shown?**

The exploration says the user lands on `/no-team` with no explanation. The fix should change this. But to what? Does the user land on an error page (and is that the same error page the direct path uses)? Does the user land on `/no-team` but with an error banner? The exploration does not say. This matters because the no-team page has a defined content constraint (Section 6 of the exploration: four elements only). If the error is shown there, that constraint is affected.

**d. What is the testable acceptance criterion?**

Section 5c describes the test cases that need to exist but frames them against the current behavior ("user routed to `/no-team`") with a note that they "should produce a user-visible error, not a silent fallback." The tests cannot be written until (a), (b), and (c) are resolved. The current test gap description in Section 5c is accurate about the missing coverage but is not a specification of what the correct behavior should be. The proposal needs to state the correct behavior first, then the tests follow.

**Suggested rewrite for the requirement:**

> When `executeJoinFlow` returns `{ redirectUrl: null }` in the auth callback (because the `pendingJoinToken` is expired, revoked, or not found), the callback handler SHALL redirect the user to [specific error page or URL with error parameter], displaying:
> - "This link has expired. Ask your facilitator for a new one." — when the token is expired or revoked
> - "This link is not valid." — when the token does not exist
>
> The user SHALL NOT be routed to `/no-team` when a join token was present in the OIDC state. A user who lands on the error page via the through-auth path SHALL see the same error content as a user who lands on it via the direct path.
>
> Scenario: Expired pendingJoinToken at callback time
> - WHEN an authenticated user completes the OIDC flow with a pendingJoinToken that has expired
> - THEN the user is redirected to [error destination] with message "This link has expired. Ask your facilitator for a new one."
> - AND the user is not added to any team
> - AND the user is not routed to /no-team

The bracketed placeholder needs a decision on (a) before it can be filled in.

---

### 2. Role Naming Discrepancy (Section 3) — High Priority

**What the exploration says:** The vocabulary gap between "Engineer" (use case language) and "participant" (schema language) "must be made explicit — in the proposal for this change, in any onboarding documentation, and in code comments at the insert site."

**What is missing:**

The exploration correctly identifies a real problem. The fix prescription is not actionable. Three delivery targets are named (proposal, onboarding documentation, code comments) but none of them are specified. This reads like a flag rather than a requirement. Before this goes into a proposal, the following need answers:

**a. What is the specific code change?**

"Code comments at the insert site" — which file, which function, and what should the comment say? The exploration identifies `packages/backend/src/routes/join-links.ts` and `packages/backend/src/routes/auth.ts` (via `executeJoinFlow`) as the two insert sites. A comment at each insert site should state the mapping explicitly. The proposal should specify what that comment says, not just that it should exist.

Example comment text (the proposal should adopt or revise this):
```
// The use case calls this role "Engineer." The team membership role enum uses
// "participant" to distinguish this from the global user role enum, which has
// a separate "engineer" value. These refer to the same person at different
// levels of the model. Do not change this to "engineer" — that value does
// not exist in the membership_role enum and will cause a database error.
```

**b. What constitutes "onboarding documentation"?**

The exploration does not identify a file. Is this the spec? A separate architecture note? A comment in the migration file? The proposal needs to name the artifact. If it is a comment in Migration 5 (`5_create_join_links.sql`), say that. If it is a new section in the spec, say where. "Onboarding documentation" is not a file path.

**c. Is this a code change or a documentation change or both?**

If it is both, both need to be in the proposal's task list as separate items. If it is only code comments (which I would prefer — they are durable and colocated with the thing they describe), say that. A requirement that spans three artifact types without specifying any of them is not a requirement — it is a concern.

**d. What is the acceptance condition?**

"A developer reading the code understands the mapping" is not testable. The acceptance condition should be specific about which files contain the clarifying text. A code review checklist item ("are the insert sites commented with the role mapping explanation?") is more testable than an intent statement.

**Suggested rewrite:**

Split this into two concrete tasks:

> Task: Add role mapping comment to team membership insert sites
> - In `packages/backend/src/routes/join-links.ts`, at the `INSERT INTO team_memberships` call, add an inline comment explaining that `role: 'participant'` corresponds to what the use case calls "Engineer," and that the membership_role enum is distinct from the global user_role enum.
> - In `packages/backend/src/routes/auth.ts`, at the `executeJoinFlow` call that results in membership insertion, add the same comment.
> - Acceptance: a reviewer reading either insert site sees a clear statement of the vocabulary mapping without needing to consult external documentation.

> Task: Add vocabulary mapping section to the join-link spec
> - In `openspec/specs/join-link/spec.md`, add a "Role vocabulary" section that states: "What the use cases call 'Engineer' is stored as `participant` in the `membership_role` enum. These are the same person at different model layers. The global `user_role` enum has a separate `engineer` value on the `users` table. These must not be conflated."
> - Acceptance: the spec contains an explicit statement of the mapping that future authors can reference.

---

## Vague Areas — Lower Priority But Need Resolution Before Proposal

### 3. EM Protection Deferred Constraint (Section 4a)

The exploration correctly defers enforcement to the session participation layer and explains why filtering at join time is wrong. This reasoning should be in the proposal as a "not in scope" rationale, not just asserted.

What is underspecified: the exploration says "This is a documented constraint on future work" without naming where it is documented. For this to be useful, it needs to land in a specific artifact — the session participation spec, a constraint section in this change's spec, or a separate architectural decision record. The proposal should name the artifact.

The session layer requirement stated in 4a is clear enough to carry forward as a formal requirement on the session participation feature: "The session participation endpoint MUST check `users.global_role` and reject users with `engineering_manager` global role before recording them as session participants. This check MUST be server-side." That is well-stated. It should be captured as a cross-feature constraint, not left in an exploration document where it may not be read when session participation is designed.

### 4. Facilitator-on-Own-Team (Section 4b)

The same issue as 4a: the risk is identified, the enforcement point is named (session setup layer), but the artifact where this constraint lands is unspecified. "This change should document this constraint" is not enough — name the file.

Additionally, the exploration raises a question it does not answer: "whether this is enforced at the session setup layer... is an open question." If it is an open question, it needs to be surfaced as a formal question for the product owner to close, not left as exploratory musing. A proposal cannot carry "we are not sure if this will be enforced."

### 5. Join Link Revocation (Section 5d)

The exploration correctly identifies this as a binary decision: add it to this change or explicitly defer it. The exploration does not make the decision. The proposal cannot carry a "should be added or deferred" — it needs to be one or the other.

The open question in Section 7 ("Should join links be revokable? If so, by whom?") includes a further unresolved question about single vs. bulk revocation. Before the proposal, this decision tree needs to be closed:

- Is revocation in scope for this change? (Yes or no, not "maybe")
- If yes: single revocation endpoint only, or single + bulk?
- If yes: who can revoke — facilitator who created it, any team facilitator, application admin?
- If no: what is the documented rationale for deferral, and where does it live?

The spec already has `revoked_at` in the schema and the validation logic handles it. The only missing piece is the write endpoint. That is a small addition. The proposal should either include it or explicitly exclude it with a reason. Leaving it as a question is not acceptable in a proposal.

### 6. `sourceIp: "callback"` (Section 5a)

This is well-specified. The fix is clear (pass `sourceIp` as a parameter to `executeJoinFlow`), the correct value is clear (`request.ip` from the callback handler), and the acceptance condition is clear (audit events from the through-auth path contain the real IP). No clarification needed here — this is ready to become a task.

### 7. `?alreadyMember=true` in Through-Auth (Section 5b)

Also well-specified. The behavioral gap is precisely stated (the direct path appends the parameter, the through-auth path does not), the fix is clear (append it in `executeJoinFlow` when the membership already exists), and the acceptance condition is clear (both paths behave identically for already-a-member users). Ready to become a task.

---

## Items Ready to Carry Into a Proposal Without Changes

The following findings are specific enough to become requirements or tasks as written:

- Section 5a: `sourceIp: "callback"` fix — ready as a task
- Section 5b: `?alreadyMember=true` in through-auth — ready as a task
- Section 5c: Missing test coverage — the test cases are enumerated; once the silent failure behavior is resolved (Item 1 above), these tests can be written against the specified behavior
- Section 6 ("What This Change Must Not Do") — all four constraints are clear, rationale is stated, and they can be carried as explicit out-of-scope decisions in the proposal

---

## Open Questions That Need Product Owner Resolution Before Proposal

The following items from Section 7 are genuine open questions, not vague requirements. They need a decision, not more analysis:

| Question | Decision Needed |
|---|---|
| Who can generate a join link before session setup exists? | Confirm this is a known dependency on session setup, not a gap in this change. Document the dependency explicitly. |
| What is correct behavior when a facilitator joins their own team? | Either session setup will enforce the constraint or it won't. This should be stated as a requirement on session setup, not left as an open question. |
| Should `pendingJoinToken` TTL match the OIDC state TTL? | The exploration concludes 10 minutes is reasonable. If that conclusion is accepted, close the question in the proposal rather than restating it as open. |
| Is join link revocation in scope? | Decision needed (see Item 5 above). |

---

## Summary

Two items must be resolved before a proposal is written:

1. **Silent join failure** — the error delivery mechanism, the message-to-failure-reason mapping, and the user's post-error landing destination all need to be specified. The test cases in Section 5c depend on this resolution.

2. **Role naming discrepancy** — the fix needs to name specific files and specific comment text. Three vague delivery targets ("proposal, onboarding documentation, code comments") need to become specific artifacts with specific content.

The remaining items are either well-specified (5a, 5b, 5c's test enumeration, Section 6), need a decision rather than more analysis (revocation scoping, open questions), or need a named artifact for cross-feature constraint documentation (4a, 4b).

The exploration is a strong foundation. These clarifications are the difference between a proposal that the engineering team can act on and one that generates three rounds of follow-up questions.
