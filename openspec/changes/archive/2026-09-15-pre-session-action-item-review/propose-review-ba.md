# BA Review: Pre-Session Action Item Review — Proposal Stage

**Reviewed by:** Marcus Delgado (Business Analyst)
**Sources reviewed:** `proposal.md`, `design.md`, `specs/pre-session-action-item-review/spec.md`, `tasks.md`
**Cross-referenced against:** `requirements/use cases/03 - Pre-Session Action Item Review - Use Cases.md`, and the shipped implementation of `fetchPreSessionActionItems` in `packages/backend/src/routes/facilitator-sessions.ts` (checked directly, since this proposal's central claim is that the function is reused "without rewriting" — I wanted to see what's actually being inherited before signing off on it)
**Question asked:** Are the capabilities specific enough to implement? Are acceptance criteria explicit or implicit? What's still vague?

Short version first: every item I raised at the exploration stage got addressed, most of them close to verbatim — the deliberate-partial-implementation framing, the follow-up issue commitment, the error-state coverage, the late-joiner gating, the copy gate, the `SessionLobbyPage` decision. That's the review working the way it's supposed to. This pass found one new issue serious enough to block implementation-readiness, and it's not a documentation gap — it's a mismatch between what the requirements decided and what the code this change is inheriting actually does.

---

## 1. Blocking: the staleness legend this change is building doesn't match the staleness levels the reused code computes

UC: Flag Stale Action Items calls the color mapping "a decided requirement": 1 session elapsed = yellow, 2 = orange, 3+ = red. `proposal.md`'s legend bullet and `spec.md`'s legend requirement both repeat this exact 1/2/3 mapping. Task 1.1 treats legend copy as a merge-blocking scope gate.

But Decision 1 of `design.md` and task 2.1 both commit to reusing `fetchPreSessionActionItems` "without changing its signature or query behavior" — and I read that function. It doesn't implement a fixed 1/2/3 mapping at all. It reads a single configurable value, `application_settings.staleness_threshold_sessions` (default `2`), and steps the four levels at **multiples of that one threshold**:

```
none:   sessionsSinceUpdate < threshold
yellow: sessionsSinceUpdate >= threshold       (>= 2, at the default)
orange: sessionsSinceUpdate >= threshold * 2   (>= 4, at the default)
red:    sessionsSinceUpdate >= threshold * 3   (>= 6, at the default)
```

The function's own comment (`facilitator-sessions.ts:74–80`) says this out loud: *"no code or contract text anywhere in this codebase specifies how the four levels... map onto that one number. This implementation steps levels at multiples of the configured threshold (1x/2x/3x); if a different mapping is intended, this is the function to revisit."* That comment is the shipped code telling the next reader this was never reconciled against the use case. This change is the first thing to put a user-facing legend on top of that unreconciled number, which is exactly what turns a code comment into a requirements problem.

Concretely: at the default threshold of `2`, an item with 3 sessions elapsed computes as `yellow`. The legend this change is required to render says 3 sessions = red. A facilitator and every participant will be looking at a badge that contradicts the words right next to it.

This isn't a "nice to catch" — it's the kind of magic-number-in-code situation I flagged as a standing concern going into this project, and it's now about to become visible in the UI rather than staying buried in a query. It needs a decision before task 1.1's copy gate can actually close, because the copy depends on which mapping is real:

