# BA Review — tasks.md (session-lobby-routing-gap)

**Reviewer:** Marcus Delgado, Business Analyst
**Scope of this review:** Does tasks.md, as currently written, cover every capability in the revised proposal.md/design.md, without drifting back into ground D7 deliberately scoped out? Is every delta-spec scenario traceable to a task?

**Verdict: Approved.** tasks.md matches the revised proposal's scope. I found no task that reopens the participant-access gap, and every scenario across the three delta specs traces to at least one task. Two small clarity notes below, neither blocking.

---

## 1. Scope match against the narrowed Goal #2

I read design.md's Goals section and D7 closely because this is exactly the kind of place where a requirement that reads correctly to a BA can still get "fixed" by an implementer reflexively, without anyone deciding it should be. That's the scope-drift failure mode I care about most on this review.

Task 6.4 is the one place tasks.md touches the participant-access gap, and it's framed correctly:

- It's titled "Known, out-of-scope gap — confirm, don't fix."
- It states the expected current (broken) behavior explicitly (`404` / `CLOSE_UNAUTHORIZED`) rather than leaving the implementer to discover it and guess whether that's a bug to fix.
- It has an explicit stop instruction: "Do not attempt to fix this under task 5's scope."
- It tells the implementer what to do if their trace *doesn't* match the expected gap ("flag it rather than silently closing the follow-up") — this matters to me specifically, since late-discovered edge cases becoming silent scope disputes is one of my standing concerns on this project. This task heads that off by naming the fork in advance.

I checked every other task (sections 2, 3, 4, 5) for language that could be read as touching `session_participants` creation, the EM-exclusion check, or `evaluateSessionSubscriberAccess` — none do. Task 5 is scoped tightly to the join-link *landing destination* (a redirect target), not to authorization once the user arrives. That's the correct line per D7, and tasks.md holds it.

No task implies fixing the participant-access gap. Good.

## 2. Delta spec scenario → task traceability

### `join-link` (7 scenarios)
All seven statuses plus the no-session case are named explicitly in task 5.1 (the enumeration itself) and covered by task 5.4 ("unit-test the shared helper directly against each of the seven `SessionStatus` values plus no-session-exists, per the delta spec's scenarios"). Task 5.4 references the delta spec directly, so there's no ambiguity about which eight cases it means. Route-level coverage for the two call sites (which is where this capability actually lives, not client-side) is separately required by 5.5 (`join-links.ts`) and 5.6 (`auth.ts`), with 5.6 explicitly warned not to assume 5.5's coverage carries over. That warning is warranted — proposal.md/design.md are both explicit that this exact kind of silent gap (fixing one call site, missing the other) already happened once.

### `session-creation` (3 requirements / 6 scenarios)
- Start Session control renders in `lobby`, calls `POST .../start`, updates state in place → 2.1–2.3, tested by 2.5.
- Start Session failure → inline retry, no state advance → 2.4, tested by 2.6.
- Navigate link renders for `pre_session`/`active`/`wrap_up` → 3.1, matching the spec's exact status list (not just `pre_session`).
- Navigate link appears / navigates correctly → 3.2, 3.3.
- Copy alignment (heading + control label) → 4.1, tested by 4.3.

All six scenarios trace cleanly.

### `pre-session-action-item-review` (2 requirements / 2 scenarios)
- `SessionLobbyPage`'s heading/label alignment with `DraftSessionHost`'s → this is the same underlying work as task 4.1 (alignment is inherently bidirectional — one task, one implementation, satisfies both capabilities' requirements), tested by 4.3.
- Non-facilitator waiting copy drops raw `sessionId`, adds reassurance line → 4.2, tested by 4.4.

Both scenarios trace cleanly.

## 3. Ritual-integrity check (my usual lens)

This change doesn't touch vote mechanics, reveal timing, outlier flagging, or action item persistence, so none of my standing concerns about the reveal or the facilitator/participant distinction are at stake in the mechanics here. The one place this change could have blurred the facilitator/participant distinction — the `lobby`-state copy alignment in task 4 — doesn't: task 4.2 is scoped specifically to the *non-facilitator* waiting message on `SessionLobbyPage`, and `DraftSessionHost` remains facilitator-only throughout (unchanged authorization boundary). The two views stay distinct surfaces with aligned wording, not a merged view. Consistent with how I'd want this handled.

## 4. Minor, non-blocking notes

- **Task 1.1 is informational, not actionable** — correctly checked into tasks.md as a recorded decision rather than an open task, and design.md confirms it's resolved and not a gate. No issue, just confirming I read it the same way the design doc intends.
- **Naming collision risk, cosmetic only:** design.md D4 cites an existing test as `SessionLobbyPage.test.tsx "6.4"` (pre-existing coverage that non-facilitators see no Start Session control in the `lobby` branch). That's a different "6.4" than this change's own task 6.4. They don't conflict — one's an existing test ID in another file, the other is this change's verification task — but if this document is skimmed later without the surrounding context, someone could conflate them. Not asking for a rename; just flagging so nobody's confused mid-implementation.

## 5. Conclusion

tasks.md covers the revised proposal's scope completely: every delta-spec scenario across all three capabilities traces to at least one task, the join-link fix is correctly treated as the two-call-site backend change design.md D6 describes, and task 6.4 is unambiguously confirm-only in a way that should prevent an implementer from quietly expanding scope into D7 territory. No changes requested.
