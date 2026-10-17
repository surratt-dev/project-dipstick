# BA Review of Exploration Notes: zero-topic-team-recovery (#200)

Reviewer: Marcus Delgado, Senior Business Analyst
Question asked: are the ideas specific enough to become requirements, and where are they hand-wavy?

## Overall verdict

The technical design (section 4) is unusually precise and mostly requirement-ready. The weak points are upstream and downstream of it: the problem statement (does the population exist?), the user-facing outcomes (copy, confirmation, what the admin sees after), and the traceability to FR-8.6 and the use cases. Several statements are design decisions dressed as requirements, and a few real requirements are missing. Edge cases found late become scope disputes, so I have listed them now.

## A. Clarifications needed (blocking a proposal)

1. **Is the problem real? (Q1, section 2).** The proposal cannot state a business need while the population is "probably zero". Require the diagnostic query result as a precondition of the proposal, or the proposal must state explicitly that the work is justified by FR-8.6 [HARD] regardless of population. Pick one. Suggested acceptance: "The proposal cites either (a) the count of zero-active-topic teams per deployed environment, or (b) the FR-8.6 clause that mandates recovery independent of count."
2. **Which acceptance bullet are we closing?** Section 8 says Option A would "strictly" close bullet 1, then recommends B anyway. The proposal needs a single sentence of intent: "We build B because FR-8.6 [HARD] is otherwise unmet for the zero-active state." Without it, scope will be relitigated.
3. **Who is the actor?** The use case actor is "Application", the endpoint is admin-only, and the issue says admin-only. Define "application admin" using the existing role name and confirm it is the same population as in #208. State whether an admin who is also a member of the team, or who is on no team, is treated the same (the notes say membership is irrelevant; make that a stated requirement, not an aside).
4. **"Zero active" vs "zero rows" (section 6).** Recommended as zero active, but the consequence is a new situation: a team with archived rows only. Confirm the product intent: archived rows are untouched, and the assigned defaults may duplicate the text of archived topics. Is a duplicate-text active/archived pair acceptable to users? State it.
5. **Concurrency with an in-flight session.** A draft session may exist for a zero-topic team. After assignment, does the draft use the new topics at room open (snapshot at open, as I read it)? State that explicitly so facilitators are not surprised. Also: can a session in any state other than draft exist for such a team? If yes, behaviour is undefined.
6. **Error code and endpoint naming (Q2).** Not a requirement question by itself, but `NOT_AN_ADMIN` and `TEAM_HAS_ACTIVE_TOPICS` need to be named in the spec, since clients key off them. Decide before proposal, not during build.

## B. Vague areas and suggested rewrites

### B1. "Honest" empty-state copy (section 5)
"Honest" is not testable. Rewrite as exact strings per viewer variant, with the spec holding the strings, as the existing spec does.
- Suggested acceptance: "Given an application admin viewing a locked team with zero active topics, the page shows the exact text X and a button labelled 'Assign default topics', and does not show any sentence directing the viewer to ask an administrator."
- "Given a non-admin viewer in the same state, the page shows no button and shows text Y."
- The notes give admin copy but leave non-admin copy as "keep, or optionally replace". An option is not a requirement. Brian must decide H1 (Q4) before the proposal; I recommend naming the role, agreeing with Devon, since a named role is actionable.

### B2. "Confirmation dialog: probably not needed"
"Probably" cannot be carried forward. Decide. My position: no dialog, because the action is additive and refuses on a non-empty team. Acceptance: "One click triggers the request; there is no intermediate prompt; the button is disabled while the request is in flight."
Missing: in-flight state, success feedback, and failure feedback.
- "On 200/201 the page refetches and shows the standard topic list; no stale empty state remains."
- "On 409 TEAM_HAS_ACTIVE_TOPICS the page refetches and shows the current list, with a brief notice that topics already exist (not an error banner)."
- "On the fixed 500 the page shows a generic failure message and the button remains available for retry."
These three outcomes are currently unspecified and are what a user actually sees.

### B3. "`canAssignDefaults` (or equivalent)"
"Or equivalent" is a deferral. Require: field name, type, and the fail-closed rule. Acceptance: "The TOPIC-002 response includes `canAssignDefaults: true` only when the caller is an application admin and the team has zero active topics; in all other cases it is false or absent, and the UI renders no button." Add a test condition for each non-true combination: admin with active topics, non-admin with zero topics, template team.

### B4. "Atomic with respect to every other structural topic write and room open" and "no window"
Good intent, but it is an implementation claim. Express as an observable requirement: "Two simultaneous calls on a zero-active team yield exactly one success and one 409, and the team ends with exactly the template's topic count." Also: "A topic add or restore racing with assign never produces a team with more than the template count unless the add/restore completed first, in which case assign returns 409." (Note the lock currently blocks add/restore for these teams, so state whether that race can occur at all; if not, say so and drop the test.)

