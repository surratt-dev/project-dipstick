# Security Review: admin-default-topic-maintenance (#216) design

*Tomás Ferreira, Senior Application Security Analyst. Reviewed: design.md (E1 to E12), proposal.md, specs/admin-default-topic-maintenance, specs/audit-logging-operations. I spot-checked the code for: `trustProxy`, session cookie `sameSite`, frontend raw-HTML sinks, `emitAuditEvent`, and the denial-audit seam.*

## Verdict

**Approve with conditions.** The design is sound on the points I care most about. Authorization is server-side, the role is read live, and the sentinel id is never accepted as input. Audit is transactional and fail-closed on success paths. The 403 comes before any lookup, so a non-admin learns nothing from 404 versus 422. The mechanism for "a second writer cannot appear silently" is credible.

This change gives one role the ability to alter, without a second approver, text that is shown to every future team. That is a new, high-leverage privilege. The design treats it as a content-governance problem. I treat it first as a privileged-write problem. Conditions S1 to S6 below should be resolved or explicitly accepted in writing before implementation starts. The rest can be tasks.

Severity key: **High** = resolve before build. **Medium** = resolve in build or record an explicit acceptance. **Low** = note, or cheap hardening.

---

## Findings that need action

### S1 (High). The text-in-audit exception collides with "retain indefinitely" and has no redaction path
The exception itself is **acceptable**. Template text is global and admin-authored. A hash cannot reconstruct a change, and the audit row is the only history. The scoping to five operation names with a test that it cannot spread is the right control.

What the design does not handle is the failure case. E9 admits an admin can write a prompt that names an individual. Other things an admin could paste into a prompt include an internal hostname (no URL needed), a credential, or customer data. That text now lives in `audit_log.metadata`, in `before` and `after`, and in the history API. E5 then says audit rows for the sentinel are retained indefinitely and any retention job must exempt `topic.default_%` rows. So the data most likely to need deletion is the data we have promised never to purge. That conflicts with my success criterion 4 (a defined deletion policy that is implemented, not deferred).

Required:
- Define a break-glass redaction procedure for a maintenance audit row. It should be a documented runbook step that replaces text fields with a tombstone and leaves a redaction marker (who, when, why), with `lastChangedAt` unaffected. The runbook must say this is the **only** sanctioned mutation of `audit_log`.
- Reword the retention assumption in E5 and task 6.5. "Exempt from routine retention" is fine. "Never deletable" is not.
- Confirm that no other reader of `audit_log` (admin audit views, exports, log shippers) renders `metadata` text unescaped or copies it elsewhere. The text then spreads beyond the one table.

### S2 (High). Audit text also flows through `emitAuditEvent` to the application log
`emitAuditEvent` (audit-logger.ts) writes to the logger with `audit: true`. If the maintenance paths emit the same payload as a log event (the design says "closed `AuditEventName` union" additions), the full prompt text and before/after values go to the log pipeline. That pipeline has different retention, access control and redaction from the DB. The DB exception does not authorize this.

Required: state that the log event for the five operations carries **identifiers and `changedFields` only** (`topicId`, `operation`, actor, field names), never `before`/`after`. Add a test next to the "text exception does not spread" test that asserts the emitted log fields contain no text. If the design intended the log copy, say so and justify it.

### S3 (High). CSRF and cross-origin posture is implicit
The design never says how state-changing admin requests are protected against forgery. The platform answer exists: the session cookie is `sameSite: "strict"` (app.ts), and the websocket origin check relies on it. That is a good baseline. But:
- The design's bodyless `POST .../archive` and `.../restore` are the classic simple-request CSRF shape. Strict cookies protect them in modern browsers, but the protection is a browser property, not a server check.
- Impact here is higher than for team-scoped topic writes: one forged request edits a global ritual prompt.

Required: add one line to E2 stating the inherited control (SameSite=Strict, no permissive CORS on `/api/v1/admin`). Add one test that these routes reject (or do not honor) a request with a `text/plain` or form content type and a foreign `Origin`. Reject non-JSON content types on the PATCH, POST and PUT bodies. I will not require a CSRF token if the existing app does not have one, but the reliance must be written down, not discovered.

