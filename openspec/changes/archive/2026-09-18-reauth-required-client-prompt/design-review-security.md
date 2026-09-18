# Security Review — `reauth-required-client-prompt` (issue #32)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Authentication flow, disclosure boundary, threat model impact of the client-visible `reauth-required` treatment. Domain/UX/copy taste is explicitly out of my scope.

**Method:** Read `design.md`, `proposal.md`, `tasks.md` for this change; re-read the archived `websocket-connection-reauthorization` design (Decisions D1, D3, D4, D5, D9, D9a) that this change is a client-side companion to; verified claims directly against the current repository state — `ConnectionStatusBanner.tsx`, `connectionHealth.ts`, `AuthContext.tsx`, `AuthErrorPage.tsx`, and the `WsClientMessage` union in `packages/shared/src/types/realtime.ts` — rather than trusting the document's citations.

## Headline finding: the disclosure boundary holds, and I traced why

This was my primary question going in: does anything in this design leak *why* re-auth is needed (revoked vs. expired vs. transient — SEC-25's non-disclosed bucket) or conflate `reauth-required` with the disclosure-blind `unknown-reconnecting` state?

It holds, and it holds structurally, not just by copy discipline:

- `WsClientMessage`'s `reauth_required` variant carries **no payload at all** (`{ eventType: "reauth_required" }`, `realtime.ts:305`) — there is no server-supplied cause, message, or reason field for a future implementer to accidentally wire into rendered text. This is the strongest form of the guarantee: the information physically isn't on the wire to this client, so no amount of careless frontend code can leak it.
- `connectionHealth.ts` confirms the routing is exactly what the backend design promises: `STALE_SIGNAL_CLOSE_CODE` (SEC-25 revocation) falls through into `beginOrContinueUnknownEpisode()` — the same disclosure-blind bucket as an ordinary network drop — while only `REAUTH_GRACE_EXPIRED_CLOSE_CODE` or an inbound `reauth_required` message route to the `reauth-required` state (`handleTerminalEvent`/`handleMessageEvent`, `connectionHealth.ts:208-247`). A revocation close can never reach the code path this change touches. I checked this in the actual state machine, not just the design prose.
- `ConnectionStatusBanner.tsx`'s current placeholder already renders a fixed local string with no prop threading cause through — this design's D4/D5 keep that property (one fixed string, or one of two build-time-selected variants, never a per-cause string).
- D4 checklist item 2 explicitly names the three sub-causes (revocation, retry-budget exhaustion, session destruction) as never individually disclosed, and task 3.4's planned test — byte-for-byte identical rendered text across all three simulated sub-causes — is the right enforcement shape for that.

No conflation risk either direction: `reauth-required` gets `role="alert"` and a CTA (D1/D2), `unknown-reconnecting` keeps `role="status"` and no CTA, and D7/D8's role-uniformity and no-reveal-special-casing decisions don't introduce any new signal that could blur the two states for an observer. I have no open finding on the core disclosure question.

## No-countdown constraint (D3): holds, but the enforcement is narrower than the guarantee it's standing in for

The design correctly restates the backend's D9a rationale ("the moment it's exposed, someone will tune it to basically never") and backs it with a CI test (task 3.3: rendered string never matches a digit-plus-time-unit regex). Good instinct — turning a "please don't" into something CI enforces is exactly the pattern I want to see, and it mirrors the backend's own module-local-constant approach.

Two gaps in how narrowly that test is scoped, worth closing before this reaches a mock:

1. **Text-only, not full rendered output.** The planned test (3.3, and 3.4's sub-cause check) asserts against "rendered text." A digit-plus-unit regex over innerText won't catch a value expressed as an `aria-label`, `title`, or a stray `data-*` debug attribute a cause-specific dev/test harness might leave behind. Recommend both tests assert against the full rendered markup (or at minimum, all string-valued attributes), not just the visible text node.
2. **Text-shaped leaks aren't the only leak shape.** A countdown doesn't have to be a number to disclose the interval — a progress bar, spinner, or CSS animation whose `duration` is wired to the actual ~30s grace period discloses the same value to anyone who opens dev tools, without ever matching a digit regex. This is exactly the "well-intentioned case" D9a (backend) and D3 (this design) already argue against in prose, but the only enforcement mechanism named is text-pattern matching. Since the visual mock doesn't exist yet (open question, task 6.1), I'd add this as an explicit negative constraint Priya's mock sign-off (task 6.2) is checked against — "no animated element whose timing is derived from the grace-period constant" — rather than leaving it to be caught after a mock ships.

## CTA target: confirm it stays a hardcoded literal

D2/task 2.1 correctly reuse the existing `window.location.href = "/auth/login"` pattern verbatim, and I confirmed both existing call sites (`AuthContext.tsx:82`, `AuthErrorPage.tsx:29`) hardcode that literal path with no query string. Two things worth making an explicit acceptance criterion rather than an implicit inheritance:

- The new call site must **not** parameterize the navigation with anything derived from connection state (no `?reason=...`, no `?from=reauth`, no correlation id). This isn't hypothetical — it's the natural next request from whoever owns analytics or support tooling ("can we tell how often people land here from a re-auth vs. a fresh login"), and it's precisely the "innocuous convenience" framing D9a warns will eventually erode a non-disclosure boundary. Task 2.4 asserts `window.location.href` is set to `/auth/login` and nothing else is triggered — I'd tighten that assertion to the exact literal string, not a prefix match, so a future PR adding a query param fails this test rather than silently passing.
- Since the destination is a fixed local literal (never built from server-supplied data), there's no open-redirect surface here. Confirmed, not a finding — stating it because it's the kind of thing I'd otherwise flag by default on any "server signal triggers a client-side navigation" pattern.

## Minor: D5's vote-loss variant check is a manual step, not a build-enforced one

Task 1.1 has a human grep the codebase at implementation time and record yes/no in a commit message or PR description. This isn't an authorization or disclosure boundary — it's a content-accuracy gate — so I'm not blocking on it, but it's worth naming against my own standing principle: controls that don't depend on someone remembering to do them are the ones I trust. If it's cheap to turn 1.1 into an actual build-time check (a script that greps for the `voteDraft.ts` import and fails the build if the shipped copy variant doesn't match), that's strictly better than a fact recorded in prose in a PR description that nothing re-verifies later. Task 1.3's forward-pointing re-check for whoever builds the compose UI is a reasonable backstop either way — I'd just rather the initial determination not rely on a human doing it correctly once.

## Confirmed, no findings

- **Multi-provider OIDC:** the CTA and copy encode no provider-specific assumption; `/auth/login` is already provider-agnostic at both existing call sites, consistent with this project's standing multi-provider constraint.
- **No new audit-logging gap:** this change touches no server-side event path. The backend's existing `session.access_revoked_live` / `session.token_refresh_failed_live` / `session.connection_recovered` audit_log coverage (archived design D2/D3b/D9) already covers the security-relevant events behind this signal; this client-side change adds a rendering/behavior branch only.
- **Timing side-channel via CTA gating:** correctly avoided. D2's "live from first render, not gated behind grace-period expiry" isn't just a UX call — gating the button's enabled state behind elapsed time would itself be an observable countdown surrogate, independent of any copy. Good that this was decided as a security-adjacent property, not just a UX one.
- **Role-uniform treatment (D7) and no reveal-aware special-casing (D6):** neither creates a cross-role or cross-session information-disclosure surface. D6's accepted risk (a facilitator misreading a reveal/reauth co-occurrence as a bug) is a UX-confusion cost, not a disclosure one — the banner is per-connection and client-local, never broadcast to other participants, so there's no channel through which one user's reauth state becomes visible to another via this mechanism.

## Summary

The core question — does this design leak the SEC-26 sub-cause or blur the SEC-25/SEC-26 disclosure line — is answered correctly, and I verified it against the actual state machine and message schema, not just the design's own citations. My findings are narrowing/hardening requests, not boundary violations: extend the no-countdown test to full markup and non-textual timing surrogates, pin the CTA test to the exact literal URL, and consider making the D5 vote-loss check build-enforced rather than manual. None of these block Priya's mock/copy sign-off from proceeding; all are cheap to fold into the tasks already scoped for Groups 3, 4, and 6.
