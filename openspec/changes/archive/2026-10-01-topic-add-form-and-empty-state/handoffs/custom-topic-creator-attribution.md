# Title: Show who added a custom topic and when

**Type:** enhancement
**Raised by:** Priya Nair (facilitator review of #55, Q3)
**Related:** #55

## Body

Facilitators hand teams off to each other. Archived rows already show `archivedBy` / `archivedAt` for continuity. A facilitator picking up a team should likewise be able to see where a custom topic came from, e.g. "Custom · added by Priya, Aug 2026", without needing a handoff conversation.

Today the `topics` table has `created_at` but no `created_by` column (`packages/backend/migrations/2_create_tables.sql`), and TOPIC-002 exposes neither for active rows.

Interim source of truth: TOPIC-003 already writes a `topic.custom_added` row to `audit_log` inside the insert transaction (actor, role, team, `topic_id`), and topic name, prompt, and vote type are immutable. So the creator of every custom topic added through TOPIC-003 is already recorded; this issue is about exposing it on the screen. The migration may backfill `created_by` from `audit_log` rather than leaving existing custom topics null (security design review of #55, §5).

### Scope
- Migration adding `created_by` (nullable; existing and default rows stay null).
- TOPIC-003 writes it.
- TOPIC-002 exposes `createdBy` (display name) and `createdAt` for custom topics.
- The management screen shows it on custom rows only, quietly, next to the "Custom" tag.

### Guardrail
This is facilitator provenance on configuration, the same kind as `archivedBy`. It must not be extended to anything that attributes votes or session content to individuals.

### Acceptance
- [ ] Newly added custom topics show creator and date on active and archived rows.
- [ ] Default topics show nothing.
- [ ] Custom topics created before the migration show the date only.