### B5. "Plus `emitAuditEvent` after COMMIT" / audit "same audit treatment as sibling endpoints"
"Same treatment as siblings" is not specific. List every outcome and its audit result in a table: success, non-admin 403, template 404, missing team 404, 409 already active, empty-template 500, rate-limited. For each: operation name, whether an audit_log row exists, metadata fields. The notes say the 500 path logs only (no row, because rollback); confirm that is acceptable to compliance, since a failed recovery attempt leaving no durable record is a gap someone will ask about.

### B6. "200/201 with `{ topicCount }`"
Pick one status code. Also state what `topicCount` means (number of topics created) and whether the list itself is returned (notes imply no, refetch).

### B7. "Rate limit, timing floor, non-leaky errors"
These are listed by reference to siblings. Acceptable for design, but the requirement should be stated: "Responses never include the template team id or topic text." Acceptable to cite siblings for numeric limits, but the proposal should name the limit values or say "inherits the shared topic-write limit unchanged".

### B8. Spec carve-out wording (Q3)
The notes say to "amend" the lock use case's out-of-scope line and the Failure postcondition but give no replacement text. Write the replacement. Suggested: "The lock can be released for a team only by completing a first session, except that an application administrator may assign the canonical default set to a team with zero active topics (see Recover Zero-Topic Team)." Also decide whether this is a new use case ("Recover Zero-Topic Team") with actor, preconditions, main flow, alternate flows, postconditions. Traceability requires it; today the behaviour has no use case home, only a carve-out.

## C. Missing requirements and edge cases

- **Does the locked state persist after assignment?** Presumably the team stays in `first_session` lock. State it: "After assignment the team remains customization-locked until its first session completes." Otherwise a reader may think assignment unlocks.
- **Ordering of topics.** "Renumbers 1..n" implies the template order. Acceptance: "Assigned topics appear in template display order, numbered 1..n, with no annotation fields copied."
- **Topic text and annotation.** Confirm that copied topics carry no annotations from the template, and that they appear identical to those on a freshly created team.
- **Notification.** Does the team's facilitator learn the team has been repaired? Probably out of scope, but state "no notification" so it is a decision, not an omission.
- **Admin on the template team page.** Requirement: the template team is never a target, and the UI never shows the button for it. Acceptance covers both UI and API.
- **`/start` soft spot (Q5).** "Run a query, then maybe a guard" is conditional scope. Define the exit condition: "If the query returns zero rows, record that in the change and add no guard; if it returns rows, a guard task is added with this acceptance: `/start` returns 409 NO_ACTIVE_TOPICS for a lobby session with an empty snapshot." Put the conditional into tasks so it cannot be silently dropped.
- **Observability.** No success metric. Suggest: audit rows are queryable by `topic.defaults_assigned`, and the diagnostic query is documented as a runbook entry so operators can detect the state before users do. The notes drop Option A's runbook entirely; keep a short runbook as part of B, since detection is still manual.
- **Empty-template admin experience.** If the template is empty, the admin clicks the button and gets a generic 500. That is a poor outcome for the one person able to fix it. Either specify a distinct, admin-visible message (without leaking the template id), or state that this is accepted and why.

## D. Scope and classification

- "Lightweight is plausible only if the PO accepts skipping the frontend": that conflicts with FR-8.6 delivery, since without a button there is no in-app way. Recommend stating plainly: full pipeline, because it adds an authorization path that bypasses the lock. I agree with the final recommendation; remove the hedge.
- Out-of-scope list is good and specific. Add: no change to reorder/annotation behaviour, no undo of an assignment.

## E. Suggested requirement skeleton (ready to lift into a proposal)

1. An application admin SHALL be able to assign the canonical default topic set to a team that has zero active topics, regardless of the team's customization-lock state.
2. The action SHALL be refused for any team with at least one active topic (409 TEAM_HAS_ACTIVE_TOPICS), any non-admin caller (403 with a machine-readable code), the template team (404), and a nonexistent team (404 TEAM_NOT_FOUND).
3. The action SHALL be idempotent and atomic: concurrent calls produce one success and the rest 409.
4. On success the team SHALL have exactly the template's active topics in template order, existing archived topics unchanged, and the team SHALL remain customization-locked.
5. The topic management screen SHALL show the assign action only to admins on a zero-active team, driven by a fail-closed server flag.
6. Every attempt outcome SHALL be audited or logged as tabulated (B5).
7. Empty-state copy for admin and non-admin viewers SHALL match the strings in the spec.

## F. Decisions I need from the PO before drafting

1. Diagnostic query result, or an explicit FR-8.6 justification (A1).
2. H1: name "an application administrator" in non-admin copy (B1).
3. No confirmation dialog (B2).
4. Distinct admin message for the empty-template failure, or accept generic 500 (C).
5. New use case versus amendment of the existing ones (B8).
