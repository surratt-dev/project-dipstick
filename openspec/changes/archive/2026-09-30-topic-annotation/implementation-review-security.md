# Security Review: topic-annotation (TOPIC-007) implementation

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Uncommitted working tree on `agent-team/53-topic-annotation` (`git diff` plus untracked files). I checked it against my design review (`design-review-security.md`) and the "Design review disposition" section of `design.md`.
**Executed:** `vitest run` on `topic-annotation.test.ts`, `content.test.ts`, and `facilitator-sessions.test.ts`. All 205 tests pass. I did **not** run `topic-annotation-integration.test.ts`, because it needs the Postgres harness. CI (`integration.yml`) has to pass before merge.

## Verdict: Approve. No MUST-FIX findings.

Every required item from the design review (B1, R1–R7) is implemented, and each has a test that would fail if the item regressed. The deferred items are written down in Risks and routed to `handoffs/`. What remains below is hardening and NITs.

---

## Verification of required items

| Item | Status | Evidence |
|---|---|---|
| **Check ordering matches the siblings.** Order: identity/role → team → lock (audited) → body → topic → status | Verified | `topics.ts:1442` (auth), then team-exists, then `checkCustomizationLockGate` with `attemptedOperation: "topic.annotation_updated"`, then `validateAnnotationBody`, then UUID guard, then `checkTopicExistsAndActive`. The precedence tests (locked + bad body → 409; bad body + missing topic → 422) are in `topic-annotation.test.ts:341,352`. |
| **Facilitator-only.** Admins get 403 | Verified | Uses `checkStandingFacilitatorAuthorization` (facilitator-only, live DB read of `global_role` and membership), not the `OrAdmin` variant. A comment at the call site forbids "fixing" this for consistency. Tests cover admin, EM, engineer, and member facilitator (`topic-annotation.test.ts:210–244`), including "nothing is written" for admin. TOPIC-003 keeps its original messages through `ADD_CUSTOM_TOPIC_AUTH_MESSAGES`. |
| **Cross-team / IDOR** | Verified | The pre-check is `WHERE id = $1 AND team_id = $2` (`topics.ts:387`). The in-transaction `SELECT … FOR UPDATE OF t` is team-scoped and has a test (`topic-annotation.test.ts:653`). A topic on another team returns 404, identical to a nonexistent one (`:304`). |
| **Timing floor** | Verified | Every handled exit calls `applyTimingFloor`, including the UUID guard, the in-transaction 404/422, the no-op 200, and the defensive 0-row branch (`topics.ts:1558`). There is an exit-matrix test (`topic-annotation.test.ts:791`). The thrown path has no floor; that gap is inherited and accepted. |
| **R1: `UPDATE` scoped by team and status** | Verified | `topics.ts:1548` `WHERE id = $1 AND team_id = $2 AND status = 'active'`. Asserted at `topic-annotation.test.ts:532`. A 0-row result rolls back and is re-classified as 404/422. |
| **R2: input validation** | Verified | `topics.ts:632–665`. Body must be a non-array object with a string `annotation`, so `null`, missing, array, and bare-string bodies all get 422 (`:433`, it.each after it). Normalization is CRLF→LF, then trim. Characters are rejected before length is checked: U+0000, lone high/low surrogates, C0 except `\n`/`\t` (lone `\r` included), U+007F, U+202A–202E, U+2066–2069. Each class has a test (`:440–470`), and the integration test confirms U+0000 returns 422, never a Postgres 22021 500. The 500 limit is in UTF-16 units and is checked after trim; the astral-emoji boundary is tested. Both regexes run in linear time, so a 1 MB body poses no ReDoS risk. |
| **R3: no text in audit, structured log, or 422 bodies** | Verified | Audit metadata is `{ topic_id, action, length }` only. The sentinel test walks the audit INSERT params and every arg of `emitAuditEvent` (`topic-annotation.test.ts:718`). All three 422 messages are fixed strings, and tests confirm the sentinel is absent from every 422 body (`:749` onward). The "NEVER log the request body" comment is at `topics.ts:1418`. The Fastify `req` serializer (`app.ts:37`) logs no bodies. |
| **R5: `Cache-Control: no-store` first** | Verified | `topics.ts:1429` is the handler's first statement. The thrown-path 500 test asserts the header (`topic-annotation.test.ts:876`). |
| **B1 / R7: TOPIC-001 returns no annotation or provenance** | Verified (resolved by omission) | `content.ts:486` adds a guard comment, and the SELECT is unchanged. A SQL-text unit test exists, and the real-SQL integration test asserts that all four keys are absent (`topic-annotation-integration.test.ts:485`). The EM defect on TOPIC-001 is still there and is routed to `handoffs/new-issue-topic-001-em-and-casing.md`. That is acceptable only because the field is not exposed (see S1). |
| **R4: admin read via TOPIC-002, `canEditAnnotations`** | Verified | Admins read the text and provenance read-only, as an explicit decision recorded in the contract and tested (`content.test.ts` "application admin still receives…"). `canEditAnnotations = decision.actorGlobalRole === "facilitator"` (`content.ts:668`) is correct. TOPIC-002 admits only admins and non-member facilitators, so `true` here means exactly the same population that TOPIC-007 authorizes. Both values are tested. The frontend gates on `!isCustomizationLocked && canEditAnnotations` (`TopicManagementPage.tsx:996`), for presentation only. |
| **Session payloads read only the snapshot** | Verified | SESSION-005 (`facilitator-sessions.ts:1199`) and SESSION-012 (`:1869`) select `st.topic_annotation`. The SESSION-005 query JOINs `topics` but does not select `t.team_annotation`. A SQL-text guard exists (`facilitator-sessions.test.ts` "never t.team_annotation"), and a real-Postgres test sets live `'Y'` against snapshot `'X'` (`topic-annotation-integration.test.ts:599`). |
| **Frontend renders plain text** | Verified | It renders a React text node inside `whiteSpace: "pre-wrap"` (`TopicManagementPage.tsx:183`). There is no `dangerouslySetInnerHTML`, `innerHTML`, or Markdown anywhere in `frontend/src`. Server error messages are also rendered as text (`:886`). The component test asserts `<b>` stays literal (`TopicManagementPage.annotation.test.tsx:268`), and the API round-trips `<script>` byte-for-byte. There is no `console.*` or browser storage of the draft. |
| **R6: session-screen ACs** | Verified | `handoffs/56-57-62-session-display-acs.md` AC 7 (snapshot value, per-connection authorization on the widened WS snapshot) and AC 9 (plain text). |
| **Migration and template/seed isolation** | Verified | `migrations/19_topics_team_annotation.sql` is additive and nullable, with no default, no backfill, and a clean down. The seed INSERT keeps an explicit column list, with a guard comment (`facilitator-sessions.ts:602`). There are integration tests for template-row isolation and new-team seed isolation (`topic-annotation-integration.test.ts:546,689`). |
| **Deferred items 1–7** | Recorded | `design.md` Risks covers them, with `handoffs/note-data-retention.md`, `note-csp-priority.md`, and `new-issue-template-team-write-guard.md`. |

