# Archive Note — `websocket-staleness-signal`

Archived by: Marcus Delgado (Business Analyst), 2026-09-10, via `opsx:archive`.

No prior archived change in this repo carries a dedicated archival-note file — each just carries forward its own artifact set (proposal, design, tasks, reviews, sync-notes). Adding this one because the team lead asked for a record of what happened at archive time, and because this change has a status that isn't fully "done" in the way most archived changes are: it should not be mistaken for one.

## What was verified before archiving

- `openspec status --change websocket-staleness-signal --json`: all four planning artifacts (proposal, design, specs, tasks) report `done`.
- `tasks.md`: 48 of 55 tasks checked complete. The 7 open items are not oversights — each is individually annotated in `tasks.md` and cross-referenced in `implementation-summary.md`'s "Deliberately left undone" section:
  - **2.2, 4.1a, 5.3** — small coordination/confirmation items (filing a PR note, confirming a design inference with human stakeholders, confirming sufficiency with another issue's coordinator) that require a live human or an open PR, neither of which an implementation pass can produce on its own.
  - **6.2, 6.2a, 6.3, 6.4** — the facilitator copy/visual-register/usability sign-off gate. Task 6.1 (copy sign-off) is genuinely closed. 6.2 (visual-register mock sign-off) was attempted via a simulated Facilitator-persona review (`gate6-facilitator-signoff.md`) and explicitly **withheld** — the shipped grid-marker placeholder doesn't yet attempt either candidate visual register. 6.3 (live usability test) cannot be satisfied by any static or simulated review by construction. 6.2a and 6.4 are downstream of those two. All four are deferred by product-owner decision (2026-09-10), tracked in [GitHub issue #36](https://github.com/surratt-dev/project-dipstick/issues/36), and `design.md`/`tasks.md` already say this explicitly and in detail.
- Delta spec vs. main spec (`specs/websocket-staleness-signal/spec.md` vs. `openspec/specs/websocket-staleness-signal/spec.md`): already synced, corrected once, and re-verified clean by `sync-verify-architect.md`. Remaining diff between the two files is expected structural difference (delta fragment vs. full capability spec), not drift. No further sync action was taken at archive time.

## What archiving does and does not mean here

Archiving moves this change out of active planning because its implementation, design, and requirements work is finished and stable — not because every gate is closed. **Group 6 is not done.** The capability may run in non-pilot/staging environments now, per task 6.4's own terms, but must not be used for a real pilot team's first live session until issue #36 closes. Anyone picking this back up should look at issue #36, not re-open this archived directory, to track that remaining work.

## Archive location

Moved via `git mv` from `openspec/changes/websocket-staleness-signal/` to `openspec/changes/archive/2026-09-10-websocket-staleness-signal/`, following the date-prefixed naming convention of the most recent precedent, `openspec/changes/archive/2026-09-09-websocket-connection-reauthorization/`. All files moved as-is; nothing was edited as part of the archive step itself.
