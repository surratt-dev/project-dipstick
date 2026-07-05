# Proposal Review: First Access
**Reviewer:** Marcus Delgado, Business Analyst
**Change:** first-access
**Document reviewed:** openspec/changes/first-access/proposal.md
**Date:** 2026-07-05

---

## Overall Assessment

The proposal is well-constructed. The five capabilities are clearly differentiated, the prose is specific where it counts, and several constraints that were vague in the exploration notes have been tightened into language I can work with. The sub/iss identity matching section and the concurrent handling section are both correctly specified at a level that a developer can build from without coming back for clarification.

There are issues. Some acceptance criteria require interpretation to test. Some are code inspection criteria dressed as behavioral tests, which will create confusion in a QA handoff. Two capability areas are not directly traceable to a named capability. And one scenario that distinguishes the persistent condition check from a one-time first-access check does not appear in the acceptance criteria, only in the capability prose.

My findings are organized against the five specific questions I was asked to address.

---

## 1. Testability of the Eight Acceptance Criteria

### AC-1: Automatic account creation

**AC-1b — "Account creation does not require any administrator action or pre-provisioning."**

This is not testable as written. It is a process constraint, not a system state assertion. A tester cannot write a test that verifies "no admin action was required" — they can only verify that an account was created. The constraint this criterion is trying to enforce is that the system does not block or defer account creation pending external intervention. Restate it as a system behavior: "The application creates a user account as a direct result of successful authentication, with no other preconditions required from any actor." That is testable.

AC-1a and AC-1c are testable as written.

### AC-2: Identity matching by sub/iss, never email

**AC-2c — "The account lookup query uses only `oidc_subject` and `oidc_issuer` as match keys. Email does not appear in any query used for identity resolution."**

This is a code inspection criterion, not a behavioral test. No executable test can confirm that email does not appear in the query path — a tester would have to read the implementation. This belongs in a code review checklist or an implementation note, not in acceptance criteria. If the intent is to verify the behavioral consequence — that email-based collision or fallback is not occurring — replace it with a behavioral criterion: "An identity assertion that shares an email address with an existing account but presents a different `sub` value creates a new account, not a match to the existing one." That is already substantially covered by AC-2b, which is testable. Consider removing AC-2c or moving it to an implementation note.

AC-2a and AC-2b are testable as written.

### AC-3: Concurrent handling

The criterion is testable in principle, but requires infrastructure to trigger reliably. A standard unit test will not reproduce the race condition — it requires either genuine concurrent requests or a seeded concurrency harness. The criterion doesn't say how the concurrent scenario is to be induced. For a QA handoff this will produce the question "how do we test this?" That question should be answered in the proposal, not left to the implementer. Recommend adding a parenthetical: "(verified via a concurrent test that fires two authentication callbacks for the same sub/iss simultaneously with no prior account record)." The expected outcome — exactly one account, both callbacks complete — is stated precisely.

### AC-4: No-team redirect — server-side, live data

**AC-4c — "The team membership check in the callback queries live database state, not a cached session flag."**

This is a code inspection criterion dressed as a behavioral test. Observable behavior cannot distinguish between a live query and a cached read unless the test deliberately creates a discrepancy: change the team membership in the database after session state is cached but before the callback runs, then observe whether the redirect reflects the new state. The criterion doesn't describe that test scenario. Either replace it with the behavioral test it implies — "A user whose team memberships are removed in the database between sessions is routed to `/no-team` on their next sign-in" — or move it to an implementation constraint. The behavioral version is also more directly useful as a test case.

AC-4a, AC-4b, and AC-4d are testable as written.

### AC-5: No-team page layout

**AC-5b — "...not even empty or disabled versions."**

Requires interpretation. "Empty or disabled" versions of a navigation bar could mean a sidebar with no items, a collapsed sidebar, a nav component that renders its container element with no children, or a nav wrapper that applies CSS visibility:hidden. A tester needs to know which of these counts as a violation. Recommend defining the test condition operationally: "the page DOM contains no element that is a child of a shared layout component, and no element whose role or ARIA label corresponds to application navigation."

