# BA Review: Exploration Notes — Session Lifecycle Transitions

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `openspec/changes/session-lifecycle-transitions/exploration-notes.md` (Devon Calloway, Internal Champion)
**Date:** 2026-09-08
**Sources checked directly:** `requirements/BRD.md`, `requirements/design/REST API Contract.md`, `packages/backend/migrations/2_create_tables.sql`, `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/realtime/ws-pubsub.ts`, `ws-event-dispatcher.ts`

I did not take Devon's document on faith any more than Devon took issue #26's. I re-checked the specific claims I was asked to verify, and one of them opened up a finding Devon didn't have — noted in Section 3 below, and it changes my answer to the Section 7 question.

---

## 1. Direct answer: Section 0.2 / 4.3 — action item finalization

**Confirmed: no new write is needed. Devon's read is correct.**

Evidence:
- `action_items` (`migrations/2_create_tables.sql:134-150`) has no `finalized` or `finalized_at` column. There is nothing in the schema for a finalization write to target.
- `SESSION-006 — Close Session` (REST API Contract.md:1322-1377) is the only write that changes what "finalized" means for an action item. Its response includes `actionItemsFinalized: number` (line 1354), which the contract's own note confirms is a *count*, computed from the session-complete transition — not evidence of a per-item write.
- `ACTION-004 — Get Action Item Backlog for Team` (line 2159-2167) literally defines "finalized" for you: *"Returns all finalized action items for a team across all completed sessions"* — i.e., finalized = belongs to a session whose `status = 'complete'`. This is a read-time join condition, not a stored flag.
- I checked the staleness path too, since it's the other candidate for a hidden write FR-7.4 might require. `stalenessLevel` (lines 1235, 1763, 2204, 2607, 2773) is explicitly documented as **computed at query time** — "the count of completed sessions since each item's `updated_at`" against `application_settings.staleness_threshold_sessions" (lines 1255, 1781, 2224). No write commits a staleness flag. I also grepped the application code for `stale`: the only hits (`realtime/staleness-signal.ts`, `websocket-routes.ts`) are a WebSocket **connection**-staleness close code, an unrelated concept that happens to share the word — worth flagging so nobody chasing "stale" in code greps finds that file and thinks it's related to FR-7.4. It is not.

**Action for Propose:** adopt Devon's first bullet in 4.3 as written — correct the "action item finalization" language in issue #26 and in the WebSocket change's dispatcher comments (`ws-pubsub.ts:92-94`, `ws-event-dispatcher.ts:230`) to say what's true: `topic_history_update`'s trigger for the wrap-up-adjacent case is the session-complete write (already built, already firing `session_state_change`), not a separate finalization event. This narrows `topic_history_update`'s real trigger set to one thing: topic-to-topic advance. Say this explicitly in Propose's scope statement so it's traceable — don't just quietly drop the fourth deliverable.

This was mine to confirm and I've confirmed it. No BA follow-up item results from this one.

---

## 2. Section 5.1 — anchoring membership-removal authorization on TEAM-005

**This is a reasonable BA-level call, and I'm making it now rather than deferring it.** It does not need to wait on issue #23.

I want to be precise about *why* it doesn't need to wait, because the exploration doesn't fully separate two different open questions that live in this same neighborhood, and conflating them would wrongly stall this decision:

- **"Who can remove a member from a team roster?"** — this is a roster-governance question. It has the same shape as "who can change a member's role" (TEAM-005), which the BRD already answers at FR-1.6: admin manages any team's membership, EM manages their own team's membership, extended 2026-03-15 to formalize the EM half. Removal is the limit case of a role change (role → "not on this team"). This question has nothing to do with what happens to the removed member's action items, so it doesn't depend on issue #23's answer.
- **"What happens to open action items owned by the removed member?"** — this is issue #23's question, and it's genuinely unresolved (BRD OQ-5, line 728: *"are their open action items orphaned, reassigned, or flagged?"*).

Devon's document keeps these separate correctly (5.1 vs. 5.2/5.3); I'm confirming that separation is the right one and that 5.1 doesn't inherit 5.2's dependency.

