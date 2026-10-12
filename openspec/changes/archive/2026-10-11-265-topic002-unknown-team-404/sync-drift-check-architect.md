# Sync drift check (Architect, #265)

Scope: main specs (team-not-found-envelope, topic-customization-lock, topic-management-screen) vs REST API Contract.md vs code diff.

## Result: no substantive drift

Checked and aligned across all three:
- 404 `TEAM_NOT_FOUND` via `teamNotFoundEnvelope()`, `no-store`, `applyTimingFloor` before reply (content.ts).
- Order: non-canonical 404, authorization 403 (audited), role assertion, team-name read 404, admin arm. Contract check-order row matches.
- Team-name read is the existing `SELECT name FROM teams WHERE id = $1`, moved earlier; no `deactivated_at` filter. 404 writes no audit row and runs no membership/role-set read.
- `team_found` / `teamFound` removed from the audit row metadata, event payload, comments in audit-logger.ts and content.ts. The remaining mentions are the "legacy rows may carry it" notes in spec, contract and comment. No stale `teamName: ""` 200 text remains in specs or the contract.
- Participant 403 scenario (spec ~line 493) still agrees with the new behaviour (no `teams` query).
- Frontend: 404 branch keyed on `error.code === "TEAM_NOT_FOUND"` only, with constant copy; any other 404 gives "Failed to load topics."; reuses the existing `role="alert"` / `topic-management-error` + "Back to team" state. "Team not found." literal is frontend-only, so the backend grep rule is unaffected.

## Blocking
None for the sync. One item blocks archive or merge:
- B1. Contract line ~706 still contains `PR_NUMBER_PLACEHOLDER` and `DATE_PLACEHOLDER`. Fill in at merge (they are intentional cutover markers, so not a drift defect, but they must not ship).

## Non-blocking
- N1. topic-management-screen/spec.md: the new requirement heading is appended with no blank line after the preceding scenario's last bullet and no trailing newline check. Add a blank line before `### Requirement: The Topic Management screen reports...` for markdown hygiene.
- N2. topic-customization-lock "An application admin's request..." scenario title and its parenthetical keep the old name while asserting 404. The spec says this is deliberate (MODIFIED block). Rename at archive if the tooling allows.
- N3. Spec "no unrelated 404 / quiet refetch" scenarios are frontend-behavioural. I did not run the tests, only inspected the page code. Confirm TopicManagementPage.notFound.test.tsx covers the quiet-refetch and non-JSON-404 scenarios.
