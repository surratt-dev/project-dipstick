# Security Design Review: phantom-em-relationship-detection

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewing:** `design.md`, `proposal.md`, `tasks.md` (this change), against the archived `restrict-team-005-em-promotion` change's `design.md` (Decisions E, F, H, I) and `design-review-security.md` (my own Open Questions 2, 3, and light-touch input on Q6/Q7, all of which this change is the direct follow-through on), and the current `audit_log` schema (`migrations/8_audit_log.sql`) and `teams.ts` write sites.
**Purpose:** Resolve Decision J (mine to help settle, per design.md's explicit routing) and the notification recipient/channel question, and flag anything left deferred or implicit that shouldn't be.

---

## Summary judgment

This is the overdue execution of my own Q6/Q7 recommendations from six months ago, and it gets both right. Query 1 is exactly the detection shape I asked for in Q6 ("`team_memberships.role = 'engineering_manager'` rows with no corresponding `team.manager_established` audit_log entry for that `(user_id, team_id)` pair"). Query 2 is exactly the annotate-don't-rewrite shape I asked for in Q7 ("a dated addendum/backfill marker... preserves the original record's integrity while making the correction discoverable"). I have no objection to Decisions 1 through 7 as written.

I verified the one claim in this design that matters most to me directly against `teams.ts`, rather than taking design.md's word for it — see below. It holds. I'm resolving Decision J and the notification question below, with reasoning, not re-flagging them as open.

---

## Verification: the `operation` filter correctly excludes `team.role_change_denied`

Design.md's Decision 5 states the annotation query's `WHERE al.operation = 'team.role_changed'` predicate exists to prevent misclassifying blocked TEAM-005 attempts (`operation = 'team.role_change_denied'`) as completed phantom promotions, because the two operations write metadata with an identical shape (`{ from_role, to_role }` for one, `{ from_role, to_role, http_status }` for the other — a superset, not a divergent shape).

I read both write sites directly:

- `teams.ts:821-847` (the blocked path, my own Decision F from the archived change): writes `operation: "team.role_change_denied"`, `metadata: { from_role: "participant", to_role: "engineering_manager", http_status: 403 }`.
- `teams.ts:969-985` (the completed path): writes `operation: "team.role_changed"`, `metadata: { from_role: fromRole, to_role: newRole }`.

Confirmed: `operation` is a distinct, discriminating column value between the two write sites — it is not a case where the same `operation` string carries two different metadata shapes, it's two different `operation` strings that happen to carry a metadata shape where one is a superset of the other. Design.md's query correctly filters on `operation`, which is the actually-discriminating key, not on `metadata` alone. If a future editor "simplified" the `WHERE` clause by dropping the `operation` predicate and relying on `from_role`/`to_role` alone, every post-fix blocked attempt would get annotated as a completed historical promotion — exactly the failure design.md's inline comment warns about, and exactly the class of bug this whole change lineage exists to close one level removed (a script that's technically correct-looking while quietly capable of manufacturing false audit rows). The inline comment at Decision 5 is doing real work; keep it in the shipped file verbatim, not paraphrased.