**One data point Devon didn't check that I did, and it matters:** I verified TEAM-005's authorization text directly (REST API Contract.md:407-465). It reads exactly as Devon described — `application_admin` (any team) OR `engineering_manager` with active membership for that team (own team only) — so the precedent is real, not reconstructed from memory. However, **Appendix C's open-questions table has a stale entry that could mislead a future reader into doubting this precedent**: OQ-6 (line 2856) says *"The authorization scope for role management (facilitator-only, non-member requirement) has not been fully validated against the BRD"* — but TEAM-005 as currently written has nothing to do with facilitators; its authorization is admin/EM, full stop. OQ-6's description doesn't match the endpoint it's attached to. This looks like a leftover from an earlier draft of TEAM-005 (or was copy-pasted from a different open question) that was never updated when the 2026-03-15 EM-extension decision landed.

**Suggested rewrite for Propose:** don't just silently rely on TEAM-005's authorization text — flag OQ-6 for correction (or removal, if it's genuinely stale) as a small housekeeping item alongside this change, since a future reader hitting OQ-6 could wrongly conclude TEAM-005's own authorization model is unsettled and therefore unsafe to anchor on. It isn't unsettled; the open question is just mislabeled.

---

## 3. Section 5.2/5.3 — the seam left for issue #23

**The scope boundary is specific enough to implement now.** "Surface the open-action-item count as part of the removal transaction, do not decide reassignment policy" is a concrete, buildable acceptance condition — it's a read (`COUNT(*) FROM action_items WHERE owner_id = :userId AND team_id = :teamId AND status IN ('open','in_progress')`) inside a transaction that's already touching `team_memberships` for the same user, exactly as Devon describes. There's no ambiguity in what "surface the count" means operationally.

**Where I'd push back slightly:** Devon's document doesn't specify *where* that count surfaces — response body field name, whether it blocks (even softly, e.g. requiring a confirmation flag like TEAM-005's `requiresConfirmation`) or is purely informational, and whether the facilitator-not-participant asymmetry matters (the removal actor is admin/EM per Section 5.1, but the count is about the *removed member's* items, not the actor's). I don't think this needs to wait on issue #23 to specify — Propose should still nail down:

- Response field name and shape (e.g., `openActionItemCount: number` in the removal response, matching the `actionItemsFinalized: number` pattern already established at SESSION-006).
- Whether a nonzero count triggers the same `422 requiresConfirmation: true` pattern TEAM-005 already uses for the zero-participant guard, or is silently informational with no confirmation step. I'd lean toward requiring confirmation here too — silently letting someone remove a member who has open commitments, with no signal to the person clicking the button, is the kind of thing that turns into a support ticket. But this is a UX/acceptance-condition decision Propose can make; it does not require issue #23's policy answer, because "confirm you're aware of N open items" is orthogonal to "what happens to those N items."

**On the tear-out risk Devon and I were both asked about:** no, I don't think this seam risks getting torn out when issue #23 resolves. Issue #23 will decide what happens to the *count* Devon's design surfaces (block, auto-reassign, flag) — it will consume this seam, not replace it. The only way this gets torn out is if issue #23's eventual answer requires the count to be computed differently (e.g., "count items by topic recency" instead of a flat open/in-progress count) — I see no signal anywhere in OQ-5 or issue #23's framing that suggests that. Low risk. I'd class this seam as buildable now.

---

## 4. Section 7 — the REST-vs-WebSocket reveal-trigger discrepancy

**Devon's finding is real but understated. I found a bigger version of the same problem, and it changes my recommendation.**

Devon's document treats this as one stray line — `VOTE-003`'s note (*"The reveal itself is triggered via WebSocket (`reveal.trigger`), not this endpoint"*) — conflicting with the already-built REST endpoint. I checked further and found the actual scope of the conflict is a dedicated section of the contract, not a stray note:

**Appendix D ("Endpoints Explicitly Excluded from HTTP REST," lines 2862-2873)** states, formally and with an explicit rationale citation: *"The following behaviors must NOT be implemented as REST endpoints. They are governed by the WebSocket layer. Implementing them as REST would violate the simultaneous reveal integrity requirement (BRD Section 6.1)."* The table lists **both** `reveal.trigger` ("Must be a server-initiated broadcast to all clients simultaneously") **and** `topic.advance` ("Must broadcast to all participants simultaneously") as REST-excluded.

