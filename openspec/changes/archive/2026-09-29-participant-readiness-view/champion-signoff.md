# Champion Sign-off — Participant Readiness View (issue #47)

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-09-29
**Verdict:** Clean sign-off, with two follow-ups to track (not blockers) and one to schedule before wide rollout.

## Does this preserve the ritual's intent?

Yes. I looked at this specifically for the things I'd have blocked on, and none of them are present:

- **No-manager rule.** Not only preserved, this change caught and fixed a real, pre-existing hole in it. The security review found that `sessions.ts`'s original EM-exclusion query passed a user with *no* `team_memberships` row at all (`LEFT JOIN` → `membership_role = null` → check skipped) — a non-member could have registered as a participant. The fix replicates `evaluateSessionSubscriberAccess` Path 1's full condition set (membership-exists, membership-not-removed, both the `global_role` and `membership_role` checks) and applies it at both the new registration point and the pre-existing `lock-in` check that shared the same gap. That's the dual-check pattern done right, not loosened, and it's now enforced at two independent layers — registration-time rejection and row-level filtering on the read side — which is exactly the kind of defense-in-depth I want around this rule. No exception, no toggle, no config flag anywhere near it.
- **Facilitator-from-another-team.** Untouched by this change. Not a gap — this view doesn't touch session/facilitator assignment at all.
- **Simultaneous reveal.** Untouched — this is lobby-wait UI, not the voting/reveal flow.
- **Not a performance tool.** The roster shows names to the facilitator only, scoped to one live session, with no cross-session or cross-team surfacing. Engineers get an unchanged waiting screen — no names, no count, no "who's missing" signal — which is a recorded decision, not an oversight. Good.
- **Doesn't turn the ritual into software.** The explicit non-goals (no quorum counter, no "N of M," no facilitator-initiated removal, no "Present" badge — list membership alone is the status) are exactly the restraint I'd have asked for. A quorum counter in particular was on the table and was rejected for the right reason: it invites the kind of head-counting pressure this ritual isn't supposed to create.

This is the strongest example I've seen in this pipeline of the review process doing its job — the EM-exclusion fix wasn't asked for in the proposal, it was found by looking hard at an area the change happened to be touching anyway, and closed in the same pass.

## The three open items

**1. Tasks 6.2–6.4 (true end-to-end tests) not run — unit/component coverage substituted.**
Acceptable to ship with. This is a test-infrastructure gap (no Docker/Postgres stack in the implementation session), not a fidelity gap. Task 6.4 specifically — confirming an EM can't appear in the roster — is covered at two independent unit-tested layers (registration-time rejection, row-level read filter), which gives me more confidence than a single e2e pass would have. I want this run for real before I'd call the feature "proven," but it doesn't need to block merge. Flag it as a tracked follow-up with an owner, not a someday-maybe.

**2. Task 3.5 (disconnected-marker visual) — first-pass placeholder, not yet through Priya's usability review.**
Acceptable to ship with, but I want to be precise about what "acceptable" means here: design.md said this should route through Priya's review "before implementation locks it in," and it shipped without that happening. It's cosmetic — a disclosure-blind marker's color/size/placement doesn't touch any of the constraints I actually protect — so I'm not blocking on it. But it should not quietly become permanent. I'd like it scheduled with Priya before this ships to a second team, not left as a "we'll get to it."

**3. SessionLobbyPage's empty-state roster has no join link (DraftSessionHost does).**
This was flagged by the implementer, not found later — that's the behavior I want to see, and it's why I'm comfortable calling it acceptable. It's isolated, degrades cleanly (the `joinUrl` prop is optional; the empty-state prompt still renders), and doesn't touch any protected constraint — it's a missing convenience line on one of two surfaces, not a broken or silently-wrong one. Track it as a real follow-up, not a shrug.

## Bottom line

No exceptions to the no-manager rule, no configurability introduced anywhere near a protected constraint, no gamification, no cross-session performance surfacing. The three open items are honestly named, none of them are silent, and none of them touch the things I actually lose sleep over. I'd rather see all three closed before this is called "done" in the adoption sense, but none of them should stop this from proceeding to final verification and PR.

**Sign-off: clean.** Proceed, with the three items above carried forward as tracked follow-ups (2 and 3 before next-team rollout; 1 before this feature is called fully verified).
