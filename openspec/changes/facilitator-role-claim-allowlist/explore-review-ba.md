# BA review of exploration notes: facilitator role-claim allowlist (#235)

**Reviewer:** Marcus Delgado (Business Analyst) · **Date:** 2026-10-03
**Verdict:** The code findings are precise and traceable, good enough to build from. The *decisions* are not yet. Four open questions are still phrased as preferences ("I lean toward", "my preference"). Each needs a SHALL statement and a scenario before it goes into a proposal. Finding 1 blocks the proposal.

## 1. Clarifications needed (decide before the proposal)

| # | Question | Who decides | Why it blocks |
|---|---|---|---|
| C1 | Demotion audit: change the `role_claim_mapped` firing condition (Option X) or narrow the #235 criterion (Option Y)? See §3. | Product + VP Eng (audit policy) | An issue AC currently contradicts a main spec. One of them has to change in this change set. |
| C2 | If X: does it apply to all roles (EM, admin) or only facilitator/senior_engineer? | Product | Exploration says "should be reviewed as one". A proposal needs a scope line, not a review instruction. |
| C3 | Array claims: reject, take the single allowlisted value, or rank by privilege? | Eng + Product | "Pick the highest-privilege one" is a privilege-escalation rule. It needs an explicit ranking or it does not ship. |
| C4 | What does `senior_engineer` mean? | Product | If a role grants nothing, the spec still has to say so. Otherwise someone will read it as a privilege later. |
| C5 | Does the structured log for `role_claim_mapped` gain `previousRole`? (`routes/auth.ts:375-381` omits it today; only the DB row has it.) | Eng | Without it, a demotion log line says "engineer" and gives no hint it was a demotion. |

## 2. Vague areas and suggested concrete wording

- **"Facilitator claim persists across sign-in"** is not testable as written. Rewrite: *GIVEN a returning user whose ID token carries `role=facilitator` and whose `users.global_role` is `facilitator`, WHEN they sign in again, THEN `users.global_role` remains `facilitator` AND `/auth/session` returns `canFacilitateSessions: true`.* Add the first-sign-in variant (new user → `facilitator` plus `first_access_created` with `globalRole: facilitator`).
- **"senior_engineer same"** needs its own scenarios. Do not cover it by analogy. Required: persists on re-sign-in; `canFacilitateSessions: false`; `POST` session create returns 403; topic-admin gate denies it. Suggested requirement text: *`senior_engineer` is an allowlisted, non-privileged role. Every authorization check SHALL treat it identically to `engineer`.*
- **"Local facilitator-001 can create a session without manual SQL"** has an unstated precondition: a team must exist with no membership for facilitator-001. Rewrite: *GIVEN a fresh `docker compose up` with seed data, WHEN facilitator-001 signs in through the persona page and creates a session for a seeded team they are not a member of, THEN the request succeeds with no `psql` step in `docs/local-development.md` or the hands-on test script.* Also state which seeded team the docs use.
- **"Adding to the allowlist should require a spec change"** (drift section) is a process wish, not a requirement. Make it testable: *The allowlist SHALL be exactly the set `{engineer, senior_engineer, facilitator, engineering_manager, application_admin}`*, plus a unit test that asserts set equality. Any widening then fails a test and forces a spec delta.
- **Finding 2, "do not assign facilitator to people managers"**, is a docs-only control. Fine for #235. The proposal should label it **non-goal: reporting-chain enforcement**, cite `requirements/Summary.md:12`, and link a follow-up issue number so it is not lost.
- **Finding 3, "assign exactly one app role per user"**: whatever C3 decides, write the multi-value outcome as a scenario, e.g. *WHEN the role claim is an array with more than one element, THEN the user receives `engineer`, a warning is logged naming the element count (not the values), and no `role_claim_mapped` row reports a privileged role.* "Works by accident via `String()`" is not acceptable as specified behaviour. Either specify the one-element array case or reject it.
- **Finding 4, demotion latency**: carry it as an explicit accepted limitation in the spec, not only in docs. *A role change at the IdP SHALL take effect at the user's next authentication; existing app sessions retain the prior role until then.* Name the revocation mechanism the docs will point operators to. If none exists, say so.
- **"Generalise first-access spec :142-146"**: list the exact constraints. The "audited" and "only the IdP can cause" bullets should name every privileged value (`facilitator`, `engineering_manager`, `application_admin`), not just EM.
- **Open question 6** (validate --strict on a notes-only directory) is a check to run now, not a question. Run it and record the result before the proposal.

## 3. Resolving the demotion-audit conflict (C1)

The conflict: `auth-error-handling/spec.md` scenario "Reversion to the default role is not represented by this requirement" says no row is written on return to `engineer`. #235 AC requires a `facilitator → engineer` row. Both cannot hold.

**Option X: amend the spec (recommended; matches the explorer and the audit intent).** MODIFIED requirement, replacing the reversion scenario:
> For a returning user, `auth.role_claim_mapped` SHALL fire (DB row and post-commit structured log) when the newly mapped `global_role` is not `engineer`, **or** when it differs from `previousRole`. The row's `metadata.previousRole` and `metadata.globalRole` SHALL record both values.
>
> *Scenario: Demotion to the default role is recorded.* GIVEN a returning user with `global_role = facilitator`, WHEN they authenticate with no role claim, THEN `users.global_role = engineer` AND exactly one `audit_log` row with `operation = 'auth.role_claim_mapped'`, `previousRole = 'facilitator'`, `globalRole = 'engineer'` is written in the UPSERT transaction.
>
> *Scenario: Unchanged default role is not recorded.* GIVEN `previousRole = engineer`, WHEN they authenticate as `engineer`, THEN no `role_claim_mapped` row is written.

Add the same demotion scenario for `engineering_manager` and `application_admin` (if C2 = all roles), and for an unallowlisted claim that demotes a facilitator (claim `superuser`, prior role `facilitator` → row with `globalRole = engineer`, claim value not recorded).

**Option Y: keep the spec and narrow the AC.** Rewrite the #235 criterion:
> Removing the facilitator claim results in `users.global_role = engineer` at next sign-in. **No `role_claim_mapped` row is written.** The demotion is detectable only as the last `role_claim_mapped` row with `globalRole = facilitator` being followed by `auth.success` rows whose `actor_global_role = engineer`.

That last clause is the honest consequence: the evidence exists only by inference across rows. I do not recommend Y. "Who stopped being a facilitator, and when" is a direct audit question. Answering it by inference is exactly the gap in the spreadsheet process that this application is supposed to close. Note also that `auth.success.actor_global_role` already records the post-demotion role, so the Y-clause above is a real query, not hand-waving.

Either way, the issue text "demotion and audit free" must be corrected in the proposal's Why section. It is not free.

## 4. Traceability gaps

- Tie the change to FR-2.1 [HARD] by ID in the proposal, and to the deferral doc it supersedes (the "possible later convenience" wording should be amended to "only if an IdP cannot send custom claims", as the explorer suggests).
- Audit volume (senior_engineer rows on every sign-in): record it as an accepted consequence of the existing "non-default fires every sign-in" rule, so it is not reopened in review.
