# Champion Sign-off: auth-audit-correlation-fields

**Signed off by:** Devon Calloway (Internal Champion / Principal Engineer, founding advisor)
**Date:** 2026-09-17

---

## Ritual constraints: unaffected, not "respected"

I want to be precise here rather than reflexively checking a box. This change has no
session-flow, ritual, or facilitator-facing surface at all — it's three `emitAuditEvent`
calls inside the OIDC callback handler gaining fields. So the honest statement isn't
"the no-manager rule, simultaneous reveal, and facilitator-from-another-team requirement
were respected" — respected implies they were at stake and held. They weren't at stake.
Nothing in this diff touches session creation semantics, participant roles, reveal
timing, or facilitator assignment. I read the final diff description in the architect and
security implementation reviews to confirm that for myself rather than taking the
proposal's own scope claim on faith, and it holds: `packages/backend/src/routes/auth.ts`
(+5 lines) and its test file (+119 lines), all additions, zero deletions, zero control-flow
changes. The core constraints are unaffected. I'd rather say that plainly than dress up a
non-event as a save.

This matches what I said at exploration and what Priya confirmed independently from the
facilitator side — neither of us found a angle worth manufacturing just to look thorough.

## Did it achieve the actual goal?

Yes, cleanly. The real question for this change was never ritual fidelity — it was
whether a genuine audit-trail gap got closed without the fix growing legs. Ingrid flagged
this as Finding 1 in the first-access review: three sibling emit sites in the same handler
weren't carrying `sourceIp`/`correlationId` that every other event in that handler already
had, which meant incident response couldn't reliably stitch a single sign-in's events
together by correlation ID for exactly the events most likely to matter under pressure
(session creation, success, and the initial callback receipt).

Two things I care about specifically, both confirmed in the implementation reviews rather
than assumed from the proposal:

1. **Same ID, not a fresh mint per site.** This was the one way this change could look
   100% green on tests while still being useless for its stated purpose — a copy-paste
   mistake calling `crypto.randomUUID()` again at each new site instead of reusing the
   binding from handler entry. Both Ingrid and Tomás verified this directly in code (not
   inferred from field names or test names): one `const correlationId` at line 119, read
   by closure at every emit site, never reassigned. And the tests assert this with `toBe()`
   value equality across events, including the failure path, not `expect.any(String)`
   independently per field — which is the only test shape that would have caught the
   mistake I was worried about.

2. **It stayed small.** No touch to `emitAuditEvent`'s signature, no logger-level
   enforcement added, no scope creep into `join.link_rejected`/`join.link_redeemed`, no
   re-litigating the `missingClaim` precision note or the `session.destroy()` coverage gap
   from the same review doc. All of those were live temptations — "while we're in here"
   is how a 3-field conformance fix turns into a redesign — and none of them made it into
   the diff. That's the discipline I was hoping to see, and both reviewers confirmed it by
   diff inspection, not by trusting the proposal's stated boundaries.

## Verdict

**Approved.** This closes a real pre-production gap I'd already flagged (via Ingrid's
review) as something to fix before first deployment, it closes it correctly (identity, not
just presence), and it did not drift scope. Nothing here required my involvement beyond
this confirmation — which is exactly how a well-scoped conformance fix should go. No
concerns, nothing to escalate.
