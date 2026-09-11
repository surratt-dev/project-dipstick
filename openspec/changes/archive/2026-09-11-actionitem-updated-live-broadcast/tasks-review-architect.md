# Task Ordering Review — `actionitem-updated-live-broadcast`

**Reviewer:** Ingrid Sollenberger, Solution Architect
**Scope:** `tasks.md`, reviewed purely for architectural-dependency ordering — does each task have everything it references already built by an earlier task? — separate from the design-incorporation content pass (design.md, spec deltas) done earlier in this same session. Cross-checked against `design.md` and `proposal.md`.

## Bottom line

The macro grouping (1 → 2 → 3 → 4 → 5 → 6) is sound and the D10–D14 additions were, for the most part, slotted correctly relative to what they depend on. But I found one **forward-reference ordering bug that produces an actual correctness bug**, not just an awkward read order (Finding 1 — this is the one worth blocking on), one **missing anchor task** that several later tasks silently assume exists (Finding 2), and two smaller sequencing notes (Findings 3–4). Findings 1 and 2 should be fixed in tasks.md before implementation starts; 3–4 are minor.

---

## Finding 1 (blocking) — Task 3.1b forward-references task 3.3's facilitator check, and the resulting classification is actually wrong for a real, load-bearing scenario in this application

**Where:** 3.1a → 3.1b → 3.2 → 3.3, in that numeric order.

3.1b's anti-enumeration classification (Decision D12) reads:

> "evaluate the caller's relationship to `team_id`: owner (...), authorized facilitator (**3.3**/D10), or plain team member (...). If **none** hold ... return `404`."

3.1b is task-numbered *before* 3.3, but it depends on 3.3's output to do its own job — it cannot classify "authorized facilitator" without already running the query 3.3 defines. That's a plain forward reference, and on its own it would just be an annoyance for whoever implements this in task order. But it's worse than a cosmetic ordering problem, because of what "facilitator" means in this application:

This codebase's own facilitator model is explicitly **not** team-membership-based. `evaluateTeamAccess`'s Path 3 (the read-access precedent) keys purely off `sessions.facilitator_id = userId AND sessions.team_id = teamId` — no `team_memberships` row required — and this design's own Context section names "facilitator-from-another-team" as one of the five load-bearing ritual constraints of the application (`design.md:7`, `exploration-notes.md:22,184`). A facilitator routinely has **no** `team_memberships` row for the team they facilitate. That's not an edge case here — it's the normal case for the facilitator role.

Follow the consequence through: a facilitator whose only relationship to a team is a `draft` session (24h grace) or a `complete` session (`facilitator_access_expires_at` grace) — the exact scenario Decision D10 deliberately excludes from write authorization — fails 3.3's narrowed check (correctly, per D10). Per 3.1b's three-way test as currently written (owner / 3.3-authorized-facilitator / plain team member), this caller is **also not a plain team member** (facilitators aren't team members of the teams they facilitate). So 3.1b's own logic, followed literally, classifies them as having **zero relationship to the team** and returns **`404`**.

But task **6.1a**, which I wrote in the same pass, states the opposite expectation: *"a facilitator whose only relationship to the team is a `draft` session ... or a `complete` session ... is rejected with `403`."* That's a direct contradiction between two tasks I authored together, and it's a consequence of 3.1b's dependency on 3.3 not being resolved before 3.1b's own classification logic was written.

**Which one is actually correct?** I believe `403` (6.1a's expectation) is the right answer, not `404` — but 3.1b's classification needs to be broadened to get there correctly, not just reordered. The reasoning: `evaluateTeamAccess`'s grace windows exist precisely so a facilitator in this draft/complete-grace state can *read* that team's content (session history, and by extension its action items) via other endpoints. They already have legitimate knowledge that the item exists. Denying them with `404` on this endpoint would be inconsistent with what they can already see elsewhere, and it doesn't protect anything — the anti-enumeration property D12 exists to protect (Tomás Ferreira's F2) is about hiding existence from a caller with **no** legitimate standing on the team at all, not about hiding it from someone who already has standing but not write authority.

**Fix (do before implementation, not after):**
1. Reorder so the facilitator-check query (currently 3.3) is *defined* before 3.1b consumes it — either move 3.3 ahead of 3.1b, or merge them: 3.1b should directly contain the SQL D10 already specifies, not a forward pointer to a later task.
2. Broaden 3.1b's "relationship" test so it doesn't reuse D10's *narrow* write-authorization query as the *only* facilitator-relationship signal. The 404-vs-403 boundary should track the same boundary that already discloses existence via read access (i.e., "does `sessions.facilitator_id = userId AND sessions.team_id = teamId` hold for **any** status, or does `evaluateTeamAccess` return a non-null grant" — not restricted to D10's `lobby`/`pre_session`/`active`/`wrap_up` set). D10's narrow query stays exactly as designed for the *actual write-authorization gate* (3.3/3.2) — this is two different boundaries doing two different jobs, and 3.1b's task text currently conflates them by citing "3.3/D10" as if one query answers both questions.
3. Update 3.2's phrasing, which currently assumes a caller who reaches it is "an ordinary team member" — that's no longer accurate once 3.1b's relationship test is broadened to include facilitators-outside-the-narrow-window.

