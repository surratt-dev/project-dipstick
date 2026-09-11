# Implementation Review — Security Analyst (Tomás Ferreira)

Reviewed on branch `agent-team/websocket-specification`, via `git status` / `git diff` against the actual working tree (not proposal/design text). This covers the two items my design review made conditions of implementation review: (1) accountability for the DEFERRED cross-recipient skew-measurement gap, and (2) confirming — not assuming — that the `observed_latency` monitoring destination is access-controlled at least as tightly as session-tagged audit logs.

**Sign-off: granted for tasks 2.7 and 2.9's Security Analyst component.** No blocking findings. Two low-severity hardening recommendations below, neither of which I'm gating on.

---

## 1. `POST /api/v1/sessions/:sessionId/reveal-latency` — authorization boundary

`packages/backend/src/routes/sessions.ts` (new handler, end of file). This is the right boundary. `evaluateSessionSubscriberAccess(session.userId, sessionId)` is imported unmodified from `session-subscriber-access-helper.ts` and is the *exact* grant check `dispatchVoteRevealed` uses to decide who receives `vote_revealed` in the first place (confirmed by reading that helper's Path 1/Path 3 logic and cross-referencing `ws-event-dispatcher.ts`). That is the correct property to enforce here: only a caller who could legitimately have *received* this session's reveal may report a latency observation for it. A grant of `null` returns 403 before either the auth check or the body is otherwise touched, and the 403 body is identical whether the session doesn't exist or the caller simply isn't a subscriber — no session-existence oracle.

Authentication itself is enforced upstream: `app.ts` registers `authMiddleware` globally before `sessionRoutes`, and `middleware.ts`'s `PUBLIC_ROUTES` allowlist (`/health`, `/auth/*`, `/api/join/`) does not include this path, so an unauthenticated caller is rejected with 401 by the `onRequest` hook before the route handler ever runs. Combined with the 403 from `evaluateSessionSubscriberAccess`, this closes both gaps I'd normally check for on a new write endpoint: no-session-at-all, and authenticated-but-wrong-session.

Body validation (`typeof serverTimestamp !== "string" || typeof observedLatencyMs !== "number" || !Number.isFinite(observedLatencyMs)` → 422) is hand-rolled rather than a Fastify JSON-schema route option, but that matches this file's existing convention throughout (`sessions.ts`'s other handlers validate the same way) — not a new pattern, not a regression.

## 2. Does routing through `emitAuditEvent` actually satisfy the access-control requirement, or create new risk?

I required at design review that this be *confirmed*, not assumed. Confirmed: `emitAuditEvent(request.log, "session.reveal_latency_observed", {...})` calls the exact same function, unmodified, that every other `session.*` operational event in `audit-logger.ts` calls — same `logger.child({ audit: true })` construction, same forced `info` level, same sink. There is no new destination, no new transport, no new consumer introduced by this change. Whatever access controls exist on that structured-log sink today (log aggregation ACLs, retention, who can query it) apply to this event identically to `session.access_revoked_live` or `session.token_refresh_failed_live`, by construction — because it is the same call, not a parallel one. That's the strongest form of the confirmation I asked for: not "we believe the new pipe is equally locked down," but "there is no new pipe."

**New-risk check, since a client-supplied metric now flows into what is nominally the audit log surface:**

