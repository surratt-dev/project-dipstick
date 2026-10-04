# Design: 238-facilitator-reporting-chain-decision (#238)

## Context

The user has made every product decision (`decision-log.md`, rows 1–11). This file records how
the decision gets written down. It doesn't re-argue the decision. The evidence and options are in
`exploration-notes.md`. No application code changes.

## Decisions

### D1. The record is a new `01c` file, structured like 01b

`requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`. Alternatives (appending
to 01b, annotating `Summary.md`, `docs/decisions/`) were weighed in exploration §7, and the BA
concurred:
- 01b is a deferral doc about designation, a different subject.
- `Summary.md` is the source concept and shouldn't carry rationale.
- `docs/` is operator documentation, and #238's AC says `requirements/`.

Section order:
0. Three-sentence summary (the rule, why, what it doesn't catch). Most readers stop here.
1. Status / Owners / Traceability. The VP line records the persona review (Executive Stakeholder,
   approved with conditions) and marks the human VP of Engineering acknowledgment *pending*.
2. Decision, with the glossary line.
3. Resolved-role rule.
4. Why.
5. How it shows up for people.
6. Sessions.
7. Rejected.
8. Residual gaps and standing control.
9. AC disposition, dependency and launch gate.
10. Revisit if.
11. Consequences for other documents.

`Summary.md:12` keeps its wording and gains only a footnote marker and a footnote.

### D2. No `specs/` delta in this change

Main specs must describe what is built. The rule modifies the requirement
"Multi-valued role claims resolve by fixed precedence", which exists only in #235's unmerged
`first-access` delta. `openspec/specs/first-access` and `oidc-auth` on `main` have no precedence
requirement at all. So any delta here would fail one of two ways:
- it would MODIFY a requirement that doesn't exist on `main` (the sync breaks), or
- it would ADD a requirement for behaviour that isn't built (the synced spec is false).

A "decision recorded" requirement would be true, but it isn't a system behaviour, and it would
clutter a capability spec. The normative scenarios go in the follow-up issue draft
(proposal Appendix B). That issue lands them as a delta against the #235 requirement once #235 is
merged. Precedent: `archive/2026-09-29-join-link-use-case-sync` (requirements-doc change, no
spec delta).

### D3. #235 amendments are an appendix, not edits

#235's files are on branch `ccr-b594efa3-9zclgu`, so this change can't edit them. The paste-ready
before and after text lives in proposal Appendix A, so the change has a single place to look.
There are three amendments, each with its own applier:
- **A.1** (Follow-up 2): applied by whichever of #235 and #238 merges second. Until then, #238
  AC 1 is "pending amendment on #235".
- **A.2** (Decision 7 annotation): applied the same way.
- **A.3** (warning text and the #235 spec text pinned to it): applied by the implementation issue.
  The VP made the warning a character-for-character SHALL, and changing it before the code would
  make the docs describe behaviour that doesn't exist.

### D4. Pre-launch items live in the follow-up issue (row 10)

Row 10 names two pre-launch items, and both are checkboxes in the follow-up issue body
(Appendix B): the IdP attestation (no user holds both roles) and the one-time read-only check for
drafts by now-conflicted users. No launch-checklist document is created. 01c cites them by
reference to that issue. The attestation covers the both-roles pair at launch; it is not a control
for residual gaps 1 or 2.

The Facilitator walk-through and notice-copy review are part of the follow-up's PR review, not
pre-launch gates (Executive Stakeholder recommendation 2; they don't trace to row 10).

### D5. Session handling is stated as a decision (row 11)

01c states two rules explicitly, so that a later hardening change doesn't treat them as accidental:
- Drafts stay blocked at room-open and are recreated by another facilitator.
- Sessions already past room-open stay with `sessions.facilitator_id` (#235 Decision 12).

The follow-up issue carries a test for each (AC 8 and AC 10).

## Risks / Trade-offs

- **The record says one thing and the code says another until the follow-up ships.** Mitigation: 01c
  states the interim plainly, and the launch gate (row 8) means no live team is exposed.
- **Appendix A.1 isn't applied** if #235 merges after #238 and nobody remembers it. Mitigation:
  #238 stays open until AC 1 is met, and the PR description and GitHub comments on both issues say
  so.
- **`#NNN` placeholders** remain until the orchestrator files the issue. Mitigation: tasks.md §5
  replaces them, with a grep check.
- **`openspec validate --strict` can't run** here (no CLI). The artifacts mirror archived
  changes by hand.
