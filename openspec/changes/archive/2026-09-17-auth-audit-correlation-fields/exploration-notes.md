# Exploration Notes: auth-audit-correlation-fields

**Explored by:** Devon Calloway (Internal Champion / Principal Engineer, founding advisor)
**Date:** 2026-09-17
**Issue:** GitHub #4 — `auth.success` / `auth.session_created` missing `sourceIp` and `correlationId`; `auth.callback_received` missing `correlationId`

---

## What this actually is

This is not a ritual-design question. It doesn't touch the no-manager rule, the facilitator constraint, topic guardrails, or anything performance-comparison-adjacent — none of the things I'd normally expect to be pulled in on. It's a conformance fix: three audit emit calls in one already-well-specified handler are missing fields that every sibling event in the same handler already carries.

The intent was already decided, twice over:

- **SEC-12** (BRD §10.3): the audit log exists so incident response can reconstruct a sequence of events after the fact. That's the whole job of `correlationId` — stitching one callback invocation's events into a sequence.
- The **first-access design** already states the invariant directly: "every other security-relevant audit event in the system includes both `sourceIp` and `correlationId`." That sentence is the spec. This change makes the code match a rule the project already wrote down, not a new rule.
- Ingrid flagged it explicitly as Finding 1 in the first-access implementation review and scoped it out deliberately ("pre-existing gap... should be resolved before first production deployment"). Nothing to relitigate — it's follow-through, not new design.

So my read: this doesn't need a design.md worth arguing over. It needs a proposal that says "close the gap Ingrid already named," a spec delta that states the completed invariant, and tasks that are basically the diff. Keep it that size. If this grows a design doc with alternatives-considered sections, that's the wrong altitude for the change.

**Additive-only, for the record:** this change adds fields to existing event shapes. It does not rename or remove anything, does not change `emitAuditEvent`'s signature, and does not raise a new data-classification question — `sourceIp` and `correlationId` are already-approved field types under SEC-16, already emitted by other events in this same file. The proposal's acceptance criteria should say this directly, not leave it implied by this document, since exploration notes don't ship and proposal.md/tasks.md are what an implementer actually opens.

## Grounding in the actual code

`packages/backend/src/routes/auth.ts`, inside `GET /callback`:

- `correlationId` is minted once at the top of the handler (`crypto.randomUUID()`, line 119), before the `try` block. It is already in scope at every emit site that needs it — `callback_received` (171), `session_created` (279), `success` (284) all execute inside that same closure. There is no threading problem, no parameter-passing problem. This is a three-line-diff fix, maybe five with the test updates.
- `request.ip` is likewise already used at every other emit site in this handler (`authorization_initiated`, `callback_received`, all three `auth.failure` sites). Same story — just add it to the two calls that omit it.
- Compare to `auth.first_access_created` (227) and `auth.role_claim_mapped` (242), added by the first-access change: both already carry `sourceIp: request.ip` and `correlationId`. Those are the pattern to copy, not invent.

The one thing worth being careful about, precisely because it's so mechanical: the fix is not "add a `correlationId` field," it's "add *this specific* `correlationId` value" — the one already bound in the closure. If someone "fixes" this by calling `crypto.randomUUID()` fresh at each of the three sites (an easy typo-shaped mistake when copy-pasting the `first_access_created` shape), every event gets a different ID and the audit trail is *more* broken than before — it would look complete while still being useless for tracing a single sign-in through the log. The whole point of the field is that it's the same value across `callback_received` → `first_access_created`/`role_claim_mapped` → `session_created` → `success`. That's the one place I'd want a reviewer's eye, not because it's hard, but because it's the one way to get 100% test-green code that doesn't actually fix the incident-response use case in the issue description.

This is important enough to state as its own numbered acceptance criterion rather than leave as narrative, since it's exactly the kind of thing a skimming implementer misses:

> **AC1 (identity, not just presence):** All audit events emitted during a single `GET /auth/callback` invocation MUST carry the *same* `correlationId` value — the one instance already bound via `crypto.randomUUID()` at handler entry (line 119) — not a freshly generated UUID per emit site. This applies to `auth.callback_received`, `auth.session_created`, `auth.success`, and whichever of `auth.first_access_created` / `auth.role_claim_mapped` fires.
>
> **AC2 (presence):** `auth.success` and `auth.session_created` each carry `sourceIp` and `correlationId`; `auth.callback_received` carries `correlationId` (it already has `sourceIp`).
>
> **Test requirement:** at least one test must assert cross-event identity directly — `expect(eventA.correlationId).toBe(eventB.correlationId)` — not merely that each field independently matches `expect.any(String)`. Field-presence assertions alone would pass a same-shape-wrong-value implementation, which is the failure mode AC1 exists to rule out.

## Test coverage — what "done" should assert

`auth.test.ts` already has the right shape to copy, from the Task 21 test (lines 408–465) for `auth.first_access_created`:

```ts
expect(auditFields).toMatchObject({
  ...
  sourceIp: expect.any(String),
  correlationId: expect.any(String),
});
```

