# Implementation Security Review — session-timeout-continuity

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Scope: security-sensitive surfaces only, verified against the actual diff (`git diff main`), not design.md's description of it.

## Summary

The implementation matches the design's security-relevant decisions closely. The close-code split, the `returnTo` allow-list, and the facilitator-reconnect broadcast are all implemented as specified, with test coverage for the adversarial cases I care about (CRLF/backslash injection, non-UUID segments, full-URL rejection, single-use, provider-agnosticism). I found one documentation-drift defect and no code-level regression of the three properties I was asked to verify.

## 1. Close-code split — CONFIRMED CORRECT

`packages/backend/src/realtime/websocket-routes.ts:74-75`:
```
const CLOSE_UNAUTHORIZED = STALE_SIGNAL_CLOSE_CODE;
const CLOSE_FORCE_EXPIRED = REAUTH_GRACE_EXPIRED_CLOSE_CODE;
```
`STALE_SIGNAL_CLOSE_CODE` (4000) and `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (4001) are distinct values (`packages/shared/src/types/ws-close-codes.ts`). `CLOSE_UNAUTHORIZED` is used only at the two subscription-rejection `socket.close()` call sites (lines 103, 214); `CLOSE_FORCE_EXPIRED` is used only inside `scheduleForceClose` (line 410). No merge, no confusion — these did not get crossed.

**Defect (documentation drift, not a code defect):** `packages/shared/src/types/ws-close-codes.ts`'s doc-comment on `STALE_SIGNAL_CLOSE_CODE` still reads "used for every server-initiated close whose cause must not be disclosed... an unauthorized subscription attempt **and the scheduled absolute-lifetime force-close**." That is no longer true — this file was not touched by this change (confirmed via `git diff main --stat`) even though Decision 1 changes exactly the fact this comment states. This is precisely the risk design.md's own Risks section named ("a future reader... could mistake this change's narrowing as evidence those protections are generally negotiable") — except here it's sharper: a future reader of this specific comment will be told something false about current behavior. Recommend fixing the comment before merge; low severity (comment-only, the delta spec in `openspec/changes/.../specs/websocket-session-authorization/spec.md` states the current truth correctly), but it sits on a security-relevant constant and should not ship stale.

## 2. `returnTo` allow-list — CONFIRMED CORRECT

All required properties verified directly in `packages/backend/src/routes/auth.ts`:
- Same-origin only: value is a bare path, never a full URL; scheme/authority (`://`) and protocol-relative (`//`) prefixes rejected.
- UUID-pinned `:id`: `RETURN_TO_ALLOW_LIST` regexes require the standard 8-4-4-4-12 hex shape, not a loose `[^/]+` class — a non-UUID segment (`/session/not-a-uuid`) is rejected (test-covered).
- CRLF/backslash rejected **before** allow-list match: `validateReturnTo` calls `rejectReturnToCharacters` first and returns early on `\r`, `\n`, or `\`, independent of whether the rest would otherwise match — test-covered including a CRLF header-injection payload.
- Logging: rejection logs at `log.debug(...)`, not an audit event — matches design intent (discard-trace visibility without an audit-tier signal for routine probing).
- Single-use: the entire OIDC state blob (nonce, codeVerifier, `pendingJoinToken`, `returnTo`) is read via one atomic `redis.getdel`, so a `returnTo` value cannot be redeemed twice — it dies with the one-time state key, same as `pendingJoinToken` always has.
- No OIDC-provider branching: `validateReturnTo` reads only `request.query` and fixed regexes; test explicitly asserts identical behavior across a changed `OIDC_ISSUER`.
- No authorization grant/inference at the destination: the callback only sets `redirectUrl` to the validated path and issues an HTTP redirect. It performs no authorization check itself — by design, the destination route (`/session/:id`, `/team/:id`) re-evaluates the requesting user's authorization on landing, same as any direct navigation. I checked there is no shortcut here (e.g., no session/grant object stamped alongside the redirect).

Precedence (`pendingJoinToken` wins over `returnTo`) matches design.md and is test-covered.

## 3. Facilitator-reconnect broadcast — CONFIRMED CAUSE-BLIND AT THE WIRE

`FacilitatorConnectionStatusPayload` (`packages/shared/src/types/realtime.ts`) is `{ connected: boolean }` — nothing else. Traced the payload end to end:
- Publish call sites (`websocket-routes.ts`, connect/disconnect) construct only `{ connected }`, sourced from the same fact that already feeds `recordFacilitatorConnectionAudit` — one detection, two consumers, as designed.
- `ws-event-dispatcher.ts`'s new case forwards `envelope.payload` unchanged (no augmentation), filters out the facilitator's own connection via `subscriberPath`, and re-runs `evaluateSessionSubscriberAccess` per candidate before sending — consistent with every other dispatch case.
- Frontend consumer (`facilitatorConnectionStatus.ts`) reads only `message.payload.connected`; `FacilitatorReconnectIndicator.tsx` renders a fixed string with no interpolation of anything else. No close code, cause, or sub-cause reaches the wire or the DOM.

The Redis `facilitator_connected:<sessionId>` flag used to detect an actual transition is correctly scoped (read-before-write, cleared on session exit from `pre_session`/`active` via `facilitator-sessions.ts`), gated to the same status window that gates the broadcast, and is not itself observable by any client — no new disclosure surface.

## Design-vs-implementation fidelity

I compared the actual `MODIFIED` requirement text now present in `openspec/changes/session-timeout-continuity/specs/{websocket-session-authorization,websocket-staleness-signal}/spec.md` against the code, not just against design.md's narrative. The delta specs correctly narrow scope (elapsed-time disclosure vs. identity disclosure; one copy string vs. the rendering mechanism; one allow-listed parameter vs. general parameterization) and the code matches those deltas exactly — role/returnTo props, single-conditional vote-loss sentence, CTA construction (`encodeURIComponent`, single param, unconditional fallback to bare `/auth/login`). No new security-relevant behavior appeared in the implementation that wasn't specified in design.md or the delta specs.

## Verdict

No blocking findings. One non-blocking documentation defect (stale comment in `ws-close-codes.ts`) should be fixed before merge so the constant's own documentation doesn't contradict its actual current usage.
