# Facilitator Review: Exploration Notes for "Re-Add a Previously Removed Topic" (issue #54)

**Reviewer:** Priya Nair, Facilitator (Subject Matter Expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Lens:** does this capture the real friction of restoring a topic weeks or months after I (or someone else) removed it, and does it keep the ritual calm — not whether the API contract is internally consistent, which isn't mine to referee.

---

## Overall take

I agree with §7's framing and I'll say the same thing I said for Remove: keep this small. One button on a list that already exists, one confirmation dialog. I don't want a second screen and I don't want a "topic history timeline." Nothing here touches reveal, pacing, or in-session mechanics, and I have no concerns from that angle.

But "restore" is a different moment for me than "remove," and I don't think this document has fully reckoned with that difference yet. When I archive a topic, I'm the one doing it, right now, with full context for why. When I *restore* one, I am very often not the person who archived it, and it may have been gone for months. The entire value of this feature, for me, is continuity — and continuity is exactly where I think the notes are thinner than they should be.

---

## Observations & questions

### 1. The confirmation copy answers "what will happen," not "is this the right topic"

Devon's proposed copy (§5) — *"Restore '{topic name}' for {team name}? Historical data will be restored, and the gap while it was removed will be visible in trend views."* — is good, and I appreciate that it carries forward the team-naming requirement I asked for on Remove. But read it as me, standing in front of this dialog three months after someone else archived this topic: it tells me what the system will do, not what I need to know to decide whether restoring is the right call.

The thing I actually want at the point of decision is *why was this removed, and when*. §0 confirms the removed-topics list already renders per-row `archivedAt`/`archivedBy` — good, that's the right instinct, and it should stay visible on that list, not just appear after I've already clicked restore. But neither the list nor the confirmation copy captures *why* a topic was archived, because nothing in this feature — or in Remove, as shipped — ever captured a reason. I'm not asking to add a reason field; I recognize that's scope creep on a "keep it small" feature. But I want this named as a real limitation rather than silently assumed away: if I inherit a team and see "Team Communication" sitting in the removed list, archived four months ago by a facilitator I've never worked with, the application can tell me *who* and *when* but not *why*, and restoring it is still partly a guess. That's worth one sentence in design.md so nobody mistakes "we show provenance" for "we show enough context to decide."

### 2. Provenance parity (§4) — I'd push this from "lean" to "decide it my way"

Devon flags as open: does restoring clear `archivedAt`/`archivedBy` back to null, or preserve them until the topic is archived again? I want to weigh in directly, because this is the same continuity property Decision 6 on the Remove design was built for, just facing the other direction.

**Preserve them.** If I restore a topic and then, a week later, a different facilitator (or me, having forgotten) looks at the active list and wonders "didn't this used to be gone for a while?", clearing the fields the instant I click restore throws away the exact answer that question needs. I'd rather the active list quietly carry "last archived by X on date Y" as long as it's true, until the topic is archived again and that record updates to the new event. This is not a hard requirement the way `archived_by` itself was — I won't block on it — but I want it decided with my reasoning attached, not left to whoever writes the migration.

The corollary I'd also want decided, not just the clear-vs-preserve question: does a restore get its **own** `restored_by`/`restored_at` pair, visible somewhere on the active list? Devon's lean in §4 is toward shipping this "on the same reasoning as Decision 6," and I agree — for the same reason I asked for `archived_by` on Remove. A facilitator scanning the active topic list has no way today to tell "this has been here since the team started" from "this came back two weeks ago" without it. Given how rare and deliberate a restore is, I don't think this is over-building; it's the same continuity fact Decision 6 already decided mattered, just on the row that's now active instead of the row that's now archived.

### 3. Removed-topics list vs. "never added" — I want this checked, not assumed distinct

The use case's removed-topics list is, by construction, only topics that were once active for this team and then archived. That's different from a default topic this team has simply never turned on. I didn't see anything in the exploration notes confirming those two things can't get visually conflated for me — and I've onboarded enough new teams to know "is this topic gone, or did we just never add it" is a question I'll actually be asked.

Concretely: if a team has never added a given default topic, does it show up anywhere near this "removed" list, or only through whatever surface exposes available-but-unadded defaults? If those are two separate lists in two separate places, I'm fine — I just want it confirmed as a checked fact, the same way Devon confirmed the in-progress-session safety for Remove, not left implicit because the two states feel obviously different from the code's point of view. They may not feel obviously different from mine, glancing at a screen between meetings.

### 4. The trend-view "gap" answer needs a second look before I'd sign off on it

This is the one I want to push back on directly, not just flag as a question. Devon's read (§2 of the exploration notes) is that because `EmTrendDataPage.tsx` renders a list of per-session data points rather than a line chart, there's no line to break — a gap is just `#4 ... #7` with nothing between, and that "reads clearly on its own."

I don't think it does, not for what the acceptance criterion is actually asking for. The criterion says the trend view should *reflect the gap* — and the real-world thing that needs reflecting isn't "no interpolation happened," it's "a human looking at this list understands a topic was intentionally removed and later restored," as opposed to any of the other reasons a session's data point might be missing (a topic skipped for time, a session that didn't get to every topic, a data issue). A silent jump from session 4 to session 7 satisfies "doesn't interpolate" in the technical sense, but it doesn't tell me *why* the jump exists. That ambiguity lands squarely on the exact person this feature is supposed to serve — a facilitator reconstructing a team's history without a handoff conversation. I would not be able to tell, from that list alone, whether I'm looking at a gap from an intentional removal or a gap from something broken.

I'd want the reinstated topic's entry in that list to carry some inline signal across the gap — even something as plain as a single line between the two visible sessions reading "Not tracked, sessions 5–6 (topic removed)" — rather than relying on the reader to infer intent from missing rows. I recognize Devon explicitly scoped this out as "a future Trend Dashboard concern, not something this issue needs to design UI for" (§2), and I understand the instinct to keep this change small. But the acceptance criterion belongs to *this* use case, not to a future chart redesign, and I don't think "the existing list happens to already omit rows for other reasons too" is a satisfying way to meet it. At minimum I want this named as a real design decision in design.md — reinterpreted against what the list view can actually do today — rather than treated as already answered by how the page happens to render.

### 5. Empty state — same discoverability concern I raised for Remove, mirrored here

The Alternate Flow says the removed-topics list may be empty and re-add "is not shown, or the empty state is communicated clearly." I'd want the second option, decided, not left as an either/or. If a facilitator opens Topic Management for a team that has never removed anything, an absent section reads as "this capability doesn't exist here" rather than "there's nothing here yet" — the same distinction that mattered to me for the nav entry point on Remove. A quiet "No removed topics" line costs almost nothing and avoids that doubt.

---

## Where I think the notes already got it right (worth keeping, not re-litigating)

- Keeping this small — one button, one dialog, no bulk restore, no history timeline (§7). I'd fight for this the same way I did on Remove.
- Team-naming the confirmation copy, carrying forward the exact requirement I asked for last time (§5).
- Not treating "append to end" as something I'd be bothered by — restoring is rare enough, and reorder already exists as its own capability, that I don't need my exact old position back.
- Confirming this touches nothing about reveal, pacing, or in-session behavior (§7) — correct, and not a concern from my side at all.

---

## Summary for design.md

Two things I'd want carried forward as explicit, stated decisions:

1. **The trend-view gap answer isn't done.** "No line to break, so nothing to build" technically satisfies the letter of the acceptance criterion but not what it's actually protecting — a facilitator's ability to tell an intentional removal-and-restore apart from any other reason a session's data might be missing. I want an inline signal across the gap, even a minimal one, treated as in-scope for this issue rather than deferred to a future chart.
2. **Provenance parity should ship, my way:** preserve `archivedAt`/`archivedBy` through a restore rather than clearing them, and add the mirrored `restoredBy`/`restoredAt` pair visible on the active list. Same continuity reasoning that already won for `archived_by` on Remove, just facing forward instead of back.

Secondary, but still worth a line each in design.md: confirm the removed-topics list can't be confused with "never added" defaults (§3), and commit to an explicit "No removed topics" empty state rather than hiding the section (§5). And one limitation I'd just like acknowledged rather than fixed here — restoring a topic still doesn't tell anyone *why* it was removed, only who and when (§1). Not a blocker, just something I don't want discovered as a surprise the first time a facilitator asks me that question and the app has no answer either.
