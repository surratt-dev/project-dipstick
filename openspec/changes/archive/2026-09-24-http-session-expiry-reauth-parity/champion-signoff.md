# Champion Sign-off — http-session-expiry-reauth-parity

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-09-24
**Verdict:** Approved. No concerns blocking.

## Ritual intent

Nothing here touches the ritual itself. This is error-handling plumbing sitting on top of already-shipped session and auth logic — no changes to `ReauthRequiredTreatment.tsx`, the WS state machine, or any backend authorization check. The three constraints I actually care about are unaffected because this change doesn't go near them:

- **No-manager rule** — not touched. `checkAssignRolesAuthorization` and `canFacilitateSessions` are read by this change, never modified.
- **Simultaneous reveal** — not in this change's surface area at all.
- **Facilitator-from-another-team** — not touched. `SessionCreationPage.tsx`'s eligibility check is unchanged; this change only adds a reauth banner to what was already a generic error on that page's two fetches.

If a facilitator's session expires mid-ritual, they now get told the truth ("log in again") instead of a "try again" message that can't succeed. That's a strict improvement to the ritual feeling honest, not a risk to it.

## Scope discipline

This is the part I actually spent my review time on, and it holds up. `MemberManagement.tsx`'s `loadMembers` GET and the `teams.ts` category-label fix are named as deferred in proposal.md, not silently dropped — and there's a filed issue (#159) linking them forward, per tasks.md 7.1. I checked the issue number appears in both proposal.md and tasks.md consistently. Good.

I also want to flag, approvingly, that scope moved in the *right* direction mid-review: the BA's Finding 1 caught that `MemberManagement.tsx` isn't one call site, it's two, and pulled `submitRoleChange` back in after the original draft deferred the whole component. That's scope discipline working as intended — narrowing a blanket deferral to the piece that actually needed the fix, not scope creep. The distinction the proposal draws (mutating, capability-gated, two-step confirm vs. read-only roster GET) is the right line.

## No-partial-execution

Verified this is load-bearing and actually holds, not asserted. `authMiddleware`'s `onRequest` hook runs before any route handler, confirmed in `app.ts` — a `session_expired` 401 on `advance` or `submitRoleChange` genuinely means the action never ran server-side. Both "cannot be undone" promises stay honest. Tasks 8.1 and 8.2 test this directly rather than assuming it from the design doc, which is the right call — I'd have asked for exactly that if it weren't already there.

The one thing worth naming out loud, which the design doc already names itself: this guarantee depends on hook registration order in `app.ts`, not just on `middleware.ts`'s own logic. That's an implicit dependency someone could break in an unrelated future PR without touching this change's files at all. Not a blocker — it's documented, and the architect's sync-verification flagged the same thing — but if `app.ts`'s route registration is ever touched, whoever does it should know this guarantee is sitting there.

## Visual sign-off (4.6)

I looked at both screenshots. The reauth banner is a full-page early-return replacement — the confirm dialog's buttons are entirely gone from the DOM, not layered under or behind the banner. No misclick risk between "Yes, open the room" and "Log in again." This is the one place in this change I'd have pushed back hardest on if it had come back as an overlay, given a facilitator under time pressure is exactly the person most likely to fat-finger the wrong button. It didn't — good.

## Application-feels-like-software concern

Doesn't apply here. This is one inline banner, no new chrome, no notifications, no gamification. If anything it's the same treatment component the WS side already uses, reused verbatim rather than reinvented. Consistent with disappearing into the background once the reauth click is made — which is the right amount of software for a page that just told someone to log back in.

## Bottom line

Approved as archived. Nothing here required my involvement to resolve — the BA's review caught the one real gap (the `MemberManagement.tsx` split), and the architect's sync-verification caught the one structural risk worth naming (hook ordering). That's the process working the way I want it to: I get consulted for sign-off, not as the help desk for finding the issues in the first place.
