# Persona: Business Analyst

## Identity

**Name:** Marcus Delgado
**Title:** Senior Business Analyst
**Reports To:** Director of Product Management
**Scope:** Embedded with the implementation team for this project; typically supports two to three internal tooling initiatives at a time

---

## Background

Marcus started his career in QA, which gave him an instinct for edge cases and a habit of asking "but what happens when..." before anyone else in the room thinks to. He moved into business analysis after realizing he was more interested in understanding why a system was built the way it was than in finding bugs in it. He has spent the last six years as a BA, mostly on internal tooling and operations software — not customer-facing products — which has shaped how he thinks about requirements. Internal tools have real users with strong opinions and no tolerance for software that ignores how their work actually flows.

He was not the person who invented the Engineering Health Check ritual; that happened before he joined the company. He was brought onto this project after a VP-level decision was made to build a web application to replace the spreadsheet. His job was to get close enough to the ritual to understand what the spreadsheet was actually doing — and what it wasn't — and then translate that understanding into requirements the implementation team could build against.

That process took longer than expected. The ritual looked simple from the outside: a set of prompts, a vote, some numbers in a spreadsheet. Getting beneath the surface required sitting through actual sessions, interviewing facilitators with different styles, and understanding why certain mechanics — particularly the simultaneous vote reveal — were not incidental but load-bearing. The requirements he produced are the result of that digging.

---

## Motivations

### Protecting the Ritual's Intent

The simultaneous reveal is not a UX preference — it is the point. If engineers can see how others voted before they commit, the honesty of the vote collapses. Marcus spent real effort understanding why this mechanic matters and made sure it is reflected unambiguously in the requirements. His motivation is to ensure that what gets built actually supports the ceremony as designed, not a superficially similar version of it that loses the thing that makes it work.

### Requirements That Are Buildable, Not Just Correct

Marcus has worked with engineers long enough to know that a requirement that is accurate but ambiguous creates more problems than it solves. His goal is for the implementation team to rarely have to come back to him with "what did you mean by this?" The use cases, entity definitions, and voting mechanics documentation he produced are meant to be precise enough to build from directly.

### Closing the Gap Between the Spreadsheet and the Application

The existing spreadsheet solves some problems adequately and others poorly. Marcus has been explicit in the requirements about where the application should preserve what the spreadsheet does, where it should improve on it, and where it should deliberately not try to replicate it. He is motivated to ensure the application earns the migration — that teams who switch don't feel like they gave something up.

### Traceability From Requirement to Feature

Marcus cares about being able to trace a feature decision back to a stated requirement, and a requirement back to a real user need. This matters to him both professionally — it is how he can demonstrate the value of his work — and practically, because scope disputes are easier to resolve when there is a documented chain from user observation to product decision.

---

## Relationship to the Project

Marcus is the primary requirements author. He produced the use cases, the entity and relationship model, the voting mechanics documentation, and the web application proposal that frames the project for the implementation team. He is the person the team goes to when a requirement is unclear or when a new scenario surfaces that hasn't been documented.

He attends implementation planning sessions when invited but does not manage the team's backlog or make technical decisions. His active involvement is heaviest at the start of a feature area and at the point when the team's implementation questions reveal gaps in the requirements.

The product properties he cares about most:

- **Simultaneous reveal integrity:** The application must make it technically impossible for any participant to see another's vote before the reveal is triggered. This is a hard requirement, not a preference.
- **Facilitator control surface:** The facilitator's view must be clearly distinct from the participant view. A facilitator who accidentally sees votes early, or who cannot tell who has locked in, breaks the session for everyone.
- **Outlier detection logic:** The thresholds for flagging individual and trend outliers need to be configurable or at least documented as explicit decisions — not magic numbers buried in code. Marcus documented a starting point; the team needs to make it visible.
- **Action item continuity:** Action items must persist across sessions and be reviewable at the start of each new session. This is one of the places where the spreadsheet falls short, and it is an explicit improvement the application is meant to deliver.
- **Topic history preservation:** When a team removes a topic, its historical data must be retained. Marcus encountered this edge case in discovery and it is documented; he wants to make sure it does not get cut as a "nice to have."

He defers to the engineering team on technology choices and deployment decisions, and to the VP of Engineering on anything touching organizational policy around data access.

---

## Success Criteria

Marcus will consider this project successful when:

1. The implementation team can build each feature area from the documented requirements without needing to re-interview stakeholders or reconstruct intent from scratch
2. A facilitator who has never used the application can run a complete session — including the reveal, outlier flagging, and action item capture — without consulting documentation
3. The features that matter most to the ritual (simultaneous reveal, trend visibility, action item continuity) are present and correct in the first production-ready release
4. When scope questions arise during implementation, the requirements documents are the first place the team looks — not a Slack message to Marcus

---

## Concerns and Risks

- **The reveal mechanic gets simplified away.** The simultaneous reveal is technically the hardest part of the application to implement correctly and the easiest to rationalize cutting corners on. Marcus is concerned that time pressure could lead to an implementation where votes are "revealed together" in spirit but not in practice — for example, a polling approach where votes trickle in rather than appearing truly simultaneously.
- **Facilitator and participant views blur.** If the facilitator view is built as a variation of the participant view rather than a distinct control surface, the distinction will erode over time. Marcus documented these as separate experiences deliberately.
- **Edge cases discovered late become scope disputes.** The requirements cover the scenarios Marcus found during discovery, but he knows there are scenarios he didn't find. He is concerned that edge cases surfacing during implementation will be treated as out-of-scope rather than as gaps to close — particularly around topic management and session state recovery.
- **The first release ships without trend data.** Trend visibility requires multiple sessions of data before it becomes meaningful. If the dashboard ships in a state where it looks empty or broken for new teams, adoption may stall before the value is apparent. Marcus wants the team to think about the "zero sessions" and "one session" states explicitly.
