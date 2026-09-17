# Engineer Design Review — oidc-error-log-sanitization

**Reviewer:** Marcus Oyelaran (Full Stack Engineer)
**Scope:** design.md, proposal.md, specs/auth-error-handling/spec.md, tasks.md, checked
against exploration-notes.md and the actual installed code (`packages/backend/src/routes/auth.ts`,
`packages/backend/src/auth/{oidc-client,middleware,errors,error-handler}.ts`,
`node_modules/oauth4webapi/build/index.js`, `node_modules/openid-client/build/index.js`).

## Verdict

Implementable, and better-grounded than most designs I review — Devon's exploration
pulled actual source and ran a real pino instance rather than reasoning from docs, and
D1–D7 read as decisions made with that evidence, not assumptions. I have one blocking
implementability gap (§1) and two "resolve before implementation starts" issues around
`middleware.ts` (§2, §3) that should be settled now rather than discovered mid-task,
since the design's own accuracy elsewhere is what makes their absence surprising. Field
allowlists (D3) were independently verified against the actual class definitions and are
correct.

---

## 1. Blocking: `OperationProcessingError` is not reachable via a declared dependency

Design D3 case 2 requires `instanceof OperationProcessingError`. I checked where that
class actually lives:

```
node_modules/openid-client/build/index.js:16
export { AuthorizationResponseError, ResponseBodyError, WWWAuthenticateChallengeError } from 'oauth4webapi';
```

`openid-client` re-exports exactly three of the four library classes the wrapper needs.
`OperationProcessingError` is **not** re-exported — it only exists in `oauth4webapi`
itself. And `oauth4webapi` is not a dependency of this package:

```
packages/backend/package.json:26   "openid-client": "^6.8.4",
```

No `oauth4webapi` line. It's currently a transitive dependency only (pulled in via
`openid-client`'s own `"oauth4webapi": "^3.8.5"` range, resolved to `3.8.6` and hoisted
to the workspace root by npm). `import { OperationProcessingError } from "oauth4webapi"`
will almost certainly *work* today because of that hoisting — but it's a phantom
dependency: nothing in `packages/backend/package.json` declares it, so it doesn't show up
in a dependency audit of this package, and it's not guaranteed to keep resolving under a
different install topology (stricter pnpm/yarn isolation, a workspace restructure, etc.).
Given this design is explicitly trying to make error handling *structural* rather than
*incidental* (that's the whole point of D3 vs. relying on pino's default serializer), it
would be inconsistent to build case 2's dispatch on an import that only resolves by
accident of hoisting.

**Recommendation:** add task 1.0 — declare `"oauth4webapi": "3.8.6"` (exact, matching the
version the regression tests construct instances against) as a direct dependency in
`packages/backend/package.json` before writing the sanitizer module. This also gives
whoever handles task 6.3 (flagging `openid-client`'s `^6.8.4` caret risk) a second,
related line to flag at the same time: `openid-client`'s own `^3.8.5` range on
`oauth4webapi` is one more place a minor bump could shift error-shape behavior without a
change-review trigger on this package's `package.json` alone.

---

## 2. `middleware.ts`'s `refreshSessionTokens` doesn't currently log `err` anywhere

Design's Context section frames every call site as one of two states: "logs the raw `err`
object with no serializer override, or doesn't catch at all." I read the actual catch
block (`packages/backend/src/auth/middleware.ts:103-124`) and it's neither:

```ts
} catch (err: unknown) {
  const isRevocation = err instanceof Error && (...);
  if (isRevocation) {
    emitAuditEvent(log, "auth.token_refresh_failure", { userId, sessionId, source, failureType: "revoked", retryCount });
    return { status: "revoked" };
  }
  retries++;
  ...
}
```

`err` is inspected for the revocation heuristic and then discarded — it never reaches a
`log.error`/`log.warn` call, structured or otherwise, anywhere in this function. The
`transient_failure` path after the retry loop (line 127) has the same shape: an audit
event with no `err` field, nothing else.

Proposal.md's Impact section actually hedges on this ("routes `err` through the new
wrapper before any future/existing logging of it" — emphasis mine), but **tasks.md 2.2**
doesn't carry that hedge: *"route any error logging of `err` through `sanitizeOidcError`"*
is written as an imperative against a log call that doesn't exist. As written, an engineer
picking up 2.2 has two ways to read it — "there's nothing here, mark it done" or "add a
new log line, since observability was clearly intended" — and the design doesn't say
which. That ambiguity is worth resolving now, not mid-implementation, especially since
whichever an engineer guesses affects real behavior: today, an *unrecognized* OIDC error
during token refresh (case 4/5 of D3, the one case this whole design treats as
security-relevant enough to fail closed and emit a loud signal) produces **zero** log
output at this call site — just a generic `failureType: "transient"` audit event with no
`type`/`class` field to even search on.

**Recommendation:** pick one explicitly in design.md before implementation:
- (a) Confirm no log line is wanted here — `sanitizeOidcError` still gets called for
  consistency/future-proofing but its result is discarded or the call is skipped
  entirely, and 2.2 gets reworded to say so plainly. Rationale would need to be "the
  audit event is sufficient" — I'd push back on this one given the fail-closed signal
  (D3 case 4/5) is specifically designed to be loud, and this path can't produce it today
  under this reading.
- (b) Add a genuinely new `log.error({ err: sanitizeOidcError(err, log), userId, sessionId, source, event: "auth.token_refresh_error" }, ...)` (or similar) at the point `retries` is exhausted and/or immediately per-attempt — this is a small, real scope addition beyond "route existing logs through a wrapper," and D3's fail-closed branch only earns its keep here if this call site can actually surface it.

Either is fine; leaving it unstated is what I'd object to, since it's exactly the kind of
gap that "looks done" (task checked off, wrapper technically invoked or technically
skipped) without anyone having decided what "done" means here.

---

## 3. Adjacent, pre-existing bug in the exact code this change touches: `isRevocation` likely never fires on the real signal

Not introduced by this design, but squarely inside the block task 2.2 asks the engineer
to "confirm... still runs against the original error" — phrasing that presumes the check
is currently correct. I verified it against source and don't think it is.

```ts
// middleware.ts:104-107
const isRevocation =
  err instanceof Error &&
  (err.message.includes("invalid_grant") ||
    ("code" in err && (err as { code?: string }).code === "invalid_grant"));
```

The realistic revocation signal is `refreshTokenGrant()` throwing `ResponseBodyError`
when the IdP's token endpoint responds `{error: "invalid_grant", ...}` to a revoked
refresh token. I checked what that error actually looks like
(`node_modules/oauth4webapi/build/index.js:929-941,765-783,1470`):

- `.message` is always the fixed generic string `"server responded with an error in the
  response body"` — never contains `"invalid_grant"`.
- `.code` is always the fixed internal enum `"OAUTH_RESPONSE_BODY_ERROR"` — also never
  `"invalid_grant"`.
- The actual OAuth error code lives on `.error` (`this.error = options.cause.error`),
  which `isRevocation` never inspects.

So `isRevocation` is checking two fields that, per this design's own D3 taxonomy (`code`
= internal enum, `error` = OAuth code), are structurally guaranteed *not* to carry
`"invalid_grant"` for the one class that actually throws it here. As far as I can tell, a
genuinely revoked refresh token today falls through to the `transient_failure` retry
path — two retries, 5s apart — before the session is torn down with
`failureType: "transient"` in the audit trail instead of `"revoked"`. That's an incorrect
audit record and ~10s of pointless latency on what should be an immediate terminal case.

