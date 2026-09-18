# BA Review: Exploration Notes — http-auth-audit-log-coverage (SEC-12/SEC-13)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion), GitHub issue #30
**Lens:** Are these ideas specific enough to carry into a proposal without a round-trip back to me or Devon? Where would the implementation team — or whoever picks up Design — hit "what did you mean by this?"

Overall this is a well-grounded document. It traces all four `auth.session_invalidated` call sites (not just the three the issue names), correctly identifies the WS-side `runSweepCheck`/`connection-token-refresh.ts` INSERTs as the shape-precedent rather than the transactional domain-write pattern, and does the traceability work I look for first — every constraint ties back to a BRD line (SEC-12/13/14) or a specific file and line number. The scope discipline matches what #27's design.md modeled, and the decision not to absorb the wider `auth.ts`/`join-links.ts` gap is the right call, correctly flagged rather than silently expanded into.

My findings below are places where a real decision is being described as a leaning or a principle, without the acceptance condition that would let an implementer build against it without asking. I also pulled two of the cited files myself (`connection-reauthorization.ts`, `auth.ts`'s logout handler) because two of the document's supporting claims are stated more confidently than the code actually supports, or leave out a wrinkle the code reveals.

---

## 1. Genuine gap: the WS-side code cited as the fail-handling precedent has no fail-handling to copy

The document states the WS-side events "are also bare, un-transactioned `db.query()` calls, for the identical reason — the correct precedent, not an approximation of one," and separately argues for fail-open behavior on the HTTP-side INSERT. I read `connection-reauthorization.ts`'s `runSweepCheck` to check what "the correct precedent" actually does on INSERT failure: **nothing.** The `db.query(INSERT INTO audit_log ...)` call there has no try/catch, and the function is invoked from `scheduleReauthorizationSweep` as `void runSweepCheck(...)` inside a `setInterval` callback — meaning a rejected INSERT today becomes an unhandled promise rejection, not a handled fail-open path.

That's fine for the WS timer (no in-flight HTTP request depends on it), but it means the document's fail-open recommendation for the HTTP path has **no existing code to point to as the pattern to reuse** — Design will be writing this error-handling from scratch, not porting it. The document's own framing ("the correct precedent, not an approximation of one") is accurate for the INSERT *shape* but reads as if it also covers failure handling, and it doesn't. This should be stated plainly so nobody goes looking for a try/catch in the WS file to copy and comes up empty.

**Suggested rewrite:** add a line to the "fail-open vs. fail-closed" bullet: *"Note: the WS-side `runSweepCheck` INSERT this document otherwise treats as precedent has no error handling of its own — a rejected `db.query` there is an unhandled promise rejection inside a `setInterval` callback, invisible to any caller. The HTTP-side fail-open behavior recommended above has no existing implementation to reuse; Design is writing it new, not porting it. (Whether the WS-side sweep's own unhandled-rejection gap should be retrofitted at the same time, or explicitly deferred, is a scope question this document should also name rather than leave implicit.)"*

---

## 2. Vague: "fail-open" is stated as a principle, not an acceptance condition, and doesn't cover the antecedent role lookup

The fail-open recommendation (Open Question 3) is well-reasoned as a preference but isn't yet testable. Two things are missing:

- What actually happens on failure needs a stated shape: does the request/response simply proceed with no further action, or is there a paired observability signal (an error log line, a metric, an alert) so a sustained audit-write outage is *detectable*? SEC-12 frames the audit log as the mechanism for post-hoc incident reconstruction — a failure mode that silently and permanently drops rows with no accompanying signal quietly defeats that purpose, and this codebase has precedent for pairing a control failure with a distinguishable event (`team.manager_association_rate_limit_check_failed` exists specifically so an operator can tell "the control is down" from "an unrelated 500"). The document should say whether an equivalent signal is expected here or explain why it isn't needed.
- The fail-open discussion only mentions the `INSERT` itself. But every one of these three (or four) events also needs `resolveActorGlobalRole`'s `SELECT global_role` to succeed first — and `actor_global_role` is `NOT NULL`. `resolveActorGlobalRole` already handles the *no-row-found* case gracefully (falls back to `"unknown"` rather than throwing), so that specific edge case is already covered by existing code. But a DB *connectivity* failure on that SELECT (not "no row," an actual query failure) is a distinct failure mode from the INSERT failing, and the document's fail-open language doesn't say whether it's meant to cover this too. I'd assume yes — the reasoning is identical — but the document should say so rather than leave "the audit write" ambiguous as to whether it means one round trip or two.

**Suggested rewrite:** *"Fail-open covers both DB round trips this requires (the `resolveActorGlobalRole` SELECT and the audit_log INSERT) — a failure in either must not block the request/response. [State whether a paired log/metric signal is required so a sustained failure is detectable, or explicitly decide it isn't needed for this volume/severity.]"*

---

## 3. Vague: no stated timeout or hang behavior for the audit write, which interacts with the sequencing point the document already raises

The document notes, correctly, that awaiting the audit INSERT before the 401 reply is "my instinct, since these are already error/termination paths where a little added latency is a non-issue" — and separately notes the existing awaited-vs-unawaited `destroy()` inconsistency as inherited, not new. What's missing is the failure mode in between "succeeds quickly" and "fails cleanly": what if the audit write *hangs* (a connection-pool exhaustion, a slow query) rather than erroring? Fail-open as currently described handles an error being thrown; it doesn't say whether there's a timeout bounding how long the response can be blocked waiting for the audit write to resolve one way or the other. For `token_refresh_success` in particular — the hot, successful-traffic path the document is rightly cautious about — an unbounded await on a degraded DB is a materially different risk than an unbounded await on an already-terminal 401 path.

**Suggested rewrite:** *"State whether the audit write (SELECT + INSERT) is subject to a timeout before the request proceeds regardless, or whether 'fail-open' is scoped only to explicit errors and a hang is treated as acceptable given these are short-lived request-scoped calls. This matters most for `token_refresh_success`, which sits in front of ordinary successful traffic, not only the error/termination paths."*

---

## 4. Vague: the `token_refresh_success` volume/latency cost is argued qualitatively, with no number Design can actually weigh against SEC-13

The document is right to flag that this is "a different latency/reliability profile than any existing HTTP-side audit write in this codebase" and right not to prejudge the answer. But the supporting language — "real aggregate volume across every concurrently active session in production," "a different latency/reliability profile" — gives Design nothing to weigh a requirement against except adjectives. SEC-13 says login/logout/failure/expiry belong in the audit log; it says nothing about refresh *successes*, so this is genuinely a cost/benefit call, and cost/benefit calls need a number on at least one side.

**Suggested rewrite:** *"Pull an order-of-magnitude estimate before Design: how many `auth.token_refresh_success` structured-log events fire per minute in production today (this event already exists as a structured log — the count is presumably queryable), and what added p99 latency two extra DB round trips represent against this route's existing baseline. Absent real numbers, state an explicit latency budget (e.g., 'acceptable if it adds no more than Xms at p99') so the decision has a stated threshold rather than being made on a felt sense of 'a lot of traffic.'"*

---

## 5. Vague: if `token_refresh_failure` doesn't get its own row, the detail it uniquely carries has no stated home

The document's own reasoning for treating `token_refresh_failure` as likely-redundant is: it's "already followed by `session_invalidated` in every branch that destroys the session — meaning giving `token_refresh_failure` a row largely duplicates what `session_invalidated`'s own row would already capture moments later, except for the case where a caller wants the retry count / failure-type detail specifically." I checked `middleware.ts` directly and this holds precisely for the HTTP path: both the `revoked` and `transient_failure` results from `refreshSessionTokens` are unconditionally followed by a `session_invalidated` emit and a 401 in the same `onRequest` hook — there is no HTTP branch where `token_refresh_failure` fires without an immediately subsequent `session_invalidated`. Good, that's solid grounding.

But the "except for" clause is doing real work the document doesn't resolve: `session_invalidated`'s `reason` field (`token_revoked` / `refresh_failure`) only coarsely maps to `token_refresh_failure`'s `failureType` (`revoked` / `transient`), and `retryCount` has no counterpart on `session_invalidated` at all. If Design takes the "duplicates, skip it" instinct at face value, `retryCount` — the one piece of diagnostic detail that would tell an incident responder whether a revocation was detected immediately or only after two retries — disappears from the durable record entirely, even though it's exactly the kind of detail SEC-12's "reconstruct a sequence of events" language cares about.

**Suggested rewrite:** *"If `token_refresh_failure` does not get its own audit_log row, `session_invalidated`'s row for the `token_revoked`/`refresh_failure` reasons must carry `failureType` and `retryCount` in its own metadata instead — the retry detail should be a stated tradeoff (moved, not dropped), not a side effect of choosing not to duplicate the row."*

---

## 6. Vague: the fourth call site's NULL-`team_id` justification is asserted by analogy, not checked against what that handler already does

The document's NULL-`team_id` reasoning is built entirely around `middleware.ts`'s `onRequest` hook running on arbitrary routes with no reliable way to resolve a team. That reasoning is solid for the three `middleware.ts` sites. But if Open Question 2 is answered "yes, include the fourth call site" (`auth.ts`'s `/auth/logout` handler), the document doesn't check whether the *same* NULL justification actually carries over — and I don't think it automatically does. I read the logout handler: before destroying the session, it already runs `SELECT s.id FROM sessions s JOIN session_participants sp ON s.id = sp.session_id WHERE sp.user_id = $1 AND s.status = 'active'` to populate `activeSessions` for the confirm-required flow. `resolveTeamIdForAudit("session", id)` (already exported from `connection-reauthorization.ts`) is a one-hop lookup away from that same session id — meaning a logout that has an active session at the time of destroy *can* plausibly resolve a real `team_id`, unlike the three arbitrary-route middleware sites.

This isn't a decision I should make in a review — it surfaces a wrinkle the document doesn't know exists yet, since it never looked past `middleware.ts`'s constraint: a user could in principle have more than one active session (possibly across different teams) at logout time, so "resolve team_id from the active session" isn't obviously well-defined either. That ambiguity itself needs to be a named question, not resolved by defaulting to the middleware.ts precedent without checking whether it applies.

**Suggested rewrite:** *"If the fourth call site (`auth.ts` explicit_logout) is brought into scope, its NULL-`team_id` treatment should not be assumed identical to the three `middleware.ts` sites without checking: the logout handler already queries the user's active sessions before destroy, which may make a real `team_id` resolvable via `resolveTeamIdForAudit` in the common case. Whether to attempt that resolution (and what to do if a user has active sessions across more than one team) is an open question Design should answer explicitly, not inherit from the middleware.ts NULL precedent by default."*

---

## What's already solid (no rewrite needed)

Calling these out so they don't get lost in a list that's otherwise mostly gaps:

- **The four-call-site inventory for `auth.session_invalidated`**, including the one the issue itself doesn't name — this is exactly the kind of grounding-over-trusting-the-issue-text work I want to see, and it's precise about line numbers and the awaited/unawaited `destroy()` discrepancy.
- **The "no transaction to join" argument** for why the WS-side bare-`db.query()` pattern is the correct precedent rather than an approximation of the transactional domain-write pattern — clearly reasoned and explicitly warns against cargo-culting "same transaction" language in from the other call sites.
- **The provider-agnostic check** — actively verified against the standing instruction that this auth layer must stay provider-agnostic, with a stated negative result ("looked for a reason this would need to branch per-provider and didn't find one") rather than a silent assumption. This is precisely the discipline I'd otherwise have to ask for.
- **The wider-gap disclosure** — naming the `auth.ts`/`join-links.ts` structural gap, explicitly declining to absorb it, and recommending it become its own tracked issue the same way #27 spun off #30. Good scope hygiene, no note needed.
- **SEC-14's "backwards reading" framing** — a genuinely useful observation (WS ended up ahead of HTTP, not catching up to it) that will save whoever writes design.md from a confusing rhetorical trap later.

---

## Summary of asks before this moves to Design/Propose

1. State plainly that the WS-side INSERT has no fail-handling to reuse — Design is writing new error handling, not porting existing error handling (Section 1).
2. Turn "fail-open" into a stated acceptance condition covering both DB round trips (role lookup + INSERT), and decide whether a paired observability signal is required for a sustained failure to stay detectable (Section 2).
3. State whether the audit write is subject to a timeout, or whether fail-open is scoped to explicit errors only and a hang is accepted as low-risk (Section 3) — call this out specifically for `token_refresh_success`.
4. Replace the qualitative volume/latency argument for `token_refresh_success` with an actual order-of-magnitude estimate or an explicit latency budget (Section 4).
5. If `token_refresh_failure` doesn't get its own row, state explicitly that `failureType`/`retryCount` move into `session_invalidated`'s metadata rather than silently disappearing from the durable record (Section 5).
6. If the fourth call site (`auth.ts` logout) is brought into scope, don't default its `team_id` to NULL by analogy — check whether `resolveTeamIdForAudit` can resolve a real value from the handler's existing active-session query, and name the multi-team-session ambiguity explicitly if so (Section 6).

None of these require re-opening the scope decisions the document already made correctly (which of the nine wider-gap events to fix, whether to absorb `auth.ts`/`join-links.ts`) — they're all about making the decisions already in view testable, so whoever picks up Design isn't left inferring intent from a leaning.