That second one matters a lot for this change, because Section 4.2 of Devon's document plans to build topic-to-topic advance, session-phase entry (`SESSION-004`/`SESSION-005`), and wrap-up entry as REST endpoints — and `SESSION-004` and `SESSION-005` are **already formally documented, fully-specified REST endpoints in this same contract**, performing advance-shaped transitions (`lobby→pre_session`, `pre_session→active` with first-topic advance) and firing WS broadcasts (`topic.advanced`) for fan-out. So the contract contradicts itself internally, independent of what code exists: Appendix D says topic-advance must not be REST at all; forty pages earlier, the same document specifies two REST endpoints that do exactly that.

**I went back to the actual BRD text (Section 6.1, lines 151-157) to settle which side is right, since Appendix D cites it as authority.** BRD 6.1's application requirement reads: *"Votes that have been cast but not yet revealed must not be readable by any client... The reveal must be a single, server-triggered event that makes all votes visible simultaneously."* That's a requirement on **delivery** — no early visibility, one simultaneous fan-out to everyone. It says nothing about the *transport of the facilitator's own trigger action*. A REST call that the facilitator's authenticated client makes, followed by a server-side transaction commit and a single Redis-publish-triggered WebSocket broadcast to every connected client, satisfies BRD 6.1's actual text exactly as well as a WebSocket-native `reveal.trigger` message would — the simultaneity guarantee lives in the fan-out step, which is WebSocket-based either way, not in whether the facilitator's button-click is an HTTP POST or a WS frame.

