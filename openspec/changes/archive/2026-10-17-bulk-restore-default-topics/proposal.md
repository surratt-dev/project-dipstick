# Proposal: bulk-restore-default-topics (#218)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revision 2) with `explore-review-ba.md` and `explore-review-facilitator.md`. Traceability: GitHub issue #218; BRD FR-8.6 [HARD], FR-8.2, FR-8.3, FR-2.7; use case `requirements/use cases/08 - Topic Management - Use Cases.md` (Re-add Removed Topic; Assign Default Topic Set to New Team); openspec specs `restore-topic`, `topic-write-rate-limiting`, `audit-logging-operations`, `topic-management-screen`, `topic-customization-lock`, `session-topic-lifecycle`, `default-topic-provisioning`, `team-not-found-envelope`. The openspec CLI is not installed in this environment; artifacts were written by hand in the shape of `openspec/changes/archive/2026-10-17-zero-topic-team-recovery/`.*

## Why

The ritual promises that a team may experiment because the baseline is always one step away (BRD FR-8.6 [HARD]: the default set "must remain visible and restorable ... at any time"). Today "one step away" is up to twelve steps, each with its own confirmation dialog. A chore is where experimentation stops. The failure moment is specific: the day before a session, a facilitator who does not belong to the team regrets a tailored list and is rushing. If getting the shared language back costs a dozen dialogs, they skip it and run the session with a topic set the team never intended. This change exists for that minute.

It serves the success criterion I care about most: a team I have never spoken to adopts the ritual and keeps it. A team that tailors, regrets, and cannot cheaply get back quietly stops tailoring, or stops using the baseline.

**Priority rationale (Exec review, condition 1).** I have no complaint, support ticket or usability finding to cite, and I will not invent one: this is anticipatory. It is ranked now for three reasons, none of them evidence of present pain: (a) it is a named acceptance gap on a `[HARD]` requirement (FR-8.6) that the BRD table currently marks only partially met; (b) it is small, additive and independent of the first-session onboarding and trend dashboard work, so it competes with them for review time only, not for shared code; (c) it matters from the moment the first-session lock lifts, which is exactly when the adoption window opens. If the PO judges that onboarding or the dashboard should go first, this change loses nothing by waiting; sequencing is the PO's call and this proposal does not claim otherwise.

**Measurable form (D13).** Restoring N archived defaults takes one confirmation and one request, for any N up to the number of archived defaults.

**What it is not.** It is not a reset. It does not un-archive customs, delete customs, rename anything, undo reorders, or touch annotations. The control is called "Restore default topics", never "Reset to defaults". The bulk path is the same operation as N single restores in a safe order, with the same guards, plus one guard against duplicates, and nothing more. The less this feature has its own rules, the less it can quietly weaken one of mine.

## What Changes

