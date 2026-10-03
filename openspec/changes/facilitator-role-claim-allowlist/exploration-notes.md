# Exploration notes: facilitator role-claim allowlist (#235)

**Explorer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-03
**Status:** Exploration only. No proposal, design or tasks yet.

---

## Why this matters to me

Today the tool can't run a real Health Check without someone typing SQL. FR-2.1 [HARD] says only a Facilitator may create a session, and no supported path makes someone a facilitator who is still one after their next sign-in. If the facilitator role only exists through a workaround, teams will find their own workaround. Then the rules I care about stop living in the application and go back to living in my head.

Option A, where the IdP owns `global_role`, is the right call. It keeps one writer for one column. It also means the application never offers an "assign facilitator" button that could someday be used to promote a manager.

---

## What the code actually does today

| Area | Finding |
|---|---|
| Allowlist | `packages/backend/src/auth/account-resolver.ts:52-56`: `PERMITTED_GLOBAL_ROLES = {engineer, engineering_manager, application_admin}`. Everything else falls back to `engineer` with a warning (`:79-90`). |
| Upsert | `account-resolver.ts:146`: `global_role = EXCLUDED.global_role`, applied on every sign-in. `previous_global_role` is captured through the `prior` CTE (`:137-150`). |
| Claim coercion | `account-resolver.ts:83`: `String(rawClaimValue)`. A one-element array `["facilitator"]` becomes `"facilitator"` and passes. A two-element array becomes `"a,b"` and is rejected. |
| DB enum | `packages/backend/migrations/1_create_enums.sql`: `user_role` already contains `senior_engineer` and `facilitator`. No migration needed. |
| Shared type | `packages/shared/src/types/user.ts:3` already lists `senior_engineer`. |
| Sign-in audit (DB row) | `packages/backend/src/routes/auth.ts:320-352`: `first_access_created` if new, **else if `globalRole !== "engineer"`** then `role_claim_mapped`. |
| Sign-in audit (log) | `routes/auth.ts:362-387`: same gating. |
| Session creation gate | `routes/facilitator-sessions.ts:316-363`: `global_role !== 'facilitator'` returns 403. `is_member` (active membership on that team) returns 403 with an audit row. |
| Topic admin gate | `auth/standing-facilitator-access-helper.ts:34-45, 104-116`: facilitator or admin. A facilitator who is a team member gets `FACILITATOR_IS_TEAM_MEMBER`. |
| Live role re-checks | `facilitator-sessions.ts:528-561, 846-860` re-read `users.global_role` live. A demotion takes effect at these points once the DB row changes, which only happens at the next sign-in. |
| Session payload | `routes/auth.ts:742`: `canFacilitateSessions: user.global_role === "facilitator"`, read live on every `/auth/session`. |
| No-manager rule | `auth/session-subscriber-access-helper.ts:147-166`: participation is denied if **either** `global_role` **or** `team_memberships.role` is `engineering_manager`. |
| Phantom EM | `auth/team-content-access-helper.ts:150-175` (Decision E): a membership with role EM and a `global_role` other than EM drops to `participant` and is logged only. |
| Literal `'engineer'` checks | Only the two audit-gating branches in `routes/auth.ts:336, 374` and the default in `account-resolver.ts`. Nothing else assumes the three-value set. Frontend reads only `canFacilitateSessions`. |

---

## Finding 1 (blocking for the acceptance criteria): demotion is not audited

The issue and the deferral doc both say "Demotion and audit free via `auth.role_claim_mapped`". **That is not true today.**

- `routes/auth.ts:336` and `:374` fire `role_claim_mapped` only when the **new** role is not `engineer`.
- Removing the facilitator claim maps the user to `engineer`, so no row and no log are written.
- This is specified behaviour, not a bug: `openspec/specs/auth-error-handling/spec.md:215-217`, "Reversion to the default role is not represented by this requirement … visible only as an absence of subsequent `role_claim_mapped` rows".

The acceptance criterion "auth.role_claim_mapped records facilitator → engineer" therefore **fails** unless the firing condition changes. My suggestion is to fire when `globalRole !== "engineer" OR previousGlobalRole !== globalRole`, which covers any change including demotion. Otherwise the criterion has to be dropped.

From my side this is not optional. "Who stopped being a facilitator, and when" is the record you look for after a session went wrong. This also changes `auth-error-handling` spec req ~185 and the scenario at :215. It also applies to EM and admin demotion, which is a wider behaviour change and should be reviewed as one.

Smaller related point: a returning `senior_engineer` (non-default) will now write a `role_claim_mapped` row on **every** sign-in. That is consistent with how EM and admin behave today, but it adds audit volume for a role with no privileges.

## Finding 2: the facilitator-from-another-team rule is approximated as "not a member"

The structural check is "no active `team_memberships` row on this team" (`facilitator-sessions.ts:342`, `standing-facilitator-access-helper.ts:112`). It is a hard block, which I'm glad to see. But it does not know about reporting lines.

Now that `facilitator` can really be assigned, an IdP admin can give it to someone who manages people. Since the claim holds a single value, that person **stops** being `engineering_manager`. Then:
- Their TEAM-006 EM membership rows stay in place (first-access spec, "EM role removed" scenario). That keeps `is_member` true for those teams, so they **cannot** facilitate their own teams. Good.
- They **can** facilitate any team where they hold no membership, for example a skip-level team or a sibling team in the same reporting chain. The BRD and `requirements/Summary.md:12` say the facilitator is "not in the team's reporting chain". The application has no model of reporting chains, so this is not new. Real designation does make it easier to reach.
- On their former teams they become "phantom EMs" (`team-content-access-helper.ts:150`) and drop to participant for content. That produces log noise and no security problem. The no-manager participation check still blocks them, because it checks `membership_role` (`session-subscriber-access-helper.ts:159`).

