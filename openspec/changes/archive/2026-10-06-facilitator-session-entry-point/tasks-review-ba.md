# Tasks Review: Facilitator session entry point (#237)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `tasks.md`, against `proposal.md`, `specs/session-creation/spec.md` and `design.md` (D1–D7)
**Verdict:** **Approve with minor changes.** Every scenario R1–R11 maps to at least one task, and all of my earlier points (B1–B3, V1–V7) carried through into concrete tests. Four small gaps remain. None of them needs a spec or design change; each is a sentence or one assertion added to an existing task.

---

## 1. Scenario-to-task traceability

| Scenario | Covered by | Status |
|---|---|---|
| (existing) Entry point not shown to a non-facilitator | Existing gate tests; 1.1(d), 1.1(e) extend it to the team view | Covered |
| (existing) Zero-membership facilitator reaches the entry point | Existing landing behaviour; walkthrough 4.1 step 1; 2.1(f) | Covered |
| **R1** Facilitator with membership reaches entry point from team view | 1.1(a), 1.1(b); "one navigation action" by 3.1 + 1.1(a) + walkthrough 4.1 steps 5–6, recorded in 3.3 | Covered (composite, stated honestly in 3.3) |
| **R2** Entry point does not target the viewed team; picker pre-selects nothing | Label: 1.1(c). Exact href: 1.1(a). No `state`: 1.2 (implementation only). Picker pre-selects nothing: **no task** | **Partial, see G1** |
| **R3** Not shown to an Engineer | 1.1(d) | Covered |
| **R4** Not shown to an Engineering Manager (incl. also sent `facilitator`) | Frontend: 1.1(e). `/auth/session` flag: 3.2. Precedence: existing tests cited by name in 3.2 | Covered |
| **R5** Facilitator with EM membership role on viewed team still sees it; that team is not offered | Link shown: 1.1(f). "That team is not offered": **no task or citation** | **Partial, see G2** |
| **R6** Picker explains the exclusion, no overclaim | 2.1(a), 2.1(b), 2.1(d); walkthrough 4.1 step 6 | Covered |
| **R7** Return link and sign-out on picker; not on confirm or new-team | 2.1(e), 2.1(g); walkthrough 4.1 step 6 | Covered |
| **R8** Way out when list fails to load; 403 re-sync | Floor: 2.1(h) (403, network, loading). Re-fetch once, not on network/500: 2.1(i). Redirect when flag false: 2.1(i) second half. Walkthrough 4.1 step 8 | Covered, with a note (G3) |
| **R9** Empty-state copy does not claim every team / no other teams | 2.1(c), 2.1(d); walkthrough 4.1 step 6a | Covered |
| **R10** Zero-membership facilitator: sign-out, no team link | 2.1(f); null-session variant 2.1(j); walkthrough 4.1 step 1 | Covered |
| **R11** Post-sign-in landing unchanged | 3.1 (with the `globalRole` fixture fix, so it actually guards something) | Covered |
| (existing) Confirm screen shows more than the bare name | Existing test "6.2/6.6" in `SessionCreationPage.test.tsx`; 2.2 requires existing tests unchanged | Covered |
| (existing) Race-condition rejection inline | Existing tests "6.4" (403) and "6.5" (stale re-fetch) | Covered |
| (existing) 409 offers path to existing session | Existing test "6.4 … 409" | Covered |

## 2. Requirement-text rules without their own scenario

These are normative sentences in the modified requirement. I checked each one separately because rules that live only in prose are where translation loss usually happens.

| Rule | Covered by | Status |
|---|---|---|
| Link absent from the DOM, not hidden, disabled or collapsed | 1.1(d)/(e) `queryByTestId` null plus no `href="/sessions/new"` | Covered |
| Render independent of the viewed team and of membership role | 1.1(b) (second team), 1.1(f) (EM role) | Covered |
| "…and on any other team view they can reach" | Nothing exercises a facilitator viewing a team they are *not* on. The D2 render condition has no team input, so this holds by construction | Acceptable. No task needed |
| Label not a bare "Start/Create a session"/"Facilitate"; no team name | 1.1(c) | Covered |
| Picker SHALL NOT add, remove or pre-select teams on the client | See G1 | Partial |
| Way-out controls do not depend on `AuthSession` having loaded | 2.1(j) | Covered |
| Session-expiry treatment exempt | 2.2 placement note (after the `reauthRequired` early return); existing "5.3" tests | Covered |
| Placement "outside the container that holds Topics and member management" | 1.1(g) checks order and `contains(topicsLink)`. It does not check the member-management container | Acceptable; Topics is the meaningful proxy |
| Shipped strings are listed in release notes | 4.2. **Omits the two empty-state strings and the block heading**, see G4 | Partial |

## 3. Proposal capabilities and constraints

