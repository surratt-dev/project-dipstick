SIGN-OFF: CLEAN

# Champion sign-off: bulk-restore-default-topics (#218)

Reviewer: Devon Calloway, Internal Champion.

## Did it preserve the ritual's intent?

Yes. This change serves the "default set is visible and easy to restore" property I care about (FR-8.6) and adds no new way around any protective constraint.

- **No-manager rule: unaffected.** The endpoint writes topic rows only. It does not touch membership or participation. I saw no new path for a manager to become a participant.
- **Facilitator from another team: preserved.** The handler runs the same role gate as single restore. A facilitator who belongs to the team gets `403 FACILITATOR_IS_TEAM_MEMBER`, and a non-facilitator gets `403 NOT_A_FACILITATOR`. Both 403s are explicit, not silent. Bulk restore adds no weaker route.
- **Customization lock (first session on the canonical baseline): preserved.** The same `409 TOPIC_CUSTOMIZATION_LOCKED` gate applies. There is no "bulk is exempt" carve-out and no flag or env var.
- **Simultaneous reveal: unaffected.** Restore is pre-session preparation. Topics are snapshotted at room open, so a live room is not changed. Participants see nothing of the control or result.
- **Not a performance tool: preserved.** Audit rows carry ids, positions and counts only, never topic text. No participant-facing "who restored" surface was added.
- **Honest naming and no reset semantics.** The control is "Restore default topics", not "Reset". It does not delete customs or undo reorders. Copy does not promise canonical wording, because the original edited row returns. Duplicates are skipped and reported, not silently created.

## Notes (not blocking)

- The timing-floor measurement (tasks 4.12 and 4.14) remains a documented production gate. I am not raising it as a concern.
- FR-8.6 is correctly left "partially met": edited, deleted or never-existed defaults and canonical wording are still open.
- The skipped-for-name-clash behaviour is stricter than single restore. I am comfortable with that, and the follow-up to align single restore is already listed.
