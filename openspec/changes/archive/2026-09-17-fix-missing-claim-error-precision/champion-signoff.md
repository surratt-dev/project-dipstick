# Champion Sign-Off — fix-missing-claim-error-precision

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion)
**Date:** 2026-09-17
**Verdict:** Signed off. No concerns.

## What I checked

This change relabels one audit field. When `tokens.claims()` comes back `null` in `/auth/callback`, the code used to throw `MissingClaimError("sub")` — which tells whoever's reading the audit trail a story that isn't true, since nothing was ever inspected for a `sub` claim. It now throws `MissingClaimError("id_token")`, which says what actually happened. That's it. `mapAuthError` has no diff, the user-facing sign-in error is byte-for-byte the same, and the `sub`-absent / `iss`-absent branches are untouched.

## Ritual intent

Not applicable to this change, and I mean that as a compliment to how it was scoped. The three constraints I actually lose sleep over:

- **No-manager-participation rule** — untouched. This diff is nowhere near session participation.
- **Simultaneous reveal** — untouched. Nothing here touches session mechanics or timing.
- **Facilitator-from-another-team** — untouched. Nothing here touches session setup or facilitator assignment.

This is the OIDC login path, shared infrastructure that facilitators and participants both pass through before they ever get near a session — but the change only touches what gets written to the audit log *after* a login already failed. A participant or facilitator hitting this failure sees the exact same generic error screen before and after. Good — that's the right instinct anyway; a login failure page is not the place to leak which specific validation step tripped.

## Why I'm comfortable calling this "not my kind of decision"

I've said before that the constraints I care about need to be structural, not preferential, and that I don't want to be the help desk for every edge case. This change is a good example of the team correctly not escalating something to me: it's a one-string diagnostic-label fix with no architectural surface, and the design doc says so plainly instead of manufacturing a design discussion that doesn't need to happen. The risk they *did* flag — someone later extending this into a `mapAuthError` branch that shows a different user-facing message per claim — is exactly the kind of scope creep I'd want caught, and they called it out explicitly as out-of-scope in both the proposal and tasks so a future reviewer has grounds to reject it. That's the documentation habit I want more of, not less.

One process note, not a blocker: task 4.4 (PR description flagging the `missingClaim` string change for anyone with an external SIEM/alert rule keyed on `"sub"`) is unchecked in `tasks.md`. Worth confirming it actually went into the PR description before this is fully closed out, but it has no bearing on the ritual and doesn't change my sign-off.

## Bottom line

Correct, narrowly scoped, honestly labeled as carrying no design decision — and it makes the audit trail tell the truth, which is the same property that makes session history and trend data worth trusting once a Health Check session is over. Approved.