One addition I want in the fixture verification (tasks.md 4.3, which already names this case): the fixture must include a `team.role_change_denied` row with `timestamp` *before* the 2026-09-16T20:46:16-04:00 cutoff, not just after it. The cutoff predicate alone would also incidentally exclude a pre-cutoff `role_change_denied` row (there shouldn't be any — TEAM-005's fix and the denial path shipped together — but the annotate script's correctness must not rest on that historical fact holding; it must rest on the `operation` filter). Task 4.3 as written tests the `operation` filter is present; I want it to test that the filter is load-bearing (i.e., a pre-cutoff denial row is excluded *because of* `operation`, not *because of* the cutoff which happens to also exclude it in the one dataset that currently exists).

---

## Decision J — resolved

**`actor_user_id` = the operator's own `users.id`, supplied as a mandatory `psql` variable with no default. `actor_global_role` = the fixed literal `'system:production_data_engineer'`.** I concur with the candidate resolution carried forward from exploration, for the same reason I gave for Decision F's audit event in the original change: a control that's silently optional is a control that's silently absent under time pressure, and this is exactly that shape one level removed — a script-generated audit row with no real operator identity behind it is no better for incident reconstruction than the phantom rows this change exists to find. "Which human" is the point; a sentinel UUID answers a different question than the one that matters here.

Two things I want added that the candidate resolution as stated doesn't cover:

1. **Validate the operator parameter against `users` before it's trusted, not just require it be non-null.** A mandatory parameter with no default stops an operator from forgetting to supply *something*, but doesn't stop a typo'd or stale UUID from being silently inserted — `actor_user_id` is deliberately not a foreign key (`8_audit_log.sql:29-30`, "not FKs, so records remain stable... even if the referenced user is later deactivated or deleted"), so Postgres will not catch this for you. Add a second statement to the sanity-check block, after the existing `current_database()`/`inet_server_addr()`/`now()` check, that resolves and echoes the operator's identity back to them before the write:
   ```sql
   -- STOP: confirm this is you before proceeding. If no row comes back,
   -- :operator_user_id is wrong — stop and fix it before running the INSERT below.
   SELECT id, email FROM users WHERE id = :'operator_user_id';
   ```
   This is a two-line addition to the annotate script's existing sanity-check pattern, not new architecture, and it converts a silent wrong-UUID mistake into an immediately visible one, in the operator's own terminal, before the write happens — the same "catch the mistake before it does anything" logic Decision 2 already applies to the wrong-environment case.

2. **`:operator_user_id` must use `psql`'s quoted-literal substitution syntax (`:'operator_user_id'`), not bare `:operator_user_id`, everywhere it appears** — including in Decision 6's `INSERT` snippet as currently drafted in design.md, which writes it unquoted in the `VALUES`/`SELECT` list. Bare `:name` substitutes raw, unquoted text into the SQL; for a UUID string parameter, that either produces a syntax error (harmless, just annoying) or, if the operator's shell/parameter handling ever introduces something unexpected, misbehaves in a way that's harder to reason about than a quoted literal that Postgres then casts. This is not an externally-exploitable injection path — the parameter is supplied by the trusted operator running the script, not by request input — but it's a mechanical correctness issue worth fixing at the same time as everything else in this script gets written, and it costs nothing to get right the first time. Same applies to my added validation statement above, which I've already written with the quoted form.

With those two additions, Decision J is resolved. The exact values (`'system:production_data_engineer'` literal, `:'operator_user_id'` quoted-parameter convention, the added identity-echo check) must land in both scripts' headers as copy-pasteable instructions, per design.md's own framing — not descriptions the operator has to interpret.

---

## Notification recipient/channel — resolved

**Recipient: Rachel Okonkwo, VP of Engineering (the Executive Stakeholder for this change and the archived change alike).** Channel: direct, out-of-band (email or equivalent), sent by the operator by hand — not an automated system message.

Reasoning:

- Decision H's original deliverable shape ("checked, N found, here's who was notified") was Rachel's own ask as Executive Stakeholder on the archived change, per that design.md's Decision H text. She's the correct default recipient for the same reason design.md's own draft already leans toward her: this is her open item to close, not a new party being pulled in.
- I checked whether any existing notification transport in this codebase could carry this automatically — there isn't one. No Slack/PagerDuty/email integration exists anywhere in this repo; `audit-logging-operations` governs `emitAuditEvent`'s structured-log transport, which is a different thing (operational log stream, not a human notification channel) and this change correctly doesn't touch it. That absence is itself the right answer here, not a gap to fill: a manual, human-sent notification is *more* consistent with "escalation, not remediation" than building a new automated alerting path would be. Building notification infrastructure for a detection control this change's own Non-Goals say is on-demand, not continuous, would be scope creep in the direction Decision H's "no remediation program" line already warns against.
- The explicit escalation-not-remediation sentence design.md requires (Open Question 2's own text) should be the literal content the operator sends, not just a design-doc boundary — put a copy-pasteable notification template in `query-result.md` (extending Decision 7's template) or the annotate script's header: something like *"Query 1 flagged N phantom EM relationship(s) in `<environment>` as of `<timestamp>`. This is a notification, not a request for action — no remediation has been taken and none is authorized by this message."* That sentence existing only in design.md protects the design; it doesn't protect the actual notification the operator sends under time pressure six months from now. The pattern I want to avoid is the same one that let the original 2026-09-23 deadline slip silently — a boundary that's correct on paper and undocumented at the point someone actually acts.

---

## Other observations

- **Data access boundary:** the detection query joins `team_memberships` through to `users.email` and `teams.name` (Decision 3). This is read-only and the operator already holds full production `psql` access to run either script at all — this doesn't create a new access path beyond what the operator's existing credentials already grant, so I have no objection. Worth stating plainly for the record: the access control here is "who holds production database credentials," a control entirely outside this change's scope (infra/IAM, not application authorization), and that's the correct and only control that applies to a manual ops script of this kind. I'm not asking for an app-layer authorization check on a `psql -f` invocation; that would be theater. I am confirming this boundary is understood, not silently assumed.
- **Append-only invariant:** confirmed by my own grep of `packages/backend/src/` — no `UPDATE` or `DELETE` against `audit_log` exists in application code (the only `DELETE FROM audit_log` statements anywhere in the repo are test-teardown code in `packages/backend/src/routes/__tests__/`, not production code paths, and not something either new script touches). Decision I's annotate-don't-rewrite approach is sound on this codebase's actual invariant, not just on the design doc's claim about it.
- **Secrets/connection handling:** neither script introduces a new credential or connection convention. Both scripts should invoke via the same `dotenv -e ../../.env -- psql "$DATABASE_URL" -f <script>` pattern `8_rollback.sql`'s header already documents, stated explicitly in both new scripts' headers (task 2.1/3.1 already ask for "how to run it" — make sure that's this exact invocation, not a fresh one an operator improvises with a hand-typed connection string that risks landing in shell history with credentials embedded).
- **WebSocket / authentication flows:** not applicable to this change — confirmed. No application code, no request path, no session. Noting this explicitly per my own standard practice of never letting "obviously not applicable" go unstated.
- **Dependency hygiene:** not applicable — no new dependencies.

---

## Sign-off

With Decision J resolved as above (operator's real `users.id` + identity-echo validation + quoted-literal `psql` syntax; fixed literal `'system:production_data_engineer'`) and the notification recipient resolved (Rachel Okonkwo, direct channel, with a literal escalation-not-remediation sentence carried into the artifact itself rather than left in design.md alone), I have no further security objection to this design. The `operation`-filter collision I was asked to verify is correctly handled in the query shape as specified — I checked it against the actual write sites, not the design doc's description of them. I'll confirm the shipped SQL matches these decisions at implementation review, consistent with my standing practice of verifying against what's actually in the file, not what a design doc says should be there.
