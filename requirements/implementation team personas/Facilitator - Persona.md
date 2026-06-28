# Persona: Facilitator (Subject Matter Expert)

## Identity

**Name:** Priya Nair
**Title:** Staff Software Engineer
**Reports To:** Engineering Manager, Platform Team
**Scope:** Individual contributor on the Platform team; serves as a cross-team facilitator for Engineering Health Check sessions across three product teams

---

## Background

Priya has been a software engineer for twelve years, the last five at this company. She spent the first few years here heads-down on platform infrastructure, but over time found herself drawn to the connective tissue of engineering — the practices, rituals, and communication patterns that determine whether a team improves or stagnates. She is technically strong and respected across the organization, which is part of why she gets asked to facilitate.

She was introduced to the Engineering Health Check by the senior engineer who originally championed it internally. She was skeptical at first — another meeting, another process — but agreed to facilitate one session as a favor. What changed her mind was watching a team surface something in the vote that nobody had said out loud in months. The number made it visible. The discussion made it safe to talk about. The action item made it real. She has been facilitating regularly ever since.

Priya currently facilitates for three teams on a rotating schedule. She has run enough sessions to have developed strong intuitions about what works and what breaks down — and clear opinions about what the application needs to replicate, preserve, and improve on.

---

## Motivations

### Preserving the Integrity of the Reveal

Priya has seen what happens when the reveal is not simultaneous. Even a few seconds of visible votes before others commit changes what people say. She knows this from the physical version — the occasional participant who peeks before the countdown — and she is certain the application must make premature visibility technically impossible, not just discouraged. This is the mechanic she will evaluate the application on before anything else.

### A Control Surface That Keeps Her Present

Right now, Priya is tracking everything mentally: who has voted, whether anyone looks confused, whether the trend on this topic looks different from last session, whether the outlier needs to be invited to speak or already looks ready to. She does not want the application to add to that cognitive load; she wants it to absorb some of it. A readiness grid that shows her who has locked in without showing votes, automated outlier flagging, and trend data visible at a glance during the reveal — these are the things that would let her stay present with the room instead of managing a spreadsheet.

### Low-Friction Entry for New Teams

Priya has onboarded several teams to the ritual. The first session is always the hardest: explaining the vote types, setting expectations, getting people comfortable with the format. If the application can shoulder some of that onboarding — surfacing topic explanations, making the vote types obvious without requiring a tutorial — she can focus on the human side of the first session rather than the mechanical side.

### Continuity Across Facilitators

Not every team has the same facilitator every session. When Priya hands a team off to another facilitator, or when she returns to a team after an absence, she has to rely on notes and memory to reconstruct the history. The application's session history and trend dashboard would give any facilitator the context they need without depending on handoff conversations. That makes the ritual more resilient and less dependent on any one person.

---

## Relationship to the Project

Priya is a subject matter expert, not a member of the implementation team. She was interviewed extensively by the BA during requirements discovery and reviewed drafts of the voting mechanics and session flow documentation for accuracy. She is the person the team should go to when a proposed implementation choice might inadvertently change the feel or integrity of the ceremony.

She is available for spot consultations during implementation — particularly for the live session flow, the reveal mechanic, and the outlier detection logic. She has agreed to participate in usability testing of the facilitator view before the application goes to a first team.

The product properties she cares about most:

- **Reveal simultaneity:** All votes must appear at the same instant for all participants. A staggered or polling-based approach is not acceptable, even if it looks simultaneous under normal network conditions.
- **Readiness without spoilers:** The facilitator must be able to see who has locked in without seeing how anyone voted. These are two distinct pieces of information and must be surfaced separately.
- **Outlier flagging that is advisory, not prescriptive:** The application should flag outliers automatically, but Priya decides whether to open the floor. The UI should not make it awkward to skip a flagged outlier — sometimes the person who voted low has already indicated they want to pass.
- **Session pacing under facilitator control:** No automatic topic advancement, no timeouts, no nudges to participants. The facilitator calls it.
- **First-session support:** The application should make the first session for a new team longer and more guided by design, not by workaround.

She does not have opinions about the technology stack and defers entirely to the engineering team on infrastructure and deployment.

---

## Success Criteria

Priya will consider this project successful when:

1. She can facilitate a complete session — from topic one through action item capture — without referring to a spreadsheet or external notes
2. The reveal moment feels like an event: votes appearing simultaneously for everyone, with the aggregate and outliers surfaced immediately after
3. A facilitator who has never used the application can pick up a session for an existing team and have full context from the session history and trend dashboard without needing a handoff conversation
4. After six sessions with one team, the trend data tells her something she would not have noticed from memory alone

---

## Concerns and Risks

- **The reveal gets built as "close enough."** Priya's biggest fear is an implementation where votes appear nearly simultaneously under good network conditions but can desync under real-world conditions. She wants the server to be the single source of truth for when the reveal happens, with clients rendering on receipt — not a client-side timer that approximates simultaneity.
- **The facilitator view gets built as a participant view with extra buttons.** The facilitator's needs during a session are fundamentally different from a participant's. If the distinction is treated as a styling decision rather than a UX architecture decision, the control surface will feel like an afterthought.
- **Outlier flagging creates awkward social dynamics.** If the application highlights an outlier too aggressively — a large callout, a spotlight on the person — it could make participants feel surveilled rather than heard. The flagging should inform the facilitator, not perform for the room.
- **The application ships without usability testing with a real facilitator.** Priya has offered to test. She expects to be taken up on that offer before the first team goes live.
