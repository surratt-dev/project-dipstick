# Exploration Notes: Re-Add a Previously Removed Topic (issue #54)

**Author:** Devon Calloway, Internal Champion (Subject Matter Expert) — exploring, not designing. These are the things the design doc needs to take a position on, and the reasons I'd push back if it didn't.

**Revision note:** Updated after Priya Nair's facilitator review and Marcus Delgado's BA review (`explore-review-facilitator.md`, `explore-review-ba.md`). Both reviewers converged independently on two points I'm treating as settled corrections, not just suggestions: the trend-gap answer in §2 needed a concrete in-scope signal, not a deferral, and provenance parity (§4) needed a stated recommendation rather than an open lean. I've also written out the full check-ordering cascade (§1) and the advisory-lock SQL sequence (§3) explicitly, per the BA's "buildable, not just correct" standard. Where I pushed back rather than adopted feedback wholesale, I've said so and why — see §2's audience correction.

---

## 0. What already exists — ground truth before opinions

Confirmed by reading the code and the already-shipped `remove-topic` design, not assumed:

- **TOPIC-005 (Restore Archived Topic) is already fully drafted** in `requirements/design/REST API Contract.md:806-853`, sitting right next to the now-shipped TOPIC-004 (Archive). This is not a blank page, same situation `remove-topic`'s own exploration notes found for TOPIC-004. The draft already answers both of the use case's own "Notes" open questions — see §2, below — they are not actually open.
- **The Topic Management screen already exists** (`packages/frontend/src/pages/TopicManagementPage.tsx`, shipped by `remove-topic`) and already renders an archived-topics section with per-row provenance (`archivedAt`/`archivedBy`). This issue extends that existing section with a restore action; it does not need to build a new screen or a new archived-list view from scratch.
- **The data model already supports this as a same-row status flip**, not a new record: `topics.status` is a two-value enum (`active`/`archived` — `packages/backend/migrations/1_create_enums.sql:34-37`), and archiving (TOPIC-004) only ever sets `status`, `archived_at`, `archived_by` — it never touches `name`, `prompt`, `vote_type`, `first_session_description`, or the team annotation. Restoring the same row is what naturally satisfies the use case's own "Out of Scope: merging data from two separate topic records — re-adding restores the original topic, not a duplicate."
- **`packages/shared/src/types/topic.ts` has no `RestoreTopicResponse` or restore-related types yet** — TOPIC-005's response shape needs to be added there, matching the drafted contract.
- The EM-facing trend view (`packages/frontend/src/pages/EmTrendDataPage.tsx`, `em-views.ts` TREND-001/002) renders as **a list of per-session data points, not a line/graph**. This matters directly for the use case's §2 "gap" question below — there is no line to break yet.
- **Correction on re-review:** that EM trend view is the *only* trend view that exists anywhere in this codebase, and it is EM-only — `em-views.ts:498` returns `403` unless `grant.role === "engineering_manager"`. Facilitators have no access to it at all. This matters for §2: the REST API Contract's own TREND-001/TREND-002 (`REST API Contract.md:2417-2546`) draft a *different*, unbuilt, three-audience endpoint (`GET /api/v1/teams/:teamId/trends`, open to participant/EM/facilitator) that already includes a `hadGap: boolean` / `score: null` placeholder per absent session — exactly the machinery that would answer the gap question for free. What shipped instead, under the same TREND-001/002 label but from a different change (`establish-manager-team-relationship`), is a narrower EM-only endpoint (`GET /api/v1/teams/:teamId/em/trends`) with a simpler shape (`EmTopicSessionDataPoint` in `packages/shared/src/types/em-views.ts:80-87`) that has no `hadGap` field and no placeholder rows for absent sessions — gaps today are pure absence from the array. This is a pre-existing drift between the contract and what was built, not something introduced by this issue, and not something I'm proposing to fix here. I'm flagging it because it changes who §2's answer actually serves — see §2.
- **Already resolved, not actually open:** `TopicManagementPage.tsx:393-395` already renders an explicit empty state for the archived-topics section — `<p data-testid="archived-topics-empty">No archived topics.</p>` — when `data.archived.length === 0`. The section itself is never conditionally hidden; only its expand/collapse toggle controls visibility of the list underneath. This already satisfies the Alternate Flow's "is not shown, or the empty state is communicated clearly" with the second option. Confirmed by reading the component, not assumed.
- **Also confirmed, not assumed:** `defaultTopicsNotActive` (`TOPIC-002`'s response, `REST API Contract.md:648-652`) — the array that would enumerate default topics never added to a team — is drafted in the contract but **not consumed anywhere in `TopicManagementPage.tsx` today**; grep confirms no reference to it or to `isArchived`. The only "removed"-flavored list rendered on this screen is `data.archived`, which is backed exclusively by `topics.status = 'archived'` rows — topics that were, by construction, once active for this team. There is no second, competing "never added" list on screen today for a facilitator to confuse it with.

---

## 1. The blocking finding: TOPIC-005's authorization line, as drafted, repeats a mistake already caught and fixed for TOPIC-004

`REST API Contract.md:818` states TOPIC-005's authorization as:

> `global_role = 'facilitator'` AND not a member of this team AND `isCustomizationLocked = false`.

This is **exactly** the shape `remove-topic/design.md` Decision 1 found and corrected for TOPIC-004: no `application_admin` branch at all. That correction wasn't cosmetic — Marcus Delgado's BA review on that change called it a BLOCKING finding against FR-8.2 `[HARD]` ("the facilitator or Application Administrator shall be able to add, remove, or reorder topics"), and it shipped as a concrete, reachable UX bug risk: an admin who can see the archived-topics list (TOPIC-002, already widened to admit `application_admin`) sees a "Restore" affordance render, then gets a confusing `403` on click.

TOPIC-005 is the mirror image of TOPIC-004 in every way that matters here — same team, same topic, same caller population, opposite status transition. There is no principled reason for it to have a narrower authorization model than its sibling. The fix already exists and doesn't need to be re-derived: `remove-topic` built a **decision-only, shared** function for exactly this, `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` in `packages/backend/src/auth/standing-facilitator-access-helper.ts`. TOPIC-004 and TOPIC-002 both already call it. TOPIC-005 should be the third caller, not a fourth, slightly-different hand-rolled check.

Also folded into the same line as drafted: `isCustomizationLocked = false` is a **state precondition**, not an actor-identity/role fact — bundling it into the authorization line is the identical mistake the sibling design's Decision 2/4 corrected for TOPIC-003/004 (lock belongs in the `409` branch of the cascade, evaluated after team existence, not as part of the `403` check). TOPIC-005's error table (`:843-848`) shows the same symptom: `403 Forbidden` row reads "Not a facilitator, is a team member, customization lock active" — the exact folded-together wording that had to be corrected on TOPIC-003 and TOPIC-004's tables before this. This is not a new judgment call; it's applying an already-settled correction to a fourth table that happens to have been drafted before the correction was made.

**My read:** design.md should state this as "TOPIC-005 gets the same Decision-1/Decision-4-shaped correction TOPIC-004 already got, for the same reason, reusing the same shared function" — not rediscover the reasoning from scratch. This is the single most important thing carried into the design phase from this exploration.

**The full check-ordering cascade, written out** (Marcus's review, §1: don't leave this as "applies identically to TOPIC-004" by analogy — state it). Same reasoning TOPIC-004 used for ordering existence before status:

1. `403 Forbidden` — identity/role, via `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` (the corrected function, not a hand-rolled check)
2. `404 TEAM_NOT_FOUND` — team existence
3. `409 TOPIC_CUSTOMIZATION_LOCKED` — lock is a state precondition, evaluated after identity/role and team existence, not folded into `403`
4. `404 TOPIC_NOT_FOUND` — topic exists and belongs to this team
5. `422 TOPIC_ALREADY_ACTIVE` — topic is not already active (the contract's `:848` row needs this error code name; `TOPIC_ALREADY_ARCHIVED` is TOPIC-004's mirror, so `TOPIC_ALREADY_ACTIVE` is the natural pair)
6. Advisory-lock-guarded reposition + status flip (§3) → `200`

---

## 2. The use case's two "open questions" are already answered by the drafted contract — confirm, don't relitigate

**Post-design update — the trend-gap portion of this section was split out, after executive review, not built in this change.** Everything below in this section reflects the reasoning worked out during exploration and design, and is preserved for traceability into the follow-up change — but per Rachel Okonkwo's executive review of the resulting proposal, and Devon Calloway's acceptance of that review's recommendation, the trend-gap signal (the second bullet below, and what became design.md's former Decision 6) is **not** part of what this change ships. The position/ordering answer (the first bullet) is unaffected and ships as designed. See `proposal.md`'s "Scope Decision" section for the full rationale: the use case's own Notes call for the gap treatment to be designed jointly with Trend Dashboard ownership, restore has no dependency on the signal shipping simultaneously, and the signal can't be demonstrated end-to-end today regardless (#175). A new GitHub issue is recommended (not filed by this pass) to carry this section's derivation and response-shape work forward into that follow-up change.

