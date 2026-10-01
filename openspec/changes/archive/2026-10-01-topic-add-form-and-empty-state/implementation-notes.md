# Implementation notes — topic-add-form-and-empty-state

Calls I made during apply where the tasks were ambiguous or could not be done exactly as written. Each one stays consistent with the spec.

## Handoff issue numbers (task 0.2)

`proposal.md` records no issue numbers for the six handoffs ("issue numbers TBD, H2"). The use-case doc edit (task 9.1) cites `openspec/changes/topic-add-form-and-empty-state/handoffs/custom-topic-description-never-shown-in-session.md` and says the issue number is pending. The PR description should say the same.

## Parity test runs against a SQL-routing fake, not live Postgres (task 1.4)

`packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts` registers both `contentRoutes` (TOPIC-002) and `topicRoutes` (TOPIC-003) and runs each route's real authorization helpers. `db.query` is replaced by a fake that answers by SQL text: the caller's `global_role` / `is_member` row, an unlocked team, and an existing team. That keeps the test runnable in the unit suite, beside `content.test.ts`. Postgres and Redis were not available locally (`docker compose` was not running).

The "creates topics on the shared test team" note in the task describes a live database. Here it applies only nominally. The file comment keeps it anyway, and each row still uses a distinct topic name. If a live-DB version is wanted, it belongs beside `topic-annotation-integration.test.ts`. That file still skips locally and is unchanged; it reads the TOPIC-002 body untyped, so the new field cannot break it.

## Untested: a dirty reorder draft surviving a failed post-Remove refetch (task 2.5, BA T2)

This state cannot be reached through the UI. Remove is disabled while the reorder draft is dirty or saving (`topicActionsLockedByDraft`), and task 2.3 forbids relaxing that interlock. So no test was written for the reorder-draft variant. The spec scenario "A refetch failure after Remove stays inline and keeps the add form" is tested (the add-form variant, task 5.2). An open add form is the only draft that can coexist with a Remove.

## Superseded post-`201` refetch (task 6.5)

This path is implemented as Decision 11 specifies: the form closes, the general "Added '<name>' to the end of the list. …" status is shown, and focus moves to the Active heading. It has no page test, because design.md calls it unreachable in practice. The superseded mechanism itself is tested through Remove and Restore in `TopicManagementPage.screen.test.tsx`.

## Smaller structural calls

- **Form state.** Decision 4's union is implemented with phases `editing | confirmingDiscard | submitting`, plus a `duplicate` field (the warning shows when it is non-null) and `duplicateOverride`. It does not use a `warningDuplicate` phase. Decision 4 gave its shape only as an example ("e.g.").
- **Vote-type radios while in flight.** Radios can't be `readOnly`, so they are `disabled` while the add request is in flight. Text fields are `readOnly`.
- **Required and optional markers.** "(required)" is visible text inside the Name, Prompt, and Vote type labels and legend. Name and Prompt also carry `aria-required="true"`. The Description label is the spec's exact "Description (optional, shown on this screen only)".
- **Submit's disabled reason.** It shows in `title` and as visible text under the buttons (`add-topic-submit-reason`). This matches the screen's existing visible-reason pattern. The text is hidden while the add is in flight, when `add-submitting-reason` is the only visible reason.
- **Remove failure parsing (task 2.3).** The `409` and generic `!res.ok` branches of `submitArchive` now share one defensive `.json().catch(() => null)` parse. `TOPIC_LAST_ACTIVE` handling is unchanged.
- **Team-change wrapper (task 2.4).** `TopicManagementRoute` is exported from `TopicManagementPage.tsx`, and `App.tsx` renders it. The page suites render through it too: `topicManagementTestUtils.tsx` includes a small team switcher.
- **Test files.** Tests for sections 2 and 3 are in `TopicManagementPage.screen.test.tsx`. Add tests are in `.add.test.tsx` and empty-state tests in `.empty.test.tsx`. Fixtures shared by all three are in `topicManagementTestUtils.tsx`, which is not itself a test file.
- **`VOTE_TYPE_LABELS`.** Moved from the page to `addCustomTopic.ts`, so the row labels and the form's radio labels share one table.

## Post-review fixes

Responding to `implementation-review-architect.md` and `implementation-review-security.md`.

**Fixed**

- **Architect S1 (dialog closed by another call's completion).** `submitArchive` and `submitRestore` now close their dialog with a functional update that applies `idle` only while the state is still `submitting` for the same `topicId`. A second Remove or Restore confirmed during the first one's refetch keeps its dialog, and the controls it disables, until its own write and refetch settle. Two tests in `TopicManagementPage.screen.test.tsx`, one for Remove and one for Restore, cover this. Both fail when the unconditional `idle` is restored.
- **Architect S2 / Security SF-1 (parity test could pass vacuously).** Each row of `CALLER_CLASSES` now carries an explicit `expected` outcome: GET status, `canAddTopics`, and POST status. The test asserts that outcome alongside the relational check. The non-member facilitator must reach GET 200, `canAddTopics: true`, and POST 201, and a separate test asserts that the table contains at least one class that can add. The header comment now names the `expected` field of the admin rows as the place a #176 fix must edit, replacing the reference to an "expected column" that didn't exist.
- **Security N-1.** Added a seventh caller class with no `users` row, expected to be rejected on both sides.
- **Security N-2.** The XSS regression now also covers the duplicate-warning sink: an archived topic named `<img src=x onerror=alert(1)>` appears as literal text, and no `img` element is created.
- **Architect N2.** `TopicManagementPage` has a comment saying it must be mounted through `TopicManagementRoute` and never unkeyed. The three older suites, which mount it unkeyed, each note why that is safe there (they never change team). The earlier note "the page suites render through it" holds only for the three new suites.
- **Architect N4.** Added lock-timing tests for the 409 path and for the network and 5xx paths (deferred GET). Controls stay disabled with "Adding…" until the refetch settles. On the network and 5xx paths, the retry message appears only after the refetch settles.
- **Architect N6.** `VOTE_TYPE_LABELS` is now `Readonly<Record<VoteType, string>>`. The backend derives `VALID_VOTE_TYPES` from an object declared with `satisfies Record<VoteType, true>`. A vote type that is missing, or not in the union, is now a compile error on both sides.

**Left as noted**

- **Architect S1, failure branches.** Only the success path's close is guarded, as the finding asked. The error, `blocked_last_active`, and confirmation-required branches settle right after the DELETE or POST. If they skipped the write whenever a second dialog had opened, the first call's error could vanish silently. Fully serializing Remove and Restore means disabling them while any dialog is submitting. That is a change to the interlock matrix and needs a spec update, so it is out of scope here.
- **Architect N1** (the refetch counter does not cover `saveOrder` or `submitAnnotation` patches). This predates the change, and Decision 11 scoped the counter to refetches.
- **Architect N3** (components import from `pages/`). This follows the design's `topicOrder.ts` precedent. Move the module when a third consumer appears.
- **Architect N5** (page size and a second handler style). Advisory: extract `useTopicsResource(teamId)` in the next change to this screen.
- **Architect N7** (no `title` on Submit while in flight). Cosmetic, and "Adding…" already explains the state. Not in the requested set.
- **Security N-3 / N-4** (unencoded `teamId` in fetch paths; restore and annotation error paths without a string-type guard). Both predate this change. N-3 is folded into #184.