---

## Findings

### MUST-FIX

None.

### SHOULD-FIX

**S1. Make the TOPIC-001 guard harder to lose than a comment.** `content.ts:486` and the `Topic` type comment (`packages/shared/src/types/topic.ts:677–684`) are the only things that stop someone from adding `t.team_annotation` to TOPIC-001 while that endpoint still answers `200` to engineering managers. The integration test at `topic-annotation-integration.test.ts:485` calls TOPIC-001 as a *participant engineer*. It proves the fields are absent, but it does not name the reason they must stay absent. Add one more case to that test, or to the unit test in `content.test.ts`, that calls TOPIC-001 **as an engineering manager** against an annotated topic and asserts that none of the four keys appear. Then, if someone later adds the field without doing the EM fix from 9.5, the test that fails is the one that explains why. This is a test-only change.

### NIT

**N1. Invisible and format characters are still accepted.** The rejected set (`topics.ts:632`) matches Decision 3 exactly. It does not cover C1 controls (U+0080–U+009F), zero-width and directional *marks* (U+200B–U+200F, U+061C), interior U+FEFF, line/paragraph separators (U+2028/2029), or Unicode tag characters (U+E0000–U+E007F). None of these can override display order the way U+202E can. Tag characters, though, are fully invisible, and they can hide content from a human reader. That matters if annotations are ever fed into a summarizer or exported. I don't need this changed here. Record it as an accepted residual in the Decision 3 rationale, or extend the class in the follow-up issue (`handoffs/new-issues-annotation-follow-ups.md`).

**N2. Cross-team 404 is tested only with mocks.** Team scoping is pinned by SQL-text assertions (`topic-annotation.test.ts:532,653`) and by the mocked 404 (`:304`), which is enough. A single real-Postgres case in the integration file (a facilitator PUTs team B's topic ID under team A's URL, gets 404, and both rows are unchanged) would make the IDOR property hold even if the SQL is restructured.

**N3. Defensive 0-row branch re-reads outside the transaction.** `topics.ts:1558–1572` re-queries `status` with `db.query` after ROLLBACK, to classify the response. This path is unreachable under the row lock and leaks nothing, because team scoping is kept. It is fine as written. If it ever becomes reachable, note that the re-read can classify as 404 or 422 a state that the write never saw.

---

## Residual risk accepted for this change (unchanged from design review)

- TOPIC-001 still admits EMs. That is harmless for this field only while S1's invariant holds (handoff 9.5).
- CSP is disabled, so React escaping is the only XSS control once #56/#57 render this text to every participant (handoff note-csp-priority).
- Clearing does not erase the session snapshots, and no remediation owner is named (handoff note-data-retention).
- There is no rate limit, denied attempts are not audited, and the thrown path has no timing floor. All three are inherited from TOPIC-003..006.

Revisit the threat model when #57 widens the WebSocket snapshot.
