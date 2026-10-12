# Proposal Review: topic002-unknown-team-404 (#265) - Business Analyst

*Reviewer: Marcus Delgado, Senior Business Analyst. Inputs: proposal.md, the three spec deltas, tasks.md, issue #265, and the documents in `requirements/`.*

## Verdict

Approve with changes. The backend capability is specific enough to build from today. Order of checks, status, envelope, headers, timing floor, audit behaviour and query budget are all stated as testable conditions. The weak spots are the frontend states (quiet refetch, way-out navigation, inline notice), a few unverifiable phrases, a missing numbered AC list for the tasks to trace to, and one policy decision that is stated as "proceed" but is really a gate.

Traceability note: nothing in `requirements/` (BRD, Feature Sets, use cases, Web Application Proposal) mentions TOPIC-002, 404 handling or admin audit rows. Those requirements live only in openspec specs and issues #184, #208, #232, #264. This change therefore traces to issue #265 and the openspec specs, not to a BRD item. The only BRD-level properties it touches are topic history preservation (a deactivated team and an empty team stay `200`, which protects it) and the facilitator/participant separation (the participant byte-identical 403). Both are preserved.

## Capability 1: topic-customization-lock (TOPIC-002 returns 404)

Specific enough: yes. Strong points: fixed check order, "no `deactivated_at` filter", "keyed on the absence of the `teams` row, never on empty lists", SQL-text multiset, no membership/role-set read on the 404 path.

Gaps and vague language:

1. **"the same `applyTimingFloor` call the `403` path makes"** is clear for implementation but the scenario "`applyTimingFloor` is called before the reply" needs a stated test mechanism (spy/mock call count of 1, called before `send`). Make that explicit in tasks 1.1.
2. **"no membership-role or role-set query ran, and no `admin.audit_write_failed` event is possible"**. The second clause is not testable. Replace with "no `admin.audit_write_failed` event is emitted and no log event named `admin.*` is emitted".
3. **Uppercase UUID scenario** only covers an upper-case id that matches no team. State the intended result for an upper-case form of an existing team's id (Postgres uuid comparison is case-insensitive, so it would likely be `200`). Either add the scenario or say it is deliberately unspecified (the non-goal on case sensitivity implies the latter, but it should say so).
4. **Soft-delete assumption** ("teams are soft-deactivated, never hard-deleted") underpins the non-goal on the deletion race. Cite where this is guaranteed (migration or spec), or the non-goal is an assumption, not a decision.
5. **Failure of the team-name read itself** (DB error) is not stated. Add one line: it follows the endpoint's existing 500 behaviour and writes no audit row.
6. **Concrete conditions to add** (test matrix, one row each): actor x team state, expecting status, body, `Cache-Control`, audit row delta, query count.
   - facilitator / admin x unknown canonical UUID: 404, `teamNotFoundEnvelope()`, `no-store`, delta 0
   - facilitator / admin x existing, deactivated, template, zero-topic team: 200
   - participant x unknown and existing: byte-identical 403 (compare full headers and body, not just code), each with one `topic.config_list_denied` row
   - member-facilitator x existing: `FACILITATOR_IS_TEAM_MEMBER` unchanged
   - non-canonical id, any actor: 404 before any query
   - admin 200: metadata key set is exactly the stated set, event payload exactly the stated set, no `team_found` / `teamFound`
7. **`team_found` removal** is explicit in spec and proposal. One ambiguity: "a reader SHALL treat the key as optional" - name the readers (audit viewers, reports) or confirm there are none (task 0.2 does this; make its outcome a recorded acceptance condition).

## Capability 2: team-not-found-envelope

Specific enough: yes. It is a one-scenario addition naming TOPIC-002. Minor: the scenario omits `Cache-Control: no-store` and the category; fine because the other spec covers them, but add `error.category: "not_found"` for parity with the other scenarios. The structural guard (`"Team not found."` only in `error-envelope.ts`) is the existing check, so the acceptance condition is "that test still passes".

## Capability 3: topic-management-screen (the weakest)

Specific enough: partly. Items to tighten before implementation:

