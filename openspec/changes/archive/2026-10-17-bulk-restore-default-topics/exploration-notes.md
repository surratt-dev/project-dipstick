# Exploration notes: bulk-restore-default-topics (#218)

Voice: Devon Calloway, Internal Champion. Explore mode only: no code. Revision 2, after the facilitator review (Priya Nair) and the BA review (Marcus Delgado). Every former "I lean" and "either is fine" is now a decision (Section 8). Where I rejected or narrowed a suggestion, the rationale is in Section 9. Anything still open is a verification task for design, listed in Section 10, with the fallback already decided.

## 0. Live-session statement (load-bearing)

Restoring default topics is pre-session preparation on the management screen. It never changes the order or content of a session that has already been opened, and nothing about it appears in the room. Participants never see the control, the result, or any trace of who restored what. FR-2.7 stands: the order in effect at room open is the session's order. This is a requirement of the change, not a nicety. Section 10 (item 1) says how design proves it.

## 1. What I think this is for

The ritual says a team should be free to experiment because the baseline is always one step away (BRD 6.4, FR-8.6 [HARD]: the default set "must remain visible and restorable ... at any time"). Today "one step away" is "twelve steps away, each with its own dialog". A chore is where experimentation stops. The intent is not "save clicks"; it is to make the guardrail-with-an-escape-hatch promise true in practice, so teams are willing to tailor in the first place.

Measurable form: restoring N archived defaults takes one confirmation and one request, regardless of N (at most 12 today).

The failure moment is specific, and Priya named it: the day before a session, the facilitator tailored the set, regrets it, and is rushing. A multi-step chore at that moment means they skip it and run the session with a topic set the team did not intend. The feature exists for that minute.

This serves the success criterion I care about most (a team I have never met adopts the ritual without me explaining it). A team that tailors, regrets it, and cannot cheaply get back quietly stops tailoring, or stops using the baseline.

What it is not: a reset. It does not un-archive customs, delete customs, rename anything, undo reorders, or touch annotations. It brings back the defaults that are archived. The UI says so plainly. "Restore default topics" is right; "Reset to defaults" would be a lie and would make a facilitator fear losing their custom topics.

One honest caveat for copy and for the FR-8.6 claim: a restored default returns as the original row, with whatever name and definition the team had edited it to before archiving. It does not return with canonical wording. Copy must not promise canonical wording.

## 2. Facilitator scenario (pre-session)

Short story, to be used as the acceptance backbone and in the usability test.

Priya facilitates a team she does not belong to. Two weeks ago the team archived five defaults to try a tailored list. The tailored list did not land. The day before the next session she opens the topic management screen and wants the shared language back.

Outcomes, in priority order:

1. **Back to baseline (the primary case, the 90 percent case).** The team archived some defaults and has no custom topics. She clicks "Restore default topics", reads the confirmation, confirms. The five return at the end of the list in their old relative order, which is canonical order. One line tells her: "Restored 5 topics. They are at the end of your list." She can tell what happened without reading the list. This is the primary acceptance scenario.
2. **Tailored plus a few defaults back.** The team keeps two custom topics and wants three defaults back. They return after the customs. The dialog said so beforehand ("added to the end of your list, in this order"). The known cost: a team whose customs sit first now has defaults last. Moving them back up takes up to 3 reorder steps per restored topic that must move (worst case about 3 moves for 3 topics, up to 12 steps if all twelve defaults came back behind several customs). That cost is stated plainly, not hidden. Reset-to-canonical-order is deferred (Section 9).
3. **Nothing to restore.** The control is not shown when no default is restorable. If the screen was stale and the server finds nothing, she sees "Nothing to restore." and no success banner.

Test requirement: include this management flow in the facilitator usability test Priya offered, scripted as "archive 5, restore all, confirm you can tell what happened without reading the list".

## 3. Ritual constraints in play (and which ones this must not loosen)

