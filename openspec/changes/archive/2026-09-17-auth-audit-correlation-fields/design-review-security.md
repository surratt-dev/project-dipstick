# Security Design Review: auth-audit-correlation-fields

**Reviewer:** Tomás Ferreira (Senior Application Security Analyst)
**Reviewed:** proposal.md, design.md, specs/auth-error-handling/spec.md
**Verified against:** `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/routes/__tests__/auth.test.ts`, `openspec/changes/archive/2026-07-05-first-access/implementation-review-architect.md`

**Verdict: Approved. No blocking findings.** This is a correctly-scoped conformance fix. One documentation-accuracy correction requested (non-blocking), one observation for the record (not an ask).

---

## What I checked

I don't take "already-approved field type" or "already reviewed pattern" claims on the word of a proposal — I read the actual handler, the actual logger, and the actual prior review doc these documents cite.

- `auth.ts`: confirmed `correlationId = crypto.randomUUID()` is minted once, at line 119, before the `try` block, and that `auth.callback_received` (~171), `auth.session_created` (~279), and `auth.success` (~284) all execute inside that same closure with no reassignment of `correlationId` anywhere in between. The catch block (~330+) reads the same binding. AC1's premise is real, not asserted.
- `audit-logger.ts`: `emitAuditEvent(logger, event, fields: Record<string, unknown>)` — no schema, no allowlist, no field-presence enforcement of any kind. Confirms the design's Non-Goal framing is accurate: there genuinely is nothing at the logger level today that would catch a missing or wrong-value field, which is exactly why the direct cross-event `toBe()` assertions in tasks.md 2.2/2.3 matter and shouldn't be watered down to `expect.any(String)` during implementation.
- `implementation-review-architect.md` (first-access change): confirmed Finding 1 (this gap), Finding 2 (join-flow `sourceIp` hardcoded to `"callback"`, since fixed — tests 11.6/11.6b), Finding 3 (`session.destroy()` coverage gap), and the unnumbered `missingClaim` precision note, all as the proposal and design describe them. Nothing is mischaracterized or renumbered.
- `auth.test.ts`: confirmed the existing `sourceIp`/`correlationId` presence-assertion pattern (line ~452) that tasks.md 2.1 extends, and confirmed tests 11.6/11.6b already assert real `sourceIp` on `join.link_rejected`/`join.link_redeemed` — the join-flow `sourceIp` fix is real and shipped, it's only `correlationId` that's absent there.

## Answers to the three specific questions

### 1. PII / sensitive-value leakage via `sourceIp` and `correlationId`

Non-issue, confirmed rather than assumed. Both fields are already emitted by `auth.authorization_initiated`, `auth.failure` (all three sites), `auth.first_access_created`, and `auth.role_claim_mapped` in this same file today — this change doesn't introduce a new field type into the audit trail, it makes three emit calls consistent with five that already exist. No new data-classification question is raised, and I agree with the proposal that none is triggered.

One structural note that's about the logger, not this change: `emitAuditEvent` takes `Record<string, unknown>` with no allowlist, so nothing at that layer stops a *future* call site from passing something sensitive. That's the correct scope boundary — it's called out as a Non-Goal in design.md and it's a pre-existing condition this change doesn't touch or worsen. I'm noting it here only so it stays visible; it's not a finding against this change.

### 2. Is same-`correlationId`-per-invocation sufficient to close the incident-tracing gap?

Yes, for the case the issue names, and it closes it at the right join point. Walk the session-hijacking scenario concretely: an operator investigating a suspicious session starts from a `sessionId` (from the session store, or from a later `auth.session_invalidated`/application event). Today, `auth.session_created` carries `sessionId` but nothing that connects it back to the sign-in that created it. After this change, `auth.session_created` carries `correlationId` alongside `sessionId` — that's the pivot. From there, every other event sharing that `correlationId` (`auth.callback_received`, `auth.success`, and `auth.first_access_created`/`auth.role_claim_mapped` when applicable) is directly queryable, giving the operator the full sign-in sequence: source IP, whether it was a first-access account creation or a role-claim update, and the exact timestamp chain. That is the reconstruction SEC-12 asks for, and it's specifically the piece that was missing.

Two things I checked that are *not* gaps, to be explicit about the boundary:
- `correlationId` doesn't need to span past the callback invocation (e.g., into later requests in the resulting session, or into `auth.session_invalidated` at logout). `sessionId` is the correct join key across that longer span, and it's already present on both ends. Extending `correlationId`'s lifetime beyond one callback invocation would be scope creep with no clear benefit over the `sessionId` join that already exists.
- The two early-failure emit sites (missing `state` param, expired/missing Redis state) that return before `auth.callback_received` is ever emitted already carry `correlationId` today, unchanged by this fix. The spec delta's new scenario correctly conditions on "more than one audit event carrying a `correlationId`" rather than asserting every invocation has a multi-event chain — that's an accurate model of the actual control flow, not an oversimplification.

Nothing else is needed to close the gap issue #4 describes.

### 3. Is scoping out `join.link_rejected`/`join.link_redeemed` and the `missingClaim` precision note safe?

**`missingClaim` precision note:** yes, safe to scope out, and it isn't a security question either way. It's about which claim *name* (`"sub"` vs `"id_token"`) appears in the audit event when `claims()` returns `null` — no claim *value* is ever logged in either version. An operator could theoretically misread which field was absent, which is an operational-clarity issue, not a security one. Correctly out of scope here.

**`join.link_rejected`/`join.link_redeemed`:** the scoping-out decision itself is safe — issue #4 doesn't name these events, no security control depends on them carrying `correlationId`, and `sourceIp` (the field that actually mattered for join-link abuse investigation, per Finding 2) is already present and real on both events. I'll allow that this is legitimately a separate, smaller follow-on if someone wants full-chain traceability that includes a join redemption alongside the sign-in that triggered it.

I do want one thing corrected before this ships, though it doesn't change the conclusion: **design.md's stated reason for deferring this is factually wrong.** It says `correlationId` is "technically in closure scope there too" inside `executeJoinFlow`. It isn't — `executeJoinFlow` (auth.ts:541) is a standalone top-level `async function` taking `(userId, token, logger, sourceIp)` as explicit parameters, not a nested closure over the callback handler's locals. That's exactly why `sourceIp` needed to be threaded through as a parameter for Finding 2 in the first place, and the same would be true of `correlationId` — it is not "already there for free" the way it is at the three sites this change actually touches. The practical scoping conclusion (defer to a follow-on) is unaffected — I'd make the same call — but a future implementer reading design.md and expecting a one-line addition inside `executeJoinFlow` will be wrong about the size of that follow-on. Please fix the sentence in design.md (and, if convenient, the identical claim in exploration-notes.md) to say it requires parameter threading, same as `sourceIp` did, rather than "technically in closure scope."

## Summary

The core mechanism (reuse one `const correlationId`, never regenerate per emit site) is correct, already-in-scope in the code as claimed, and the proposal's AC1/AC2 split plus the tasks.md requirement for direct `toBe()` cross-event assertions is the right test discipline given that `emitAuditEvent` enforces nothing itself. No PII concern, no authentication-flow behavior change, no new data-access boundary. One factual correction requested in design.md's join-flow rationale; not a blocker.
