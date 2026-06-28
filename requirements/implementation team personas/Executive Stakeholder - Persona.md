# Persona: Executive Stakeholder

## Identity

**Name:** Rachel Okonkwo
**Title:** Vice President of Engineering
**Reports To:** Chief Technology Officer
**Scope:** Oversees multiple product engineering teams across the organization

---

## Background

Rachel has been in engineering leadership for over a decade, spending the last four years at this company. She came up as a software engineer, moved into staff and principal roles, and transitioned into management during a period of rapid team growth. She still reads code when it matters and has strong opinions about engineering culture — but she knows her job now is to make the teams around her effective, not to be the best engineer in the room.

Her organization has grown faster than its practices. Teams are shipping, but Rachel has noticed inconsistency in how different teams talk about their work, where they struggle, and whether problems surface before they become crises. She's seen capable engineers burn out quietly. She's had conversations after the fact that should have happened months earlier.

She has heard about the Engineering Health Check from peers at other companies and from a senior engineer on one of her teams who championed it informally before it had any tooling behind it.

---

## Motivations

### Signal Without Surveillance

Rachel doesn't want to micromanage engineers. She also doesn't want to be surprised. The Health Check appeals to her because it surfaces how teams are actually feeling about their work — not through manager reports or filtered status updates, but through a structured process that engineers own. She wants the trend data and the action item history visible to her without having to attend sessions or ask for summaries.

### Organizational Consistency

Some of her teams have strong retrospective cultures; others don't. She wants a common language and a repeatable ritual she can point to across the organization. The application gives that consistency a home — it's not dependent on a particular manager or senior engineer to keep it alive.

### Early Warning for Engineering Health

The moments that concern Rachel most are the quiet ones: a team where morale is sliding and nobody's said anything, or where technical debt has accumulated to the point that delivery is visibly slowing. The trend dashboard and outlier detection are the features that matter most to her. She wants to catch those patterns in the data before they become a conversation she's having in crisis mode.

### Retention and Trust

Turnover is expensive and disruptive. Rachel believes that giving engineers a structured, psychologically safe outlet for honest feedback about their work — separate from performance reviews and manager one-on-ones — is an act of organizational trust. She views this investment as part of the answer to "why would a good engineer stay here."

### Defensible Investment

As a VP, Rachel has to justify the time and budget this requires. The Health Check's design — brief sessions, low overhead, no external consultants — makes it easy to defend. The application removes the ongoing spreadsheet overhead that previously made scaling the ritual impractical. The ROI argument she makes to her peers and the CTO is: this is cheaper than the cost of one unnecessary attrition event.

---

## Relationship to the Project

Rachel is the executive sponsor. She approved the headcount and time allocation to build the application. She does not attend planning meetings or review pull requests, but she is consulted on scope decisions that affect organizational policy — particularly around who can see what data and how team boundaries are enforced.

She cares about the following product properties:
- **Data access controls:** Metrics for a team should not be visible to people outside that team's reporting structure, with the exception of the Engineering Manager and current facilitator. This is non-negotiable for her; if engineers fear that leadership is using the data to evaluate them individually, the ritual breaks.
- **Manager read-only access:** Engineering Managers can view trends and action items but cannot participate in sessions. This boundary matters to Rachel because she knows the presence of a manager changes what engineers are willing to say.
- **Longevity of the data:** Trends only become meaningful over time. She expects the application to retain full session history indefinitely, not rolling it off.

She does not have strong opinions about the technology stack beyond her standing preference for open-source dependencies and a deployment model that keeps data within the company's infrastructure.

---

## Success Criteria

Rachel will consider this project successful when:

1. Three or more teams have completed at least six sessions using the application, with measurable trend data visible in the dashboard
2. At least one team has used action item tracking to close a loop — an issue surfaced in a session was addressed and marked resolved in a subsequent session
3. She has been able to review a team's trend history and identify something she would not have known otherwise
4. No engineer has raised a concern that the data is being used in a way that feels evaluative or punitive

---

## Concerns and Risks

- **Adoption stalls without a champion on each team.** Rachel knows that tooling alone doesn't change culture. If no senior engineer owns the practice for their team, the sessions won't happen. She is counting on the implementation team to think about the onboarding experience and make the first session low-friction.
- **Over-engineering the application delays value.** She has seen internal tools projects balloon in scope. Her ask to the team is to ship something usable to a first team quickly and iterate, not to build every feature before anyone uses it.
- **If the data ever feels like surveillance, the ritual will die.** This is her deepest concern. The access model, the framing within the app, and the way results are surfaced must all reinforce that this is the team's data, not management's reporting tool.
