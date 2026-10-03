# Exploration notes: facilitator role-claim allowlist (#235)

**Explorer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-03 (revised after reviews by Priya Nair and Marcus Delgado)
**Status:** Exploration only. Decisions 4–10 in `decision-log.md` are recorded below and are binding for the proposal.

---

## Why this matters to me

Today the tool can't run a real Health Check without someone typing SQL. FR-2.1 [HARD] says only a Facilitator may create a session, and no supported path makes someone a facilitator who is still one after their next sign-in. If the role only exists through a workaround, teams will invent their own, and the rules go back to living in my head.

Option A, where the IdP owns `global_role`, is the right call: one writer for one column, and no "assign facilitator" button that could someday be used to promote a manager. The deferral doc's "possible later convenience" wording should become "only if an IdP cannot send custom claims".

---

## What the code actually does today

| Area | Finding |
|---|---|
| Allowlist | `auth/account-resolver.ts:52-56`: `{engineer, engineering_manager, application_admin}`. Anything else falls back to `engineer` with a warning (`:79-90`). |
| Upsert | `account-resolver.ts:146` overwrites `global_role` on every sign-in; `previous_global_role` comes from the `prior` CTE (`:137-150`). |
| Claim coercion | `account-resolver.ts:83`: `String(rawClaimValue)`. `["facilitator"]` passes by accident; a two-element array becomes `"a,b"` and is rejected. |
| DB enum / shared type | `migrations/1_create_enums.sql` already has `senior_engineer` and `facilitator`; `shared/src/types/user.ts:3` too. No migration. |
| Sign-in audit | `routes/auth.ts:320-352` (row) and `:362-387` (log): `role_claim_mapped` only when new role `!== "engineer"`. The log line omits `previousRole`. |
| Session creation gate | `routes/facilitator-sessions.ts:316-363`: non-facilitator → 403; active member of the team → 403 + audit row. |
| Topic admin gate | `auth/standing-facilitator-access-helper.ts:34-45, 104-116`: facilitator or admin; member facilitator → `FACILITATOR_IS_TEAM_MEMBER`. |
| Live role re-checks | `facilitator-sessions.ts:528-561, 846-860`, and `canFacilitateSessions` (`routes/auth.ts:742`), read `users.global_role` live, which changes only at sign-in. |
| Session lifetime | `auth/middleware.ts:34`: 90-minute absolute lifetime; token refresh does not re-read the role claim. |
| No-manager rule | `auth/session-subscriber-access-helper.ts:147-166`: participation denied if **either** `global_role` **or** `team_memberships.role` is `engineering_manager`. |
| Phantom EM | `auth/team-content-access-helper.ts:150-175`: EM membership + non-EM `global_role` drops to `participant` for content, logged only. |

---

## Finding 1: demotion was not audited — RESOLVED (Decision 4)

The issue said demotion audit was "free". It was not: `role_claim_mapped` skipped any change *to* `engineer`, and `auth-error-handling/spec.md:215-217` specifies that. **Decision:** fire when the new role ≠ `engineer` **or** differs from the previous role, for all roles (facilitator, EM, admin). The proposal's Why must correct "demotion and audit free".

Spec delta (MODIFIED in `auth-error-handling`, replacing "Reversion … not represented"):
- *Demotion recorded.* GIVEN a returning user with `global_role = facilitator`, WHEN they authenticate with no role claim, THEN `users.global_role = engineer` AND exactly one `auth.role_claim_mapped` row with `previousRole = facilitator`, `globalRole = engineer` is written in the UPSERT transaction.
- *Unchanged default not recorded.* GIVEN `previousRole = engineer`, WHEN they authenticate as `engineer`, THEN no `role_claim_mapped` row.
- Same demotion scenario for `engineering_manager` and `application_admin`, plus a claim of `superuser` demoting a facilitator (row says `engineer`; raw claim never recorded).
- The structured log line SHALL also carry `previousRole` (BA C5). Otherwise a demotion log says "engineer" and nothing more.

Accepted consequence: `senior_engineer` (non-default) writes a row on every sign-in, as EM/admin do today. Not to be reopened in review.

## Finding 2: "from another team" is approximated as "not a member"

The hard block is "no active `team_memberships` row on this team". It knows nothing about reporting lines. A manager given `facilitator` keeps their TEAM-006 EM membership rows, so they still cannot facilitate or participate on those teams. They **can** facilitate a skip-level or sibling team where they hold no membership. `requirements/Summary.md:12` says the facilitator must be "not in the team's reporting chain". The app has never modelled that.

**Decision 9:** docs warning only, no alerting. The proposal labels this **non-goal: reporting-chain enforcement**, cites `Summary.md:12`, and links a follow-up issue. Keep `facilitator-sessions.ts:514`'s refusal to auto-add the creator as a member; doing that would flip the meaning of the check.