- **New endpoint** `POST /api/v1/teams/:teamId/topics/restore-defaults`. Not configurable: no flag, no env var, no "allow before lock". It takes no input; the handler never reads the body (framework-level content-type parsing and the 1 MiB default body limit still apply before the handler: a malformed JSON body, an unknown content type or an oversized body gets a framework 400, 415 or 413 with no state change; design D21 item 10). Reactivates, in one transaction under `lockTeamTopics`, every archived topic of the team with `is_default = true` whose name is not already active (rule D1), appended after the highest active `display_order`, ordered best-effort by where each used to sit (design D19: archived positions are stale snapshots, so the dialog promises only the order shown). Writes `restored_at`/`restored_by` per row and one audit row per non-empty request.
- **Same guards as single restore, in the live order, which is also the order issue #218 states** (the code comment on single restore still lists an older order; this proposal cites the live handler body, re-verified against `packages/backend/src/routes/topics.ts`): (0) session authentication, done by the `authMiddleware` `onRequest` hook before any route handler runs (`401` for an unauthenticated caller, whatever the `teamId`); (1) non-canonical `teamId` `404` (`rejectNonCanonicalTeamId`, no authorization, team, topic or membership query issued by the handler); (2) role (`403 NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER`, app admin admitted whatever their membership, #208); (3) the shared topic-write limiter (`429`, or `503` failing closed); (4) writable team (`404 TEAM_NOT_FOUND`, template team byte-identical); (5) customization lock (`409 TOPIC_CUSTOMIZATION_LOCKED`); (6) the transaction. No topic-existence 404 and no status 422: those belong to single restore. Timing floor on every exit, including the thrown-error path (a deliberate divergence from single restore; design D22).
- **Per-caller-class behavior for a non-canonical `teamId` (resolves BA 2.1).** Unauthenticated: `401` (middleware, before the handler). Authenticated as anything else (non-facilitator, member facilitator, non-member facilitator, admin): the same `404`, because the canonical check precedes the role check; the handler issues no query. The earlier draft of this proposal listed role before the canonical check; that contradicted its own "no query" scenario and #218, and is withdrawn. "No query" means no query issued by the handler; session-middleware lookups are outside it.
- **Response (D7).** `200 { restored: [{topicId, name, displayOrder}], skipped: [{topicId, name, reason}] }`. Emptiness is a `200` with both arrays empty, no audit row, no state change, one limiter unit consumed. Never a 4xx or 409 for emptiness.
- **Duplicate rule (D1).** An archived default whose name matches (trim, then lowercase) an active topic, or an earlier row restored in the same batch, is skipped and reported with reason `NAME_ACTIVE`. Skipped topics stay archived. Duplicates are never silently produced.
- **Ordering (D3, D4).** Append at `COALESCE(MAX(active display_order), 0) + 1` (matching single restore); within the batch by prior `display_order` ascending, then `id` ascending.
- **Audit (D2).** One `topic.defaults_restored` row per non-empty request, same transaction, plus `emitAuditEvent` after COMMIT. No `topic.restored` rows from the bulk path. Metadata carries topic ids and positions only, plus counts, with the skipped list capped at 100 entries (see "Changed from exploration" below and design D21 item 4). Rows follow the existing `audit_log` retention policy.
- **Frontend.** One "Restore default topics" control on the topic management screen, a confirmation dialog (D10), a result line with live-region announcement (D9). The transient restored-row highlight is **deferred** (see "Review disposition"). Control visibility per D6, including the zero-active-topics empty state interaction with #200.
- **Shared planner.** One pure function in `@dipstick/shared` computes the restorable set, skips, and order from (archived defaults, active names). The server handler and the dialog preview both use it, so the preview cannot drift from the rule. It stays one small pure function (`normalizeTopicNameForMatch` plus `planDefaultRestore`): no classes, options, configuration or layers. If the dialog preview slips from this change, the planner stays server-side. `GET .../topics/all` gains an additive `displayOrder` on archived items (kept and justified in "Review disposition").
- **Specs and requirements.** New capability `bulk-restore-default-topics`; deltas to `audit-logging-operations`, `topic-write-rate-limiting`, `topic-management-screen`, `restore-topic` (cross-reference only). Use case 08 gains a "Restore Default Topics (bulk)" extension (acceptance checkboxes mirror the spec scenarios; drafted in task 1.3, installed by task 6.1; before the frontend tasks). Facilitator usability-test item added.

## Capabilities

### New Capabilities
- `bulk-restore-default-topics`: the endpoint, its cascade, duplicate/ordering rules, atomicity, concurrency and live-session guarantee.

### Modified Capabilities
- `audit-logging-operations`: `topic.defaults_restored` row and event.
- `topic-write-rate-limiting`: the new route shares the existing per-actor budget; values unchanged.
- `topic-management-screen`: control, dialog, result, visibility, accessibility.
- `restore-topic`: states that bulk restore is not a second implementation of single restore's rules and that single restore is unchanged.

## Ritual constraints preserved

- **First session on the canonical baseline (FR-8.2 lock).** Same `409 TOPIC_CUSTOMIZATION_LOCKED`. No "bulk is allowed before the first session because it only restores defaults". A locked team has nothing archived anyway; the exception would buy nothing and set a precedent.
- **No-manager rule.** Untouched. The endpoint writes topics only, never membership or participation. Admin access regardless of membership is the existing #208 decision.
- **Facilitator from another team.** Untouched, and no new path: a member facilitator gets `403 FACILITATOR_IS_TEAM_MEMBER` exactly as on single restore.
- **Not configurable.** No toggle of any kind. The endpoint takes no input at all, so it cannot be widened by a caller.
- **Simultaneous reveal and live sessions.** Restore is pre-session preparation. It never changes the order or content of a session whose room is already open, and nothing about it appears in the room. Participants never see the control, the result, or any trace of who restored what. Verified in design D8: topics are snapshotted at room open.
- **Not a performance tool.** Audit rows record actor and team only. No "who restored" surface in any participant-facing or team-facing view; restore provenance is visible only where single restore's provenance is visible today (the facilitator management screen's `restoredBy`).
- **Historical data retained (FR-8.3).** Original rows are reactivated, never copied; votes and session history come back with them.
- **Honest copy.** A restored default returns as the original row, with whatever name and definition the team had edited it to. Copy never promises canonical wording.