### S4 (Medium to High). Blast radius of a single compromised admin, and no detective control beyond the audit table
A stolen admin session, or an IdP group-claim misconfiguration, lets an attacker rewrite 15 prompts that every new team (and every Recover Zero-Topic team) will see. Mitigations in the design: plain-text guard, no URLs, length caps, audit. These are good but all are preventive-content or after-the-fact. Nothing alerts. Facilitator notification is declined (D-list), which is defensible for UX, but then the security signal has to come from somewhere.

Required (cheap):
- Emit an `info`-level structured log event for each of the five operations (identifiers only, per S2) so existing log-based alerting can page on "any `topic.default_*` outside business hours or from a new IP". Document the suggested alert in `docs/deployment.md`.
- Record in the proposal that there is **no two-person control** and that this is accepted for the first release. A single admin is the entire control. Say what would reopen it (more than N admins, or an incident).
- Confirm and document how `application_admin` is granted (IdP claim mapping versus DB flag), because that is now the only gate. If it comes from an IdP claim, the claim is trusted for a more powerful action than before. Say so in the threat model.

### S5 (Medium). The plain-text guard is a denylist; the real XSS control is output encoding, and the design does not claim it
The format guard (E4) is narrow on purpose and I agree it should not be called a sanitizer. As an XSS control it has gaps: `javascript:` and `data:` strings without a `://`, a full-width `＜`, Unicode bidi overrides, and zero-width characters all pass. The design is correct that this does not matter **if every consumer renders text as text**. I checked: the frontend has no raw-HTML sink in its source (only comments and tests mention `innerHTML`), and React escapes by default. The prompt and description also reach WebSocket payloads, session snapshots (`session_topics.topic_name`), reports, and possibly exports and email.

Required:
- State the actual control as a MUST in the spec: template text is stored and transported as inert data, and every consumer renders it as text. Add a lint or structural test, or at least a checklist item in the task list, that no consumer of `topics.prompt`, `name` or `first_session_description` uses a raw-HTML sink, Markdown renderer, or auto-linker. The Markdown `](` rule suggests someone was worried about a renderer. Say whether one exists.
- Extend "control character" to Unicode categories **Cc and Cf** (this catches bidi overrides U+202A to U+202E and U+2066 to U+2069, zero-width U+200B to U+200D, and BOM). Allow `\n` in the description only. These are the practical prompt-spoofing and display-confusion vectors that a narrow denylist misses.
- Reject lone surrogates and `U+0000` explicitly. `U+0000` in a string breaks `jsonb` audit inserts and would turn a validation case into a 500 and an audit-rollback case. The "any control character" wording probably covers it; add a test.
- Also apply the guard to **display names echoed back** only if they ever come from this path (they do not). No action.

### S6 (Medium). Denial-audit fail-open and the bound: acceptable, but name the blind spots
Fail-open is the right call for the denial row, since the response is a 403 either way and no authorization decision depends on the write. The success path is fail-closed, which is the asymmetry I want. Residual points to record:
- After the 10th denial per actor per minute, only a log-only suppressed event exists. A patient probe at 10 per minute produces a complete trail. A burst loses detail but still shows the suppressed event. Include the **suppressed count** and the route family in that event so a burst is distinguishable from a trickle.
- When the limiter store errors, the existing seam writes **no row and no per-denial event** (assign-defaults-audit.ts). During a Redis outage, denial auditing for this family is blind, and the same outage fail-closes the write limiter (503). Accept it, but emit one log event per window in that state, and say it in the design.
- The denial row stores `team_id` null and method plus route template only. Good: no body, no id echo. Confirm the route **template** is logged, not the raw URL, so a hostile path segment cannot be injected into the log.

---

## Assessment of the points you asked about

### Authentication and role check
- Session auth in `onRequest`, then a live read of `users.global_role`, then `isApplicationAdmin`. Correct. Demotion takes effect on the next request. Membership is correctly ignored.
- **TOCTOU (Low).** The role is read at step 2 and the transaction starts at step 6. A demoted admin can complete one in-flight write, and the audit row records the earlier role. This is a millisecond window. Accept explicitly, or re-read the role with `FOR SHARE` inside the transaction at no real cost. I lean to accept, written down.
- Confirm `authMiddleware` rejects deactivated or deleted users, not only invalid sessions. The new predicate does not check that and should not need to.
- The 401/403 split is fine. 403 does not distinguish "route exists but you lack the role" from anything sensitive: the route list is in the public API contract.