## Finding 3: multi-valued claims and precedence — RESOLVED (Decisions 6, 7)

Entra (primary IdP, `Tech Stack Recommendation.md:9,68`) sends `roles` as an array. **Decision:** accept a string or an array. Non-allowlisted elements are ignored with a warning and the raw value is never audited. Among allowlisted values, pick by precedence **application_admin > facilitator > engineering_manager > senior_engineer > engineer**. No `String()` coercion.

Acceptance conditions:
- GIVEN claim `["senior_engineer","facilitator"]`, WHEN the user signs in, THEN `global_role = facilitator`.
- GIVEN claim `["facilitator","engineering_manager"]`, THEN `global_role = facilitator` (see below).
- GIVEN claim `["superuser","facilitator"]`, THEN `global_role = facilitator`, a warning logs the count of ignored elements, and `superuser` appears in no log or audit row.
- GIVEN claim `[]`, or only non-allowlisted values, THEN `global_role = engineer` with a warning.
- GIVEN the string claim `"facilitator,engineer"`, THEN it is one non-allowlisted value → `engineer` (no comma splitting).

**What this precedence means for the no-manager rule. I'm recording it honestly; it does not override the decision.** A person holding both EM and facilitator becomes `global_role = facilitator`. The `global_role` half of the dual check in `session-subscriber-access-helper.ts` then never fires for them. The no-manager rule rests **entirely** on their `team_memberships.role = engineering_manager` rows:
- If those rows are accurate, they are still blocked from participating in, and from facilitating, the teams they manage. The ritual holds.
- If a manager's membership is missing or recorded as `member`, nothing in the app knows they are a manager. They could join as a participant or facilitate that team. Before this change, the EM global role caught that case.
- They also lose EM content access on their own teams (phantom-EM downgrade), which produces log noise.
- I would have ranked EM above facilitator so the order fails toward restriction. The user chose otherwise and I'll follow it. The mitigation is documentation and, ideally, a log line (open item 1).

**Required deployment-docs warning** (to sit next to the role-claim section):
> Do not assign `facilitator` to anyone who manages people. If a user is sent both `engineering_manager` and `facilitator`, the application treats them as **facilitator only**. From then on, the rule that managers never participate in a Health Check is enforced only by their team memberships being recorded with the `engineering_manager` role. Keep those memberships accurate, and give managers exactly one app role.

## Finding 4: role-change latency

A role change applies at the user's next authentication. Their existing app session keeps the prior role until then, bounded by the 90-minute absolute lifetime (`middleware.ts:34`). The spec SHALL state this as an accepted limitation (BA), not only in the docs. Docs wording (Priya): "takes effect within 90 minutes, or immediately if the person signs out and back in. A newly granted facilitator should sign out and in." **Revocation:** there is no in-app revoke-sessions control. The fastest operator lever is revoking the user's sessions/refresh tokens at the IdP; the middleware's revoked-token branch then ends the app session at the next refresh. The proposal must confirm this path or say plainly that there is none beyond the 90 minutes.

A risk to document, not fix: a live session that runs past 90 minutes forces the facilitator to re-authenticate, and a role changed that morning arrives mid-ceremony.

## Finding 5 (Priya): member-facilitators cannot reach session creation — FOLLOW-UP #237 (Decision 5)

`App.tsx:34-41` routes members to their team view before checking `canFacilitateSessions`, and nothing links to `/sessions/new`. A facilitator who belongs to their own home team, which is the normal profile, cannot find creation. Out of #235 scope. I want #237 **closed before the first team goes live**, as a release gate rather than a #235 gate.

---

## What the person sees (Priya's cases, docs-only per Decision 10)

| Case | Page / copy today | Disposition in #235 |
|---|---|---|
| No role, no team, expected facilitator | `NoTeamPage.tsx:44-50`: "ask your facilitator for a join link … No further setup is required" | Troubleshooting entry in deployment docs; no UI change |
| Goes to `/sessions/new` without the role | `SessionCreationPage.tsx:116` silently redirects to `/` | Same troubleshooting entry |
| Has the role and a team membership | Lands on team view, no creation link | #237 |
| Role granted while signed in | No change until re-auth (≤90 min) | Docs: sign out and in |

