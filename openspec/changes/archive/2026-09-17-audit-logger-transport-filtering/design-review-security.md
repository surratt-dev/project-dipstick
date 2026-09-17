# Security Review: Audit Logger Transport-Level Filtering (GitHub issue #3)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-09-17
**Documents reviewed:** `design.md`, `proposal.md`, `exploration-notes.md`, `tasks.md`
**Source reviewed:** `packages/backend/src/auth/audit-logger.ts` (full `AuditEventName` union, all 34 members) cross-referenced against every `emitAuditEvent(` call site and every `INSERT INTO audit_log` call site in `packages/backend/src` (`auth/`, `routes/`, `realtime/`)
**Scope:** As the reviewer who originally raised this issue (`archive/2026-07-05-first-access/implementation-review-security.md`, Section 5), whether documentation-only closure is sufficient, whether the named at-risk event list is complete and accurate, and whether any security decisions are deferred implicitly rather than explicitly.

---

## Summary

D1 (no code change, no transport exists today) is still the right call, and D5's explicit "Future consideration" framing for action 3 is exactly the traceable-deferral pattern I want to see — no objection to either.

**Finding 1 is Required and blocks merge as currently drafted.** I did the cross-check the design asks for: I read every `AuditEventName` member against its actual `emitAuditEvent` call sites and every `INSERT INTO audit_log` call site in the backend. The named list in D3/proposal/exploration-notes (8 events) is both **inaccurate** (5 of the 8 named events are actually DB-backed) and **materially incomplete** (it omits 14 events that are genuinely log-only — including the entire `auth.*` and `join.*` categories, i.e. every login, logout, session-creation, session-invalidation, and token-refresh-failure event in the system). The document's own framing — "most audit events... are DB-backed... a smaller, named set does not" — is backwards for the category that matters most. This isn't a wording nit; it's the exact content an operator is meant to act on before enabling a filtering transport, and as drafted it would leave them confident the authentication trail is safe when it is the single largest thing actually at risk.

Given the corrected picture, documentation-only closure is still an acceptable disposition — but only once the list is fixed. See Finding 2 for why I'm not asking to reopen D1 despite the increased severity.

---

## Finding 1 (Required): The at-risk event list is wrong on both ends — 5 false positives, 14 omissions including the entire auth/session trail

**Method:** For each of the 34 members of `AuditEventName` (`audit-logger.ts`), I found its `emitAuditEvent` call site(s) and checked whether the same code path also does `INSERT INTO audit_log` (or `writeAuditLogRow`, which wraps the same insert) in the same transaction/function.

**5 events named as "log-only, no DB backing" in D3 are actually DB-backed** — transport filtering would not affect them:

| Event | Design says | Actual | Evidence |
|---|---|---|---|
| `session.access_revoked_live` | log-only | **DB-backed** | `realtime/connection-reauthorization.ts:93-97`, explicit `INSERT INTO audit_log` immediately before `emitAuditEvent`, with an in-file comment noting it was added "as a real audit_log row, not only the emitAuditEvent structured log this design's first draft relied on alone" |
| `session.token_refresh_failed_live` | log-only | **DB-backed** | `realtime/connection-token-refresh.ts:71` (`writeAuditLogRow` → `INSERT INTO audit_log`, line 130) before `emitAuditEvent` at line 77 |
| `session.connection_recovered` | log-only | **DB-backed** | `realtime/connection-token-refresh.ts:104` (same `writeAuditLogRow` helper) before `emitAuditEvent` at line 109; also read back by `routes/content.ts:565-574`'s `fetchConnectionRecoveries`, which queries `audit_log WHERE operation = 'session.connection_recovered'` — the fact that a read query exists at all is itself proof of DB backing |
| `session.facilitator_connected` | log-only | **DB-backed** | `realtime/websocket-routes.ts:253-257`, `INSERT INTO audit_log` before `emitAuditEvent` at line 259 |
| `session.facilitator_disconnected` | log-only | **DB-backed** | same call site, same insert (line 251 sets `operation` conditionally for both) |

