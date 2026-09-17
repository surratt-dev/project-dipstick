## Why

`GET /auth/callback` (`packages/backend/src/routes/auth.ts`) mints one `correlationId`
per invocation and already threads it, along with `sourceIp`, through every audit event
in its failure path and through `auth.first_access_created`/`auth.role_claim_mapped` on
the success path. Three sibling emit sites in the same handler don't follow that pattern:
`auth.callback_received` carries `sourceIp` but not `correlationId`; `auth.session_created`
and `auth.success` carry neither field. SEC-12 states the audit log's job is to let
incident response reconstruct a sequence of events after the fact, and the existing
`auth-error-handling` spec already documents `correlationId` as the mechanism for
correlating a user-visible error with server-side logs — this gap means that mechanism
silently stops working for the three events named in GitHub issue #4, on both the
success and failure paths through this handler. The architect's first-access
implementation review already flagged this as a pre-existing gap to close before first
production deployment (Finding 1); this change closes it.

## What Changes

- Add `correlationId` (the single instance already minted via `crypto.randomUUID()` at
  handler entry) to the `auth.callback_received` emit call, which already carries
  `sourceIp`.
- Add `sourceIp: request.ip` and `correlationId` to the `auth.session_created` and
  `auth.success` emit calls, matching the field shape already used by
  `auth.first_access_created` and `auth.role_claim_mapped` in the same handler.
- **AC1 (identity, not just presence):** every audit event emitted during a single
  `GET /auth/callback` invocation MUST carry the *same* `correlationId` value — the one
  bound at handler entry — not a freshly generated UUID per emit site. This applies to
  `auth.callback_received`, `auth.session_created`, `auth.success`, and whichever of
  `auth.first_access_created`/`auth.role_claim_mapped` fires, and holds on the failure
  path (`auth.callback_received` → `auth.failure`) as well as the success path.
- **AC2 (presence):** `auth.success` and `auth.session_created` each carry `sourceIp` and
  `correlationId`; `auth.callback_received` carries `correlationId` (it already has
  `sourceIp`).
- Add tests asserting cross-event `correlationId` identity directly
  (`expect(eventA.correlationId).toBe(eventB.correlationId)`), not just independent
  field-presence checks, for both the success-path chain and at least one
  `auth.callback_received` → `auth.failure` scenario.
- **Explicitly out of scope:** no change to `emitAuditEvent`'s signature or any
  field-presence enforcement in the logger itself; no `correlationId`/`sourceIp` added to
  `join.link_rejected`/`join.link_redeemed` (a separate event family issue #4 doesn't
  name — its own follow-on if wanted); no re-opening the `missingClaim: "sub"` vs.
  `"id_token"` precision note or the `session.destroy()` test-coverage gap from the same
  review doc.
- **Additive-only, no new data classification:** this adds fields to existing event
  shapes; it doesn't rename, remove, or restructure anything. `sourceIp` and
  `correlationId` are already-approved field types under SEC-16 and already emitted by
  other events in this same handler, so no new data-classification review is triggered.
- **Reviewer sign-off scope:** this is a backend audit-logging conformance fix with no
  session-flow or facilitator/participant-facing surface. Facilitator/SME sign-off is not
  required for this change — confirmed with Priya (Facilitator SME), who reviewed the
  exploration and found none of her usual criteria (reveal simultaneity,
  readiness-without-spoilers, outlier-flagging tone, facilitator pacing, first-session
  onboarding) apply.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth-error-handling`: the "Authentication event logging" requirement's "Successful
  authentication logged" scenario currently doesn't state that `auth.callback_received`,
  `auth.session_created`, and `auth.success` carry `sourceIp`/`correlationId`, or that
  those values are identical to each other and to the `correlationId` used elsewhere in
  the same invocation (including the failure path's `auth.failure` event, and
  `auth.first_access_created`/`auth.role_claim_mapped` when they fire). This change
  updates that scenario to state both the field set and the cross-event identity
  invariant explicitly.

## Impact

- `packages/backend/src/routes/auth.ts` — three emit calls inside `GET /auth/callback`
  gain fields; no signature or control-flow changes.
- `packages/backend/src/routes/__tests__/auth.test.ts` — new/extended assertions for
  field presence and cross-event `correlationId` identity, success and failure paths.
- No API, schema, or dependency changes. No change to `emitAuditEvent` or to
  `join.link_rejected`/`join.link_redeemed`.
