# Tasks-Stage Review: session-timeout-continuity

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `tasks.md` against `proposal.md`, `design.md`, and the four delta/new specs, after the Redis-broadcast fix (Decision 5), the returnTo-rejection logging fix (Decision 3), and the renumbering (Group 4 → 4.1–4.15)

## Bottom line

Coverage holds. All four capabilities in the proposal — the close-code fix, `reauth-return-to`, the role-aware copy fix, and `facilitator-reconnect-indicator` — map cleanly to a task group, and I didn't find a requirement in any of the four delta/new specs that lacks a corresponding task. Both engineering and security fixes I'd expect to see land in tasks.md do: Decision 5's Redis pub/sub broadcast (4.3–4.6, replacing what would have been a local-registry iteration) and Decision 3's discard-trace logging for rejected `returnTo` values (2.2, 2.3, 2.10, including the explicit "does NOT write an audit_log row" assertion). The FR-4.5 mis-citation I flagged at propose stage is also fixed everywhere it appeared, consistently, not just in one document.

## My two previously-missing acceptance conditions: both present and correctly worded

1. **Topic doesn't auto-advance while facilitator is reauth-required/reconnecting** — now **task 1.7**: "Confirm (unchanged behavior, not new engineering — falls out of existing FR-4.1/OR-1.4 logic) that a topic does not auto-advance or auto-reveal while its facilitator's connection is in `reauth-required` or `unknown-reconnecting` state." This is exactly the condition I asked for, covers both states, and the FR-4.1/OR-1.4 citations are accurate — I checked both against BRD.md (FR-4.1 at line 245, OR-1.4 at line 363; both directly support "no automatic advancement without explicit facilitator action"). Good citation hygiene, unlike the FR-4.5 issue from last review.

2. **Server-committed reveal completes for other clients regardless of facilitator's connection state** — now **task 1.8**, covering the mid-reveal case explicitly ("facilitator's connection ages out or drops after the reveal is committed server-side but before all clients have confirmed receipt"). Matches my condition precisely.

Both are framed as confirmation tasks rather than new engineering, which is correct — this is unchanged behavior, and a one-line confirmation is exactly what I asked for rather than new test scaffolding for code nobody is touching.

## HTTP-401-parity follow-up issue: present

**Task 5.5** (previously 5.5, unchanged number): "File the HTTP-side session-expiry parity follow-up issue named in design.md's Open Questions... before this change is archived, so the disposition resolves to a tracked issue rather than a documented intent that never gets filed." Still there, still requires an actual filed issue rather than a paper disposition.

## Capability-by-capability coverage check

- **Close-code fix (`websocket-session-authorization`)** — Group 1 (1.1–1.8) covers the constant swap, comment correction, no-other-change confirmation, both close-code tests, the manual/integration confirmation, and now both acceptance conditions above. Complete.
- **`reauth-return-to`** — Group 2 (2.1–2.10) covers allow-list validation against `executeJoinFlow`, the accept/validate/log-on-reject flow, the pre-allow-list scheme/CRLF/backslash rejection, callback redirect logic and precedence over `pendingJoinToken`, and the new logging requirement. Complete against the spec's four requirements.
- **CTA parameterization and role-aware copy (`websocket-staleness-signal`)** — Group 3 (3.1–3.10) covers the new props, CTA navigation with/without `returnTo`, the vote-loss omission for facilitators, both call-site wiring updates, the narrowed "identical across roles" test, and the disclosure-bound test on the constructed `returnTo` value. Complete.
- **`facilitator-reconnect-indicator`** — Group 4 (4.1–4.15) covers the `useConnectionHealth` lift, the Redis-backed publish/dispatch path (not a local-registry read), the shared Redis key for cross-pod transition detection, wiring into the existing audit call sites rather than a second derivation, the frontend module and indicator component, and tests for payload minimality, status-gating, cross-pod fan-out, and the "no duration cutoff" documented limitation. Complete.

## Minor gaps — worth a look, not blocking

Three spec scenarios don't have an equally explicit task, all in Group 2:

1. **`reauth-return-to` spec's "mechanism does not branch on which OIDC provider is configured"** scenario has no dedicated task asserting it. Given [[project_oidc_multi_provider]] — this system is explicitly meant to support multiple IdPs, not just Entra — I'd want one line in Group 2 (or folded into 2.2) confirming the `returnTo` handling in `/auth/login`/`/auth/callback` doesn't fork on which provider is configured, even though the design correctly says no provider-specific behavior is being introduced. Low risk since the code path is shared by construction, but it's the one scenario in that spec without a task-level anchor.
2. The spec has **two separate scenarios** — an allow-listed session path accepted, and an allow-listed team path accepted — but task 2.5 is written generically ("a valid allow-listed `returnTo`"). Worth confirming the eventual test parametrizes both shapes rather than only one.
3. The spec's **"stored returnTo value is single-use"** scenario has no task explicitly asserting a second callback attempt against the same state can't redeem the value again. This likely falls out of `redis.getdel` being the same already-tested mechanism `pendingJoinToken` uses, but that inference isn't written down anywhere in tasks.md the way 2.1–2.10 write down everything else.

None of these are capability-level gaps — they're test-granularity notes on an otherwise complete Group 2. I'd raise them in review comments, not block on them.

## Recommendation

Approve. Both explore-stage acceptance conditions and the HTTP-401-parity follow-up task survived the Decision 5/Decision 3 rework and renumbering intact and correctly worded. The three minor Group 2 granularity notes above are optional tightening, not missing coverage — nothing in the proposal's capabilities, the four delta/new specs' requirements, or my own prior review's open items is lost in this task list.
