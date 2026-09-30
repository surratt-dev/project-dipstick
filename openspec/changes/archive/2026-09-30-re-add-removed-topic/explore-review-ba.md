# BA Review: Exploration Notes — Re-Add a Previously Removed Topic (issue #54)

**Reviewer:** Marcus Delgado, Business Analyst
**Subject:** `openspec/changes/re-add-removed-topic/exploration-notes.md` (Devon Calloway)
**Verdict:** Mostly ready to carry into design.md. The core finding (§1, the authorization correction) is verified and stronger than the notes claim — I'd tighten the citation, not the conclusion. One item the notes flag as "open" (§4, provenance) is correctly left open, but I found a discrepancy inside the drafted contract itself that the notes missed and that changes what "open" actually means here. The concurrency finding (§3) is concrete enough to hand to an engineer as written. One additional gap: the use case's own Acceptance Criteria don't yet cover the authorization correction from §1, and they should.

I read the source documents directly rather than trusting the notes' characterization of them: `REST API Contract.md` (TOPIC-002 through TOPIC-006 in full), the "Re-Add a Previously Removed Topic" and "Remove a Topic" use cases in full, `remove-topic/design.md` (all 10 decisions), `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/backend/src/routes/topics.ts`, `packages/shared/src/types/topic.ts`, the migrations (`1_create_enums.sql`, `2_create_tables.sql`, `16_topics_archived_by.sql`), `packages/backend/src/auth/audit-logger.ts`, `requirements/entities-and-relationships.md`, and `TopicManagementPage.tsx`.

---

## 1. Authorization correction (§1 of the notes) — verified, traceable, and concrete enough to build from as stated

**Traceability, checked at the source, not the notes' summary of it:**

