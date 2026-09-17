# Executive Review — oidc-error-log-sanitization

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Focus:** Strategic alignment and scope proportionality
**Verdict:** Approve. Scope is proportional to the risk being closed — this is not creep, it's the difference between actually closing the gap and closing the one call site the issue happened to name.

---

## Why I'm approving the expanded scope

This is a pre-production security blocker, not a feature. The "ship a thin slice to one team, iterate" guidance I give elsewhere doesn't transfer cleanly to "must resolve before first production deployment" — there's no team using a partially-sanitized auth error path today to learn from, and there's no safe way to "iterate" your way into not leaking a third-party IdP's free text into our logs. You either close it or you don't.

Against that standard, the three places scope grew beyond the literal issue text all hold up:

- **All three call sites, not just `handleCallback()`.** The issue named one catch block; the audit found the same unsanitized error can reach a logger from `refreshToken()` and — worse — from `getEndSessionUrl()`, which doesn't even have a try/catch today. Shipping a fix that only covers the call site named in the ticket while leaving two other sinks wide open isn't a smaller version of this fix, it's a fix that doesn't fix the problem. I'd have sent this back if it had stopped at one call site.
- **The regression test suite.** The design document is candid that today's safety on half of these error classes is an accident of how `pino-std-serializers` walks non-enumerable properties — not a designed guarantee. A security fix with no test enforcing it is a security fix that silently stops being true on the next dependency bump. Given this, and given our standing requirement that the app not be Entra-only ([[project_oidc_multi_provider]]), I want the discipline that keys this off stable error *classes* instead of provider string-matching, and I want a test that would catch a regression before a customer does. That's not gold-plating, that's the deliverable.
- **The onboarding code comment.** Cheapest line item in the whole change. A few lines that stop the next engineer from re-introducing this exact leak when they add a fourth call site. Keep it.

## Where I'd push back if this were bigger

If this proposal had also included the debug-level `error_description` capture, the dependency re-pin, or pre-verification against a second, not-yet-selected IdP, I'd cut all three — and the proposal already agrees, listing them as explicit deferrals rather than building them speculatively. That's the right instinct: name what you're not doing and who owns the decision, rather than quietly doing it or quietly dropping it. Good discipline, keep doing this on future security work.

## Two things to tighten before this ships, not scope changes

1. **The log-policy sign-off is an open question in design.md, not a blocking dependency in tasks.md.** If "final sign-off on the field allowlist from whoever owns log policy" is truly non-blocking, say so explicitly in the PR description so nobody stalls this pre-production blocker waiting on an approval that was never required to ship. If it *is* required, it needs to be a task, not an open question.
2. **The four deferred items (debug-capture, dependency re-pin, multi-provider re-verification, lint-rule hardening) need to land as tracked GitHub issues, not just PR-description prose.** A note in a merged PR description is where organizational follow-through goes to die. This is the same pattern I'd flag on any team's retro action items — surfaced but not tracked doesn't count as closed the loop.

## Bottom line

Proportional to the value: a production launch blocker gets closed completely, not partially, with just enough regression coverage that "completely" stays true after the next `npm update`. Ship it.
