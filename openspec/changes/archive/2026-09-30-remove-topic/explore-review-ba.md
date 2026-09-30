# BA Review: Exploration Notes — Remove a Topic (issue #51)

**Reviewer:** Marcus Delgado, Business Analyst
**Subject:** `openspec/changes/remove-topic/exploration-notes.md` (Devon Calloway)
**Verdict:** Mostly ready to carry into design.md. One finding needed independent verification before I'd let a proposal assert it as fact — I did that verification below, and it holds up, more strongly than the notes themselves argue. Two areas (open-action-item escalation, last-topic guard) have a real requirement underneath them but are missing the acceptance-condition precision I need before an engineer can build against them without a follow-up question. One new gap the notes didn't surface: the use case document itself has drifted from the shipped data model in a way that will confuse the next reader if design.md doesn't correct it explicitly.

I read the source documents directly, not just the notes' characterization of them: `REST API Contract.md` (TOPIC-001 through TOPIC-007 and Appendix B in full), the `Remove a Topic` and `Re-Add a Previously Removed Topic` use cases, the sibling `topic-customization-lock-and-add-custom-topic` design.md (all 13 decisions), `packages/backend/src/routes/topics.ts`, `facilitator-sessions.ts`'s session-start code, and the `session_topics`/`action_items` schema. Findings below are sourced to line numbers.

---

## 1. TOPIC-002 contradiction — verified, and the case for it is stronger than the notes make it

This is the item I was asked to scrutinize hardest, so I checked it against the primary source rather than taking the notes' word for it.

**The contradiction is real.** I read all six of TOPIC-002 through TOPIC-007's inline `Authorization` lines directly:

- TOPIC-002 (`REST API Contract.md:609`): `facilitator with an active session for the team, OR application_admin`
- TOPIC-003 (`:679`): `global_role = 'facilitator' AND the facilitator must not be a member of this team AND isCustomizationLocked must be false`
- TOPIC-004 (`:746`), TOPIC-005 (`:809`), TOPIC-006 (`:859`), TOPIC-007 (`:917`): identical wording to TOPIC-003, verbatim.

So it isn't "the matrix says one thing, the endpoint says another" as an isolated disagreement — it's **five consecutive sibling endpoints share one authorization model word-for-word, and TOPIC-002 alone, sitting in the middle of that block, uses a different one that matches TOPIC-001 instead.** That's a much stronger tell than the notes convey. The notes quote the matrix row and the TOPIC-002 text side by side, which makes it look like a two-way disagreement to resolve by picking a side. It's actually a one-of-six outlier inside a otherwise-uniform block, and the matrix's grouping (`TOPIC-002 to TOPIC-007`) is simply restating what TOPIC-003–007's own inline text already says. The question isn't "matrix vs. TOPIC-002," it's "does TOPIC-002 belong in this block or not" — and its own stated purpose ("used exclusively by the topic management/configuration screen," `:605`) says it does.

**Second check: was this a considered decision anyone already made, that a new change would be overriding?** I grepped the sibling design.md for `TOPIC-002` — zero matches. Decision 12 of that design (`:208–220`) is a real, deliberate, written decision to *not* widen a read endpoint's authorization to match a write endpoint's — but it is about **TOPIC-001** (`GET /api/v1/teams/:teamId/topics`, `content.ts`, `evaluateTeamAccess`), not TOPIC-002. The notes correctly keep these separate (§1, closing paragraph) — I want that distinction stated just as explicitly in design.md, because it's easy for a reader skimming Decision 12 to assume it already settled TOPIC-002 too. It didn't. TOPIC-002's contradiction has never been decided by anyone; it's an unresolved drafting error sitting in the original contract, not a position this change would be reversing.

