# Sync drift check (#271) - Ingrid Sollenberger

Compared: synced `openspec/specs/team-content-access/spec.md` (Application Admin requirement), the change delta spec, `design.md`, `proposal.md`, the test header, and `helpers/audit-log-reader-scanner.ts`.

Result: no material drift.

- Synced main requirement text is identical to the delta spec (diff clean apart from the following requirement boundary).
- Protected set: spec, design D6, proposal, header and `isProtectedOperation` agree (`admin.` prefix, `topic.config_` prefix, two named values).
- Scope conjunct: `team_id = string|$n|number` or `metadata->>'scopeId' = string|$n`, checked by `gradeExactMatch`; matches all docs.
- Exactly-one-caller: `judge` rejects `callers.length !== 1`; docs state it (design records it as a deliberate deviation).
- Wrappers and string-key refs: `findWrappers` / `findReferences` (including `m["name"]`) match the spec scenario, design D4c amendment, proposal limits and header.
- Tripwire: non-inventoriable; matches all docs.

Fixed: design D4b.3 listed WHERE terminators without `FETCH` and `WINDOW`; the scanner also stops at those. Added them.

Not changed (informational): design D4c's opening sentence still says `callers: string[]` "allowed to reference"; the exactly-one deviation is stated later in the same paragraph. Consistent, but easy to misread.
