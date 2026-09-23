# Champion Sign-off — session-timeout-continuity

Reviewer: Devon Calloway (Internal Champion / SME)
Scope: does this change preserve the ritual's intent, leave the protective constraints alone, and actually resolve the problem I traced in exploration?

## Verdict: Sign off. No blocking concerns.

## Did it resolve the actual problem?

Yes. The bug I traced in exploration was concrete: `scheduleForceClose` sent `STALE_SIGNAL_CLOSE_CODE` (the deliberately disclosure-blind code) for the absolute-lifetime force-close, so `connectionHealth.ts` — correctly, by its own non-branching design — treated a 90-minute expiry identically to a wifi blip and retried forever in `unknown-reconnecting`, with no path to `reauth-required` and therefore no path back into the session. Implementation fixed exactly that: `CLOSE_FORCE_EXPIRED` now aliases `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (`websocket-routes.ts`), confirmed distinct from `STALE_SIGNAL_CLOSE_CODE` and test-covered on both sides (force-close disclosed, rejected-subscription still blind). Both the architect and security implementation reviews verified this against the diff, not just design.md's narrative, and I have no reason to re-litigate a finding two independent reviewers already confirmed against the code.

The second half of the fix — the `returnTo` mechanism — is the part I most wanted to see land, because a routing fix that dumps someone on a generic team page instead of back in the room only halves the symptom. That's implemented too: allow-listed by UUID-pinned shape, CRLF/backslash/scheme rejection before the allow-list check, single-use via the same `redis.getdel` pattern `joinToken` already uses, provider-agnostic, and destination authorization re-checked on landing rather than bypassed. This closes the loop I flagged in exploration open question 6 — without it, the close-code fix alone would have been necessary but not sufficient, and it isn't alone.

Non-goal, correctly held: full state restoration (topic position, vote state, readiness grid) on rejoin is still out of scope, because the live-session UI it would restore into doesn't exist yet. That's the right call — I said in exploration this wasn't a smaller fix waiting to be discovered, and the team didn't pretend otherwise.

## Protective constraints — unaffected

- **No-manager rule, facilitator-from-another-team, simultaneous reveal:** none of this change's surfaces (close-code routing, return-to redirect, role-aware copy, facilitator-reconnect indicator) touch role assignment, team membership, or reveal mechanics. Re-authentication runs through the same OIDC flow every login uses; the return-to value is a destination, not a grant, and both design and the security review confirm the destination route re-runs its own authorization on landing rather than the redirect shortcutting it. A facilitator who reconnects resumes a role they already held for that session. Task 5.2 names this explicitly and I have no reason to doubt it.
- **Constraints as configurable options (my standing concern):** nothing here introduces a toggle. The close-code fix and the return-to allow-list are structural, not admin-configurable settings someone could switch off.
- **Feels like software, not a conversation:** the facilitator-reconnect indicator is exactly the register I asked for in exploration if this direction were taken — `role="status"` not `role="alert"`, no countdown, no click affordance, cause-blind. Good restraint.

## One thing I'll flag, not block on

Tomás's implementation security review caught a stale doc-comment on `STALE_SIGNAL_CLOSE_CODE` that still claimed to cover the absolute-lifetime case after the code no longer did. I checked `packages/shared/src/types/ws-close-codes.ts` directly — it's been corrected; both constants' comments now accurately describe current behavior, with the history of the move noted. That's the kind of thing that should have been caught at the same commit that made the change true, not by a security pass after the fact, but it was caught before archive, not left for someone to trip over later. Worth naming so the pipeline notices reviewers are catching doc/code drift that implementation itself introduced — not a pattern I want to see repeat.

## Not our call, correctly deferred

HTTP-side 401 parity for in-session action calls is real and named, not swept under the rug — filed as its own follow-up per task 5.5, distinct from the OR-1.7 restoration follow-up. Good discipline not conflating two "deferred" items that would otherwise get used to justify delaying each other.
