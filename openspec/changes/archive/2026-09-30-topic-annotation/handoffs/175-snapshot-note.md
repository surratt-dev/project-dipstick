Target: #175 comment

## Snapshot content requirement from topic-annotation (#53)

`topic-annotation` added `session_topics.topic_annotation` (migration 19, nullable text, no CHECK). SESSION-005 (begin-voting) and SESSION-012 (topic advance) now return `currentTopic.topicAnnotation`, read **only** from that snapshot column, never from live `topics.team_annotation`.

When #175 writes `session_topics` rows, the write must copy the annotation along with the rest of the row. The requirement is pinned in the `session-topic-lifecycle` spec (`openspec/changes/topic-annotation/specs/session-topic-lifecycle/spec.md`, merged into `openspec/specs/session-topic-lifecycle/spec.md` when the change is archived) under "A session topic snapshot copies the topic's annotation in the same write as the rest of the row" (Status: pending, #175):

- Each row's `topic_annotation` equals its source topic's `team_annotation` **at that instant**, in the **same write** (same statement or transaction) as `topic_name`, `topic_prompt`, `vote_type`, and `display_order`.
- The write completes before the session's first SESSION-005 call can succeed.

Concretely, the `INSERT … SELECT` that populates `session_topics` must include the column, for example:

```sql
INSERT INTO session_topics
  (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, topic_annotation)
SELECT $1, t.id, t.display_order, t.name, t.prompt, t.vote_type, t.team_annotation
  FROM topics t
 WHERE t.team_id = $2 AND t.status = 'active';
```

If the column is left out, nothing fails. The definition is just silently `null` in every session, and the first sign would be #57's first test showing a permanently-null field.

**Open question for #175 (H2, not decided by #53):** is the whole `session_topics` row written at session creation or when the session leaves `draft`? topic-annotation's rule holds either way, as long as the annotation is copied in the same write as the rest of the row. Facilitator input (Priya, explore review O2): sessions can be created days ahead in `draft`, so snapshotting at creation would freeze a definition edited between creation and the session itself.

The real-Postgres negative test in `packages/backend/src/routes/__tests__/topic-annotation-integration.test.ts` (tasks.md 6.4) shows that SESSION-005/012 return the snapshot even after the live topic is edited. Once #175 lands, add a test that drives the real snapshot write and checks `topic_annotation` is copied.
