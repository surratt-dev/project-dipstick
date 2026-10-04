# Propose Review: BA (Marcus Delgado)

**Verdict: Approve with changes.** Most of the capabilities can be built straight from the deltas. The precedence and firing-condition requirements are precise, and they are tested where it matters. The remaining problems are traceability gaps against #235, plus a few scenarios whose THEN clause can't be observed. Decisions 4–10 (User/Pipeline) are taken as settled, and nothing below reopens them.

## 1. #235 acceptance criteria → requirement/scenario trace

| #235 AC | Traced to | Status |
|---|---|---|
| Facilitator persists across sign-in (resolveOrCreateAccount integration test) | first-access "Facilitator persists on re-sign-in"; tasks 3.1 | **Partial.** The scenario exists, but the spec doesn't say which test layer covers it. Only tasks.md requires the real-Postgres test. |
| Removing claim → `engineer`, `role_claim_mapped` facilitator→engineer | first-access "Facilitator demoted…"; auth-error-handling "Demotion from facilitator…" | Covered. The two specs repeat the same assertion (see 3d). |
| `senior_engineer` "same" | "senior_engineer persists on re-sign-in", "…cannot facilitate" | **Gap.** No scenario covers demoting `senior_engineer` → `engineer` (claim removed → audited row). The demotion scenarios list facilitator, EM and admin only. |
| Non-allowlisted → `engineer` with **warning only** | "Claim value not on allowlist…", "Near-miss values…" | **Gap.** "Only" isn't asserted. Nothing says a *returning* `engineer` who sends `superuser` gets no `role_claim_mapped` row. "An unchanged default role…" covers only absent/`engineer`. |
| Local facilitator-001 creates a session, no SQL | local-dev "Local facilitator can run a session with no SQL step" | Covered, but the THEN is vague (see 3a). |
| Specs/docs updated | Only the verbatim manager warning is a SHALL. The Entra example, latency section and troubleshooting entry exist only in proposal/tasks. | **Implicit.** See 3e. |
| lint/test/build/`openspec validate --strict` pass | tasks 7.1–7.4 | **Weakened.** 7.4 allows a "check by hand" substitute. #235 says the validate step *passes*. A hand check should be recorded as an unmet AC that a human signs off, not counted as meeting it. |

## 2. Sanity check: can facilitator-001 create a team locally? Yes. Verified in code.

- `POST /api/v1/teams` (`routes/facilitator-sessions.ts:523`) reads the **live** `users.global_role` (l.528) and returns 403 with `team.creation_denied_role` unless it is `facilitator` (l.547). It inserts the team, its topics, and a session with `status='lobby'`, `session_number=1` in one transaction (l.610–655). It inserts **no** `team_memberships` row (D6 comment, l.514).
- `App.tsx:34-41`: a user with zero memberships and `canFacilitateSessions` is routed to `/sessions/new`. facilitator-001 has no memberships before or after creating a team, so it keeps landing on the entry point. The proposal's claim holds.
- Role mapping runs only in `/auth/callback` (`routes/auth.ts:318`). Token refresh does not re-map. That matches "applies at next authentication" in the latency requirement.

## 3. Vague or implicit language, with concrete conditions

**a. Local-dev scenario: "creates a new team … and opens its session".** "Opens" is undefined. `POST /api/v1/teams` already creates the session in `lobby`, so there is no separate open step. Proposed THEN: "`POST /api/v1/teams` returns 201 with a session in `status = 'lobby'` whose `facilitator_id` is facilitator-001's user id; `team_memberships` has zero rows for (facilitator-001, new team); no row in `users` was written except by `/auth/callback`."

**b. Latency is specified for grants only.** "Role change does not reach an existing session…" covers granting `facilitator`. Revoking it is the more important direction, and no scenario covers it. Add: "WHEN `facilitator` is removed at the IdP from a signed-in user, THEN `users.global_role` stays `facilitator`, and `POST /api/v1/teams` keeps succeeding for them, until their next `/auth/callback`, no later than the 90-minute absolute lifetime; WHEN their refresh tokens are revoked at the IdP, THEN the session ends at the next refresh attempt." Also replace "next authenticate" with "next completed `/auth/callback`" so token refresh can't be read as authentication.

**c. "Every authorization check SHALL treat `senior_engineer` identically to `engineer`."** As written this can't be tested, because it's a universal claim. The scenarios pin `/auth/session`, `/sessions/draft` and `/topics`. Add `POST /api/v1/teams` → 403 with the same body as for `engineer`, and a `team.creation_denied_role` audit row with `actor_global_role='senior_engineer'`. Task 4.2 already tests this, but no spec scenario does. Also state that this list is exhaustive for this change.

**d. The same demotion assertion lives in two capabilities** (first-access and auth-error-handling). Keep the audit-row detail in auth-error-handling only. The first-access scenario should say "audited per auth-error-handling 'Demotion from facilitator is recorded'" so the two can't drift apart.

**e. Docs acceptance is implicit.** Add a SHALL (first-access or a docs task with a checklist), so that `docs/deployment.md` contains: `OIDC_ROLE_CLAIM`, the 5-value allowlist, string/array handling, the precedence order, an Entra app-roles example, the verbatim warning, latency/revocation, and the troubleshooting entry "I was given facilitator but still see the join-link page". The AC becomes a checklist a reviewer can tick off.

**f. Deferral doc correction.** Line 17 of `01b - Designate a Facilitator - Deferral.md` still says "Demotion and audit already exist". The proposal says the doc is wrong, but What Changes only says "marked resolved" plus one wording change. Name line 17 explicitly as a required correction. Otherwise the doc will contradict Decision 4.

**g. Precedence edge cases that aren't specified:**
- Duplicates: for `["facilitator","facilitator"]`, is `allowlistedCount` 1 or 2? Does it log any warning?
- Outranked set: for `["application_admin","facilitator","engineering_manager"]`, does `outrankedRoles` list only EM, or both, and in what order? The scenario covers only one outranked role.
- Is `[null]` an ignored element (warning) or an absent claim (no warning)?

Pick one answer for each and add a scenario or a task-1.x case.

**h. "No … script SHALL write `global_role`."** Tasks preamble l.6 allows integration-test setup rows. Add the test-fixture exception to the spec, or the requirement is violated as soon as tasks 3.x are written.

## 4. Requirements alignment

- FR-2.1 [HARD] (BRD l.217): satisfied. facilitator-001 and IdP facilitators reach the session-creation path with no workaround.
- `entities-and-relationships.md` l.51 says "Facilitator is a Senior Engineer". The precedence `facilitator > senior_engineer` keeps that intent: a user sent both resolves to facilitator. No scenario covers this, though. Add `["senior_engineer","facilitator"]` persists across a re-sign-in in the integration layer. Task 3.4 covers the first sign-in only.
- `Summary.md` l.12 ("not in the reporting chain") is a non-goal with an owner (Follow-up 2). That's acceptable as recorded. I accept the owner assignment and will file the issue.
- UC 01 AC5 (every role change is audited) is now actually true for `global_role` demotions too. Good.

## 5. Must-fix before design sign-off

1. Add a `senior_engineer` → `engineer` demotion scenario (#235 AC 3).
2. Add the "warning only" no-audit-row scenario for a returning engineer who sends a non-allowlisted value (#235 AC 4).
3. Make the local-dev THEN observable (3a) and add the revocation-latency scenario (3b).
4. Make the docs checklist a stated requirement, and name the deferral-doc line 17 correction (3e, 3f).
5. Treat `openspec validate --strict` as a hard gate. A hand check counts as an unmet AC that a human must sign off.
