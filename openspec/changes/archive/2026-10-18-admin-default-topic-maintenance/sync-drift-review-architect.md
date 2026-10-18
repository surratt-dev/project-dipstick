# Sync drift review (Solution Architect, Ingrid Sollenberger)

Scope: synced docs versus `routes/admin-default-topics.ts`, `sessions/default-topic-maintenance.ts`, `sessions/default-topic-validation.ts`, `auth/default-maintenance-denial-audit.ts`.

Verified with no drift: the seven routes and methods; success statuses (add 201, others 200, no-ops 200); all error codes, statuses and categories (ERROR_TABLE); limits (1..15 active, 60/400/800 code points, history 50/200, body 16 KiB); validation-before-state order and restore order (ALREADY_ACTIVE, CAPACITY, DUPLICATE); lock 3 s / statement 10 s / `Retry-After: 3`; rate limit values 120 per 10 min and 400 per day, writes only, GETs unlimited, sentinel as limiter team id; the five audit operation names and the explicit `= ANY` selection; denial limit 10 per 60 s and the 1, 2, 4, 8 suppressed-count sampling; rename notice and scope text; `non_active_default` retirement in `template-anomalies.ts` and in the provisioning spec and deployment text; metadata shape `{ topicId, operation, changedFields, before, after }`; log event fields (identifiers and `changedFields` only).

## Doc inaccuracies fixed in place

1. `docs/deployment.md` (maintenance, Routes paragraph): said the two GET routes "answer `503 DEFAULT_MAINTENANCE_BUSY` if another change holds the template lock". Only writes take the lock; GETs never do. Reworded: writes answer the 503 on a lock wait over 3 s or a statement over 10 s; GETs take no lock.
2. `docs/deployment.md`, REST API Contract (DEFTOPIC auth paragraph), `audit-logging-operations` spec: the denial row's metadata was described as "method and route template only". Actual (`writeFailOpenTopicAuditRow`): `endpoint` (method plus route template), `http_status`, `reason`, `correlation_id`. Corrected in all three. Still no raw URL, body or id.
3. REST API Contract check order and `admin-default-topic-maintenance` spec check order omitted the `415` step. Code order is 401, 403, 415 (add/edit/reorder only), 404 non-canonical id, rate limit, 422, transaction. Added.
4. REST API Contract: "any body sent [to archive/restore] is ignored" overstated. A malformed JSON body (JSON content type) is `400` and an oversize one `413`; no media-type check applies. Clarified.
5. `audit-logging-operations` spec: "archive also lists renumbered" was incomplete. Archive always carries `after.renumbered` (possibly empty); add and restore carry it only when a pre-existing gap was repaired. Clarified.

## Needs a code change or a decision (not edited)

- None blocking. Observations, for the owner to accept or schedule:
  - Contract types `firstSessionDescription` as `string`; the code and DB view type is `string | null`. Harmless today (all rows validated non-empty, backstop enforces it on touched rows) but a pre-existing null on an untouched seed row would be returned as `null`. Either accept, or make the contract `string | null`.
  - `unchanged` no-op edit returns `changedTopicId`; archive/restore/add/reorder no-ops do not exist or omit it (reorder no-op has none). Contract lists `changedTopicId?` as optional, so this is consistent.
  - DB-error during the live role read answers the generic 500 (fail closed, no audit row); not stated in the specs. Acceptable; mention only if the security reviewer wants it explicit.
