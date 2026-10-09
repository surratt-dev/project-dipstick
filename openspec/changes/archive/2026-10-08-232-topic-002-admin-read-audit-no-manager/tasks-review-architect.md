# Tasks review: Solution Architect

*Ingrid Sollenberger (Principal Solution Architect). I reviewed `tasks.md` against `proposal.md` and `design.md`, and I checked the code anchors in the working tree on `agent-team/232-topic-002-admin-read-audit-no-manager`. The question I was asked is narrow: does the task order respect the architectural dependencies, and which tasks can't an implementing agent do?*

## Verdict

**Approve with changes. One ordering defect is blocking.** The sequence is mostly right:

- registration comes before use
- the predicate comes before the handler
- tests come after the behaviour they pin
- docs come after the behaviour they describe
- verification comes last

The plan's own rule is "every task leaves the suites green". It is broken in one place: the atomic unit doesn't include the parity-test fake, and that fake goes red as soon as the handler changes. The unit can also be made smaller than written. The hand-off work in 8.4 is already framed as drafting, which is correct. It needs a stated destination and an explicit "do not post" line.

## What I checked and found sound

| Dependency | Status |
|---|---|
| `AuditEventName` union (task 1) before any `emitAuditEvent` call that uses the new names (task 2). `emitAuditEvent(logger, event: AuditEventName, …)` is typed, so task 2 wouldn't type-check without task 1. | Correct order. Task 1 is green on its own (union members and comments only). |
| `readActiveMembershipRole` (`auth/team-content-access-helper.ts:275`), `parseRoleArray` (`auth/role-map.ts:357`), `applyTimingFloor`, `hasEnvelopeMessage` (`TopicManagementPage.tsx:214`) all exist. | Nothing in tasks 2 or 6 assumes something unbuilt. |
| `audit_log.actor_roles` already exists (migration 22). | No migration task is needed. Correct. |
| `audit_log.actor_user_id` / `team_id` have no FKs (migration 8). | New rows written by existing real-PG suites won't break their `DELETE FROM users/teams` cleanups. |
| 2.1 predicate → 2.2 deny branch → 2.3 accept path → 2.4 failure signal | Correct internal order, and all inside one unit. |
| Frontend (6) depends only on the contract (envelope + message), not on the backend build. | Independent. It could run in parallel with 2–5. |
| 8.1 empty-diff check on the shared helper and `topics.ts` | Correctly placed as a gate, not a task that edits anything. |

## Blocking

### B1. The atomic unit leaves out task 4.1, so the parity suite goes red between task 2 and task 4

`topic-add-flag-parity.test.ts` drives TOPIC-002 through a SQL-routing fake whose fall-through is `return Promise.resolve({ rows: [] })` (L52). The new role-set read, `SELECT roles::text[] AS roles FROM users WHERE id = $1`, matches none of the fake's routes:

- The helper's route needs `FROM users u` **and** `team_memberships`.
- The new read contains neither `FROM users u` nor `team_memberships`.

So it falls through to `{ rows: [] }`. The D5 zero-row rule (`rows.length !== 1` throws) then turns both existing admin rows ("application_admin" and "application_admin who is a member of the team", L122–127) into `500`, and both expect `get: 200`.

D6 means this to happen ("an unrouted query fails the test instead of passing"). But it means the suite **cannot** be green between the end of the 2.x unit and task 4.1.

**Fix:** move 4.1 into the atomic unit. 4.2 adds the `{ get: 403; post: 201 }` shape and the new rows, and it can stay a separate, later task. It passes only after the handler exists, and it isn't needed to restore green.

### B2. Say which suites the atomic unit must leave green

The header says "every task must leave the full backend and frontend suites green". The unit's description names only `content.test.ts`. The handler change also affects real-Postgres suites that call TOPIC-002 as an admin:

- `topic-add-admin-integration.test.ts` L147: admin `GET …/topics/all`
- `topic-annotation-integration.test.ts`
- `restore-topic-integration`, `remove-topic-integration`, `topics-integration`

I checked each of them. None counts `audit_log` rows without an `operation` filter in a way the new access row would break:

- `topic-annotation-integration` L388 reads every row for the team, but asserts only text-freedom and a filtered count.
- `template-team-topic-writes-integration`'s `auditRowsSince` counts every row for an actor, but its admin cases hit write endpoints, not TOPIC-002.

So I expect them to stay green. "Expect" isn't evidence, though.

**Fix:** end the atomic unit with an explicit step to run the full unit **and** integration suites. Don't defer that run to 8.2, and don't rely on 5.3's "confirm … pass unmodified". Also add `template-team-topic-writes-integration` and `template-team-read-surfaces-integration` to 5.3's list. Both touch `/topics/all`, and 5.3 omits them.

## Should fix (ordering and splitting)

### S1. Pull 3.0 out of the atomic unit and make it the first task of section 2

As written, 3.0 is numbered under section 3, but the unit text says to do it first. An agent that works top-down starts at 2.1. **Renumber it 2.0, or move it to the top of section 2.**

3.0 can also be its **own green step**, which shrinks the unit:

- The SQL-text router answers every query the *current* handler issues: the helper row, the team name, active, archived, defaults and lock state.
- The routes for the membership read, the role-set read and `INSERT INTO audit_log` simply go unused until the handler calls them.
- The "fail on unrouted SQL" rule doesn't fire, because the old handler issues nothing new.

Migrating the existing admin tests onto the router is therefore a pure refactor, green against today's handler. Do it and commit it as a checkpoint.

