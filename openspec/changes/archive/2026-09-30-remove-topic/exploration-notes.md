# Exploration Notes: Remove a Topic (issue #51)

**Author:** Devon Calloway, Internal Champion (Subject Matter Expert) — exploring, not designing. These are the things Ingrid's design.md needs to take a position on, and the reasons I'd push back if it didn't.

**Revision note:** updated after review from Priya Nair (Facilitator) and Marcus Delgado (BA). Both reviews are folded into the sections below rather than kept as a separate response document — where they changed my recommendation (most notably §4, the last-topic guard, where I was wrong the first time) that's stated plainly, not hedged.

---

## 0. What already exists — ground truth before opinions

Confirmed by reading the code, not assumed:

- `packages/shared/src/types/topic.ts` already models this as `status: "active" | "archived"` with `archivedAt: Date | null`. The data model calls this **archive**, not **remove**. There is no `"removed"` status anywhere.
- `requirements/design/REST API Contract.md` already has a fully drafted, reviewed section for this: **TOPIC-004 — Archive Topic** (`DELETE /api/v1/teams/:teamId/topics/:topicId`), sitting right next to **TOPIC-005 — Restore Archived Topic**. This is not a blank page. Someone already thought hard about this endpoint's shape.
- `packages/backend/src/routes/topics.ts` has exactly one endpoint today (`POST .../topics`, Add Custom Topic, #49/#50), built against `evaluateStandingFacilitatorAccess` and `hasCompletedFirstSession`. Its file header explicitly names `topics.ts` as the home for "future TOPIC-004..007."
- There is **no Topic Management screen anywhere in the frontend.** I checked `packages/frontend/src/pages` and `src/components` directly. `#49/#50` shipped backend only. This issue is the first one that needs a facilitator to actually look at a list of topics and act on one.
- The sibling change's `design.md` (`topic-customization-lock-and-add-custom-topic`) is a long, disciplined document. It resolves ambiguities from `08 - Topic Management - Use Cases.md` rather than leaving them for the next person to re-derive. That's the standard this change should be held to as well.
- **Correction to the use case doc itself, flagged by the BA review:** `08 - Topic Management - Use Cases.md:232`, under *Remove a Topic → Out of Scope*, says "Archiving topics in a way that differs from removal (no archive state is defined)." That's now false — `topic.ts`'s `status: "active" | "archived"` plus `archivedAt`, and the already-drafted TOPIC-004/005 contract sections, define exactly the archive state this line denies exists. I'm not going to edit the use case doc — that's a separate governance workspace and not this change's job — but design.md needs to state on the record that this line is superseded by the shipped schema and the drafted contract, the same way it should note the remove/archive terminology correction above. Otherwise a future reader hits that line cold and concludes archive/restore semantics are out of scope for the whole feature area, when they're already shipped and this change's entire foundation.

The use case doc calls this "Remove a Topic." The already-shipped types and the already-drafted contract call it "archive." **This isn't a decision left for this change to make — it's already made.** The openspec change folder can stay named `remove-topic` (that's the issue's name), but the spec/design text inside it should talk about archiving, matching the data model and the contract, not reopen naming that was already settled by #48/#49/#50's schema.

---

## 1. The blocking finding: the contract contradicts itself on who can even *see* the topic list

This is the one I'd stop the room for.

TOPIC-004/005/006/007 all use the standing, org-wide facilitator model (Decision 3 from the sibling design: `global_role = 'facilitator'` AND not a team member AND lock is open — no requirement of ever having run a session for this team). Good, consistent, matches Add Custom Topic.

But look at the two **read** endpoints a Topic Management screen would actually call to render the list a facilitator picks a topic to remove from:

- **TOPIC-001** (`GET .../topics`, active only): "Active `participant` member of the team, OR `facilitator` with an active session for the team." (line 547-551 of the contract)
- **TOPIC-002** (`GET .../topics/all`, active + archived — the one built for "the topic management/configuration screen" per its own description): "`facilitator` with an active session for the team, OR `application_admin`." (line 609)

Both require an *active session* relationship. Neither grants the standing, org-wide facilitator the contract's own **Appendix B authorization matrix** says it should have:

> `TOPIC-002 to TOPIC-007 | No | Yes (non-member teams, post-lock) | No | Yes | Customization lock enforced`

The matrix groups TOPIC-002 in with the standing-facilitator write endpoints. The inline TOPIC-002 spec doesn't. **These two sections of the same document disagree about TOPIC-002's own authorization rule.**

For Add Custom Topic, this asymmetry was survivable — Decision 12 of the sibling design.md names it explicitly and defers it, because there was no UI yet; a facilitator could write "blind" with no round trip through a read endpoint first. That's the same reasoning the design used to justify not fixing it there.

That reasoning doesn't survive contact with **this** issue. #51 is explicitly a UI issue — "confirmation UI... missing" is in the issue title. You cannot build a screen where a facilitator browses a team's topics and picks one to archive if the read endpoint powering that screen only grants access to a facilitator currently running a session for that team. That's not "writing blind," that's "the screen doesn't load for the exact population Decision 3 says should be able to use it."

**My read:** this change needs to widen TOPIC-002's authorization to match what the matrix already says it should be — standing, org-wide, non-member, post-lock — as a stated correction (same move the sibling design made for the `403`/`409` split), not as new scope invented here. The matrix already licensed it. Nobody has to argue for a new capability; someone just has to notice the contract disagrees with itself and pick the reading that's already consistent with Decision 3's philosophy and with the matrix. TOPIC-001 is a separate question and should **not** be widened the same way — it's the endpoint engineers and in-session facilitators use, and Decision 12 already reasoned through why TOPIC-001's narrower model is intentional, unrelated to management-screen access.

**The BA review made this argument stronger than I made it, and design.md should carry his version, not mine.** I appealed to the matrix's authority — "the matrix already licensed it." Marcus checked the primary source directly and found the sharper tell: TOPIC-003 through TOPIC-007 all use `evaluateStandingFacilitatorAccess`'s wording verbatim, word-for-word identical, five endpoints in a row. TOPIC-002 sits in the middle of that block using TOPIC-001's model instead. This isn't "the matrix vs. the endpoint text," it's "five consecutive siblings share one authorization model and TOPIC-002 alone doesn't" — a one-of-six outlier, not a two-way disagreement to referee. He also confirmed this was never a considered decision (zero mentions of TOPIC-002 in the sibling design.md's 13 decisions — Decision 12 is about TOPIC-001 only, a different endpoint), and that it's greenfield with no existing callers to break, unlike TOPIC-001's `evaluateTeamAccess`, which is load-bearing across six other files. That's the version of this argument that survives a skeptical engineer asking "says who?" — design.md should state it that way, not as an appeal to the matrix.

**One thing I missed that the BA review caught: fixing the `Authorization` line isn't enough on its own.** `REST API Contract.md:658`, TOPIC-002's `403` row in the error-response table, currently reads "Authenticated user is not a facilitator with an active session for this team, and is not an application_admin" — that sentence describes the model being replaced. If the authorization line changes and line 658 doesn't, the contract says two contradictory things about the same `403` two subsections apart. Both edits are one correction, not two independent ones — design.md needs to make the line 658 rewrite an explicit part of the TOPIC-002 acceptance criteria, not something the next reader has to notice on their own.

If Ingrid's design disagrees with me on this, fine — but it needs to be a stated decision, not something that gets discovered mid-implementation when the frontend can't fetch a topic list for the team it was just told it can write to.

---

## 2. Two different "confirmation" ideas are talking past each other

The use case document's main flow (step 4) says: confirm before every removal, message says historical data is retained.

The contract's TOPIC-004 has a completely different, more specific mechanism: the first `DELETE` (no `confirm=true`) returns `200 OK` with `requiresConfirmation: true` **only when the topic has open action items**, naming a count. A second `DELETE` with `confirm=true` actually archives it. This maps to FR-8.5, which is explicitly a `[PREF]`, not a `[HARD]` requirement — "should warn... before allowing removal of a topic that has open action items."

These aren't in conflict, but they answer different questions, and if the frontend implementation treats the use case's generic wording as *the whole spec*, it'll miss that the contract's confirmation is conditional and reason-specific, not a blanket "are you sure?" on every removal.

The shape I'd want to see the design land on, and the one I think best serves the "history is preserved, nothing is deleted" principle without turning every removal into a two-step ordeal:

```
Facilitator clicks "Remove" on a topic
        │
        ▼
  Always show a confirmation dialog.
  Static copy: "This topic's historical
  data will be retained and stays visible
  in trend views." (satisfies FR-8.3 /
  the use case's own wording — no API
  call needed to know this is always true)
        │
        ▼
  Facilitator confirms →  DELETE .../topics/:topicId
        │
        ├── 200 { status: 'archived' }  → done, list refreshes
        │
        └── 200 { requiresConfirmation: true,
                   openActionItemCount: N }
                 │
                 ▼
           Escalate the SAME dialog (or a
           second step) with the specific
           warning: "N open action items are
           attached to this topic and will
           remain open, unlinked from future
           sessions." Facilitator confirms
           again → DELETE ...?confirm=true
```

One dialog, potentially two steps, but never a surprise. The generic retention message is always true and costs nothing to show up front — it doesn't need the round trip. The open-action-item warning is the one genuinely conditional piece, and it's already fully specified server-side (count, reason code). This also means the frontend doesn't need to pre-fetch action item counts itself — the existing `DELETE` call, called once, tells it whether to escalate.

Worth naming to Ingrid as a design.md decision either way — don't let this get silently resolved as "two separate always-shown dialogs" or "skip the generic one," both of which would either overcomplicate the ritual-facing UI (my chrome concern, below) or under-deliver on FR-8.3/the use case's plain wording.

**Priya's and Marcus's reviews independently found real gaps in this flow, and I'm folding them in as required, not optional, refinements:**

- **Name the team, not just the topic, in every step of this dialog.** Priya facilitates three teams on rotation and, under the standing org-wide model this change builds against, could plausibly be looking at a team that isn't one of her usual three — filling in, or reviewing before a handoff. "Archive this topic?" naming only the topic doesn't protect against the realistic mistake of archiving the right topic for the wrong team with two tabs open. Both the generic retention copy and the escalated warning should read something like "Archive '{topic name}' for {team name}?" — the confirmation is the safety net for exactly this kind of mix-up, and it only works if it names both.
- **The open-action-item warning needs a drill-down, not just a count.** "N open action items are attached" doesn't tell a facilitator running three teams whether N=3 is stale noise or live commitments — she doesn't have them memorized. The escalated dialog should let her expand or click through to see *which* items (title is enough; this isn't the place to build action-item editing), or she'll either confirm blindly, which defeats the warning, or leave the tab to go look them up elsewhere, which breaks the light-bookkeeping flow this whole feature exists to protect. I'll draw the line here at view-only, inline, no navigation away from the dialog — a link out to a separate action-item management view would turn a confirmation dialog into a workflow, which is exactly the kind of chrome-creep I don't want this issue building. Also fix the wording while we're in there: "unlinked from future sessions" is correct but is engineering language; what the facilitator needs to hear is closer to "these will stay open, but nothing will remind anyone about them going forward."
- **Three mechanics the BA review is right need to be nailed down, not left implicit:**
  1. The second `DELETE` (`confirm=true`) must not trust a client-held `openActionItemCount` from the first response. The server re-derives the open-action-item check independently every time. `confirm=true` means "the caller acknowledged a past warning," not "the caller's count was correct" — otherwise a stale page (navigated away and back, reloaded mid-flow) could archive a topic with items that don't match what was actually shown.
  2. The dialog copy is one string with an interpolated count, not singular/plural variants someone has to remember to keep in sync. Small, but it's exactly the kind of thing that becomes a bug report six months out if left unstated.
  3. "Escalate" means the same dialog replaces its content in place with the specific warning — not a second dialog appended below the first. That's what my diagram above already implied, but it needs to be a stated choice in design.md, not something a reader infers from an arrow in my sketch.

---

## 3. The "confirmation required" response is a `200`, not an error — flag it, don't refight it

TOPIC-004 returns `200 OK` for the "please confirm" case, not `409`. That's a real divergence from this codebase's own established idiom — Decision 2 of the sibling design drew a hard line between state-preconditions (`409`) and actor-identity failures (`403`), and the whole design leaned on status codes carrying meaning. A "you need to confirm before I'll do this" response is arguably a third category the sibling design never had to name.

I think `200` is actually the right call here — nothing failed, the request is being answered honestly ("here's what would happen, try again if you mean it"), and it's not blocking anything the caller is entitled to do; it's giving them information before an action they didn't yet ask to finalize. But it needs to be a **stated** decision in design.md, with the reasoning above, not just inherited silently from the contract text because that's what was already typed there. This is exactly the kind of thing the sibling design's own Decision 8/9 pattern — write it down so it isn't rediscovered as an open question later — exists for.

---

## 4. The "last topic" question — no longer open. Hard block at removal, and close the session-start crash in this change.

I'm revising this from the original notes rather than letting it stand. My original lean was a soft warning at removal time, deferring the actual constraint to session start. Priya's and Marcus's reviews arrived at the same conclusion independently, from two different directions, and together they change the shape of the decision enough that I want to say plainly: I was wrong to leave this as a preference.

**Priya's argument, from the facilitator's chair:** a warning she can click past while tidying up topics on a Tuesday afternoon is a warning she *will* click past — she's doing this quickly, between other things, often for a team that isn't her own. The moment that actually costs her something is standing in front of a team at session start with zero topics configured, which is the worst possible place for any rough edge to surface. If a team wants to genuinely reduce to zero topics, that should require an explicit, unambiguous action, not the tail end of a routine cleanup pass.

**Marcus's finding makes the stakes concrete instead of hypothetical.** He read `facilitator-sessions.ts`'s begin-voting handler (`:1178-1196`): when a session has no topic at `display_order` 1, it does an unhandled `throw`, not a clean validation failure. That surfaces as an unhandled `500`, in front of the team, at the moment the Facilitator clicks "Begin Voting." No shipped endpoint can reach that state today — every team is seeded with defaults, and nothing can remove the last active topic yet. TOPIC-004 is the first endpoint that makes it reachable. Which means "defer to session start, it's handled there" was never actually a safe, already-tested default — it was an untested code path that happened to be unreachable until now.

**My recommendation, replacing the original lean:**

1. TOPIC-004 hard-blocks removal of a team's last active topic — `409`, a new reason code, following Decision 9's cascade pattern from the sibling design. This is the removal-time gate Priya's review asks for, and I now agree with her reasoning over my own original one.
2. This change also replaces the unhandled `throw` in `facilitator-sessions.ts`'s begin-voting handler with a clean, user-facing validation error. Not a redundant belt-and-suspenders gesture — the hard block in (1) is a single gate, and I don't want the team's protection from that crash to depend on one check holding under every future code path (a second concurrent archive request racing the check, a future endpoint, a migration). Fix it once, at the place the actual consequence lands, while this change already has reason to be in the neighborhood.
3. Both belong in this change, not split into a follow-up issue. It's a small, contained fix — replacing a throw with a validation branch — sitting next to code TOPIC-004 already touches. Deferring it risks it never happening, and "unhandled throw nobody's hit yet" is exactly the kind of thing that stays that way right up until a facilitator hits it live. That's also exactly the situation I don't want to become the escalation path for after the fact.

This was a product judgment call I was willing to leave open in the first draft of these notes. It isn't anymore — both reviewers reasoned to the same place independently, and the crash evidence removes the ambiguity I thought existed. Design.md should state this as a decision, not reopen it as a question.

---

## 5. In-progress sessions — already structurally safe, nothing new to build

The use case's Notes worry that "removal does not affect in-progress sessions" might "need a decision." I checked: it doesn't need one. `session_topics` (`packages/backend/migrations/2_create_tables.sql`) is its own table — a per-session snapshot of `topic_id`, `topic_name`, `topic_prompt`, `vote_type`, `display_order`, populated at session start and never re-derived from `topics.status` afterward. Archiving a topic changes `topics.status`; it has no path back into an already-created `session_topics` row. An in-progress session's topic sequence is immune to a concurrent archive by construction, not by a check this change needs to add. Worth stating in design.md as a confirmed-safe fact (with a pointer to the schema), the same way the sibling design confirmed "no migration needed" against the actual schema rather than assuming it.

One adjacent moment Priya's review asked to have confirmed rather than assumed: if a topic is archived shortly before its team's next session starts — a completely normal time for a facilitator to be tidying up — does session-start correctly pick up the updated active list, or is there any staleness risk between "just archived this" and "just clicked start session"? I believe this is already fine given how `session_topics` is populated fresh at start from current `topics.status`, but I haven't independently traced that code path the way I traced the in-progress-session safety above. Design.md should state it as confirmed, not leave it as a plausible-but-unverified assumption sitting next to a claim I did verify.

---

## 6. What this change should reuse verbatim from #49/#50 — the discipline that matters most

The sibling `design.md` is the load-bearing precedent here, and Remove Topic should not re-derive any of the following from scratch:

- **Check-ordering cascade** (Decision 9): `403` (identity/role) → `404` (team) → `409` (lock) → validation-shaped failure last. TOPIC-004 needs one more rung inserted — topic existence/ownership — and needs to decide where "already archived" (`422`) and "requires confirmation" (`200`) sit relative to the lock check. My instinct: lock (`409`) before "already archived" (`422`), same reasoning as Decision 9's placement of body validation last — a caller who was never going to be allowed to write at all shouldn't learn anything about the topic's specific state first.
- **Same two helpers**: `evaluateStandingFacilitatorAccess` and `hasCompletedFirstSession`. No third copy of either query.
- **Same error envelope** (`{ error: { category, code, message, correlationId } }`), same `applyTimingFloor` discipline on every branch, `200` success paths included.
- **Same audit posture**: a denial gets audited before the response (reusing `topic.write_denied_locked`, per the sibling design's own note that this operation name is shared across every topic-write endpoint the lock gates — not a new per-endpoint variant). A successful archive should get its own audited write-in-transaction event (e.g. `topic.archived`), matching the sibling's Decision 8 amendment reasoning: the standing, org-wide model means "who did this" isn't answerable without an audit row, and that mattered enough to fix for the add-path: it matters exactly as much for the remove-path, arguably more, since removal is more consequential to a team's data continuity than addition.
- **The open action-item query is new work**, not reuse: `action_items.session_topic_id` is a nullable FK to `session_topics`, which is keyed by `topic_id`. Computing "does this topic have open action items" means joining `topics → session_topics → action_items WHERE action_items.status = 'open'`, across every session the topic has ever appeared in — not just the current or most recent one. This is the one genuinely new query this change introduces; it should get the same "one reusable function, not an inline query" treatment Decision 1 insisted on for the lock check, since TOPIC-004 is very likely not the last endpoint that will ever need to ask "does this topic have open action items."

---

## 7. Facilitator-visible provenance on removed topics — a real gap, not just an audit-log technicality

Priya's review surfaced this and it's the one I'd have missed entirely on my own, because I was reasoning about `topic.archived` as an audit event (§6) — a system/security record — and never asked whether a facilitator can actually see it.

Here's why it matters under the model this change is built against: facilitators are standing and org-wide, not tied to one team. Priya picks up teams from other facilitators, comes back to a team after months away, and reconstructs context from the trend dashboard and session history without a handoff conversation. If a topic vanishes from the active list and all she gets is "it's gone," that's worse than the spreadsheet-and-memory era this application is supposed to improve on — at least there she could ask the person who did it. An audit row nobody-facing exists to answer "who did this and when" only in the sense that the data is technically in a table somewhere; it doesn't answer the question for the person who actually needs it, in the place she'd look.

This is squarely inside what I care about — the ritual surviving without me having to be the institutional memory for every team. A facilitator hitting a wall of "topic's gone, ask around" is the same failure mode as a team needing to ask Devon Calloway what a topic means, just relocated to a different person and a different question.

**Recommendation:** the topic management screen (or the removed-topics list the Re-Add use case already implies exists) should show, per archived topic: when it was archived, and by whom. This reuses the `topic.archived` audit event's data — no new capture needed, just surfacing it in a facilitator-facing read path instead of leaving it as an audit-only record. This should be a stated decision in design.md, not left implicit because the data technically exists somewhere in the audit log.

---

## 8. Frontend: build the minimum screen this needs, not the whole Topic Management surface

Since no Topic Management page exists at all, #51 is implicitly "stand up the first version of this screen." That's fine — it has to happen somewhere — but I'd resist the temptation to build out add/reorder/annotate UI chrome here too, even though the backend for those either exists (#50) or is coming (#52-55 per the sibling design's Non-Goals list). My concern, straight from what I care about: **the application should disappear into the background.** A facilitator's between-session moment of tidying up topics should feel like light bookkeeping, not like opening a full admin console. A minimal list — active topics in order, a "Remove" affordance per row, the confirmation flow from §2 — earns its keep for this issue. Add/reorder/annotate can extend the same screen when their own issues land, rather than this issue over-building a shell for features that aren't reachable yet.

Concretely, that likely means:
- A new route, something like `/team/:teamId/topics`, `ProtectedRoute`-gated like every other route in `App.tsx` — no dedicated client-side facilitator check exists as a pattern to copy yet (the EM routes rely on server-side dual authorization and let the page component render a 403 state, per the comment at `App.tsx:196-201`); this screen should follow that same shape rather than inventing a new client-side gating primitive.
- No shared `Modal`/`ConfirmDialog` component exists anywhere in `packages/frontend/src/components` today — every confirmation-shaped UI I found (`MemberManagement.tsx`, `PreSessionActionItemReview.tsx`) builds its own inline state, not a shared abstraction. Don't invent a generic modal system for one confirmation flow; match the existing inline-state pattern unless a second consumer shows up that would justify extracting one.
- Each row should still read as "here is your team's topic configuration," not "here is a delete list" — Priya's framing, and I think it's right. Show the prompt, vote type, and description per row, matching View Active Topic Configuration's existing acceptance criteria, with one "Remove" affordance added — not a stripped-down list of names next to a destructive button. Editing stays out of scope; the row content presented while deciding what to remove shouldn't.
- **Nav entry point — both reviewers escalated this from "worth a decision" to something this issue can't ship without, and I agree.** No obvious way to reach a topic management screen exists on `TeamPage.tsx` today (it currently only renders `MemberManagement`). Priya's point lands hardest here: if she can't find the screen, the feature doesn't exist for her, or for the next facilitator who inherits a team without knowing to look for it — that's a continuity failure, not just a missing UX polish item. I'm not resolving the specific placement myself here (that's design.md's job, and it may come down to something as simple as a link or tab next to `MemberManagement`), but I want it stated plainly: design.md must answer this, not carry it forward again as an open bullet. A screen nobody can navigate to isn't a shipped feature.

---

## Open questions I'd carry into design.md, explicitly, rather than let get re-derived later

1. **Blocking:** does this change widen TOPIC-002's authorization to match Appendix B's matrix (standing, org-wide, non-member, post-lock), including the required `403` error-table text correction at contract line 658 (§1)? I think the matrix already answered the authorization question, and the BA review's five-sibling-uniformity check confirms it more strongly than I originally argued — someone needs to say so on the record, with both edits made together.
2. Confirmation UX: one escalating dialog that replaces its content in place (my recommendation, §2), now with team name in the copy, a drill-down on open action items instead of a bare count, server-side re-derivation of the count on `confirm=true`, and a single interpolated copy string rather than plural variants — all stated explicitly, not left to whoever writes the frontend code.
3. ~~Last-topic guard~~ — **resolved, not open.** Hard block at removal (`409`, new reason code) plus a fix to `facilitator-sessions.ts`'s unhandled-throw path at session start, both in this change (§4). Design.md should state this as a decision, not reopen it as a product call.
4. Exact 404/409/422/200-confirm ordering for TOPIC-004's cascade (§6) — mechanical, but needs the same rigor Decision 9 gave TOPIC-003, including a timing-floor check across all six branches (403/404/409-lock/409-last-topic/422/200, both plain-200 and requiresConfirmation-200).
5. Whether the new "does this topic have open action items" query becomes a named, reusable helper now (my recommendation) or gets inlined and extracted later when TOPIC-005/006/007 need something adjacent.
6. Facilitator-visible provenance on removed topics — when and by whom, surfaced on the screen itself, not just in the audit log (§7).
7. Nav entry point into the new screen (§8) — needs a named answer in design.md, not another carried-forward bullet.

None of these touch the ritual-integrity properties I actually lose sleep over — no-manager-participation, simultaneous reveal, facilitator-from-another-team. This is a data-hygiene and access-consistency feature, not one that threatens those guardrails. My only standing concern for *this* feature specifically is §8: keep it small, keep it calm, don't let "we're finally building the Topic Management screen" turn into "we built an admin console." That's how a ritual starts feeling like software being run on engineers instead of a conversation they're having.
