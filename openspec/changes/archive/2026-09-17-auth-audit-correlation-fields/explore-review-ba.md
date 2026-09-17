# BA Review: exploration-notes.md — auth-audit-correlation-fields

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-09-17
**Verdict:** Close to buildable. One acceptance criterion needs to be made explicit rather than implied, one scope boundary is undeclared (not wrong, just unstated), and the failure-path half of the issue's own stated purpose is missing from the test plan. None of this requires new discovery — it's tightening language, not re-opening intent.

I checked the exploration notes against `packages/backend/src/routes/auth.ts` and `auth.test.ts` directly rather than taking the line-number citations on faith. They hold up: `correlationId` is minted once at line 119 and is in scope at all three emit sites named in the issue; `callback_received` currently has `sourceIp` but not `correlationId`; `session_created` and `success` have neither; `first_access_created`/`role_claim_mapped` already have both and are the correct pattern to copy. I also confirmed Finding 2 (join hardcoded `sourceIp: "callback"`) already shipped — `executeJoinFlow` now takes `sourceIp` as a parameter and tests 11.6/11.6b assert a real IP — so citing it as a precedent rather than open work is accurate.

---

## 1. The "same correlationId" requirement needs to be a stated acceptance criterion, not a prose aside

The notes get the substance exactly right in the "one thing worth being careful about" paragraph (lines 29, 46) — this is the sharpest observation in the document, and it's the one I'd be most worried about surviving contact with an implementer if it stays where it is. Right now it lives inside narrative explanation and a bullet under "what done should assert." That's discoverable if you read the whole doc closely. It is not discoverable if you skim to a task list.

**Why this matters more than it looks like it does:** this is exactly the failure mode I'd flag from the QA-instinct side of my job — "but what happens when someone does it almost right." A developer who copies the `first_access_created` shape (the notes' own suggested approach) and calls `crypto.randomUUID()` at each new emit site produces code that is green on a naive "field is present" test, ships, and is *more* broken than the current state for the one thing the issue exists to fix (tracing one sign-in through the log). That's not a hypothetical edge case, it's the most likely way this gets implemented wrong, precisely because the correct and incorrect versions look identical at the field-presence level.

**Suggested rewrite — promote this to a first-class, numbered acceptance criterion in the proposal, separate from and above the field-presence criterion:**

> **AC1 (identity, not just presence):** All audit events emitted during a single `GET /auth/callback` invocation MUST carry the *same* `correlationId` value — the one instance already bound via `crypto.randomUUID()` at handler entry (line 119) — not a freshly generated UUID per emit site. This applies to `auth.callback_received`, `auth.session_created`, `auth.success`, and whichever of `auth.first_access_created` / `auth.role_claim_mapped` fires.
>
> **AC2 (presence):** `auth.success`, `auth.session_created` each carry `sourceIp` and `correlationId`; `auth.callback_received` carries `correlationId` (it already has `sourceIp`).
>
> **Test requirement:** at least one test must assert cross-event identity (`expect(event1Fields.correlationId).toBe(event2Fields.correlationId)`), not merely that each field independently matches `expect.any(String)`. Field-presence assertions alone would pass a same-shape-wrong-value implementation.

This isn't new content — it's taking sentence 2 of paragraph 3 under "Test coverage" and giving it the visibility level its own risk deserves.

## 2. Undeclared scope boundary: does `correlationId` extend into `executeJoinFlow`?

The notes correctly keep `join.link_rejected` / `join.link_redeemed` out of scope by omission — issue #4 doesn't mention them, and they're not in the exploration's list of events to fix. But the notes don't say this *out loud*, and I think it needs to, for a specific reason: `executeJoinFlow` is called from inside the same `/callback` closure, `correlationId` is in scope there too (same as `request.ip` was, before Finding 2's fix threaded it through as a parameter), and join events currently emit neither field. An implementer who has just read "thread the real value through instead of a placeholder" (the notes' own framing of the Finding 2 precedent, section heading before the scope guardrails) has a natural, reasonable path to conclude join events should get `correlationId` too, by the same logic, in the same PR.

I'm not saying that would be wrong on the merits — arguably a sign-in that ends in a join redirect *is* one traceable event from the operator's point of view. I'm saying the exploration notes have an opinion on every other adjacent temptation (don't touch `emitAuditEvent`'s signature, don't re-open the two review findings) but are silent on this one, and it's the one most likely to get pulled in by analogy rather than by re-reading the issue. This is a five-word fix, not a re-think:

> **Add to Scope Guardrails:** "`join.link_rejected` / `join.link_redeemed` do not receive `correlationId` in this change. They are a separate event family the issue does not name; extending correlation coverage to the join flow, if wanted, is its own follow-on."

