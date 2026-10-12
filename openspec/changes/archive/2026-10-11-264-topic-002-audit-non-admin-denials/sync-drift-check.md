# Sync drift check (#264)

Reviewer: Ingrid Sollenberger (Solution Architect). Scope: main specs, REST API Contract (TOPIC-002), docs/deployment.md, audit-logger.ts comments, versus content.ts and standing-facilitator-access-helper.ts.

## Result: no drift remaining; no code changes needed

Checked against the implementation and found consistent:
- Operation names, one row per denial, no dedup, both reasons: spec, REST contract, deployment.md, audit-logger.ts, content.ts.
- Row fields (actor_ip = request.ip, actor_global_role 'unknown' when no users row, actor_roles NULL when no users row, read in the insert via LEFT JOIN, metadata exactly `{endpoint, http_status: 403, reason}`, team_id = requested id).
- Event payloads: nine keys for `topic.config_list_denied` (incl. `rowWritten`, `actorRoles` null on failed insert), eight keys for `topic.audit_write_failed` (SQLSTATE only). Matches the audit-logger.ts block and the code.
- Fail-open on the response, 500 ms `AUDIT_WRITE_TIMEOUT_MS`, order insert -> event -> timing floor -> send. Matches REST contract and deployment.md. Admin arm remains fail-closed.
- Helper's additive `actorGlobalRole: string | null` on the denied variant matches the design.
- deployment.md event count: 15 log-only events (7 auth + 1 join + 3 team + 1 session + 2 topic + 1 admin) agrees with the "Nine further ... 15" prose.
- team-content-access visibility guard names `topic.config_list_denied`.

## Drift found and fixed

- `openspec/specs/topic-customization-lock/spec.md` (~line 315) still said TOPIC-002 non-admin 403s are "not audited" and "do not decide whether those denials should be audited under SEC-13", contradicting the new requirement later in the same file. Reworded to say they are not audited by that requirement but are audited since #264 under `topic.config_list_denied`. This edit is in the working tree, uncommitted; it needs to be included in the next commit.

## Repo grep (excluding openspec/changes and archive)

No other statement that TOPIC-002 non-admin denials are unaudited. Remaining "unaudited" hits in content.ts / topics.ts / tests concern admitted facilitator reads or other endpoints, and are correct.

## Observations, not drift (no action required)

- The REST contract 403 table row for TOPIC-002 does not mention the audit; the Notes bullet "Denial audit (#264)" carries it. Acceptable.
- Proposal follow-up issue numbers are still placeholders (#TBD, #TBD-A, #TBD-B); the PR must not use `Closes #264` until #TBD-A exists (per proposal). Process item, not doc drift.

## Update (follow-ups filed)
Follow-up issues were filed after sign-off: #276 (Topics link/denial copy), #277 (volume control), #278 (growth/retention note), #279 (Product question). The placeholders noted above are resolved; `Closes #264` is now permitted once the PR links #277.
