# Implementation Review: Solution Architect (238-facilitator-reporting-chain-decision)

*Ingrid Sollenberger, Principal Solution Architect. Reviewed against `origin/main` at the
implementation commit. Scope: the four `requirements/` edits (new 01c, `Summary.md` footnote,
use-cases README rows, UC 01 cross-reference) and proposal Appendices A–C, which will be filed
verbatim. Binding inputs: `decision-log.md` rows 1–20, `design.md` D1–D8, `tasks.md`.*

## Verdict

**Approve with two must-fix items.** Both are small text edits. The 01c record follows the
decision log closely. I found no reopened decision and no invented product decision. The persona
review is not presented as the human VP's sign-off in 01c. The code claims in Appendices B and C
hold against `packages/backend/src` on `main` and against #235 at `54c1e9bf`. Both must-fix items
are about wording that will leave this repository verbatim: one traceability gloss in 01c, and one
sentence in Appendix A.1 that a #235 reader could take as VP sign-off.

## Must-fix

### M1. 01c misdescribes #235 Decision 9

`01c` §1 Traceability (line 17) glosses #235 Decision 9 as "audit events suitable for operator
alerts, none configured". §5 (line 75) cites it for "the event is named as suitable for an
operator alert; the application configures none".

Here is what #235 `decision-log.md` row 9 actually decides:

> Manager switched to facilitator in the IdP (Finding 3) — code change or docs? **Docs warning
> only** in deployment docs; no new alerting.

The phrase "suitable for an operator alert" comes from #238's own design (D7, Appendix B). It is
not in #235. The "configures none" half is consistent with Decision 9, but the gloss puts words
in #235's mouth. A requirements record is exactly where an auditor will trust a citation without
checking it.

The correct reading also helps 01c. Decision 9 is the decision that makes the docs warning the
control for "manager sent only `facilitator`", which is residual gap 1. **Fix:**
- Change the line 17 gloss to "9 (a manager switched to `facilitator` gets a docs warning only,
  with no alerting)".
- In §5, keep "(#235 Decision 9)" only on "the application configures none".
- Optionally, cite Decision 9 next to the §8 "Standing control" sentence for gap 1.

This does not reopen anything. Row 3 says the rule supersedes Decision 7 only, and Decision 9
still governs gap 1.

### M2. Appendix A.1 "After" reads as a VP co-decision

A.1's "After" keeps #235's owner clause and adds the outcome directly after it: "(owner: BA,
Marcus Delgado, with the VP of Engineering). **Decided 2026-10-04** …". Task 5.2 posts this to
#235 as paste-ready text. Someone reading #235 will take "with the VP of Engineering … Decided" as
VP sign-off, which is what decision-log row 12 rules out.

**Fix:** change it to "… **Decided 2026-10-04 by the product owner** (human VP of Engineering
acknowledgment pending; see the decision record's Status) …". Apply the same wording to the #238
status comment in task 5.2.

## Suggestions (should do before filing, not blocking)

1. **Conflict-row metadata should carry `oidcIssuer`.** Every existing `auth.*` row carries both
   `oidcSubject` and `oidcIssuer` (`routes/auth.ts:328-333`). A subject is unique only within its
   issuer. Appendix B Scope freezes the field set at `{ oidcSubject, appliedRole,
   conflictingRoles, previousRole, correlationId }`, and AC 4 asserts that exact set. Add
   `oidcIssuer` now, because changing an AC after filing costs more than changing it here. It is
   an established identifier, not a raw role-claim value, so it fits 01c §5's audit-content rule.
   While in that bullet, state `actor_user_id` = the signing-in user. The pre-launch query's
   clause (b) depends on it, and the column list currently names only `actor_global_role`,
   `team_id` and `target_user_id`.
