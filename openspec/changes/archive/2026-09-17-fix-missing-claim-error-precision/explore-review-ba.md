# BA Review — Exploration Notes: Issue #7 (MissingClaimError precision)

**Reviewed by:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, 2026-09-17)
**Question asked of me:** Are these ideas specific enough to become requirements? What's too vague to carry into a proposal?

---

## Overall

This is a well-verified exploration — Devon checked the error class, the handler, the audit emit site, and grepped for downstream consumers rather than asserting from the brief. That's the standard I want on every exploration, and I'd rather see this level of "I checked it myself" than a longer document with less verification behind it.

That said, "verified" and "ready to become a requirement" are different bars. Several conclusions here are stated as findings when they need to be stated as testable conditions before they can go in a proposal or spec delta. Below is what I'd tighten before this moves forward, organized as the task asked: clarifications needed, vague areas, and suggested rewrites.

---

## 1. Clarifications needed before drafting the proposal

### 1.1 Exact current text of the "Known Limitations / Open Issues" section is not quoted

The note says the new resolved-line should match "the pattern already used for #2 and #3 in that same file" but never quotes that pattern. I don't want the proposal author reconstructing formatting from memory. **Before writing the spec delta, pull the literal current lines for #2 and #3 from `openspec/specs/first-access/spec.md` and quote them in the proposal.** If the format is inconsistent between #2 and #3, that's itself worth a one-line note rather than silently picking one.

### 1.2 The `auth.test.ts` line reference is hedged

"currently around line 662" — a proposal or tasks.md that ships with an approximate line number will be wrong by the time someone implements it if anything above shifts. **Confirm the exact line (or better, don't reference a line number at all — reference the test's `it(...)` description string, which is stable)**, and quote the exact current assertion text (`expect(auditFields.missingClaim).toBeDefined()`) so the task reads as a diff, not a paraphrase.

### 1.3 Does the `iss` branch need its own scenario check?

The note only addresses the `sub` scenario split. Control flow in `auth.ts` means the null-claims branch short-circuits before the `iss` check is ever reached — so a null claims object can never produce `missingClaim: "iss"` today or after the fix. That's correct and I don't think it needs a code or spec change. But the exploration doesn't say this explicitly — it has to be inferred by reading the code. **State this explicitly in the proposal** ("the null-claims branch cannot reach the `iss` check; no `iss` scenario is affected") so a reviewer isn't left to re-derive it, and so nobody "fixes" a non-problem by adding a redundant `iss` null-claims scenario.

---

## 2. Areas too vague to carry forward as-is

### 2.1 "No design.md decisions of substance here" is a conclusion, not a decision record

Saying no design doc is needed is probably right, but as written it's Devon's personal assessment buried in a recommendation paragraph. If the proposal is later questioned ("why didn't this change get a design review?"), there's nothing to point to. **This needs to be an explicit, stated decision in the proposal itself** — e.g., a one-line "Design: not required — no architectural surface, confirmed in exploration" — not something a future reader has to dig out of exploration-notes.md.

### 2.2 The spec scenario rewrite is a draft, not spec-ready text

The two proposed scenarios ("Null claims object" / "Missing or empty sub claim") are good starting shapes but are missing the audit-field-completeness detail the *original* scenario has. The original scenario says "the `auth.failure` audit event includes `missingClaim: "sub"`" — implying there are other fields in that event alongside it. The rewritten scenarios only mention `missingClaim` in isolation. **Before this goes into a spec delta, confirm whether the original scenario's audit event description included other fields (e.g. from the `auth-audit-correlation-fields` change — `sourceIp`, `correlationId`) that also need to carry through into both new scenarios**, so the split doesn't accidentally drop detail the original scenario had. This is exactly the kind of gap that turns into a "wait, was that intentional?" question during implementation review.

### 2.3 "Proceed to proposal" recommendation has no acceptance conditions attached

The recommendation section names file scope (`auth.ts`, `auth.test.ts`, `spec.md`) but doesn't state what "done" looks like in verifiable terms. For an implementer, "one branch, one assertion, one scenario split" is enough only if they already share Devon's mental model of the change. It should not require reading the whole exploration narrative to know when this is finished. See rewrite below.

---

## 3. Suggested rewrites (concrete acceptance conditions)

For the proposal / spec delta, I'd want language close to this:

**Acceptance Criteria**

1. **Given** `tokens.claims()` returns `null` in `/auth/callback`, **when** the callback handler processes the response, **then** a `MissingClaimError("id_token")` is thrown (not `MissingClaimError("sub")`).
2. **Given** the same null-claims condition, **when** the resulting `auth.failure` audit event is recorded, **then** `auditFields.missingClaim` equals `"id_token"`.
3. **Given** a non-null claims object with an absent or empty-string `sub`, **when** the callback handler processes the response, **then** behavior is unchanged: `MissingClaimError("sub")` is thrown and `auditFields.missingClaim` equals `"sub"`.
4. **Given** a non-null claims object with an absent or empty-string `iss`, **when** the callback handler processes the response, **then** behavior is unchanged: `MissingClaimError("iss")` is thrown and `auditFields.missingClaim` equals `"iss"`.
5. `mapAuthError` and the frontend-facing error message are unchanged — no branching on `err.claim` is introduced anywhere in this change.
6. The `auth.test.ts` test `"rejects authentication when claims() returns null"` is updated so its assertion reads `expect(auditFields.missingClaim).toBe("id_token")`. No other test in that describe block changes.
7. `openspec/specs/first-access/spec.md`'s "Missing sub claim" scenario is replaced by two scenarios ("Null claims object" and "Missing or empty sub claim") — text confirmed against the original's full audit-field list per §2.2 above.
8. `spec.md`'s Known Limitations / Open Issues section moves `#7` from Open to Resolved, using the exact format confirmed against `#2`/`#3` per §1.1 above.
9. No changes to `error-handler.ts` behavior, and no reopening of issue `#4` or `#6` scope.

This gives the implementation team something to check off rather than a narrative to reinterpret — which is the bar I hold every requirement to before I'll sign off on it moving to proposal.

---

## What's already solid (no changes needed)

- The root-cause diagnosis and the one-line code fix are precise and correctly scoped.
- The downstream-consumer grep (§4 of the exploration) is exactly the kind of due diligence I want — no vague "should be fine," an actual verification with the grep scope stated.
- The history/provenance trace back through the `first-access` archive and `auth-audit-correlation-fields` review chain is good traceability practice — I can follow the chain from user-facing paper cut to this exploration without asking Devon anything. That's the standard I want on every exploration.
- The "what could go wrong if this drifts" section correctly identifies the real risk (spec.md staleness) rather than manufacturing risk where none exists.

**Bottom line:** proceed to proposal, but only after closing the three clarifications in §1 and folding the acceptance criteria in §3 into the proposal/spec delta directly — not left as inferences from this exploration doc.
