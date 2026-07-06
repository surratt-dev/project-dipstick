# BA Review: Proposal — Join a Team via Invite Link
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-07-05
**Source reviewed:** `openspec/changes/join-team-invite-link/proposal.md`
**Reference:** `requirements/use cases/01 - Identity and Access - Use Cases.md`, lines 115–169

---

## Overall Assessment

This proposal is a significant improvement over the exploration document. The eight concerns I flagged in the exploration review are addressed — the error delivery mechanism is chosen, the vocabulary fix names specific files and specific comment text, the revocation decision is made, and the cross-feature constraints have a named artifact destination. The design.md decision log is thorough and the tasks.md is the most precise artifact in the set.

My concern is the gap between proposal.md and design.md. Several requirements that are fully specified in design.md and tasks.md are stated ambiguously or incompletely in proposal.md — which is the artifact the spec update is drawn from. If proposal.md is the source of truth for spec changes, the vagueness in proposal.md will flow into the spec. I flag these gaps below in priority order.

There is also one coverage gap against the use case acceptance criteria that the proposal does not address, and one open question that sits in design.md informally and should be formally tracked.

---

## Issues Requiring Resolution Before Implementation

### 1. Error Message Mapping Is Not in proposal.md

**What proposal.md says:** "The user sees the same error message they would have seen on the direct path."

**The problem:** "The same error message" is not a specification — it is a forward reference to a definition that proposal.md assumes the reader will retrieve from elsewhere. For an engineer reading proposal.md in isolation, the mapping between `?joinError=expired` and `?joinError=invalid` and the specific displayed strings is undefined.

The correct mapping IS stated in design.md (Goals section): "`?joinError=expired` → 'This link has expired. Ask your facilitator for a new one.'; `?joinError=invalid` → 'This link is not valid.'" It also appears correctly in tasks.md task 4.4. But it is absent from proposal.md.

The spec update listed in proposal.md ("through-auth error delivery requirement") will be written against proposal.md. If the mapping is not in proposal.md, it may not make it into the spec.

**Required fix:** The proposal.md "What Changes" section for through-auth error delivery should state explicitly:

> `?joinError=expired` is appended when the token is expired or revoked; the join error page displays: "This link has expired. Ask your facilitator for a new one."
> `?joinError=invalid` is appended when the token does not exist; the join error page displays: "This link is not valid."

This is consistent with the existing spec's "Join link validation" requirement, which already defines these messages for the direct path.

---

### 2. "Transient Banner" Is Undefined in proposal.md

**What proposal.md says:** "The team page renders a transient banner: 'You've joined the team. Your facilitator will share what comes next.'"

**The problem:** "Transient" is not a behavior — it is a category. A developer reading this cannot determine whether the banner auto-dismisses (and after how long), whether it requires a user action to close, or whether "transient" simply means it does not persist to the next page load. Three different implementations satisfy "transient."

design.md Decision 2 resolves this: "A transient banner that auto-dismisses." It also states: "The team page removes `?newMember=true` from the URL via `replace` navigation after rendering the banner, consistent with how it handles `?alreadyMember=true`."

The URL cleanup behavior (replace navigation) is critical to correctness — it prevents the banner from re-appearing on browser refresh. This is a requirement, not an implementation detail, and it belongs in proposal.md alongside the banner content.

**Required fix:** proposal.md should state:

> The team page renders a transient notification banner — "You've joined the team. Your facilitator will share what comes next." — that auto-dismisses, and removes `?newMember=true` from the URL via `replace` navigation after rendering, consistent with the existing `?alreadyMember=true` handler.

---

### 3. `?newMember=true` Destination URL Is Ambiguous

**What proposal.md says:** "When `executeJoinFlow` results in a new membership (not an already-a-member case), the redirect URL includes `?newMember=true`."

**The problem:** The existing spec already requires session-aware landing: if an active session exists, the user goes to `/session/:sessionId`; otherwise to `/team/:teamId`. The proposal does not state whether `?newMember=true` is appended to both possible destinations or only to the team page.

This matters for two reasons:

1. **Implementation correctness:** If `?newMember=true` is only appended to `/team/:teamId`, a first-time joiner who arrives during an active session will land on the session page with no confirmation that the join succeeded. If it is appended to `/session/:sessionId?newMember=true`, the team page's banner handler will never fire on that path.

