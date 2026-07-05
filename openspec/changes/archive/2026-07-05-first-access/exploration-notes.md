# Exploration Notes: First Access
**Perspective:** Devon Calloway, Internal Champion
**Use Case Source:** requirements/use cases/01 - Identity and Access - Use Cases.md
**Updated:** 2026-07-05 — revised to address review feedback from Priya Nair (Facilitator) and Marcus Delgado (BA)

---

## 1. Intent and Why It Matters for the Ritual

First Access is invisible infrastructure — or it should be. When it works correctly, a user authenticates and arrives at the application without ever knowing account creation happened. That invisibility is the point.

The ritual depends on zero-friction adoption. Devon's original argument to the VP was that teams he had never spoken to should be able to adopt the Engineering Health Check without needing his help. If getting into the application requires admin provisioning, helpdesk tickets, or an account request workflow, that argument collapses. First Access closes that gap: authentication through the org's identity provider is sufficient. The application creates the account automatically.

The no-team landing state is the first visible thing the application says to a new user. It is not a dead end — it is a holding state with a clear instruction. A user who arrives there should understand exactly one thing: they need a join link from a facilitator. That clarity matters because the user's first experience shapes their impression of whether the tool is worth engaging with at all. A confusing first screen, or one that looks like a broken page, will create support burden and reduce adoption.

There is also a subtler intent here: the no-team page models how the application relates to its users throughout. It gives the user accurate information about their state, does not pretend features are available when they aren't, and offers exactly one actionable path. That is the right posture for a tool that is supposed to feel like it disappears into the background.

---

## 2. Core Constraints That Must Be Preserved

**No admin-mediated provisioning.** Account creation must remain automatic on successful authentication. Any drift toward manual approval, admin provisioning flows, or pre-registration requirements would directly undermine zero-friction adoption. This constraint is structural — it is why the use case exists at all.

**Identity matching on sub/iss, never email.** The compound key of the IdP subject claim (`sub`) and issuer (`iss`) is the stable identity anchor. Email is not stable — users change email addresses, org directories reassign them, and email-based matching would cause the application to lose historical continuity for returning users. The spec is explicit: a returning user who authenticates with the same `sub`/`iss` but a different email must be matched to their existing account, not given a new one. Any refactor that introduces email-based matching — even as a fallback — violates this.

**New accounts have no memberships and no roles at creation time.** This is not a default that gets set to something benign; it is genuinely empty. The application must treat a user with no team memberships as having no access to team-specific features. Any code path that assigns a default team, a default role, or any implicit capability at account creation is wrong.

**The no-team page has exactly four permitted elements and nothing else.** The permitted elements are:

1. The authenticated user's display name
2. A statement that the user is not yet a member of any team
3. An instruction to request a join link from a facilitator
4. A sign-out affordance

That is the complete list. "No navigation" means no application navigation bar, no sidebar, no header navigation links, and no feature menus — not even collapsed, empty, or disabled versions of them. The sign-out affordance is the only interactive element. The page must not be rendered inside any layout wrapper that contributes additional navigation, links, or menus. A static logo or wordmark is acceptable; anything that implies navigability is not. There must be no path from this page — by link, menu, or navigation element — through which a user can initiate team creation, access team-specific features, or reach any page that requires team membership.

The reason for the single-action constraint goes beyond preventing confusion. A participant on the no-team page should be in a state of waiting — waiting for the facilitator to bring them in. Any affordance that lets them act independently undermines the facilitator's control over the onboarding sequence. For first sessions especially, the facilitator's introduction to the ritual is part of what makes the session successful. The page must not offer a way around that.

**Account creation failure must not produce a partial session.** If the database operation fails, no session is established. The user gets a generic error. The failure is logged with enough detail for an operator to diagnose. Silent failures or partial state (session established but account not created, or account created without proper session) are both bugs.

---

## 3. What Could Go Wrong If the Design Drifts

**Email used as an identity matching fallback.** If a developer adds email-based lookup as a fallback "just in case," users who change email addresses will get new accounts on next sign-in. Their historical session participation, trend data, and team memberships will be on the old account with no path to reconciliation. This is subtle and hard to detect — the returning user won't know something went wrong until they notice their history is gone. The acceptance criterion: the account lookup must use only `oidc_subject` and `oidc_issuer` as match keys. Email must not appear anywhere in the identity resolution query path.

