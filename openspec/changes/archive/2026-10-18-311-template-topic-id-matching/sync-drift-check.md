# Sync drift check: 311-template-topic-id-matching

Reviewer: Ingrid Sollenberger (Solution Architect). Scope: synced main specs, edited requirements/ and docs/deployment.md vs. `migrations/24_template_topic_id.sql`, `default-topics.ts`, `routes/content.ts`, `RENAME_NOTICE`.

## Result: no substantive drift

Checked and consistent:
- **Migration 24 vs database-migrations spec:** order (SET LOCAL lock_timeout 200ms, ADD COLUMN IF NOT EXISTS with FK ON DELETE RESTRICT, one backfill, CHECK drop-if-exists / ADD NOT VALID / VALIDATE, RESET), no RAISE NOTICE, no unique index, Up/Down markers, Down drops CHECK then column, sentinel literal cast `::uuid`, header carries rationale, legacy rows, archive-never-delete and "Rollback:". Backfill ranking (active first, then lowest id; NOT EXISTS guard) matches the spec rule. The backfill SQL in docs/deployment.md is textually identical to the migration's.
- **default-topics.ts:** `copyCanonicalDefaults` writes `template_topic_id` in the single INSERT ... SELECT, as default-topic-provisioning requires.
- **routes/content.ts:** `defaultTopicsNotActive` uses a lateral join on `template_topic_id = dt.id`, active first then lowest id, matching the spec, the REST API Contract (line 705), the topic-customization-lock note, and the topic-management-screen "does not read" requirement. Active-name suppression uses `normalizeTopicNameForMatch`, as in the spec.
- **RENAME_NOTICE:** the constant in `default-topic-maintenance.ts` is character-identical to the text in admin-default-topic-maintenance spec and REST API Contract line 1196. docs/deployment.md (line 463) and use case 08 (line 233) state the same facts without the verbatim text, which the spec permits.
- **BRD / entities / HLA / use cases:** BRD 6.4 traceability note and UC08 accepted consequences agree with the code.

## Stale-claim grep
Searched for "stops pairing", "stops matching", "no longer match", "name-based", "matched by name", and rename-plus-match/pair wording across docs/deployment.md, openspec/specs, requirements, and backend source (excluding tests). The only hits are intentional: the forbidden-phrase list in the admin spec, and design.md of this change describing the old behaviour as the problem. "Pair" hits elsewhere are the topic "Pairing" or OIDC subject/issuer pair, unrelated.

## Fixed (trivial text)
- `openspec/specs/topic-management-screen/spec.md` (bulk restore dialog scenario): "one name-matched default" read as if matching were still by name. Changed to "one default blocked by an active same-name topic". No behaviour change.

## Notes for follow-up (not drift, no action taken)
- The legacy-unlinked behaviour (defaults copied before migration 24 that match no template row stay NULL and are offered under the template id/name, TOPIC-005 answering 404) is documented consistently in the spec, runbook and REST contract; it is deferred to #310.
- docs/deployment.md correctly warns that VALIDATE CONSTRAINT holds ACCESS EXCLUSIVE on topics during the scan, which the migration header only partly states (it says VALIDATE scans topics). Acceptable, not drift.