### Data access boundaries
- The sentinel id is never accepted. `WHERE id = $1 AND team_id = SENTINEL` makes a real team's topic id indistinguishable from a missing one. Good, and it removes this endpoint as a cross-team probe. Parameterized queries are assumed throughout.
- Isolation MUSTs (E8) plus the byte-identical negative test are the right proof. I accept them.
- **Mass assignment.** "Unknown top-level body keys are ignored" is safe only if handlers **pick** `name`, `prompt`, `firstSessionDescription`, `voteType` rather than spread the body. Add a test sending `teamId`, `status`, `isDefault`, `displayOrder`, `archivedBy` and `id` on POST and PATCH and asserting no effect. The spec states "none SHALL accept a team id in the body"; this test is what proves it.
- **Path-id normalization (Low, integrity).** E2 accepts mixed-case UUIDs in `:topicId`. The audit `metadata.topicId` and the reorder id lists must be taken from the **database row**, not from the request. Otherwise a request with an uppercase id writes metadata that fails the text equality in the `lastChangedAt` derivation (E5), silently losing provenance. Add a test.
- **History read** exposes actor `userId` and `displayName` to every admin. Acceptable for admin-only. Note it.

### Audit logging
- Atomic with the write, one row per effective write, no-op writes nothing, closed metadata key set asserted by test, bounded size. All good.
- **Tamper resistance (Medium).** `lastChangedAt/By` and the only recovery path both depend on `audit_log` being trustworthy. Nothing says the application DB role cannot UPDATE or DELETE audit rows. Recommend one of: revoke UPDATE/DELETE on `audit_log` from the app role (with the S1 redaction done through a separate privileged role), or record in the threat model that audit integrity relies on DB access control. Do not claim tamper evidence the design does not have.
- **`actor_ip`** comes from `request.ip` with `trustProxy: 1` (app.ts). That is correct only if exactly one trusted proxy sits in front. If a client can reach the app directly or through two proxies, the field is spoofable. Reads like an existing platform assumption; state it, since this is the first audit row where admin forensics may depend on it.
- Test-isolation deletion of audit rows (E6) is test-only. Confirm the delete helper cannot run against a non-test database (guard on environment or database name).

### Threat model impact
Add to the threat model document (it should be revisited per my success criterion 1):
- **New asset:** the template, i.e. content shown to all future teams.
- **New actor capability:** `application_admin` can write global content. Single-actor, no approval.
- **New threats:** compromised admin credentials; malicious or careless admin writing prompts that target individuals or social-engineer teams; stored XSS through downstream rendering; CSRF on admin writes; DoS by holding the sentinel advisory lock; audit-row tampering; PII persisting in audit.
- **Trust boundaries unchanged:** the #188 guard, first-session lock and live-session isolation. The negative test is good evidence.

### Rate limiting
- Writes share the existing per-actor budget after authorization and before DB work. Fail-closed 503 on limiter failure matches the other topic routes. Good.
- **GETs are unlimited (Low).** The list does a per-row audit lookup on `metadata.topicId` and the history takes up to 200 rows. This is admin-only, the sentinel's audit rows are few, and `idx_audit_log_team` serves it, so I accept. Note that `metadata->>'topicId'` is unindexed; fine at this scale, revisit if audit volume for the sentinel grows.
- **Sharing the budget** with TOPIC-003..008 means a busy admin who is also a facilitator can starve maintenance (or the reverse). Harmless. Note it.
- **Lock hold (Medium).** The sentinel advisory lock is held for the whole transaction. The design sets no `lock_timeout` or `statement_timeout` for it. One stuck transaction blocks all maintenance writes (not team creation, which is a single statement and takes no lock). Set a bounded `lock_timeout` and `statement_timeout` in `withAuditTransaction` for this path and map the timeout to a defined error code.
- **Request size.** The design caps field lengths after trim, but the body is parsed first. Set an explicit small `bodyLimit` on these routes (a few KB suffices; no body here needs more than about 2 KB of text plus the 15-id order list). For `order`, check array length (at most 15, or at most N+some) **before** per-element validation or any query. I found no per-route `bodyLimit` use in the backend; this is a new line, not a new pattern.

