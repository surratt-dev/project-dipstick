# Proposal Review: session-topics-snapshot-at-creation (#175)

**Reviewer:** Rachel Okonkwo (Executive Stakeholder, VP Engineering)
**Date:** 2026-10-01
**Focus:** Strategic alignment, scope proportional to value, scope creep
**Verdict:** **Approve.** Ship it at top priority, with the conditions below.

---

## 1. Strategic alignment

This is the most important change on the board right now. Every adoption goal I set depends on teams finishing sessions:

- **Success criterion 1** (three teams, six sessions each, with trend data) is impossible today. No team can get past begin-voting.
- **Success criterion 2** (closing an action-item loop across sessions) needs at least two completed sessions.
- **My top adoption risk** is that a champion's first session fails in front of their team. The proposal says it plainly: "A team that hits it once will not give the tool a second session." I agree. We have been building features on a main path that does not work.

The fix also supports the long-term value of the product. Locking the list at room open is what makes session N comparable with session N+1, and that comparability is the whole basis of the trend dashboard, which is the feature I care about most. Leaving history untouched (FR-8.3, no edits to existing `session_topics` rows) matches my expectation that we keep data indefinitely.

## 2. Is the scope proportional to the value?

Mostly yes. I checked each item against one question: does a first team need this to run a real session safely?

| Item | Needed for first team? | Comment |
|---|---|---|
| Snapshot at room open (D2/D5/D7) | Yes | This is the fix. |
| Conditional transition / double-click (D6) | Yes | A double-click must not produce a broken session. It is cheap. |
| Zero-active-topic guard (D4) | Yes | It replaces a dead end with a clear next step. That is onboarding work, which I asked for. |
| Confirm copy with count (D3) | Yes | It makes the "teams adapt between sessions, not during one" rule visible at the moment it applies. |
| R5 `current_topic_id` id-space fix (D8) | Yes, and it is borderline | It is not this bug, but it would be the *next* thing to break the first time someone reconnects mid-session. Fixing it now is cheaper than a second failed pilot. Keep it in, and keep it as narrow as written. |
| `room_opened_at` column (D9) | Marginal | It is one nullable column and keeps the reorder hint honest. It is acceptable because it is small and additive. Do not let it grow. |
| Audit metadata (D12) | Marginal | It is cheap and useful for diagnosing "what list did this session run on." It holds topic ids only and no individual data, so it raises no surveillance concern. |
| Document reconciliation (9 docs) | No, but required for hygiene | It is fine to do. It **must not gate the release**. If it slips, ship the code and finish the docs in a fast follow. |

The Non-Goals are the strongest part of the proposal. Expired-draft handling, `topics[]` in responses, Redis session state, the in-session topic display (#56/#57), "last look" lists, and new hint copy are all deferred. That is the discipline I asked for. Please hold that line during implementation. If someone says "while we're in here," the answer is a new issue.

## 3. Scope-creep flags

1. **Watch the docs workstream.** The docs reconciliation (tasks section 9) is about as large as the code change. It is valuable, but it is the most likely place for this change to stall. Treat it as non-blocking.
2. **R5 has to stay a single fix.** It resolves one id-space and corrects `redis-session-model.md`. It does not start any Redis work (the proposal already says this, and I am repeating it on purpose).
3. **The backfill stays an operator question, not engineering work.** The closed yes/no question and the "No (expected)" path are the right size. Build the one-off script only if the answer is Yes.

## 4. Conditions and asks

1. **Add an end-to-end regression test that becomes a standing CI gate.** My bigger concern is how a core-path break like this shipped through several merged features. Tasks section 8 adds e2e tests. At least one of them must cover the full path draft → open room → begin voting → advance through all topics → wrap_up, and it must run on every PR from now on. I want this to be the one test that can never be skipped.
2. **Keep the Priya walkthrough as a release gate**, and once it passes, have a real team run their first session on it soon after. This change is what makes the first-team pilot possible. Let's put the pilot on the calendar now so the momentum doesn't stall.
3. **Check the confirm copy with a first-time facilitator.** "This cannot be undone" is honest, but it should not scare a new champion off their first session. Priya should confirm it reads as reassuring and not alarming. This is a copy check only. It should not trigger a redesign.
4. **Keep the snapshot non-configurable.** I support this constraint strongly. A setting would weaken trend comparability across the organization, and I would not support adding one later without coming back to me.

## 5. Policy check (my non-negotiables)

- **Data access controls:** The change is unaffected. No new data is exposed to any role.
- **Manager read-only boundary:** The change is unaffected. Room open is a facilitator action.
- **Data longevity:** It improves. Past rows are preserved and archived topics stay in history.

No policy concerns.

---

**Bottom line:** This proposal fixes the core path, holds a tight Non-Goals list, and every added item either prevents the next pilot failure or is too small to argue about. Approve and prioritize it. Don't let the docs work hold up the release, and make the full-ritual e2e test permanent so we never ship a broken main path again.