1. **"quiet refetch"** is not defined. State what triggers one (annotation save, add/remove/restore/reorder?) and whether the state is "the same fetch as the initial load called with a quiet flag". Without this, 3.2 "the quiet-refetch path" is a search task, not a requirement.
2. **"a small inline notice"** has no copy, placement, or dismissal rule. Proposed condition: a polite live-region message, text "Could not refresh the topic list. Showing the last loaded list.", cleared on the next successful fetch; identical for 404/403/500. Priya's pass can adjust copy, but a default must exist so tests can assert it.
3. **"any unsaved edit"** - define as the annotation text in the open edit field (and any other draft control the page has); test asserts the field value is unchanged and focus is not lost.
4. **"announced ... the same way as the access-denied state"** and **"the same way-out navigation that state offers (if none, follow-up)"** are conditional on code the spec has not looked at. Resolve now: state the access-denied state's role/aria attributes and its navigation target (or "none"), so the AC is binary. The parenthetical makes the AC pass trivially if there is no navigation.
5. **"SHALL NOT first render an empty team shell"** - testable (assert no topic-list/definition elements in any render before the 404 resolves), but say whether a loading indicator is acceptable in between. Assume yes.
6. **Which 404s count.** Rule is "initial load only". State what a `TEAM_NOT_FOUND` from a write action (add/delete/restore/reorder/annotation) shows. Likely an existing generic error; say so, so the implementer does not widen the branch.
7. **The "bare 404" rule** is stricter than the issue ("404 branch ... or the envelope message") and is called out as scope addition 6 and open decision 2. Acceptable, but it needs a defined parse rule: JSON body, `error.code === "TEAM_NOT_FOUND"`, otherwise generic. A JSON 404 with a different code is covered by "any other" but not by a scenario; add it.
8. **Copy:** the literal "Team not found." should match the envelope message exactly, including the full stop, case and no extra line (stated in non-goals; move into the requirement).

## Cross-cutting findings

- **Acceptance criteria are split across three places.** Tasks cite "AC 5, AC 9, AC 11" but the proposal has no numbered AC list; only the issue does. Add the numbered list to the proposal (or tasks.md header) and map each to a scenario/test, otherwise the references cannot be checked.
- **Open decision 1 is a gate, not an FYI.** The text says "implementation proceeds with no row on 404; confirm before merge". Since the change removes audit coverage that #259 deliberately added (`team_found: false` rows), say the PR is blocked on that confirmation (task 5.2 already says so; make the proposal match). Record that an authorized caller can still probe existence by design, and that no volume alert exists for 404s.
- **Scope additions** are honestly listed. Items 1 and 6 add new UX behaviour not in the issue; I accept them but they carry the vague spots above. Items 3 to 5 are test-only and fine.
- **Stale-link confusion remains partly unsolved** (deactivated team shows a normal screen; stale remembered team id is not cleared). The proposal says so. Fine for this change; open decision 4 should become a filed follow-up issue so it is not lost.
- **Zero/one-state check (my standing concern):** the empty-team 200 case is explicitly preserved and tested, so a new team with no topics does not get the new error. Good.
- **Docs:** the REST contract row, the extra TOPIC-001/002 sentence, and `audit-logger.ts` comment are concrete. Add a check that the contract's row ordering text reads `403 -> 404`.

## Suggested additional acceptance conditions (copy-ready)

- AC-A: For each cell in the actor/team-state matrix above the response status, body, `Cache-Control` and `audit_log` delta match the table.
- AC-B: On an existing team a standing facilitator's SQL-text multiset equals the recorded baseline (task 0.1 artefact checked in or quoted in the PR).
- AC-C: Admin metadata key set and event key set equal the exact lists in the spec; a test fails if `team_found` / `teamFound` reappears.
- AC-D: Initial-load `404` with JSON `error.code: "TEAM_NOT_FOUND"` renders exactly "Team not found." plus the way-out defined in item 4; any other non-ok initial load renders "Failed to load topics.".
- AC-E: A failed quiet refetch (404/403/500) leaves list and unsaved edit intact and shows the defined notice; success clears it.
- AC-F: `openspec validate topic002-unknown-team-404 --strict`, `team-not-found-envelope-structural.test.ts`, lint, test and build pass.

## Summary of required changes (priority order)

1. Define quiet refetch, inline notice copy, and unsaved-edit scope (frontend).
2. Pin the access-denied state's announcement and navigation, or state "none" and drop the conditional.
3. Add the numbered AC list the tasks reference.
4. Replace the untestable "no event is possible" clause.
5. Decide the upper-case-existing-team behaviour and cite the soft-delete guarantee.
6. State that open decision 1 gates the merge.
