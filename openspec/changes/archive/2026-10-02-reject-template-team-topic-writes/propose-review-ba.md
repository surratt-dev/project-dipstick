# Proposal Review: reject-template-team-topic-writes (#188)

*Reviewer: Marcus Delgado, Senior Business Analyst*
*Artifacts reviewed: `proposal.md`, `specs/*/spec.md` (6 deltas), checked against `requirements/BRD.md` §6.4, FR-8.1, FR-8.2, FR-8.6, FR-8.7, the main specs under `openspec/specs/`, and `packages/backend/src/routes/topics.ts`.*

## Verdict

**Approve with changes.** The proposal is well framed. The "why" ties back to §6.4 and doesn't
just say "security", and putting the rule under `default-topic-provisioning` instead of the lock is
the right call. Most acceptance criteria are explicit WHEN/THEN statements that someone can test.
I found one real defect that contradicts the anti-enumeration constraint (B1). There are also a few
places where the spec states an intent but gives the implementer no conditions to test against.
Those are listed below with concrete wording I'd suggest.

---

## Blocking

### B1. "Identical to a nonexistent team" and "`Cache-Control: no-store`" contradict each other on TOPIC-003/004/005

The proposal (What Changes, bullet 2) and the provisioning spec (**Response**) both say the template
rejection is `404 TEAM_NOT_FOUND` **with `Cache-Control: no-store`**, and that it's identical to the
nonexistent-team response. In the code today, only TOPIC-006 (`topics.ts:1287`) and TOPIC-007
(`topics.ts:1490`) set `no-store`. The add, archive and restore handlers send their
nonexistent-team `404` through `checkTeamExists` (`topics.ts:155`), which sets no cache header. The
main specs for those three capabilities don't require one either.

So on TOPIC-003/004/005 an implementer has to break one of the two rules:
- If they add `no-store` to the template 404, a caller can now tell the template apart from a
  missing team just by looking at the headers. That's the leak the constraint exists to stop.
- If they leave it off, the response doesn't match what the spec says.

The scenario "The rejection is indistinguishable from a nonexistent team" (provisioning spec, line
31) asserts the same `no-store` header for both. Run against TOPIC-003, that test will either fail
or force the leak.

**Suggested condition:** "A rejected request SHALL receive, header for header and field for field
(except `correlationId`), the same response that **the same endpoint** returns for a
canonical-format `teamId` that matches no team." Drop the literal `Cache-Control: no-store` from the
proposal bullet and the **Response** paragraph, or add a separate (out-of-scope) change that puts
`no-store` on every response from 003/004/005. Run the indistinguishability scenario once per
endpoint, five times in total, for every role that passes authorization.

### B2. Audit-write failure behaviour is not specified, and it affects anti-enumeration

The template denial writes a database row, while a missing team writes nothing. If that insert
fails or runs slowly, the template path returns `500` or responds late, and a missing team never
does. The spec says the write happens "inside the timing floor", but it doesn't say what happens
when the write fails, or when it takes longer than the floor.

**Suggested conditions:**
- "If the `topic.write_denied_template` insert fails, the handler SHALL [return the same `404` and
  log the failure | follow the same failure behaviour as `topic.write_denied_locked`]." Pick one
  and write it down. Matching the lock denial is the consistent choice, but then say clearly that
  a `500` on that path is an accepted way to tell the two apart.
- Add a scenario: "WHEN the audit insert throws, THEN the response is …" so the choice gets a test.

---

## Should fix (vague or implicit criteria)

### S1. The scope rule and the structural test cover different sets of routes

**Scope** says "every endpoint that … writes a `topics` row for a `:teamId` path parameter". The
structural test scenario (line 61) only checks `POST|PUT|PATCH|DELETE` routes whose path **begins
with `/api/v1/teams/:teamId/topics`**. A later endpoint that writes `topics` from somewhere else
would meet the rule's wording and still pass the test. Examples: a bulk "reset to defaults" under
`/api/v1/teams/:teamId/topic-set`, or a write that happens inside a session route. The proposal's
promise that "a future TOPIC-008 that skips the guard fails CI" only holds for the path prefix.

