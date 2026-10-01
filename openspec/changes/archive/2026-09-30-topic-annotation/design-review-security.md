# Security Review: topic-annotation (TOPIC-007) design

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Artifacts reviewed:** `design.md`, `proposal.md`, `tasks.md`, `specs/*/spec.md`
**Code checked against:** `packages/backend/src/routes/topics.ts`, `routes/content.ts`, `routes/facilitator-sessions.ts`, `auth/standing-facilitator-access-helper.ts`, `auth/team-content-access-helper.ts`, `auth/topic-lock-helper.ts`, `app.ts`, `routes/__tests__/content.test.ts`, `requirements/design/REST API Contract.md`
**Settled, not relitigated:** Facilitator-only editing, with Application Administrators getting `403` (H1). I checked only that the design enforces it correctly, and it does.

## Verdict: Approve with required changes (1 blocking)

The write path is well built. It reuses the sibling cascade instead of inventing a new one. Authorization runs before any resource lookup, the topic lookup is scoped by `team_id`, the timing floor covers every handled exit, annotation text is kept out of the audit log and a test enforces that, and rendering is plain text. The blocking problem is on the read side. The design says TOPIC-001's authorization is "unchanged" and also that "EM still gets `403`". Today's code returns `200` to an engineering manager, so if the field is added as designed, an EM can read the team's free text.

---

## Blocking

### B1. TOPIC-001 already admits engineering managers, so adding `teamAnnotation` exposes it to EMs

- **Contract** (`REST API Contract.md` §TOPIC-001, and access-matrix row at line 2962) says "`engineering_manager` role does not grant access to the topic configuration." The EM column says **No**.
- **Code** (`content.ts:459-500`) denies only a `null` grant and `path === "admin"`. `evaluateTeamAccess` returns `{ path: "member", role: "engineering_manager" }` for a real EM (Path 2), and the handler then goes straight to the SELECT.
- **Tests** confirm it: `content.test.ts:349-359` ("is present regardless of caller role — engineering_manager grant") expects **`200`**.
- **Design/spec** say the opposite. Design D8 says "Authorization is unchanged, and a test re-asserts EM 403". The topic-annotation spec says "an engineering manager … remain[s] denied … no annotation is disclosed". Task 5.3 requires "EM still gets `403`", but task 11.4 forbids touching TOPIC-001's authorization.

These cannot all hold. If an implementer follows 5.2 and 11.4 literally, the new 5.3 test fails, and the easiest fix is to weaken the test. The result would be that the team's free text, kept indefinitely, reaches managers. That breaks the product's no-manager rule. This field carries the most risk of any on this endpoint, because the helper text has to tell people not to write about other people in it.

**Required:** State in D8 that TOPIC-001 has a **pre-existing authorization defect** and that this change fixes it: `grant.path === "member" && grant.role === "engineering_manager"` → `403` with `Cache-Control: no-store` and the timing floor, before the SELECT. Update task 5.2 ("Authorization unchanged") and 11.4 to carve this out. Rewrite the `content.test.ts:349` test to expect `403` and to assert that no `teamAnnotation` appears in the body. Search the frontend for any EM-reachable call to `GET /teams/:teamId/topics` before merging, so the fix does not break an EM screen without anyone noticing. If the team will not fix this here, then TOPIC-001 must **not** return `teamAnnotation` in this change. Shipping the field on top of the defect is not acceptable.

---

## Required changes (non-blocking, must land in this change)

### R1. Scope the `UPDATE` by team and status, not by `id` alone (defense in depth against IDOR)
D5's pseudo-SQL is `UPDATE topics SET … WHERE id=$topicId`. The preceding `SELECT … FOR UPDATE` is scoped by `team_id` and `status`, so this is safe today. Its safety, though, rests on two statements staying paired through every future refactor. TOPIC-004 already writes `WHERE id = $2 AND team_id = $3 AND status = 'active'` (`topics.ts:880`). Do the same here, and treat 0 rows returned as the concurrent-archive branch. For the cost of one predicate, a cross-team write can no longer depend on code ordering.