**AC-5c — "The `/no-team` route in the router is not wrapped in any layout component that contributes navigation elements. This is verified at the routing layer, not only at the component level."**

This is a code inspection criterion. "Verified at the routing layer" tells a developer where to look, but it is not an executable test. A behavioral test cannot directly observe that no layout wrapper is present — it can only observe rendered output. The rendered output test is AC-5b. AC-5c is redundant as a behavioral criterion; it is a code review instruction. Move it to an implementation note or a code review checklist item.

AC-5a is testable as written.

### AC-6: Missing claims rejection

Both criteria are testable, and the compound assertion (rejected auth, no account, no session, generic error, log without PII) is clear enough to drive test steps. One gap: the criteria cover missing or empty `sub` and missing `iss`, but not empty `iss`. By symmetry with how `sub` is handled, an empty `iss` should also result in rejection. The capability text says "missing the `iss` claim" but does not say "or contains an empty `iss` value." This is an asymmetry. If empty `iss` should be rejected — and it should — add it to both the capability and the criteria.

### AC-7: Account creation failure — no session

Both criteria are testable. The trigger (database operation fails) requires a test setup that injects a failure — this is infrastructure-dependent but standard practice. The expected outcomes (no session, no partial state) are specific enough to assert.

### AC-8: Audit logging

**AC-8b — "No PII is logged in authentication failure events."**

Requires interpretation. The proposal's Capability 5 is more precise: "No PII — including the values of any other claims present in the token." AC-8 drops that specificity. A tester asserting "no PII" without a definition of what PII means in this context is left to make a judgment call. Align AC-8b with Capability 5's language: "No claim values or identity attributes from the token appear in the failure log entry."

AC-8a is testable as written.

---

## 2. Missing-Claims Rejection Coverage

The proposal covers this capability adequately. Capability 5 specifies the conditions (missing `sub`, empty `sub`, missing `iss`), the required behaviors (reject, no account, no session, generic error, log without PII), and the ordering constraint (validation before `resolveOrCreateAccount`). The ordering constraint is the right thing to call out — it prevents partial state from forming.

Two issues remain.

**Empty `iss` is missing.** The capability rejects missing or empty `sub` but only missing `iss`. The exploration notes match this text. If an empty string `iss` is passed, the capability as written does not explicitly reject it. By symmetry with `sub` handling, it should. This should be resolved before implementation begins so the validator doesn't have to infer the intent.

**The log content is described only by exclusion.** Capability 5 says the log must contain "enough detail for an operator to identify which claim was missing or invalid" and must exclude PII. It does not say what the log entry should contain. "Enough detail to identify which claim" strongly implies the log should name the claim (e.g., `missing_claim: sub`), but a developer reading this could log a generic "invalid token" message and argue that it technically satisfies the constraint. State what must appear in the log: the name of the missing or invalid claim.

---

## 3. Persistent Condition Check vs. One-Time First-Access Check

The distinction is clearly stated in Capability 4: "The no-team condition is evaluated at every sign-in, not only on first access." The prose is explicit. The capability also states that a previously active user from whom all team memberships have been removed will see the no-team page on their next sign-in.

The problem is that this scenario does not appear in the acceptance criteria.

AC-4a tests a user with no memberships (which covers the first-access case). AC-4b tests a user with memberships. Neither AC tests the case that distinguishes persistent condition from one-time check: a user who previously had team memberships, had all of them removed, and is now signing in again. Without an acceptance criterion for this specific scenario, a developer who builds the routing check only for the first-access case would pass AC-4a.

Add an AC-4e: "A user who previously held team memberships and from whom all memberships have been removed is routed to `/no-team` on their next sign-in."

---

## 4. Out-of-Scope Items — Are They Correctly Bounded?

Most are correct. Two warrant closer examination.

**`isNewUser` flag reliability under concurrent load**

The out-of-scope declaration is accurate but the boundary condition is incompletely stated. The proposal says this is deferred and that "any downstream consumer of `isNewUser` must handle duplicate firings." However, the constraint on future work is positioned as advice rather than a hard requirement. If an analytics event fires twice on first access, the business impact may be invisible until someone notices inflated counts. Restate the constraint actively: "Before any feature that consumes `isNewUser` is merged, the SELECT-before-upsert pattern must be replaced with a pattern that derives `isNewUser` from the upsert result, or the consumer must be designed to handle duplicate firings as an idempotent operation." This language should appear in the tasks backlog, not only in the out-of-scope section.