That pattern is necessary but not sufficient here, per the note above. New tests for `auth.success` / `auth.session_created` / `auth.callback_received` should:

1. Assert both fields are present (mirrors the existing pattern — cheap, consistent with house style).
2. Assert the **same** `correlationId` value appears across all the events emitted in one successful callback invocation (`callback_received`, `session_created`, `success`, and `first_access_created`/`role_claim_mapped` where applicable). This is the assertion that actually encodes the issue's stated purpose ("trace a complete authentication event through the audit log by correlation ID") rather than just checking field presence.
3. Assert the same `correlationId` identity holds across the **failure path** too: `auth.callback_received` → `auth.failure`, for at least one scenario where `handleCallback` throws (or claims validation rejects) after `callback_received` has already been emitted. This isn't scope creep — the issue's own stated purpose is tracing "a complete authentication event" through the log, and a failed sign-in is exactly the kind of event an operator is tracing under pressure. It's only testable once `callback_received` carries `correlationId`, which this change already does — so it costs nothing extra to assert.

This mirrors the existing `join.link_rejected` / `join.link_redeemed` precedent (tests 11.6/11.6b, from Finding 2 of the same review) — that fix and its tests already shipped, so there's a recent, in-repo example of exactly this class of "thread the real value through instead of a placeholder" fix and how it was tested. Worth reading before writing tasks.md.

## Scope guardrails (the part I'd actually push back on if it drifted)

- **Don't touch `emitAuditEvent`'s signature or add field-presence validation/enforcement to the logger itself.** It's tempting to say "let's make `sourceIp`/`correlationId` required at the type level for all security-relevant events so this class of gap can't recur." That's a legitimate idea, but it's a bigger, separate initiative (touches every call site in `audit-logger.ts`'s ~30-event union) and it's not what issue #4 asks for. If someone wants to propose that, it should be its own change, not smuggled into a 3-field bug fix.
- **Don't re-open the `missingClaim: "sub"` vs `"id_token"` precision note (implementation-review-architect.md, under "MissingClaimError usage") or Finding 3, the `session.destroy()` test-coverage gap.** The review doc numbers only three Findings; the `missingClaim` item is an unnumbered precision note, not "Finding 4" — cite it by name if it comes up, not by a number that won't resolve for anyone checking the source doc. Both items are separate, already-tracked, and out of scope here — pulling them in just because they're in the same review doc dilutes a fix that should be trivially reviewable in one pass.
- **`join.link_rejected` / `join.link_redeemed` (inside `executeJoinFlow`) do not receive `correlationId` in this change**, even though `correlationId` is technically in closure scope there too. Issue #4 doesn't name them, and they're not part of the invariant this change is closing. It would be easy to pull them in by analogy — `correlationId` is in scope the same way `request.ip` was before Finding 2 threaded it through as a parameter — but that analogy isn't the issue in front of us. Extending correlation coverage to the join flow, if wanted, is its own follow-on change.
- **No PII risk to check for** — `sourceIp` and `correlationId` are both already-approved field types under SEC-16 (audit log must not contain sensitive data values); every existing security-relevant event in this file already emits both. This is pure conformance, not a new data-classification question.

## Why I'd rather this ship boring

This is exactly the kind of gap I don't want to be the escalation path for. The intent was already written down by the BA (SEC-12/13) and confirmed by the architect (Finding 1). If the team needs to come back to me to ask "does correlationId matter here," the requirements docs already failed at their job. My only real input is the one flagged above — same ID, not a fresh one per call — and that's a code-review-level catch, not a design decision. Proposal and tasks should stay small enough that this is obviously true to whoever picks it up next.

## Reviewer sign-off scope

This is a backend audit-logging conformance fix with no session-flow or facilitator/participant-facing surface. Priya (Facilitator SME) reviewed it and confirmed none of her usual criteria — reveal simultaneity, readiness-without-spoilers, outlier-flagging tone, facilitator pacing, first-session onboarding — apply. The proposal's reviewer-sign-off section should state plainly that Facilitator/SME sign-off is not required for this change, reason: no session-flow or facilitator-surface impact. That's so nobody routes this to her later out of process habit, and so her absence from the reviewer list doesn't read as an oversight.

---

## Feedback disposition

Marcus's BA review (5 points) and Priya's facilitator review are both incorporated above as written — no pushback needed. Marcus's catches are exactly the kind of thing this document exists to surface before an implementer opens it: the cross-event-identity requirement was genuinely under-promoted from prose to a testable AC, the join-flow boundary was genuinely undeclared even though the underlying scoping decision was already correct, the failure-path chain is genuinely in scope per the issue's own purpose and I under-scoped it in the first pass, and the "Finding 4" citation was genuinely wrong — I checked the review doc directly and it only numbers three Findings. Priya's ask (state non-applicability of Facilitator sign-off in the eventual proposal) is cheap, correct, and prevents a future misroute. Nothing here asks for scope beyond issue #4's stated intent, and nothing softens or works around a protective constraint, so there's nothing to reject.
