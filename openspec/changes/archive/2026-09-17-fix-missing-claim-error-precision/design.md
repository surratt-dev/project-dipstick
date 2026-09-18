## Context

`/auth/callback` in `packages/backend/src/routes/auth.ts` throws `MissingClaimError("sub")` when `tokens.claims()` returns `null`, mislabeling a "no claims object at all" failure as a "missing sub claim" failure in the resulting `auth.failure` audit event. See `proposal.md` for the full motivation.

## Goals / Non-Goals

**Goals:**
- Record, explicitly, that this change carries no design decisions of substance — so the absence of a design review isn't something a future reader has to infer or dig out of `exploration-notes.md`.

**Non-Goals:**
- No architectural change, new abstraction, new dependency, or cross-cutting decision is in scope. This is a one-branch diagnostic-label fix.

## Decisions

**Design: not required.** No decision needs recording here because none was made — the fix is dictated entirely by the existing code shape:

- `MissingClaimError` (`packages/backend/src/auth/errors.ts`) already accepts an arbitrary `claim: string` with no enum or validation, so `"id_token"` is exactly as valid a value as `"sub"` or `"iss"`. No type or interface change.
- `mapAuthError` (`packages/backend/src/auth/error-handler.ts`) branches only on `err instanceof MissingClaimError` and never inspects `err.claim`; the user-facing message and category are identical for every claim name. No change needed or made there.
- A repository-wide grep for `missingClaim` (outside `node_modules`/`dist`) found no dashboard, alert rule, or runbook that pattern-matches on the specific string value `"sub"` vs `"id_token"`. No hidden consumer, no migration or comms step.
- The null-claims branch in `auth.ts` throws before the `iss` check is ever reached, so control flow guarantees a null claims object can never produce `missingClaim: "iss"` — no decision needed on whether to add an `iss` variant, because that code path is unreachable by construction.

There was no alternative approach to weigh: the only other option (leaving `MissingClaimError("sub")` in the null-claims branch) is the bug being fixed, not an alternative design.

## Risks / Trade-offs

- **[Risk] Someone extends this into a `mapAuthError`/frontend change that branches on `err.claim === "id_token"` to show a different user-facing message.** → Mitigation: out of scope by design; the generic message is a deliberate information-exposure discipline (it doesn't leak which specific validation failed) and must stay unchanged. Called out explicitly in `proposal.md` and `tasks.md` so a reviewer can reject this if attempted.
- **[Risk] `openspec/specs/first-access/spec.md` is left stale after the code and test change, so the spec asserts the old, wrong `missingClaim: "sub"` behavior for the null-claims case.** → Mitigation: the spec delta in this change (`specs/first-access/spec.md`) is scoped explicitly to correct this in the same change, not deferred.
- **[Risk] Scope creep into adjacent, already-closed issues (`#4`, `#6`) because they touch the same file.** → Mitigation: explicitly out of scope, stated in `proposal.md` and `tasks.md`; those issues are already closed by other changes.
- **[Risk] An external SIEM/alert rule outside this repository could be keyed on the literal `missingClaim: "sub"` value and stop firing, silently, for the null-claims case once it becomes `"id_token"`.** → Mitigation: the in-repo grep found no such consumer, but a grep can't see outside this repository. Not something a one-branch diagnostic fix should solve (no audit-schema-consumer registry being built here); instead, `tasks.md` (4.4) calls for a one-line heads-up in the PR description so whoever owns external alerting can check.

## Review

Reviewed by Marcus Oyelaran (Engineer) and Tomás Ferreira (Security Analyst); both approved with no blocking issues. Two non-blocking notes were folded in: the `MissingClaimError.claim` JSDoc example needs a third value (`tasks.md` 1.3), and the PR description should flag the external-SIEM consideration above (`tasks.md` 4.4).