**A "create team" affordance on the no-team page.** If someone adds a "get started by creating your team" button to the no-team page, they undercut the facilitator-from-another-team constraint. Engineers would be able to create teams without a facilitator, which means sessions could be run without proper facilitation. Devon is categorical about this: the facilitator constraint is load-bearing, not a preference. A "create team" button on the no-team page is exactly the kind of well-intentioned drift that destroys a structural constraint. The constraint applies to the page and to the routing layer: there must be no path by which a user on the no-team page can initiate team creation.

**Application navigation rendered around the no-team page.** "No navigation" means no application navigation bar, no sidebar, no header navigation links, no feature menus — not even empty or disabled versions of them. The sign-out affordance is the only interactive element permitted on the page. Any shared layout component that contributes navigation elements must not wrap the no-team page. This must be verified at the routing and layout level, not just at the component level.

**Check-then-insert replacing the upsert pattern.** If a developer refactors `resolveOrCreateAccount` to read the user, decide whether to insert, and then insert separately, they reintroduce a race condition. Two concurrent authentication callbacks for the same user could both read "not found" and both attempt insertion. One will fail with a unique constraint error. If that error is not handled gracefully, the user gets a sign-in error. The observable guarantee: when two authentication callbacks arrive simultaneously for a user who does not yet have an account, exactly one account record must be created and both callbacks must complete without returning an error. Any refactor of the account resolution logic must demonstrate it preserves this guarantee before merging.

**Session created despite account creation failure.** If error handling is sloppy — the account creation query throws, is caught somewhere up the stack, and the callback handler proceeds to establish a session anyway — the user gets into the application in a broken state. The next query that tries to look up their user record will fail or return nothing. The constraint is: no account, no session. Period.

**The `isNewUser` flag firing analytics or emails twice in a race.** The current implementation determines `isNewUser` with a SELECT before the upsert. In a concurrent scenario where two callbacks arrive for the same user at the same moment, both may read "not found" and both set `isNewUser = true`. The upsert handles the data correctly, but if anything downstream acts on `isNewUser` (analytics events, welcome notifications), it may fire twice. This is explicitly deferred: this change does not address the race. The requirement is that any future downstream consumer of `isNewUser` must either handle duplicate firings or the SELECT-before-upsert pattern must be replaced with one that derives `isNewUser` from the upsert result before that consumer is added. This is a documented constraint on future work, not a defect in the current implementation.

---

## 4. Decisions on Previously Open Questions

These were open questions in the original draft. The reviewer feedback confirmed they must be resolved before proposal. Decisions follow.

**The no-team page is a persistent condition check, not a first-access screen.**

This is now a stated requirement, not an inference. A user with no active team memberships must be routed to the no-team page at every sign-in, regardless of account age or prior session history. This applies equally to newly created accounts and to previously-active accounts from which all team memberships have been removed. The routing layer must evaluate team membership from a live data source at sign-in time, not from a flag stored in the session or account record. A user who had team memberships in a prior session but has none at the time of the current sign-in must see the no-team page, not their previous team view.

**The routing decision is made server-side, during the authentication callback.**

By the time account resolution completes, the server knows the user's team memberships. The redirect to the no-team page must be part of the callback response — the client must not need to make a separate API call to determine where to go. Client-side routing for this decision introduces a window where the client might briefly render the wrong state. For a constraint this significant, server-side is the correct boundary. The boundary between "First Access resolves the account" and "routing layer determines what page to show" must be explicit in the implementation: account resolution and team membership check happen together in the callback handler; the redirect is the result.

**The no-team URL must redirect to the team view if the user has a team membership.**

If a user bookmarks the no-team URL and navigates there after joining a team, the application must redirect them to their team view. The no-team page must only be shown when it is accurate. Showing it to a user with an active team membership would be confusing and would misrepresent their state.

**Missing or empty `sub` or `iss` claims must result in a rejected authentication, no account created, no session established.**