| Proposal item | Task |
|---|---|
| What Changes 1 (Facilitator block) | 1.1, 1.2 |
| What Changes 2 (exclusion + empty-state copy) | 2.1(a)–(d), 2.2 |
| What Changes 3 (way out, every list state, 403 re-fetch) | 2.1(e)–(j), 2.2 |
| Constraint: enforcement stays server-side, client never filters | Scope guard; 1.2 "no `state`"; G1 for the test |
| Constraint: chain never revealed (copy) | 2.1(d) reviewer note tying strings to 01c |
| Constraint: no manager participates | 1.1(e), 3.2 |
| Constraint: nothing on live-session surfaces, `/no-team` bare, no shared layout | Scope guard (diff review). No test; acceptable for a "don't touch" rule |
| Constraint: landing unchanged | 3.1; scope guard on `App.tsx` |
| Impact: release notes and Priya walkthrough | 4.2 |
| Impact: UC annotation at archive | 4.4 |
| Follow-ups 1–6 | 4.3 lists all six, with #1 and #4 marked adoption-blocking as the sponsor asked |

Nothing in the proposal is missing from the tasks. Nothing in the tasks goes beyond the proposal: the only behavioural addition, the D5a re-fetch, is in both the spec (R8) and the proposal.

---

## 4. Gaps

### G1. R2's "picker pre-selects no team" and "no navigation state" have no test (should fix)

R2's last AND clause and the requirement sentence "SHALL NOT add, remove or pre-select teams on the client" are the client half of the facilitator-from-another-team rule. If a future change starts passing the current team through `state` (the most natural "improvement" someone will reach for), nothing fails. 1.2 tells the implementer not to add `state`, but that instruction is not a test.

**Ask:** add to 2.1 one test: rendering the picker under a `MemoryRouter` whose initial entry carries `state: { teamId: "<an eligible team id>" }` still shows the list screen with no team selected, and not the confirm screen. Optionally, in 1.1(a), assert that the sentinel route sees `location.state == null`. Either assertion is enough to lock the rule.

### G2. R5's second half is not tied to a test (should fix, citation only)

R5 says the viewed team "is not offered by the picker, because the eligible-teams listing excludes every team on which the caller holds an active membership of any role." This is server behaviour, and the change makes no server change. But no task cites the test that proves it, which is unlike R4, where 3.2 cites the precedence tests by name.

I checked. `facilitator-sessions.test.ts` has "the eligibility query excludes the caller's own team memberships via its WHERE clause", and the query in `facilitator-sessions.ts` has no role predicate on `team_memberships`, so an EM membership is excluded. The existing test asserts the join and `WHERE tm.id IS NULL`, but it does not assert the *absence* of a role filter, and a role filter is exactly the regression R5 exists to catch.

**Ask:** in 3.2 (or a new 3.4), cite that test by name for R5. Optionally add one line to it: the eligibility SQL does not contain `tm.role` / `membership_role`. That is a regression guard, expected to pass at once, in the same spirit as 3.1 and 3.2.

### G3. R8's re-fetch and redirect are tested as two halves (note only)

2.1(i) asserts that `refreshSession` is called once on 403, and separately that a `canFacilitateSessions: false` session redirects. The scenario's chain (403, then refresh, then redirect) is never exercised as one flow, because `refreshSession` is a no-op mock. That is a reasonable unit-test split, and walkthrough 4.1 step 8 covers the joined flow by hand. I am not asking for a change. Please mark step 8 as the R8 end-to-end check in the PR, as 3.3 does for R1, so a reviewer does not take "optional" to mean "uncovered".

### G4. Release notes omit the empty-state strings (should fix)

The spec says the strings that ship are listed in the release notes, and Priya's review in 4.2 is the human check on the copy rules. 4.2 lists the link, helper, exclusion copy and "Go to your team", but not the two rewritten empty-state strings from D5 or the "Facilitator" block heading. The empty-state strings are the ones I raised in B1, and they are the copy most likely to drift back towards "every team". Priya should see them.

**Ask:** in 4.2, extend the list to "link, helper, block heading, exclusion copy, both empty-state strings, 'Go to your team'".

---

## 5. Minor observations (no change required)

- **Walkthrough step 7, `manager-001`.** To see the absence of the Facilitator block, the manager must reach a team view, so they need a membership or a join link. The step does not say which. Suggest: "redeem the 'Home' join link as `manager-001`", as for `participant-001`.
- **2.1(c) word checks** ("every", "no other teams") remain a weak proxy for "imply", as I said in V4. 2.1(d)'s exact-string assertion plus the reviewer note is the real control, and that is in place.
- **3.1 and 3.2 are not test-first.** The tasks say so and ask for it to be recorded in the PR. Good. That is the honest framing.

## 6. Summary

Coverage is complete at the scenario level. Every R1–R11 and every pre-existing scenario has a test, a cited existing test, or a declared composite. The two gaps that matter both concern the rule this change exists to protect: G1 (client must not pre-select or carry the team) and G2 (the EM-membership exclusion on the server). Each closes with one assertion or a citation. G4 makes sure the copy a facilitator will actually read gets a human review. With those three addressed, I approve the tasks for implementation.
