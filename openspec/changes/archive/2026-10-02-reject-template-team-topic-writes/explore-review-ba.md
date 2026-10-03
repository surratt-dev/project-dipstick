# BA review of exploration notes: reject-template-team-topic-writes (#188)

Reviewer: Marcus Delgado (Business Analyst), 2026-10-02
Reviewed: `exploration-notes.md` (Devon Calloway)
Question asked: are the ideas specific enough to become requirements?

## Verdict

Mostly yes. The code analysis is precise. The endpoint table, the check order, the seeding SQL
and the test-setup recipe can go into a proposal nearly as written. The gaps are in what the notes
leave undecided or describe loosely: audit behaviour, how the "structural" test works, which
outcomes the timing rule covers, how the five existing check-order specs get amended, and whether
the template is already damaged. The open questions in §5 have to be answered in the proposal, not
in design. Each one changes what gets observed at the API.

---

## 1. Clarifications needed (decide before the proposal)

| # | Question | Why it blocks | My recommendation |
|---|---|---|---|
| C1 | Is a rejected template write audited? (§5) | Whether an audit row exists is observable behaviour. Every scenario's THEN clause depends on the answer. | Audit it, under a new operation `topic.write_denied_template`, written before the response is sent, matching the lock-denial pattern. The response must still be identical to a missing-team 404 (see R4). If the team decides against auditing, say so in the spec as a decision with its rationale, not as an omission. |
| C2 | Where does the guard sit relative to authorization? The diagram puts it after auth. The notes never say what an unauthorized caller sees. | Without this, some implementations will return 404 to everyone and others will return 403 to unauthorized callers. | Keep it after auth. A non-facilitator, or a facilitator who is a team member, still gets 403. An admin calling TOPIC-007 still gets 403 (FR-8.7). Write these as explicit scenarios. |
| C3 | Option A or B? (§3) | This is a design choice and should not appear in requirements. But the requirement has to be written so that either option satisfies it. | Write the requirement in terms of behaviour, as in R1 below. Leave A or B to design.md. Make the structural test (R6) mandatory either way. |
| C4 | Is the template already damaged? The notes show a facilitator could have unlocked and edited it through the normal API (§2). Nobody has looked at the current data. | If the template has already drifted, the guard locks the damage in. FR-8.1 and use case 08 ("canonical order") would be violated starting today. | Add a task: run a read-only comparison of the sentinel's `topics` rows against `4_seed_data.sql` + `11_default_topics_correction.sql`, and check for any `sessions` row whose `team_id` is the sentinel, in every environment. Record the result in the proposal. If drift is found, open a separate remediation issue. Do not quietly fix data inside this change. |
| C5 | The 500-on-team-creation claim (TOPIC-006 after TOPIC-004) and the draft-session unlock path have not been run. | The proposal's risk statement must not claim more than was verified. If the claim is wrong it weakens the case. If it is right it raises the priority. | Either run the spike before the proposal, or label both as "inferred from code, not reproduced" in the proposal's Why section. The fix is justified either way. |
| C6 | Should the draft-session gap (§4.1) become an issue now? | Traceability: without an issue, the root cause has no owner. | Yes. Acceptance condition: the follow-up issue exists and the proposal links to it by number. Do the same for §4.2 (join-links, managers, role PATCH). One issue covering "the template team is not a real team" is enough. |

---

## 2. Vague areas and suggested rewrites

### V1. "every topic-write endpoint"
Vague: it does not say whether this means the five endpoints that exist today or any future one.

Rewrite: *Every endpoint that creates, updates, archives, restores, reorders or annotates a
`topics` row on behalf of a team. Today these are TOPIC-003, 004, 005, 006 and 007. Any endpoint
added later that writes `topics` for a `:teamId` is covered by the same rule. Read endpoints
(TOPIC-001, TOPIC-002, the all-topics GET) are explicitly out of scope and continue to serve the
template. FR-8.6 requires the default set to remain visible.*

### V2. "a structural test that enumerates every registered topic-write route"
Vague: it does not say how routes are enumerated. If someone hand-maintains the list, that is the
same "remember a sixth call" problem Option A has.

Rewrite (acceptance condition): *The test obtains the route list from the running Fastify
instance, not from a hard-coded array. It selects every route whose method is POST, PUT, PATCH or
DELETE and whose path starts with `/api/v1/teams/:teamId/topics`. For each one it sends a request
with `teamId = DEFAULT_TOPICS_TEAM_ID` as an authorized caller and asserts `404 TEAM_NOT_FOUND`.
The test also asserts that the selected set is not empty and contains at least the five known
routes, so a broken filter cannot pass by matching nothing.*

### V3. "must still match a missing team's 404 in timing and body"
Vague: "match in timing" has no test that could fail.

Rewrite, using the wording the existing specs already use: *The template rejection returns
exactly the same status, envelope and headers as a nonexistent team: `404`,
`{ error: { category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found.",
correlationId } }`, and `Cache-Control: no-store`. It applies `applyTimingFloor`, the same as every
other early return. If it is audited (C1), the audit write happens before the floor is measured,
so it is covered by the same floor. No other timing guarantee is added.*