### R2. Reject characters Postgres cannot store, and decide about control characters
Fastify's JSON parser accepts `"\u0000"`, and Postgres `text` rejects it (`22021`). The request then becomes an unhandled `500` on the thrown path, with no timing floor and no `422` envelope. A lone surrogate (`"\ud800"`) passes `typeof === "string"` and the length check, then gets silently rewritten to U+FFFD on encode, so what is stored is not what was validated. **Required:** in D3, reject U+0000 (and preferably unpaired surrogates) with `422 INVALID_ANNOTATION`. Add a test for each. **Recommended:** also decide whether C0 controls other than `\n`/`\t`, and bidi overrides (U+202A–U+202E, U+2066–U+2069), are rejected or stripped. The field is shown to a whole team as "the team's words", and bidi overrides let one person make the text display differently from what was typed. Whatever the choice, record it so nobody has to guess later.

### R3. Extend the "no text in audit" test to the structured log, and to error bodies
D7's test walks `audit_log.metadata`. The text also has two other ways out. (a) The `emitAuditEvent(request.log, "topic.annotation_updated", {...})` payload goes to the application log, which has its own retention and access. Assert that its fields carry no text too. (b) The `422` envelope must not echo the submitted value. Assert this for both validation messages. Fastify's `req` serializer (`app.ts:35-46`) logs no request bodies today, which is good. Add a code comment at the handler saying the body must never be logged, so a debugging change doesn't undo that.

### R4. Make the admin **read** of annotation text an explicit decision
H1 denies admins the *edit* because "admins have no session context and are denied session content elsewhere (`denyAdminContentAccess`)". D8, however, has TOPIC-002, which admits admins, return `teamAnnotation` plus `annotationUpdatedBy` (user ID and display name) for active and archived topics. So an admin can read every team's definitions and see who wrote them, while being refused the same field through TOPIC-001. That may be the right answer, since topic configuration is administrative data and admins already see prompts and descriptions. But the design reaches it only implicitly, through a rationale that points the other way. **Required:** add one sentence to D1 or D8, and to the FR-8.7 rationale: either "Admins may read annotations and provenance via TOPIC-002 (topic configuration, not session content)", or redact them for `actorGlobalRole === 'application_admin'`. Add a test pinning whichever is chosen. Note also that any standing facilitator in the org can read every non-member team's annotations through TOPIC-002. That is the existing topic-management model, but the helper text and the "not about people" guidance should be written knowing who can actually read the field.

### R5. Set `Cache-Control: no-store` first, as TOPIC-006 does
D2 says "every response sets `Cache-Control: no-store`". The precedent that actually achieves that is TOPIC-006's `reply.header("Cache-Control", "no-store")` as the handler's first statement (`topics.ts:1137-1139`, security review F6), so the global error handler's `500` also carries it. With R2 in mind, a thrown path is plausible here. Name that pattern in task 3.2 rather than "set on every response".

### R6. Add plain-text rendering to the hand-off ACs (D11)
The spec says "plain text on every surface", but the hand-off list for #56/#57/#62, which is what the session-screen implementers will actually read, has no plain-text item. Those screens are where the text reaches *every participant*, not only facilitators. Add AC 9: "Render as plain text (React text nodes, `white-space: pre-wrap`). No `dangerouslySetInnerHTML`, no Markdown/HTML interpretation, no `href`/`src`/`style` built from it." Also add to #57's AC 7 that the widened WS snapshot must carry the snapshot value (`session_topics.topic_annotation`), not the live column, and must go through the same per-connection authorization as the rest of the snapshot.

### R7. Add a negative test that TOPIC-001 returns no provenance
D8 rightly adds only `teamAnnotation` to TOPIC-001, so participants never see who wrote the definition (matching D11 AC 5, "unattributed"). Pin that with an assertion that `annotationUpdatedBy` and `annotationUpdatedAt` are absent from the TOPIC-001 body. Otherwise someone copying TOPIC-002's join "for consistency" would expose facilitator identity to participants.

---

## Verified as correct

