# BA Review: Fix Local OIDC Login Proposal

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source:** `openspec/changes/fix-local-oidc-login/proposal.md`, `design.md`, `tasks.md`, `specs/oidc-auth/spec.md`
**Date:** 2026-09-16

---

## Overall read

This is a one-line bug fix and the proposal is scoped like one — it doesn't over-explain, and it doesn't under-specify either. Every claim I checked against the actual code held up: the line number, the `trustProxy: 1` setting, the JWKS commit reference, the fact that the authorization step reads `OIDC_REDIRECT_URI` from config while the callback step reconstructs the URL from the request (which is exactly why only one side of the flow has the bug). Acceptance criteria are explicit, not aspirational. I have no blocking findings. Two small precision notes below, plus the spec-delta assessment the team specifically asked for.

---

## 1. Capability specificity and acceptance criteria

The "What Changes" section names the exact file, the exact property swap (`request.host` for `request.hostname`), and the exact reason. That's buildable without a clarifying question — there's no "improve callback handling" vagueness here.

Verification (proposal.md Impact, tasks.md §3) is concrete and, notably, closes a loophole I'd otherwise have flagged: task 3.3 states "a redirect to an error page does not occur... even if the redirect itself completes without a thrown exception." That's the right instinct — a naive verification step could pass on an exception-free redirect that still lands the user on `/auth/error`, which is not a fix. Calling that out explicitly means an implementer can't claim done on a technicality. I'd have raised this as a gap if it weren't already there.

I checked the three "not in scope" bullets against the code, since scope-fencing claims are exactly the kind of thing that quietly rot if unverified:
- JWKS key: confirmed still fixed 2048-bit inline key in `docker/oidc/server.js`, comment intact from commit `4cd06e3`. No re-touch needed or planned.
- Production inertness: confirmed `trustProxy: 1` in `app.ts`, no reverse-proxy config in `docker-compose.yml`. The claim that `request.host` and `request.hostname` produce identical strings in production (default-port HTTPS never carries a port in `Host`/`X-Forwarded-Host`) is sound reasoning, not just asserted.
- No existing test currently exercises the callback's host reconstruction (`auth.test.ts` sets `OIDC_REDIRECT_URI` but nothing asserts on the reconstructed callback URL) — so the "no automated regression test" trade-off in design.md is an honest accounting of a real gap, not a hand-wave over an already-covered case.

No vague language flagged. "SHALL," "is closed," "is not open for the implementer to revisit" — this proposal commits to positions rather than leaving them soft.

---

## 2. Spec delta assessment (the item I was asked to focus on)

Short answer: the delta is well-scoped, accurate, and follows the established convention. It does not overreach.

**Convention check.** I compared it against the `persona-login` precedent it cites (`openspec/changes/archive/2026-09-16-persona-login/specs/local-dev-environment/spec.md`), which also used a MODIFIED requirement that (a) preserved the full original requirement paragraph, (b) preserved every original scenario verbatim, and (c) appended new scenarios for the newly-documented behavior. This delta does exactly that: I diffed it line-by-line against the current `openspec/specs/oidc-auth/spec.md` "OIDC callback and token validation" requirement, and all five original scenarios (valid exchange, signature failure, expiry, audience mismatch, single-use state) are reproduced unchanged. The only additions are one sentence appended to the requirement paragraph and one new scenario at the end. That's the minimal-diff shape a delta should have — nothing rewritten that didn't need to be.

**Accuracy check.** The new requirement sentence — "The callback URL reconstructed for the token exchange SHALL preserve a non-default port present on the incoming request, so that the token exchange's `redirect_uri` matches the `redirect_uri` registered at the authorization step" — matches what the code fix actually does. I confirmed the authorization step uses `config.OIDC_REDIRECT_URI` directly (`oidc-client.ts:33`) while the callback step reconstructs from `request.protocol`/`request.hostname`/`request.url` (`auth.ts:121-122`), which is precisely the asymmetry the new sentence is describing. Nothing in the delta asserts behavior the code doesn't have or claims verification (e.g., against staging/prod) that wasn't done — the design doc is honest that production inertness is reasoned, not tested, and the spec delta doesn't overstate that into a tested claim.

**Scope check.** The delta touches exactly one requirement, in exactly one capability, and doesn't smuggle in anything about the JWKS key or any other behavior. Good — that boundary was worth watching given the proposal spends real effort telling future readers not to re-touch the JWKS fix; it would have undercut that discipline if the same delta then wandered into unrelated territory.

**One precision note, not blocking.** The proposal's framing — "the same way `local-dev-environment`'s JWKS-key-adequacy scenario was added" — is a paraphrase, not a literal scenario title. The actual precedent scenario is named "ID token issuance succeeds on every exchange" (with the adequacy language living in the requirement paragraph above it, not the scenario title). A future reader searching for a scenario literally titled "JWKS-key-adequacy" won't find one. Not worth revising the delta over, but if this proposal or a later doc is used as a citation trail, it should point to the requirement text rather than imply an exact scenario name.

**One wording gap worth a sentence, not blocking.** The requirement says the callback URL "SHALL preserve a non-default port present on the incoming request." It's silent on what happens when the incoming request *does* carry a default port explicitly (e.g., a `Host: example.com:443` header) — presumably preserved too, since `request.host` doesn't distinguish, but the spec as written only commits to the non-default case, which is the only case that matters for this bug. I wouldn't hold up the change for this, but if a future scenario ever depends on default-port preservation, this delta shouldn't be cited as already covering it.

---

## 3. Requirements traceability

Checked against `requirements/BRD.md` NFR-AUTH-002 ("a simulated OIDC provider must be used... for local development and development machine testing... must support all token flows exercised by the application"). This bug is a direct violation of that NFR as currently implemented — local sign-in doesn't work at all — so the fix is closing a gap against an existing hard requirement, not introducing new scope. No BRD or use-case document specifies port-reconstruction behavior at the level of detail the spec delta now states, which is exactly the gap the proposal describes: an implicit expectation ("local dev auth should work") that was never made explicit enough to have caught this bug. Making it explicit now is the correct corrective action, not scope creep.

---

## Summary

No blocking findings. This proposal and its spec delta are ready to build from as written:

1. Capabilities and acceptance criteria are explicit and testable, including a good guard against a false-pass verification (tasks.md 3.3).
2. The spec delta is accurate, minimally scoped, and follows the project's established MODIFIED-requirement convention faithfully.
3. Two non-blocking precision notes: the "JWKS-key-adequacy scenario" reference is a paraphrase rather than a literal title (§2), and default-port behavior is left implicit rather than stated (§2). Neither needs to hold up implementation.
