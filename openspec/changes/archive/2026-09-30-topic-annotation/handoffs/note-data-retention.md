Target: NEW issue (no existing data-retention or user-erasure issue found; searched open and closed issues for "retention", "erasure", "user data deletion", "GDPR / erase / delete user" on 2026-09-30. #121 concerns OIDC log retention only.)

## Data retention and user erasure: team definitions (topic annotations)

topic-annotation (#53) adds team-authored free text that is kept indefinitely and has no in-app remediation:

1. **Clearing a definition does not erase snapshotted text.** `session_topics.topic_annotation` is an immutable per-session snapshot by design. If harmful text is saved (for example, a note about a person, despite the helper text), clearing it on the Topic Management screen removes it from future sessions only. Every session that snapshotted it keeps it.
2. **Remediation is a manual production-database operation** by an operator with DB access. **Who may request it is not defined** anywhere.
3. **Provenance blocks user erasure.** `topics.annotation_updated_by REFERENCES users(id)` has no `ON DELETE` behaviour, the same as `archived_by` and `restored_by`. Deleting a user who ever edited a definition fails on the FK.
4. The audit log deliberately never contains the text (`topic.annotation_updated` metadata is `{ topic_id, action, length }`), so the audit log is not a source of the text and needs no scrubbing for it.

**Needs a decision on:** a retention period (if any) for definition text and its snapshots, a documented requester and procedure for removing text from past sessions, and the FK behaviour for the provenance columns on user erasure (`SET NULL` is the likely answer, applied to all three provenance pairs together).