### Timing
- A floor on every return is applied as in assign-defaults, with `TIMING_FLOOR_MS` a 150 ms placeholder owned by #305. What the floor is hiding here is thin: the 403 comes first, so non-admins cannot reach the DB-dependent branches. The authenticated-admin branches (404 versus 409 versus 200) are visible to the admin by design.
- The residual concern is that the 403 path awaits the limiter and a DB or Redis write, and a transaction under lock contention may exceed the floor. Neither leaks anything about data a non-admin should not know. The floor should cover the **whole** 403 path including `recordDenial`; verify under #305 and do not claim more than "reduces role-probing signal".
- Canonical-id failure (no query) versus missing-row (query) is covered by the floor for non-admins only because 403 precedes both. Fine.

### Error-code information leakage
- `DEFAULT_MAINTENANCE_ADMIN_ONLY` reveals nothing beyond the published API.
- 404 for a real team's topic id is indistinguishable from nonexistent. Good.
- `conflictingTopicId/Name` on restore, `current` on a reorder mismatch, and `limits` in every response are admin-only template data. Fine.
- Confirm validation errors return the `field` name and `max`, **not** the rejected value. `PROMPT_FORMAT_INVALID` echoing the offending substring would reflect admin-controlled text into responses and logs. Add to the error envelope test.
- The 500 on audit failure must use the existing generic envelope with no driver message. State it.
- The number of distinct 4xx codes is large. That is fine for an admin API, but each must have a stable code and no stack or SQL text.

### Prompt-content injection and stored XSS
See S5. Additionally: audit `before/after` and the history response contain admin text. Any viewer (the follow-up screen, an audit viewer) must render it as text. Put that requirement in the screen follow-up issue now, so it is not rediscovered.

---

## Decisions deferred or implicit (flagged as you asked)

| # | Decision | Where it sits today | Ask |
|---|---|---|---|
| 1 | CSRF/Origin protection for admin writes | Implicit (SameSite=Strict cookie) | State it (S3) |
| 2 | How `application_admin` is granted and trusted | Not in the design | Document; threat-model it (S4) |
| 3 | No two-person control, no alert on template change | Implicit | Record the acceptance; add the log event (S4) |
| 4 | Redaction and deletion of audit text | Absent; contradicted by "indefinite" | Add runbook procedure (S1) |
| 5 | Log copy of audit payload | Unstated | Identifiers only (S2) |
| 6 | Audit-table tamper resistance | Not addressed | DB grants or documented reliance |
| 7 | Output encoding as the XSS control | Implicit; not a requirement | Make it a MUST (S5) |
| 8 | Unicode format and bidi characters in prompts | Not covered by "control character" | Extend to Cc/Cf (S5) |
| 9 | `lock_timeout` and `statement_timeout`; route `bodyLimit` | Absent | Add (rate-limiting section) |
| 10 | Role TOCTOU between check and commit | Implicit | Accept in writing |
| 11 | Denial-audit blind spot when the limiter store is down | Documented in code, not here | Add a line (S6) |
| 12 | `trustProxy: 1` assumption for `actor_ip` | Platform | State it |
| 13 | Dependency and secret scanning for the new module | Out of scope here | No new dependency expected; confirm none is added |
| 14 | Timing floor value | Deferred to #305 | Acceptable; not a gate for this change |
| 15 | Structural test regex coverage | See below | Harden |

### On the structural writer test (E11)
I support declining the trigger. It is a code-path control, not a security boundary, and the design says so honestly. Strengthen the scanner so it is not trivially bypassed: match `UPDATE ONLY topics`, quoted and schema-qualified names (`public.topics`, `"topics"`), writes inside CTEs, `TRUNCATE`, and `MERGE`/`INSERT ... ON CONFLICT`. Also fail on any dynamic table-name construction near a `topics` identifier. Include fixture cases for each in the "proves it can fail" test. State plainly in the test header that this guards against mistakes and not against an attacker with SQL access.

---

## Conditions summary (what I need back)
1. S1: redaction runbook step and a retention wording change.
2. S2: log events for maintenance carry identifiers only, with a test.
3. S3: written reliance on SameSite=Strict, JSON-only content type, and one test.
4. S4: structured log event plus alert guidance; recorded acceptance of single-admin control; admin-grant provenance documented.
5. S5: output-encoding MUST, Cc/Cf rejection, mass-assignment test, id-normalization test.
6. S6 and the Medium items: suppressed-event fields, lock and statement timeouts, route `bodyLimit`, audit-table grants or documented reliance.

I will want the threat model revisited against the implemented routes before the first production edit (task 8.1 is a natural moment). I have no objection to merging before the dry run, provided S1 through S5 are closed.
