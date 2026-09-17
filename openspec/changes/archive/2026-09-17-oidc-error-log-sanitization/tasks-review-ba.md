# Tasks Review — Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Change:** `oidc-error-log-sanitization`
**Scope of this review:** Does `tasks.md`, taken as a whole, deliver every capability committed to in `proposal.md` and `specs/auth-error-handling/spec.md`? Is anything lost in translation in either direction — spec scenario without a task, or task without a spec/proposal basis?

## Verdict

Coverage is close to complete and the traceability is unusually good for this stage — I can trace nearly every scenario to a specific task number, which is exactly the property I look for. I found two gaps worth closing before this moves to implementation sign-off, and one traceability issue that isn't a coverage gap so much as a documentation gap: a real behavior change is buried in `tasks.md`/`design.md` with no visible anchor in `proposal.md` or `spec.md`. None of these are large. I'd rather flag them now than have them surface as "wait, where did this come from?" questions during implementation or review.

## Scenario-by-scenario trace

| Spec scenario (`specs/auth-error-handling/spec.md`) | Task(s) | Status |
|---|---|---|
| IdP token-exchange error is sanitized | 1.2, 3.2, 3.5 | Covered |
| WWW-Authenticate challenge error sanitized without nonexistent field | 1.2a, 3.2, 3.5a | Covered |
| Token/claim validation failure sanitized structurally (`OperationProcessingError` **or** `ClientError`) | 1.3, 3.2 | Partial — see Finding 1 |
| Application-level claim validation error sanitized consistently (`MissingClaimError`) | 1.4, 3.7 | Covered |
| Sanitization applies uniformly across all OIDC client library call sites | 2.1, 2.2b, 2.3; verified by 4.1, 4.2, 4.3 | Covered |
| Redacted fields are marked, not omitted | 1.2, 1.3 (implementation only) | Gap — see Finding 2 |
| Unrecognized error class fails closed | 1.5, 3.6 | Covered (minor note, see Finding 3) |
| User-facing error page is unaffected by log sanitization | 4.1 | Covered |
| IdP end-session URL construction failure degrades gracefully (`auth.idp_logout_failed`) | 2.3, 4.2 | Covered |
| Regression coverage against installed library versions | 3.2, 3.3, 3.4 | Covered |

The "Authentication event logging" (MODIFIED) requirement's five pre-existing scenarios are untouched by this change and correctly have no new tasks against them.

## Findings

### Finding 1 — `ClientError` is named in the spec scenario but never independently exercised in a test task

**Where:** Spec scenario "Token/claim validation failure is sanitized structurally" reads: *"WHEN the OIDC client library throws `OperationProcessingError` or `ClientError`..."* — both classes are named as scenario triggers, on equal footing.

Task 1.3 implements both in the same branch, correctly. But task 3.2's regression-test instructions construct and exercise `ResponseBodyError`, `AuthorizationResponseError`, `WWWAuthenticateChallengeError`, and `OperationProcessingError` — with a specific, well-reasoned note for why `OperationProcessingError` is exercised via the real `getEndSessionUrl()` path rather than constructed arbitrarily. `ClientError` doesn't appear anywhere in section 3. `design.md`'s D6 description of the regression suite also only names "four recognized error classes," which quietly drops `ClientError` from test scope without saying so.

This may be entirely intentional — `ClientError` and `OperationProcessingError` share a branch and an allowlist, so testing one may be judged sufficient proof of the branch logic. But right now that's an inference I'm making, not a decision anyone wrote down. Compare this to the `OperationProcessingError` case, where tasks.md and design.md both explain *why* it's tested the way it is. `ClientError` gets no equivalent explanation for why it's tested zero ways.