- `REST API Contract.md:818` (TOPIC-005's `Authorization` line) reads exactly as the notes quote it: `global_role = 'facilitator' AND not a member of this team AND isCustomizationLocked = false` — no `application_admin` branch.
- `remove-topic/design.md` Decision 1 is a real, written correction of the identical shape for TOPIC-004, sourced to an engineer review finding against FR-8.2 `[HARD]`. I confirmed FR-8.2 exists and reads "the facilitator or Application Administrator shall be able to add, remove, or reorder topics" (it does not say "restore," but "remove" and its inverse are governed by the same use-case pairing per the use case doc's own "Dependencies: Use Case: Remove a Topic — the inverse of this action" line — an `application_admin` who can undo an action FR-8.2 lets them do should not lose that ability on the undo path without a stated reason, and the notes' "no principled reason for it to have a narrower model than its sibling" holds up).
- `checkStandingFacilitatorOrAdminAuthorization` is real, shipped code (`packages/backend/src/auth/standing-facilitator-access-helper.ts:58` onward), with its own header comment citing `remove-topic, design.md Decision 1` as its origin. I confirmed its two current call sites directly: `content.ts` (TOPIC-002, a grep hit via `topics.ts`'s import list is not the site — corrected: the helper's own header names its two callers as `topics.ts`'s TOPIC-004 and `content.ts`'s TOPIC-002) and `topics.ts:344` (TOPIC-004). Both callers are confirmed live.
- The `409`-vs-`403` lock-folding correction: I checked `REST API Contract.md:843-848` directly. The `403` row reads "Not a facilitator, is a team member, customization lock active" — this is word-for-word the pre-correction TOPIC-003/004 text `remove-topic/design.md` Decision 4 documents correcting. The pattern match is exact, not approximate.

**My read, same as the notes':** this is close to a foregone conclusion, and I'd go one step further than "close" — given (a) the shared helper already has exactly two callers and is documented as intended for reuse, (b) the identical bug shape was independently caught and fixed twice already in the sibling change (TOPIC-003 and TOPIC-004), and (c) no design decision anywhere states a reason TOPIC-005 should differ, I don't think design.md needs to re-litigate whether to make this correction — only state it, cite the precedent, and move on, exactly as the notes recommend in their closing "Open questions" §1. This does not need to stay "open" through design; it can be stated as settled with citation, the same way `remove-topic/design.md` treated TOPIC-002's contradiction once verified (that design's own explore-review-ba.md set this precedent: verify the claim, then state it as settled, not reopen it as a live question).

**One gap the notes don't flag and I want on record:** the use case document's own Acceptance Criteria (`08 - Topic Management - Use Cases.md:413-420`) don't mention authorization at all — no criterion says who is allowed to restore. That's consistent with the sibling "Remove a Topic" use case, which also doesn't state authorization in its ACs (it's a contract-level concern, not a use-case-level one), so I'm not flagging this as a defect in the use case doc. But design.md should still state explicitly, the way `remove-topic/design.md` Decision 2 did for TOPIC-004, the full check-ordering cascade for TOPIC-005 (identity/role → team existence → lock → topic existence → already-active → append-position write), not just the identity/role fix in isolation. The notes' §6 lists this as a bullet ("check-ordering cascade... applies identically here") but doesn't spell out the six-step sequence the way the sibling design did. I'd want that written out as its own decision, not left as "applies identically" — a future reader shouldn't have to go derive TOPIC-005's cascade from TOPIC-004's by analogy when it's cheap to just state it.

---

## 2. Provenance question (§4) — correctly left open, but the notes missed a real discrepancy inside the draft contract that narrows what's actually undecided

The notes frame this as one open question: "does a restored topic get `restored_by`/`restored_at`, and does restoring clear or preserve `archived_at`/`archived_by`?" I went back to the contract text itself rather than the notes' paraphrase of it, and found something the notes state incorrectly.

**The notes say (§4, closing paragraph):** *"the contract as drafted (`RestoreTopicResponse` has no `archivedAt`/`archivedBy` handling mentioned at all)"* — true, but incomplete. I read the full `RestoreTopicResponse` interface at `REST API Contract.md:831-839`:

```typescript
interface RestoreTopicResponse {
  topicId: string;
  name: string;
  status: 'active';
  displayOrder: number;    // New position: max(current) + 1
  restoredAt: string;
}
```

**`restoredAt` is already in the drafted response.** The notes' own open-question list (§4, and again in the closing "Open questions" §2) frames "does a restored topic get `restored_by`/`restored_at`" as a fully open pair, when in fact half of it — `restoredAt` — is already a drafted, reviewed-adjacent field sitting in the contract right next to `displayOrder`'s already-settled append behavior. There is no equivalent `restoredBy` field anywhere in the draft. This matters for scoping the decision correctly: **the real open question is narrower than the notes state it.** It is not "should restore get timestamp-and-actor provenance at all" (the timestamp half is already there, undrafted-but-present); it is "should `restoredBy` be added to match `restoredAt`, and should a persisted `restored_by` column back it, or is `restoredAt` alone (with no actor identity) the intended final shape." I checked whether `restoredAt` could be served from `updated_at` instead of a new column — `topics` already has `updated_at` (`2_create_tables.sql`), and a restore's `UPDATE` would touch it regardless of whether a dedicated `restored_at` column is added. Design.md needs to decide whether `restoredAt` in the response is backed by a new dedicated column (matching the `archived_at`/`archived_by` precedent exactly) or by the existing `updated_at` (cheaper, but loses the distinction between "restored" and "any other future field-level edit," if this topics row is ever edited by some other endpoint later).

**Is there enough context to resolve the rest as a clean proposal-stage decision, or does it need to stay open through design?** I checked `requirements/entities-and-relationships.md` directly for anything governing this — there is nothing. The Topic entity section (`entities-and-relationships.md:27-63`) documents the topic/session/vote/prompt relationship shape but says nothing about archive or restore provenance; this is expected, since that document predates both the archive and restore features. I also checked `remove-topic/design.md` Decision 6 for a stated principle that would transfer cleanly — it doesn't fully transfer. Decision 6's reasoning for `archived_by` turns on two facts specific to archiving: (a) Priya Nair's facilitator review found a concrete continuity gap ("the topic is just gone, ask around" — a standing facilitator inheriting a team with no handoff), and (b) the audit log is the wrong architectural boundary for a product-facing read path. Fact (b) transfers directly to restore with no changes needed. Fact (a) does not automatically transfer — "who removed this and why is it gone" is a higher-stakes continuity question for an inheriting facilitator than "who brought this back," because the former explains an absence that might otherwise look like a bug, while the latter explains a presence that needs no explanation to use correctly. I don't think this difference defeats the notes' lean (ship it), but it does mean the notes' one-line "identical continuity question, just pointed at the opposite transition" (§4, opening) overstates the symmetry. **My recommendation: this can be resolved at design stage, not left open through implementation** — there's enough precedent (Decision 6's architectural-boundary reasoning) to make the column-vs-audit-log call now, but design.md should state the asymmetry above explicitly rather than import Decision 6's facilitator-review citation as if it applies with equal force, since that citation was never independently tested against restore.

**The `archived_at`/`archived_by` clear-or-preserve sub-question:** the notes correctly identify this as a real decision with two defensible answers and correctly don't resolve it themselves. I have nothing to add that changes its status — it should go to design.md as a named decision, as the notes recommend. One acceptance-condition precision worth adding now: whichever way it's decided, the use case's Postcondition ("the topic is active again... its historical vote data... is accessible") doesn't depend on the answer either way, so this decision has no use-case-level acceptance criterion riding on it — it only affects the shape of `GET .../topics/all`'s `active[]` array and re-archive provenance cleanliness (the notes' own framing). That's worth stating in design.md so nobody mistakes it for blocking the use case's core ACs.

---

## 3. Concurrency / advisory-lock reuse (§3) — specific enough to be an acceptance condition as written

