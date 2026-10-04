# Design: 238-facilitator-reporting-chain-decision (#238)

*Ingrid Sollenberger (Solution Architect). Revised after the design reviews
(`design-review-engineer.md`, `design-review-security.md`); see "Design review disposition" at the
end.*

## Context

The user has made every product decision (`decision-log.md`, rows 1–18). This file records how
the decision gets written down. It doesn't re-argue the decision. The evidence and options are in
`exploration-notes.md`. No application code changes.

Rows 13–18 were added during the design stage, in answer to the design reviews:
- row 13: no broader line-management attestation (proposal Open item 2 is closed);
- rows 14–17: a stranded draft is unblocked by **draft takeover**, which replaces the "recreate"
  half of row 11. Takeover is a separate issue (#MMM) with no launch gate. Until it ships, a
  stranded draft is cleared by a documented, audited operator step;
- row 18: draft-based team-content access also requires a live `facilitator` role (Security S2).

`#NNN` is the conflict-rule follow-up issue (Appendix B). `#MMM` is the draft-takeover issue
(Appendix C). Both are placeholders until the orchestrator files them.

## Decisions

### D1. The record is a new `01c` file, structured like 01b

`requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`. Alternatives (appending
to 01b, annotating `Summary.md`, `docs/decisions/`) were weighed in exploration §7, and the BA
concurred:
- 01b is a deferral doc about designation, a different subject.
- `Summary.md` is the source concept and shouldn't carry rationale.
- `docs/` is operator documentation, and #238's AC says `requirements/`.

Section order:
0. Three-sentence summary (the rule, why, what it doesn't catch). Most readers stop here.
1. Status / Owners / Traceability. The VP line records the persona review (Executive Stakeholder,
   approved with conditions) and marks the human VP of Engineering acknowledgment *pending*.
2. Decision, with the glossary line.
3. Resolved-role rule.
4. Why.
5. How it shows up for people.
6. Sessions (D5).
7. Rejected.
8. Residual gaps and standing control. Gaps 1 and 2 are recorded as **accepted risk** (decision-log
   row 13, the user): they have no pre-launch control, and the docs warning is their only standing
   control. Recording this lets a later auditor see the risk was accepted, not missed.
9. AC disposition, dependency and launch gate.
10. Revisit if.
11. Consequences for other documents.

`Summary.md:12` keeps its wording and gains only a footnote marker and a footnote.

### D2. No `specs/` delta in this change

Main specs must describe what is built. The rule modifies the requirement
"Multi-valued role claims resolve by fixed precedence", which exists only in #235's unmerged
`first-access` delta. `openspec/specs/first-access` and `oidc-auth` on `main` have no precedence
requirement at all. So any delta here would fail one of two ways:
- it would MODIFY a requirement that doesn't exist on `main` (the sync breaks), or
- it would ADD a requirement for behaviour that isn't built (the synced spec is false).

A "decision recorded" requirement would be true, but it isn't a system behaviour, and it would
clutter a capability spec. The normative scenarios go in the follow-up issue draft
(proposal Appendix B). Precedent: `archive/2026-09-29-join-link-use-case-sync` (requirements-doc
change, no spec delta).

**Landing order (Engineer F9).** #NNN's delta can only sync once #235 is **merged and archived**,
so that the precedence requirement exists in `openspec/specs/first-access` and
`auth-error-handling`. Merged-but-unarchived produces the MODIFY-a-missing-requirement failure
above. Appendix B's "Blocked by" says so.

**Validation (Engineer M6).** OpenSpec's change validator expects at least one delta, so
`openspec validate --strict` will likely flag this change. Archive it as a documents-only change
(`--skip-specs` or equivalent), as the precedent did. tasks.md §4.3 records this.

### D3. #235 amendments are an appendix, not edits

#235's files are on branch `ccr-b594efa3-9zclgu`, so this change can't edit them. The paste-ready
before and after text lives in proposal Appendix A, so the change has a single place to look.
There are three amendments, each with its own applier:
- **A.1** (Follow-up 2): applied by whichever of #235 and #238 merges second. Until then, #238
  AC 1 is "pending amendment on #235".
- **A.2** (Decision 7 annotation): applied the same way.
- **A.3** (warning text and the #235 spec text pinned to it): applied by #NNN. The VP made the
  warning a character-for-character SHALL, and changing it before the code would make the docs
  describe behaviour that doesn't exist.

**A.3's single source (Engineer F5).** When #NNN lands, #235 is archived, so #NNN must not edit an
archived `proposal.md`. Instead, #NNN's delta MODIFIES the #235 requirement "Deployment
documentation describes the role claim" so that the warning text is inlined in the spec. The spec
becomes the single source; the scenario compares docs to spec. The same MODIFY amends the
requirement's "exactly these items" list to add the conflict troubleshooting entry and the
alert-suitable event mention, which would otherwise break "exactly".

### D4. Pre-launch items live in the follow-up issue (rows 10, 13, 17)

Row 10 names two pre-launch items, and both are checkboxes in #NNN (Appendix B): the IdP
attestation (no user holds both roles) and the one-time draft check for drafts by now-conflicted
users. No launch-checklist document is created. 01c cites them by reference to that issue. The
attestation covers the both-roles pair at launch. It is not a control for residual gaps 1 or 2, and
row 13 decided not to broaden it.

The draft check is **a read-only query, then one audited operator write per hit** (Engineer F1,
Security S1, row 17). It is no longer purely read-only, and Appendix B says so. If #MMM (takeover)
has shipped by then, a hit can be taken over in the app instead, and no operator write is needed.

The Facilitator walk-through and notice-copy review are part of #NNN's PR review, not pre-launch
gates (Executive Stakeholder recommendation 2; they don't trace to row 10).

### D5. Sessions are stated as decisions (rows 11, 14–18)

01c states these rules explicitly, so that a later hardening change doesn't treat them as
accidental.

**Drafts.**
- A draft created by a user the conflict rule now resolves to `engineering_manager` stays blocked
  at room-open (row 11). The live-role check before draft → lobby stays.
- It is **not recreated** in the app: `sessions_team_active_unique`
  (`migrations/10_sessions_team_active_unique.sql`) includes `draft`, so the stranded draft holds
  the team's single non-terminal slot and a second `POST …/sessions/draft` returns 409. Nothing in
  the app abandons a draft, and the 24-hour expiry is read-time only. (Engineer F1, Security S1.)
- The unblock path is **draft takeover** (rows 14–16): another facilitator who passes the usual
  checks takes over the existing row, after a confirmation prompt, with an audit event. Takeover
  works on any draft, not only stranded ones. It is tracked in #MMM (Appendix C), with no launch
  gate (row 17).
- **Until #MMM ships** (row 17): the pre-launch draft check covers drafts that exist at launch, and
  a draft stranded after launch is cleared by a documented, audited operator step in `docs/`
  (Appendix B). The step is one `UPDATE … SET status = 'abandoned', abandoned_at = now() WHERE id
  = $1 AND status = 'draft'` and one `audit_log` row in the same transaction. Another facilitator
  then creates a new draft.
- There is still no reassignment feature in #NNN. Takeover is the takeover issue's feature, not a
  reassignment flow added to #NNN.
- **Draft read access needs a live facilitator role** (row 18). Today `evaluateTeamAccess`
  Path 3(b) (`team-content-access-helper.ts:216-221`) admits the draft's `facilitator_id` for 24
  hours with no role predicate, so a re-resolved manager could keep reading the target team's
  action items and trends. #NNN adds `global_role = 'facilitator'` to Path 3(b). This also closes
  the same gap for #235 Decision 12 revocations. It does not touch sessions past room-open.

**Sessions past room-open** stay with `sessions.facilitator_id` (#235 Decision 12, row 11).
Security confirmed this holds for session control and live events (design-review-security Claim A).
01c lists what it covers (Security S3), so the extent is decided rather than emergent:
- session control and live-event delivery;
- per-voter attribution for that session;
- the team's action items (with owner names) and trends;
- for 30 minutes after completion (`facilitator_access_expires_at`);
- with no time limit while the session is non-terminal (nothing abandons a lobby).

Facilitator-path surfaces that need a live standing `facilitator` role (topic list and writes,
annotations, `eligible-for-session`) do change with the role. They aren't session control.
The docs troubleshooting entry includes a read-only query for non-terminal sessions whose
`facilitator_id` has a conflict audit row, which fits the "audit-log query, no in-app view"
non-goal.

#NNN tests the draft rule (AC 8), the past-room-open rule (AC 10) and the draft read grant
(AC 12).

### D6. Conflict notice state lives in the server session (Engineer F3, Security S5)

The conflict flag on `ResolvedUser` lives only for the callback request, but the notice and the
room-open copy need it later. Pinned in Appendix B:
- At callback, after `regenerate()`, set `roleConflict: { applied: "engineering_manager" |
  "application_admin" }` on the Redis session blob (`SessionData`, `session-store.ts`). "Shown on
  every sign-in, hidden after dismissal until the next sign-in" then follows from `regenerate()`.
- A separate `GET /auth/role-conflict-notice` returns `null` or `{ adminCase, strandedDrafts:
  [{ sessionId, teamName, createdAt }], contactEmail | null }`, typed in `packages/shared`. It is
  not a field on `/auth/session`, so a failed draft-list query can't break the call that gates the
  SPA. On error the notice is skipped and the failure logged.
- `POST /auth/role-conflict-notice/dismiss` clears the field. Dismissal is server-side.
- Room-open reads `session.roleConflict` to choose copy. It never reads `audit_log` (the audit
  trail is not an input to request handling) and never reads anything client-supplied.
- The flag **selects copy only**. The room-open 403 stays a pure live-`global_role` check. This is
  why the blob field doesn't break the `AuthSession` rule "never cached in the Redis session blob":
  that rule is about authorization signals, and this is a sign-in event fact that grants nothing.
- Accepted consequence: two browsers with different sign-ins can show different 403 copy.

Redis loss: if the blob is lost, the user is signed out anyway; the next sign-in re-detects the
conflict and sets the field again. No state needs to survive a Redis restart.

### D7. Implementation shape pinned in #NNN, not left to apply

These don't change any decision; they stop two engineers inventing two shapes. All are in
Appendix B:
- **Resolver result (F6).** `mapRoleClaimToGlobalRole` returns `{ role, roleConflict }`, threaded
  into `ResolvedUser.roleConflict: boolean`.
- **D3 `outrankedRoles` (F4).** Computed from the **pre-discard** allowlisted set, so the log still
  shows `facilitator` was sent. For admin + pair it stays `["facilitator","engineering_manager"]`,
  and #235's D3 test is unchanged. Without admin, D3 doesn't fire for the pair (EM is applied, not
  outranked).
- **Where the INSERT goes (F6).** In `writeAccountResolutionAuditRow`
  (`auth/account-resolution-audit.ts`, #235 D5), after the `first_access_created` or
  `role_claim_mapped` INSERT, so the real-Postgres integration test reaches it. The post-commit
  `emitAuditEvent` stays in `routes/auth.ts`. Columns: `actor_global_role` = applied role,
  `team_id` NULL, `target_user_id` NULL.
- **Audit content (Security S4).** "No raw **role-claim** values" (`oidcSubject` is the established
  identifier and stays). `conflictingRoles` is the code constant
  `["engineering_manager","facilitator"]`, never built from the claim array.
- **Live-session routes (F7).** Defined by path, not session state: `/session/*` and
  `/team/:teamId/session/*` (including the draft host). One exported `isLiveSessionPath(pathname)`,
  unit-tested against every `App.tsx` route. A dedicated test, not `reauthRequiredHostParity`.
- **Contact (F8).** Reuse `APPLICATION_ADMIN_CONTACT_EMAIL` (already exposed as
  `applicationAdminContactEmail`), with the generic fallback when it is unset. No new setting. If
  the Facilitator copy review needs free text, that becomes a new optional, length-capped env var
  rendered as a React text node; record it on #NNN.
- **Signature verification (Security S6).** #NNN must not ship ahead of #235 Decision 11 / D9
  (`enableNonRepudiationChecks`). The conflict row is only evidence if the claim's signature is
  verified.

### D8. Draft takeover is a separate issue (rows 14–17)

The takeover issue (#MMM, Appendix C) is referenced from #NNN as the unblock path for stranded
drafts. #238 records the decisions rows 14–17 made and leaves the rest to #MMM's own review:
- Decided: any draft; taker has a live `facilitator` role and no membership on the team;
  confirmation prompt; audit event with no raw claim values; no launch gate.
- Architectural note for #MMM: takeover updates `facilitator_id` on the **existing** row, so it
  doesn't touch `sessions_team_active_unique` and needs no abandon step. The previous owner is no
  longer the `facilitator_id`, so they lose Path 3(b) access and can no longer advance the draft.
- Left open for #MMM (listed as open questions in Appendix C): notifying the previous owner,
  whether the 24-hour draft window resets on takeover, takeover of expired drafts, and
  concurrency between two takers.

## Risks / Trade-offs

- **The record says one thing and the code says another until #NNN ships.** Mitigation: 01c
  states the interim plainly, and the launch gate (row 8) means no live team is exposed.
- **Stranded drafts after launch depend on a manual operator step until #MMM ships** (row 17).
  Mitigation: the step is documented in `docs/`, transactional with its audit row, and
  integration-tested by #NNN (AC 8 runs the documented SQL). The risk is operator delay, not an
  unaudited write.
- **Residual gaps 1–2 have no pre-launch control.** Accepted by the user (row 13). The docs warning
  is the standing control.
- **Appendix A.1 isn't applied** if #235 merges after #238 and nobody remembers it. Mitigation:
  #238 stays open until AC 1 is met, and the PR description and GitHub comments on both issues say
  so.
- **#NNN merged before #235 is archived** breaks the spec sync (D2). Mitigation: "Blocked by"
  names archive, not merge.
- **`#NNN` and `#MMM` placeholders** remain until the orchestrator files the issues. Mitigation:
  tasks.md §5 replaces them, with a grep check.
- **`openspec validate --strict` can't run** here (no CLI), and would likely flag a no-delta change
  anyway (D2). The artifacts mirror archived changes by hand.

## Design review disposition

Reviews: `design-review-engineer.md` (Marcus Oyelaran) and `design-review-security.md` (Tomás
Ferreira). Both approved with conditions. The user answered the two points that needed a decision
(rows 14–18). Nothing below reopens a decision-log row.

| Point | Disposition | Where |
|---|---|---|
| Eng F1 / Sec S1: "recreate" blocked by `sessions_team_active_unique` | Accepted, resolved by the user (rows 14–17) | D5, D8. Takeover in #MMM (Appendix C); interim documented, audited operator step in #NNN docs and pre-launch check; copy no longer promises recreation. AC 8 integration-tests the operator SQL. |
| Eng F2: no scheduled-date column; column is `status` | Accepted | Appendix B: team name and `created_at` ("created"); `status` throughout. |
| Eng F3 / Sec S5: notice state undefined | Accepted | D6; Appendix B Scope and ACs 7–8. |
| Eng F4: D3 `outrankedRoles` for admin + pair | Accepted | D7; AC 5 asserts the array. |
| Eng F5: A.3 misses "exactly" and pins to an archived proposal | Accepted | D3; Appendix A.3. |
| Eng F6: INSERT location, row columns, resolver shape | Accepted | D7; Appendix B Scope. |
| Eng F7: live-session routes by path; dedicated test | Accepted | D7; Appendix B notice terms and AC 7. |
| Eng F8: reuse existing contact config | Accepted | D7; proposal Constraints; Appendix B. Free text only if the copy review needs it. |
| Eng F9: blocked until #235 archived | Accepted | D2; Appendix B header. |
| Eng M1: rollback note | Accepted | Appendix B "Rollback". |
| Eng M2: pre-launch clause (a) also catches promoted facilitators | Accepted | Appendix B pre-launch step. |
| Eng M3: event inventory in docs and `AuditEventName` | Accepted | Appendix B Scope. |
| Eng M4: simulator persona-count tests | Accepted | Appendix B Scope (local dev). |
| Eng M5 / Sec consistency: "rows 1–11", Open item 2 | Accepted | Context; proposal header and Open items. |
| Eng M6: validate with zero deltas | Accepted | D2; tasks 4.3. |
| Sec S2: draft read grant survives re-resolution | Accepted, decided by the user (row 18, option b) | D5; Appendix B Scope and AC 12. |
| Sec S3: extent and duration of past-room-open access | Accepted | D5; 01c Sessions (task 1.5); Appendix B docs query. |
| Sec S4: "no raw role-claim values"; constant `conflictingRoles`; more negative cases | Accepted | D7; Appendix B Scope and AC 4. Optional `roleConflict: true` on `session.advance_denied_role` accepted as a Scope bullet (no new AC). |
| Sec S6: explicit dependency on #235 D9 | Accepted | D7; Appendix B header. |
| Sec S7: simulator persona and #239 | Noted, no action | Persona is less privileged than `facilitator-001`. |
| Sec consistency: gaps 1–2 as accepted risk | Accepted | D1 §8; proposal What Changes; task 1.6. |
| Sec consistency: Facilitator Q3 (live-session rule) confirmed | Recorded | D5 cites Claim A; proposal Review disposition. |
| Scope freeze vs. a 12th AC | **User decision overrides** | The Executive scope freeze capped #NNN at 11 ACs. Row 18 is the user's later decision, so AC 12 is added. Every other fix above is folded into existing ACs or Scope text. |