- *Audit integrity/signal dilution:* the new `AuditEventName` entry carries an explicit comment — "Not a security audit record... session-tagged operational... No vote value or vote type" — and the metadata shape (`sessionId`, `serverTimestamp`, `observedLatencyMs`) contains no vote content, no PII beyond the session tag already present on sibling events, and no auth material. It's clearly distinguished from the events around it in `audit-logger.ts` by name (`session.reveal_latency_observed` reads as a metric, not an action) and by comment. It does not weaken the audit trail's evidentiary value for the events that matter for incident reconstruction — those are unchanged, separately named, and (per the file's existing convention) most have a companion `audit_log` DB row as the authoritative record. This metric event has no DB counterpart, correctly, since it isn't a security record.
- *Injection into the log sink:* `emitAuditEvent` writes via pino's structured `.info({...})` call — fields are serialized as JSON object properties, not concatenated into a text line, so arbitrary string content in `serverTimestamp` can't break out of the log record's structure the way it could with naive text-log concatenation. Not a concern.
- *Write-path abuse by an authorized-but-adversarial subscriber:* this is the one real finding, and it's low severity. `observedLatencyMs` has no bounds check beyond "finite number" (negative values, `Number.MAX_SAFE_INTEGER`, etc. all pass), `serverTimestamp` has no length bound or format validation beyond "is a string," and there is no rate limiting on this endpoint (confirmed: no `@fastify/rate-limit` or equivalent is registered anywhere in `app.ts`, and this is consistent with every other write endpoint in this codebase — not a gap this change introduces). A legitimate session participant could script repeated calls with fabricated values to pollute the metric stream. This cannot escalate privilege or disclose data belonging to another session (the authorization check still scopes every write to a session the caller is already entitled to observe), so I'm not gating on it. **Recommendation, non-blocking:** a sane upper bound on `observedLatencyMs` (e.g., reject values incompatible with the 15-second SLA window this metric exists to measure — a few orders of magnitude past it is never a real observation) would cheaply improve signal quality without adding a security control. I'd rather see this picked up opportunistically than force a follow-up task for it.

## 3. Test coverage — `sessions.test.ts`

Read the three new cases in `packages/backend/src/routes/__tests__/sessions.test.ts`. They verify what I need them to:

- Authorized subscriber (participant-path grant row) → 202, `emitAuditEvent` called exactly once with the correct event name and metadata shape.
- No grant (`evaluateSessionSubscriberAccess` returns `null` via empty query result) → 403, `emitAuditEvent` **not called**. This is the case I care about most — an unauthorized caller must never reach the audit-emitting line — and it's asserted directly via `expect(mockEmitAuditEvent).not.toHaveBeenCalled()`, not inferred from the status code alone.
- Malformed body (`observedLatencyMs` as a string) → 422, `emitAuditEvent` not called.

No gap here. I'd note the unauthorized-caller test's comment ties it explicitly to "task 2.8" and states the security property in its own words, which tells me the implementer understood *why* the check exists, not just that a check exists.

## 4. `serverTimestamp` — server-side-only stamping, capture point

Verified both halves of my prior design-review ask directly in the diff, not from the surrounding comments:

- **Capture point:** `facilitator-sessions.ts`'s reveal handler stamps `serverTimestamp: new Date().toISOString()` inline in the `publishVoteRevealed(...)` call, which the surrounding (unchanged) comment confirms happens only after the state-transition transaction has committed. This is the only production call site of `publishVoteRevealed` (grepped — the sole non-test caller). No other path can construct a `vote_revealed` fan-out with a different or missing timestamp.
- **Forwarding point:** `ws-event-dispatcher.ts`'s `dispatchVoteRevealed` reads `const { serverTimestamp } = envelope.payload;` **textually before** the `await Promise.all(candidates.map(...))` block and forwards that same closed-over value to every recipient inside the loop — it does not call `new Date()` anywhere in this function. This was the literal ask from my design review (the one place a correct design could regress into a per-recipient timing leak), and it's satisfied as written, not merely as commented.
- **Test coverage goes further than I asked for:** beyond the single-registry assertion, `ws-event-dispatcher.test.ts` adds a cross-pod case — two independent `ConnectionRegistry` instances, `handleIncomingMessage` invoked separately against the identical serialized envelope — asserting both pods' recipients get the identical `serverTimestamp`. That's the correct test to distinguish "reads the envelope field" from "happens to run fast enough that two `new Date()` calls look identical," which a single-registry test genuinely cannot distinguish. Good test.
- **Not client-influenceable:** the client never supplies `serverTimestamp` on the way in — it only ever *reads* the value the server already sent it on a `vote_revealed` message and echoes it back on the `reveal-latency` report. There is no path by which a client's own clock or input affects what gets stamped into the WS fan-out.

## 5. New information-disclosure surface — endpoint and frontend module

`packages/frontend/src/realtime/voteRevealedLatency.ts`: `attachVoteRevealedLatencyLogger` only acts on messages it can parse as `vote_revealed` and only reads `message.serverTimestamp` — a value the server already sent that same client on the authorized WS channel. It computes latency locally, logs to `console.info`, and POSTs `{ serverTimestamp, observedLatencyMs }` back to the backend over the existing session cookie (`credentials: "include"`), consistent with this app's existing cookie-based auth (`httpOnly`, `secure` in production, `sameSite: "strict"` — set in `app.ts`'s session registration, unchanged by this diff). `sameSite: "strict"` means this POST can't be forged cross-site, so no new CSRF surface. The fetch is fire-and-forget (`.catch(() => {})`) and never surfaces failures to the participant, which is the correct choice for a telemetry path — it must not become an availability dependency for the voting flow itself.