**Recommendation:** Either add a `ClientError` case to 3.2 (construct one the same way the design reasoned about `OperationProcessingError`'s real-path construction, or note if `ClientError` isn't cleanly constructible the same way `AuthorizationResponseError` wasn't), or add a one-line note to 3.2 stating explicitly that shared-branch coverage via `OperationProcessingError` is considered sufficient for `ClientError` and why. Don't leave the omission silent.

### Finding 2 — "Redacted fields are marked, not omitted" has no dedicated test assertion

**Where:** This is a named scenario in `spec.md`, not an incidental detail: *"WHEN sanitization withholds a field's original value... THEN the logged output includes that field with an explicit redaction marker rather than the field being absent."* This is the scenario that distinguishes "we chose not to show you this" from "logging broke" — it's explicitly called out in the proposal's "What Changes" section too ("Withheld fields appear in the logged object as an explicit `"[redacted]"` marker — never silently omitted").

Task 3.4 asserts the canary string never appears in the output. Task 3.5 asserts allowlisted fields appear with real values. Task 3.5a asserts, specifically for `WWWAuthenticateChallengeError`, that `error`/`error_description` are *absent* (the one case where absence is correct because the field never existed). Nowhere in section 3 is there a task that asserts the *positive* case: that for `ResponseBodyError`/`AuthorizationResponseError`, `error_description` and `cause` appear in the final JSON as the literal string `"[redacted]"` rather than being dropped from the object entirely — same for `cause` on `OperationProcessingError`/`ClientError`.

Proving the canary is gone (3.4) is necessary but not sufficient to prove this scenario: an implementation that silently `delete`s the field instead of setting it to `"[redacted]"` would also pass 3.4 and 3.5 as currently worded, and would violate this named scenario without any test catching it. Given that the marker-vs-omission distinction is called out twice as a deliberate design property (proposal.md and D2's "opt-in fields only" reasoning), I'd expect a test to enforce it, not just the implementation task to state it.

**Recommendation:** Add an explicit subtask under section 3 (or fold into 3.5) asserting the redaction-marker fields are present with the literal `"[redacted]"` value for the applicable branches (1a's `error_description`/`cause`, case 2's `cause`), mirroring how 3.5a already proves the negative case for `WWWAuthenticateChallengeError`.

### Finding 3 (minor) — Non-`Error` thrown-value fail-closed case (design D3 case 5) has no distinct test

**Where:** `design.md`'s D3 documents five branches, not four — case 5 is a non-`Error` thrown value (`errorClass: typeof err`), distinct from case 4 (unrecognized `Error` subclass). Task 1.5 implements both. Task 3.6 says "Add a case constructing an unrecognized `Error` subclass" — that's case 4 only; nothing in section 3 exercises throwing a bare string or plain object through the sanitizer.

The spec scenario ("Unrecognized error class fails closed") is worded broadly enough that it doesn't strictly require this distinction be tested separately, so I'm not blocking on this the way I am on Findings 1–2. But it's a real branch with its own `errorClass` derivation logic (`typeof err` instead of `err.constructor.name`), and it's exactly the kind of branch that looks untested in a coverage report six months from now with no record of whether that was a decision or an oversight.

**Recommendation:** Low cost to add a case to 3.6 (or a 3.6a) that throws a plain string/object and asserts the `typeof`-derived `errorClass`. Optional, not blocking.

### Finding 4 — The `isRevocation` classification fix (task 2.2a) has no anchor in `proposal.md` or `spec.md`

**Where:** Task 2.2a fixes a real, pre-existing bug: `middleware.ts`'s revocation check currently inspects `err.message`/`err.code`, fields that — per `design.md`'s own D3/D10 analysis — can *never* contain `"invalid_grant"` for a `ResponseBodyError`. Today this means a genuinely revoked refresh token is misclassified as a transient failure: two retries, 5 seconds apart, and an audit record reading `failureType: "transient"` instead of `"revoked"`. Task 2.2a fixes this by checking `err.error` instead. `design.md`'s D9/D10 give a thorough, well-reasoned justification for why this belongs in this change rather than a separate one, and I don't disagree with the reasoning.

My concern is purely one of traceability, which is the thing I'm here to check. This is a genuine, observable behavior change — the audit trail's `failureType` field changes value for a real class of failure, and the retry/delay behavior changes for revoked tokens. Someone reading only `proposal.md`'s "What Changes"/"Impact" sections, or only `spec.md`'s scenarios, would have no way to know this is happening — it exists solely in `design.md` and `tasks.md`. That's precisely the "lost in translation" pattern I was asked to check for: it's not lost from tasks (2.2a and 4.3(a) both implement and test it competently), it's lost *upstream* of tasks, in the documents that are supposed to be the traceable source of intent.

This isn't hypothetical scope-creep risk — `design.md` explicitly and convincingly argues it isn't scope creep. My objection is narrower: a future reader diffing `proposal.md` against the shipped change, or searching `spec.md` for "why does `failureType` say `revoked` now," finds nothing. Given how much discipline this proposal otherwise shows about naming every behavior change explicitly (the `getEndSessionUrl()` try/catch, the new `auth.idp_logout_failed` event, the new `refreshSessionTokens` log line all get named in the proposal), this one fix reads like an accidental omission rather than a deliberate choice to leave it undocumented at that level.

**Recommendation:** Add one sentence to `proposal.md`'s "What Changes" or "Impact" section naming this fix (even framed as "incidentally corrected while touching this catch block"), and/or extend the existing "Session invalidation logged" scenario in `spec.md` (or add a short new one) to state that revoked-refresh-token failures are audited with `failureType: "revoked"` rather than `"transient"`. Either is sufficient; leaving it undocumented at the spec/proposal layer is what I'd push back on.

## What I did not flag

- Section 6 (6.1–6.4) correctly mirrors the proposal's "Explicitly out of scope" list — deferred items are named, not silently dropped, and each has a task directing it to a tracked GitHub issue. Good discipline.
- Task 1.6's onboarding comment and task 5.1's manual walkthrough don't map to a specific scenario, but they're reasonable engineering/verification hygiene tasks that don't misrepresent scope — I don't consider tasks without a scenario a problem by itself, only tasks that represent an undocumented *behavior* change (Finding 4) or scenarios without a task (Findings 1–2).
- The three call sites named in the proposal (`handleCallback`, `refreshSessionTokens`, `getEndSessionUrl`) all have both an implementation task and an end-to-end test task verifying the wrapper is actually wired in, not just unit-tested in isolation. That closes the exact gap ("categorization changed but nothing proves it's wired up") I'd normally worry about most on a change like this.
