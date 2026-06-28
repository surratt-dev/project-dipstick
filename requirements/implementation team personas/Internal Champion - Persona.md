# Persona: Internal Champion (Subject Matter Expert)

## Identity

**Name:** Devon Calloway
**Title:** Principal Software Engineer
**Reports To:** Vice President of Engineering (dotted line); Engineering Manager, Consumer Products Team (home team)
**Scope:** Individual contributor with cross-organizational influence; informal keeper of engineering practice standards across the department

---

## Background

Devon has been a software engineer for eighteen years and has been with this company longer than anyone else on the engineering side. He has watched the organization grow from a single team to a multi-team department, and he has strong views about what gets lost when teams stop talking honestly about how the work feels. He is not a manager and has no interest in becoming one — his influence is earned through technical credibility and a consistent record of being right about things that matter.

He encountered the Engineering Health Check at a previous company, before it was widely known, through a colleague. He ran it informally on his own team here for over a year using a shared spreadsheet and whatever senior engineer from another team he could talk into facilitating. The ritual worked well enough that word spread and other teams started asking him to explain it.

Devon was the person who eventually made the case to the VP of Engineering that the process deserved proper tooling. He wrote the original internal proposal that became the foundation for this project. He was involved in early requirements discussions but handed off the formal documentation work to the BA once the project had momentum. His role now is more like a founding advisor — consulted when there are questions about intent, less involved in the day-to-day.

---

## Motivations

### Seeing the Ritual Outlive Him

Devon knows that as long as the Health Check depends on him — his advocacy, his memory of how it works, his willingness to explain it to each new team — it is fragile. The application changes that. If the ritual is embedded in software, with session history, topic definitions, and trend data that any facilitator can access, it can survive his departure, his promotion, or just his eventual loss of interest. That institutional durability is the thing he cares about most.

### Fidelity to the Original Design

Devon has seen versions of retrospective rituals get softened, gamified, or reframed until they no longer do the thing they were supposed to do. The simultaneous reveal, the no-manager rule for participation, the brief sessions, the facilitator-from-another-team requirement — these are not preferences, they are load-bearing. His motivation is to make sure the application does not accidentally undermine them by making them optional, skippable, or easy to work around.

### Spreading the Practice Without Spreading Himself Thin

Running the ritual informally across multiple teams was sustainable for a while, but it required Devon to be the explainer, the advocate, and the institutional memory all at once. The application should make it possible for a team he has never spoken with to adopt the practice correctly, without needing him to show up and walk them through it. He wants the tool to carry the knowledge he has been carrying manually.

### Validating That the Investment Was Worth Making

Devon put his credibility behind this project when he made the case to the VP. He is motivated — partly personally, partly professionally — to see it succeed. A successful rollout to multiple teams with measurable engagement validates the argument he made. A tool that sits unused, or that teams adopt and then abandon, reflects poorly on the case he made and on the practice itself.

---

## Relationship to the Project

Devon is a subject matter expert and founding advisor. He is not a member of the implementation team and does not attend sprint ceremonies. He is the person the team should consult when a requirement or design decision touches the core intent of the ritual — particularly anything that might make a protective constraint optional or easy to bypass.

His most significant contributions to the project were made before the BA joined: the original proposal document, the initial topic list, and the framing that shaped what the application is and is not trying to do. The BA's requirements are downstream of Devon's foundational thinking.

The product properties he cares about most:

- **The no-manager-participation rule:** Engineering Managers must not be able to join a session as a participant, even if they request it. Devon knows from experience that a single exception to this rule changes what engineers are willing to say, and that exceptions have a way of becoming norms.
- **Facilitator from another team:** The application should not make it easy to start a session with a facilitator from the same team. Whether this is a hard block or a strong warning is a design decision — Devon leans toward a hard block — but it must not be silent.
- **Topic flexibility within guardrails:** Teams should be able to add, remove, and adapt topics. But Devon wants the default topic set to be visible and easy to restore, so that teams can experiment without losing the baseline.
- **The application does not try to be a performance tool:** Session data must not be surfaceable in a way that allows comparison of individual engineers across teams or over time. The Health Check is about team health, not individual performance. Devon would rather the feature not exist than exist with insufficient access controls.

He does not have opinions about technology choices but has a standing preference — shared with the VP — for open-source dependencies and on-premises deployability.

---

## Success Criteria

Devon will consider this project successful when:

1. A team he has never spoken to adopts the ritual using the application without needing him to explain it
2. The ritual is still being practiced, with the same core mechanics intact, two years after the application launches
3. At least one team uses the trend dashboard to identify and address a sustained negative trend — the scenario he has been making the case for since the beginning
4. No manager has participated in a session, and no exception to that rule has been made

---

## Concerns and Risks

- **The constraints get treated as configurable options.** Devon's deepest concern is that the no-manager rule, the simultaneous reveal, and the facilitator-from-another-team requirement get implemented as defaults that administrators can toggle off. Once something is configurable, someone will configure it. These constraints need to be structural, not preferential.
- **The application makes the ritual feel like software.** The Health Check works because it feels like a conversation, not a process. If the application is too prominent — too much UI chrome, too many notifications, too many gamification elements — it risks making the ritual feel like a tool being run on engineers rather than a conversation engineers are having. Devon wants the application to disappear into the background once the session is underway.
- **Adoption is declared a success too early.** A team completing one or two sessions is not adoption. Devon is concerned that the project will be declared a success after early rollout numbers look good, before any team has accumulated enough data for the trends to be meaningful. He wants the success metrics to be set at a threshold that requires sustained use.
- **He becomes the escalation path for every edge case.** Devon is willing to be consulted, but he is not willing to be the help desk. He wants the requirements documentation to be thorough enough that the implementation team can resolve most questions without involving him — and he has said this directly to the BA.
