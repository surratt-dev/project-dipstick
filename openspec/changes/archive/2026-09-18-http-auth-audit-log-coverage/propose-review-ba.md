# BA Review: Proposal — http-auth-audit-log-coverage (SEC-12/SEC-13)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `proposal.md`, cross-checked against `design.md`, `tasks.md`, `specs/auth-error-handling/spec.md`, and the current code (`middleware.ts`, `auth.ts`, `connection-reauthorization.ts`, migration `8_audit_log.sql`)
**Lens:** Are the capabilities specific enough to implement without a round-trip back to me? Are acceptance criteria explicit or something an implementer has to infer? Checked against BRD SEC-12 through SEC-16.

---

## 0. What happened to my exploration-stage findings

Before getting to new findings: all six items I raised against `exploration-notes.md` (`explore-review-ba.md`) were carried through and closed, not just gestured at.

1. "WS-side has no fail-handling to copy" — closed. `design.md`'s Context section states this in exactly the terms I asked for ("Nobody should go looking in the WS files for a try/catch to copy").
2. "Fail-open needs to be a testable condition covering both round trips" — closed. Decision D5 covers `resolveActorGlobalRole` and the `INSERT` under one `try/catch`, and the ADDED requirement "Audit log write failures fail open with a detectable signal" states it as scenarios, not prose.
3. "Timeout/hang behavior needs to be stated" — closed. `AUDIT_WRITE_TIMEOUT_MS = 500`, a concrete `withTimeout` mechanism, and tasks 4.4/4.5 test both the error and timeout branches distinctly.
4. "`token_refresh_success` needs a number or an explicit budget" — closed, by budget rather than by number. D1 states the answer as "zero additional round trips on the success path," which is actually a cleaner acceptance condition than a latency-percentile number would have been, since it sidesteps needing production instrumentation this codebase doesn't have. I have no objection to how this was resolved.
5. "`retryCount`/`failureType` need a stated new home if `token_refresh_failure` doesn't get a row" — closed. D2 plus the spec's two conditional scenarios state exactly which two `reason` values carry these fields.
6. "`team_id` NULL at the logout site needs to be checked against `resolveTeamIdForAudit`, not assumed by analogy" — closed, and closed well. D4 actually goes and reads the logout handler's active-sessions query, and names the multi-active-session ambiguity explicitly rather than hand-waving past it. This is exactly the standard I want design docs held to.

None of these needed to come back to me. Good sign for how this stage was run. That same multi-session reasoning in D4, though, is what surfaces the one new finding below — D4 asks the right question for `team_id` and I don't think the equivalent question got asked for `session_id`.

---

## 1. Gap: the new `audit_log` row has no stated home for `session_id` — and the existing structured log it's supposed to supersede already carries one

SEC-13 is explicit that every audit log entry must include "timestamp (UTC), authenticated user identity, action type, **target resource identifier**, and outcome." For a `session_invalidated` event, the resource being acted on is the session — not just the user. I checked what the *current* code already logs at all four call sites (`middleware.ts:172-176`, `:202-207`, `:213-218`; `auth.ts:424-428`): every one of them calls

```js
emitAuditEvent(request.log, "auth.session_invalidated", { userId, sessionId, reason: "..." });
```

`sessionId` is already there today, in the log-only version. The spec's own MODIFIED "Session invalidation logged" scenario (`spec.md` line 26) still lists it: *"a structured audit log entry is created with event `auth.session_invalidated`, user ID, **session ID**, and reason."* Then, one line later (line 27), that same scenario states the new DB row is "the authoritative record" going forward, with the log entry demoted to "the operational alert path."

I went looking for where `session_id` lands in that new, more-authoritative row, and it isn't anywhere:

- `design.md`'s Decision D5 code sample writes `actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata` — no `session_id` column and no `sessionId` key in the illustrated `metadata` object.
- `design.md`'s Decision D2 (the one place that discusses what goes into `metadata`) only talks about `failureType`/`retryCount`, and only for two of the four `reason` values.
- The ADDED requirement's four scenarios in `specs/auth-error-handling/spec.md` (lines 43-57) each enumerate what's in `metadata` — `reason`, and conditionally `failureType`/`retryCount` — and none of the four mentions `sessionId`.
- `tasks.md` 1.3 names the helper `writeSessionInvalidatedAuditRow(userId, sessionId, reason, request, metadata?, log)` — so `sessionId` is threaded in as its own parameter, distinct from the `metadata?` bag — but nothing in tasks.md ever says what the helper does with it. Task 4.1's own acceptance test lists the fields to assert (`operation`, `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id: NULL`, and `metadata` — the latter qualified as "including `failureType`/`retryCount` only for the two branches where they apply") and doesn't mention `session_id` either.

This isn't a hypothetical nice-to-have. D4's own reasoning for a different field makes the case for this one: a user "can in principle have more than one active session, possibly across different teams, at the moment of logout." If that's true — and D4 uses it as a real constraint, not a throwaway line — then an incident responder looking at a `session_invalidated` row for a user with two concurrent sessions has no way to tell *which* session was the one invalidated, or to correlate that row back to whichever WS connections/sessions were live under it. That's precisely the "reconstruct a sequence of events" capability SEC-12 exists for. The WS-side precedent this design otherwise follows closely gets this right for the identical reason: `session.access_revoked_live`'s `INSERT` (`connection-reauthorization.ts:93-97`) puts `scopeId` — the session or team the connection belonged to — into `metadata` for exactly this "which resource, specifically" purpose.