I checked this against the actual code rather than the notes' description of it. `packages/backend/src/routes/topics.ts:473` and `:617` both call `pg_advisory_xact_lock(hashtext($1::text))` with `teamId` as the argument — two existing, live call sites, confirmed. `remove-topic/design.md` Decision 3's SQL block (last-active-topic guard) and the sibling design's Decision 10 (originally for `POST /topics`'s `displayOrder` race) both use the identical pattern, and Decision 3's "Alternatives considered" explicitly rejects `SELECT ... FOR UPDATE` for an MVCC reason that applies without modification to a third endpoint computing `max(display_order) + 1` under concurrent writers.

The notes' phrasing — *"TOPIC-005's status-flip-plus-reposition happens inside a transaction guarded by the same `pg_advisory_xact_lock(hashtext(teamId))`"* — is already at the level of specificity `remove-topic/design.md` Decision 3 stated its own SQL block at. I'd only ask design.md to do what Decision 3 did and write out the actual statement sequence (lock → recompute `max(display_order)` → `UPDATE ... SET status = 'active', display_order = ?` → commit), the same concrete form the sibling decisions use, rather than leave it as prose description. That's a presentation note, not a gap in the finding — the finding itself is correctly scoped and needs no further precision to be buildable.

One thing worth naming as a stated decision rather than assumed: TOPIC-005's advisory lock and TOPIC-004's last-active-topic-guard lock both key on `hashtext(teamId)` — the same lock namespace. Two concurrent requests against the same team (one archive, one restore, or two restores) will serialize against each other by design, which is the correct and intended behavior (both mutate the same team's `display_order`/`status` state), but it's worth one sentence in design.md confirming this is intentional cross-endpoint serialization, not an accidental side effect of reusing a hash — a future reader debugging a slow request under load should be able to find that explanation without re-deriving it.

---

## 4. Trend-gap and next-session verifiability (§2) — confirmed correct, nothing to add

I independently traced `em-views.ts`'s TREND-001 grouping logic and confirm the notes' claim: it groups by `st.topic_id` from `session_topics`, unfiltered by `topics.status`, so a restored topic's pre-archive and post-restore sessions correctly group under one trend entry with no code change needed. The `session_topics`-population gap (issue #175) is accurately characterized as inherited, not introduced, and not blocking this change. No corrections needed here.

---

## 5. Confirmation UX (§5) — reasonable default, matches established pattern, no objection

Confirmed `TopicManagementPage.tsx`'s `RemoveTopicState` discriminated-union pattern is real (`:24` onward) and that no shared `Modal`/`ConfirmDialog` component exists elsewhere in `packages/frontend/src/components`. The proposed copy ("Restore '{topic name}' for {team name}?...") correctly carries forward the "name both the topic and team" requirement from Priya's prior review. This is precise enough to carry forward as a stated decision, matching the use case's own Main Flow step 5 wording. No rewrite needed.

---

## Summary: what needs to change before this becomes a proposal

**Blocking (needed before design.md can proceed on firm ground):** none. Unlike the sibling change's exploration (which had a real contradiction needing independent verification before a proposal could assert it as fact), this exploration's central claim is already verified above and holds up as stated.

**Needed for buildability, not blocking scope:**
1. Write out TOPIC-005's full six-step check-ordering cascade explicitly in design.md (§1, above), not just "applies identically" to TOPIC-004's.
2. Correct the provenance framing (§2, above): the real open question is `restoredBy` (and whether it's backed by a new column vs. `updated_at`), not a fully-open `restoredBy`/`restoredAt` pair — `restoredAt` is already drafted. State the `archived_at`/`archived_by` clear-or-preserve question as a named design.md decision with no use-case-level AC depending on either answer.
3. State the advisory-lock statement sequence concretely (lock → recompute `max` → `UPDATE` → commit), matching Decision 3's presentation, and add one sentence confirming that TOPIC-004/TOPIC-005 sharing a lock namespace per team is intentional cross-endpoint serialization.

**Already precise enough to carry forward as-is:**
- Authorization correction and its citation to `remove-topic/design.md` Decision 1 (§1).
- Trend-gap and next-session verifiability findings (§4 of this review).
- Confirmation UX copy and pattern (§5 of this review).
- Reuse of error envelope, timing floor, and audit posture conventions (notes' §6) — I have nothing to add beyond what the notes already state.

None of this touches ritual-integrity properties — I agree with the notes' §7 conclusion and Devon's standing concern about scope creep (no bulk-restore, no history timeline, one button and one dialog). This is a smaller, more mechanical change than its sibling, and the exploration correctly treats it that way. My additions here are narrow: tighten one citation, correct one factual overstatement about what's already drafted, and make sure the cascade and lock statements are written out concretely enough that an engineer doesn't have to reconstruct them from the sibling design by analogy alone.