**Third check, which the notes don't make and I think strengthens the recommendation further: implementation risk.** I grepped the backend for `topics/all` and `GetAllTopicsResponse` — neither exists yet. TOPIC-002 is greenfield. By contrast, `evaluateTeamAccess` (the helper TOPIC-001 actually uses) is called from `content.ts`, `action-items.ts`, `em-views.ts`, `websocket-routes.ts`, `ws-event-dispatcher.ts`, and `connection-reauthorization.ts` — exactly the "widening a shared helper touches everything" risk Decision 12 cites as its reason *not* to widen TOPIC-001. TOPIC-002 carries none of that risk: building it against `evaluateStandingFacilitatorAccess` (the helper TOPIC-003 already established and that TOPIC-004–007 will also use) isn't a wider, riskier version of an existing shared check — it's the same helper call the rest of this endpoint block already needs, used once more. Widening TOPIC-002 to match the matrix is actually the *less* work version, not a scope add.

**My conclusion:** the recommendation is adequately justified, but the exploration notes under-argue it — they present it as an appeal to the matrix's authority ("the matrix already licensed it"), when the stronger and more defensible case is the internal-consistency argument above. **I'd have design.md state the finding using the five-sibling-uniformity evidence and the "never decided, not overridden" fact, not just cite the matrix row.** That's the version of this argument that survives a skeptical engineer or a future reader asking "says who?"

**One thing the notes miss entirely and design.md must not:** if TOPIC-002's authorization is corrected, the endpoint's **error-response table text has to be corrected too**, not just the `Authorization` line. `REST API Contract.md:658` currently reads `403 Forbidden | Authenticated user is not a facilitator with an active session for this team, and is not an application_admin` — that sentence is written for the model being replaced. Left as-is, the contract would say two contradictory things about the same `403` in two consecutive subsections. This is a concrete, missable rewrite, not a nice-to-have — flagging it as a required acceptance condition below.

---

## 2. Open-action-item escalation — the mechanism is well-specified; the UX contract around it is not

The `200`/`requiresConfirmation`/`confirm=true` shape is real, already drafted (TOPIC-004, `:768–779`), and I have no objection to it. Devon's proposed one-dialog-two-step flow (§2 of the notes) is a reasonable default. But "reasonable default" isn't an acceptance criterion yet, and I want these nailed down before this goes to an engineer:

- **What happens if the Facilitator navigates away or the page reloads between the first `DELETE` (returns `requiresConfirmation`) and the second (`confirm=true`)?** Nothing in the notes or the contract says whether `openActionItemCount` is safe to re-display stale, whether the second request should re-derive the count server-side rather than trust a client-held number, or whether the UI should just restart the flow from the top. My read: the second request must not accept a client-supplied count — the server recomputes the open-action-item check independently of what the confirmation dialog displayed, so `confirm=true` is not "the client promises this was fine," it's "the caller has acknowledged some past warning, and the server still decides." That should be a stated design.md line, not an implicit assumption.
- **Is the confirmation dialog's copy graded by count, or generic?** "N open action items are attached to this topic" (Devon's proposed copy) is fine at N=1 or N=5; I want an explicit acceptance criterion that this is one string with an interpolated count, not two copy variants (singular/plural) someone has to remember to keep in sync. Small, but exactly the kind of thing that turns into a bug report from a facilitator six months from now if left unstated.
- **Does "escalate the same dialog" mean the generic retention-copy dialog is replaced by the warning, or does the warning get appended below it?** Devon's diagram implies replacement ("Escalate the SAME dialog... with the specific warning"), but that's a UI behavior, and "escalate" is doing a lot of unstated work. I'd want design.md to pick one and say which.

None of this blocks scoping the change — but "one escalating dialog, mechanism per §2" is not yet buildable without a frontend engineer independently deciding all three of the above. Acceptance criteria should name the request-replay behavior and the copy contract explicitly.

---

## 3. `200`-not-`409` for requiresConfirmation — fine as a finding, correctly flagged as needing a stated decision

No objection to the reasoning (nothing failed; this is information, not an error). Endorsing the notes' framing as-is: this needs to be a named decision in design.md with the reasoning stated, the same way Decision 8/9 pattern works in the sibling doc. Nothing to add here — this one is already precise enough to carry forward unchanged.

---

## 4. Last-topic guard — this is not just an "open question," I found a concrete failure mode that raises the floor on what "acceptable" looks like