As written, an implementer following `design.md` + `tasks.md` literally would take `sessionId` as a parameter into the helper and then have nowhere the spec tells them to put it. Either that's a documentation gap (the intent is for it to land in `metadata` and every document describing `metadata`'s shape simply forgot to say so), or it's a deliberate omission nobody has stated a reason for — and given SEC-13's explicit "target resource identifier" language plus D4's own multi-session observation, I don't think an unstated omission is the right resting place.

**Suggested resolution, in the same style Decision D4 used for `team_id`:** either (a) state explicitly that `metadata` includes `sessionId` at all four call sites — trivial to add, since every call site already has the variable in scope for the existing `emitAuditEvent` call two lines away — and add it to the spec's four scenario descriptions and to task 4.1's assertion list; or (b) if there's a reason to leave it out that I'm not seeing, state that reason with the same explicitness D4 gave `team_id`'s NULL treatment, so a future reader doesn't "fix" an apparent oversight without knowing it was a decision. Given the cost is one field already sitting in a local variable at every call site, and the benefit is directly closing a stated SEC-13 gap and directly answering the ambiguity D4 itself raised, I'd expect (a).

---

## 2. Minor: the full `metadata` shape is never stated in one place

Related to #1 but worth separating out because it's a documentation-completeness issue independent of whether `session_id` gets added: right now, reconstructing what the final `metadata` JSONB object looks like for any given call site requires reading D2 (for `failureType`/`retryCount`'s conditional inclusion), all four of the spec's ADDED scenarios (for `reason`'s unconditional inclusion), and inferring the union — there's no single line anywhere that says, e.g., `metadata = { reason, sessionId, failureType?, retryCount? }`. This is a small ask, but it's exactly the kind of ambiguity that produces a "wait, is `reason` supposed to be in there or not, I only saw it in the spec scenarios not the design doc" question mid-implementation. One consolidated shape — ideally in `design.md`'s D5 code sample, where the `metadata` variable is currently opaque — would remove the need to cross-reference three documents to answer "what's in the row."

---

## What's already solid (no rewrite needed)

- **Decision D1's scope call** (`session_invalidated` only; `token_refresh_success`/`token_refresh_failure` explicitly excluded from their own rows) is stated as a decision with rationale, not a default, and `proposal.md` surfaces the SEC-13 category reasoning itself ("it is not one of the 'login, logout, failure, expiry' categories SEC-13 actually names") rather than burying it only in `design.md`. That's the right layer for an interpretive BRD-scoping call to live — a future compliance reviewer reading just the proposal sees the argument, not just the conclusion.
- **The fourth call site decision (D3)** — bringing `auth.ts`'s logout handler into scope rather than leaving it silently uncovered — is exactly the kind of completeness check I want, and it's framed against a named prior mistake (`websocket-delivery-time-authorization`'s D7) rather than asserted on its own authority.
- **Fail-open behavior (D5)** is now a fully testable acceptance condition: both round trips covered, explicit timeout value, explicit paired detectability signal (`auth.audit_write_failed`), and tasks 4.4/4.5 test the error and timeout branches as distinct cases. This is the standard the rest of this proposal's acceptance criteria should be held to.
- **`proposal.md`'s "Explicitly out of scope" section** is concrete and names two real follow-on issues by their actual content (the wider `auth.ts`/`join-links.ts` gap; NFR-AUTH-005's session-continuity question), and `tasks.md` 5.2/5.3 turn both into stated tasks with a deadline ("at or before archive, not left implicit") rather than a vague aspiration. Good scope hygiene, consistent with how #27 spun off this very issue.
- **The provider-agnostic check** in `design.md`'s Context section is done the right way — checked against the field mapping (`actor_global_role` from the app's own `users` table, `reason`/`failureType` from this codebase's own vocabulary) with a stated negative result, not assumed. Consistent with the standing project guidance that this auth layer isn't Entra-only.
- **`team_id: NULL` (D4)** — already covered in Section 0, but worth repeating here as the model other ambiguous-seeming fields (see Finding 1) should follow: state the reasoning fully enough that a future reader can't mistake a decision for an oversight.

---

## Summary of asks before this moves to implementation

1. **Blocking-ish (cheap to fix, real BRD hook):** State explicitly whether `session_id` is included in the new `audit_log` row's `metadata` at all four call sites. If yes, add it to `design.md`'s D5 sample, the four ADDED scenarios in `spec.md`, and task 4.1's assertion list. If no, state why with the same rigor D4 gave `team_id`'s NULL treatment — as written, this reads as an unstated gap, not a decision, and it's the one place this proposal's new "authoritative" record is less complete than the log line it's replacing in authority (Finding 1).
2. **Non-blocking, cheap:** Consolidate the full `metadata` object shape into one place (D5's code sample is the natural spot) rather than requiring cross-referencing D2 + four spec scenarios to reconstruct it (Finding 2).

Neither of these reopens a scope decision already made correctly. Both are about making sure the one new row this change adds is as complete, and as unambiguously specified, as the log line it's meant to outrank.