2. **Room-open copy for the admin-applied case.** `SessionData.roleConflict.applied` can be
   `"application_admin"`. A former facilitator who still owns a draft and is now sent
   admin + EM + facilitator hits the live-role 403 (`facilitator-sessions.ts:855-887`), and
   Appendix B's example copy would tell them they are "now set up as an Engineering Manager". AC 8
   should require that the copy branches on `applied`, as the notice already does ("admin-specific
   copy").
3. **Name the archived path for "#238 proposal Appendix A.3".** Appendix B Scope and AC 9, and
   01c §9 and §11, point at "#238 proposal Appendix A.3/A.1". After task 4.3 the proposal lives at
   `openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision/proposal.md`.
   That name is fixed now, so put the path in the filed issue body and in 01c, so that #NNN's
   implementer doesn't have to search for it.
4. **Appendix C: separate decided from proposed in the ACs.** The Behaviour section is marked
   "proposed; confirm in this issue's design review". However:
   - AC 1 ("no new session row") and AC 5 encode the update-in-place shape as acceptance criteria.
   - AC 6 pins the outcome for concurrent takers. `design.md` D8 lists concurrency as *left open*
     for #MMM, and it is not among Appendix C's open questions.

   Either mark ACs 1, 5 and 6 as "proposed, confirm in design review", or move concurrency into
   Open questions and align D8. Also add to Scope: the 403 message "Only the facilitator who
   created the draft may advance it." (`facilitator-sessions.ts:834-842`) is no longer accurate
   after a takeover.
5. **Persona name on the copy-review checkboxes.** Appendix B asks for review by "the Facilitator
   role (Priya Nair). Record name and date." This is the same distinction as row 12. Say whether a
   persona review satisfies the checkbox or whether a human facilitator must do it. If it must be
   a human, say "the Facilitator role (a human facilitator)" and drop the persona name from the
   filed body.
6. **Path 3(b) live-role check: reuse the snapshot.** `evaluateTeamAccess` already reads
   `global_role` together with the membership row "on a consistent snapshot"
   (`team-content-access-helper.ts:71-97`). Add one sentence to Appendix B Scope: gate the draft
   clause on that already-read `global_role`, or put the role predicate in the Path 3 SQL, and
   don't add a third read. Either keeps the helper's no-TOCTOU comment true.
7. **`isLiveSessionPath` edge case.** `/sessions/new` (`App.tsx:122`) shares a prefix with
   `/session/*`, and a naive `startsWith("/session")` matches it. AC 7's "unit-tested against every
   `App.tsx` route" catches this only if the expected value for that route is right. Name the case
   explicitly.
8. **A.3: #235 spec item 2.** The #235 "Deployment documentation describes the role claim" item 2
   states the precedence order verbatim. A.3 amends the docs bullet ("except that …") and adds
   list items, but it doesn't amend item 2's text. Add the exception to item 2 so that the spec
   and the docs say the same thing.
9. **Nit.** `design.md` D5 and decision-log row 18 cite `team-content-access-helper.ts:216-221`.
   The draft clause itself is lines 218-221 (216-217 is the active-status clause). This is not
   carried into the filed bodies, so no action is needed there.

## What I verified

**Decision-log fidelity (rows 1–20):**
- Rows 1, 3, 4: the glossary line and §2/§3. The rule supersedes #235 Decision 7 "for this pair
  only", and `application_admin` still wins and is still flagged.
- Row 2: documents only.
- Row 8: launch gate (§9, gap 6).
- Row 9: told and audited, and option (d) is rejected.
- Row 10: both pre-launch items are in #NNN, with no checklist document.
- Row 11, as amended by 14–17: drafts stay blocked at room-open; "recreate" survives only as
  "while it holds the slot"; sessions past room-open stay with their facilitator under #235
  Decision 12.
- Row 12: the Status line reads "persona review … human VP … *pending*", and the
  "Acknowledged" check is clean.
- Row 13: gaps 1–2 are accepted risk, with no broader attestation.
- Rows 15–16: any draft, usual checks, separate issue.
- Row 18: live-role check on draft access.
- Row 19: cited separately as a pipeline default.
- Row 20: process only, so it is correctly absent from 01c.
- 01c doesn't assert Appendix C's proposed takeover mechanics as decided, which is correct.
- The tasks.md checks pass: 11 `## ` headings; the resolved-role table diffs clean against
  Appendix B; no "override/toggle/configurable" hits; "recreat" and "reassign" each hit only the
  intended sentence.

**Code claims (`main`):**
- `sessions_team_active_unique` includes `draft` (`migrations/10_sessions_team_active_unique.sql:63-65`).
- No non-test code sets `status = 'abandoned'`. The `sessions_abandoned_has_timestamp` CHECK
  (`2_create_tables.sql:77-78`) makes the operator SQL's `abandoned_at = now()` mandatory, and the
  SQL includes it.
- Lazy 24-hour draft expiry and Path 3(b) without a role predicate: `team-content-access-helper.ts:213-226`.
- The dual-check mismatch degrades to participant: lines 146-180. This supports 01c §4.1.
- `facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'`: `facilitator-sessions.ts:1615`.
- Room-open order is creator 403, then live-role 403 with a `session.advance_denied_role` audit
  row (`facilitator-sessions.ts:834-887`).
- `409 session_already_exists`: `facilitator-sessions.ts:437`.
- `audit_log.actor_user_id NOT NULL` with no FK, and nullable `actor_ip`
  (`8_audit_log.sql:31-37`). The operator step is therefore writable from psql, and row 19's
  requirement for an app account holds.
- `SessionData` (`session-store.ts:95-102`) is preserved across token refresh by
  `{ ...session }` (`middleware.ts`), so the D6 blob flag survives a refresh and is reset only by
  `regenerate()` (`routes/auth.ts:399`).
- `/auth/session` "never cached in the Redis session blob" (`routes/auth.ts:739-741`) supports
  D6's argument.
- `APPLICATION_ADMIN_CONTACT_EMAIL` / `applicationAdminContactEmail`, `AuditEventName`,
  `withAuditTransaction`, `AuditWriteError`, `docker/oidc/accounts.js`,
  `docker/oidc/__tests__/interactions.test.js`, `DEV_LOGIN_OPTIONS`, and the `docs/deployment.md`
  Logging transactional `auth.*` list all exist.
- The routes `/session/:sessionId…` and `/team/:teamId/session/:sessionId` (DraftSessionHost)
  match the live-session path definition.
- `writeAccountResolutionAuditRow` and `auth/account-resolution-audit.ts` don't exist on `main`.
  They are #235 D5's refactor, and Appendix B attributes them to #235 D5, which is correct given
  the "merged and archived" blocker.

**#235 at `54c1e9bf`:**
- A.1 "Before" (proposal line 67) and A.3 "Before" (proposal line 28, `docs/deployment.md:200`)
  match character for character.
- The A.2 target, row 7, exists.
- The requirements A.3 names exist ("Multi-valued role claims resolve by fixed precedence",
  "Deployment documentation describes the role claim" with its "exactly these items" list, and
  the scenario "Facilitator outranks engineering manager").
- The D3 `outrankedRoles` semantics ("every distinct allowlisted candidate other than the applied
  role") match Appendix B AC 5.
- Decision 11/D9 (`enableNonRepudiationChecks`) and Decision 12 are cited correctly.

**Conventions:**
- The 01c filename follows `<Source> - <Descriptor>.md`.
- Its structure mirrors 01b: Status/owner header, Decision, Rejected, Revisit if.
- The UC 01 bullet matches the "**Decided <date>:** … (#NNN)" style of the line above it.
- The README rows are URL-encoded, and 01b's missing row is added.
- The `Summary.md` sentence is unchanged, with a footnote only.
- All added relative links resolve.
- Exactly four `requirements/` files changed.

**Still open (tracked, not review findings):** `#NNN`/`#MMM` placeholders remain in 01c until
task 5.1; this must not merge until they are replaced. AC 1 is pending on #235. Human VP
acknowledgment is pending.