The use case document's own Notes (`08 - Topic Management - Use Cases.md:430-432`) flag two things as open. Both already have answers on record:

**Position: append to the end, not restore to prior slot.** TOPIC-005's draft cites *"The prior `displayOrder` position is not restored; the topic is appended (FR-8.6, UC: Re-Add a Previously Removed Topic)"* — **that FR-8.6 citation is wrong, caught by Marcus Delgado's BA review of the resulting proposal** (`propose-review-ba.md` Finding 1): FR-8.6 (`BRD.md:331`) is about the canonical default topic set remaining restorable, not about ordering semantics, and the citation error originates in the contract itself, pre-existing this change. The append decision doesn't need that citation to stand — it's simpler and safer mechanically — `topics_team_order UNIQUE (team_id, display_order, status)` scopes the uniqueness constraint by status, which is *why* archiving a topic never had to renumber or clear the remaining active topics' `display_order` values (confirmed by reading TOPIC-004's `UPDATE` in `remove-topic/design.md` Decision 3 — it only sets `status`/`archived_at`/`archived_by`). That means the archived row's *own* `display_order` value is still sitting there, technically recoverable — but restoring to that exact slot would require deciding what happens if an active topic has since taken it (via `POST /topics`, which also appends at `max + 1` per the sibling design's Decision 10), and that's exactly the kind of edge-case machinery "append to the end" avoids needing at all. I'd treat the contract's answer as settled, not reopen it — the only reason to revisit it would be a facilitator complaint that appending is disorienting, and nothing in the requirements suggests that's happened.