2. **Banner content in session context:** The banner reads "Your facilitator will share what comes next." A user landing on an active session page is already on the next thing — the banner content may be confusing or contradictory in that context. The proposal should state whether the banner is expected to appear in the session view and whether the content is appropriate there.

tasks.md task 3.1 says "append `?newMember=true` to the returned `redirectUrl`" — which implies it is appended to whatever URL `executeJoinFlow` was already generating, meaning it appears on both `/team/:teamId` and `/session/:sessionId`. If that is the intent, it should be stated in proposal.md with an explicit note about whether the session page handles `?newMember=true` or silently ignores it.

**Required fix:** State whether `?newMember=true` appears on both session-aware landing destinations, and whether the session page is expected to handle or ignore it. If the banner should only appear on the team page, that is a requirement on the session page (it must not render the banner) and must be stated.

---

### 4. "New Membership" Detection Mechanism Is Unstated

**What proposal.md says:** "When `executeJoinFlow` results in a new membership (not an already-a-member case)..."

**The problem:** The existing upsert uses `INSERT ... ON CONFLICT DO NOTHING`. This pattern does not return information about whether the insert occurred or was a no-op. The proposal asserts that `executeJoinFlow` can distinguish "new membership" from "already-a-member" but does not state the mechanism. This is a real implementation question, not an infrastructure detail.

tasks.md task 3.1 says "when the membership insertion succeeds and the membership is new (not an already-a-member case)" without specifying how "new" is detected. Tasks 3.2 says "when the upsert finds an existing membership (`ON CONFLICT DO NOTHING` no-ops)" without specifying how a no-op is detected.

Common detection approaches — `RETURNING` clause with row count, `INSERT ... ON CONFLICT DO UPDATE SET id = id RETURNING xmax`, checking for an existing membership before insert — each have different properties and none are implied by the current upsert pattern.

This needs to be resolved at the proposal stage because the behavior of two separate capabilities (`?newMember=true` and `?alreadyMember=true` on the through-auth path) depends on correctly detecting which case occurred. A silent misdetection would cause the wrong query parameter to be appended with no observable error.

**Required fix:** proposal.md should name the detection mechanism, or the spec should state it as a requirement on the implementation with an explicit acceptance condition: "The mechanism for detecting new versus existing membership MUST be reliable under concurrent inserts."

---

## Issues Against the Use Case Acceptance Criteria

### 5. UC Acceptance Criterion — Role Verification Not Tested

**Use case AC (line 152):** "Following a valid join link adds the authenticated user to the team as an Engineer."

**What the proposal tests:** tasks.md task 6.4 tests that a successful through-auth join for a new member produces a redirect URL with `?newMember=true`. This verifies the redirect outcome, not the membership record.

No test in the proposal verifies that the membership row written to `team_memberships` has `role: 'participant'` (i.e., the Engineer role). The vocabulary documentation change (tasks 1.1 and 1.2) adds comments explaining the mapping, but comments do not prevent the wrong value from being inserted. A test that asserts the role value in the database would close this gap.

This matters specifically because the vocabulary confusion the proposal is correcting — "Engineer" vs. "participant" — is precisely the kind of confusion that could cause a developer to insert `'engineer'` instead of `'participant'`. A test against the membership record's role column is the correct backstop.

**Required fix:** Add a test to the test suite that asserts the `team_memberships` row for a successful join has `role = 'participant'`.

---

### 6. UC Alternate Flow — "Team No Longer Exists" Not Referenced

**Use case alternate flow (line 142):** "Team no longer exists: The application displays an error. The user is not added to any team."

The proposal addresses expired, revoked, and nonexistent token failures. It does not reference the "team no longer exists" alternate flow. The join link is associated with a team via a foreign key; if the team is deleted, following the link would likely produce a "nonexistent token" or database error depending on cascade behavior. This may already be handled by the direct path's validation logic, but the proposal does not state whether it is.

If this alternate flow is already covered by existing validation, the proposal should say so explicitly — the use case lists it as a distinct failure mode, so a reader of the proposal cannot currently confirm it is handled. If it is not covered, it should be added to the out-of-scope list with a note about what path currently handles it or a reference to where it belongs.

---

## Moderate Concerns

### 7. Open Question on First-Time User Error Path Is Informal

**design.md Open Questions:** "A new user who clicked a link, completed OIDC for the first time, and landed on the error page does not know who their facilitator is. The error message 'Ask your facilitator for a new one' may be disorienting."

