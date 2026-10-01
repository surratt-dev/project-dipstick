Target: #53 body

Use cases: "Annotate Topic with Shared Team Definition" and the annotation-display gap in "View Topics During a Live Session (Engineer)" (`requirements/use cases/08 - Topic Management - Use Cases.md`).

**Status: partially delivered (management half).** #53 stays open until team definitions are visible in a live session.

**Correction to the original body:** the original said the live-session topic view "otherwise already works". It does not. No page renders a topic prompt to a participant yet (#57, #56), and `session_topics` is never populated in production (#175). **Team definitions are not visible in any session until #175 and #56/#57 ship.**

Delivered by the `topic-annotation` change (#TBD PR):
- Migration 19: `topics.team_annotation` plus provenance (`annotation_updated_by`, `annotation_updated_at`), and the snapshot column `session_topics.topic_annotation`.
- `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007): Facilitator-only (Application Administrators get `403`, proposed BRD FR-8.7), 500 UTF-16-unit limit, first-session lock, audited without the text.
- TOPIC-002 returns the definition and provenance. The Topic Management screen shows and edits it as "Our team's definition".
- SESSION-005/012 return `currentTopic.topicAnnotation` from the snapshot only. This is checked against fixtures, including a real-Postgres negative test.

Remaining before #53 can close:
- #175: populate `session_topics`, copying `topic_annotation` in the same write (see the #175 note).
- #57 / #56: render the definition in the participant and facilitator session views (ACs posted on those issues).
- #62: decide post-reveal visibility (H4).
