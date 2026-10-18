SIGN-OFF: clean

# Champion sign-off: admin-default-topic-maintenance (#216)

Devon Calloway, Internal Champion. Read proposal, archive-note, and skimmed the implementation (`sessions/default-topic-maintenance.ts`, `routes/admin-default-topics.ts`).

## Ritual constraints

- **No-manager rule: unaffected.** The path exposes no membership, role or reporting controls. It is `application_admin` only, read live from `users.global_role`. Engineering managers and facilitators get `403 DEFAULT_MAINTENANCE_ADMIN_ONLY`, and the denial is audited.
- **Simultaneous reveal: unaffected.** Nothing touches votes, vote reveal or session state. `vote_type` is immutable after creation, so what "a 3" means cannot drift under existing teams.
- **Facilitator-from-another-team: unaffected.** There are no facilitator rules, assignment or session rules in the endpoint inventory, and the first-session lock has no admin setting. The structure stays structural, not configurable.

## Admin path never touches real teams or open sessions

Confirmed in code. Every statement in the maintenance module is scoped `team_id = $1` bound to the sentinel template id, or runs by topic id plus that team_id. The only lock taken is `lockTeamTopics(SENTINEL)`. No `session_topics`, `sessions` or real-team `topics` is read or written. The routes are outside `/teams/:teamId/topics`, accept no team id, and leave the #188 guard and its structural test unchanged. A negative test proving real teams' topics and session snapshots stay byte-identical is in the change's test set. Edits apply only to teams created afterwards, and every write response says so.

## Notes (not blockers)

- Audit rows carry full before/after topic text. This is a scoped, disclosed exception, with a break-glass redaction procedure in the runbook.
- Renaming a default means existing teams' name-based restore matching no longer pairs. This is disclosed in the response and spec.
- Archive-note open items remain human-gated: PO acknowledgement of the flagged assumptions (1.1), follow-up issues still #TBD (8.1), the PR description (9.2), and the pre-production dry run (10.x). Please do the dry run with a facilitator before the first production edit, since these prompts are the Health Check.