## 3. The test plan covers the success path's correlation chain but not the failure path — and the issue's own stated purpose is agnostic between them

This is the one place I think the exploration under-scoped rather than correctly scoped-out. Once `correlationId` is added to `auth.callback_received`, that event's `correlationId` becomes comparable against `auth.failure`'s (which already carries it, same minted value) for any callback that reaches `callback_received` and then fails downstream — e.g., `handleCallback` throws, or claims validation fails after `callback_received` but before account resolution. Today that's not testable because `callback_received` doesn't carry the field; after this change, it is, and it's a real scenario the handler already produces on every call.

The issue description's stated purpose, per the exploration notes' own framing (line 46), is to "trace a complete authentication event through the audit log by correlation ID." A completed authentication and a *failed* authentication are both "complete" in the sense that matters for incident response — arguably the failed one is the one an operator is more likely to be tracing under pressure. The current test-coverage section (item 2, notes lines 43–48) only names the success-path chain: `callback_received` → `session_created`/`success` → `first_access_created`/`role_claim_mapped`. It doesn't name `callback_received` → `auth.failure` as a chain to assert.

**Suggested addition to the test coverage section / tasks.md:**

> 3. Assert the same `correlationId` identity holds across `auth.callback_received` → `auth.failure` for at least one downstream-failure scenario (e.g., `handleCallback` rejection or missing-claims rejection occurring after `callback_received` has already been emitted). This is in scope for issue #4 as written — it's the same field, same handler, same invariant — not an extension of it.

This doesn't require new discovery or a stakeholder round-trip; it's the same fix applied to a code path the exploration already grounded (line 25: "`callback_received` (171) ... execute inside that same closure") but didn't carry into the acceptance criteria.

## 4. Minor: "Findings 2/3/4" naming mismatch worth flagging so the proposal doesn't misquote its own source

The task framing you gave me refers to "Findings 2/3/4" in the architect's implementation review. The review document itself only numbers three Findings (1, 2, 3). The fourth adjacent item the exploration notes correctly scope out — the `missingClaim: "sub"` vs `"id_token"` precision note — is called a "precision note" in the review, not a numbered Finding. The exploration notes get the substance right (they correctly exclude it), but if the proposal or tasks.md cites this as "Finding 4" when writing traceability back to the review doc, that citation won't resolve for anyone checking it against the source. Recommend the proposal refer to it as "the missingClaim precision note (implementation-review-architect.md, under 'MissingClaimError usage')" rather than a Finding number, so the traceability chain — the thing I actually care about here — holds up under a click-through.

## 5. Not a gap, but worth stating as an explicit non-goal in the proposal for the same reason as #2 and #4

The exploration notes are right that this is additive-only (new fields on existing event shapes, no rename, no removal) and that SEC-16 already clears both field types for this data classification. I'd still put one sentence to that effect directly in the proposal's acceptance criteria, not just in exploration-notes.md, because exploration notes don't ship — proposal.md and tasks.md are what an implementer opens six weeks from now, and "no schema classification question, no `emitAuditEvent` signature change" is cheap insurance against someone re-litigating a settled question because they never saw this document.

---

## Summary of requested changes before this moves to proposal

1. Promote the "same `correlationId` value, not a fresh one per site" requirement to a numbered, testable acceptance criterion (AC1 above), with an explicit cross-event-identity test requirement — don't leave it as prose that a skimming implementer can miss.
2. Add one explicit sentence scoping `join.link_rejected`/`join.link_redeemed` out of `correlationId` coverage, so it isn't pulled in by analogy to the Finding 2 precedent.
3. Extend the test plan to cover the `callback_received` → `auth.failure` correlation chain for a post-`callback_received` failure scenario, not just the success-path chain — this is in scope per the issue's own stated purpose, not scope creep.
4. Cite the `missingClaim` item by name ("precision note"), not as "Finding 4" — the review doc only has three numbered Findings.
5. Carry the "additive-only, no `emitAuditEvent` signature change, no new data-classification question" statement into the proposal's acceptance criteria directly, not only into exploration notes.

Everything else — the identification of the three emit sites, the line-level grounding, the guardrails against scope-creeping into Findings 2/3 and the `emitAuditEvent` signature, the choice to keep this small rather than growing a design.md — is specific enough to build from as-is and matches what I'd expect from the SEC-12 intent already on record. This is a good exploration; it needs its sharpest insight moved from narrative to acceptance criteria before an implementation team can be held to it without a follow-up question back to whoever picks this up next.
