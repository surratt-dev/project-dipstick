# Architect Review — tasks.md (fix-missing-claim-error-precision)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope of this review:** task ordering vs. architectural dependencies — does any task assume something not yet built, and does the sequence respect the boundaries I care about (auth abstraction, server-side authorization, ephemeral/persistent state, observability, deployment)?

## Verdict

**No blocking findings. Task ordering is sound.** This change does not touch architectural surface I have jurisdiction over, and the task sequence has no forward references or out-of-order dependencies.

## Dependency check

I traced each task against what it assumes exists:

- **1.1–1.3 (code fix)** assume `packages/backend/src/routes/auth.ts`, `error-handler.ts`, and `errors.ts` exist in their current shape. Confirmed all three are present in the repo as-is. No forward assumption.
- **2.1–2.2 (test update)** assume the code change in 1.1 has landed, and are sequenced after it. Correct order — a test tightened to `toBe("id_token")` before the code emits `"id_token"` would fail, so code-then-test is the only viable order here, and that's what's written.
- **3.1 (spec sync)** assumes the delta text is "already drafted in the delta file." I confirmed `specs/first-access/spec.md` in this change directory exists and already contains the full three-scenario split (Null claims object / Missing or empty sub claim / Missing iss claim). Nothing here is speculative — the task is a mechanical sync of text that already exists, not a promise of future authoring.
- **3.2–3.3 (Open Issues → Resolved bookkeeping)** don't depend on 3.1 completing first — they touch a different section of the same file — but doing them in the same pass is reasonable and introduces no risk either order.
- **3.4 (leave #4/#6 alone)** is a negative constraint, not a dependency; fine anywhere in the sequence.
- **Section 4 (verification)** is correctly placed last: 4.1 (run tests) needs 1.1+2.1 done, 4.2 (re-grep for `missingClaim`) needs 1.1 done, 4.3 (confirm no `error-handler.ts` diff / #4/#6 untouched) needs the full diff to exist, and 4.4 (PR note) is naturally a closing step. No verification task is sequenced ahead of what it verifies.

## Why this doesn't trigger a deeper architectural review

This change doesn't cross any of the boundaries I actually review:

- No touch to the OIDC abstraction layer itself — `mapAuthError` is explicitly unchanged (task 1.2), and the design.md correctly notes it branches only on `err instanceof MissingClaimError`, never on `err.claim`. The provider-agnostic abstraction stays real; nothing here couples it to Entra-specific behavior.
- No authorization logic touched — this is a diagnostic-label fix on an already-rejected auth attempt, not a change to who is granted access.
- No Redis/PostgreSQL boundary involved.
- No new logging surface — it corrects the *value* of an existing audit field (`missingClaim`), it doesn't add a new one or change where/how audit events are emitted.

The one item worth naming explicitly, though it's already handled: task 4.4's PR-description note about external SIEM/alert rules keyed on `missingClaim: "sub"` is the right instinct — a value-level change to an existing audit field can silently break an external consumer even when no in-repo consumer exists. That's a downstream-contract concern, not an in-repo architectural one, and the task list already treats it correctly (flag it, don't build a registry for it). No change needed there.

## Recommendation

Approve as ordered. No task should be split or reordered.
