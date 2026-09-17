# Design Review Disposition — auth-audit-correlation-fields

Reviewed by: Ingrid Sollenberger (Solution Architect)

Both design reviews (Marcus Oyelaran — engineering, Tomás Ferreira — security) returned
**Approve / Approved, no blocking findings.** This is a proportionality pass over their
combined feedback: one factual correction made, everything else left as-is with reasons.

## Corrected

**design.md — join-flow scope-out rationale (Tomás, blocking-for-accuracy).** The Non-Goals
section stated `correlationId` is "technically in closure scope" inside `executeJoinFlow`,
which is why `join.link_rejected`/`join.link_redeemed` are excluded from this change. I read
`packages/backend/src/routes/auth.ts` directly to verify: `executeJoinFlow` (line 541) is a
standalone top-level `async function` with explicit parameters `(userId, token, logger,
sourceIp)`, not a nested closure over the callback handler's locals. `correlationId` is not
already available there for free — it would need to be threaded through as a new explicit
parameter, exactly as `sourceIp` was for Finding 2 in the first-access review. I corrected
the sentence in design.md to state this plainly. The scoping decision itself (defer to a
follow-on, don't touch it in this change) is unaffected — Tomás agreed with the call, and so
do I — but a future implementer reading design.md should not underestimate that follow-on as
a one-line addition.

**exploration-notes.md has the same error** (same sentence, under "Scope guardrails," line
~65: "even though `correlationId` is technically in closure scope there too"). I'm not
editing it — it's a frozen historical record of Devon's exploration, not a live spec
implementers act on, and rewriting after-the-fact review conclusions into a dated
exploration doc would misrepresent what was known at the time it was written. Flagging it
here so the record is complete: exploration-notes.md's join-flow reasoning is superseded by
this correction, and design.md is the document of record going forward.

## Left as-is

**Marcus's observation 1 — Task 2.2 doesn't test the `role_claim_mapped` branch, only
`first_access_created`.** Not worth a tasks.md change. `role_claim_mapped` already emits the
correct `correlationId` binding today — it's untouched by this change's diff (the three
call sites this change modifies are `callback_received`, `session_created`, `success`).
Adding a test for a pre-existing, already-correct code path in a change scoped to be a
three-field, single-pass conformance fix would be testing something this change doesn't
touch, in a proposal that both reviewers and the exploration notes explicitly want to stay
small enough to review in one pass. Marcus flagged it as non-blocking and said he wouldn't
block on it; I agree it's a reasonable future belt-and-suspenders addition but not a reason
to expand this change's task list.

**Marcus's observation 2 — join-event asymmetry (`sourceIp`-only, no `correlationId`) is a
real but deliberate inconsistency.** No action needed beyond the design.md correction above.
This was already disclosed as an explicit Non-Goal before this review, and remains one —
Marcus's note confirms it's understood, not hidden, and Tomás independently reached the same
conclusion (safe to scope out, no security control depends on it). Nothing to add to
tasks.md; the scope-out itself was never in question, only the stated *reason* for it, which
is now fixed.

## Net effect

One sentence corrected in design.md. No task.md changes. No re-scoping. Both reviews'
substantive conclusions (approve, no design changes needed) stand unchanged — this
disposition addresses documentation accuracy only.
