# PR notes: #296

## Question for the user at PR time
Four follow-up issues are drafted below. File them now, or leave them as drafts? (Security C2 asks that follow-ups 1, 3 and 4 be filed before merge; that is the user's decision.) (Not decided by the drafting team; not a gate on landing.)

## Draft follow-up 1: #216 threat-model additions
Generalize #216 S-B (denial-audit sampling beyond assign-defaults), N-A (sentinel-lock blast radius) and N-D (never spread `request.body`) into the threat model / code rules. Source: #216 security review. Note: the HLA states the S-B limit for assign-defaults only.

## Draft follow-up 2: facilitator experience for a zero-topic team
Verify what a facilitator sees when room open answers `NO_ACTIVE_TOPICS`; if there is no actionable message (for example "This team has no topics. Ask an administrator to restore the default set."), add one. Check whether an open page updates after assignment or needs a refresh. Consider a way to tell an admin which team without a screenshot.

## Draft follow-up 3: audit_log immutability
Revoke UPDATE/DELETE on `audit_log` for the application DB role (or add tamper evidence). Related to #131 (monitoring consumer for audit signals). Until done, the HLA states no tamper evidence is claimed.

## Draft follow-up 4: assign-defaults mutation-control header and stale comments
Low severity, consistency and defense in depth. (a) Assign-defaults relies on the SameSite=Strict cookie session and, unlike the #216 maintenance routes, does not require the `X-Requested-With` mutation-control header; require it, or document why not. A forged request could not choose text (no body or query; copies the template to a zero-topic team only; 409 otherwise). Not in the HLA (no CSRF claim is made). Security asks that this be filed before merge, not left in this file. (b) Bundle the stale "four" comments: `assign-defaults-lock-gate-source.test.ts` header (body asserts five gated writes) and the assign-defaults route comment ("four other lock-gated writes"). Drafted only; no issue filed.

## To fill at landing
- Task 1 outcomes (including 1.4 template text validation, 1.5 count or "not run", 1.6 role source/provisioning, 1.7 session posture).
- D5: "archived rows left in place" keep or drop.
- Sign-off requests and replies (BA; Security: "not reviewed" if unanswered).
- Who was informed that the template-edit plus assign-defaults chain is a recorded exposure.

## Confirmed claims

Checked on the landing day against the working tree (non-test source unless stated). Paths are under `packages/backend/src/`.

| # | Claim | Check | Result | HLA effect |
|---|-------|-------|--------|-----------|
| 1.2a | `isApplicationAdmin` exists and is the admin test | `auth/role-map.ts` (strict equality on `application_admin`); called in `routes/topics.ts` `checkAssignDefaultsAuthorization` | confirmed | Named in text |
| 1.2b | `checkCustomizationLockGate` exists and gates add, archive, restore, reorder, restore-defaults; assign-defaults route exists | `routes/topics.ts` (grep: five gate calls; assign-defaults block has none) | confirmed | Named in text |
| 1.2c | `enforceTopicWriteRateLimit` is a shared per-actor budget; 503 on limiter store error (fail-closed) | `routes/topic-write-rate-limit.ts` (catch -> 503, no DB write); called by add, assign-defaults, archive, restore, reorder, annotation, restore-defaults in `routes/topics.ts` and by the #216 routes in `routes/admin-default-topics.ts` | confirmed | "abuse bound", shared with the #216 template routes; not a control on the chained path |
| 1.2d | `auth/denial-audit-limiter.ts` bounds denial-audit rows per actor; store error or over-bound writes no row | file read; `auth/assign-defaults-audit.ts` `recordDenial` | confirmed | Denial sampling caveat |
| 1.2e | Operations `topic.defaults_assigned` (in-transaction, fail-closed), `topic.defaults_assign_denied` and `topic.defaults_assign_failed` (fail-open), `topic.write_denied_template`, `topic.denial_audit_suppressed` (log only, no row) | `auth/audit-logger.ts` comments and union; `routes/topics.ts`; `auth/assign-defaults-audit.ts` | confirmed | Named in text; `topic.write_denied_template` is not described as protecting the template |
| 1.3a | Handler reads no body or query | `routes/topics.ts` assign-defaults block: only `request.params.teamId` | confirmed | Item (b) |
| 1.3b | No `checkCustomizationLockGate`, no lock-state read, no locked-state requirement (locked and unlocked zero-topic teams accepted) | same block; `assign-defaults-lock-gate-source.test.ts` | confirmed | Items (a), (b) |
| 1.3c | Only inserts template rows into `topics` plus one `audit_log` row, same transaction, under `lockTeamTopics` advisory lock; counts only active topics | `copyCanonicalDefaults` (`sessions/default-topics.ts`, INSERT ... SELECT of active default template rows); handler count `status = 'active'`; no UPDATE or DELETE in the block | confirmed | Item (b) |
| 1.3d | No session, score or reveal data read or written | handler block reads `users.global_role`, `teams` (via `checkWritableTeam`), `topics`, writes `topics`, `audit_log` | confirmed | Item (b) |
| 1.3e (D5) | Archived rows left in place (handler never deletes or modifies archived rows) | as 1.3c; deletion/modification absent | confirmed: KEEP the clause. No stop to the BA needed | Item (b) keeps "archived rows are left in place" |
| 1.4a | Template-write operations `topic.default_added`, `_edited`, `_archived`, `_restored`, `_reordered` are audited | `sessions/default-topic-maintenance.ts` (audit_log INSERT in the same transaction as the write, operation per outcome); `sessions/default-topic-validation.ts` list | confirmed (operation names only; metadata not assessed) | Item (d) names `topic.default_*`; says "audited" only |
| 1.4b | Emptied or all-archived template makes team creation roll back and assign-defaults answer 500 `DEFAULT_TOPICS_UNAVAILABLE` | `routes/facilitator-sessions.ts` (copy then `snapshotSessionTopics`, `NoActiveTopicsError` handled in catch); assign-defaults `template_empty` outcome -> 500 | confirmed (behavior cited, not the stale header path) | Item (d) |
| 1.4c | (Finding, not a claim) the #216 API itself refuses to archive the last active default (`LAST_ACTIVE_DEFAULT`) and has a post-write backstop, so an empty template is reachable only outside that API | `sessions/default-topic-maintenance.ts` `opArchive`, `runBackstop` | recorded | HLA keeps the design caveat unchanged (recovery unavailable while the template is empty) |
| 1.5 | Text written through the #216 template path is validated | `sessions/default-topic-validation.ts` `validateTextField` (required, length, plain-text rule) | confirmed: validated, not bypassed. It is a different and stricter rule than ordinary topic text (`validateAddCustomTopicBody` in `routes/topics.ts` checks length only, with larger limits) | Item (d) states template text is validated on write (length and plain-text rule); makes no "same as ordinary text" claim. See Findings |
| 1.6a | `isApplicationAdmin` input is read from the database on each request, not session or token | `checkAssignDefaultsAuthorization`: `SELECT global_role FROM users WHERE id = $1` per request | confirmed | "re-read from the database on each request" kept |
| 1.6b | How `application_admin` is assigned; whether an admin can grant it | `auth/account-resolver.ts` (global_role set from the IdP role claim via `OIDC_ROLE_MAP` at each interactive sign-in); grep of `SET ... global_role` / `UPDATE users` finds only migration 21 (backfill); `docs/deployment.md` | confirmed: granted only through the identity provider's role claim and the deployment role map at sign-in; no in-app grant path | Item (c) provisioning sentence included |
| 1.7 | (pr-notes only) Session posture | `app.ts`: cookie session, `sameSite: strict`, `httpOnly`, Redis store; assign-defaults does not require the `X-Requested-With` mutation-control header that the #216 routes require; CORS allow-list includes that header | recorded | Not in HLA |
| 1.8 | #131 still open | `gh issue view 131`: OPEN | confirmed | "open at time of writing" kept |
| 1.9 | Expected zero-topic count | No dev or staging database queried | not run | HLA: documented as expected to be none; not measured by this change |
| 1.10 | `docs/deployment.md` "Zero-topic teams" says the expected count is 0 | read | confirmed | Cited by section name only |
| 1.11a | 8.1 table has seven rows | HLA read | confirmed (7; new row makes 8) | Baseline for 3.8 |
| 1.11b | `first_session` is the design-state name | `requirements/use cases/08 - Topic Management - Use Cases.md` ("`first_session`-locked"); `auth/topic-lock-state.ts` `lockReason` | confirmed | Mention at most once |
| 1.11c | S-B, N-A, N-D labels exist | `openspec/changes/archive/2026-10-18-admin-default-topic-maintenance/threat-model-security-read.md` | confirmed | Follow-up 1 text unchanged (source file now cited) |
| 1.11d | #215 and #218 are the team-creation and restore-defaults changes named in item (d) | `gh issue view` titles. #215 = team-creation default-copy hardening. #218 = bulk "Restore default topics" | confirmed as issues; but see 1.11e | |
| 1.11e | Restore-defaults (#218) is a path that copies the template onto a team | `routes/topics.ts` restore-defaults block: reads the team's OWN archived `is_default` rows and re-activates them (UPDATE); does not read the template | DROPPED: the claim fails | Item (d) trust-anchor sentence names team creation (#215) and assign-defaults as the copy paths and says in a clause that restore-defaults (#218) re-activates the team's own rows and does not copy template text. See Findings |
| 1.12 | `routes/__tests__/assign-defaults-lock-gate-source.test.ts` | file read | confirmed: pins seven routes; `GATED` has five entries (add, archive, restore, reorder, restore-defaults), each must call the gate; assign-defaults must neither call it nor read lock state (comments stripped). File header comment says "four" (stale) | 8.2 bullet uses "five"; names this file only |
| 1.13 | `assign-defaults-concurrency-integration.test.ts` | file read | confirmed: two simultaneous calls -> one 201 and one 409 `TEAM_HAS_ACTIVE_TOPICS`; a queued `/advance` snapshots the assigned rows; an `/advance` that wins the lock is refused `NO_ACTIVE_TOPICS`; nothing on archived topics or the template-edit chain | Not named in HLA |
| 1.14 | `zero-topic-invariant-integration.test.ts` | file read | confirmed: on a locked one-topic team, delete/archive, reorder, restore, add and annotate attempts are refused (403 or 409) and the count stays one; on an unlocked team archiving the last active topic is `409 TOPIC_LAST_ACTIVE`. Fixed scenarios | Not named in HLA |
| 1.15 | #271 structural test (`audit-log-reader-structural.test.ts`) | file read | confirmed: every touch of `audit_log` (a reader, not a writer) in production backend source must be inventoried; non-admin-serving readers must filter `operation` by equality on one non-admin operation; admin-only entries are trusted for what they return (known limits listed in the file) | "no `audit_log` reader outside the #271 inventory" worded as readers, stated outside the tamper-evidence bullet |
| 1.16 | Contradiction search | `grep -rniE "no bypass\|bypass\|cannot be (changed\|added)\|including admin\|applies to all roles\|admins? cannot\|customization lock" requirements/` plus read of locked/admin/topic hits across `requirements/` (BRD, `use cases/`, `design/`, personas) | confirmed: no contradiction. Use case 08 already says assign-defaults is the lock's single exception and "archived rows are unchanged"; REST API Contract TOPIC-008 says the same; BRD FR-8.2 and FR-8.6 do not conflict | No edit outside the HLA |
| 1.17 | Amend contradiction lines | none named | no edit | |

## Findings for the user

1. Item (d) wording conflict (row 1.11e). `design.md` lists restore-defaults (#218) among the default-copy paths. In code it re-activates the team's own archived default rows and never reads the template, so the "trust anchor" claim was dropped for it. The HLA names #218 only to say that. If you would rather #218 be removed from item (d) entirely, `design.md` and the 3.5 check (which expects #218 in item (d)) need amending.
2. Template validation (row 1.5). Not bypassed, but the template path (`validateTextField`) enforces a plain-text rule and smaller limits that ordinary custom topics (`validateAddCustomTopicBody`) do not. Ordinary topic text is length-checked only. Not a #296 change; possibly a follow-up (rendering as text is the real stored-XSS control per the #216 spec).
3. An empty template is not reachable through the #216 API (last-active guard and backstop); only a direct database change or migration gets there. The design caveat ("recovery unavailable while the template is empty") is kept as written because the behavior is real.
4. Role freshness. The database read is per request, but `users.global_role` only changes at interactive sign-in, so an IdP-side demotion can take up to about 90 minutes to reach it (`docs/deployment.md`). Not in the HLA text (`design.md` is the only wording source); relevant to the stolen-admin-session caveat.
5. Stale comments in code (no code change here): `assign-defaults-lock-gate-source.test.ts` header says "four" gated writes (body asserts five); the assign-defaults route comment says "four other lock-gated writes".
6. Expected zero-topic count was not measured (no dev or staging database queried).
7. Session posture (1.7): assign-defaults relies on the SameSite=Strict cookie session and, unlike the #216 maintenance routes, does not require the `X-Requested-With` mutation-control header. Not in the HLA; mention to Security if useful.

## Section 2 and 3 record

- D5 / 2.4: "archived rows are left in place" KEPT (handler inserts only and counts only active rows).
- 3.1 Drift: greps of 1.2, the GATED count (five), #131 (OPEN) and the 1.11 baselines re-run after drafting: no drift. Controls cell, item (b) and the 8.2 bullet use only rows marked confirmed; the dropped row (1.11e, restore-defaults as a template copy path) is not claimed.
- 3.2 Over-claim sweep: hits are "Preventive" (controls cell), "not preventive" (items (e), (f)), "cannot" in the intro and item (b) (supported by 1.3). Nothing called "safe".
- 3.3: "covered by" and "not separately re-accepted" only; no "accepted by".
- 3.4: step-up / second approver hits are the single-admin caveat and a reopen trigger only; "advisory" appears once ("per-team advisory lock"), no isolation claim; no frozen/lockout/empty team; no persona, first-person, pr-notes or follow-up words.
- 3.5: no "http", no line numbers, no numeric limits. #200, #208, #216, #271, #131 present in 8.1.1; #215 and #218 in item (d). One test file named: assign-defaults-lock-gate-source.test.ts.
- 3.6 to 3.9: rating sentence, single-admin "step-up", trust-anchor, fail-closed versus best-effort, "abuse bound", "regression guard" present; items (a) to (h) each one labelled bullet; (f) has nine bullets (limiter and #271 reader statements sit in a separate paragraph under (f), outside the bullets); (g) one sentence with all four required phrases; (h) diffed against the design.md paragraph: identical; table row has three cells and the table now has eight rows (baseline seven plus one); 8.2 has one added bullet ("pins", five).
- 3.10: no hunks in 8.3, 8.4, BRD, or the existing 8.1 rows (diff has two hunks: the new row and the 8.2 bullet, plus the new 8.1.1 subsection).
- 3.11: `git diff --stat main` lists only `requirements/High-Level Architecture.md`; untracked change directory otherwise. No `specs/` directory.

## Implementation-review rework (Marcus)

- Ingrid ruling applied: `design.md` item (d) bullet corrected (restore-defaults #218 is a non-copier, still named in (d)); note added to "Design review resolution". Nits: (e) run-on split into two sentences; "(this endpoint only)" reworded to "(this applies to this endpoint only)" in the denial-rows bullet.
- Security C1 applied in `design.md` first, then mirrored verbatim in the HLA: item (c) sentence, stolen-session bullet in (f), controls cell "(the stored role updates at sign-in)". No figure is given: the D8 rule bans numeric limits in the added text, so the wording is "until the next interactive sign-in" (the roughly 90 minute figure stays in finding 4 here only).
- Security reopen triggers added to (h) in both files: SameSite policy or session transport; how often the stored role refreshes from the identity provider.
- Finding 6 (finding 7 in the Findings list) drafted as follow-up 4; not in the HLA. No GitHub issue filed.
- Security C2 (file issues before merge) and C3 (sign-off log accuracy) remain with the orchestrator and user.

## Section 3 re-run after rework

- 3.1 Drift: only wording changed since the earlier run; no code re-check needed, no new claims beyond finding 4 (already confirmed in 1.6/finding 4).
- 3.2 Over-claim sweep: hits unchanged (controls-cell "Preventive", "not preventive", "cannot" in intro and item (b)); nothing called "safe".
- 3.3: unchanged; "not separately re-accepted" only.
- 3.4: no persona, first-person, pr-notes or follow-up words; no isolation claim; no "accepted by".
- 3.5: no "http", no line numbers, no numeric limits (no minute/hour figure added); one test file named (`assign-defaults-lock-gate-source.test.ts`); #215 and #218 still in item (d).
- 3.6/3.7: (c) now carries the sign-in refresh sentence; (d) names #218 as non-copier; (f) has nine bullets; (h) diffed against `design.md` after adding the two Security triggers: identical.
- 3.8: table row has three cells and is identical to the `design.md` row; table has eight rows (seven plus one).
- 3.9/3.10: diff has two hunks (new row plus 8.1.1, and one 8.2 bullet); no hunk in 8.3, 8.4, BRD or existing 8.1 rows.
- 3.11: `git diff --stat main` lists only `requirements/High-Level Architecture.md`; no `specs/` directory; the change directory is otherwise untracked.
- Result: all checks pass; none failed.

## Sign-off log

It's all good

## Follow-ups filed (user-approved)
- Follow-up 1 (#216 S-B/N-A/N-D threat-model items): #318
- Follow-up 2 (facilitator experience for a zero-topic team): #319
- Follow-up 3 (audit_log immutability): #320
- Follow-up 4 (assign-defaults X-Requested-With header, stale "four" comments): #321
