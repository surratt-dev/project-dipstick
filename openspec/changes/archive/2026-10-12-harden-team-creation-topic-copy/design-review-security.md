# Security Review of design.md: harden-team-creation-topic-copy (#215)

*Tomás Ferreira, Security Analyst. Reviewed `design.md` and `proposal.md`. I also checked `default-topics.ts` and the error paths in `facilitator-sessions.ts`.*

## Verdict

**Approve with conditions.** None of the conditions are blocking. This change adds no endpoint, no input, no authorization rule change and no migration. The attack surface is smaller than the one it replaces. I have three recommended amendments (S1-S3) and several notes for the record.

## Summary of positions on the four focus questions

| Question | Position |
|---|---|
| Declined template-write trigger | **Acceptable**, with conditions S4 and S5 |
| `template_anomaly` log contents and log injection | **Acceptable**, with amendments S1 and S2 |
| Shared SQL fragment, injection risk | **Acceptable**, with amendment S3 |
| Error response on empty template | **Acceptable.** Keep the 500 `internal_error`. |

## 1. Declined template-write trigger

I agree with the reasoning on the point that matters. A `BEFORE` trigger that is bypassed by `SET app.allow_template_topic_write` is a tripwire, not a boundary. Anyone who can run SQL can set the flag. The design says this itself (reason 1), which I appreciate. The API-layer threat (a facilitator or admin writing to the sentinel through the application) is closed by #188 and #214. What remains is a trusted operator or a compromised DB credential, and a trigger does not stop either.

I am therefore comfortable with the decline. I want the following made explicit, because the document leaves them implicit.

