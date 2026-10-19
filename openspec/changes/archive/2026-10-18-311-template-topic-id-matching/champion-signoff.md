SIGN-OFF: CLEAN

Devon Calloway, Internal Champion. Final check of #311 (template topic id matching).

## Ritual intent

Preserved. The change gives "this team topic is that default" a stable identity, so a template rename no longer makes a team look like it lost a baseline topic. That serves the promise I care about: the default set is visible and easy to restore, so teams can experiment without losing the baseline.

Link means identity, not propagation. Existing teams are still never auto-updated (BRD 6.4). Template edits reach only teams created later.

## Core constraints

- No-manager rule: unaffected. No participation, role or join code was touched.
- Simultaneous reveal: unaffected. The diff contains no voting, reveal, lobby or facilitator-control surface. Sessions keep their `session_topics` snapshot. The change is invisible during a session.
- Facilitator from another team: unaffected. Nothing in the diff touches it.
- Trends and performance-tool concern: unaffected. No new API field and no new data surface. `templateTopicId` is deliberately not exposed.
- First-session lock and the template-write guard (#188): untouched. The new structural test (only `copyCanonicalDefaults` writes the link) tightens that guard. `routes/topics.ts` (the assign-defaults gate) is unchanged.
- Custom topics no longer match a default by name (fixes #197). The restore offers a team sees are now more truthful.

## Executive conditions (Rachel)

- No scope additions: respected. The code changes stay inside the proposal's listed files, with the migration and tests as planned. The Architect's fallback cut scope (no unique index, no `ON CONFLICT`). Docs edits are wording corrections. The one extra spec edit (a "name-matched" phrase in `topic-management-screen`) was a wording fix made by the drift check. A new `test-fixtures/` directory sits in the working tree. It was not named in the proposal, and I did not check what it holds. Confirm it is test support and not a scope addition.
- Area closed after #311 and #310: respected. The change defers uniqueness, add-versus-restore labels, the "held by N teams" count and the repair UI to #310 or later. It adds no new default-topic features. I hold the team to this: the default-topic area is closed after #310 until adoption evidence says otherwise.

## Items that are not concerns about the design but must not be forgotten

The archive notes five tasks left open for external action: 2.6, 5.1, 5.3, 6.3 and 6.5.

- Rachel's condition 1 (report the per-environment unlinked-row count before merge) is still open. Do not merge without it.
- Priya Nair's sign-off on the `RENAME_NOTICE` text is still open (5.1). It is a merge gate.
- Staging migration timing (6.3) and the post-drain backfill re-run (6.5) remain. Neither affects the ritual.
