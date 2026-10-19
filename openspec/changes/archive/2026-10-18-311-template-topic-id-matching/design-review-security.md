# Security Review: 311-template-topic-id-matching (design)

Reviewer: Tomás Ferreira, Security Analyst. Artifacts read: design.md, proposal.md, tasks.md, the three spec deltas. Code spot-checked: `sessions/default-topics.ts`, `routes/content.ts` (TOPIC-002 query and mapping), `routes/__tests__/helpers/template-writer-scanner.ts`, `template-writer-structural.test.ts`, `High-Level Architecture.md` section 8.1.1.

## Verdict

Approve with required changes. The change adds no new endpoint, no new writer of template rows, no new response field, and it keeps every new read keyed on the caller's own `team_id`. I found no cross-team leakage path. There is one finding that changes an existing, documented trust claim (S1) and needs a threat-model update before merge, plus a few smaller items to make explicit.

## Findings

### S1 (Medium, required): assign-defaults stops being "template text only"; threat model 8.1.1 needs an update

Section 8.1.1 of the High-Level Architecture (added by #296) justifies the one lock carve-out on the basis that the template is the trust anchor: assign-defaults writes only canonical text into a locked team. Decision 6 changes that. For a team with archived linked rows, assign-defaults now reactivates the team's own row and keeps the team's own name, prompt and annotation. The reactivated content is therefore team-authored text (possibly renamed, edited or stale against the template), brought back to active by an `application_admin` action on a locked team. The text is the team's own, so this is not cross-team exposure, but:

- The 8.1.1 argument ("only canonical text enters") is no longer literally true and the audit row (`topic.defaults_assigned`, `topic_count`) cannot tell inserted from reactivated.
- 8.1.1 (h) reopen triggers include "what [the template] can contain" and text from a non-template source. This change is close enough to need an explicit decision, not silence.

Required: add a short note to 8.1.1 (trust relationship and residual risk), or record in the review disposition that it was assessed and why no update is needed. My recommendation is to update: one sentence stating that assign-defaults may reactivate the team's own archived linked rows (team-authored text, same team), that no text crosses teams, and that residual risk is unchanged. Also add a reopen trigger: any use of `template_topic_id` to propagate template content into existing team rows (the link as a write path from the template into team data) reverses the "identity only" boundary and must reopen 8.1.1. The proposal states this exclusion in prose; the threat model should carry it so it survives the end of this change.

Alternative if the Architect prefers no threat-model change: drop the `DO UPDATE` and use the proposal's fallback (fresh linked rows, no reactivation). That keeps assign-defaults template-text-only. I would accept either; deciding by omission is not acceptable.

### S2 (Medium): audit cannot distinguish reactivated from inserted rows

`topic_count` is the number of defaults now active, from `RETURNING id`. After this change one number covers two different actions with different data provenance. For incident reconstruction (my "auditability" bar) I want the audit row to carry `reactivated_count` alongside `topic_count`, counts only, no ids or names, consistent with the existing text-free audit rows. `RETURNING` cannot separate them directly; `(xmax = 0) AS inserted` is the usual idiom, or a count of rows with `archived_at IS NOT NULL` before the statement. Please decide and put it in the spec, or record explicitly that the combined count is accepted. Related smaller point: the reactivation sets `restored_at` but the design does not say whether `restored_by` is set; single restore attribution should be mirrored (the actor is the admin) or the gap stated, otherwise the topic history shows a restore with no actor.

### S3 (Medium): reactivation can violate the #299 active-name rule, and the design accepts it

The "accepted edge" (team renamed archived copy of A to B's name, both archived, both reactivated) creates two active same-name topics by a path that bypasses the #299 guard. #299 is itself a recent integrity control with a spec and a threat-model note (8.1.1 (i)). Knowingly shipping a bypass is a weak position, and it is reachable by an `application_admin` through an audited-but-unguarded endpoint. The cheap fix is inside the same statement: exclude from the DO UPDATE path (or from the insert) any row whose normalized name collides with an already active team row. If that cannot be done atomically in one statement, take the fallback. At minimum the spec needs a scenario that pins the accepted behavior and the Architect's sign-off, not only a risk line.

### S4 (Low-Medium): the link target is not constrained to template rows

The CHECK restricts the referencing row (`is_default` and not template team) but the FK is `topics(id)`, so the database accepts a link to any topic, including another team's row. No code path sets that today and the join always applies `canonicalDefaultsWhere("dt", ...)`, so a bad link is inert on reads. But (a) RESTRICT would then pin another team's topic against deletion, and (b) the identity claim "linked means copied from a template default" is enforced only by convention. A CHECK cannot subquery. Options: a small trigger, or a composite FK through a constant, or (cheapest) a structural test that the only SQL writing `template_topic_id` is `copyCanonicalDefaults` plus the migration. I recommend the structural test; extend the existing scanner infrastructure rather than writing a new one. State the choice in the design.

### S5 (Low, make required): sentinel literal in the CHECK

Decision 5 says a drift assertion between `DEFAULT_TOPICS_TEAM_ID` and the migration literal is added "if cheap". A wrong literal silently disables the invariant (the CHECK would permit links on template rows). Make the assertion mandatory, not optional; the precedent test for migration 23 makes it cheap. Also confirm that no code path sets `is_default = false` on a linked row, since the CHECK would turn that into a 23514 and a 500.

### S6 (Low): PR and runbook handling of unlinked-row output

Task 1.1 and the residual-risk section say the runbook query output (team id, row id, name) is "reviewed and noted in the PR". Team ids and topic names are team-authored data and should not be pasted into a PR or issue. Say in the tasks that the PR note carries counts only, and the row-level output stays with the operator. The migration's `RAISE NOTICE` (one count, no ids, no names) is correct and I have no objection; the spec scenario that asserts no identifiers in the log is good, keep it.

### S7 (Low): the post-drain backfill re-run is an out-of-band data write with no record

Decision 12 has an operator re-run the backfill SQL by hand. It writes `topics` rows outside the application, so it produces no `audit_log` row. Require that the runbook records who ran it, when, and the updated-row count in the deployment ticket, and that it is run under the same DB role as migrations (not an app role). The statement must also keep the `team_id <> template` and `is_default` predicates so a re-run can never link a custom or template row; the CHECK backs this up, which is a good reason to keep the CHECK.

### S8 (Informational): backfill can attach the wrong identity silently

Raw-name matching on `is_default` rows can link a legacy row that the team renamed to another default's name to that other template default. The effect is integrity of offers, not authorization or cross-team access, and the design already labels the mis-link risk and mitigates it (is_default only, deterministic choice, unique index, seeded tests). Accepted; no action.

## Areas reviewed with no finding

**Team scoping of the new join.** `WHERE team_id = $1 AND template_topic_id = dt.id` keeps the caller's team as the only team-side filter, and `dt` is still bound by `canonicalDefaultsWhere` to the template. The `$1` comes from the route param that the existing team-access check authorizes before the handler runs. Two teams linked to the same template row never see each other's rows because the join and the unique index are both per team. The linked entry now returns the caller's own row id and name (same team as the caller); the unlinked entry returns a template id, which the endpoint already returned. Suppression is computed in application code over rows the handler already read, so it exposes no new data. Requirement: tasks 4.3 should include an explicit two-team test where team B holds a differently named linked row for the same template default and team A's response is unaffected (the spec has "two teams link independently" for the column; add the read-path equivalent).

**ON CONFLICT path.** The conflict target includes `team_id`, and the inserted `team_id` is `newTeamId`. `DO UPDATE` can therefore only touch rows of the team being assigned. The template team is only the SELECT source. `sourceTeamId` remains a test-only seam, not reachable from a request. The reactivation updates only `status`, `display_order` and `restored_at`; it does not copy template text over team text, so it cannot be used to overwrite a team annotation or name. Team creation cannot conflict. The advisory lock on assign-defaults (already in place) covers the race with a concurrent add.

**Template write path, #188 guard, structural tests.** The scanner reports writes by statement pattern (`INSERT INTO topics`, `UPDATE topics`, ...) and exempts `copyCanonicalDefaults` by name. An `ON CONFLICT ... DO UPDATE` clause inside the one INSERT does not match the `UPDATE topics` pattern, so the existing allowlist should pass unmodified, which task 6.1 asserts; confirm by running it rather than assuming. The change adds no writer that targets the sentinel. I agree with the exclusion of any new template writer. The design's added structural assertion (exactly one `INSERT INTO topics` containing `template_topic_id`) is good; pair it with S4.

**Authorization and authentication.** No auth flow changes. TOPIC-005 stays team-scoped (`WHERE id = $1 AND team_id = $2`), so an unlinked entry's template id cannot be used to restore or write anything, and the design pins this with a scenario (existing 404, no row written). The `TOPIC_NAME_ACTIVE` 409 disclosure is the already-accepted 8.1.1 (i) item; suppression reduces how often it is reachable.

**Referential integrity as a control.** `ON DELETE RESTRICT` is the right default: it fails loudly rather than silently orphaning identity. Task 1.4 (no path deletes template rows or cascades) is the correct check; add that no `ON DELETE CASCADE` from `teams` to `topics` can reach a template row (the template team is never deleted). The RESTRICT also means a team can in principle block deletion of a template row; since only `application_admin` can reach template maintenance, which archives, this is not an exploitable denial of service.

**Migration logging.** One count, no ids, no names, no team ids: acceptable. `RAISE NOTICE` output lands in migration logs; keeping it count-only is the right call.

**Information in responses.** No new field; `template_topic_id` is never serialized. Keep the task 4.3 assertion that no response contains `templateTopicId`, and make sure any logging of the topic row in routes (`request.log`) does not start emitting the new column wholesale (a SELECT * mapped into a log line would).

## Threat model impact (summary)

| Item | Action |
| --- | --- |
| `High-Level Architecture.md` 8.1.1 trust relationship and residual risk | Update: assign-defaults may reactivate the team's own archived linked rows (S1) |
| 8.1.1 (h) reopen triggers | Add: using the link to propagate template content into existing team rows |
| 8.2 summary bullet | One clause matching the above, or explicit "no change" in the review disposition |
| Audit logging | Decide reactivated-count and `restored_by` (S2) |
| Other docs | Deployment runbook: record operator and updated-row count for the post-drain re-run (S7) |

## Deferred or implicit security decisions to make explicit

1. Whether reactivation (rather than the fallback) is acceptable to the Architect given S1 and S3. The proposal leaves the index, CHECK and reactivation as one bundle subject to confirmation; the threat-model decision is part of that confirmation.
2. Whether the audit row distinguishes reactivated from inserted (S2).
3. Whether link-target integrity is enforced or only conventional (S4).
4. That the post-drain backfill is a manual, unaudited DB write (S7).
5. The mandatory status of the sentinel-literal drift test (S5).

None of these blocks the design; S1 and S3 should be resolved, and S2, S4, S5, S6 and S7 recorded in the tasks, before implementation starts.
