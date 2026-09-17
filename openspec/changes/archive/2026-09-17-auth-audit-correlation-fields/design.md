## Context

`GET /auth/callback` mints `correlationId = crypto.randomUUID()` once, at handler entry
(before the `try` block), and it is already in lexical scope at every emit site this
change touches — there is no parameter-threading problem to solve. `auth.first_access_created`
and `auth.role_claim_mapped`, added by the first-access change, already emit the target
shape (`sourceIp: request.ip`, `correlationId`) from inside the same closure. This change
copies that existing, already-reviewed pattern onto three sibling emit sites; it does not
invent a new one.

## Goals / Non-Goals

**Goals:**
- Make `auth.callback_received`, `auth.session_created`, and `auth.success` carry the
  same field shape (`sourceIp`, `correlationId`) already used by every other
  security-relevant event in this handler.
- Guarantee, and test directly, that all events from one invocation share the *same*
  `correlationId` value — the risk this change exists to close is a same-shape,
  wrong-value implementation (a fresh `crypto.randomUUID()` per emit site) that would be
  green on field-presence tests while leaving the audit trail no more traceable than
  before.

**Non-Goals:**
- Changing `emitAuditEvent`'s signature or adding field-presence enforcement at the
  logger level for the ~30-event union in `audit-logger.ts`. A legitimate idea, but a
  separate, larger initiative — not what issue #4 asks for.
- Extending `correlationId`/`sourceIp` coverage to `join.link_rejected`/`join.link_redeemed`
  in `executeJoinFlow`. Unlike the three sites this change touches, `executeJoinFlow`
  (auth.ts:541) is a standalone top-level `async function` taking `(userId, token, logger,
  sourceIp)` as explicit parameters — not a closure over the callback handler's locals.
  `correlationId` is not already in scope there; adding it would require threading it
  through as a new explicit parameter, the same way `sourceIp` was threaded through for
  Finding 2. Issue #4 doesn't name these events and they're a separate event family; the
  parameter-threading work is a real, if small, follow-on if this coverage is wanted later.
- Re-opening the `missingClaim: "sub"` vs. `"id_token"` precision note or the
  `session.destroy()` test-coverage gap noted elsewhere in the same implementation
  review — unrelated, already-tracked items.

## Decisions

There is no design decision to make here — this is conformance to a pattern the
codebase already established and reviewed (`auth.first_access_created`,
`auth.role_claim_mapped`). The only implementation discipline worth naming explicitly:

**Reuse the existing `correlationId` binding; never call `crypto.randomUUID()` again at
any of the three new call sites.** The value must be the same local `const correlationId`
already declared at line 119, read by reference at each site — copy-pasting the
`first_access_created` object shape without also reusing that binding is the one way to
produce code that passes a naive field-presence test while still being useless for
tracing a single sign-in through the log (see AC1 in proposal.md).

## Risks / Trade-offs

- **A same-shape, wrong-value implementation (fresh UUID per site) passes
  field-presence-only tests.** → Mitigated by making cross-event `correlationId` identity
  a directly-asserted test requirement (`expect(eventA.correlationId).toBe(eventB.correlationId)`),
  not just `expect.any(String)` on each event independently — see tasks.md and the
  `auth-error-handling` spec delta.
- **None of the other kind** — this is a three-field, additive-only change to an
  already-reviewed logging pattern in one handler; no new dependency, no schema change,
  no behavior change to redirects, sessions, or the join flow.

## Migration Plan

No migration. Standard backend deploy; the change only adds fields to existing log
entries. No externally-observable behavior change — redirects, session handling, and
response bodies are untouched.

## Open Questions

None.