**My conclusion: Appendix D over-applies BRD 6.1.** It correctly excludes vote *submission* from REST (`vote.submit` — that one's rationale, "HTTP polling would expose vote timing to observers," is a real and different concern about polling-based visibility, and I agree that one should stay WS-only). But extending the same exclusion to the *trigger* actions for reveal and topic-advance — as opposed to their *delivery* — isn't supported by BRD 6.1's actual text, and it directly conflicts with `SESSION-004`/`SESSION-005` already being specified as REST in the same document.

**This changes my answer to Devon's question.** Yes, I agree the contract should be corrected, and yes, "correct the contract as part of this change" is a well-scoped acceptance condition — but it's larger than fixing one note under `VOTE-003`. Propose needs to:
1. Rewrite Appendix D's `reveal.trigger` and `topic.advance` rows to describe the actual (and, in my judgment, correct) architecture: privileged trigger via authenticated REST call, single simultaneous WebSocket broadcast for fan-out, publish-after-commit — and narrow Appendix D's rationale column so it no longer implies the trigger transport itself is the integrity mechanism.
2. Correct `VOTE-003`'s note (line 1924) to match.
3. Leave `vote.submit`'s REST exclusion untouched — that one's rationale doesn't have the same flaw.

I don't think this needs its own separate tracked change — it's a same-document correction directly caused by and scoped to the transitions this change is wiring up, and no other in-flight change depends on Appendix D's current (incorrect) text. But Propose should call it out as its own explicit task, not bundle it silently into "implement the reveal endpoint," because a reviewer checking the contract against BRD 6.1 during this change's review needs to see the correction and the reasoning, not just an updated line with no trail back to why.

---

## 5. Section 3 — does the two-way split cleanly separate requirements?

**Mostly yes, with one traceability gap the split itself surfaces rather than causes.**

Checking the split against endpoint IDs and FRs directly:

- **Topic lifecycle change** touches `SESSION-004`, `SESSION-005`, `SESSION-006` (already built, unaffected), the reveal trigger (currently **has no endpoint ID at all** in the contract — a direct consequence of the Appendix D problem in Section 4 above: because reveal is currently classified as REST-excluded, it was never assigned a `SESSION-0XX` or `VOTE-0XX` number the way every other endpoint was), and FR-4.1, FR-4.6, FR-4.6.1, FR-4.7, FR-6.1 (BRD numbering — the wrap-up entry requirement Devon cites in 4.2). **Confirmed, not just suspected:** I checked the full endpoint list (all 34, `TEAM-001` through `HEALTH-002`) and there is no `SESSION-0XX` entry anywhere for `active → wrap_up`. Devon's Section 4.2 hedges this ("worth Propose double-checking... since I may have missed it") — I did the check myself. It's confirmed missing. This means that sub-transition isn't just unwired, it's **undesigned** in the contract, same category as membership removal, not the "wiring only" category Devon puts most of Section 4.2 in. Propose should say so plainly and assign it a real endpoint ID as part of this change's design work, not treat it as a peer of the topic-to-topic advance wiring.
- **Membership-removal change** touches `TEAM-005` (precedent only — not modified), FR-1.6, and a wholly new, currently-unassigned endpoint. Clean, no overlap with the topic-lifecycle change's endpoint set.

**The one place a requirement could get split awkwardly if Propose isn't careful:** action item continuity (one of the five product properties I care about most, per my own priorities) has requirement surface in *both* changes' orbit without being owned by either. The topic-lifecycle change's "action item finalization" work (Section 1 above) touches how items become visible in the backlog. The membership-removal change's open-item-count surfacing (Section 3 above) touches the same table from the ownership angle. Neither change modifies `VOTE-004` (reassignment), which is correct — but Propose should state explicitly, in both changes' scope sections, that `VOTE-004` and its "new owner must be an active participant" constraint are unmodified and reserved for issue #23, so a reviewer doesn't have to infer that from silence in two separate documents. This isn't a flaw in Devon's split — the split is right — it's a traceability note Propose should write down so FR-7.x (action item requirements) doesn't end up implicitly, silently divided between two proposal documents with no cross-reference.

---

## 6. Other vague spots worth firming up before Propose

- **Section 4.1, re-reveal handling:** Devon recommends `409` over a silent no-op. I agree and would go further — Propose should state the exact response body/error code Devon's own document elsewhere uses as the pattern (`errorState: "reveal_failure"`, matching the existing handler's error shape at `facilitator-sessions.ts:509,554,564,579`), so this doesn't get implemented as a generic `409` with different error-body shape than the rest of the endpoint. Small thing, but it's exactly the kind of "what did you mean by 409" question I'd rather not get asked mid-implementation.
- **Section 4.2, "entry into wrap-up":** see Section 5 above — this needs to be named as a design deliverable (new endpoint, new ID) in Propose's task list, not folded into "topic advance."
- **Section 5.2, "seam":** see Section 3 above — specify the response field name and whether nonzero open-item count requires confirmation, now, rather than leaving both to be improvised during implementation.

---

## Summary for whoever picks this up next

1. **Action item finalization needs no new write.** Confirmed against schema and contract. Correct the language in issue #26 and the WS dispatcher comments; narrow `topic_history_update`'s real trigger to topic-to-topic advance only.
2. **TEAM-005 is a valid, ready-now precedent for membership-removal authorization.** Confirmed the actual auth text. Flag Appendix C's OQ-6 as a stale/mismatched entry needing cleanup so it doesn't cast false doubt on this precedent later.
3. **The issue #23 seam (open-item count, no policy decision) is specific enough to build now** — but Propose should still nail down the response field name and whether a nonzero count requires confirmation, since neither of those needs issue #23's answer.
4. **The REST-vs-WebSocket discrepancy is bigger than Devon's document scoped it.** It's not one stale note under `VOTE-003` — it's Appendix D formally excluding both `reveal.trigger` and `topic.advance` from REST, on a rationale (BRD 6.1) that, read directly, doesn't actually support excluding the *trigger* transport, only the *delivery* mechanism — and Appendix D already self-contradicts against `SESSION-004`/`SESSION-005` in the same document. Recommend correcting Appendix D and `VOTE-003`'s note together, as an explicit task in this change, not a silent side-fix.
5. **The two-way change split is sound**, but the `active → wrap_up` transition is undesigned (no endpoint ID exists anywhere in the 34-endpoint contract), not just unwired — Propose should treat it as design work, same category as membership removal, and both change documents should explicitly note `VOTE-004`/reassignment as untouched and reserved for issue #23, so action-item-continuity requirements don't end up implicitly split across two documents with no cross-reference.