- **Authorization order matches the siblings.** Identity/role → team existence → lock (with `topic.write_denied_locked` audit) → body → topic existence/status. It matches TOPIC-003 exactly, including the body-before-topic position, so a locked team always answers `409`. `checkStandingFacilitatorAuthorization` reads `global_role` and membership live from the DB on every call (`evaluateStandingFacilitatorAccess`), not from the session cookie, so a demoted facilitator loses access on their next request. Admin → `NOT_A_FACILITATOR` follows from `grant.globalRole !== "facilitator"`. Parameterizing only the messages (D1) keeps the semantics identical to TOPIC-003. Its existing tests must stay untouched (task 3.1), and they should.
- **Cross-team IDOR.** `checkTopicExistsAndActive` selects `WHERE id = $1 AND team_id = $2`, so another team's topic is `404 TOPIC_NOT_FOUND`, the same as a nonexistent one. Nothing reveals that a topic exists elsewhere. The spec has a scenario for it. (R1 hardens the write itself.)
- **Enumeration and timing.** Every handled exit has `applyTimingFloor`, including the no-op `200` and the in-transaction 0-row branch. `TEAM_NOT_FOUND` is visible to any standing facilitator, an existing and accepted property of the family.
- **Audit content.** The metadata `{ topic_id, action, length }` holds no text, and the row is written in the same transaction as the UPDATE with actor, role, IP, and team, matching `topic.archived`. A no-op writes nothing, which is fine, because nothing changed. `length` reveals only the size.
- **XSS on the management screen.** React text nodes plus `pre-wrap`, no `dangerouslySetInnerHTML` anywhere in `packages/frontend/src` today, and a `<script>` round-trip test in both API and component. Good.
- **CSRF.** Session cookie is `sameSite: "strict"` with a CORS allowlist. A JSON `PUT` adds no new exposure.
- **Session payloads.** SESSION-005/012 read `st.topic_annotation` only, and the negative test (6.3) is the right control against the `t.` JOIN trap. Keep it marked "do not drop".
- **Template-team seed leak.** The seed copy at `facilitator-sessions.ts:604` uses an explicit column list, so annotation columns cannot be inherited. The comment (7.1) and the test (7.2) are the right guards. Also, a TOPIC-007 write aimed directly at the sentinel team (`00000000-…-0001`) today answers **`409 TOPIC_CUSTOMIZATION_LOCKED`**, because the template has no completed sessions (`hasCompletedFirstSession`). That protection is incidental, not designed. The follow-up guard issue (9.4) should say that TOPIC-007 is currently covered only by that accident, and it should not count on it.
- **Migration.** Additive and nullable. No secrets, no privilege change.

---

## Deferred or implicit security decisions (record them; most need no work in this change)

1. **Clearing does not erase.** Once a session is snapshotted, a definition that broke the "not about people" rule stays in `session_topics.topic_annotation` for good, and the management-screen clear does not touch it. The design has no moderation (deliberate) and no remediation path. **Record** in Known Limitations that removing harmful text from past sessions takes a manual DB operation, and name who is authorized to perform it. This is the data-retention question (my success criterion 4) for a new free-text store.
2. **Retention and erasure of provenance.** `annotation_updated_by REFERENCES users(id)` with no `ON DELETE` behaviour will block, or be blocked by, any future user-erasure process, the same as `archived_by`/`restored_by`. Add it to whatever issue tracks user deletion. Don't solve it here.
3. **CSP is still disabled** (`app.ts:64`, "Deferred to a separate change"). This change adds the first team-authored free text that will be rendered to every participant, and React escaping is now the only XSS control. That raises the priority of the CSP change. Please note it on that issue.
4. **Thrown path has no timing floor.** This gap is inherited from TOPIC-003..006 (documented at `topics.ts:1128-1130`). R2 narrows the main new way to trigger it. Leave it as inherited.
5. **Denied attempts are not audited.** An admin or member-facilitator `403` on TOPIC-007 writes no audit row. That matches the siblings and is acceptable, but since the admin denial is a deliberate new policy, say explicitly that probing it is not audited.
6. **No rate limit on the endpoint.** Each real change writes an audit row. A facilitator, or a stolen facilitator session, could fill `audit_log` by alternating two values. This is low risk and matches the siblings. Record it as accepted.
7. **Deactivated teams remain editable.** `checkTeamExists` deliberately has no `deactivated_at` filter (inherited decision). Confirm that this is wanted for annotations too.

## Threat-model delta

New asset: **team-authored free text (≤500 units), kept indefinitely, copied into immutable session snapshots.** Readers after this change: standing non-member facilitators and admins (TOPIC-002, with author identity), team participants and active-session facilitators (TOPIC-001, live value, no author), and session facilitators (SESSION-005/012, snapshot), plus all participants once #56/#57 ship. Engineering managers must be on the **excluded** side of that line, and today's code does not put them there (B1). Writers: standing non-member facilitators only. The main remaining risks are misuse of the field (mitigated by helper text, with no remediation path, deferred item 1) and stored XSS (React escaping only, deferred item 3). Please revisit the threat model when #57 widens the WebSocket snapshot.