| Constraint | Why it matters here | What the bulk path must do |
|---|---|---|
| First session uses the canonical baseline (FR-8.2 lock, use case 08 lock) | The lock is a fact about the team's session history | Same 409 TOPIC_CUSTOMIZATION_LOCKED as single restore. No "bulk is allowed pre-first-session because it only restores defaults". A locked team has nothing archived anyway; the exception buys nothing and sets a precedent. If a locked team somehow has archived defaults, the 409 is still correct and is tested. |
| Member facilitator bar | Uninvested facilitator; FR-2.2 principle | Same helper semantics as TOPIC-005 and #208. Outcome per role in Section 4. Not a new role rule. |
| Template team is not a team (#188, #214) | The `__default_topics__` row holds the canonical set | Refused with the byte-identical TEAM_NOT_FOUND envelope, same position in the cascade. |
| Historical data retained (FR-8.3) | Restore re-activates the original row, history comes back | Reactivate original rows, never insert copies. |
| Not configurable | My standing worry: constraints becoming toggles | No flag, no env var, no "allow bulk before lock". The endpoint takes no input at all (Section 8, D5). |
| Not a performance tool | Audit rows record actor | Audit is actor-and-team scoped. No "who restored" surface in any participant-facing or team-facing UI. Restore provenance is visible only where single restore's provenance is visible today. |
| Session runtime untouched | Limiter module must never be imported by session/voting/WebSocket code | The existing structural test must still pass. The new handler lives with the other topic routes. This is a design preference; the testable requirement is the structural test. |

## 4. Authorization and error cascade (ordered; each step is a test case)

Outcome per actor, verified against TOPIC-005 and #208 during design:

| Actor | Result |
|---|---|
| App admin (any team, member or not) | Allowed |
| Facilitator who is not a member of the team | Allowed |
| Facilitator who is a member of the team | 403 FACILITATOR_IS_TEAM_MEMBER |
| Non-facilitator (including ordinary members) | 403 NOT_A_FACILITATOR |

Cascade, in the live order (the code comment on single restore still lists the older order; the proposal cites the live order, not the comment):

1. Identity: 401/403 as existing.
2. Role: 403 NOT_A_FACILITATOR / FACILITATOR_IS_TEAM_MEMBER.
3. Non-canonical teamId: 404, before any query. Lowercase teamId only after the canonical check.
4. Rate limiter: 429, or 503 when the limiter fails closed.
5. Writable team: 404 TEAM_NOT_FOUND (template team included, byte-identical).
6. Customization lock: 409 TOPIC_CUSTOMIZATION_LOCKED.
7. Transaction under `lockTeamTopics`.

There is no topic-existence 404 and no status 422 step in bulk; those belong to single restore only. The timing floor applies on every exit, including the thrown path. The known gap on single restore's thrown path is named in the proposal; bulk copies the behavior and does not fix it in this change (a fix belongs to a separate issue so the two paths stay identical).

## 5. What the code already does (grounding)

- Single restore (`routes/topics.ts`, TOPIC-005): the cascade above, then a transaction under `lockTeamTopics`, computes `MAX(display_order)+1` over active rows, flips status, sets `restored_at/restored_by`, writes one `topic.restored` audit row in the same transaction, emits the structured log after COMMIT.
- Single restore does not enforce a name-uniqueness rule today (I found no such check in the topic routes; design confirms). Consequence recorded in D1: the bulk duplicate rule is stricter than single restore, so "bulk equals N single restores" holds for the set of topics bulk actually restores, not for the skipped ones.
- Frontend: `submitRestore` does an inline `fetch` per topic, a per-row confirm dialog (`RestoreTopicDialog`), then `finishAfterTopicWrite` for a quiet refetch. Restore and Remove are disabled while a definition draft is dirty; `isTopicDialogOpen` gates drafts. The bulk dialog joins that mutual-exclusion family.
- Limiter: `TOPIC_WRITE_LIMITS` burst 120/10min, daily 400/24h per actor, shared across the topic-write routes. Every admitted request counts, including later 404/409/422. 429s are not counted. Fails closed with 503.
- "Default" is `topics.is_default = true` on the team's own rows (copied at team creation by `copyCanonicalDefaults`). No foreign key back to the template row.
- `display_order` uniqueness is only among active rows (partial unique index `topics_team_active_order`). Archive never renumbers; restore appends. Reorder assumes every active `display_order >= 0`.

## 6. Where restored topics go

Decision: append after the highest active `display_order`, within the batch ordered by each row's prior `display_order` ascending, then `id` ascending (D3). Rationale, unchanged from rev 1:

- Precedent resolved twice (use case 08 Re-add Decision 3; single restore code): reinstated topics are appended, not returned to prior slots. Bulk must not give a different order than N single restores in the same sequence.
- Template `display_order` is the wrong source of truth (copies; template can drift; matching by name has no FK). Interleaving would renumber active rows and turn restore into a hidden reorder. Reorder is a deliberate act of the facilitator (FR-2.7). Rejected.
- Within-batch order by prior `display_order` is canonical order unless the team reordered before archiving, so "restore all with no customs" returns exactly the canonical list.
- Priya's concern stands and is accepted as a cost: customs first, defaults last. Stated in the dialog and in Section 2. Reset-to-canonical-order stays a separate, later issue.

Acceptance: archived defaults with prior orders 4, 2, 5 and base B receive positions B+1 (the order-2 topic), B+2 (order 4), B+3 (order 5).

## 7. Things that could go wrong (now with decided handling)

1. **Scope creep into "reset".** Endpoint touches only `status = 'archived' AND is_default = true` rows. The dialog names what is not changed: custom topics, current order, annotations.
2. **Partial results.** One transaction, all or none. A failure leaves every topic unchanged. Skips (D1) are a defined outcome, not a partial failure. The UI needs no "7 of 12" state.
3. **Concurrency.** The set is computed inside the `lockTeamTopics` lock. Acceptance: two concurrent bulk requests on one team produce no duplicate active rows and no `display_order` collision, and the second returns 200 with an empty or reduced `restored`. A concurrent single Add or single restore is serialized by the same lock and cannot cause a unique-index violation.
4. **Empty case.** 200, `restored: []`, `skipped: []`, no audit row, no state change, one limiter unit consumed (same actor bucket as the other topic writes; no separate counter). No 4xx and no 409.
5. **Limiter.** Values in `TOPIC_WRITE_LIMITS` unchanged in the diff, including the "90 requests" floor comment. Tightening is a separate, security-owned decision.
6. **Amplification.** Bounded by the number of archived defaults on the team (at most 12 today). The handler issues a bounded number of statements independent of N, with the flip done as a single UPDATE. Acceptable.
7. **Timing and enumeration.** Individual acceptance items: timing floor on every exit; template-team 404 byte-identical to missing-team 404; non-canonical teamId 404 before any query; lowercase after the canonical check; thrown-path gap named and inherited, not fixed here.
8. **Dirty draft.** Control disabled while a definition draft is dirty or another topic dialog is open, with the plain reason "Save or discard your edit first." The dialog blocks drafts while open. Otherwise the post-restore refetch discards unsaved text.
9. **Trend gap.** Restored topics resume in the trend view with a gap, as with single restore. The dialog and response make no trend claim (acceptance: no trend-related copy or behavior). A facilitator who inherits a team and sees the gap deserves a plain explanation somewhere; that belongs in facilitator-facing help in the follow-up that fixes trend treatment, not in this change's UI.
10. **Maximum topic count.** The only cap I found is the reorder request cap (200 entries). Bulk adds at most the archived default count, so it cannot push a normal team near it; design confirms there is no other maximum, and if one exists bulk obeys it the way single restore does.
11. **All twelve archived, zero active.** A valid result and a valid session set. It overlaps with #200 recovery (D1 and D8 cover the interaction).
12. **Accessibility.** Dialog focus is trapped and returned to the control on close; the result is announced through a live region; the topic list in the dialog is reachable by keyboard.

## 8. Decisions

**D1. Duplicate rule (was 5.2; BLOCKER).** Bulk restore skips any archived default whose name matches an active topic on the team, and reports it as skipped. Duplicates are never silently produced; skip-and-report beats restore-and-warn.
- Match: trimmed, case-insensitive, using the same comparison as the existing name check if one exists (none found for single restore, so this change defines it: trim, then lowercase).
- A renamed default is compared by its current name. `is_default` remains the only marker.
- Two archived defaults sharing one name: at most one is restored, the one with the lowest prior `display_order`, then lowest `id`. The other is skipped. Evaluation is sequential in restore order, so a name restored earlier in the batch makes a later same-named row skip.
- Skipped entries carry reason `NAME_ACTIVE` (one code covers both active-topic and earlier-in-batch matches).
- Skipped topics stay archived.
- Consequence of the rule after #200 zero-topic recovery: recovery created fresh active copies, so the archived originals now match active names and are skipped. They stay archived indefinitely. That is acceptable: the team has the baseline names active. The UI hides the control when no archived default is restorable (D6), so the team is not nagged.
- Principle deviation, stated explicitly: single restore does not enforce this rule today. Bulk equals N single restores for every topic bulk restores; skipped topics are the one place bulk is stricter. Whether to bring the rule to single restore is a separate follow-up and is not bundled here.
- Acceptance: archived default "Code Quality" plus active "code quality " yields no restore of "Code Quality" and a `skipped` entry with `NAME_ACTIVE`.

**D2. Audit shape (was 5.5; BLOCKER, small).** One `topic.defaults_restored` audit row per non-empty request, written in the same transaction, metadata `{ restored: [{topic_id, name, new_position}], skipped: [{topic_id, name, reason}] }`. Matches `topic.defaults_assigned`; one click, one row. The empty case writes nothing. No `topic.restored` rows are created by the bulk path, and single restore's `topic.restored` is unchanged. Provenance is per row: each restored topic has `restored_at` and `restored_by` set to the actor, in the columns, not only in the audit blob. Design confirms the history view reads those columns rather than `topic.restored` audit rows; if it reads audit rows, that is a bug in the view to flag, not a reason to write per-topic audit rows. Audit rows are not surfaced to participants or to any team-facing view.

**D3. Ordering and tie-break.** Append after the highest active position; within the batch, prior `display_order` ascending, ties by `id` ascending. Ties can arise because the partial unique index allows reused `display_order` among archived rows. `id` ordering is arbitrary but deterministic, which is sufficient. Test rule: for any starting state, bulk yields the same final rows (status, `display_order`, `restored_at`, `restored_by`) as restoring the non-skipped topics one at a time in that order (table test comparing both paths).

**D4. Position base.** `COALESCE(MAX(active display_order), 0) + 1`, matching single restore. With zero active topics the first restored topic gets 1. This leaves a known, accepted discrepancy with Add (first topic at 0); logged here, harmless to uniqueness and to the `>= 0` assumption.

**D5. Stale preview and request body.** The server computes the set inside the lock and ignores any client list. The request takes no input: any body is ignored (not rejected, not parsed). Ignoring cannot widen scope and adds no new 400 path or error surface to enumerate. If a topic was restored singly between dialog open and confirm, bulk returns 200 with that topic absent from `restored`, no error. The result view reports actual outcomes. If the actual set differs from the preview, the result says so with a delta line, for example "Restored 4 topics (1 was already restored)", so the facilitator does not believe the preview.

**D6. Control visibility.**
- Non-facilitators and members who cannot act: the control is not rendered. No disabled button with a lecture.
- Facilitators and admins: shown when at least one archived default is restorable per the loaded list (an archived default whose name is not already active, matching D1); hidden otherwise. No disabled-with-"nothing to restore" state.
- Disabled with reason (facilitators and admins only) while a definition draft is dirty or another topic dialog is open: "Save or discard your edit first."
- The client's list may be stale, so the 200-empty response still renders "Nothing to restore." and never a success banner.
- Empty-state with zero active topics (overlap with #200): when restorable archived defaults exist, "Restore default topics" is the primary action, because it brings back original rows and their history (FR-8.3); "Assign default topics" is secondary, with copy saying it creates fresh copies. When none are restorable, only "Assign default topics" appears.

**D7. Response contract.** 200 body: `{ restored: [{topicId, name, displayOrder}], skipped: [{topicId, name, reason}] }`. Empty case: both arrays empty, still 200. No 4xx or 409 for emptiness. The UI uses the returned positions to show where topics landed.

**D8. Live and in-progress sessions.** See Section 0. Bulk restore cannot alter a session already opened. Design verifies that topics are snapshotted at room open (Section 10, item 1). Fallback, decided now: if they are not snapshotted, bulk restore is blocked for a team with an open room or session in progress, and the same exposure on single restore, Add, Remove and Reorder is filed as a separate defect. Either way a test exists that restores during an open session and asserts the session's topics are unchanged.

**D9. Result feedback.** One line with the count and where they went: "Restored 5 topics. They are at the end of your list." plus the list of restored topics with new positions, and the skipped list with the reason in plain words when D1 skipped anything. No celebratory UI: no confetti, no meter, no banner beyond that. Restored topics get a transient highlight on the management screen only, cleared on the next interaction or navigation, never persisted and never in session views.

**D10. Confirmation dialog.** Title "Restore default topics". Lists the topics that will return, in order, under a count heading ("5 topics will be added"); the list scrolls rather than truncating, so 11 names is readable. States: "They will be added to the end of your list, in this order." States what is unchanged: custom topics, current order, annotations. Lists topics that will not return because the name is already in the list. Includes a pointer: "To bring back only some, restore them one at a time." Draft copy (final wording at design): button "Restore default topics"; empty result "Nothing to restore."; success line as in D9.

**D11. Undo and selective restore.** Neither is offered. No bulk undo: the cost of an over-restore is archiving topics one at a time, which is the original chore in reverse; that is acceptable because restore is additive and harmless, nothing is lost, and the dialog states exactly what will return before the facilitator commits. Selective restore is single restore, which already exists; the dialog names it.

**D12. FR-8.6 traceability (a deliverable of the proposal).** FR-8.6 stays "partially met", stated explicitly. Advanced: "restorable" for archived default rows. Still open: "visible" for teams whose default rows were edited, deleted, or never existed, and partial or selective restore. The proposal lists which clauses move and which do not.

**D13. Success measure.** Restoring N archived defaults takes one confirmation and one request, for any N up to the archived default count.

**D14. Routing.** POST `/topics/restore-defaults` resolves to the new handler; `/topics/order` and `/topics/:topicId/restore` still resolve to theirs. A routing test covers all three.

## 9. Feedback not adopted, or adopted in narrower form

- **Reset-to-canonical-order as part of this change (Priya, item 2).** Declined. Accepted the point that reordering one by one is the chore this feature removes, so the cost is stated plainly (Section 2, outcome 2) and worded honestly in the dialog. But a bulk restore that reorders is a hidden reorder, and reorder is the facilitator's deliberate act (FR-2.7). It stays a separate, explicit issue if teams ask.
- **Reject unknown body fields with 400 (Marcus, 1.7).** Declined in favor of ignoring the body entirely (D5). Rejecting adds a new error path to keep byte-consistent for enumeration purposes; ignoring cannot widen scope.
- **Persistent restored marker (Priya, item 5).** Narrowed to a transient, management-screen-only highlight. A persistent marker would read as a record of who tinkered with the topic set and would leak into team-facing views.
- **Trend explanation in this change (Priya, question 1).** Not in this change's UI. Marcus's reading is right: no trend copy or behavior here. The facilitator-facing explanation travels with the trend-gap follow-up.
- **Nothing visible to participants about restores (Priya, item 10).** Adopted in full and made a requirement (Section 0, D2, D6).
- **Per-topic audit rows to keep `topic.restored` consumers working (Marcus, 1.5 discussion).** Declined; the history view must read the per-row columns. One row per action stands.
- **Bulk undo and selective restore (Priya).** Consciously not offered (D11).
- **Making single restore enforce the duplicate rule, or fixing the thrown-path gap (Marcus, 1.1 and 5.8).** Not bundled. Both would change another path's behavior inside a change whose guiding rule is "less new behavior". They are named, and follow-ups are suggested.
- **Tightening or retuning the limiter.** Out of scope as before.

## 10. Verification tasks for design (decisions already made; these confirm facts)

1. Confirm topics are snapshotted at room open, and add the restore-during-open-session test (D8; fallback decided).
2. Confirm that no name-uniqueness check exists for single restore or Add, and define the shared comparison (D1).
3. Confirm the history view reads `restored_at/restored_by` columns (D2).
4. Confirm the per-role outcomes in Section 4 against TOPIC-005 and #208.
5. Confirm there is no maximum active topic count beyond the reorder request cap (Section 7, item 10).
6. Confirm a locked team with archived defaults is unreachable, and that the 409 is still correct if it is reached.

## 11. Scope line

In scope: one endpoint, one control, one confirmation, one limiter unit, one audit row, append in prior relative order, same cascade, idempotent empty case, the duplicate rule (D1), the live-session guarantee, the result and dialog copy requirements, the routing test, the structural test staying green, and the facilitator usability test item.

Out of scope, explicitly: reset-to-canonical-order, restoring custom topics, editing the template, changing limiter numbers, any configuration toggle, trend-view treatment, per-topic selection ("restore these three of the five"; single restore is the path), bulk undo, enforcing the duplicate rule on single restore.

If I only get one thing from this review: the bulk path is the same operation as N single restores in a safe order, with the same guards, plus one guard against duplicates, and nothing more. The less this feature has its own rules, the less it can quietly weaken one of mine.