This is a real UX gap. A first-time user who follows an expired link, completes OIDC (creating their account), and lands on the error page has no context for who to contact. The design.md notes a possible secondary message and says "if the frontend team considers it implementable within this change's scope." This should not be left as an informal option — it should be either included in scope with a defined requirement or explicitly out of scope with a rationale. As written, it is in scope for one team and out of scope for another depending on how they interpret "implementable within this change's scope."

The use case postcondition (line 147) says: "Failure: The user's team membership is unchanged. They are shown an appropriate error." "Appropriate" is doing work here. For a first-time user, the current message may not be appropriate. This deserves a formal decision.

**Required action:** Close the open question. Either add the secondary message to the spec requirement or put it on the out-of-scope list with a rationale. Do not leave it to the frontend team to decide.

---

### 8. session-participation Spec Constraints Lack Testable Acceptance Conditions

**What proposal.md says:** "EM protection and facilitator-on-own-team constraints are formally captured in `openspec/specs/session-participation/spec.md` as hard requirements."

The proposal creates a new spec file with "hard requirements" but does not state what those requirements look like in terms of testable conditions. Specifically:

- What happens when a user with `global_role = 'engineering_manager'` attempts to join a session? (HTTP status? Error message? Redirect?)
- What happens when a user who is the team's facilitator attempts to join a session they are running? (Same questions.)

"Hard requirement" is not a behavioral specification. The session participation spec will be the first artifact a developer reads when building that feature. If the constraints in the spec say "EMs must not participate in sessions" without specifying the enforcement mechanism and failure response, the developer will have to reconstruct the intent from scratch — which is exactly the scenario I am trying to prevent.

The proposal should state what the session-participation spec will contain in terms of scenarios, not just that the spec will contain constraints. At minimum: a scenario for the EM enforcement case that names the enforcement point (session participation endpoint), the trigger (server-side `global_role` check), and the failure response (HTTP status and user-facing behavior).

---

## Items That Are Specific Enough to Implement As-Is

The following capabilities in the proposal are fully specified and do not require clarification:

- **`sourceIp` fix** (tasks 2.1, 2.2): Mechanism is clear, acceptance condition is clear, test is specified (task 6.6). Ready.
- **`?alreadyMember=true` on through-auth path** (task 3.2, task 6.5): Behavioral gap is precisely stated, fix is clear, test is specified. Ready.
- **Role vocabulary comments** (tasks 1.1, 1.2): Specific files, specific locations, draft comment text provided in the task. Ready.
- **Role vocabulary spec section** (referenced in proposal.md "What Changes"): The mapping is stated clearly in design.md and tasks.md. Ready, provided the message mapping gap (Issue 1 above) is added to the same spec section.
- **Revocation deferral documentation**: Decision is made, rationale is stated, follow-on change is named. Ready.
- **Test cases 6.1–6.3** (through-auth error routing): Now that the error delivery mechanism and message mapping are decided, these tests can be written. The mapping between query param values and displayed messages should be verified in 4.4 and referenced in these test descriptions.

---

## Summary

| Issue | Priority | Action Required |
|---|---|---|
| Error message–to–query-param mapping missing from proposal.md | Must fix | Add explicit mapping to proposal.md and spec update |
| "Transient" banner undefined; URL cleanup behavior missing | Must fix | Add auto-dismiss behavior and replace-navigation requirement to proposal.md |
| `?newMember=true` destination URL unspecified (session vs. team page) | Must fix | State whether parameter appears on both landing destinations; state whether session page handles or ignores it |
| New-vs-existing membership detection mechanism unstated | Must fix | Name the detection mechanism in the proposal; add concurrent-reliability acceptance condition |
| UC AC: role value in membership record not tested | Moderate | Add test asserting `team_memberships.role = 'participant'` for successful join |
| UC alternate flow "team no longer exists" unaddressed | Moderate | Confirm existing coverage or add to out-of-scope list with explanation |
| First-time user error path open question left informal | Moderate | Close the question: in scope with defined requirement, or out of scope with rationale |
| session-participation constraints lack testable scenarios | Moderate | Add at minimum one enforcement scenario with failure response to the spec |

The four "must fix" items should be resolved in proposal.md before implementation begins. The moderate items are improvements that will prevent implementation questions or coverage gaps from surfacing late in the cycle.

The foundation is solid. The design decisions are good and the rationale is well-documented. The gap is that design.md carries information that should be in proposal.md — the artifact that drives spec updates. Close that gap and this is ready.
