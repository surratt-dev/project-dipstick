Target: #56 comment, #57 comment, #62 comment (one section per issue)

Source for each section: topic-annotation design.md Decision 11. The team lead posts these. No agent posted them.

The team definition ("Our team's definition") is stored by #53 (topic-annotation, partially delivered). In-session display is the job of these issues. The **only** source for in-session display is `currentTopic.topicAnnotation` in the SESSION-005 (begin-voting) and SESSION-012 (topic-advance) responses. It is read from the `session_topics` snapshot and **never** from TOPIC-001 or TOPIC-002. Nothing appears in a real session until #175 populates `session_topics`.

---

## #57 — participant vote-prompt UI

Please add these acceptance criteria:

1. Render `topicAnnotation` from the SESSION-005/012 payload only, never from TOPIC-001 (`GET /teams/:teamId/topics`) or TOPIC-002 (`/topics/all`).
2. Label it "Our team's definition". Order: prompt, then definition, then description.
3. Secondary weight: after the prompt, body size or smaller, not collapsed, with no banner, background, or border treatment.
4. Render no element at all when `topicAnnotation` is null. No placeholder or nudge.
5. Unattributed: no editor name or date in the session.
6. (See #56: the facilitator view shows it too.)
7. A late joiner or reconnecting participant sees it immediately. The WebSocket reconnect snapshot carries no prompt today and so no definition; widening it is **this issue's** work. The widened snapshot must carry the **snapshot** value (`session_topics.topic_annotation`), never the live `topics.team_annotation`, and must go through the same per-connection authorization as the rest of the snapshot.
8. (See #62 for post-reveal visibility.)
9. Render as plain text: React text nodes with `white-space: pre-wrap`. No `dangerouslySetInnerHTML`, no Markdown or HTML interpretation, and no `href`, `src`, or `style` built from the text. This is team-authored free text shown to every participant, and React escaping is the only XSS control while CSP stays disabled (`app.ts`).

## #56 — live-session topic-advance UI (facilitator)

Please add these acceptance criteria:

1. Render `currentTopic.topicAnnotation` from the SESSION-005/012 responses only, never from TOPIC-001/002.
2. Label "Our team's definition". Order: prompt, then definition, then description.
3. Secondary weight, as on the participant view (no banner, background, or border).
4. No element when null.
5. Unattributed in the session.
6. **Shown to the facilitator as well as participants.** The facilitator comes from another team, and this is the text that tells them what the topic means to this team.
7. After a topic advance, the facilitator view shows the new topic's definition from the SESSION-012 response, with no extra fetch.
8. Plain text only, as in #57 AC 9.

## #62 — vote-reveal results UI

Please add this acceptance criterion, for the owner to decide (H4, open):

- **Recommendation (topic-annotation, not decided by #53):** the team definition stays **visible and stationary** from voting through reveal and discussion. It does not move, collapse, or disappear when results render. The reason: the discussion after a reveal is when people ask "wait, what are we counting here?", and the definition answers that. The use case currently says "voting phase". Whoever owns #62 decides, with Priya, and the use case is updated to match.
- If kept visible: same rules as #57 (snapshot payload only, label, secondary weight, unattributed, no element when null, plain text).