This is an acceptance criterion: if the IdP token is missing the `sub` claim, contains an empty `sub` value, or is missing the `iss` claim, the application must: (1) reject the authentication attempt, (2) return a user-visible error indicating that sign-in failed, (3) not create any account record or partial database state, (4) not establish a session, (5) log the failure with enough detail for an operator to identify the claim that was missing or invalid, without logging PII.

**The `${claims.sub}@unknown` email fallback is explicitly deferred.**

This is a minor operational anomaly — `@unknown` entries will be anomalous if anything sorts or filters by email domain. It is not a ritual constraint and is not in scope for this change. It is documented here as known technical debt to be addressed separately.

**The facilitator's own first-access path is out of scope for this feature, and that is correct.**

A facilitator who signs in for the first time also has no team memberships and also lands on the no-team page. This is correct behavior — a facilitator is not automatically given teams at account creation, any more than a participant is. The facilitator's path from no-team to having a team they can facilitate is handled by team creation and session setup workflows. This boundary is intentional. First Access is responsible for account creation and the no-team landing state; it is not responsible for setting up what a facilitator will eventually facilitate. The exploration was silent on this, which the facilitator reviewer correctly flagged as an oversight. The boundary is now stated: facilitator account setup — getting from no-team to a role on a team — is out of scope here and is covered elsewhere.

**A returning user with no team memberships sees the same page as a first-time user. That is the right call.**

If a user who has previously participated in sessions loses all team memberships and signs in, they will see the no-team page. The question is whether the page should acknowledge prior history (e.g., "your previous sessions are still accessible once you rejoin a team") or look identical to the first-access experience.

Devon's position: the page should look identical. The condition is the same — no active team membership — and the next action is the same — obtain a join link. Making a distinction between new users and returning users would require the page to surface account history in a context where the user cannot access any of it. That is more confusing than helpful. A returning facilitator who has lost all team memberships may have facilitated dozens of sessions. Reminding them of that on a page where they can do nothing about it is not a kindness. The message should be accurate, calm, and focused on what to do next. Their history will be there when they rejoin a team. The no-team page is not the place to surface it.

---

## 5. Alignment of Existing Implementation with Intent

### `account-resolver.ts` — Largely aligned, one documented limitation

The implementation matches the spec closely. The upsert keyed on `(oidc_subject, oidc_issuer)` is correct. The display name fallback chain (`name → email → sub`) matches the spec exactly. The email fallback (`${sub}@unknown`) matches. Email is not used for identity matching — only for display and storage.

The one documented limitation: the `isNewUser` flag is determined by a SELECT before the upsert. In a concurrent scenario, two callbacks for the same user could both read `existing.rows.length === 0` and both set `isNewUser = true`. The upsert handles the actual data correctly (one insert, one update), but any downstream consumer of `isNewUser` could fire twice. This is acknowledged as a known limitation and explicitly deferred. Any future work that adds downstream consumers of `isNewUser` must address this before merging.

There is no evidence that email is used anywhere in the identity matching path — confirmed by reading the query.

### `NoTeamPage.tsx` — Aligned in spirit, must be verified at the routing and layout level

The component does what the spec requires: it names the user, states the condition (not yet a member of any team), gives the one instruction (ask your facilitator for a join link), and offers sign-out as the only action. The "No further setup is required on your end" line is good — it addresses the anxiety a new user might have that they're missing a step.

The open question from the original draft is now a confirmed requirement: the router must not wrap this component in a layout shell that includes application navigation. The component itself renders no nav, but if it is rendered inside a `<Layout>` component that includes a sidebar or header, that sidebar will show navigation items that don't apply to a user with no team membership. This must be verified at the routing and layout level. The requirement is not satisfied by the component alone.

The inline styles are a quality note, not a spec concern. The page is simple enough that it works, but it should eventually be consistent with whatever design system the application uses.

### The spec itself — Sound, one gap now closed

The spec is well-written and covers the three requirements clearly: automatic account creation, sub/iss identity matching, and the no-team landing page. The scenarios are specific and testable.

The gap identified in the original draft — the spec does not address the "previously active user with no remaining team memberships" scenario — is now resolved as a requirement: the no-team page is a persistent condition check on live team membership, applied at every sign-in. This must be stated explicitly in the proposal.