**Suggested conditions:**
- State in the spec that the test detects routes by path prefix, and that any `topics`-writing
  route outside that prefix has to be added to the test by hand. Say who owns that list.
- Say how the test builds a request for a route it has never seen. My reading: authorized
  facilitator, `teamId` set to the template, every other path parameter set to a fixed canonical
  UUID, body `{}`. This works because the guard runs before body and topic checks. Write that rule
  into the scenario so the test is deterministic.
- Say whether an exemption list exists. My recommendation is that it doesn't, so any exemption has
  to be a spec change.

### S2. Audit row contents are only partly specified

- `metadata.endpoint`: the spec says "following the shape of `topic.write_denied_locked`". The
  code uses method-plus-path strings (`"DELETE /api/v1/teams/:teamId/topics/:topicId"`,
  `topics.ts:915`). State that explicitly so nobody uses `"TOPIC-004"` instead.
- `metadata.attempted_operation`: the value is only pinned for reorder (`topic.reordered`). Give the
  full mapping: 003 → `topic.custom_added`, 004 → `topic.archived`, 005 → `topic.restored`,
  006 → `topic.reordered`, 007 → `topic.annotation_updated`.
- What metadata leaves out: reorder says "no order payload". Make that general: "metadata SHALL
  contain only `endpoint` and `attempted_operation`. No `topicId`, request body, topic name or
  annotation text."
- "A matching structured audit event SHALL be emitted": the spec doesn't give the event name or
  its fields. Say "same name and fields as the `audit_log` row, emitted via `emitAuditEvent`."
- Only the reorder delta has a per-endpoint audit scenario. The add, remove, restore and annotation
  template scenarios say "no `topic.write_denied_locked` row" but never say "exactly one
  `topic.write_denied_template` row with `attempted_operation = …`". Add that AND clause to all
  four.
- The admin TOPIC-007 scenario (provisioning line 41, annotation line 42) should add "AND no
  `topic.write_denied_template` row is written". The general 403 scenario says this, but the admin
  403 is a different branch.

### S3. The membership-independence scenario doesn't test anything

Line 45 reads: "WHEN `team_memberships` contains, **or does not contain**, rows … and an authorized
caller passes the authorization check, THEN 404". The phrase "passes the authorization check" hides
the one interesting case. A standing facilitator who has an active membership row on the sentinel
fails authorization and gets `403 FACILITATOR_IS_TEAM_MEMBER`. A missing team can never produce
that code, so it's a small existence signal. Probably acceptable, but say so on purpose. Replace the
scenario with three concrete ones:
1. No sentinel membership rows. A non-member facilitator gets `404 TEAM_NOT_FOUND`.
2. The sentinel has an active membership row for **some other** user. A non-member facilitator gets
   `404 TEAM_NOT_FOUND`.
3. The sentinel has an active membership row for **the caller**. A facilitator gets
   `403 FACILITATOR_IS_TEAM_MEMBER`, and an `application_admin` (exempt from the membership check)
   gets `404 TEAM_NOT_FOUND`. Note under Constraints that the 403 in case 3 is an accepted
   difference from a missing team.

### S4. The "reads are unaffected" scenario isn't specific enough to test

"Reads … in a way that includes the template's default rows" doesn't say which endpoints, which
team, or what the expected output is. Suggested scenarios:
- TOPIC-002 returns exactly the same rows and order before and after this change.
- `GET /api/v1/teams/<template>/topics/all` still returns `200` for an authorized caller. State what
  `canAddTopics` returns. On the template it will say `true` when the template has a completed
  session, and every write then returns `404`. That's the "editor with failing controls" state the
  proposal hands to F1. Record it as an accepted known gap here, so QA doesn't file it as a
  regression of #188.

### S5. FR-8.6 "restorable for any team" has no regression scenario

The constraint is listed, but nothing tests it. Add: "WHEN a facilitator archives and then restores
a default topic on an unlocked **non-template** team after this change, THEN both succeed exactly
as before (`200`, `topic.archived` / `topic.restored` audit rows)." That shows the guard is keyed on
the team id, not on `is_default`.

### S6. The team-creation regression scenario needs a defined before state

