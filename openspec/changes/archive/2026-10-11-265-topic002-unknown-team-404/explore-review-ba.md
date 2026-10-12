# BA review of exploration notes: topic002-unknown-team-404 (#265)

Reviewer: Marcus Delgado, Senior Business Analyst

## Overall

The notes are strong on rationale and failure modes. The ordering contract (boundary 404, authz 403, role assertion, existence/name read 404, admin arm) is precise enough to build from. Weak spots: four "open items" that are actually requirement decisions and must be closed before the proposal; several statements that mix observation and requirement; and some acceptance conditions that are testable only by inference. Items below are ordered by how much they threaten the proposal.

## Clarifications needed (decisions, not "open items")

1. **`team_found`: remove or constant.** The issue allows both; the notes "back removal" but leave it open. A proposal cannot carry "either". Decision needed: remove. Requirement text should state (a) new `admin.topic_config_accessed` rows carry no `team_found` key, (b) historic rows may carry it with either value, (c) `teamFound` is dropped from the structured log event. The "confirm no external consumer" step is a verification task, not an open requirement; make it a task with an owner.
2. **`SELECT name` vs `SELECT id`.** The issue says "reuse the `SELECT id` shape" and also "fold into the name query". The notes pick `SELECT name`. That is a design choice, but the underlying requirement is the testable one: a standing facilitator on an existing team issues exactly the same SQL-text multiset of queries as before #265. State that, and leave the mechanism to design.md. Also: does the admin path's query count/order matter? Notes say "loses nothing" but the #259 admin tests may pin order. Clarify whether admin query ordering is pinned or only the absence of membership/role-set reads on 404.
3. **Frontend message.** Fixed copy vs envelope message is unresolved, and item 6 in the drift list contradicts the issue's "or the envelope message". Decide: show "Team not found." when the response is 404 with `code: TEAM_NOT_FOUND`; any other 404 (proxy, non-JSON) shows the generic "Failed to load topics." Confirm with Brian that a bare 404 without envelope is not to be labelled team-not-found.
4. **Timing floor.** Open item 4 is vague ("confirm the floor covers the worst case"). Either it is a requirement (404 path completes no faster than the floor, same as 403) or it is a risk note. Recommend: requirement is only that the 404 path calls the same timing-floor routine as the 403 path; adequacy of the floor value is out of scope, recorded as a known low-severity residual. Say so.
5. **Template team wording.** The notes flag the risk that "names no team" is read as including the template; good. Requirement must say literally: `__default_topics__` exists in `teams`, so TOPIC-002 returns 200 and, for admins, writes the access row as today.
6. **Asymmetry rationale (403 audited, 404 not).** Notes ask "is there a rate/volume argument?" and answer "I think yes". That is a rationale needed in design.md, and it is a policy-adjacent decision (audit scope). Flag to the VP of Engineering / Brian for confirmation, since I defer to them on data-access policy. Do not let it land as an unreviewed assumption.

## Vague areas

- **"Honest audit log" / "noise".** Intent statement, not testable. Convert to: for any request that returns 404 TEAM_NOT_FOUND from TOPIC-002, zero rows are inserted into `audit_log`, and no `admin.audit_write_failed` signal can fire (since no write is attempted).
- **"Authorization before lookup... unauthorized caller must not learn whether a team exists."** Needs to be a measurable condition: for participant and member-facilitator, response status, code and body are identical whether the team id exists or not. Note the notes' point 2 is muddled: a member-facilitator of a missing team cannot exist (FK), so the "member-facilitator on unknown team gets 403" criterion in the issue is vacuous or means a facilitator who is a member of a *different* team. Clarify which actor is meant. If the latter, define: "standing facilitator of team A requesting unknown team B gets 404" vs "facilitator who is a member of team B" (exists). Right now the notes say both "facilitator reaches 404" and "member-facilitator 403"; the scenario table must enumerate actors explicitly (below).
- **"Admin who holds an EM membership can't exist for a missing team."** Fine, but then the issue's criterion "participant or member-facilitator still gets their 403" for an unknown team needs the actor matrix to remove the impossible case rather than test it.
- **"Quiet-refetch path handles non-ok gracefully."** Drift item 7 states a worry, no condition. Required: after a successful initial load, a subsequent refetch returning 404 does not render a blank/misleading list; define the expected UI (show the team-not-found state, or retain prior list with an error). Pick one.
- **Mid-request deletion race.** "Theoretical, move on" is acceptable only if written down as an explicit non-goal with the reason (teams are soft-deactivated, never hard-deleted).
- **Case sensitivity paragraph.** Ends with "not in scope unless..." Make it a plain non-goal: no new string comparison on `teamId` is introduced.
- **TOPIC-001 vs TOPIC-002 difference.** "Write one sentence in the contract": supply the sentence in the proposal so it is not left for later.
- **Docs touch list.** "Likely no edit", "confirm wording" for team-content-access: convert to a verification task with outcome recorded. Also the `team-not-found-envelope` spec update ("add TOPIC-002 explicitly") is not in the issue's docs list; call it out as a scope addition.
- **Test inventory** includes "or constant" for `team_found`, which reopens decision 1. Remove after decision.