Troubleshooting entry: "I was given facilitator but still see the join-link page". Causes: not signed in again; wrong `OIDC_ROLE_CLAIM` name; the IdP not sending the role. (Two roles no longer causes this after Decision 6. Remove it from Priya's list.)

## Requirements to write (BA wording, adopted)

- **Allowlist is closed.** *The allowlist SHALL be exactly `{engineer, senior_engineer, facilitator, engineering_manager, application_admin}`*, plus a unit test asserting set equality, so widening it forces a spec delta. `facilitator` is privileged (creates sessions, edits standing topics). The spec says so.
- **senior_engineer (Decision 8).** *An allowlisted, non-privileged role; every authorization check SHALL treat it identically to `engineer`.* Own scenarios: persists on re-sign-in; `canFacilitateSessions: false`; session create → 403; topic-admin gate denies.
- **Facilitator persists.** GIVEN a returning user whose token carries `facilitator` and whose `global_role` is `facilitator`, WHEN they sign in again, THEN it stays `facilitator` AND `/auth/session` returns `canFacilitateSessions: true`. First-sign-in variant: new user → `facilitator` + `first_access_created` with `globalRole: facilitator`.
- **first-access spec `:137-146`.** The "audited" and "only the IdP can cause…" bullets name every privileged value: `facilitator`, `engineering_manager`, `application_admin`.
- **Local dev.** GIVEN a fresh `docker compose up` with seed data, WHEN facilitator-001 signs in through the persona page and creates a session for a seeded team they are not a member of, THEN it succeeds with no `psql` step in `docs/local-development.md` or the hands-on script. The proposal names the seeded team.

## Local dev and docs surface (mechanical)

- `docker/oidc/accounts.js:1-20`: give `facilitator-001` `role: "facilitator"`, fix the header comment, and keep it a member of no team.
- `routes/auth.ts:48`: `seeded: true`. The unseeded-caveat branch becomes dead in practice; keep it. Update fixtures `routes/__tests__/auth.test.ts:282`, `frontend/.../DevLoginPage.test.tsx:8`, maybe `docker/oidc/__tests__/interactions.test.js`.
- `docs/local-development.md:105, 114, 118`; `docs/test-scripts/topic-add-form-hands-on-check.md:46, 62-63, 205, 240` (drop the promotion and "Order matters"; keep "sign in once first").
- Specs: `local-dev-environment/spec.md:27, 47-49` (MODIFIED), `persona-login/spec.md:10, 54` (check), `first-access`, `auth-error-handling`.
- `docs/deployment.md` has no role-claim section at all. Write one: `OIDC_ROLE_CLAIM`, the allowlist, array handling and precedence, the manager warning, latency/revocation, and troubleshooting.
- Tests: resolver-level tests for facilitator persistence, demotion, every array case, and allowlist set equality.

## What could go wrong if the design drifts

- An "admin can toggle facilitator" endpoint brings back two writers. Amend the deferral doc.
- The allowlist gets widened casually. The set-equality test guards against this.
- "Not a member" gets read as the full rule (Finding 2). Auto-adding the creator as a member would flip it.
- Manager memberships drift out of date, and under the chosen precedence that silently weakens the no-manager rule (Finding 3).

---

## Feedback disposition

| Suggestion | Disposition | Rationale |
|---|---|---|
| BA C1/C2, Option X; demotion scenarios | Accepted | Decision 4. |
| BA Option Y (narrow the AC) | Rejected | Decision 4. Audit by inference is the spreadsheet gap the app exists to close. |
| BA "reject arrays with >1 element → engineer" scenario | Superseded | Decision 6 chose precedence; replaced by the scenarios in Finding 3. |
| BA C5 `previousRole` in log; allowlist set-equality test; latency as spec limitation; senior_engineer scenarios; local-dev precondition | Accepted | Testable and in scope. |
| Priya: 90-minute latency wording; mid-ceremony re-auth note; "What the person sees" | Accepted (docs) | Accurate and cheap. |
| Priya: fix member-facilitator routing in #235 / don't call #235 done until fixed | Rejected for #235 | Decision 5 (#237). I support making #237 a go-live gate instead. |
| Priya: `/no-team` copy change | Rejected for #235 | Decision 10: docs troubleshooting only. Revisit with #237. |
| Priya Q3: header role badge | Rejected | New UI chrome. The app should disappear into the background during a session. Docs plus sign-out-and-in cover it. |
| Priya Q4: lengthen the 90-minute lifetime for long sessions | Rejected | Out of scope, and brief sessions are load-bearing for the ritual. A Health Check that outlasts 90 minutes is the problem. |
| Priya: second local facilitator persona *with* a membership | Deferred to #237 | Only needed to reproduce that bug. |

## Still open

1. **Outranked-role log line.** When precedence discards an allowlisted value (e.g. EM under facilitator), should the warning name the discarded *allowlisted* role? Those are not raw values, so it is safe to log. It is a log line, not alerting (consistent with Decision 9), and it is the only in-app trace of the Finding 3 risk. I recommend yes; the design should decide.
2. **Revocation path (Finding 4):** confirm that IdP-side token revocation ends the app session via the refresh path, and its real latency.
3. **`openspec validate --strict`** on this notes-only directory: could not run here (`openspec` CLI not installed; `npx` blocked by registry policy). Run it before the proposal.
4. **Follow-up issue for reporting-chain enforcement** (Finding 2 non-goal): file it and link it in the proposal.
