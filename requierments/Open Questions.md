# Engineering Health Check — Undefined & Vague Points

The following are gaps, ambiguities, or undefined terms found in the process description.

---

## Voting Mechanics

**1. Finger vote scale direction is undefined.**
The scale is 1–4, but the document never states which end is good and which is bad. Does 4 = excellent or 4 = terrible? All participants need to share the same mental model for votes to be meaningful.

**2. "Outlier" is never defined.**
The facilitator is instructed to note outliers and prompt discussion, but there is no threshold or rule for what qualifies. Is a vote of 1 when everyone else votes 4 an outlier? What about a 2 in a group of 3s? A numeric definition (e.g., ±1.5 from the average) would make this consistent across facilitators.

**3. "Significant change from trend" is undefined.**
The process mentions prompting discussion when a vote represents a significant change from trend, but "significant" is not quantified. Without a threshold, this is left entirely to facilitator judgment, introducing inconsistency.

**4. Roman vote for "sideways" is only partially explained.**
The document states that only one topic (Project Trend) allows a sideways thumb, but does not explain what sideways means in the context of the other Roman vote topics, or whether participants who feel neutral on those topics should vote up or down.

---

## Roles & Responsibilities

**5. How the facilitator is sourced is undefined.**
The document requires a facilitator from another team, but provides no guidance on how to find one, whether it should be a recurring assignment or rotated, or what happens if no willing facilitator from another team is available.

**6. "Senior engineer" for action items is ambiguous.**
When an issue is identified, "a senior engineer on the team should take it as an action item." It is unclear whether this means a specific named role, the most senior person present, or any engineer willing to own it. Without clear ownership, action items may go unaddressed.

**7. Quorum is deferred but never guided.**
The document says the team should decide what constitutes a quorum but offers no suggested baseline (e.g., 75% attendance). Teams starting fresh have no anchor point for this decision.

**8. "Significant conflict" is undefined.**
The document instructs the team to escalate "significant conflict" to an engineering manager but gives no criteria for what rises to that level versus what the facilitator should handle in the room.

---

## Artifacts & Tracking

**9. The spreadsheet is mentioned but never described.**
The spreadsheet is central to the process — it holds all votes and trends — but the document provides no template, column structure, or example. Teams must independently invent their own format, leading to inconsistency.

**10. Action item tracking is optional and informal.**
Tracking action items across sessions is listed as something to "consider" in the Additional Notes, not as a required part of the process. There is no defined owner, format, or follow-up mechanism.

**11. Where the spreadsheet lives is unspecified.**
No guidance is given on who owns the spreadsheet, where it is stored, or who has access to it — including whether historical data stays with the team or the facilitator.

---

## Scope

**12. "Production code" is not defined.**
Two topics reference "production code" without defining what that includes. Does it cover all deployed code? Only the primary application? Shared libraries? Infrastructure-as-code? Each team likely interprets this differently.

**13. Legacy vs. greenfield scope is unresolved.**
The FAQ acknowledges the question but defers the decision entirely to the team without criteria to guide the choice. Teams with mixed codebases have no framework for deciding.

**14. "Test Suite Time" collection is optional with no decision criteria.**
The document says collecting test suite run time "can be tedious to collect and may not be necessary" but gives no guidance on when it is necessary or what threshold would make it worth tracking.

---

## Session Conduct

**15. "Brief discussion" is never time-boxed.**
The word "brief" is used repeatedly for outlier discussions, but no time limit is given (e.g., 2 minutes per topic). Without a limit, individual topics can expand and consume the 30-minute session.

**16. The first session is an hour, but the extra time is unstructured.**
The recommendation to make the first session an hour is not accompanied by an agenda or instructions for how to use the additional time (e.g., topic alignment, process walkthrough, establishing shared definitions).

**17. Remote participation is not addressed.**
The document assumes a physical conference room with a display. No guidance is given for distributed teams or hybrid sessions, including how voting works without in-person hand signals.