- **S4. Name the residual risk as a risk, not only as an "operator mistake".** The design frames the remaining exposure as "silent content drift by trusted operators". The same capability also lets an insider or an attacker holding the DB credential silently change the prompts every new team receives. A changed prompt is persuasive content delivered to every future team. The invariants test checks names, positions and statuses (D8 a-e). It does **not** check `prompt`, `vote_type` or `first_session_description`. So prompt tampering is undetected by both the anomaly log and the CI test. Please state this gap in the Declined section, and either (a) extend the invariants test baseline to a hash or full text of the prompts, or (b) record that this is accepted until F5. I recommend (a) if the prompts are already in the requirements list. It is cheap, and it covers the case I care about. The CI test only runs against the CI database, though, so it detects a bad *migration*, not a bad production edit. That limit should also be written down.
- **S5. The revisit trigger must be real.** The decline is acceptable *only because* F5 (#216) reopens it. Task 5.2 must be a concrete acceptance line on #216 ("template writes go through one audited function; reconsider the guard"), not a note. If #216 is dropped or reshaped, this decision lapses. F5 is where FR-8.1 admin maintenance lands, and that is the first point where an audit row for a template write can be required. Please state that the F5 design **must** produce an `audit_log` row for each template write. That is the control I would hold the project to.
- **Production DB role (deferred, implicit).** The best low-cost mitigation is not a trigger but least privilege: the application's runtime DB role should not need `UPDATE/DELETE` on sentinel rows at all if only migrations edit the template. I cannot tell from these documents whether it does. This is not a blocker for #215. Please add it as a one-line open item for the pre-production review: confirm the runtime role's grants on `topics` and whether row-level separation of the sentinel is possible.

## 2. `template_anomaly` log contents

**Contents reviewed:** `templateTeamId`, `anomalies` (enum of four fixed strings), `topicIds` (UUIDs, capped at 50), `correlationId`.

- **Sensitive data:** none. The template sentinel id is a public constant. Topic ids are opaque UUIDs. The entry holds no user id, no team name, no prompt text and no request body. The requesting facilitator is not named, which is also fine for this purpose. This is the right minimal set.
- **Log injection:** the schema is structured (pino object fields), not string interpolation, and every field value comes from either a constant, a database UUID column, or a fixed enum. There is no caller-controlled string. The risk is negligible **provided** the implementation passes these as object fields and does not build the message string with them. Add this as a test or review note: the message literal is the constant `"template_anomaly"`.
- **S1. Anomaly entries must not embed row content.** The design says detection works "from rows". An implementer might be tempted to add `name` or `prompt` to the entry to help the operator. Template names and prompts are database-controlled text and could contain newlines or control characters if the data is damaged or tampered with. State in the design that the entry carries ids and anomaly codes only, never names or prompts, and that `topicIds` are validated or taken straight from the `uuid` column. This is one sentence and removes the only route to injection through this log.
- **S2. Define the `correlationId` source.** On the success path, no error envelope exists, and in the code the correlation id is generated only inside error responses (`crypto.randomUUID()` per envelope). The design does not say where the warn entry's `correlationId` comes from, or whether it can be joined to the creation request's other log lines (`team.creation_denied_role`, etc.). Without a join key the signal is hard to scope during an incident. Say that it reuses the request id (`request.id`) or a per-request id that the same handler also logs elsewhere. Do not mint a fresh id that appears nowhere else.
- **Operational note (accepted):** this is an `application log` warn, not an `audit_log` row. For a data-integrity diagnostic I accept that. The reasoning (adds a write to every creation; the rollback path could not persist it) is sound. But it means the signal depends on someone watching warn-level logs, and the design says "no alert". The signal can be silently ignored. If that is acceptable to the project, say so in one line; a persistent fault being "noisy" is not the same as detected. I suggest an alert on `template_anomaly` at the time the log pipeline exists, recorded as a follow-up, not built here.
- **Log volume as a DoS or noise vector:** one entry per creation, no de-duplication. Team creation is authenticated and role-gated (`team.creation_denied_role` precedes it), so an attacker cannot cheaply flood it. The 50-id cap bounds entry size. Accepted.
- **Best-effort wrapping:** "failure to read or log anomalies must not fail creation". I agree, with a caveat. A failed anomaly *read* inside the creation transaction is a failed query in a Postgres transaction, which aborts the transaction (`current transaction is aborted` on the next statement) unless it is wrapped in a `SAVEPOINT`. Swallowing the error and continuing to the copy would then fail with a confusing error. Either run the read before and outside the transactional client, use a savepoint, or run it after the commit. Please specify which. This is a correctness point with a security flavor: the error handler must not turn into a path that leaks SQL detail (the existing SF1 rule).

## 3. Shared SQL fragment

The claim "interpolating a fragment is safe because it is a module constant with no caller input" is correct for the fragment as described, and the design constrains it well: placeholders are indexes, never values.

- **S3. Make the constraint enforceable, not just stated.** A function `canonicalDefaultsWhere(alias)` that takes an alias and a placeholder index is a string-building API. It is safe today because both callers pass literals. A later caller who passes a request value as `alias` makes it an injection sink, and this module is the one the project points at as the place SQL "cannot drift". Recommend: (a) type the parameters narrowly (`alias: "t" | "dt"`, `paramIndex: number`), (b) validate the index as a positive integer at runtime (`Number.isInteger`), (c) comment in the module that no value may be interpolated. This costs three lines. The status literal `'active'` and `true` are constants in the string and are fine.
- The sentinel id remains a bound parameter (`$n`), not interpolated. Good, keep it that way. Do not inline the UUID into the fragment for convenience.
- The `row_number() OVER (...)` insert uses fixed SQL with `$1`/`$2`. No injection concerns.
- The tests assert the SQL behaviour (C7), not the string. Fine.

## 4. Error response on empty template

- Status 500, code `internal_error`, the existing plain-language message, a `correlationId`, **no template id** in the body, and a server-side error log naming `templateTeamId`. This follows the existing SF1 posture (never echo internals; log them). I agree with keeping this and not inventing a 503 or a new code. A distinct code such as `TEMPLATE_EMPTY` would hand an unauthenticated-in-effect observer (any authenticated facilitator) a precise statement of internal state, and would give them a way to learn that the template is damaged. Uniform `internal_error` is the correct choice.
- **Information disclosure through timing or message:** the 500 for an empty template is indistinguishable from the other creation failures. Good. C3 pins "message holds no ids". Please also pin "no stack, no SQL text, no `NoActiveTopicsError` class name" in the same assertion, since the error is thrown from the snapshot layer.
- **Availability note:** an empty template is a single point of failure for all team creation. This is an availability issue caused by an operator action, not an exploit path. Accepted; the invariants test and the anomaly log are the mitigations, and rollback leaves no partial rows (C3 asserts this, including no audit row). Good, because a partial team with a membership but no topics would be an integrity problem.

## 5. Other aspects reviewed

- **Authentication and authorization:** unchanged. The `POST /api/v1/teams` role check and the TOPIC-002 arms are not touched. The `topic-customization-lock` delta is wording only. I accept the PR statement that no access rule changes. Please make sure the restore-list change cannot widen who sees `defaultTopicsNotActive`: it only narrows rows (template side active only) and leaves the team-side join unchanged. The query still must remain scoped to the requested team, and I have no evidence in these documents that it is not.
- **Data access boundary:** the copy reads the sentinel team's rows and writes to the new team id generated in the same request. No cross-team read of real team data. The D7 read-only pre-merge query does read across all teams. It reads topic names and counts only. Run it with a read-only role or in a read-only transaction, report counts and ids rather than names to chat or the PR if any team names are involved, and do not paste output containing team identifiers into public issues.
- **Data integrity as a security property:** the resurrected-archived-topic bug changes content a team sees without consent. Fixing it forward-only is acceptable. The D7 check covers detection. If rows are found, the remediation issue should record whether any of the resurrected rows have votes or session history attached, because in that case a naive repair would delete data.
- **Test helper `DROP INDEX` inside a rolled-back transaction:** `DROP INDEX` takes an `ACCESS EXCLUSIVE` lock on `topics` until rollback. On a shared development or CI database with parallel suites this will block every other test touching `topics`. It is a test reliability issue, and it must never be pointed at a shared or production database. Add a guard in the helper (refuse to run unless the connection is the test database or a scratch schema). The design already says "never mutate the shared template outside such a transaction"; the lock behaviour is the additional point.
- **Audit logging:** no new audit events. Existing `session.draft_created` and related events are untouched. I accept no audit row for the anomaly signal (see section 2). I do not accept this as a precedent for template *writes*, which must be audited under F5 (S5).
- **Threat model impact:** no new threats. Threats reduced: availability (creation 500 on a position anomaly) and integrity (resurrected defaults). The threat of malicious or mistaken template modification by a privileged DB user remains open, with detection only for structural changes (S4).

## Deferred or implicit security decisions (summary)

1. Prompt, `vote_type` and description tampering on the template is not detected anywhere (S4).
2. No alerting on `template_anomaly`; detection depends on someone reading warn logs.
3. Runtime DB role privileges on the sentinel rows are not addressed (pre-production review item).
4. F5 must audit template writes; this is the condition that makes the trigger decline acceptable (S5).
5. Transaction handling of a failed anomaly read inside the creation transaction is unspecified (section 2).
6. Source of the `correlationId` on the success path is unspecified (S2).

## Requested amendments

| ID | Amendment | Severity |
|---|---|---|
| S1 | State that `template_anomaly` carries ids and codes only, never names or prompts | Low |
| S2 | Define where the warn entry's `correlationId` comes from, and make it joinable to the request | Low |
| S3 | Narrow types and runtime-validate `canonicalDefaultsWhere` parameters; forbid value interpolation | Low |
| S4 | Record the prompt-tampering gap in the Declined section; extend the invariants baseline to prompt text if feasible | Medium |
| S5 | Make the F5 task concrete: audited template writes; reconsider the guard | Medium |
| S6 | Specify how the best-effort anomaly read avoids aborting the creation transaction (savepoint or read outside it) | Medium |

None of S1-S6 requires a redesign. I will re-check the implemented version against these in the pre-production review.
