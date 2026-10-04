# Design Review: Security (Tomás Ferreira, Senior Application Security Analyst)

Change: `238-facilitator-reporting-chain-decision`. I reviewed `design.md`, `proposal.md` (including
Appendices A and B), and `decision-log.md` rows 1–13. I also read #235's unmerged artifacts (read-only
copy), in particular my own `design-review-security.md` S1–S5 and #235 decision-log rows 11–13. I
checked every claim about current behaviour against `packages/backend/src` and the migrations on
this branch. I am not reopening rows 1–13. Where something below needs a decision, it is a question
the rows don't answer.

**Verdict: approve with conditions.** The rule is sound from a threat-model point of view. It only
reads the claim, the IdP stays the single writer, and the result is never more privileged than
what the claim already grants. A conflicted user always ends up with the less privileged option for
the ritual. The conflict also fails closed: a failed audit insert fails the sign-in. The two claims
I was asked to check both hold, with qualifications (see "Claim verification"). One finding, S1,
means row 11's "recreate" step can't be done in the app as built. The design has to say how it
happens before the follow-up issue is filed.

## Claim verification

### Claim A: "A role change caught by the conflict rule never interrupts a session already past room-open"

**Confirmed for session control and live-event delivery.** Below are the code paths and what each
is keyed on.

| Surface | Authorization key | Reads live `global_role`? |
|---|---|---|
| WS subscriber grant, Path 3 (`auth/session-subscriber-access-helper.ts:119-130`) | `sessions.facilitator_id = userId` and status in `lobby…wrap_up` | No. `actorGlobalRole` is carried but never gates |
| WS periodic sweep (`realtime/connection-reauthorization.ts:73-76`) and per-event dispatch (`realtime/ws-event-dispatcher.ts:143,175,228,322,345,398`) | Same helper | No |
| `POST /sessions/:id/start` (`routes/facilitator-sessions.ts:1073`) | `facilitator_id` | Read at 1093 for the audit row only |
| `POST /sessions/:id/begin-voting` (`:1364`) | `facilitator_id` | Read at 1384 for audit only |
| `POST …/complete` (`:1578`) | `facilitator_id` | Read at 1595 for audit only |
| `POST …/reveal` (`:1767`) | `facilitator_id` | Read at 1839 for audit only |
| `POST …/topics/advance` (`:1986`) | `facilitator_id` | Read at 2009 for audit only |
| `GET …/facilitator-state` (`:2339`), `GET /sessions/:id/action-items-review` (`:1188-1202`), roster (`:1278`) | `facilitator_id` / subscriber grant | No |
| Team content, Path 3 (`auth/team-content-access-helper.ts:207-243`) | `facilitator_id` plus status | No |

Contrast: the **draft → lobby** transition does read the live role (`facilitator-sessions.ts:846-889`,
`session.advance_denied_role`). That matches row 11 and #235 Decision 12.

**Qualifications, which the record should name so the AC 10 test covers the right surface:**

1. **Retained access is more than "running the room".** Path 3 of `evaluateTeamAccess` also
   gives:
   - per-voter attribution for that session (`routes/content.ts:950-971`: `voter_id` and
     `display_name` with `vote_value`);
   - every team action item with owner names (`content.ts:465-505`);
   - team trends (`content.ts:398`).

   This continues for **30 minutes after completion** (`facilitator-sessions.ts:1615`,
   `facilitator_access_expires_at`). See S3.
2. **Retention has no time limit while the session is non-terminal.** Nothing in `src/` writes
   `'abandoned'` or deletes sessions. A lobby the now-EM user never advances keeps their Path 3
   grant on that team indefinitely. See S3.
3. **Facilitator-path surfaces that *do* change with the role.** These aren't session control,
   but they show the claim is "session control and live events", not "everything a facilitator
   had":
   - TOPIC-001 `GET /teams/:id/topics` denies a facilitator-path caller whose global role is EM
     (`content.ts:164-165`). Only `TopicManagementPage` calls it, not a live-session route.
   - Topic writes and annotations need a live standing `facilitator` role
     (`topics.ts:122`, `auth/standing-facilitator-access-helper.ts:108`, `content.ts:769`).
   - `eligible-for-session` (`facilitator-sessions.ts:2463`).
4. **Frontend (cosmetic).** `SessionLobbyPage.tsx:70` `reauthRoleProxy` derives the re-auth
   prompt's role from `canFacilitateSessions` (`routes/auth.ts:742`). A conflicted facilitator who
   re-authenticates mid-lobby sees the *participant* variant of the re-auth copy. Once the user is
   back, the server sends `isFacilitator` from the subscriber grant, so control isn't lost. Note it
   for the AC 7 and AC 10 tests (re-auth return path).