**3 events named in D3 are correctly log-only** — `team.access_grant_mismatch` (`auth/team-content-access-helper.ts:158-175`, comment explicitly confirms no DB row), `team.manager_association_rate_approaching` (`routes/teams.ts:234-247`, no insert nearby), `session.reveal_latency_observed` (`routes/sessions.ts:460`, no insert nearby, and it isn't a security event at all — see Non-findings).

**14 events are genuinely log-only and named nowhere in the document.** Most significantly, this includes **every single `auth.*` event and every `join.*` event** — I grepped all of `routes/auth.ts`, `routes/join-links.ts`, and `auth/middleware.ts` for `audit_log`: zero hits in any of the three files.

- `auth.authorization_initiated`, `auth.callback_received`, `auth.success`, `auth.failure`, `auth.first_access_created`, `auth.session_created`, `auth.session_invalidated`, `auth.token_refresh_success`, `auth.token_refresh_failure`, `auth.idp_logout_failed`, `auth.role_claim_mapped` — **no DB backing, any of them**
- `join.link_created`, `join.link_redeemed`, `join.link_rejected` — **no DB backing**
- `team.manager_association_rate_limit_check_failed` (`routes/teams.ts:224-228`, the fail-closed Redis-outage signal) — **no DB backing**

That's 14 additional log-only events, for a corrected total of **17**, not 8 — and the composition inverts the document's own risk narrative. The proposal's stated rationale for documentation-weight response is that the at-risk set is "mostly operational/anomaly-detection signals, not the primary 'who did what' audit record SEC-12–SEC-16 are protecting." That's true of the 3 correctly-named events. It is **not** true of the 14 missing ones: `auth.success`/`auth.failure`/`auth.session_invalidated`/`auth.session_created` *are* the primary "who logged in, when, and whether their session ended" record this application has. Under a filtering transport, that entire trail goes dark with the DB offering no fallback — there is no `audit_log` row for a login event anywhere in this codebase today.

**Required before merge:** correct the list in `design.md` D3, `proposal.md`, `exploration-notes.md`, and the drafted `docs/deployment.md` content to the accurate 17-event set (or state the DB-backed/log-only split by *category* — e.g. "all `auth.*` and `join.*` events, plus X, Y, Z" — rather than hand-enumerating, given how easily the enumeration already drifted from reality at time of authorship; see Finding 3).

---

## Finding 2 (Recommended, not blocking): Severity is higher than assumed, but D1's disposition still holds — for now

I'm not asking to reopen D1 and build a startup check or code change in this PR. The operative fact D1 relies on — no transport is configured anywhere in this codebase today — is still true regardless of which events would be affected if one were added later; I independently confirmed the same grep (`transport`, `pino-`, `LOG_LEVEL`) turns up nothing. Proportionality still points at documentation for a hypothetical risk.

But the corrected severity should change what "sufficient" documentation looks like, and should be stated plainly rather than left for a future reader to discover by re-deriving the same audit I just did:

- The runbook's "before adopting any pino transport with a level filter" instruction should say explicitly that this includes the entire authentication and session-lifecycle event trail, not present the risk as bounded to a handful of anomaly-detector signals.
- The `emitAuditEvent` code comment (D4) references "the events at risk" in `docs/deployment.md` generically — fine, as long as that referenced list is the corrected one.
- I'd go further than the design does on framing action 3's trigger condition: "before any filtering transport ships to production" is correct, but given that a dropped `auth.failure` or `auth.session_invalidated` event is a materially worse blind spot than a dropped anomaly signal, I'd want the Future Consideration note to say the reachability check is non-negotiable before shipping any transport that could touch `info`-level events at all — not a nice-to-have revisited "if" the emitAuditEvent rework happens to get to it.

## Finding 3 (Recommended): A hand-maintained enumeration is the wrong control shape here — it was already wrong on day one

This is the "secure defaults that don't require discipline to maintain" concern I apply in every review. D3's own Risks section already anticipates the list going stale *after* this change ships. What I found is worse: it's inaccurate *at the moment of authorship*, before a single future event is added. A static, hand-maintained list that's already 5-wrong-plus-14-missing on day one is not a control I'd trust an operator's risk assessment to rest on, even corrected. Two independent people (Devon in exploration, then whoever transcribed D3 into the proposal) read the same file's inline comments and still miscategorized 5 events — which tells me the comments themselves are ambiguous enough that "read the file" isn't a reliable process either.

Not blocking, since fixing this properly (e.g., a lint rule or test asserting every `AuditEventName` member without a corresponding `INSERT INTO audit_log` reference is enumerated in the doc) is real code/tooling work outside a documentation-only change's proportionate scope. But I'd record this as a named follow-up, not silently accept "manually curated list, best effort" as the permanent state of a document whose entire job is to be trusted on this exact question.

## Finding 4 (Observation): `session.reveal_latency_observed`'s inclusion is a minor category mismatch, not a defect

It's correctly log-only, but per its own comment (`audit-logger.ts:177-189`) it's "Not a security audit record — a client-reported observed_latency metric," included in this pipe only because I required in the websocket-specification review that session-tagged operational logs get at least the access-control bar of this file's other session-tagged logs. Fine to keep listed for completeness (losing it under transport filtering is still a real loss, just not an audit-integrity one) — just don't let it anchor the "these are mostly low-severity" framing the way D3 currently implies, given Finding 1's corrected picture.

---

## Non-findings (checked, no issue)

- **D1 (no code change) and D5 (explicit Future Consideration, not silent drop or TODO)**: correct shape for a hypothetical risk with a traceable deferral. No objection.
- **D4 code comment placement and content**: doesn't name specific events, so it isn't affected by Finding 1's correction beyond its cross-reference target needing to be accurate.
- **`emitAuditEvent`'s actual logic**: unchanged, and the original 2026-07-05 fix (child-logger level override) is doing exactly what it was reviewed to do. Nothing here reopens that finding.
- **Scope discipline**: nothing in this review is a request to build the startup check, add a `LOG_LEVEL` var, or touch application behavior. Finding 1 is a correction to the *content* of a documentation-only change, not an expansion of its *kind*.

---

## Disposition

**Finding 1 is Required — blocks merge until the event list is corrected** to the accurate set (17 log-only events, not 8; 5 currently-named events removed, 14 added, most importantly all of `auth.*` and `join.*`). This is fixable within the existing documentation-only scope and doesn't require revisiting D1, D2, D4, or D5. Findings 2–4 are Recommended: fold the corrected severity into the runbook's framing language and record Finding 3's "this list is hand-maintained and already proved unreliable" observation as a named follow-up rather than silently reproducing the same failure mode next time an event is added. Once Finding 1 is fixed, documentation-only closure is sufficient and I'd consider issue #3 properly closed.