### V4. "the template's rows are unchanged"
Vague: it does not say which columns are compared, or whether row count is checked.

Rewrite: *Before and after each rejected request, the test snapshots every column of every
`topics` row where `team_id = DEFAULT_TOPICS_TEAM_ID`, ordered by `id`. That includes `status`,
`display_order`, `is_default`, the annotation columns and any `updated_at`. The two snapshots
must be deep-equal, and the row count must be unchanged.*

### V5. "no success audit row exists for the sentinel"
Vague: it does not say which operations count.

Rewrite: *After each rejected request, there is no `audit_log` row for the sentinel team with
that endpoint's success operation, using the name given in that endpoint's spec. There is also no
`topic.write_denied_locked` row. If C1 is answered "audit", there is exactly one
`topic.write_denied_template` row naming the caller and the endpoint.*

### V6. The behaviour change for `topic.write_denied_locked`
The notes call this "a small behaviour change worth stating". It needs a scenario, not a
footnote. Rewrite: *GIVEN the template team with zero completed sessions, WHEN an authorized
facilitator calls any topic-write endpoint on it, THEN the response is 404 TEAM_NOT_FOUND and no
`topic.write_denied_locked` audit row is written.* This scenario replaces the guarantee in test
5.6 and states the change explicitly.

### V7. "independent of session history"
This is correct, but it has to be pinned to both states. Rewrite as two scenarios per endpoint:
one with no completed session for the sentinel (today's state) and one with a completed session
inserted (the exploit state). Both expect the same 404. The second is the one that proves the
guard does not depend on the lock.

### V8. The harmless-request table (§3), TOPIC-006 row
"No-op order, 200" is not clearly harmless. A no-op reorder might still write an audit row or
bump `updated_at` if the guard regresses. Rewrite: *Use a mismatched id set for 006. Without the
guard it yields `409` STALE and never writes, so a regression cannot change the template.* Keep
the other rows as written.

### V9. Spec placement (§6)
The notes leave it open: lock spec, or a new capability. One point is missing. Each of
`add-custom-topic`, `remove-topic`, `restore-topic`, `reorder-topics` and `topic-annotation`
states a numbered check order and calls it canonical ("stated once, here"). If only a new
requirement is added somewhere else, those five specs will contradict the new behaviour.

Rewrite: *Add one requirement that owns the rule. My preference is `default-topic-provisioning`,
because it already owns the template. Then MODIFY the check-order requirement in each of the five
endpoint specs to insert "(2a) template team → 404 TEAM_NOT_FOUND" between team existence and the
customization lock, citing the owning requirement.* Do not put the rule in
`topic-customization-lock`. The point of this change is that the protection is *not* the lock, and
filing it there brings back the conceptual coupling we are removing.

### V10. FR-8.1 tension (§4.4)
The intent is right. It needs exact wording, and it should be traceable from the BRD as well.
Suggested spec sentence: *The team-scoped topic-write endpoints are not the Application
Administrator maintenance path that FR-8.1 refers to. If that path is built, it SHALL be a
separate endpoint with its own authorization and audit. This guard SHALL NOT be relaxed to serve
it.* Also add a one-line rationale under FR-8.1 in `requirements/BRD.md` pointing at this change,
the same way FR-8.7 carries a rationale for #53.

### V11. Parallel-test safety: "check that no other test file relies on the sentinel being locked"
Make it a task with a concrete output: *grep the test suites for the sentinel literal and
`SENTINEL_TEAM_ID`, list every hit in tasks.md with "unaffected" or "updated", and confirm 5.6 is
the only lock-dependent assertion.* The completed-session fixture row must be removed in a
`finally` block, and the test must not depend on `afterAll` running.

---

## 3. Items that are specific enough already (carry forward as-is)

- Endpoint inventory and per-endpoint auth table (§2).
- Guard is a constant comparison against the imported `DEFAULT_TOPICS_TEAM_ID`, no DB query, no new literal.
- Test 5.6 changes from expecting 409 to expecting 404 `TEAM_NOT_FOUND`.
- Facilitator and admin variants for 003 to 006; facilitator only for 007.
- Fixture SQL for the completed sentinel session.
- §4.3, §4.5 and §4.6 kept out of scope as noted.

## 4. Edge cases I would add as scenarios

1. A facilitator who becomes the template's "member". This cannot happen today, but state that the
   guard holds whatever `team_memberships` contains for the sentinel.
2. An admin calling TOPIC-007 on the sentinel gets 403 (FR-8.7), not 404. Confirms C2.
3. A non-canonical spelling of the sentinel ID (no hyphens, wrapped in braces) is still answered
   by `rejectNonCanonicalTeamId` with 404. Add one test so the two guards are known to compose.
4. After the change, `POST /api/v1/teams` still copies the template correctly. Add one regression
   test that creates a team and compares its topics against the template, so the guard's purpose
   is tested end to end and not only at the rejection.