### Claim B: "A re-resolved EM is blocked by the no-manager participation checks"

**Confirmed.** Every participation path checks `users.global_role` as well as the membership
role. A conflicted user who resolves to EM is therefore blocked even if they have no EM membership,
or have a `participant` membership:

| Check | Location |
|---|---|
| Participant registration | `routes/sessions.ts:146-151` (`global_role !== 'engineering_manager'`), audited as `session.participant_registration_rejected` |
| Vote lock-in, before the `INSERT INTO votes` at `:455` | `routes/sessions.ts:379-383` |
| Live-event participant grant | `session-subscriber-access-helper.ts:155-160` |
| Facilitator roster | `facilitator-sessions.ts:1298` |
| TOPIC-001 member path | `content.ts:160-163` |

Session-creation entry points are blocked server-side as well as hidden:
- `POST /draft` (`facilitator-sessions.ts:318`)
- `POST /teams` (`:547`)
- room-open (`:858`)
- `eligible-for-session` (`:2463`)

So the design's defence-in-depth argument holds: for the pair, the no-manager block no longer rests
on membership rows alone. Votes locked in *before* the re-resolution are kept (`sessions.ts:376-378`).
That is existing, accepted behaviour.

## Findings

**S1 (Medium, condition): row 11's "recreate" can't be done in the app. The stranded draft has to
be disposed of out-of-band, and today that would be an unaudited privileged write.**
- `sessions_team_active_unique` covers `'draft'` (`migrations/10_sessions_team_active_unique.sql:63-65`).
- Another facilitator's `POST /draft` for the same team therefore returns `409
  session_already_exists` (`facilitator-sessions.ts:~420-442`).
- No code path moves a draft to `abandoned` or deletes it.
- The 24-hour draft expiry is read-time only (`facilitator-sessions.ts:241-256`) and doesn't free
  the index.

The notice ("arrange another facilitator"), the AC 8 copy ("Another facilitator will need to run
it") and the pre-launch step ("a human arranges for another facilitator to recreate each hit") all
assume something the system won't allow. The workaround is an operator `UPDATE sessions` by hand.
I don't accept that unless it is defined and audited.

This does not reopen row 11, because there is still no reassignment. Fix in Appendix B and D5:
- add a defined operator procedure to the pre-launch step and the docs troubleshooting entry:
  `UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE id = $1 AND status = 'draft'`
  (the `migrations/2_create_tables.sql:78` CHECK requires `abandoned_at`);
- write a matching manual `audit_log` row (operator identity, `session_id`, `team_id`, reason
  `role_conflict`);
- record it on the issue.

If the user would rather have an in-app "abandon draft" action, that goes beyond the scope freeze
and is their decision. Either way, the copy must not promise something a second facilitator can't
do.

**S2 (Medium, implicit decision): "drafts stay blocked" is true only at room-open. The draft's
team-content grant survives re-resolution for up to 24 hours.**
- `evaluateTeamAccess` Path 3(b) (`team-content-access-helper.ts:216-221`) admits
  `facilitator_id = user` for a draft younger than 24 hours, with no `global_role` predicate.
- The holder can read the target team's full action-item list with owner names and its trends
  (`content.ts:398, 465`).
- A user the conflict rule now treats as a manager (possibly over a sibling team) keeps that read
  access to a team they don't manage until the draft ages out.
- The exposure is bounded: read-only, at most 24 hours, and no per-voter data (a draft has no
  votes). #235 Decision 12's revocation case inherits the same gap.

Rows 1–13 don't cover this. It needs an owner's explicit choice, recorded in 01c "Sessions":
- (a) **accept** and state the 24-hour bound; or
- (b) add one predicate to the follow-up's scope: Path 3(b) requires live
  `global_role = 'facilitator'`. That is a one-line SQL change, and it doesn't touch sessions past
  room-open.

I recommend (b). It is a security AC, not a feature, so I don't think it breaks the scope freeze.
The decision belongs to the user.

**S3 (Low, implicit): state the full extent and duration of what "stays with the facilitator"
covers.** D5 and row 11 say "sessions already past room-open stay with `sessions.facilitator_id`".
01c should list what that includes (qualifications 1–2 above):
- control;
- live events;
- per-voter attribution for that session;
- team action items and trends;
- 30 minutes after completion;
- no limit while the session is non-terminal.

Recording this is what makes it a decision rather than an emergent property, which is D5's own
goal. To make it visible without interrupting anything, add to the docs troubleshooting entry a
read-only query: non-terminal sessions whose `facilitator_id` has a `<conflict audit operation>`
row. That fits the existing "audit-log query, no in-app view" non-goal.

**S4 (Low): make the audit-content rule precise, and test it at the boundary that matters.** The
Appendix B metadata `{ oidcSubject, appliedRole, conflictingRoles, previousRole, correlationId }`
contains no raw role-claim values. Good. Three tightenings:
- **Wording.** `oidcSubject` *is* a raw ID-token claim value (`sub`). It is the established
  identifier in every auth row (`routes/auth.ts:329, 345, 368, 383`). The rule should read "no raw
  **role-claim** values", so an implementer neither drops the subject nor reads the rule loosely.
- **`conflictingRoles` is a code constant.** It is the literal `["engineering_manager","facilitator"]`,
  never built from the claim array. That keeps claim order, duplicates and near-miss variants out
  of the row.
- **AC 4's negative test** covers `superuser`. Also assert that the case variant `Facilitator`
  (rule-table row 10) and the string-claim form (row 11) appear in neither the row nor the log.

Optional: add a `roleConflict: true` boolean to the existing `session.advance_denied_role`
metadata (`facilitator-sessions.ts:863-874`). That lets an incident reviewer join a refused
room-open to its cause without a time-window correlation.

**S5 (Low, implicit): name where the "conflict flag" lives.** AC 8 ("the user's last sign-in
recorded a conflict"), the notice and the scope (`ResolvedUser` flag) don't say where the state
is kept between sign-in and later requests: the server session, an `audit_log` lookup or a column.
Requirements:
- it must be server-side;
- it must never come from the client (query parameter, local storage);
- it must select **copy only**: the 403 decision at `:858` stays a pure live-`global_role` check.

Add that sentence to Appendix B.

**S6 (Low): make the dependency on #235 D9 an explicit precondition.** The conflict record is only
trustworthy evidence if the claim's signature is verified. #235 Decision 11 / D9
(`enableNonRepudiationChecks`) does that. "Blocked by #235" implies it today. If #235 is ever split
and D9 slips, #NNN must not ship ahead of it. One line in the Appendix B header.

**S7 (Info): the dev simulator persona (AC 11) and #239.** The both-roles persona resolves to
`engineering_manager`, which is less privileged than the existing `facilitator-001`. The dev-guard
gaps tracked in #239 (my #235 S5) therefore get no worse. No action.

## Document consistency (security-relevant)

- `design.md` Context says "rows 1–11", and the proposal header says the same. The log now has 13
  rows. Row 13 changes the security posture: residual gaps 1 and 2 have **no pre-launch control**
  and rely only on the docs warning.
- Proposal Open item 2 is still listed as open, with "Ask before adding". Row 13 resolved it (No).
  Move it to "Closed since exploration".
- 01c §8 should record gaps 1–2 as **accepted risk (decision-log row 13, the user)**, so a later
  auditor can see it was accepted rather than missed.
- Exploration §4 (line 147) asks Security to confirm the live-session rule (Facilitator Q3). It is
  confirmed above, with S2 and S3 attached. Record that in the review disposition.

## Threat-model impact

| Area | Assessment |
|---|---|
| Authentication | Unchanged. Same callback, same token validation (with #235 D9). The rule acts after allowlist filtering and changes only how the claim is read. |
| Privilege direction | The result is never more privileged than what the claim already grants. EM access to a team still needs the dual check (`team-content-access-helper.ts:167-175`), so the conflict grants no EM content access without an admin-recorded EM membership. |
| Authorization boundaries | Server-side throughout (Claims A and B). Exceptions to close: S1 (no disposal path) and S2 (draft read grant). |
| Audit | Fail-closed transactional row, field set equal to the log line, one row per sign-in. Good. Tighten with S4 and S5. |
| Interim window | Controlled only by the human launch gate (row 8) and the #235 log line. Nothing technical enforces it. Accepted per row 8. |

## Deferred or implicit security decisions

1. Draft disposal mechanism (S1). **Must be defined before #NNN is filed.**
2. Draft-path read grant after re-resolution (S2). **Needs the user's decision.**
3. Scope and duration of access past room-open (S3). Implicit; state it.
4. Where the conflict flag lives, and that it selects copy only (S5). Implicit.
5. Residual gaps 1–2 have no pre-launch control. **Explicitly accepted (row 13).** Record it as
   accepted risk.
6. Operator alerting on the conflict event. Deferred to operators (#235 Decision 9). Accepted.

**Conditions to proceed:**
- Fix S1 in D5 and Appendix B (operator procedure plus audit row, and copy aligned with it).
- Get the user's call on S2 and record it.
- S3–S6 and the consistency edits are text changes for the author.
