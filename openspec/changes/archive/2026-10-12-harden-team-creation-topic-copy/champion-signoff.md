# Internal Champion Sign-off: harden-team-creation-topic-copy (#215)

Reviewer: Devon Calloway (Internal Champion). Reviewed proposal, tasks and the code diff (facilitator-sessions.ts, content.ts, default-topics.ts, template-anomalies.ts).

## Verdict: clean sign-off, with two non-blocking follow-ups

## Core constraints
- **No-manager rule:** unaffected. The diff touches only the team-creation topic copy, the restore-list query and a post-commit log. Nothing changes who may join or participate.
- **Simultaneous reveal:** unaffected. No vote, reveal or session-state code is touched. The first-session snapshot still runs after the copy in the same transaction.
- **Facilitator from another team:** unaffected. The creation path's facilitator checks are untouched.
- **Access rules (TOPIC-002):** unchanged. The `topic-customization-lock` delta is wording only.
- **Not a performance tool:** the anomaly log carries ids and codes only, no names, prompts or person data.

## Ritual intent
The change strengthens it. An archived default can no longer come back as active in a new team, and a damaged template can no longer block team creation. The baseline is numbered 1..n, so teams stay comparable (BRD 6.4). The warn log makes silent template drift visible to an operator. No facilitator-visible behaviour changes, and no override or flag was added. Declining the write-guard trigger is acceptable because the CI invariants test covers it and F5 reopens it.

## Follow-ups (non-blocking, not concerns about intent)
1. Task 9.1, the read-only live data check for resurrected defaults, is NOT RUN against live. It must be run by whoever holds live read access before merge, and a count above 0 needs a remediation issue and a note to Rachel Okonkwo.
2. Task 8.1, the F5 (#216) acceptance lines, is still unchecked. Please add them so the audited-template-write requirement and the trigger reconsideration are not lost. FR-8.1 maintainability stays open under F5, as the proposal says.