## Edge cases to pin that the notes under-specify

- Existing team, zero topics: 200 with empty lists and the real `teamName` (notes cover this; keep as a named scenario, since "zero state" is exactly where drift happens).
- Deactivated team: still exists, so 200 (and admin audit row). Notes mention no filter; make it an explicit scenario.
- Uppercase canonical UUID for an unknown team: expected 404 (not 400/403 surprise). One scenario avoids ambiguity.
- Non-canonical id: 404 before any query, unchanged (regression).

## Suggested actor matrix (for the spec)

| Actor | Team state | Expected | Audit row |
|---|---|---|---|
| Unauthenticated / no session | any | existing behaviour, unchanged | unchanged |
| Participant | unknown | 403 NOT_A_FACILITATOR | #264 denial row (unchanged) |
| Participant | exists | 403 NOT_A_FACILITATOR | #264 denial row |
| Facilitator who is a member of requested team | exists | 403 FACILITATOR_IS_TEAM_MEMBER | #264 denial row |
| Standing facilitator (not member) | unknown | 404 TEAM_NOT_FOUND, no-store | none |
| Standing facilitator | exists / zero topics / deactivated | 200 | none, no extra query |
| Admin | unknown | 404 TEAM_NOT_FOUND, no-store | none, no membership/role-set reads |
| Admin | exists / template / deactivated | 200 | `admin.topic_config_accessed`, no `team_found` |

## Suggested acceptance conditions (rewrites)

1. GIVEN a canonical UUID that matches no `teams.id`, WHEN a standing facilitator or an admin calls TOPIC-002, THEN status is 404, body equals `teamNotFoundEnvelope()` output, header `Cache-Control: no-store`, and the timing-floor routine was invoked.
2. GIVEN the same unknown id, WHEN a participant calls TOPIC-002, THEN the response is byte-identical to the response for a participant on an existing team (403 NOT_A_FACILITATOR); neither reveals existence.
3. GIVEN a 404 TEAM_NOT_FOUND from TOPIC-002 (facilitator or admin), THEN `audit_log` row count is unchanged and no membership or role-set query ran (admin).
4. GIVEN an admin reads an existing team (including template and deactivated), THEN exactly one `admin.topic_config_accessed` row is written whose metadata has no `team_found` key; the pinned key-set tests assert this set.
5. GIVEN a standing facilitator on an existing team, THEN the multiset of SQL texts executed equals the pre-change multiset (test asserts equality, not a looser bound).
6. GIVEN an existing team with no topics, THEN 200 with empty lists and the correct `teamName`.
7. GIVEN `DEFAULT_TOPICS_TEAM_ID`, THEN 200 as before; for an admin the access row is still written.
8. GIVEN TOPIC-001 and an unknown team, THEN 403 (unchanged).
9. GIVEN the Topic Management page receives 404 with `code: TEAM_NOT_FOUND`, THEN it shows "Team not found.", no topic list, no definition block, no write controls, and does not show the network-error or generic-failure text. A 404 without that envelope shows "Failed to load topics.".
10. Docs: contract row reads "team does not exist (malformed or unknown id)" with the "tracked optional follow-up" sentence removed; the old scenario "200 ... team_found = false" is replaced, not supplemented; `openspec validate --strict` passes.

## Traceability

Each acceptance condition above maps to an issue #265 criterion except: 2 (sharpened), 6 and the deactivated/uppercase scenarios (new, drift guards), and the quiet-refetch and `team-not-found-envelope` spec edits (scope additions). Recommend the proposal list these explicitly as additions beyond the issue so they are not later treated as scope creep.

## Verdict

Requirement-ready after: closing decisions 1 to 4 above, confirming the audit asymmetry rationale (6), cleaning up the actor matrix (member-facilitator wording), and choosing the quiet-refetch behaviour. No blockers beyond these.
