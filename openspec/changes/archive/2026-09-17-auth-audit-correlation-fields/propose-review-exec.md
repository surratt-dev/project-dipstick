# Executive Review — auth-audit-correlation-fields (GitHub #4)

**Reviewer:** Rachel Okonkwo, VP Engineering
**Verdict:** Approve. Do it before first production deployment, as scoped.

## Strategic alignment

This is a production-readiness item, not a feature request, and it's the kind of gap I'd
rather close now than explain after an incident. If something goes wrong in the auth flow
post-launch and we can't stitch together `auth.callback_received` → `auth.session_created`
→ `auth.success` into one traceable sequence, that's a real cost the first time an engineer
is staring at logs during an incident, not a theoretical one. The failure path already does
this correctly; leaving the success path half-instrumented is exactly the kind of
inconsistency I don't want discovered in production. The fact that the architect already
flagged it as a pre-launch blocker rather than a nice-to-have tells me this was already
triaged correctly — I'm just confirming that triage, not overriding it.

## Scope proportionality

The scope discipline here is good, and I want to call that out specifically because it's
not the default outcome. The proposal explicitly excludes:
- Changing `emitAuditEvent`'s signature or adding logger-level enforcement (a real idea,
  correctly deferred as its own initiative)
- Extending the same fields to `join.link_rejected`/`join.link_redeemed`
- Re-opening two unrelated findings from the same review doc (`missingClaim` precision,
  `session.destroy()` coverage)
- Facilitator/SME sign-off, confirmed unnecessary with Priya rather than assumed away

That's four adjacent, plausible-sounding expansions that got named and declined in writing.
This is what "ship the thing, don't gold-plate it" looks like in practice, and it's the
behavior I want reinforced, not second-guessed.

The change itself is additive-only (three fields, three call sites, reusing a value already
in scope — no new UUID generation, no schema change, no behavior change to redirects or
sessions). Risk is low and well-matched to effort.

## One thing I'll flag, not block on

The proposal/design/tasks trio is appropriately thin for what this is — design.md is
honest that "there is no design decision to make here," which is the right call, not
padding. My only observation is on process weight rather than this document: a three-field
logging conformance fix going through a full multi-stage review pipeline is heavier
process than the change itself warrants. I'm not asking to slow this down or add gates —
the opposite. I'd like engineering leadership to think about a lighter-weight path for
this class of change (small, additive, pattern-conformance, already-triaged) so we're not
spending review cycles proportional to a feature when the change is proportional to a
typo fix. That's a process question for next time, not a reason to hold this one.

## Bottom line

Approved as scoped. This closes a real pre-production gap, doesn't expand into adjacent
work it doesn't need, and correctly skipped a review step (facilitator sign-off) that
didn't apply. Ship it.
