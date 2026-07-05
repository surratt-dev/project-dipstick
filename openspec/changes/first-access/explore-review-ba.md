# BA Review: First Access Exploration Notes
**Reviewer:** Marcus Delgado, Senior Business Analyst
**Source:** openspec/changes/first-access/exploration-notes.md
**Date:** 2026-07-05

---

## Summary Judgment

The exploration is well-reasoned and the intent is clear. Devon's framing is solid and the core constraints are mostly right. The problem is that "mostly right" is not good enough to hand to an implementation team. Several constraints that need to be testable acceptance criteria are written as design intent or prose observations. Several open questions are left unresolved when they should be closed before proposal. And the no-team page behavior, which the exploration correctly identifies as the most user-visible part of this feature, is not specified precisely enough to build from.

This review is organized as: blocking clarifications, vague areas, and suggested rewrites.

---

## Part 1: Clarifications Needed Before Proposal

These are not informational questions. They determine what gets built. They must be resolved and written into the proposal as explicit requirements.

### 1.1 Is the no-team page a first-access screen or a persistent routing condition?

The exploration correctly flags this in Section 4 as an open question but does not answer it. The spec apparently describes the no-team state as what a new user encounters at creation time. The exploration concludes the no-team page "should apply in both cases" but leaves this as an inference, not a stated requirement.

This is a blocking gap. The routing logic that sends a user to the no-team page must be implemented one of two ways: (a) check a flag set at account creation time, or (b) query live team membership at every sign-in. These produce different behavior the moment a user's membership changes between sign-ins. The implementation team cannot make this decision themselves without going outside the requirements.

**Required resolution:** State explicitly that the no-team page is a persistent condition check based on live team membership, not a one-time routing decision tied to account creation. A user removed from all teams must see the no-team page on next sign-in, not their old team view.

### 1.2 What is the authoritative mechanism for detecting no-team state at routing time?

The exploration names this as an open question in Section 4 and does not resolve it. This is blocking. The question is not academic — it determines whether the routing decision is made server-side (redirect on callback) or client-side (API call after login). It determines what the API contract looks like and what data the session carries.

**Required resolution:** Specify where in the request lifecycle the team membership check happens, what data source it reads, and what the routing response is. At minimum: does the server redirect after account resolution, or does the client call an API and redirect itself? This boundary must be explicit before anyone writes routing logic.

### 1.3 What is the correct behavior when `sub` or `iss` is missing from the IdP token?

The exploration flags this in Section 4 and describes what might happen (garbage record or NOT NULL constraint failure). It does not state what must happen. "This specific failure mode deserves explicit handling" is an observation, not a requirement.

**Required resolution:** State the correct behavior as an acceptance criterion. See suggested rewrite in Part 3.

### 1.4 What is the precise boundary of "no navigation" on the no-team page?

The exploration says: no application navigation, no nav sidebar, no header that includes navigation. It also says the sign-out affordance is allowed. That leaves a gap: what about a page header with a logo only? A "contact support" link? A feedback button? A help tooltip? The exploration draws the line at "navigation chrome" without defining what that includes beyond the obvious.

This is blocking for the layout and routing implementation. If the no-team page is wrapped in any shared layout component, the team needs an explicit rule for what that layout may and may not contain, not just the principle.

**Required resolution:** Enumerate the permitted elements of the no-team page (positive definition) and state explicitly that no layout wrapper may contribute additional interactive or navigational elements. See suggested rewrite in Part 3.

---

## Part 2: Vague Areas

These are not blocking in the same way, but they will cause implementation questions if not tightened before handoff.

### 2.1 Drift risks are named but not stated as acceptance criteria

Section 3 contains six drift risks. Most are described as things that could go wrong if the design drifts. This is useful context. It is not useful as a requirement. For an implementation team to avoid drift, they need to know not just what could go wrong but what the correct behavior is in testable terms.

Specific examples:

**Drift risk: "Email used as an identity matching fallback."** The acceptance criterion implied here is that email must not appear anywhere in the identity resolution query path. But the exploration only states the negative consequence of getting this wrong. A developer who adds email as a fallback "just in case" may not recognize it as a violation because the constraint is not stated as one.

**Drift risk: "Check-then-insert replacing the upsert pattern."** This is framed as an implementation constraint ("use upsert, not check-then-insert"). The behavioral guarantee the implementation must provide is not stated. What must be true from the outside — what the acceptance test would check — is not written down.

**Drift risk: "A 'create team' affordance on the no-team page."** The constraint is stated correctly, but "affordance" is undefined. Does a text link count? A menu item? A settings path that a user could navigate to? The stronger form of this constraint is: the no-team page must not contain any path by which a user can initiate team creation. That needs to be stated as a constraint on both the page and the routing layer.

### 2.2 "Sign-out as the only action" is ambiguous in scope

Section 5 observes that the no-team page component "offers sign-out as the only action." This reads as an observation about the current implementation. Is it a requirement? If it is, it rules out adding a help link, a feedback link, or a "learn more" disclosure. If it is not a hard requirement, the phrase is misleading.

The exploration should either commit this as a requirement or reframe it as a description of the current implementation that may change.

### 2.3 The `isNewUser` race condition risk has no actionable conclusion

Section 3 flags the `isNewUser` flag firing twice in a concurrent scenario. It correctly notes this is low risk now because nothing downstream consumes `isNewUser`. Then it stops.

The exploration leaves open: should this be documented as a known limitation before the proposal? Should the SELECT-before-upsert pattern be changed now? Is there a requirement to address this before adding any downstream consumer of `isNewUser`?