The notes correctly identify this as genuinely open and correctly resist proposing a hard block. But "lean toward a soft warning, defer to whoever writes design.md" undersells what I found when I checked what "deferred to session start" actually means *today*.

I read `facilitator-sessions.ts`'s begin-voting handler (`:1178–1196`). When a session has no topic at `display_order` 1, the code does this:

```
if (firstTopicResult.rows.length === 0) {
  throw new Error(`Session ${sessionId} has no topic at display_order 1.`);
}
```

That's an unhandled `throw`, not a clean, user-facing validation error — it will surface as an unhandled `500`, in front of the team, at the moment the Facilitator clicks "Begin Voting." There is no existing guard anywhere in session creation or session start that checks for a non-empty active topic list before this point. I grepped for it; it isn't there.

This changes the shape of the open question. The use case's Notes (`08 - Topic Management - Use Cases.md:240`) frame "defer to session start" as a plausible alternative to a removal-time block — as if session start already handles it gracefully. **It does not.** Today, a team cannot reach zero active topics at all (every team is seeded with defaults, and no shipped endpoint can remove the last one), so this gap has been latent and harmless. TOPIC-004 is the first endpoint that makes it reachable. That means "defer to session start, don't block at removal" is not a neutral, already-safe default this change can quietly rely on — if this change ships the soft-warning-only version Devon prefers, it is *also*, by necessity, introducing the first realistic path to that unhandled `500`, and design.md needs to either (a) accept that as an explicit, named residual gap the way Decision 10 of the sibling design named its zero-active-topics case before it was reachable, or (b) close it as part of this change with a clean, user-facing error at session start instead of the current throw.

**Concrete acceptance criteria I'd want in design.md, replacing the current "lean toward a soft warning" framing:**
1. A stated decision on whether TOPIC-004 blocks removal of a team's last active topic (`409`, a new reason code) or allows it with a warning.
2. Independent of (1): a stated decision on whether this change also fixes `facilitator-sessions.ts`'s unhandled-`throw` path for zero-active-topics at session start, or explicitly defers that fix to a named follow-up issue. Shipping neither — no removal-time block *and* no session-start fix — should not be allowed to happen by default; it should require someone to say "yes, and we're accepting that a team can hit an unhandled 500 mid-ritual until a follow-up lands," on the record.

This is squarely the kind of edge case my persona exists to keep from becoming a scope dispute discovered during implementation rather than a gap closed in design. I'd flag this as the single most concrete addition this review makes to the exploration notes.

---

## 5. In-progress sessions — confirmed correct, nothing to add

I independently read `session_topics`' schema (`2_create_tables.sql:86–101`): `topic_name`, `topic_prompt`, `vote_type` are all snapshotted columns on the table itself, with no re-derivation from `topics` at read time beyond the `topic_id` FK. The notes' claim holds. This is a "confirmed safe, state it and move on" item — agreed, no further scrutiny needed.

---

## 6. Reuse from #49/#50 — confirmed accurate against the actual code, not just the sibling design doc

I checked this against `topics.ts` directly rather than trusting the notes' description of the sibling design: `evaluateStandingFacilitatorAccess` (`../auth/standing-facilitator-access-helper.js`), `hasCompletedFirstSession` (`../auth/topic-lock-helper.js`), `applyTimingFloor`, and the `topic.write_denied_locked` audit event name are all real, already-shipped, and used exactly as the notes describe. No corrections needed here. The one addition I'd make: the notes recommend the open-action-item query become "a named, reusable helper now." I agree, and I'd tie the acceptance criterion to something concrete — the function should be co-located with `topic-lock-helper.js`'s pattern (one exported function, one call site in TOPIC-004 today, documented as intended for reuse by TOPIC-005/006/007 later) rather than left as "the design should probably do this."

---

## 7. Frontend minimum-screen scope — reasonable, but two of the three bullets are findings, not decisions, and design.md needs to pick