The atomic unit then becomes **2.1–2.4 + 4.1**. That is smaller and easier to review. The migrated admin tests stay green across it, because the router already answers the new queries: membership `null`, role set `{application_admin}`, insert OK.

### S2. Fold 7.7 into 2.2/2.3

7.7 ("the TOPIC-002 handler's authorization comment cites #232 and the #208 boundary; the `canAddTopics` comment notes that an admin with an EM membership never reaches it") edits `content.ts` again, after the tests are written. 2.1 and 2.2 already require the predicate and handler comments. Comments should land in the same change as the code they explain, not five tasks later. Move 7.7's two comment requirements into 2.2 and 2.3, and delete 7.7.

### S3. Decide the export question in 2.1 now

"Exported for tests only if the file's existing pattern allows" leaves a decision to whoever types first. D3 says the tests **import** the message constants. They can't do that unless the constants are exported. **State "export them".** If someone objects to exporting from a route module, they can raise it at code review. The task shouldn't leave it to chance.

### S4. Decide the file choice in 5.1

"New file … or a new `describe` in `topic-annotation-integration.test.ts`" is another implicit decision. The task already says a new file must copy the `cleanup`-by-`actor_user_id` helper. The suite has eight callers and its own fixtures, and it is the evidence for a HARD-rule fix. **Choose the new file** (`topic-002-admin-audit-integration.test.ts`). Then the evidence is findable by name, and a later edit to the annotation suite can't weaken it by accident.

### S5. Task 7.8 undercounts what changes in `docs/deployment.md`

- The log-only tally on L293 has a sub-count as well as the total: "Seven further events are also log-only: … five unrelated to the auth/join trail. In total, 13 …". Adding `admin.audit_write_failed` changes **both** the sub-count and the total, not only "13 → 14". The task should say "re-derive the counts from the list" rather than hard-code 14. If another change lands first, a hard-coded 14 would be wrong.
- L291 lists "admin reads" among events that write an `audit_log` row "in the same transaction as the state change". D8 says this is not true for admin reads: they are written after the read, before the send, fail closed, with no transaction. The task already edits the `actor_roles` sentence in that paragraph, so it should correct this clause too. Otherwise the deployment doc contradicts the spec wording this change corrects.

### S6. Wording fix in 6.2

"In both cases there is no topic list …" follows **three** cases. Change it to "in all three cases". Otherwise an agent may assert the no-data render for only two of them.

## Tasks an implementing agent cannot do (draft, don't perform)

8.4 already says "Prepare, **for a human to post**". That framing is right. It needs these additions:

| Item | Problem | Change |
|---|---|---|
| 8.4 (all of it) | No destination for the drafts. An agent will either print them to scrollback, where they get lost, or reach for `gh`. | Name one file, e.g. `openspec/changes/232-…/handoff-drafts.md`, holding the #208 comment, the #238 comment, the three follow-up issue bodies and the PR description. Add: "Do not run `gh issue comment`, `gh issue create` or `gh pr create`. Posting, filing and opening the PR are the human's (or orchestrator's) step." |
| 8.4 PR description / AC1 | The alternative, "Brian amends AC1 on #232", is a human action. | Draft the deviation sentence only. List "or Brian amends AC1" as a human option in the hand-off file. |
| 7.8 review-query owner | "Brian confirms the owner". An agent can't get that confirmation, and it must not write the owner as confirmed. | Write the doc line as "**Proposed:** Security (Tomás Ferreira), monthly, no alerting. Pending owner confirmation." Add "confirm the review-query owner" to the hand-off file as an open human decision. Per the design's Open Questions, the PR may merge with "proposed" but not with the line missing. |
| 8.4 release-note gate | Unblocking #187 Follow-up 5's release note happens after merge and is a human step. | Keep the approved wording in the hand-off file. The agent edits no release notes in this change. |
| 8.4 #208 scheduling | Asking for #208 to be scheduled in the current milestone is a request inside the drafted comment. Scheduling is Brian's call. | Already framed that way. No change, beyond making sure the draft doesn't present scheduling as decided. |
| Proposal follow-ups 4, 5, 6 (optional issues) | They aren't in 8.4 at all. That means they're silently dropped, not explicitly deferred. | List them in the hand-off file as "optional, not drafted", so the human decides and doesn't simply forget them. |
| 8.3 guard sweep | Running the grep and classifying the hits is agent work. Only the destination is unclear. | Put the classification table in the drafted PR description in the hand-off file. |

## Suggested revised order

1. **1.1, 1.2:** register the operations (green on their own).
2. **2.0** (was 3.0): build the SQL-routed fixture and migrate the existing admin TOPIC-002 tests onto it. This is a green checkpoint against the current handler.
3. **Atomic unit: 2.1, 2.2, 2.3, 2.4 + 4.1**, with 7.7's comments folded into 2.2 and 2.3. Close the unit by running the full unit and integration suites (B2).
4. **3.1–3.7:** new unit tests.
5. **4.2:** the parity split row and the global-EM rows.
6. **5.1** (new file), **5.2**, **5.3** (with the two added suites).
7. **6.1, 6.2:** frontend. These can move anywhere after step 1. They have no backend dependency.
8. **7.1–7.6, 7.8:** docs, with 7.8 expanded per S5.
9. **8.1–8.3:** verification.
10. **8.4:** write `handoff-drafts.md`. Post nothing.

None of these changes touches the authorization design. The allow-list, the whole-response deny, its placement after the shared helper, the fail-closed set and the empty helper diff all stand as designed.