Without an actionable conclusion, this observation will not produce any requirement and will not be addressed. The proposal needs to either: (a) include a requirement that any downstream consumer of `isNewUser` must handle duplicate firings, or (b) include a requirement to replace the SELECT-before-upsert pattern with an approach that derives `isNewUser` from the upsert result rather than a prior read, or (c) explicitly mark this as out of scope and note the risk.

### 2.4 The `${claims.sub}@unknown` email fallback is named as technical debt but not dispositioned

Section 4 notes this is an operational anomaly worth flagging. It does not say whether this change should address it, defer it, or document it and move on. If it is in scope, a requirement should describe the correct fallback behavior. If it is out of scope, the exploration should say so and not surface it as an ambiguity for the implementation team.

### 2.5 "Automatic account creation" trigger is implicit

Section 2 states account creation must be automatic on successful authentication. The trigger is not defined precisely. Successful authentication could mean: after the IdP callback is received, after the IdP token is validated, after the session is established. The sequence matters because "account creation failure must not produce a partial session" (also Section 2) implies account creation must complete before session establishment. That ordering must be explicit.

---

## Part 3: Suggested Rewrites

### Rewrite A: No-team page as persistent routing condition (replaces open question 1.1)

**Current (Section 4):**
> "the no-team page should apply in both cases, which means it is a persistent state check, not a one-time first-access screen"

**Suggested requirement:**
> A user with no active team memberships must be routed to the no-team page at every sign-in, regardless of prior session state or account age. This applies to both newly created accounts and to previously active accounts from which all team memberships have been removed. The routing layer must evaluate team membership from a live data source at sign-in time, not from a flag stored in the session. A user who had team memberships in a prior session but has none at the time of the current sign-in must see the no-team page, not their previous team view.

### Rewrite B: No-team page element specification (replaces vague "no nav" constraint)

**Current (Section 2):**
> "The page must not display: application navigation, empty session lists, empty dashboards, 'create a team' affordances, or any feature surface that implies team membership is optional or that the user can do something else. One instruction. That's it."

**Suggested requirement:**
> The no-team page must display exactly the following elements:
> 1. The authenticated user's display name
> 2. A statement that the user is not yet a member of any team
> 3. An instruction to request a join link from a facilitator
> 4. A sign-out affordance
>
> No other interactive or navigational elements are permitted on this page. The page must not be rendered inside a layout wrapper that contributes additional navigation, header links, or sidebar elements. There must be no path from this page — by link, menu, or navigation element — through which a user can initiate team creation, access team-specific features, or reach any page that requires team membership.

### Rewrite C: Identity-matching acceptance criterion (makes Section 2 constraint testable)

**Current (Section 2):**
> "a returning user who authenticates with the same sub/iss but a different email must be matched to their existing account, not given a new one"

**Suggested acceptance criterion:**
> Given a user account exists with `oidc_subject = 'X'` and `oidc_issuer = 'Y'`, when the IdP returns a token with `sub = 'X'`, `iss = 'Y'`, and any email address (same or different from the stored value), then:
> - The application must return the existing account record
> - No new account record must be created
> - The account lookup must use only `oidc_subject` and `oidc_issuer` as match keys; email must not be used as a lookup or fallback lookup field
>
> Additionally: the behavior when the stored email and the token email differ (update stored email vs. retain stored email) must be stated explicitly. The exploration does not specify this and it is not derivable from the identity-matching constraint alone.

### Rewrite D: Missing claim handling as acceptance criterion (closes open question 1.3)

**Current (Section 4):**
> "The resolver would attempt to upsert with oidc_subject = '', which would either create a garbage record or fail a NOT NULL constraint... this specific failure mode deserves explicit handling."

**Suggested acceptance criterion:**
> If the IdP token is missing the `sub` claim, contains an empty `sub` value, or is missing the `iss` claim, the application must:
> 1. Reject the authentication attempt
> 2. Return a user-visible error indicating that sign-in failed
> 3. Not create any account record or partial database state
> 4. Not establish a session
> 5. Log the failure with enough detail for an operator to identify the claim that was missing or invalid, without logging PII

### Rewrite E: Concurrent authentication behavioral guarantee (replaces implementation-focused drift risk)

**Current (Section 3):**
> "Check-then-insert replacing the upsert pattern... Two concurrent authentication callbacks for the same user could both read 'not found' and both attempt insertion."

**Suggested acceptance criterion:**
> When two authentication callbacks arrive simultaneously for a user who does not yet have an account:
> - Exactly one account record must be created
> - Both callbacks must complete without returning an error to the user
> - No duplicate account records may exist after both callbacks complete
>
> Note to implementation team: this requirement constrains the observable outcome, not the implementation approach. The current upsert pattern satisfies this requirement. Any refactor of the account resolution logic must demonstrate it preserves this guarantee before merging.

---

## Summary of Actions Required Before Proposal

| # | Item | Status |
|---|------|--------|
| 1 | Resolve: is no-team page a persistent condition or first-access screen? | Blocking |
| 2 | Resolve: where and how is no-team state detected at routing time? | Blocking |
| 3 | Resolve: what happens when sub or iss is missing from the IdP token? | Blocking |
| 4 | Resolve: what elements are permitted on the no-team page (positive definition)? | Blocking |
| 5 | State drift risks as behavioral acceptance criteria, not implementation notes | High |
| 6 | Disposition the isNewUser race condition: in scope, deferred, or documented risk? | High |
| 7 | State the account creation trigger explicitly in sequence with session establishment | High |
| 8 | Disposition the @unknown email fallback: requirement to fix, or explicit deferral? | Medium |
| 9 | Clarify "sign-out as the only action": hard requirement or implementation observation? | Medium |
| 10 | Specify behavior when stored email differs from token email on returning user sign-in | Medium |