"WHEN a new team is created after template writes have been rejected, THEN the new team's topics
match the template's `is_default = true` rows…" checks the new team against the template's current
state. If the template has already drifted, the test still passes. The pending ops check is about
exactly that risk. Suggested condition: "GIVEN the template has a completed session, WHEN each of
the five writes is attempted against it and rejected, and THEN `POST /api/v1/teams` is called, THEN
the response is `201`, and the new team's active topics equal a snapshot of the template taken
**before** the attempts (`name`, `prompt`, `vote_type`, `display_order`, `status`)." This also gives
the "team creation breaks for everyone" harm in the Why section a direct test.

### S7. FR-8.1 boundary: the rationale line has to admit FR-8.1 maintainability isn't met yet

FR-8.1 is **[HARD]**: the default set "shall be defined and maintainable by an Application
Administrator". The only accidental admin path to the template today is the one this change shuts
down. After the merge, maintaining the defaults is done by seed or migration only. That's fine,
but the BRD line shouldn't read as if FR-8.1 is satisfied. Suggested wording for the rationale
under FR-8.1:

> *Rationale (added by `reject-template-team-topic-writes`, #188):* the team-scoped topic-write
> endpoints (TOPIC-003 to TOPIC-007) are not the Application Administrator maintenance path and
> reject the template team. Until a dedicated maintenance endpoint exists, the default set is
> maintained through database migrations only, and the "maintainable by an Application
> Administrator" clause is not yet met through the UI.

Also add a follow-up (F5) to build that maintenance path, or link an existing issue, so the HARD
requirement has an owner.

### S8. The operational data check should block merge and have explicit pass criteria

"Pending, human operator" is a placeholder. The proposal itself says that merging over existing
drift makes the drift permanent. Make it a merge gate with checkable criteria:
- zero `sessions` rows with `team_id = DEFAULT_TOPICS_TEAM_ID` and `status = 'complete'`
  (record how many exist in any status);
- every sentinel `topics` row is `is_default = true` and `status = 'active'`, with no annotation;
- sentinel `(name, prompt, vote_type, display_order)` equals the seed, row for row;
- no two active sentinel rows share a `display_order`.

Record per environment: environment name, date, operator, result. If any check fails, F4 becomes
blocking.

---

## Minor

- **M1.** The requirement headings in `add-custom-topic`, `remove-topic` and `restore-topic` still
  read "identity/role, team existence, lock, …". Keeping the heading the same is correct for
  MODIFIED matching. Just confirm that this was deliberate, so nobody "fixes" it into a rename.
- **M2.** Each per-endpoint template scenario says "whether or not the template has a completed
  session". That's two states in one scenario. The tests plan already covers both lock states, so
  either split the scenario or add "(tested in both states)" so coverage is explicit.
- **M3.** Non-canonical spelling scenario (line 49): restate it as "follows the existing
  `rejectNonCanonicalTeamId` behaviour" and cite it, so this delta doesn't redefine it. Useful fact:
  the sentinel id contains no hex letters, so upper or lower case can't produce an alternate
  spelling. Only the brace and no-hyphen forms matter, and those are already listed.
- **M4.** Proposal, What Changes, last bullet: "No legitimate client depends on the old response."
  The frontend Topic Management screen does handle `409 TOPIC_CUSTOMIZATION_LOCKED`. Say what the
  screen shows when it gets `404` on a write for a team it just loaded. "Team not found" on a page
  that rendered fine is confusing, even if F1 makes it unreachable later. One sentence will do.
- **M5.** "This guard SHALL NOT be relaxed" is a governance statement and can't be tested. That's
  acceptable, but point to the structural test (S1) as what enforces it.

## Traceability check

| Requirement | Covered by | Status |
|---|---|---|
| §6.4 baseline preserved | provisioning "no write" + S6 | Covered once S6 is tightened |
| FR-8.1 defined and maintainable by admin | FR-8.1 boundary paragraph | Partial. See S7 |
| FR-8.2 facilitator/admin add/remove/reorder | Unchanged for real teams | Needs S5 regression |
| FR-8.6 visible and restorable | Reads scenario | Vague. See S4, S5 |
| FR-8.7 admins excluded from annotation | Admin 403 scenarios | Covered. Add audit clause (S2) |
| Anti-enumeration | Indistinguishable scenario | **Defective. See B1, B2** |
