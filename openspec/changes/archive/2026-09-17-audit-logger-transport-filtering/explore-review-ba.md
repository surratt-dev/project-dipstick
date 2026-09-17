# BA Review: Audit Logger Transport-Level Filtering — Exploration Notes

Reviewed by Marcus Delgado (Business Analyst), 2026-09-17.

## Overall read

The documentation-only scoping is sound and matches the original reviewer's own stated remedy. My concern isn't the scope decision itself — it's that several pieces of it are described at the level of intent ("state the constraint," "a short forward-pointer comment") rather than at the level of a requirement someone can build and someone else can verify. Below are the gaps I'd close before this becomes a proposal, since these are exactly the kind of ambiguities that come back to me as "what did you mean?" during implementation.

## 1. The `docs/deployment.md` Logging section is underspecified

The notes say it should state "the constraint" and "the reasoning." That's a topic, not a requirement. I'd want the proposal to commit to concrete content, not leave the writer to improvise at implementation time:

- **The specific list of at-risk events.** The exploration notes already did the hard work of identifying the seven log-only events (`team.access_grant_mismatch`, `team.manager_association_rate_approaching`, `session.reveal_latency_observed`, `session.facilitator_connected`/`disconnected`, `session.access_revoked_live`, `session.token_refresh_failed_live`, `session.connection_recovered`). That list should be **named in the runbook section itself**, not left implicit. An operator configuring a transport needs to know what's actually at stake, not just that "some events" are log-only. Without the list, the doc restates the abstract risk from the issue without closing it.
- **The trigger condition for action 2**, written as an explicit conditional an operator or future engineer can act on — e.g., "If you configure a pino transport with a level filter (or any transport that could drop `info`-level records), `audit-logger.ts`'s `emitAuditEvent` must be revisited — see [code comment / this section]." The exploration notes mention this should exist; it needs to be drafted, not just gestured at.
- **Placement and scope boundary**, explicitly: is this a new "Logging" H2 near the environment-variables section, or a subsection under an existing "Observability" heading if one exists? The notes say "probably" — a proposal shouldn't carry "probably" into an acceptance condition.

**Suggested acceptance condition:** *"A reader who is about to configure a pino transport with a level filter can, from the Logging section alone, (a) identify which audit events are log-only and therefore at risk, (b) understand why child-logger level overrides in `emitAuditEvent` don't protect against transport-level filtering, and (c) know what to do before adopting such a transport."* That's testable; "state the constraint and reasoning" is not.

## 2. The code comment is underspecified

"A short forward-pointer comment... linking to that section" doesn't tell the implementer where in the file or what it says. `audit-logger.ts` already carries dense, precise inline commentary (see the per-event notes around lines 35, 95, 153, 177, 190 for examples of the house style) and a full explanation of the child-logger level-override rationale directly above `emitAuditEvent` (lines 218–228). The new comment should follow that same standard, not be an afterthought line.

**Suggested rewrite:** Place it immediately after the existing "Fix: explicitly set the child logger's level..." paragraph (around line 228), before `const auditLogger = logger.child(...)`, along these lines:

> `// This override protects against application-level log-level changes only.`
> `// It does NOT protect against a pino transport configured with its own`
> `// level filter (e.g., a shipper that drops below 'warn') — transport-level`
> `// filtering happens downstream of this logger and is invisible here. See`
> `// "Logging" in docs/deployment.md for the events at risk and what to check`
> `// before adopting a filtering transport.`

That gives a future reader the "why," not just a link, consistent with how the rest of the file is commented.

## 3. Action 3 disposition — "deferred" is not yet defensible, it's asserted

The issue explicitly requested a startup reachability check as a required action. The exploration notes give a good proportionality argument (no transport config exists today, building a health check against a non-existent failure mode is premature engineering) — but that argument currently lives only in the exploration notes, which aren't part of what ships. If the proposal simply omits action 3 with no accounting, that's a silent scope cut against an explicit ask, and it's exactly the kind of edge case I've seen turn into a scope dispute later when someone re-reads issue #3 and asks where the startup check went.

**This needs to be argued, not just decided.** Concretely, the proposal (not just the exploration notes) should:

- State explicitly that action 3 is being deferred, and why (no transport configuration exists in this codebase; a reachability check would validate against a failure mode nobody has built yet).
- Record the deferral **in the same runbook section**, as a "Future consideration" with its own trigger condition, mirroring action 2's: *"If transport-level filtering is adopted, consider adding a startup check that verifies audit events reach their configured sink, alongside the `emitAuditEvent` rework this would also require."*
- Close the loop back to the issue — either the PR/change description or the runbook note should reference issue #3 by number so the deferral is traceable to the original ask, not just a decision that quietly disappeared between the issue and the doc.

Given the "closes #3" framing implied by scoping this as a fix, I'd flag: does closing the issue outright, with a required action unbuilt, need explicit sign-off language ("action 3 deferred, see docs/deployment.md Logging section") in the closing commit/PR — or should this stay open/relabeled until a future change addresses it? That's a disposition question worth deciding consciously rather than by default.

## Summary of changes needed before this is proposal-ready

1. Draft the actual Logging section content (or at least its required elements) in the proposal, including the named list of at-risk events — don't leave content to be improvised during implementation.
2. Draft the actual code comment text and pin its location (after line 228, before the `auditLogger` child-logger creation).
3. Make the action-3 deferral an explicit, argued decision that lives in the shipped documentation and references issue #3 — not an implicit omission inferred from exploration notes.
4. Decide and state how issue #3 gets closed given a required action is being deferred rather than built.