## FR-8.6 traceability (D12)

FR-8.6 stays **partially met**, stated explicitly.

| Clause | Before | After this change |
|---|---|---|
| "restorable" for archived default rows | One at a time | In one step |
| "restorable" for a team with zero active topics | Met by #200 (assign-defaults, admin only) | Unchanged; bulk restore is the preferred path when restorable archived defaults exist (D6) |
| "visible" for teams whose default rows were edited, deleted, or never existed | Open | Still open |
| partial or selective restore | Single restore only | Still single restore; consciously no selection UI (D11) |
| canonical wording on restore | Not met (original row returns with team edits) | Still not met; copy must not promise it |

## Known gaps, named and inherited, not fixed here

Each of these is drafted as a follow-up issue in `tasks.md` section 9 (Exec condition 4); the issues are filed by the PO or the pipeline owner, not by this change.

- **Thrown-path timing floor.** Single restore's thrown path (catch, ROLLBACK, rethrow) skips `applyTimingFloor`. **Bulk does not copy this** (Security H2, decided in design D22): it applies the floor in its catch. The other topic writes (TOPIC-003..007) keep the gap; follow-up 8.2 covers them.
- **Single restore does not enforce the duplicate rule** (verified: no server-side name check exists on Add or restore). Bulk is stricter for the skipped topics only. Bringing the rule to single restore is a follow-up.
- **Trend gap.** Restored topics resume in the trend view with a gap, as with single restore. No trend copy or behavior here; the facilitator-facing explanation travels with the trend-gap follow-up.
- **Position base discrepancy.** Restore appends from 1 on an empty list; Add starts at 0. Harmless to uniqueness and to the `>= 0` reorder assumption.

## Changed from exploration (flag for ratification)

1. **Audit metadata is ids and positions only, not names.** Exploration D2 listed `name` in the audit metadata. The audit-logging convention (`topic.defaults_assigned`, `topic.reordered`) is "never topic text"; topic names are team free text. Metadata is `{ restored: [{topic_id, new_position}], restored_count, skipped: [{topic_id, reason}] (at most 100), skipped_count, correlation_id }`. Names remain in the HTTP response only. Intent preserved (one click, one row), convention honored.
2. **Shared planner and `displayOrder` on archived items** (above). Exploration did not say where the preview order comes from; archived items today carry no `displayOrder`.

## Impact

- Backend: `packages/backend/src/routes/topics.ts` (handler), `src/auth/audit-logger.ts` (event name), no migration (no schema change; `audit_log.operation` is unconstrained text), `src/routes/content.ts` (additive archived `displayOrder`).
- Shared: planner and normalizer in `packages/shared`.
- Frontend: `TopicManagementPage.tsx`, new dialog component, empty-state variant.
- Docs: use case 08, `docs/deployment.md` "Zero-topic teams" runbook gains one line pointing to bulk restore as the preferred first step.
- Unchanged and asserted unchanged in the diff: `TOPIC_WRITE_LIMITS` values, including the "90 requests" floor comment; the structural test that session, voting and WebSocket code never import the limiter.

## Review disposition (BA and Exec reviews of this proposal)

Accepted unless marked otherwise. Each rejection or deferral carries its reason.