I'm flagging this here rather than filing it as an unrelated bug because this design is
the first change to closely audit this exact error taxonomy, and task 2.2 already has the
engineer's hands in this exact `catch` block. Fixing the check to `err.error ===
"invalid_grant"` (readable off the same `sanitizeOidcError`-recognized shape) is a
one-line, low-risk change adjacent to work already happening here — cheaper to fix now
than to carry forward as a numbered follow-up like 6.1–6.4 and re-discover later.

**Recommendation:** either fold a one-line fix into task 2.2, or if the team wants to keep
this change strictly to logging behavior, add it explicitly as a named follow-up (6.5)
rather than silently leaving `isRevocation` unexamined — given the design now documents
the `code`/`error` distinction precisely enough to make the fix obvious, silence here
reads as an oversight, not a deferral.

---

## 4. Minor / non-blocking

- **D3 case 1's `error_description: "[redacted]"` on `WWWAuthenticateChallengeError`
  doesn't correspond to a real field.** I checked the class
  (`oauth4webapi/build/index.js:799-814`) — it has `cause`, `code`, `response`, `status`,
  but no `error`/`error_description` fields at all (those are `ResponseBodyError`/
  `AuthorizationResponseError`-only). D2's "opt-in object literal per branch" means this
  is harmless (a synthetic redaction marker on a field the source error never had), but
  worth a one-line comment in the wrapper so a future reader doesn't go looking for where
  `error_description` comes from on this class and find nothing.
- **Test-construction pitfall for task 3.2**: `AuthorizationResponseError`'s `cause`
  constructor argument must be a `URLSearchParams`-like value — the constructor calls
  `.get('error')`/`.get('error_description')` on it directly
  (`oauth4webapi/build/index.js:794-795`). A plain `{ error_description: "CANARY_..." }`
  object will throw a `TypeError` at construction time, not produce a testable instance.
  Worth a one-line note in tasks.md 3.2 so whoever writes the regression test doesn't lose
  time to it — I only caught it by reading the constructor.
- **D4's `getEndSessionUrl()` wrapping**: checked against the actual handler
  (`auth.ts:402-437`) — the design's claim that local session destruction already happens
  before this call is accurate (`session.destroy()` at line ~414, well before the
  `getEndSessionUrl()` call at line 426). No issue, just confirming the trade-off callout
  in D4 is describing real code, not a hypothetical.
- **Dual log emission for unrecognized errors (D3 case 4/5)** — worth stating explicitly
  in the task 1.6 onboarding comment that this is intentional: the wrapper's own
  `unrecognized_class` signal line and the call site's normal `log.error(...)` using the
  wrapper's return value are two separate, both-expected log lines per invocation. Without
  that note, a future engineer "cleaning up" what looks like duplicate logging could
  quietly remove the loud-signal behavior this design is built around.

---

## What's solid (no changes needed)

- D3's field allowlists — I independently verified `code`/`error` semantics for all three
  IdP-response classes and `code`/native-`cause`-non-enumerability for
  `OperationProcessingError`/`ClientError` directly against
  `node_modules/oauth4webapi/build/index.js` and `node_modules/openid-client/build/index.js`.
  Exact match to design D3 and exploration Finding 2. This is unusually well-verified for
  a design doc.
- D1 (explicit call-site wrapper over global serializer) — right call, and for the reason
  D1 states: `getEndSessionUrl()` needs a new `try/catch` regardless, so "just add a
  serializer" was never actually simpler.
- D6's approach (assert final serialized JSON via a real `pino()`, not the wrapper's
  return value) — correctly paranoid given D2's own caveat that the returned object still
  passes through pino's default serializer a second time.
- Line references in proposal.md/design.md against `auth.ts` (:334, :426) are accurate as
  of the current code — I checked both directly.
