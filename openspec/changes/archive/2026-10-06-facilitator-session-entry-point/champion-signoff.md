Verdict: SIGN-OFF

# Champion sign-off: facilitator session entry point (#237)

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-10-06
**Basis:** archived artifacts in this directory and `git diff packages/` (two frontend pages and their tests, plus three backend regression tests; no production server code changed).

## Did the change preserve the ritual's intent?

Yes. The bug was that the most common kind of facilitator, a senior engineer who has a home team, had no way to reach the one thing their role is for without typing a URL. That works against the ritual spreading without me there to explain it. The fix adds one link and some explanatory copy. It does not loosen any rule.

## Core constraints

- **Facilitator from another team: kept, and better explained.** Enforcement is still on the server only (`/eligible-for-session` exclusion plus the `POST /draft` refusal and audit). The new link goes to exactly `/sessions/new` and carries no team context. Its label says "another team's session", and the help text "You can't facilitate your own team." states the rule. The picker now explains why the user's own team is missing. This was my main worry: if users see an unexplained gap, they report "my team is missing" as a bug, and the obvious fix would make the exclusion optional. Stating the rule plainly in the UI heads that off. The new R5 guard also confirms that an `engineering_manager` membership excludes that team the same way any other membership role does.
- **No manager participates: unaffected.** The link appears only when the server-computed `canFacilitateSessions` is true. R4 is covered from the backend flag (`engineering_manager` gets `false`) through to the link being absent from the DOM. The change adds no participation path.
- **Simultaneous reveal: unaffected.** None of the live-session surfaces changed (`/session/:id`, `/live`, `/facilitator`, `DraftSessionHost`). The change adds no global nav or shared layout, so the tool still stays in the background during a session.
- **Not configurable.** The change adds no toggle, setting or admin override.

## I like that

The empty-state copy no longer claims "you're a member of every team". That claim was already false for deactivated teams. Once #247 lands it would also hint at the hidden reporting-chain exclusion. The copy now states only the membership rule, which makes the change tighter than it needed to be.

## Conditions (not blocking)

1. File follow-ups 1 (resume a session) and 2 (abandon a session) promptly, as adoption-blocking. Until they ship, a facilitator who makes a mistake can still get stuck one screen later.
2. Post the #247 comment. The reporting-chain check must enforce at `POST /draft`, not only in the listing.
3. The R5 guard is a SQL string match. Replace it with a real-Postgres behavioural test before #247 relies on it.
