# Proposal Review: Executive Stakeholder (Rachel Okonkwo, VP Engineering)

Change: 264-topic-002-audit-non-admin-denials. Focus: strategic alignment, proportionality, scope creep.

## Verdict

Approve the intent. Do not approve the shape as written. Conditional approval: shrink the spec, resolve the open decisions with named owners, and do not let this block anything that serves first-team adoption.

## What I like (it serves my concerns)

- It protects the no-manager rule on the most sensitive screen ("our team's definition"). Recording who probes that screen is the access-control evidence I need to tell the CTO the boundary is real.
- The "never told" constraint (no banner, toast or response text) is correct and is the part that matters most to me. If engineers or facilitators ever feel watched, the ritual dies. The proposal states this plainly.
- Rows record who tried, never what was behind the door, and no non-admin endpoint exposes them. Good: this is not a surveillance feature aimed at engineers.
- No migration, no API change, no UI change. Low delivery risk.
- The proposal is honest about limits: it does not claim SEC-13 mandates this shape, and it admits there is no alerting (#131).

## Concerns

### 1. Proportionality: 12 ADDED requirements for one audit row is not proportionate

The spec file is 155 lines of ADDED requirements, in a change whose entire runtime effect is one INSERT plus one log event on one 403 path. Total change folder is about 660 lines before any code. Several requirements are the same behavior sliced thin:

- Requirements 1, 2 and 3 (one durable row; what it records; metadata has exactly three keys) are one requirement.
- Requirements 4 and 6 (event pairs with row; reason labelling) are one.
- Requirements 9, 10 and 11 (failed audit stays 403; failure event; fail-open vs fail-closed distinct) are one failure-mode requirement, and it is the one still pending a Security decision.
- "Reads no team content", "keeps its order and response unchanged" and "admitted callers pay nothing" are non-functional properties that belong in one or two scenarios, not three requirements.

I would expect roughly 4 requirements: (a) denial writes one durable row with fixed metadata, (b) response is unchanged and never discloses the audit, (c) audit failure never turns a denial into an allow, (d) rows are not exposed to non-admins. Every extra requirement is something the team must keep true, test and maintain forever. That is overhead, not value.

### 2. The value-to-effort ratio is weak for adoption right now

My success criteria are teams running sessions, a loop closed, trend insight, and no one feeling surveilled. None of those move because a global EM's 403 on a topic-config screen is now a durable row. This is hardening of a rare path. The benign-volume note confirms it: the most common trigger is a member-facilitator clicking an always-rendered Topics link, so the dominant data in this table will be noise from a UI flaw (Follow-up 1), not attacks. Fixing the link is the higher-value item and is correctly noted but deferred and unfiled (P5).

Question for the team: is there an actual compliance deadline (SEC-13 audit, customer review) forcing this now? If so, say so in the proposal, since it justifies the spend. If not, this is a nice-to-have competing with onboarding and first-session friction, which I flagged as my top risk.

### 3. Scope creep signals

- A failure-mode taxonomy (fail-open vs fail-closed, per-step failure events, a new `topic.audit_write_failed` event) is a reliability design for an audit row on a rare 403. It adds a second new operation, a docs entry and a distinct-from-admin-rule requirement. Pick one simple rule (the 403 always returns; failures log) and move on.
- Timing floor ordering, byte-identical body, and "exactly three keys" are defensible for security hygiene but are specified to a level that reads like a standard being built, not a feature being shipped.
- Reconciling `team-content-access` and extending the visibility guard is reasonable housekeeping, but it is a second spec delta for the same row.
- Five open decisions (P1 to P5) across four owners, on a change this small, is a coordination cost larger than the code.

### 4. Policy concern worth settling before build

A durable record of every time a member-facilitator clicks Topics is, in effect, a log of individual engineers' navigation. The proposal says no one is told and no one reads it. I want an explicit retention and access statement: who in the admin role can query these rows, and for how long are they kept. Even though they are admin-only, "the system quietly records engineers' clicks" is exactly the story I do not want told about this product. Recommend not writing a row for `FACILITATOR_IS_TEAM_MEMBER` at all (a benign, expected path, not an access violation) and keeping the durable row for the genuine violation, `NOT_A_FACILITATOR`. This also removes the noise problem and simplifies the spec. P1 mentions keeping the durable row for this reason; I would push back on that recommendation.

## Requests

1. Collapse the 12 requirements to about 4, with scenarios carrying the detail. Target: spec under half its current length.
2. Drop durable rows for `FACILITATOR_IS_TEAM_MEMBER`, or justify them against the privacy concern above.
3. Pick the simplest failure rule and drop the extra failure-event machinery unless Security insists.
4. File Follow-up 1 (Topics link for member-facilitators) now and prioritize it ahead of or alongside this change. It is the real user-facing problem.
5. State the driver for doing this now (compliance date or otherwise), and a retention and access line for the rows.
6. Close P1 to P5 with named owners and a date, or reduce them.

## Escalation threshold

I do not need to be consulted again if the revised proposal stays within the above. I would need to be consulted if the design adds any non-admin read path to these rows, any aggregation or alerting over them, or any user-visible signal that attempts are recorded.