**Suggested acceptance conditions to add:**
- [ ] `design.md` records an explicit decision on how `computeStalenessLevel`'s 1x/2x/3x-of-threshold mapping reconciles with UC: Flag Stale Action Items' fixed 1/2/3-session mapping — pick one of: (a) fix `computeStalenessLevel` to match the decided 1/2/3 requirement (a small change to already-shipped code, which changes this proposal's "no changes to existing contracts" framing and should be said explicitly, not discovered later), (b) get stakeholder sign-off that the threshold-multiplier behavior is the new decided requirement and update UC: Flag Stale Action Items accordingly, or (c) make the three level-boundaries independently configurable, matching what the use case actually specifies (three thresholds, not one).
- [ ] Task 1.1's copy gate cannot close on the assumption that "1/2/3 sessions" is the literal behavior until this is resolved — the legend text is downstream of whichever mapping is chosen.
- [ ] Whichever mapping is confirmed, add a route test asserting the legend's stated thresholds and `computeStalenessLevel`'s actual output agree at the default `application_settings` value — this is cheap insurance against the two drifting apart again silently.

I want to be clear this isn't a reason to reopen "no changes to staleness threshold configuration" as a scope question generally — the proposal is right to keep that closed for anything about *how teams configure* the threshold. This is narrower: the *mapping* from elapsed-sessions-count to color, which the requirements already decided and which this change is the first to surface to users, needs to actually match what gets rendered.

---

## 2. Needs a concrete answer, not necessarily blocking: which "session identifier" gets shown to a human

`spec.md`'s display requirement and `tasks.md` task 4.2 both say the review shows each item's "originating session identifier." `fetchPreSessionActionItems`'s return shape carries two different candidates: `originatingSessionId` (a UUID) and `originatingSessionNumber` (an integer). The spec text doesn't say which one is meant, and a UUID rendered to a participant ("Session a3f9e21c...") isn't meaningful the way "Session #12" is.

This isn't a fresh ambiguity — the codebase has already answered it elsewhere. `EmSessionHistoryPage.tsx` and `EmTrendDataPage.tsx` both render `Session #{sessionNumber}` as the established human-facing pattern. I'd be surprised if anyone intended anything else here, but "I'd be surprised" isn't an acceptance criterion, and this is cheap to close.

**Suggested acceptance condition to add:**
- [ ] `spec.md`'s display requirement and task 4.2 specify `originatingSessionNumber`, not `originatingSessionId`, as the field rendered — consistent with the existing `Session #N` pattern used elsewhere in the frontend.

---

## 3. Minor gaps worth a one-line fix each

### 3.1 The summary line's copy isn't covered by the copy gate that's supposed to cover all user-facing text

Task 1.1 gates on "the empty state message and each staleness tier's badge/label text." The one-line summary ("3 items need attention") is a third piece of user-facing copy `proposal.md` itself calls out as needing to be "phrased without blame or urgency language directed at any individual" — that's a tone requirement, which is exactly the kind of thing that should go through the same stakeholder-approval gate as the other two, not be left to whoever writes the component.

**Suggested fix:** Add the summary line's copy to task 1.1's scope explicitly.

### 3.2 The summary line's "nothing stale" behavior is stated as a negative, not a positive

`spec.md`'s scenario "Summary line does not render misleading counts when nothing is stale" says what it must *not* say, not what it *does* show. Does the line disappear entirely when there are open items but none stale, or does it show a neutral variant ("4 open items, none need attention")? Both are defensible; only one is buildable without a follow-up question.

**Suggested acceptance condition to add:**
- [ ] `spec.md` states explicitly whether the summary line is omitted entirely or replaced with neutral copy when items exist but none carry a staleness indicator.

### 3.3 "Count of items needing attention" — worth confirming it's a simple union, not a weighted read

The summary line's count presumably means "count of items with any non-`none` staleness level" (yellow + orange + red combined), not just red, or some severity-weighted phrasing. The proposal's example ("3 items need attention") is consistent with a plain union, but the requirement text never says so directly. Low stakes, but cheap to nail down given 3.1 is already reopening this copy for the gate.

---

## 4. Already well-specified — don't re-litigate

- The UC1 partial-implementation framing (steps 1–5, 7 now; step 6 and UC2/UC3 deferred) is now explicit in `proposal.md`'s first paragraph, matching what I asked for at exploration — good, and it's the sentence I'd want someone to find in six months.
- The accountability-loop limitation is stated as a named limitation, not buried in a risk list only.
- The follow-up issue commitment is now concrete: scoped to (a)/(b)/(c), filed before merge, tracked in task 1.3.
- Item ordering is correctly left open pending stakeholder confirmation (task 1.2) rather than silently inheriting the existing oldest-first query as a decided answer — this is the right way to carry forward an assumption the use case itself flagged.
- Late-joiner / session-status gating (Decision 2, and the three related spec scenarios) is thorough — explicit 404-vs-409 distinction, explicit statement that it's a default not a permanent answer, and a manual verification task (6.3) to back it up.
- Error-state coverage (GET failure, facilitator payload failure, per-item staleness failure) is now complete against UC1's and UC: Flag Stale Action Items' postconditions — this was the biggest gap at exploration and it's closed.
- `SessionLobbyPage` vs. a new route is now a design.md decision with a stated rationale and alternatives considered, not an open question carried forward for someone else to resolve.
- EM-exclusion and facilitator-from-another-team boundaries — unchanged from exploration, still solid, still out of scope for this screen correctly.
- `isFacilitator` as the single source of truth for the advance control, with the server-side `begin-voting` re-check called out explicitly as the reason a client-side bypass isn't a security hole (Decision 4) — precise, and forecloses a question an implementer would otherwise have to ask.