The notes correctly identify that no Topic Management screen, no shared modal component, and no nav entry point exist yet — I confirmed the "no shared Modal/ConfirmDialog component" claim is consistent with how `MemberManagement.tsx` and `PreSessionActionItemReview.tsx` are structured, and I have no reason to doubt the `App.tsx`/`TeamPage.tsx` claims. But "worth a decision, not an assumption" (the notes' own words, `:134`) is true of all three bullets, and only the route-gating one actually proposes an answer (follow the `ProtectedRoute` + server-side-403 pattern). The nav-entry-point question — how does a Facilitator get to `/team/:teamId/topics` at all — has no proposed answer in the notes, not even a lean. That's fine for exploration notes, but it cannot ship as an open question into design.md; whoever writes design.md needs to either answer it or explicitly scope "add a nav entry point on `TeamPage.tsx`" as a task, because a screen a Facilitator cannot navigate to isn't a shipped feature.

---

## 8. A gap the exploration notes didn't surface: the use case document's own "Out of Scope" section is now wrong

Independent finding, not in Devon's notes. `08 - Topic Management - Use Cases.md:232`, under **Remove a Topic → Out of Scope**:

> Archiving topics in a way that differs from removal (no archive state is defined).

This is flatly contradicted by the shipped data model — `packages/shared/src/types/topic.ts`'s `status: "active" | "archived"` and `archivedAt`, and the already-drafted TOPIC-004/005 contract sections, both predate this exploration and both define exactly the archive state this line says doesn't exist. The notes handle the *terminology* drift (remove vs. archive, §0) but didn't flag that the use case doc makes an explicit, now-false factual claim about the data model, not just a word choice. This is the kind of drift I care about closing on the record (see my "Topic history preservation" concern in my own persona notes) — a future reader hitting this Out-of-Scope line without context could reasonably conclude archive/restore semantics are out of scope for the whole feature area, when they're in fact already shipped and this change's entire foundation. **I'd want design.md to note this correction explicitly, the same way it should note the remove/archive terminology correction** — not edit the use case doc itself (that's not this change's job and BRD/use-case documents are their own workspace under separate governance), but state on the record that this line is superseded by the shipped schema and the drafted contract, so nobody re-derives "no archive state" as still true.

---

## Summary: what needs to change before this becomes a proposal

**Blocking (needed before design.md can proceed on firm ground):**
1. State the TOPIC-002 correction using the five-sibling-uniformity + never-decided + low-implementation-risk evidence above, not just an appeal to the matrix. Include the required rewrite to TOPIC-002's `403` error-table text at contract line 658 as part of the same correction — the Authorization line and the error table cannot be fixed independently of each other.
2. Replace "lean toward a soft warning" (last-topic guard) with a stated decision covering both the removal-time behavior *and* whether this change fixes or explicitly defers the unhandled-`throw` path at session start (§4 above). This is the one place where I think the exploration notes materially understated the risk.

**Needed for buildability, not blocking scope:**
3. Confirmation-escalation flow: pin down request-replay behavior on the second `DELETE` (server re-derives the count; client-held count is never trusted), the singular/plural copy contract, and whether "escalate" means replace-in-place or append.
4. Nav entry point into the new screen: name an answer, don't leave it as a bullet with no lean.
5. Open-action-item query: name it as a single exported helper now, co-located with the existing lock-check helper pattern.

**Already precise enough to carry forward as-is:**
- Terminology correction (archive/restore over remove/re-add), confirmed and now also supported by the use case doc's Out-of-Scope drift (§8, new).
- `200`-not-`409` for requiresConfirmation, as a stated decision with reasoning.
- In-progress-session safety via `session_topics`, confirmed structurally safe.
- Reuse of existing helpers, error envelope, timing floor, and audit posture from #49/#50.

None of the above touches ritual-integrity properties — this remains a data-hygiene and access-consistency feature, and I agree with Devon's closing instinct in §7 of his notes: keep the screen small and calm. My additions here are about making sure the two places where "small and calm" could quietly become "small, calm, and occasionally throws a 500 mid-session" get closed on the record before implementation, not discovered by a facilitator.