I don't want a code change for this in #235. I do want the **deployment docs** to say plainly: do not assign `facilitator` to people managers, and the IdP role claim is single-valued, so an EM cannot also be a facilitator. Whether a manager-to-facilitator claim change should be flagged is a question for later (see open questions).

## Finding 3: real-IdP claim shape (Entra is primary)

`requirements/Tech Stack Recommendation.md:9,68` names Microsoft Entra as the primary IdP. Entra app roles arrive as a `roles` **array** claim. With `OIDC_ROLE_CLAIM=roles`:
- A user with exactly one app role (`["facilitator"]`) works by accident, because `String()` coerces the one-element array.
- A user with two app roles (for example `senior_engineer` and `facilitator`) is rejected and silently gets `engineer`, with only a warning logged.

The deployment docs must say "assign exactly one app role per user". Better still, the code should handle an array explicitly instead of depending on `String()`. Today `docs/deployment.md` doesn't mention `OIDC_ROLE_CLAIM` or role claims at all. That whole section needs writing, not just a facilitator line.

## Finding 4: demotion latency

A facilitator removed in the IdP stays a facilitator until their next sign-in. Their existing app session keeps `canFacilitateSessions` true, because it reads the DB row and the row only changes at sign-in. This is the same as EM and admin today and is acceptable. The docs should state it: "role changes take effect at next sign-in; revoke sessions if it must be immediate."

---

## Local dev and docs surface (all mechanical)

- `docker/oidc/accounts.js:1-20`: add `role: "facilitator"` to `facilitator-001` and rewrite the header comment. `server.js:82-87` already passes `account.role` through, so only the comment changes.
- `routes/auth.ts:48`: `seeded: false` becomes `true`. After this, **no** option is unseeded, so the frontend's unseeded-caveat branch is dead in practice. Keep it, but the test fixtures need updating: `routes/__tests__/auth.test.ts:282`, `frontend/src/pages/__tests__/DevLoginPage.test.tsx:8`, possibly `docker/oidc/__tests__/interactions.test.js`.
- `docs/local-development.md:105, 114, 118`: the persona-page caveat, the test-accounts row, and the role-claim paragraph.
- `docs/test-scripts/topic-add-form-hands-on-check.md:46` ("Order matters"), `:62-63` (promote), `:205` (re-run note), `:240` (cleanup reset to engineer). The "sign in once first" step (:42-44) is still needed because the users row has to exist before the fixture inserts. Only the promotion goes away.
- `openspec/specs/local-dev-environment/spec.md:27, 47-49`: currently **requires** facilitator-001 to have no claim. Needs a MODIFIED requirement plus a scenario rewrite.
- `openspec/specs/persona-login/spec.md:10, 54`: the wording assumes one unseeded option. Only lightly affected; check.
- `openspec/specs/first-access/spec.md:137` (allowlist), `:142-146` (audit plus "only the IdP can cause…", which is worded for EM). Generalise to facilitator. Add scenarios for facilitator and senior_engineer.
- `account-resolver.test.ts:294`: the allowlist-rejection test uses `superuser`, which is still valid. Add a test that goes through `resolveOrCreateAccount` for facilitator persistence and demotion.

## What could go wrong if the design drifts

- **Someone adds an "admin can toggle facilitator" endpoint "just for convenience"** and so brings back Option B's two-writer problem. The deferral doc keeps it alive as a "possible later convenience". I'd rather it said "only if an IdP cannot send custom claims".
- **Allowlist widened casually.** Each value added is a privilege grant decided by whoever runs the IdP. `facilitator` is privileged: it creates sessions and edits standing topics. The spec should say so, and adding to the allowlist should require a spec change.
- **"Not a member" is read as the full rule.** Finding 2. If a future change auto-adds the creating facilitator as a team member, the check flips meaning. `facilitator-sessions.ts:514` explicitly avoids this today, and that should stay.
- **The audit gap ships unnoticed** because the issue text says it is "free". Finding 1.

---

## Open questions

1. **Demotion audit (Finding 1):** do we change the `role_claim_mapped` firing condition to "role changed or non-default" (my preference) and amend `auth-error-handling`? Or do we relax the #235 acceptance criterion? This applies to EM and admin too.
2. **Array claims:** handle `string[]` explicitly (accept if exactly one allowlisted value, or pick the highest-privilege one?), or document "single value only"? Multi-role users on Entra are realistic, for example senior_engineer plus facilitator.
3. **What is `senior_engineer` for?** It has no privileges in code. It is mentioned only in `team-content-access` spec:289 as equivalent to engineer. If it has no meaning, should we allowlist it at all, or should the spec state "allowlisted, no privileges beyond engineer"?
4. **Manager reassigned to facilitator:** is a deployment-docs warning enough, or should a sign-in that changes `engineering_manager` to `facilitator` produce a distinct audit or alert signal? I lean toward docs now and a follow-up issue later.
5. **Cross-team local fixtures:** local-development.md:114 notes a single identity can't exercise cross-team facilitation. Out of scope for #235, but should facilitator-001 belong to no team by default? It does today, and that is good.
6. **`openspec validate --strict`:** confirm that this change directory, which holds only notes so far, doesn't fail validation before a proposal exists.