This is a genuine content bug, not just a style nit on task order — I'm flagging it here rather than silently fixing it because it changes what 3.1b/3.2/6.1b's tests need to assert, and the team lead should see the reasoning, not just an edited checkbox.

---

## Finding 2 (should fix) — No task explicitly owns "begin the transaction / perform the `action_items.status` UPDATE"; 3.7, 3.9, and 4.2 all reference it as if it already exists

**Where:** 3.4–3.9, 4.2.

Tasks 3.7 ("in the same transaction as the `action_items.status` update"), 3.9 ("in the same transaction as 3.7's insert and the `action_items.status` update"), and 4.2 ("after the transaction commits") all refer to *the transaction* and *the status update* as an established fact. No task in Group 3 actually says "begin a transaction; execute the `action_items.status` UPDATE" as its own line item — it's implied to be folded into 3.4/3.5/3.6 collectively, but none of those tasks say so explicitly either; 3.4–3.6 are phrased as validation/business-rule tasks ("implement transition-validity checks," "implement same-status no-op handling," "implement `resolutionNote` handling"), not as the write itself.

This was already a latent gap in the pre-existing Group 3 (3.7 referenced "the same transaction" before my pass too), but it's more load-bearing now: 3.9 is new, and it's exactly the shape of problem the team lead's example called out — *"the audit_log write task before the transaction wrapper it needs to sit inside."* Right now there is no transaction-wrapper task for 3.9 (or 3.7) to point to; both point at each other and at an implicit write that has no task number.

**Fix:** add an explicit anchor task, e.g. **3.3a — "Open a database transaction; execute the `action_items.status` UPDATE (only after 3.2/3.3 authorization and 3.4 transition-validity checks pass)"** — positioned after 3.4 (needs the validated target status) and before 3.5–3.9 (all of which write inside it or reference its commit). Then reword 3.7/3.9 to reference that task number instead of prose ("the action_items.status update"), and reword 4.2 to reference its commit point the same way. This makes the transaction boundary a real, checkable task instead of an assumption three other tasks share informally.

---

## Finding 3 (minor) — 3.8 is a test, filed under the implementation group

**Where:** 3.8, "Confirm no Application Administrator bypass exists ... explicit negative test, not just absence of a code path."