No new disclosure: this endpoint accepts data, it doesn't return any session content, vote data, or other users' information in its response (`{ recorded: true }` only, on 202). The reveal-latency report contains only timing data — no vote value, no vote type, nothing beyond what the two audit-logger comments already state.

## 6. Accountability for the DEFERRED cross-recipient skew-measurement gap

This was my one *required* change at design review. Verified it landed in the actual change artifacts, not just as a stated intent:

- `design.md`'s D2 discussion now states the gap with a named owner (**Marcus Oyelaran, FSE**) and ties it to `tasks.md` 5.4/6.5 by task number, not a naming paragraph alone.
- `tasks.md` 5.4 creates the actual obligation: file a GitHub issue tracking the archived `websocket-delivery-time-authorization` change's Group 6 measurement work specifically (not a generic "measure performance" issue), then update `spec.md`'s callout and `design.md`'s D4 invariant #2 to cite the issue number.
- `tasks.md` 6.5 is a hard archiving gate — "a stated intent to file is not the same completion condition as the issue existing" — mirroring the teeth I asked for, matching the treatment already given to the two `[PREF]` events (task 6.4).
- `spec.md`'s own callout of the gap (grepped directly) states the same owner, the same accountability structure, and the same mitigating-factor caveat (variance in `observed_latency` is a weak, unbudgeted signal, not a substitute for the formal measurement).

**Status, not a finding:** tasks 5.4 and 6.5 are both still unchecked (`[ ]`) as of this review — the GitHub issue has not yet been filed. That is expected at this point in the pipeline (accountability *structure* is a design-review-time deliverable; *filing the issue* is correctly scoped as a pre-archive gate, not a pre-implementation-review gate) and I am not blocking implementation sign-off on it. I am reiterating, for whoever runs the archive-time check: **6.5 must actually be verified — the issue must exist and be linked — before this change archives.** I will not consider this item closed until I see that link.

## Minor, non-blocking observation (not my lane, flagging for the record)

`requirements/design/REST API Contract.md`'s diff adds the dot-notation correction note (task 4.1) but does not add the new `POST /api/v1/sessions/:sessionId/reveal-latency` REST endpoint to the contract document itself. That's a documentation-completeness question for the architect/BA pass, not a security finding — the endpoint's actual behavior is what I reviewed and it's correct — but a reader of the REST contract alone wouldn't know this endpoint exists.

---

## Summary

| Item | Status |
|---|---|
| `evaluateSessionSubscriberAccess` reused as the authorization boundary | Confirmed correct — identical to `vote_revealed` delivery's own check |
| Unauthenticated caller | Blocked upstream by global `authMiddleware`, before reaching the handler |
| Wrong-session caller | 403, indistinguishable from nonexistent session, no `emitAuditEvent` call |
| Malformed body | 422, no `emitAuditEvent` call |
| Monitoring destination access control | Confirmed by construction — same `emitAuditEvent` pipe as other session-tagged operational logs, not a new destination |
| Audit log integrity/signal | Preserved — event clearly marked as a metric, no vote content, no DB-row companion (correctly, since it isn't a security record) |
| `serverTimestamp` capture/forward | Server-side only, single capture point post-commit, forwarded unmodified per-pod, verified by a cross-pod test |
| New information disclosure | None found |
| Skew-measurement gap accountability | Structure landed as required; issue-filing (5.4) and archive gate (6.5) still open — must be checked before archive |

No blocking findings. Sign-off granted for the Security Analyst component of tasks 2.7 and 2.9.