**Main flow step 6 tension with the "create a new team" path**

The use case's main flow step 6 says the application should present the user with "available next steps (e.g., they have been invited to a team via a join link, or they may create a new team as part of starting a session)." The proposal correctly excludes a "create team" affordance from the no-team page, and the exploration notes give the right reasons for that exclusion. But the proposal does not acknowledge that it is departing from the use case's main flow text. This creates a traceability gap — if someone reads the use case and the proposal together, they will see the discrepancy without an explanation. Add a note in the out-of-scope section that the "create a new team" path mentioned in the use case main flow is intentionally excluded from the no-team page, with a brief reference to the facilitation-model reason: a new user on the no-team page is in a waiting state; team creation is the facilitator's responsibility, handled via the team creation workflow.

**The remaining out-of-scope items are correctly bounded.**

---

## 5. Use Case Acceptance Criteria — Coverage Check

The use case's First Access section has four acceptance criteria:

1. "A user with no existing account who authenticates successfully receives a new account automatically." → Covered by AC-1a.
2. "The new account has no team memberships or role assignments at creation time." → Covered by AC-1a (the account has "no team memberships and no role assignments").
3. "A user who authenticates a second time is matched to their existing account, not given a new one." → Covered by AC-1c.
4. "The user is informed they have no team associations and presented with a path forward." → Covered by AC-5a (renders the display name, no-team statement, join link instruction, sign-out affordance).

None of the use case criteria are lost. Coverage is complete.

One note: the use case's note says "the no-team landing state should be informative." The proposal satisfies this. The use case's note also says "The identity attribute used to uniquely identify a user... must be stable across sign-ins." The proposal resolves this explicitly with the sub/iss compound key. Both notes are addressed without requiring separate criteria.

---

## Capability-to-AC Traceability

The proposal defines five capabilities (C1 through C5, though not numbered) and eight acceptance criteria (AC-1 through AC-8). AC-7 and AC-8 do not correspond to any of the five named capabilities. AC-7 covers the failure case for account creation (corresponds to the alternate flow in the use case, "Account creation fails"). AC-8 covers audit logging. Neither is addressed in a named capability.

This creates a documentation gap: someone reading the capability list to understand what the feature does will not know that audit logging and failure handling are part of the feature. Recommend either promoting AC-7 and AC-8 to named capabilities, or explicitly tying them to the capability that is their context (the account creation failure case belongs under C1; the audit log belongs under C1 or C3 depending on what events are logged).

---

## Summary of Required Changes Before Implementation

These items need to be resolved before the task list is executed:

1. **AC-1b** — Rewrite as a system state assertion, not a process constraint.
2. **AC-2c** — Move to an implementation note or remove; replace with the behavioral criterion it implies if that criterion is not already covered.
3. **AC-3** — Add a note describing how the concurrent scenario is to be induced in a test context.
4. **AC-4c** — Rewrite as a behavioral criterion (the one that distinguishes live data from cached state) or move to an implementation constraint.
5. **AC-4e (missing)** — Add: returning user with all memberships removed is routed to `/no-team` on next sign-in.
6. **AC-5b** — Define "empty or disabled" operationally so the test condition is unambiguous.
7. **AC-5c** — Move to implementation note or code review checklist.
8. **AC-6, Capability 5** — Add empty `iss` to the rejection conditions.
9. **AC-8b** — Align with Capability 5's language ("no claim values or identity attributes from the token").
10. **Capability 5 log content** — Specify what must appear in the log (the name of the missing claim), not only what must not.
11. **Out-of-scope section** — Add a note acknowledging the departure from use case main flow step 6 on the "create a new team" path, with the reason.
12. **`isNewUser` deferral** — Restate as a hard constraint on future work in the tasks backlog.
13. **Traceability** — Map AC-7 and AC-8 to named capabilities, or add C6 and C7.