This predates my pass (I didn't touch 3.8's position), but since I was asked to look at ordering with fresh eyes: 3.8 is explicitly a *test* ("explicit negative test"), sitting in Group 3 (backend implementation) rather than Group 6 (Tests) alongside 6.1's own Admin-bypass-absent reference (6.1 already says "Admin-bypass-absent (3.8)" — cross-referencing into Group 3 for a test task). Not a dependency violation — nothing later depends on 3.8 specifically being done at that position — but it's an inconsistent group boundary worth tidying while the file is open: either move 3.8 into Group 6 (e.g., as 6.1c) or accept the cross-reference as intentional and leave a note. Low stakes; flagging for completeness, not blocking.

---

## Finding 4 (minor) — 3.6a's position is defensible but slightly buries an authorization-adjacent check among resolution-note tasks

**Where:** 3.6a, sandwiched between 3.6 (`resolutionNote` handling) and 3.7 (history write).

3.6a (the `sessionId` `422` validation, Decision D11) has no real dependency on 3.6 — it validates an independent request-body field, not something resolution-note-related. It's positioned there because 3.7 needs its resolved `session_id` value, which is a legitimate reason to place it right before 3.7. But conceptually it reads more naturally as a request-validation step that belongs earlier, near 3.1a/3.1b (both are "figure out what we're dealing with before running business logic"). Not a hard dependency problem — nothing before 3.6a needs it, nothing quietly assumes it happened earlier than it does — so I'm not asking for a reorder, just noting it for whoever splits this into PRs: 3.6a can safely move earlier if it reads better there, since its only hard dependency is "before 3.7," not "after 3.6."

---

## What I checked and found correctly ordered

- **Group 2 before Groups 3/4**: shared types (`WsEventType`, `ActionItemStatusUpdatedPayload`, the envelope's `sessionStatus` field) are all defined before any task in Group 3 (route) or Group 4 (dispatcher) uses them. Correct — this is exactly the ordering the team lead's example ("tests for the dispatcher's `sessionStatus` envelope plumbing before that plumbing exists") was checking for, and it's right: 2.3 defines the envelope's `sessionStatus` field, 4.1 stamps it, 4.3 reads it, 6.4a tests it — that chain is in the right order end to end.
- **Group 3 before Group 4**: 4.1's publish wrapper correctly comes after 3.6a (the session-status value it stamps onto the envelope) is validated; 4.2's "wire the publish call into the mutation handler (3.x)" correctly follows all of Group 3.
- **Group 3 before Group 6 (mutation tests)**: 6.1a (D10 regression test), 6.1b (anti-enumeration tests — see Finding 1 above for a content issue, but the *group placement* is right), 6.2a (audit_log test) all correctly sit in Group 6, after the Group 3 tasks they exercise.
- **Group 4 before Group 6 (dispatcher tests)**: 6.4a correctly follows 4.1/4.3.
- **3.9 (audit_log) correctly follows everything it needs**: `authorization_path` (from 3.2/3.3), `previous_status`/`new_status` (from 3.4), `session_id` (from 3.6a), and the history insert it's transactionally paired with (3.7) — all precede 3.9 in the list, independent of Finding 2's "no explicit transaction task" gap.
- **Group 1 gating everything**: all six architect sign-off items (including the three I added, 1.4–1.6) correctly precede any implementation task, and nothing in Groups 2–6 is left referencing an *unresolved* open question — every "per 1.1," "per D10," etc. cross-reference points at something Group 1 already closed.
- **5.1's fix** (rename, not just flip, the Event Registry row) doesn't introduce an ordering problem — 6.5's "confirm conformance test passes once 2.x and 5.1 land together" already correctly frames these as needing to land in the same PR rather than in a strict sequence, which is the right framing since neither task technically depends on code the other produces, only on both being merged together.

## Recommended action

Fix Finding 1 before implementation begins — it's not just a reorder, it changes what 3.1b/3.2/6.1b should actually assert, and 6.1a's test as currently worded will fail against 3.1b's own logic as currently worded. Fix Finding 2 at the same time since it's a quick addition (one new task, two reworded references) and closes the same category of gap the team lead flagged by example. Findings 3–4 can be picked up whenever tasks.md is next touched; neither blocks correctness.
