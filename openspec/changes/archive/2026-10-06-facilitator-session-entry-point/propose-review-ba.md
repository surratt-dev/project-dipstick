# BA review: proposal, facilitator session entry point (#237)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-06
**Reviewed:** `proposal.md`, `specs/session-creation/spec.md` (delta), `design.md` and `tasks.md` for cross-reference. Checked against the current `openspec/specs/session-creation/spec.md` (lines 301–327), BRD FR-2.1 and FR-2.2 [HARD], FR-1.5 [PREF], `Summary.md`, my own `explore-review-ba.md`, and the current `SessionCreationPage.tsx` / `auth.ts` behaviour where the delta makes claims about them.
**Question asked:** Are the capabilities specific enough to implement? Are the acceptance criteria explicit?

---

## Overall verdict

**Approve with changes.** This proposal addresses nearly everything I raised at exploration. R1, R2, R3 and R5 are in the delta almost word for word. C1, C2, C4, C5, C6 and C7 have recorded answers (proposal §What Changes 3, design D2, D4, D5, Risks). The label rule is normative by meaning and not by string, and the walkthrough has a cleanup step. Traceability is clean: FR-2.1/FR-2.2 → UC "Create Session for Existing Team" step 1 → MODIFIED requirement → scenarios → named tests in tasks 1.1/2.1/3.1. Almost every SHALL now has a scenario, and almost every scenario has a test.

One problem is substantive and should be fixed before design sign-off (B1). Two gaps would turn into "what did you mean?" questions during implementation (B2, B3). The rest are tightening.

---

## Blocking / should fix before implementation

### B1. The existing empty-state copy breaks the rule this change introduces
The delta's exclusion-copy rule (R6) says the picker "SHALL NOT state or imply that every team other than the caller's own is listed". The reason given is 01c: once #247 lands, reporting-chain teams will be missing silently, and the copy must not reveal that.

The **empty** state already breaks the same principle. `SessionCreationPage.tsx` line ~413, for `callerHasTeamMemberships = true` and an empty list:

> "You're already a member of every team in the organization. …"

- **Today** this is already false whenever another team exists but is deactivated. The endpoint excludes deactivated teams, and the user is not a member of them.
- **After #247** it will be false whenever the only non-member teams are in the caller's reporting chain. It also points straight at the hidden exclusion: "I'm not on Team X, so why does it say I'm on every team?"

The proposal says "the existing empty-state copy is unchanged", and task 2.1(c) asserts it stays unchanged. That locks in the defect with a test.

**Recommendation (pick one and record it in the proposal):**
- (a) *Preferred, small:* bring the empty state under the same rule in this change. Add to the requirement text: "The empty-state copy SHALL NOT state or imply that the caller belongs to every team, or that no other team exists." Then change task 2.1(c) to assert the new copy and the absence of "every". Suggested string, not normative: "There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. Don't see the team you're looking for? Create one to get started."
- (b) Make it an explicit **blocking dependency of #247**: file it now, link it in Follow-ups, and remove the word "unchanged" from task 2.1(c), so the test doesn't defend the defect.

Either way, the "chain is never revealed" claim in §Constraints is not true while this string ships. The proposal should not claim it unconditionally.

### B2. "Picker screen" does not define which picker *states* get the way out
The delta says "The picker screen SHALL offer a way out … a sign-out control, for every facilitator". The picker screen has four states: loading, error (`picker-error`), empty and populated. Today, "Create a new team" renders only when `!listError`.

The case that matters most is the error state. Design's Risks section says a facilitator with a stale `canFacilitateSessions` gets a 403 and sees "Failed to load teams…". If sign-out and "Go to your team" are rendered inside the same `!listError` guard, as the existing control is, that user is stuck on a dead end again, which is the defect this change fixes.

**Concrete condition to add to the requirement:**
> The sign-out control and (when applicable) the team-view link SHALL be rendered on the picker screen in every list state (loading, load error, empty, populated). They SHALL NOT be conditional on the eligible-teams request succeeding.

**Scenario to add:**
> #### Scenario: Way out is available when the eligible-teams list fails to load
> - **GIVEN** a facilitator with one or more active memberships on the `/sessions/new` picker screen
> - **WHEN** `GET /api/v1/teams/eligible-for-session` fails (e.g. `403` after the role was revoked, or a network error)
> - **THEN** the load-error message is shown
> - **AND** the sign-out control and the link to `/team/:teamId` are shown

Add a matching test, 2.1(h): mock a 403 and assert that `picker-error`, `picker-go-to-team` and sign-out are all present.

### B3. The new-team screen is unaddressed in the spec
Design D5 says "the confirm **and new-team** screens are unchanged". The delta's scenario says only "neither is added to the **confirm** screen". An implementer who puts sign-out in a shared wrapper would satisfy the spec and break the design. Add "or the new-team screen" to that scenario's AND, and extend task 2.1(g) to cover the new-team screen.

---

## Vague or implicit language

