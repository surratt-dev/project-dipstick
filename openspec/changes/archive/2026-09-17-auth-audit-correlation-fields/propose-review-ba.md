# BA Review: proposal.md / design.md / tasks.md — auth-audit-correlation-fields

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-09-17
**Verdict:** Buildable as written. All five concerns from my exploration-stage review (`explore-review-ba.md`) made it into the artifacts an implementer will actually open — not just into notes that don't ship. I re-verified the underlying claims directly against `packages/backend/src/routes/auth.ts` and the architect's first-access implementation review rather than trusting the citations; they hold up.

---

## Continuity check: did my five exploration-stage concerns survive into proposal.md/design.md/tasks.md?

### 1. "Same correlationId, not a fresh one per site" as a numbered, testable AC — **Yes, and it's the sharpest thing in the document**

This is now **AC1** in proposal.md, stated as a standalone bullet, not buried in prose: same `correlationId` value across every emit site in one invocation, explicitly including the failure path. It's echoed in three places that each get read at a different point in the lifecycle — design.md's Decisions section (with the exact anti-pattern named: "never call `crypto.randomUUID()` again at any of the three new call sites"), tasks.md 1.1 ("do not call `crypto.randomUUID()` again"), and the spec delta's new scenario "Correlation ID is identical across all events from one callback invocation." A developer would have to skip all four to miss it. That's the redundancy this AC deserves given how easy the wrong-but-green implementation is to write.

### 2. Join-flow exclusion stated explicitly, not left as an inferable omission — **Yes**

Proposal.md's "Explicitly out of scope" bullet: "no `correlationId`/`sourceIp` added to `join.link_rejected`/`join.link_redeemed` (a separate event family issue #4 doesn't name — its own follow-on if wanted)." Design.md's Non-Goals repeats it with the reasoning I flagged (`correlationId` is technically in closure scope in `executeJoinFlow` too, which is exactly why an implementer could otherwise pull it in by analogy). Stated out loud in both places — good.

### 3. Failure-path correlation coverage in the test plan — **Yes**

Tasks.md 2.3 is now a named task: assert `auth.callback_received`'s `correlationId` equals `auth.failure`'s, using "the existing missing-claims rejection tests" as the vehicle — which is grounded; I checked `auth.ts` lines 192–201 and the `MissingClaimError` path fires after `auth.callback_received` (line 171) already emitted, so that scenario genuinely exercises the chain. The spec delta's new scenario also states this branch explicitly rather than leaving it implied by the success-path scenario alone.

### 4. Correct Finding citation — **Yes, and I checked it against the source document, not just the proposal's wording**

I read `openspec/changes/archive/2026-07-05-first-access/implementation-review-architect.md` directly. Finding 1 there is titled "`auth.success` and `auth.session_created` lack `sourceIp` and `correlationId` (minor, pre-existing)" and its body names exactly the three call sites this change touches, including that `auth.callback_received` "includes `sourceIp` but not `correlationId`." Proposal.md's "(Finding 1)" citation resolves correctly. The review document numbers only three Findings total, and the `missingClaim: "sub"` vs `"id_token"` item — which is a separate, unrelated item from a different review — is correctly referred to in proposal.md as "the `missingClaim: \"sub\"` vs. `\"id_token\"` precision note," not as a numbered Finding. This is the fix I asked for.

### 5. Additive-only / no data-classification statement, in proposal.md itself — **Yes**

Proposal.md carries its own bullet: "Additive-only, no new data classification: this adds fields to existing event shapes... `sourceIp` and `correlationId` are already-approved field types under SEC-16 and already emitted by other events in this same handler, so no new data-classification review is triggered." This is the sentence I asked to see promoted out of exploration-notes.md; it's now somewhere an implementer six weeks out will actually see it.

---

## Grounding check (verified against current code, not taken on faith)

- `correlationId` is minted once via `crypto.randomUUID()` at `auth.ts:119`, before the `try` block — confirmed in scope at every site this change touches.
- Current state matches every claim in the proposal: `auth.callback_received` (line 171) has `sourceIp` but not `correlationId`; `auth.session_created` (line 279) and `auth.success` (line 284) have neither field; `auth.first_access_created` (line 227) and `auth.role_claim_mapped` (line 242) already carry both, confirming they are the correct pattern to copy.
- SEC-12 ("primary mechanism by which... incident response can reconstruct a sequence of events") is the correct requirement to cite for the "Why" — this is squarely a reconstruction-capability gap, not a new-event-type question (SEC-13) or a data-minimization question (SEC-16, which is correctly cited instead for the additive-only claim).

## Remaining observations (none blocking)

- **Reviewer sign-off scope bullet** in proposal.md ("confirmed with Priya... found none of her usual criteria... apply") is a good practice I'd like to see carried forward as a pattern on future backend-only changes — it closes off a predictable "why didn't the Facilitator SME weigh in" question before it's asked.
- Tasks.md 3.2 ("confirm no other emit site, test, or type... was touched beyond the three call sites") is a scope-fence assertion I like — it gives the implementer a checkable definition of "did I stay in scope" rather than a vague reminder.
- No new acceptance-criteria gaps found. I have no outstanding requests before this moves to implementation.

## Traceability

- GitHub issue #4 → SEC-12 (audit log reconstruction capability) → `auth-error-handling` spec's "Authentication event logging" requirement → this change's AC1/AC2 → tasks 1.1–1.3, 2.1–2.3. Chain holds end to end; a scope dispute during implementation has a documented answer at every link.
