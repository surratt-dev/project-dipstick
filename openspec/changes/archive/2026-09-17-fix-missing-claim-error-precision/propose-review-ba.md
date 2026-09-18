# BA Review — Proposal: fix-missing-claim-error-precision

**Reviewed by:** Marcus Delgado, Business Analyst
**Reviewing:** `proposal.md`, `design.md`, `tasks.md`, `specs/first-access/spec.md` (delta)
**Question asked of me:** Are capabilities specific enough to implement? Are acceptance criteria explicit or implicit? Is there vague language? Check against `requirements/`.

---

## Overall

This closes cleanly against my exploration review (`explore-review-ba.md`). All three clarifications I asked for and all nine acceptance conditions I drafted are present in the proposal/tasks, not left as inferences. I also spot-checked the proposal's factual claims against the current code (`auth.ts` lines 193–201, 355–356; `error-handler.ts` line 13; `errors.ts`; `auth.test.ts` lines 624, 661, 665–691) — every line reference, branch description, and test-assertion quote matches what's actually in the repository today. I don't have open clarification questions. This is buildable as written.

Checking against `requirements/`: I grepped the Identity and Access use cases (`use cases/01 - Identity and Access - Use Cases.md`) for anything touching claim-name precision or `missingClaim` semantics specifically — there isn't any. The use cases require *that* a generic error and an operator-diagnosable log entry exist on account-creation failure (line 87) and that role-change events carry specific audit fields (line 220), but nothing in the requirements layer pins the string value of a `missingClaim` field for the null-claims case. That's consistent with this proposal's own framing: it's an internal diagnostic-precision fix below the requirements layer, not a requirements change. Nothing here conflicts with or needs updating in `requirements/`.

---

## 1. Clarifications from exploration review — status

| # | Ask | Status |
|---|---|---|
| 1.1 | Quote exact `#2`/`#3` Resolved-line format before drafting the spec bookkeeping | **Closed.** `tasks.md` 3.3 quotes the exact target line and states it matches "the existing `#2`/`#3` format exactly." I re-verified against the live `spec.md` (lines 218–219) — format matches. |
| 1.2 | Reference the test by description string, not an approximate line number | **Closed.** `proposal.md` and `tasks.md` both reference `it("rejects authentication when claims() returns null", ...)` by description string only. |
| 1.3 | State explicitly that the null-claims branch can't reach the `iss` check | **Closed.** `proposal.md` line 18 states it in one sentence: "the null-claims branch throws before the `iss` check is ever reached, so a null claims object can never produce `missingClaim: 'iss'`, today or after this fix." No re-derivation needed by a reviewer. |

---

## 2. "Too vague to carry forward" items — status

### 2.1 Design-not-required as a stated decision (was implicit, needed to be explicit)
**Closed.** `design.md` has an actual `## Decisions` section headed "**Design: not required.**" with four bulleted reasons. This is exactly the "something to point to" I asked for — if this proposal is ever questioned for skipping design review, the answer is documented, not reconstructed.

### 2.2 Spec scenario rewrite dropping audit-field detail
**Closed, and correctly reasoned.** `proposal.md` line 9 states directly that no design surface exists because `MissingClaimError` takes an unconstrained string and nothing pattern-matches on `err.claim`. On the specific worry — did the two-way scenario split drop detail relative to the original — the spec delta (`specs/first-access/spec.md` delta, lines 6–12) keeps both new scenarios at the same abstraction level as the original: `missingClaim: <value>` plus "and no claim values," with no itemization of `sourceIp`/`correlationId`. I checked the original scenario text (still live at `openspec/specs/first-access/spec.md` lines 94–96) — it never itemized those fields either, so the split isn't a regression in detail. Correct call.

### 2.3 Acceptance criteria explicit vs. implicit
**Functionally closed, one organizational note below.** All nine conditions from my exploration review are present, but distributed rather than centralized:

- Conditions 1–2 (null → `MissingClaimError("id_token")`, `auditFields.missingClaim === "id_token"`): `proposal.md` bullets 1–2.
- Conditions 3–4 (sub/iss branches unchanged): `proposal.md` line 15, `tasks.md` 1.1/2.2.
- Condition 5 (`mapAuthError`/user-facing message unchanged): `proposal.md` bullet 5, `tasks.md` 1.2 and 4.3.
- Condition 6 (test assertion tightened): `proposal.md` bullet 3, `tasks.md` 2.1.
- Condition 7 (scenario split): `proposal.md` bullet 4, spec delta.
- Condition 8 (`#7` Open → Resolved): `proposal.md` bullet 5, `tasks.md` 3.2–3.3.
- Condition 9 (no reopening `#4`/`#6`): `proposal.md` bullet 5, `tasks.md` 3.4 and 4.3.

Nothing is missing or implicit — every condition maps to a specific, checkable line in `proposal.md`/`tasks.md`. My only note: there is no single "Acceptance Criteria" heading anywhere in the proposal, so an implementer confirming "am I done?" has to assemble the checklist from `tasks.md`'s Verification section (4.1–4.3) plus scattered bullets rather than reading one list. `tasks.md` section 4 substantively covers this (run tests, re-grep for `missingClaim`, confirm `error-handler.ts` has no diff and `#4`/`#6` aren't touched), so this is not a blocker — I raise it only because centralizing would save a future reader (or a future me, six months from now, tracing a scope dispute) a reconstruction step. **Non-blocking suggestion, not a requirement to revise.**

---

## 3. Capability specificity check

The one modified capability (`first-access` — "Missing claims rejection" scenario correction) is specific enough to implement without follow-up questions:

- Exact file, exact branch, exact before/after string literals (`proposal.md` bullet 1).
- Exact audit field and exact before/after value (`proposal.md` bullet 2).
- Exact test identifier and exact before/after assertion (`proposal.md` bullet 3).
- Exact spec scenario split with full scenario text already drafted in the delta file, not left to be written during implementation (`specs/first-access/spec.md` delta).
- Explicit negative scope: `mapAuthError` untouched, `#4`/`#6` untouched, no `err.claim` branching introduced anywhere (`proposal.md` bullet 5, reinforced in `design.md` Risks and `tasks.md` 1.2/3.4/4.3).

I found no vague language anywhere in `proposal.md`, `design.md`, or `tasks.md` — no "should," "as appropriate," "handle gracefully," or unquantified terms that would require a follow-up "what did you mean?" conversation. Every claim about current code behavior that I spot-checked against the repository was accurate.

---

## Bottom line

No further clarifications needed. Approve to proceed to implementation as written. The one non-blocking suggestion (§2.3 — consider a single consolidated "Acceptance Criteria" list) is a nice-to-have for future traceability, not a gate on this change.
