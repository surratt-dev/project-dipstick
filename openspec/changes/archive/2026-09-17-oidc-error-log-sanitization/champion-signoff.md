# Champion Sign-off: OIDC Error Log Sanitization

**Reviewer:** Devon Calloway (Internal Champion / Subject Matter Expert)
**Date:** 2026-09-17
**Basis:** Re-read my own `exploration-notes.md` against `proposal.md`, `design.md`,
`tasks.md`, `implementation-review-security.md`, the shipped
`packages/backend/src/auth/oidc-error-sanitizer.ts`, and the delta spec, plus confirmed
issues #121–#123 are actually filed and open, not just claimed as filed.

## Verdict: Signed off. This shipped what I found, not a softened version of it.

This isn't the ritual, so my usual four load-bearing constraints don't apply here — but
the same instinct does: check the artifact against the evidence, not against the
narrative about the evidence. I did that, line by line, against the code that's actually
in the tree.

## The four things I was asked to check

**1. Did it close the real leak, not the speculative one?** Yes. My exploration found
the issue's own hypothesis (nonce/claim/JWT content in `err.message`) was already safe
by construction, and that the actual active leak was `error_description`/`cause` on
`ResponseBodyError`/`AuthorizationResponseError`/`WWWAuthenticateChallengeError` reaching
logs verbatim via ordinary enumerable field assignment. `oidc-error-sanitizer.ts` redacts
exactly those fields on exactly those three classes, and does it structurally (explicit
`"[redacted]"` literals in an opt-in object literal) rather than depending on the
incidental non-enumerability that made the `OperationProcessingError` family safe before
this change. Task 5.1's manual walkthrough reproduced a real reused-auth-code failure
against the actual local OIDC stub and confirmed the same thing empirically, not just via
unit tests. The security reviewer independently re-derived my call-site list by grep
rather than trusting `design.md`'s account of it, and found nothing extra. Good.

**2. Did it stay provider-agnostic?** Yes. Dispatch is by `instanceof` against
`oauth4webapi`/`openid-client`-exported classes, never by string content. No `AADSTS`
parsing anywhere in the sanitizer — I checked. The spec delta's "OIDC library error
sanitization" requirement states the guarantee's actual boundary explicitly ("integrated
through the same OIDC client library... a provider integrated through a different client
library is outside this guarantee") rather than the unqualified claim I'd have worried
about — that's D7 and design review Finding 3 doing their job. Issue #122 correctly
carries forward what this change can't close on its own: synthetic canaries prove the
mechanism is provider-agnostic by construction, not that a second real IdP's output maps
cleanly onto these four classes. That's an honest boundary, not a gap someone's hoping
nobody notices.

I'll note the one place I pushed back during exploration — the Facilitator's suggestion
to parse the AADSTS number out for operator convenience — stayed rejected. Good; that
would have reintroduced exactly the Entra-shaped special case the whole design exists to
avoid, for a diagnostic convenience that the debug-capture follow-up (issue #121) is the
correct release valve for instead.

**3. Was diagnostic value preserved, not just destroyed?** Yes. `errorClass`, the
internal `code` enum, the OAuth `error` enum, `message`, and `stack` all survive
unredacted where the underlying class actually has them (`WWWAuthenticateChallengeError`
correctly omits `error`/`error_description` as absent rather than fabricating a
redaction marker for a field that doesn't exist — a real distinction, not padding).
Redacted fields show `"[redacted]"`, not silence — the operator can tell "withheld on
purpose" from "logging broke," which was the whole point of that acceptance condition.
The task 5.1 walkthrough log line is genuinely useful: `errorClass`, `code`, `error`, and
`stack` are enough to diagnose a reused-authorization-code rejection without any IdP free
text. That's the bar I care about, and it's met.

**4. Were the pipeline's constraints actually honored, not just referenced?**

- Fail-closed on unrecognized classes: verified in the source — no `default: return
  {...err}`, unconditional redaction plus a distinct `unrecognized_class` signal, and the
  security reviewer independently traced this and confirmed no bypass path exists.
- Shared wrapper across all call sites: `auth.ts` (`/auth/callback`, `/auth/logout`) and
  `middleware.ts` (`refreshSessionTokens`) all route through the same
  `sanitizeOidcError`, confirmed by the security reviewer's own independent grep sweep,
  not just by the design doc's claim.
- Regression suite: real constructed instances against the actually-installed library
  versions, canary strings asserted absent from final serialized JSON (not the
  pre-serialization object), redaction-as-marker asserted as a positive case (not just
  canary-absence, which a silent `delete` would also pass). This is exactly the
  "structural, not incidental" bar my exploration notes set, and it's what the security
  reviewer says they personally re-ran, not just read.
- Onboarding comment: present at the top of the sanitizer module, covers the
  enumerability distinction, the `errorClass`-vs-`type` pino collision, the
  `WWWAuthenticateChallengeError` absent-fields note, and a checklist for the next person
  who adds a provider or a library version bump. That's the artifact my Finding 2 asked
  for, not a paraphrase of it.

One incidental fix rode along (`isRevocation` misclassifying revoked refresh tokens as
transient) — outside my original exploration scope, but D10's reasoning for including it
is sound (one line, reads a field this change already establishes as safe, doesn't
expand the sanitizer's surface), and it's independently verified by the security review.
I have no objection to it landing here rather than as a separate change.

## What's still open (as intended, not as a miss)

Issues #121 (debug-level capture sign-off), #122 (second-provider re-verification), and
#123 (caret-range dependency flag) are filed, open, and correctly scoped as follow-ups
rather than blockers — I checked they exist and aren't just referenced in prose. None of
them represent intent that got lost; they're intent that was correctly deferred with an
owner and a default, which is the distinction I was pushing for during exploration review.

## Bottom line

The pipeline didn't just implement my exploration notes — the design and security review
stages caught and fixed things I'd have missed on my own (the `type`/`"Object"` pino
collision, the `getEndSessionUrl()` raw-throw path, the spec overclaiming the
multi-provider guarantee). That's what these stages are for, and it worked as intended
here. Nothing in what shipped waters down the finding. Cleared.
