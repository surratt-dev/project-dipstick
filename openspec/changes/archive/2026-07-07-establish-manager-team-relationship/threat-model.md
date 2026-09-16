# Threat Model: TEAM-006 / Establish Manager-Team Relationship

**Author:** Tomás Ferreira, Senior Application Security Analyst
**Status:** Phase 0 deliverable per tasks.md task 1.6
**Scope:** `POST /api/v1/teams/:teamId/managers` (TEAM-006), the `global_role = 'engineering_manager'` assignment mechanism, and the Phase 3 EM-facing read endpoints (SESSION-007/008, TREND-001/002, ACTION-004/005) that TEAM-006 unlocks.
**Method:** Attack-tree analysis per required scenario, verified against the implementation as of this branch (not against design.md's stated intentions). File and line references are given wherever a claim depends on code, not prose.

This document satisfies task 1.6's four required scenarios plus the explicitly-requested Decision 13 inference-risk writeup. It does not relitigate decisions already made in design.md — where I disagree with an accepted tradeoff I say so once, in the relevant section, and move on.

---

## Scenario 1: TEAM-006 as an Access Escalation Vector

**Question:** Can a non-admin actor reach the effect of TEAM-006 — granting EM read access over a team's history — through a flawed authorization check, a race condition, or an adjacent endpoint?

### Attack path 1.1 — Direct authorization bypass on TEAM-006

`teams.ts:654-680` gates the endpoint on a single DB read of `users.global_role`, requiring `application_admin`. This is not the cookie, not a JWT claim, not session state — it is a live per-request read, consistent with Decision 3's Redis prohibition and the pattern used everywhere else in this codebase (`checkAssignRolesAuthorization`, `evaluateTeamAccess`). There is no client-supplied parameter that influences this check.

**Existing mitigation:** Per-request DB authorization check with no cacheable/forgeable input.
**Residual risk:** Low. The only way to defeat this check is to actually be, or compromise, an `application_admin` account — which is Scenario 2, not this one.

### Attack path 1.2 — Adjacent-endpoint substitution (TEAM-005 misuse)

The obvious adjacent attack: can an EM or admin achieve TEAM-006's effect through TEAM-005 (`PATCH /api/v1/teams/:teamId/members/:userId/role`), which has a *lower* bar — any Application Admin or any EM already on the target team can call it (`teams.ts:30-64`)?

Verified: TEAM-005 operates only on rows in `team_memberships` where the subject `user_id` is already an **active member** of the team (`teams.ts:447-457`, the `subjectCheckResult` query requires an existing `team_memberships` row with `removed_at IS NULL`). A user who has never been a team member returns 404 (`teams.ts:459-467`) and TEAM-005 cannot create the row. Critically, TEAM-005 also never checks or writes `users.global_role` (explicitly documented at `teams.ts:380-386, 550-553`) — so even in the case TEAM-005 *can* reach (an existing participant flipped to `role = 'engineering_manager'` on the membership row), the resulting user does not necessarily have `global_role = 'engineering_manager'`. That matters because `evaluateTeamAccess` (`team-content-access-helper.ts:134-141`) grants EM-serialization treatment based on `team_memberships.role` alone, *not* `global_role` — see attack path 1.3 below, which is the sharper version of this concern.

**Existing mitigation:** TEAM-005 requires pre-existing membership; cannot originate an EM relationship for a stranger to the team the way TEAM-006 can.
**Residual risk:** Low for "TEAM-005 as a TEAM-006 substitute" in the literal sense (can't onboard a brand-new EM this way). But see 1.3 — the underlying assumption that `team_memberships.role = 'engineering_manager'` implies a *legitimately established* EM relationship is weaker than the design doc implies once you look at what actually gates Phase 3 data access.

### Attack path 1.3 — Data-plane authorization keyed on the wrong column (real gap)

This is the most important finding in this scenario. Decision 14 mandates that the `global_role` check and the `team_memberships.role` check remain **independent, dual** controls specifically to avoid a single point of failure. I read `evaluateTeamAccess` expecting to find both checks. I did not find them.

`team-content-access-helper.ts:134-141`:
```
if (membership_role !== null) {
  return {
    path: "member",
    role: membership_role as "participant" | "engineering_manager",
    teamId,
    actorGlobalRole: global_role,
  };
}
```
This path returns an `engineering_manager` grant **purely from `team_memberships.role`**, without checking that `users.global_role === 'engineering_manager'`. The comment block above it (`team-content-access-helper.ts:124-132`) even states the intended design explicitly: *"A user with global_role = 'engineer' but membership_role = 'engineering_manager' receives the EM content profile... the membership role governs, not the global role."*

That comment is describing exactly the single point of failure Decision 14 was written to prevent — and it is not a hypothetical. Walk the consequence through: TEAM-005 **can** set `team_memberships.role = 'engineering_manager'` for an existing participant (`teams.ts:406-599`), and TEAM-005's authorization for that action is available to any Application Admin *or any EM already on that team* (Decision 3's Q1 resolution, `checkAssignRolesAuthorization`). TEAM-005 does not check or require the target user to have `global_role = 'engineering_manager'` — by explicit design (`teams.ts:380-386`).

So the actual reachable path is:
1. An EM who is legitimately associated with Team A (via a prior, properly-gated TEAM-006 call) uses their TEAM-005 authorization on Team A to flip a Team A **participant** — including, notably, themselves if self-service role assignment isn't blocked, or a colluding second account that is already a Team A participant — to `team_memberships.role = 'engineering_manager'`.
2. That target account's `global_role` is never touched. It can remain `'engineer'`.
3. `evaluateTeamAccess` grants that account the full EM content profile for Team A — aggregate session history, trends, action items — via `em-views.ts`'s `grant.path === "member" && grant.role === "engineering_manager"` check (e.g. `em-views.ts:106`).
4. **TEAM-006 was never called.** The Application Admin gate, the `global_role` precondition (Decision 2/3), the atomic audit write on TEAM-006 (Decision 9), and the rate limiting the design doc requires on TEAM-006 (Decision 6 risk register, task 3.10) are all bypassed entirely, because the access-granting write happened through TEAM-005, and the access-*checking* read (`evaluateTeamAccess`) only looks at the membership table.

This is not a theoretical edge case reachable only by a compromised admin — it is reachable by **any EM in good standing on a single team**, using an endpoint (TEAM-005) that was explicitly designed for role changes among *existing* team members and was never intended to be an EM-grant mechanism. It converts "Application Admin only" (Decision 1) into "any EM on the team, for that team" for the specific purpose of unlocking Phase 3 read access, and it does so with **no corresponding audit event** naming it as an EM-establishment action — the audit trail records `team.role_changed`, not `team.manager_established`, so an incident responder searching `audit_log` for `operation = 'team.manager_established'` (the control TEAM-006 was supposed to be the sole producer of) will not find this path.

**Precondition, stated plainly next to the severity rating below:** the exploiting actor is not an arbitrary participant. They must already be a legitimately-established EM on the target team — i.e., someone who was themselves correctly onboarded via a prior, properly-gated TEAM-006 call, holding both `global_role = 'engineering_manager'` and `team_memberships.role = 'engineering_manager'` on that team (per `checkAssignRolesAuthorization`'s own AND-check, `teams.ts:58-61`). This does not lower the severity — the harm (a second, ungoverned, unaudited EM grant on the same team) doesn't depend on the actor being anonymous or unprivileged, only on them holding EM rather than Admin authority for that team, which is exactly the distinction Decision 1 exists to enforce. But it does mean this is "EM does something an EM can already partially do, in an ungoverned way" rather than "arbitrary engineer self-escalates" — worth having precisely in view when scoping the fix and when explaining this finding to anyone outside the review.

I want to be precise about what this is and is not. It is **not** an escalation to `application_admin`, and it does not cross team boundaries — the affected team is whichever team the acting EM already has legitimate membership on. It **is** a working bypass of the Decision 1 governance requirement ("this is a deliberate, audited action... not something a passing [non-admin] can perform without institutional accountability") for that team, achievable by exactly the class of actor — an EM — that Decision 1's rationale was written to exclude from unilateral grant authority.

**Existing mitigation:** None at the authorization-check layer. TEAM-006's own gate is sound (path 1.1); the gap is that a second, less-guarded write path (TEAM-005) feeds the same read path (`evaluateTeamAccess`) that Phase 3 endpoints trust.
**Residual risk: HIGH** (precondition: exploiting actor must already be a legitimately-established EM on the target team via a prior correct TEAM-006 call — see the callout above; this narrows *who* can pull the trigger, not *how bad* pulling it is). This is a gap requiring action, not an accepted risk — it directly contradicts Decision 14's stated purpose and Decision 1's authorized-actor restriction, in the actual shipped code, not just in a hypothetical future change.

**Recommended mitigation:** `evaluateTeamAccess`'s member path must require `membership_role === 'engineering_manager' AND global_role === 'engineering_manager'` before returning an EM grant (this *is* what Decision 14 says the two checks are for). If a team member has `membership_role = 'engineering_manager'` without `global_role = 'engineering_manager'`, that is a data-integrity anomaly the system should either reject (403, distinguishable in logs) or treat as `path: 'member', role: 'participant'` — not silently upgrade to full EM read access. This closes the read side and is necessary regardless of anything else.

**On whether that read-side fix is sufficient by itself — verified against a specific follow-up question, and it is not.** I checked whether TEAM-005's authorization is itself cross-team-exploitable — i.e., whether an EM of a *different* team (Team B) could invoke TEAM-005 against Team A at all, which would be a second, independent way into this same gap. It cannot: `checkAssignRolesAuthorization` (`teams.ts:30-64`) joins `team_memberships` on `tm.team_id = $2`, the specific team named in the URL being modified, so the `membership_role` used in that authorization decision reflects only the actor's own membership on *that* team. An actor whose only EM standing is on Team B gets `membership_role = NULL` when the target team is Team A and is correctly refused (403) unless they are an Application Admin. TEAM-005's actor-side authorization is properly team-scoped — this is not a gap.

However, a related bypass is real on the **target** side, through a different mechanism than actor scoping: `global_role` is a *global*, not team-scoped, attribute — Decision 2 sets it once per user from the IdP claim, independent of any team association. A person can legitimately hold `global_role = 'engineering_manager'` because they are a properly-established EM of Team B, while simultaneously being an ordinary `participant` on Team A. Under the read-side fix alone, an existing Team-A EM can still call TEAM-005 to flip that specific person's Team-A `membership_role` to `'engineering_manager'` — at that point *both* halves of the AND-check pass (`global_role` was already `'engineering_manager'` from their legitimate Team B standing; `membership_role` is now `'engineering_manager'` on Team A too), `evaluateTeamAccess` grants full EM read access to Team A, and **TEAM-006 was still never called for Team A.** No Application Admin decision and no `team.manager_established` record exist for that specific team-EM relationship. The read-side fix closes the common case (target's `global_role` is the default `'engineer'`) but not this narrower one, where the target already independently carries the EM global role for reasons that have nothing to do with Team A.

**Conclusion: both fixes are required, and neither is optional hygiene.** TEAM-005 must never be permitted to write `team_memberships.role = 'engineering_manager'` for *any* team, full stop — regardless of what the target's `global_role` already is, and regardless of which team the actor calling TEAM-005 is legitimately an EM of. Originating an EM membership row is TEAM-006's exclusive function; TEAM-005 should be restricted to transitions that do not create a new EM relationship for a team it didn't already have one on (demoting an existing team-EM back to `participant` is fine and stays in TEAM-005's remit; promoting anyone — including someone who is already an EM elsewhere — to `engineering_manager` on a team they weren't already EM of is not, by any actor other than TEAM-006, ever). With this restriction in place alongside the `evaluateTeamAccess` AND-check, the two fixes are both load-bearing: the write-side restriction prevents the state from being created at all, and the read-side AND-check remains the correct backstop Decision 14 calls for if a future write path (a migration, an admin bulk-edit tool, a change nobody has proposed yet) ever creates the mismatched state some other way.

### Attack path 1.4 — Race condition on TEAM-006 itself

Decision 3's `xmax`-based upsert (`teams.ts:774-785`) is implemented correctly and does eliminate the SELECT-before-INSERT race the design doc describes. Two concurrent TEAM-006 calls for the same `(user, team)` resolve to one row with correct 201/200 semantics; I traced the `ON CONFLICT ... DO UPDATE ... RETURNING (xmax = 0)` pattern and it matches the documented idiom exactly, with the required partial unique constraint present (`migrations/7_team_memberships_partial_constraint.sql`, confirmed via `2a.1`/task list).

**Residual risk:** Low. No exploitable race found here.

---

## Scenario 2: EM Account Compromise

**Question:** What does an attacker holding a legitimate EM's credentials/session gain, given Decision 6's undated historical access — and which of the compensating controls the design doc names (OIDC token validation, session revocation, EM account monitoring) actually exist in this codebase today?

### What compromise yields

Per Decision 6, a compromised EM session/credential yields read access (via SESSION-007/008, TREND-001/002, ACTION-004/005) to:
- The **full, undated session history** of every team the EM is associated with — no lookback window (verified: `em-views.ts:147-161` has no date filter beyond `s.status = 'complete'`; `em-views.ts:289-290` test explicitly asserts no `association_date`/`manager_associated_at` filtering is present).
- Aggregate vote distributions per topic per session (not individual votes — see Scenario 4/Decision 5 for why that boundary holds).
- Full action item text, status, and **assignee display name** (Decision 13 — not attribution-boundary-protected, by design).
- Facilitator names, session dates, participant counts.

It does **not** yield: live session access (blocked by `evaluateSessionSubscriberAccess`'s explicit EM exclusion, `session-subscriber-access-helper.ts:159-160`), write access to any of the above (403 write-rejection, task 5.7), or cross-team access beyond teams the compromised account is actually associated with (`evaluateTeamAccess` is scoped per-`teamId`; confirmed by task 5.10's test).

### Verifying the named compensating controls against actual code

The design doc names three mitigating controls for the accepted Decision 6 risk. I checked each:

**1. OIDC token validation** — **Present and adequate.** The OIDC integration uses `openid-client` (`oidc-client.ts`), a maintained, spec-compliant library, for the authorization code + PKCE flow. Signature verification, issuer/audience checks, and nonce/state validation are handled by the library's `authorizationCodeGrant()` and are not hand-rolled (`oidc-client.ts:44-60`; `auth.ts:113-119` passes `expectedNonce`/`expectedState`/`pkceCodeVerifier`). This is the "secure default that doesn't require developer discipline" pattern I look for, and it's what's actually here — not a documented aspiration.

**2. Session revocation at the IdP** — **Present, and better than the design doc implies.** `middleware.ts`'s `refreshSessionTokens` distinguishes an `invalid_grant` response from the IdP (interpreted as revocation, `middleware.ts:89-103`) from a transient failure, and destroys the session with an `auth.session_invalidated` audit event carrying `reason: "token_revoked"` when revocation is detected. This runs on every request once the access token is within 5 minutes of expiry (`TOKEN_REFRESH_THRESHOLD_S`), and there is a hard 90-minute absolute session lifetime independent of activity (`ABSOLUTE_LIFETIME_MS`, `middleware.ts:16, 134-146`) that forces re-authentication — and therefore re-evaluation of the IdP role claim per Decision 2's requirement 5 — regardless of whether the IdP session was explicitly revoked. **Caveat:** revocation detection depends on the token endpoint returning `invalid_grant` promptly, which is an IdP-side behavior this codebase cannot control or verify independently; it also depends on the refresh-token flow actually running before the access token would otherwise still validate — an attacker holding a *stolen valid access token* with plenty of remaining lifetime is not immediately evicted just because an admin revoked the user at the IdP a moment ago. The 5-minute refresh threshold and 90-minute absolute cap bound this exposure window; they do not eliminate it.

**3. EM account monitoring** — **Not present as a control; the audit trail exists, but nothing consumes it.** Every EM data-access endpoint writes an `audit_log` row and emits a structured `em.*` log event (`em-views.ts`, verified across all six handlers). That is necessary but not sufficient for "monitoring": I found no alerting rule, no anomaly-detection job, and no dashboard definition anywhere in this repository that reads `audit_log` or the `em.*` log stream and flags unusual EM access patterns (e.g., an EM account suddenly pulling full history for a team it was just associated with, or accessing at an hour/volume inconsistent with normal usage). The audit *substrate* is real and well-built; the *monitoring* the design doc credits as a compensating control does not exist in this codebase and is not referenced by any CI/deploy config I found. This is an operational gap, not a code gap — it likely lives outside this repository (SIEM rules, etc.) — but the design doc's Decision 6 explicitly names it as a mitigating control for an accepted risk, and I cannot verify it is implemented anywhere. It should not be marked "mitigated" in the findings table below without someone confirming where that monitoring lives.

**Existing mitigation:** Strong token validation (library-backed), functioning session/token revocation with a bounded exposure window, comprehensive audit logging.
**Gap:** "EM account monitoring" is asserted as a control but has no verifiable implementation in this codebase or referenced elsewhere. Audit logs that nobody/nothing reads are a forensic aid after the fact, not a detective control.
**Residual risk:** Medium. The blast radius (quantified below, Scenario 4) is real and accepted; the third named compensating control is currently aspirational.

---

## Scenario 3: IdP Claim Manipulation (Decision 2)

**Question:** Attack paths against the role-claim-to-`global_role` mapping — forged/replayed claims, unsigned userinfo data, missing allowlist validation, claim injection. Verify the five Decision 2 requirements are actually implemented, not just specified.

I checked each of the five requirements against `account-resolver.ts` and `auth.ts` line by line:

| # | Requirement | Implemented? | Evidence |
|---|---|---|---|
| 1 | Claim name is configuration, not hardcoded | **Yes** | `account-resolver.ts:38`: `const ROLE_CLAIM_NAME = config.OIDC_ROLE_CLAIM ?? "role";`. `config.ts` requires `OIDC_ROLE_CLAIM` as a recognized config key. |
| 2 | Read from signed ID token only, never userinfo | **Yes** | `auth.ts:128`: `const claims = tokens.claims();` — `openid-client`'s `.claims()` accessor returns the verified ID token claims, not a userinfo fetch. No call to a userinfo endpoint appears anywhere in `oidc-client.ts` or `auth.ts`. The full claims object (minus `sub`/`iss`/`name`/`email`, which are pulled out explicitly) is spread into what's passed to `resolveOrCreateAccount` (`auth.ts:144-157`) — all still sourced from the same signed token object. |
| 3 | Absent claim → default role, not an error | **Yes** | `account-resolver.ts:68-70`: `if (rawClaimValue === undefined \|\| rawClaimValue === null) return DEFAULT_GLOBAL_ROLE;` |
| 4 | Allowlist validation, rejected values logged not silently mapped | **Yes, with a wording nuance worth flagging** | `account-resolver.ts:44-48` defines `PERMITTED_GLOBAL_ROLES`; `74-83` rejects any value not in the set, logs a warning via the passed-in logger, and falls back to default. The Decision 2 text says a rejected value "must be rejected with a logged warning... not silently mapped or silently ignored" — the implementation logs a warning (satisfies "not silently ignored" in the sense that an operator *can* see it happened) but does treat the rejection outcome identically to an absent claim, i.e., the user proceeds with the default role rather than the authentication being blocked. I read the design doc's intent as "don't let garbage silently become an EM," which this satisfies — a rejected claim can never produce `engineering_manager`. It does not read as "must abort authentication," and I don't think it needs to. No issue here; noting the distinction so a future reader doesn't mistake "warning logged" for "request blocked" and expect different behavior. |
| 5 | Re-evaluated on every authentication | **Yes** | `account-resolver.ts:118-131`: `global_role` is included in the `INSERT ... ON CONFLICT DO UPDATE SET ... global_role = EXCLUDED.global_role` upsert, executed on every sign-in (initial and, per `middleware.ts`'s refresh-triggers-reauthentication-at-90-minutes design, effectively bounded re-evaluation on long sessions too — though a pure token *refresh* does not re-run `resolveOrCreateAccount`; only a fresh `/auth/callback` does, which is the correct reading of "each authentication," not "each refresh"). |

**All five requirements are genuinely implemented**, not just documented — this is one of the stronger findings in this review. I want to call out two secondary observations that are good practice, unprompted by the design doc:

- The rejected-claim-value log deliberately excludes the raw claim value from the message (`account-resolver.ts:75-81`, comment explains this is to prevent attacker-controlled strings from polluting audit-adjacent logs) — this is the kind of defensive habit I'd otherwise have to ask for.
- `auth.ts:121-137` rejects authentication outright (before any DB write) if `sub` or `iss` is missing from the verified claims, closing an identity-confusion risk (empty-string key collision) that has nothing to do with Decision 2 directly but sits in the same code path and is worth noting as adjacent hardening.

### Residual attack surface not covered by the five requirements

- **Claim value collision/spoofing at the IdP itself** is out of this application's control by construction (Option A's whole premise is trusting the IdP as authoritative) — this is an accepted boundary, not a code gap. If the IdP's own claim-issuance process can be tricked into emitting `engineering_manager` for the wrong user, no application-layer control here defends against that; it's an IdP-side finding, not a Dipstick finding.
- **`config.OIDC_ROLE_CLAIM` misconfiguration** (e.g., pointed at a claim the IdP does not actually sign, or a claim the IdP allows arbitrary self-service users to set on themselves) is a deployment-configuration risk, not a code defect — the code does exactly what a correct configuration asks of it. This belongs in a deployment checklist, not this document, but I'd want it verified once per environment as part of the go-live gate.

**Residual risk:** Low. The implementation matches the specification precisely for what's in this codebase's control.

---

## Scenario 4: Retroactive Historical Data Exposure Under Decision 6

**Question:** Quantify the blast radius of undated historical access.

### Quantification

For any team a compromised (or malicious) EM account is associated with, TEAM-006 grants — and SESSION-007/SESSION-008/TREND-001/TREND-002 serve, with no date filter (`em-views.ts:147-161`, confirmed by the explicit no-date-boundary test at `em-views.test.ts:289-290`) — the **entirety** of that team's `status = 'complete'` session history:

- Every session's date, session number, facilitator name, and participant count.
- Every topic discussed in every session, with the full aggregate vote distribution (not individual votes) and outlier flag per topic.
- Every action item ever created for that team, including full title/description text and the assignee's display name (Decision 13), regardless of age or whether the assigning session predates the EM's association.

**Formula:** for a team with *N* completed sessions since inception and *T* average topics per session, a single compromised EM credential exposes *N × T* topic-level vote-distribution records and the complete action-item history, for every team that EM is associated with — with no per-session or per-topic access boundary once team-level EM access is granted. For a team with three years of biweekly sessions (design doc's own example), that's on the order of ~75 sessions' worth of aggregate health data and every action item the team has ever logged, in one API call sequence, the moment a single credential is compromised. For an EM associated with multiple teams (permitted; Decision 6 doesn't scope by count of teams), the exposure multiplies by team count — there is no per-EM cap on the number of teams that can be associated via repeated TEAM-006 calls, and (see Scenario 1 finding 3.10 status below) no rate limit currently constrains how many TEAM-006 calls a compromised **admin** account could issue in sequence to expand that blast radius further before detection.

### What is *not* exposed, and why that matters for the quantification

The blast radius is bounded to aggregate/statistical data and action item metadata — not individual vote values (Decision 5's boundary holds; verified in Scenario-adjacent code review of `em-views.ts` and its tests). This is the load-bearing fact that makes Decision 6's tradeoff defensible at all: the "full historical archive" an attacker gets is a historical *trend* archive, not a historical *individual performance* archive. If Decision 5's boundary were ever weakened, Decision 6's accepted risk would need to be re-litigated immediately — the two decisions' risk profiles are coupled, not independent, and I'd want that coupling stated explicitly somewhere durable (this document, now).

**Existing mitigation:** Decision 5's attribution boundary caps the *sensitivity* of what's exposed per record even though it does not cap the *volume*. Task 3.10 (rate limiting on TEAM-006) would cap how fast a compromised **admin** account could expand the number of teams exposed, but per Scenario 1's finding, **task 3.10 is not implemented** (confirmed: no rate-limiting plugin registered in `app.ts`, no `@fastify/rate-limit` dependency, no rate-limit test in `teams.test.ts`) — this is listed in tasks.md as blocked pending a Q6 threshold decision from BA/security, and it is genuinely still open, not a documentation lag.
**Residual risk:** This is Decision 6's accepted organizational risk, and I am not relitigating that decision — the org has weighed trend-context value against this exposure and decided in favor of the former. What I am flagging as **not yet accepted-and-closed** is the compensating control (task 3.10 rate limiting) that the design doc's own risk register (design.md, "Bulk TEAM-006 calls under compromised admin account") names as the required mitigation for the *admin-side* amplifier on this same blast radius. That control does not exist yet.

---

## Named Section: Action Item Inference Risk (Decision 13) — Accepted, Not a Boundary Violation

This section exists because tasks.md task 1.6 explicitly requires the threat model to name this risk, and because Decision 13 explicitly directs that it be framed correctly. I want to be unambiguous about the framing before describing the mechanics: **this is a known, accepted inference path that the design review already weighed and decided to accept. It is not a bug, it is not an oversight, and I am not recommending it be closed.** My job here is to document it precisely enough that a future reviewer — possibly me, eighteen months from now, looking at an incident that turns out to be nothing — understands that this exact scenario was considered and knowingly accepted, so it doesn't get rediscovered and treated as a new finding.

### The mechanics

Decision 13 makes action item body text (title, description) and assignee display name fully visible to EMs via ACTION-004/ACTION-005 (`em-views.ts:798-833`, `owner_display_name` joined and returned as `ownerDisplayName` without restriction). Decision 5's attribution boundary, by contrast, prohibits any EM-facing view from connecting a specific vote value to the participant who cast it — enforced at the query level (no `voter_id` ever selected) and verified by CI tests (`em-views.test.ts`, confirmed present and correctly scoped).

These two decisions do not contradict each other, but they sit close enough together that a **human reasoning about the two data sets together** can walk an inference path Decision 5's technical boundary does not and cannot block:

1. An EM sees, via SESSION-007/008, that a specific topic in a specific session scored poorly (aggregate distribution skewed low, or flagged for discussion) — this is explicitly permitted data (Decision 5 constraint: aggregate displays and outlier-presence flags are fine).
2. The same EM sees, via ACTION-004/005, that a specific named engineer was assigned an action item created in connection with that session, on a topic that maps to the poorly-scoring one — this is explicitly permitted data (Decision 13).
3. On a small team, the EM may reasonably infer that the assigned engineer was involved in, or is representative of, the negative sentiment behind the topic's score — without ever seeing that engineer's individual vote value, because the vote value was never disclosed in the first place.

### Why this is inference, not exposure

The critical technical distinction — and the reason Decision 13's framing as "not a boundary violation" is correct, not just diplomatically convenient — is that **no system component discloses, computes, or implies a per-participant vote value at any point in this chain.** The EM's conclusion in step 3 is a human judgment made by correlating two independently-legitimate, independently-decided-to-be-visible facts. It is exactly the same category of inference a facilitator or any team member could draw by simply being present in the room and paying attention — it does not require any technical capability this system grants that a modestly attentive human observer wouldn't already have through ordinary organizational awareness. Closing it technically would require either (a) hiding action item assignee identity from EMs entirely (which Decision 13 explicitly rejected, for good reason — an EM who can't see who owns a follow-up can't meaningfully follow up), or (b) decoupling action items from the topics/sessions that produced them in the EM's view (which would make the action item list nearly useless as a management tool). Both would cost real functionality to close a risk that is fundamentally social/organizational, not technical.

### Where it does and does not apply

The inference is strongest exactly where Decision 13's rationale already acknowledges tension: **small teams**, few action items per session, and topics with obvious 1:1 mapping to a single struggling engineer. On larger teams with more diffuse action-item assignment, the correlation weakens substantially — multiple candidates, multiple topics per session, and no way to tell which action item (if any) is "the" response to which score.

**Severity of this named risk, on its own terms:** Low-to-Moderate, team-size-dependent, and — this is the important qualifier — **already priced into Decision 13's acceptance.** I am not assigning it a residual-risk rating in the findings table below as if it were a gap; it is fully accounted for as an accepted tradeoff. The only actionable item I'd attach to it is process, not code: if this ever surfaces as an actual employee complaint or HR concern, the organization should be able to point to this document and Decision 13 as evidence the tradeoff was deliberate and reviewed, not negligent.

---

## Findings Summary

| # | Scenario | Severity | Status |
|---|---|---|---|
| 1.1 | TEAM-006 direct authorization bypass | — | Mitigated |
| 1.2 | TEAM-005 as a TEAM-006 substitute (new-EM onboarding) | — | Mitigated |
| **1.3** | **`evaluateTeamAccess` grants EM content access from `team_memberships.role` alone, without the `global_role` check Decision 14 requires — reachable via TEAM-005 by any EM already legitimately established on the target team (not an arbitrary participant — see precondition callout in Scenario 1). Closing this fully requires BOTH the `evaluateTeamAccess` AND-check AND restricting TEAM-005 from ever originating an `engineering_manager` membership row for any team — a read-side fix alone leaves a cross-team-EM variant open (see Scenario 1 writeup).** | **High** | **Gap requiring action** |
| 1.4 | TEAM-006 upsert race condition | — | Mitigated |
| 2.1 | OIDC token validation (library-backed) | — | Mitigated |
| 2.2 | Session/token revocation detection and enforcement | Low-Medium (bounded exposure window, IdP-dependent) | Mitigated, with a noted bound |
| **2.3** | **"EM account monitoring" named as a Decision 6 compensating control has no verifiable implementation in this codebase** | **Medium** | **Gap requiring action (or verification that it exists outside this repo)** |
| 3.1–3.5 | Decision 2's five token validation requirements | — | Mitigated (all five verified implemented) |
| 4 | Undated historical access blast radius (Decision 6) | Accepted (org-level) | Accepted risk — but its named compensating control (3.10 rate limiting) is not yet built |
| **3.10** | **Rate limiting on TEAM-006 (Q6) — required by design.md's own risk register as the mitigation for compromised-admin bulk-association abuse** | **Medium-High** | **Gap requiring action (task 3.10 is explicitly blocked/incomplete in tasks.md)** |
| Decision 13 | Action item → vote score inference on small teams | Low-Moderate, accepted | Accepted risk, not a boundary violation |

---

## Recommendation on Phase 2 Production Deployment

**Not yet clear to proceed as currently implemented.** I want to be specific about why, because most of what I reviewed is genuinely good work — the OIDC integration, the attribution boundary enforcement, the audit trail design, and the TEAM-006 endpoint's own authorization and idempotency logic are all implemented correctly and match the design doc's intent, in several places exceeding it (timing-floor defenses against 403/200 oracle attacks, `Cache-Control: no-store` on every EM route, CI tests that assert on the literal absence of voter-identifying JSON keys). This is not a team that skipped the security work.

But finding 1.3 is a real, currently-exploitable gap that undermines the specific governance property (Decision 1: TEAM-006 is Application-Admin-only, deliberately, because EM-grant is "a consequential, indefinite access grant") that this entire threat modeling session exists to protect. It does not require a compromised admin account — it is reachable by any legitimately-associated EM using an endpoint (TEAM-005) that was never supposed to be an EM-grant mechanism, and it leaves no audit trail under the operation name (`team.manager_established`) an investigator would search for. I'd block Phase 2 production deployment on this alone.

Given that block is already required, I'd bundle the following into the same gate rather than doing two review passes:
1. **Fix finding 1.3 — both parts, neither optional.** `evaluateTeamAccess` must require `global_role === 'engineering_manager' AND membership_role === 'engineering_manager'` per Decision 14, **and** TEAM-005 must be prevented from ever originating an `engineering_manager` `team_memberships` row for any team, regardless of the target's existing `global_role`. I initially treated the second half as a nice-to-have companion to the first; on verification it is not — a target who is already a legitimately-established EM of a different team defeats the read-side-only fix, because `global_role` is global and not team-scoped. Both halves are load-bearing. When this ships, I want a regression test that pins exactly this state: an actor who is a correctly-established EM on Team A calls TEAM-005 against a target whose `global_role` is already `'engineering_manager'` (via legitimate EM status on Team B) and who is a `participant` on Team A — the call must not result in that target receiving an EM grant on Team A absent a TEAM-006 call.
2. **Land task 3.10** (TEAM-006 rate limiting) — it's already recognized as blocking in tasks.md; I'm reinforcing that it's a real prerequisite, not a nice-to-have, precisely because Scenario 4's blast-radius math gets worse without it.
3. **Confirm the disposition of "EM account monitoring"** — either point me at where it actually lives (a SIEM rule set, an alerting config outside this repo) so I can verify it, or treat it as not-yet-built and decide whether that changes Decision 6's risk acceptance.

None of the above touches Decision 5, Decision 6, or Decision 13's accepted tradeoffs — those hold up under this review and I'm not asking anyone to revisit them. Once 1 and 2 are closed and 3 is answered, I'm comfortable clearing Phase 2 for production from a security standpoint. I'd want a short follow-up verification pass (not a full re-threat-model) on just those three items before signing off, consistent with my standing position that a threat model is revisited against the implementation, not treated as a one-time artifact.
