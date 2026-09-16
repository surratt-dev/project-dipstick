# BA Review: fix-local-oidc-login Tasks

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source:** `openspec/changes/fix-local-oidc-login/tasks.md`, cross-checked against `proposal.md`, `design.md`, `specs/oidc-auth/spec.md`
**Date:** 2026-09-16

---

## Overall read

I already reviewed the proposal and its spec delta (`propose-review-ba.md`) and had no blocking findings there. My job here is narrower: does `tasks.md`, taken as a whole, actually cover everything `proposal.md` commits to — including the "not in scope" bullets, which are commitments too — and does anything get softened or dropped in the translation from prose requirement to checklist item?

Short answer: coverage is complete. Every affirmative capability in "What Changes" maps to a task, and the verification task preserves the specific language from proposal.md's Impact section rather than paraphrasing it into something weaker. One asymmetry worth flagging, not blocking.

---

## 1. Coverage mapping — "What Changes" → tasks

| Proposal commitment | Task | Verdict |
|---|---|---|
| Fix `auth.ts` callback URL reconstruction: `request.host` instead of `request.hostname` | 1.1 | Exact match — names the same file, same handler, same line, same property swap. |
| Add a code comment explaining the fix, matching JWKS-comment density | 1.2 | Exact match — even carries forward the "one sentence, not incident-report length" calibration from design.md's Decisions section. |
| Reverse-proxy/production-inertness reasoning (design.md) | 1.3 | Not re-derived, correctly cross-referenced instead of duplicated. This is the right move — copying that reasoning into tasks.md would create two sources of truth that could drift. |

Nothing in the affirmative scope is missing a task.

## 2. Coverage mapping — "Not in scope" bullets → tasks

Proposal.md states three explicit non-scope commitments. Two get an explicit checkpoint in tasks.md; one doesn't:

- **JWKS key stays untouched** → Task 2.1 explicitly scope-checks this ("confirm no task... touches `docker/oidc/server.js`"). Covered.
- **No change to production behavior** → Task 1.3's cross-reference to design.md's "No additional check against staging/prod topology before shipping" decision covers this. Covered.
- **No new configurability** → No corresponding task or cross-reference anywhere in tasks.md.

This third item isn't lost in any way that creates real risk — the entire fix is a one-property swap on one line, and there's no plausible path from "change `hostname` to `host`" to "accidentally add a config flag." But the other two non-scope bullets each got a deliberate checkpoint, and this one didn't get even a one-line acknowledgment. Given how much discipline this proposal puts into closing off scope-creep vectors (the JWKS re-fix risk gets its own task, its own design.md risk entry, *and* a proposal.md callout), the asymmetry stood out enough to mention. Not blocking — I wouldn't hold up implementation for it — but if tasks.md gets touched again before this ships, a half-sentence addition to 2.1 ("...and does not introduce a host/port configuration option") would close the set cleanly at no cost.

## 3. Capability/spec-delta → tasks

The modified `oidc-auth` requirement and its new scenario ("Callback URL reconstruction preserves a non-default port") don't get a task that re-writes or re-verifies the spec delta — correctly so, since the delta is already written and I already checked it for accuracy against the code in `propose-review-ba.md`. Tasks.md is implementation-only here, which is the right layer separation.

What I did check: does the verification task (§3) actually exercise the new scenario, or just gesture at "login works"? Task 3.2's flow (`/auth/login` → mock IdP → land on `/team/:id`) only succeeds *because* the reconstructed `redirect_uri` matches at the token exchange — if the port were still dropped, the IdP would reject the grant and the flow would dead-end at an error page, which task 3.3 explicitly rules out as a pass. So the manual E2E check is a faithful, if indirect, verification of the new scenario. This matches the acceptance-condition shape I proposed back at the exploration stage (pick unit-test-on-construction *or* E2E-observation, not both) — tasks.md picked E2E, consistently with the proposal, and didn't quietly water it down to something less specific.

## 4. Language fidelity check

Comparing task 3.2's wording against proposal.md's Impact section line: both specify "no manual patching, no port override, no second OIDC instance" verbatim. Task 3.3's error-page exclusion also survives with its specific teeth intact ("even if the redirect itself completes without a thrown exception") — this was a point I flagged as already well-handled in the proposal review, and it carried through into tasks.md unchanged rather than getting genericized into "verify login works."

## 5. Observation, not a gap in tasks.md

Design.md's Future Work section flags that `mapAuthError()` buckets a `redirect_uri` mismatch into the same audit category as a user cancelling consent — explicitly marked "a candidate follow-up ticket, not a gate on this change." That's the right call for *this* change's scope, and I'm not asking tasks.md to add a task for it (design.md already says it isn't one). Flagging only because nothing anywhere — proposal, design, or tasks — assigns an owner or a "file this ticket" action; it's documented but not tracked. That's a gap in follow-through bookkeeping outside this change, not in this change's task coverage, so it doesn't affect my assessment of tasks.md itself.

---

## Summary

No blocking findings. Tasks.md fully covers the capabilities committed to in proposal.md:

1. Both affirmative changes (the property swap, the comment) have exact-match tasks.
2. Two of three "not in scope" commitments get an explicit checkpoint; the third (no new configurability) has none, which is low-risk but worth a half-sentence fix for completeness if the file is touched again.
3. The verification task preserves the proposal's specific language and its anti-false-pass guard (3.3) without softening either.
4. Layer separation is respected — tasks.md doesn't re-litigate the spec delta or the design decisions, it correctly points at them.

This is buildable as written. Nothing here needs to come back to me before implementation starts.