| # | Where | Text | Problem | Concrete fix |
|---|---|---|---|---|
| V1 | Delta, EM scenario GIVEN | "a user whose global role resolves to `engineering_manager`…" | The frontend tests (1.1(e)) assert on `canFacilitateSessions: false`. The scenario never says the flag is false, so nothing in this change links "EM + facilitator claim" to "flag is false". | Add **AND** `/auth/session` returns `canFacilitateSessions = false` to the GIVEN. Name the existing #243/`oidc-role-mapping` test that covers the backend half in task 1.1(e)'s comment, or add one assertion to `auth.test.ts`. This is the case that has regressed before, so the full chain needs a test, not only the frontend half. |
| V2 | Proposal §What Changes 1 | "The block is not placed next to 'Topics' or member management." | "Next to" is not testable. Task 1.1(g) has a testable version ("precedes Members", "not in the same container as `nav-topic-management`"). | Keep it out of the spec, which is correct as it stands, and in the proposal say "see task 1.1(g)" rather than "next to". |
| V3 | Delta, R1 last AND | "with exactly one navigation action after the post-sign-in landing" | Good condition, but no automated test covers it. 1.1(a) covers the click, and 3.1 covers the landing. The end-to-end claim is verified only by walkthrough step 4.1.5–6. | Say so explicitly. Either the scenario is verified by "3.1 + 1.1(a) together, plus walkthrough 4.1", or add that note to tasks so a reviewer doesn't look for a missing test. |
| V4 | Delta, R6 | "SHALL NOT state or imply that every team … is listed" | "Imply" is still judgement. Test 2.1(d) checks two words ("every", "all other"), which is a weak proxy ("any team but yours" passes). | Acceptable, because the meaning is normative and Priya reviews the string. Extend 2.1(d) to assert the exact shipped string as well, so any edit to the copy fails a test and forces a reviewer to look at R6. Same for the empty state if B1(a) is taken. |
| V5 | Delta, return link | "a link to the team view of one of the caller's teams" | Clear and deliberately non-deterministic (design Risks). Fine. One implicit dependency: `teamMemberships` excludes removed memberships (`removed_at IS NULL`), but I could not confirm it excludes **deactivated** teams. If it doesn't, "Go to your team" can lead to a deactivated team's page. | Confirm in design D5 what `TeamPage` shows for a deactivated team. If it's an error, state that this is accepted and covered by D2's "deactivated team still shows the link". |
| V6 | Proposal §Capabilities | R1–R6 list | The delta adds eight scenarios, not six. "EM membership role still sees entry point" (my C4) and "Zero-membership facilitator sees sign-out but no team link" have no R-number. | Renumber or extend the list so the proposal-to-spec trace is one-to-one. A reviewer counting scenarios against the list will otherwise flag a mismatch. |
| V7 | Delta, requirement text | "on the team view (`/team/:teamId`) of every team they belong to" vs "independent of which team is being viewed" | Consistent but subtle. The first sentence is a floor (must appear on own teams), and the second removes any team condition. Fine, but a reader may take the first as the full render condition. | Add "(and on any other team view they can reach)" or leave it, since design D2 settles it. Low priority. |

---

## Checked against requirements

- **FR-2.1 [HARD]** (only a Facilitator creates sessions): gated on server-computed `canFacilitateSessions`. Absence from the DOM is tested for Engineer and EM. Satisfied.
- **FR-2.2 [HARD]** (no session for own team, any membership role): enforcement stays server-side and the client is forbidden to filter or pre-select (D3, R2). The EM-membership-role facilitator case is now explicit. Satisfied, subject to B1 for the "never reveal the chain" corollary.
- **`Summary.md`** ("senior engineer from another team"): this is the scenario the change exists for. The walkthrough reproduces it with a home team. Good.
- **FR-1.5 [PREF]** (current user's name and role on primary screens): not addressed and not required by this change. Noting it because the new Facilitator block is the first role-specific heading on `TeamPage`, and it partially meets FR-1.5 by accident. Do not claim it as delivered.
- **UC 02 "Create Session for Existing Team", step 1:** the archive-time annotation in task 4.4 closes the trace I asked for (exploration R6). Good.
- **Persona concern, "edge cases discovered late become scope disputes":** the four follow-ups are named and assigned to task 4.3. Follow-up 1 (resume in-progress session) is correctly marked high priority. I would also file **B1(b)** there if (a) is not taken.

---

## Acceptance conditions for moving to design sign-off

1. B1 is resolved by (a) or (b), and the §Constraints "chain is never revealed" claim is made accurate.
2. The requirement text states that sign-out and the return link render in all picker list states, and the load-error scenario and test are added (B2).
3. The new-team screen is named alongside the confirm screen in the scenario and in task 2.1(g) (B3).
4. The EM scenario's GIVEN includes `canFacilitateSessions = false`, and the backend half is tied to a named test (V1).
5. The proposal's R-list matches the delta's scenarios (V6).
6. Tasks note how the R1 "one navigation action" clause is verified (V3).