**Decisions on the open questions**
- **Ids-only audit metadata satisfies #218 AC4.** AC4 says the row "says which topics came back". The row lists every restored topic by `topic_id` with `new_position`, and every skipped topic by `topic_id` and reason; ids join to `topics` for names. That says which topics came back. Names are deliberately absent (audit convention: never team free text). I read AC4 as ids and ask the PO to confirm that reading (ratification item 5).
- **`displayOrder` on archived items and the order preview: kept, justified, separable.** Justification: the dialog lists the topics in the order they will take ("in the order shown", with no claim about prior order), and the server's duplicate rule picks the winner among same-named archived defaults by that order, so a preview without it cannot name the correct restored/skipped split for those rows. Dropping it would let the preview disagree with the server, which the shared planner exists to prevent. Cost: one additive integer on an existing read endpoint. Fallback if the PO disagrees: drop the field and the dialog's ordering sentence, keep count plus names; the planner then keeps the duplicate check only. The signal that would justify keeping it past launch is the usability item (task 8.2): facilitators who ask "where did they go" before confirming.
- **Transient highlight: deferred.** Polish, not needed for the value statement, and its "next interaction" clearing rule was untestable. Removed from the requirements and tasks. The result line and positioned list already say where the topics went. Can return as its own change with a defined clear rule.
- **Empty-state variant (#200 overlap): kept at the minimum.** Bulk is offered first only when something is restorable; otherwise the existing assign action alone.
- **Disabled states: one list.** The control is disabled, with "Save or discard your edit first.", when (a) a definition draft is dirty or (b) a reorder is unsaved. The "another dialog is open" clause is dropped: a modal dialog's focus trap makes it unreachable. Proposal, design D20 and spec now agree.
- **Locked team on the screen.** The control is hidden while the team is locked (the same lock indicator that hides single Restore); if a stale view still posts and receives `409 TOPIC_CUSTOMIZATION_LOCKED`, the screen shows the locked notice and refetches. Specified as scenarios.
- **Locked team, nothing archived: `409`, not `200`.** This is a noted deviation from the literal reading of #218 AC5 ("re-run with nothing archived: nothing, 200"). The lock check precedes emptiness in the cascade, and #218's own "locked teams are refused like single restore" governs. AC5's `200` applies to unlocked teams. Scenario added.
- **First-by-prior-order wins among same-named archived defaults, regardless of history.** Accepted, may strand the copy with more history; added to ratification (item 4). Ordering by "has history" first would add a query and a rule for a rare legacy shape.
- **Security review dispositions (design D21, D22).** Timing floor measurement and test (H1), floor in bulk's catch (H2), audit-row requirement and metadata bound (M1, M2), one-unit limiter decision recorded (M3), nonexistent-team 404 scenario (M4), retention sentence (M5), comparator doc comment (M6), lock/CSRF/no-store/body-limit facts verified in code and stated (L1-L4). Engineer review dispositions: softened order copy (S1), single authoritative name rule and `addCustomTopic.ts` left unchanged (S2), two-statement read, ROLLBACK on the empty path, forced-failure tests, in-flight disable and close-and-refetch on 403/404/409, extra concurrency tests, shared-built-before-tests CI check.
- **Unicode and case rule.** `trim().toLowerCase()` with no locale is a decision: "É" versus "e" and NFC versus NFD forms are different names. Recorded in the spec so no one "fixes" it unilaterally.
- **Blank-name archived default (legacy).** Restored like any other (a blank name cannot match an active topic's non-blank name); two blank-named archived defaults collide under the same-batch rule, so one is restored and one skipped. Stated in the spec.
- **Large N.** No cap is intended; bulk obeys no limit single restore does not. Tests exercise 12 (the template size) and a 50-row fixture.
- **`skipped` ordering and unknown reasons.** `skipped` uses the same restore-order sort as `restored`. `reason` is currently only `NAME_ACTIVE`; new reasons are an additive change and the client renders unknown reasons generically.
- **Cascade requirement split** into authorization, order, and timing-floor requirements; the routing scenario is labelled a regression guard.

**Declined**
- **Engineer: switch `addCustomTopic.ts` to the shared normalizer.** Declined (Engineer recommended against it too): regression risk and test coupling for no benefit to this change.
- **Exec condition 5, "two PRs" (backend then frontend).** Declined: the pipeline opens a single PR per change, and a second PR would split one review, one ratification and one archive across two. What is kept: `tasks.md` is ordered backend first (sections 3 and 4, ending in the 4.15 backend-green checkpoint), then frontend (section 5), docs last, so the commits are separable and the backend can be cherry-picked or reviewed alone if the PR is sliced later. The doc and spec sweep is mechanical and non-blocking: the `restore-topic` delta is a cross-reference and the runbook line is one sentence.
- **BA: add a "has history first" ordering.** Declined, as above.
- **BA: highlight clear rule** (click, keydown, route change, timeout). Moot, the highlight is deferred.
- **BA: Use case 08 drafted by me in this change.** Accepted in part: task 1.3 requires the extension, with checkboxes mirroring the spec scenarios, to be drafted before the frontend tasks begin. Marcus's offer to draft it is welcome; I have not written the use case text in this revision.

## Needs PO/compliance ratification (ratify-or-redirect after merge-review; the build proceeds on the defaults stated here, tasks 1.2 and 7.2)

1. Ids-only audit metadata (above).
2. Skip-and-report duplicate rule being stricter than single restore (D1). Task 1.2 records the count of affected teams for the PR so this item can be weighed on data; the build does not wait (unattended run).
3. Accepting "customs first, defaults last" ordering cost, with reset-to-canonical-order deferred.
4. First-by-prior-order wins among same-named archived defaults, regardless of history.
5. Reading #218 AC4 ("says which topics came back") as satisfied by ids and positions, and AC5's `200` as applying to unlocked teams only (locked team with nothing archived returns `409`).