**Revised after Priya's review — she's right, and I'm changing the answer, not just the framing.** My original read was that because `EmTrendDataPage.tsx` renders a list of per-session data points rather than a line chart, "no interpolation" was automatically satisfied by the absence of rows, and there was nothing left to build. Priya's pushback is correct: the acceptance criterion isn't asking for "doesn't interpolate," it's asking for a reader to be able to tell "this topic was intentionally removed for these sessions" apart from any other reason a session's data point might be missing. A silent jump from `#4` to `#7` doesn't carry that distinction — it reads identically whether the cause was an archive, a skipped topic, or a data problem. I was answering the letter of the AC, not what it's protecting. I'm adopting her ask: an inline signal, in-scope for this issue, not deferred to a future chart redesign.

**One correction to how the ask gets scoped, though — the audience.** Priya frames this as "a facilitator reconstructing a team's history." As confirmed in §0, the only trend view that exists today is EM-only — facilitators cannot reach it at all, by design (`em-views.ts:498`). The underlying concern still holds with equal force for an EM inheriting a team without a handoff conversation, which is the actual population this view serves — so I'm not narrowing the fix, just correcting who it's for. If a facilitator-facing trend surface is ever built (the contract's unbuilt three-audience TREND-001 in §0 is the natural vehicle), the same signal should carry over to it.

**Concrete, in-scope answer:** derive gaps from `session_topics` absence directly — the same ground truth the contract note already cites — rather than from `archived_at`/`restored_at` timestamps. For a given topic, take the team's completed session numbers already present in `dataPoints` (`em-views.ts:591` onward); any integer session number between the observed min and max that has no corresponding `session_topics` row for that topic is a gap. This works for any number of archive/restore cycles without needing a full history table — it only needs point-in-time presence, which `session_topics` already gives us, unlike `archived_at`/`restored_by`, which (per §4) only ever record the *most recent* event.

Concretely, this means:
- `EmTopicSessionDataPoint` (`packages/shared/src/types/em-views.ts:80-87`) gains a synthetic gap-marker variant, or `EmTopicTrend` gains a sibling `gaps: Array<{ afterSessionNumber: number; beforeSessionNumber: number }>` array — either shape is buildable; design.md should pick one, not invent a third.
- `EmTrendDataPage.tsx`'s `topic.sessions.map(...)` (`:98-119`) renders one additional line between adjacent real data points when a gap is present, something as plain as *"Not tracked, sessions 5–6 (topic removed)"* — matching the plain, unadorned tone of the rest of that list, no new visual chrome.
- This only ever says "topic removed," never *why* — consistent with Priya's own acknowledged-limitation ask in her §1 (see below) and with my own standing position (§7) against adding a reason field.

This is a small, scoped addition to an endpoint and page this change already has to touch for the restore action itself — not a new screen, not a chart, not the Trend Dashboard redesign I was originally deferring to.

**One inherited caveat that affects testability, stated on the record rather than silently hit during implementation:** `remove-topic/design.md`'s Context section found that **no shipped endpoint anywhere in this codebase currently populates `session_topics` at session creation** — tracked as issue #175, explicitly not fixed by that change. This means, today, no session's topic snapshot exists at all, for any team, regardless of archive/restore state. It doesn't block building TOPIC-005 — the restore endpoint only touches `topics`, not `session_topics` — but it does mean the use case's acceptance criterion "after reinstatement, the topic appears in the active topic list and is included in the next session" can only be verified against the *topic list* (TOPIC-002's `active[]`) until #175 is resolved; "included in the next session" can't be demonstrated end-to-end in a running session yet. Worth a one-line note in design.md so nobody burns time trying to manually reproduce the next-session behavior and concluding this change is broken when the actual gap is upstream and already tracked. The same caveat now also covers the gap-marker logic above: it can be built and unit-tested against synthetic `session_topics` rows, but can't be demonstrated end-to-end against a real session until #175 closes, since there are currently zero real `session_topics` rows to have a gap in.

---

## 3. A concurrency finding TOPIC-005 needs to inherit, not rediscover the hard way

TOPIC-005's response computes the new position as `max(current) + 1` (`RestoreTopicResponse.displayOrder` comment, `:836`). `POST /topics` (Add Custom Topic, already shipped) computes its append position the exact same way, and the sibling design's Decision 10 had to add `pg_advisory_xact_lock(hashtext(teamId))` specifically because two concurrent appends could both read the same `max` and collide against `topics_team_order`'s uniqueness constraint. TOPIC-004's last-active-topic guard reuses the identical lock for the same reason (`remove-topic/design.md` Decision 3).

TOPIC-005 has the same race shape: two concurrent restores against the same team (or a concurrent restore and a concurrent "Add Custom Topic," both appending) could both compute the same `max(display_order) + 1` and both try to write it. This isn't hypothetical scope creep on my part — it's the same lock this codebase already has a standing, proven pattern for, sitting one function away. Design.md should state that TOPIC-005's status-flip-plus-reposition happens inside a transaction guarded by the same `pg_advisory_xact_lock(hashtext(teamId))`, not leave this to be found during implementation review the way Decision 3 had to explicitly rule out `SELECT ... FOR UPDATE` as insufficient for the identical MVCC reason.

**The statement sequence, written out explicitly** (Marcus's review: match Decision 3's presentation, don't leave this as prose):

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext($teamId::text));

SELECT COALESCE(MAX(display_order), 0) + 1 AS new_position
  FROM topics
 WHERE team_id = $teamId AND status = 'active';

UPDATE topics
   SET status = 'active',
       display_order = $new_position,
       restored_at = now(),
       restored_by = $userId
       -- archived_at, archived_by intentionally left untouched — preserved, not
       -- cleared, per §4's recommendation
 WHERE id = $topicId AND team_id = $teamId;

COMMIT;
```

**One sentence worth stating explicitly in design.md, not left implicit:** TOPIC-004's last-active-topic guard and TOPIC-005's reposition lock both key on `hashtext(teamId)` — the same lock namespace, per team, shared across both endpoints (and `POST /topics`). A concurrent archive and restore against the same team will serialize against each other. That's intentional cross-endpoint serialization, not an accidental side effect of reusing a hash function — both operations mutate the same team's `status`/`display_order` state, and a future reader debugging a slow request under load shouldn't have to re-derive that this is by design.

---

## 4. Provenance parity: "who restored this and when" deserves the same treatment "who archived this" got

`remove-topic/design.md` Decision 6 added a first-class `archived_by` column specifically because Priya Nair's facilitator review found that an audit-log-only answer to "who did this and when" doesn't serve a facilitator who inherits a team without a handoff conversation — she needs it on the screen she's already looking at, not in a system she doesn't read. That reasoning transfers partway, not wholesale — see the asymmetry note below before assuming it's a clean 1:1 carryover.

**Corrected framing, from Marcus's review:** I'd originally characterized this as one open question ("does restore get `restored_by`/`restored_at`, and does restoring clear or preserve `archived_at`/`archived_by`"). That overstated how open it was — `restoredAt` is **already drafted** in `RestoreTopicResponse` (`REST API Contract.md:837`), sitting right next to `displayOrder`. There is no `restoredBy` anywhere in the draft. So the real open questions are narrower: (a) should `restoredBy` be added to match `restoredAt`, (b) is `restoredAt` backed by a dedicated column or served from the existing `updated_at`, and (c) does restoring clear or preserve `archived_at`/`archived_by`.

**The asymmetry, stated plainly (Marcus's review, and Priya's independently arrived at the same underlying point from the facilitator side):** Decision 6's case for `archived_by` rests on two facts — (a) the audit log is the wrong architectural boundary for a product-facing read, and (b) a facilitator inheriting a team needs to know *who removed this and why it's gone*, because an unexplained absence can look like a bug. Fact (a) transfers to restore without change. Fact (b) does not transfer at the same strength: a restored topic's *presence* on the active list needs no explanation to use correctly — nobody is confused by a topic that's there. The continuity value of `restoredBy`/`restoredAt` is real but genuinely weaker than `archived_by`'s was. I'm not letting that talk me out of it, for the reason below, but I'm not pretending the two cases are identical either.

**My recommendation, to carry forward as the default — final sign-off belongs to design stage, not here:**
- **Preserve `archived_at`/`archived_by` through restore; don't clear them.** Priya's reasoning is the one I'd use: a facilitator (or EM, per §2's audience correction) looking at the active list a week after a restore and wondering "didn't this used to be gone for a while?" gets an answer that's still sitting there, until the topic is archived again and the record updates to the new event. Clearing on restore throws away an answer for no benefit I can identify.
- **Add `restored_by` to match the already-drafted `restored_at`, both backed by dedicated columns** — not served from `updated_at`. `updated_at` would get cheaper reuse, but it collapses "this was restored" into "this row was touched by literally any future edit to any field," which defeats the point of having a provenance fact at all. This mirrors the `archived_at`/`archived_by` precedent exactly rather than introducing a second, cheaper pattern for the same kind of fact.
- I'm making this call despite the asymmetry above — not because the facilitator-continuity argument is as strong as it was for archive, but because the marginal cost is genuinely small (two more nullable columns on a table that already has the sibling pair, one join that's already being made) against a real, if smaller, continuity benefit. If design stage weighs the cost differently, that's a legitimate place to land somewhere else — I'm giving a default to carry forward, not foreclosing the decision.

One precision worth stating in design.md so nobody mistakes this for blocking: however it's decided, the use case's Postcondition ("the topic is active again... its historical vote data... is accessible") doesn't depend on the answer either way. This decision only affects `active[]`'s shape and re-archive provenance cleanliness — it has no use-case-level acceptance criterion riding on it.

---

## 5. Confirmation UX: reuse the shape already built for Remove, don't invent a second pattern

The use case's Main Flow step 5 wants a confirmation before restoring, noting that historical data will be restored and the gap will show in trend views. `TopicManagementPage.tsx` already has exactly this shape built for Remove — a `RemoveTopicState`-style discriminated union, one dialog, local component state, no shared `Modal`/`ConfirmDialog` component (there still isn't one anywhere in `packages/frontend/src/components`, confirmed by checking again for this issue). Restore's confirmation flow is materially simpler than Remove's (no open-action-item escalation branch, no last-active-topic hard block reachable from this direction — restoring only ever *increases* the active count, so Decision 3's guard from `remove-topic` doesn't interact with this endpoint at all) — it's a single-step confirm, not an escalating one.

The same "name both the topic and the team" requirement Priya's review established for Remove applies with equal force here — a facilitator managing several teams under the standing model is exactly as capable of restoring the right topic for the wrong team as archiving one. Copy should read something like *"Restore '{topic name}' for {team name}? Historical data will be restored, and the gap while it was removed will be visible in trend views."* — matching the use case's own Main Flow step 5 wording, and matching `RemoveTopicDialog`'s existing tone (plain, one line, no jargon).

**Acknowledged limitation, named rather than discovered as a surprise (Priya's review, §1):** this copy — and the provenance in §4 — answers *what will happen* and *who/when*, never *why* a topic was removed. Nothing in this feature, or in Remove as shipped, ever captured a reason. I'm not proposing a reason field; that's scope creep against a "keep it small" feature and nothing in the requirements asks for it. But a facilitator restoring a topic archived months ago by someone she's never worked with is still partly guessing at intent, and design.md should say so in one line rather than let it be assumed away.

**Also confirmed (Priya's review, §3):** whether the removed-topics list could be visually confused with "never added" defaults — see §0. The list this dialog operates on (`data.archived`) is structurally and visually distinct from `defaultTopicsNotActive`, and the latter isn't even rendered on this screen today, so there's no second list to confuse it with.

---

## 6. What this change should reuse verbatim — the discipline that matters most

Same instinct as `remove-topic`'s own exploration notes, pointed at this endpoint:

- **Check-ordering cascade**, following TOPIC-004's already-settled pattern and Decision 2's leak-prevention reasoning: `403` (identity/role, §1) → `404 TEAM_NOT_FOUND` → `409 TOPIC_CUSTOMIZATION_LOCKED` → `404 TOPIC_NOT_FOUND` → `422` (topic is already active — `:848` already drafts this) → advisory-lock-guarded reposition + status flip (§3) → `200`. Same reasoning TOPIC-004 used for ordering existence before status applies identically here.
- **Same shared authorization function** (§1) — no fourth hand-rolled check.
- **Same error envelope, same `applyTimingFloor` discipline on every branch** including the `200` success path — TOPIC-004's Decision 2 amendment was explicit that no branch is exempt, and there's no reason for TOPIC-005 to be the first endpoint in this family to skip it.
- **Same audit posture**: a lock-denial reuses `writeLockDenialAudit`/`topic.write_denied_locked`, no new per-endpoint variant (matching the established convention that this operation name is endpoint-agnostic). A successful restore should get its own audited event — `topic.restored`, mirroring `topic.archived` — for the same accountability reasoning Decision 7 gave: the standing, org-wide model means "who did this" isn't answerable without a row, and that already mattered enough to build for both add and archive.
- **Same advisory lock** for the append-position race (§3) — not a new pattern, the third use of one already-proven mechanism.

---

## 7. Ritual-integrity check — confirmed clean, stated for the record

Per what I actually lose sleep over: this feature touches only Facilitator-driven topic configuration, between sessions, on data that's already soft-deleted and already visible to the standing facilitator population. It does not touch simultaneous reveal, does not touch the no-manager-participation rule, and does not touch the facilitator-from-another-team constraint — no Engineer or Engineering Manager interaction exists anywhere in this flow, and nothing here is reachable from inside a live session. Confirmed clean, same conclusion `remove-topic`'s notes reached for archiving, for the identical reason.

My only standing concern, same one I raised for Remove: keep this small. The archived-topics section of `TopicManagementPage.tsx` already exists — this issue adds one button and one small confirmation dialog to it. It should not grow into a bulk-restore feature, a "topic history timeline," or anything resembling a second screen. A facilitator restoring a topic she decided the team needs back is light bookkeeping, not an event.

---

## Open questions I'd carry into design.md, explicitly, rather than let get re-derived later

1. **TOPIC-005's authorization correction** (§1) — adopt the shared `checkStandingFacilitatorOrAdminAuthorization` function and split the lock out of the `403` row into `409`, mirroring TOPIC-004's already-settled correction, with the full six-step cascade now written out. Marcus's review confirms this holds up as stated and doesn't need to stay open through design — state it as settled, with citation, not re-litigated.
2. **The trend-view gap signal** (§2) — **split out of this change after executive review; see §2's post-design update.** The derivation answer (from `session_topics` absence, not provenance timestamps) and response-shape options worked out here remain valid starting points for the follow-up change once it's scoped, but this change's design.md does not carry them as a decision, and this change's tasks.md/specs/ do not implement them.
3. **Provenance parity** (§4) — my recommendation, to carry forward as the default: preserve `archived_at`/`archived_by` through restore, add `restored_by` alongside the already-drafted `restored_at`, both backed by dedicated columns. Stated with reasoning and the asymmetry acknowledged, not a bare lean — but per Marcus's read, final sign-off on this one still belongs to design stage, since it's a real cost/benefit call and not a foregone conclusion the way #1 is.
4. **The advisory-lock reuse for the append-position race** (§3) — the statement sequence is now written out explicitly, matching Decision 3's presentation. Marcus's review confirms this is buildable as stated; the only remaining thing to state in design.md is the shared-lock-namespace note (also now written out in §3).
5. **Confirmation copy and pattern** (§5) — single-step, team-named, reusing `TopicManagementPage.tsx`'s existing local-state pattern. Low-risk, but the exact copy is worth a stated decision rather than left to whoever writes the component. The "why was this removed" limitation should be named in design.md as an acknowledged gap, not fixed here.
6. Whether `topic.restored` is the right audit event name, or whether the design prefers extending `topic.archived`'s existing shape with a `wasRestored` flag or similar — I lean toward a distinct event name (matches the `topic.custom_added`/`topic.archived` precedent of one event per meaningful transition), but this is a naming-convention call for whoever owns `audit-logger.ts`'s `AuditEventName` union.

Already checked and resolved, not carried forward as open: the removed-topics-list-vs-"never added" distinction (§0, §5) and the archived-topics section's empty state (§0) — both already correctly implemented, confirmed by reading the code rather than assumed.

None of these touch the properties I actually treat as non-negotiable. This is a small, mechanical extension of a pattern the previous change already proved out — the main risk isn't a new kind of mistake, it's *repeating* a mistake (§1, §3) that's already been found and fixed once in the sibling feature and shouldn't need to be found twice.
