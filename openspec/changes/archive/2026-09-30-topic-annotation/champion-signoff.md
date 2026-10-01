Verdict: SIGN-OFF

# Champion sign-off: topic-annotation

Devon Calloway, Internal Champion, 2026-10-01

I asked for this feature so that a team's meaning would survive facilitator rotation. This change delivers the part that can be delivered today, and it does not trade away anything structural to get there.

## The three load-bearing constraints

- **No-manager rule: unaffected, and protected going forward.** No surface a manager can reach gains the annotation. TOPIC-007 is Facilitator-only, and the tests reject engineering managers. TOPIC-002 is still facilitator/admin-only. TOPIC-001 deliberately does not select the column. The code comment and the spec (`topic-annotation` spec, line 200) both say that a future change must deny engineering managers on TOPIC-001 before it adds the field. TOPIC-001 still answering `200` to EMs is a defect that predates this change, and it is drafted as a follow-up (`handoffs/new-issue-topic-001-em-and-casing.md`). It does not block this sign-off. It is the next thing I want fixed, because it is the exact kind of quiet exception I worry about.
- **Simultaneous reveal: unaffected.** SESSION-005 and SESSION-012 only gain `currentTopic.topicAnnotation`, read from the `session_topics` snapshot. No vote, reveal, or phase logic changed, and the WebSocket payloads were not touched.
- **Facilitator from another team: unaffected, and reinforced.** Editing reuses the standing, non-member facilitator check (`FACILITATOR_IS_TEAM_MEMBER` → `403`), so a team cannot write its own definitions through a same-team facilitator. The feature exists because that rule has a cost, and it pays that cost without weakening the rule.

## Other intent I checked

- **Nothing became configurable.** No toggle, flag, or admin override was added. `canEditAnnotations` only controls what the screen shows, and TOPIC-007 enforces the same rule on its own.
- **The question cannot change mid-session.** The session reads only from the snapshot, and a required negative test proves that a live edit does not change an existing session. The first-session lock covers annotation, so every team's first session runs the canonical baseline.
- **It is not a performance tool.** The helper text says it is not for notes about people. The audit log records the length and the action, never the text. The template team's annotations are never seeded into new teams.
- **The default baseline stays visible.** The annotation sits beside the canonical description and does not replace it.

## Caveats I accept, stated plainly

- No one will see a team's definition in a live session until #175 and #56/#57 ship. Do not report #53 as done. The body correction and the C1–C3 conditions belong to the human.
- A definition nobody writes protects nothing. Filing the capture-prompt issue (C2) matters for adoption.
