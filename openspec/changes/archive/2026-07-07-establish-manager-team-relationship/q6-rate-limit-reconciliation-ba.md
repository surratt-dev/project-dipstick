# Q6 Reconciliation: Rate Limiting Threshold for TEAM-006

**Author:** Marcus Delgado, Business Analyst
**Responding to:** `q6-rate-limit-proposal-security.md` (Tomás Ferreira, Senior Application Security Analyst)
**My prior position:** `q6-rate-limit-proposal-ba.md` (20/10-min burst + 100/24-hr sustained, per-actor)
**Status: AGREE WITH MODIFICATIONS**

**What needs to change before I sign off:** add a per-actor **100 requests / rolling 24-hour** sustained cap as a third layer on top of Tomás's two sliding-window limits, carry the customer-facing escalation-path language from my original Section 4 into the 429 response bodies, and keep a time-boxed escape-hatch — scoped now only to the daily cap — for the genuine large-rollout case. Everything else in Tomás's document I accept as written, including in place of my own corresponding proposal where the two differed. This is not a stalemate; it's one substantive addition on top of a proposal I think is better than mine in every other respect.

---

## 1. His tighter 10/rolling-10-min in place of my 20/rolling-10-min

I accept it. I re-ran it against my own three legitimate-usage scenarios, since that's the test I said any threshold has to pass:

- **(a) 1–3 calls, steady state.** Nowhere near 10. No change in behavior.
- **(b) 5–15 calls in a sitting (reorg reassignment).** The low end of this range is untouched. The high end — an admin clicking through 15 associations back-to-back faster than one every 60 seconds — will trip the 11th request and get a 429 mid-task. I don't think that breaks the scenario; it degrades it. The admin gets a `Retry-After`, waits on the order of a couple of minutes for the sliding window to free capacity, and resumes. That's the same "friction, not a wall" outcome I argued for in my own proposal's Section 4, just arriving five calls earlier than it would have under my number. I'm accepting that trade because Tomás's attacker-capability argument (Section 1 of his doc) is the stronger argument on the burst window specifically: a 20-request budget gives a scripted credential-replay attack twice the per-window blast radius mine would have blocked, for a legitimate scenario that only occasionally brushes the ceiling and never breaks when it does.
- **(c) Rollout up to ~100 teams in a day.** This is the one I actually worried about, and it does not break. A sliding window of 10 per 10 minutes sustains a *continuous* rate of 1 request/minute indefinitely without ever tripping — that's 60/hour, so a provisioning script pacing at one call per minute clears 100 teams in well under two hours. That's slower than the ~50 minutes my own 20/10-min number would have allowed at its steady-state pace, but a one-time rollout event finishing in under two hours instead of under one is not a real burden, and it's happening against a background of the tighter number doing more work against the actual threat the rest of the day. I withdraw my concern that 10/10-min "breaks" the rollout case — it doesn't.

## 2. The missing daily/24-hour cap — I'm keeping mine as a backstop, and this is where I disagree

Tomás's design has no ceiling above the 10-minute window. I think that's a real gap, not a stylistic difference, and here's the argument against accepting his design as-is on this specific point.

Tomás's own Section 4 names the blind spot directly: an attacker who paces at 9 of 10 requests per window, indefinitely, never trips the 429 and never produces the hard breach event — only the softer 80%-threshold "approaching" signal, repeated once per window, forever. He's honest that this is a partial win ("slower than an unconstrained attacker would prefer") rather than a closed gap, and he scopes the fix to *detection* — a signal for monitoring to eventually pick up.

The problem is that both of us already agree monitoring doesn't exist. Threat-model.md Finding 2.3 says so, and Tomás cites it himself as the reason the "approaching" signal is valuable — it's future-proofing for a monitoring capability that isn't built yet. Until it is, a patient attacker sitting at 9/10 per window produces a log stream nobody is consuming, and there is no point at which the request is simply refused. Run the math: at just-under-ceiling pacing, that's ~54 requests/hour sustained. Two consecutive 90-minute sessions in a day (the absolute session lifetime Tomás cites from `middleware.ts`) at that pace is well over 100 associations before a single request is ever rejected — more than the entire compromise blast radius my daily cap is designed to bound, produced entirely inside "normal" sliding-window behavior with no hard 429 anywhere in the sequence.

A 100/rolling-24-hour cap, layered on top of his 10/10-min and 50/10-min limits, closes exactly that gap without touching anything he built: it doesn't fire for either of my legitimate scenarios (a, b are nowhere close; c is designed to fit inside it, same as before), it doesn't change his sliding-window or Redis implementation approach, and it gives the eventual monitoring work a second, harder tripwire that doesn't depend on anyone having built the alerting pipeline yet — a flat "the 101st request in a day gets refused" is true today, with no monitoring required, in a way "an approaching-signal got logged" is not. I'd implement it the same way he's implementing the other two — same Redis-backed sliding window, same `AuditEventName` and `audit_log` treatment he specifies in his Section 3, just a third window length (`TEAM_006_DAILY_LIMIT_EXCEEDED` alongside his `TEAM_006_RATE_LIMIT_EXCEEDED`).

I want to be plain that this is a disagreement, not a hedge: Tomás's document treats the sliding window plus the approaching-signal as sufficient and explicitly declines to add a longer window. I don't think it's sufficient while Finding 2.3 stays open, and I'm not willing to sign off without the backstop that doesn't depend on monitoring existing.

## 3. His global secondary limit, audit/alerting mechanics, and implementation guidance

Accepted, all of it, without modification:

- **50/rolling-10-min global limit across all admins.** This covers a threat scenario (multiple admin accounts compromised close together) that my proposal didn't consider at all. I have no competing analysis and no basis to object — it's a sound addition and it's sized so it won't fire on legitimate multi-admin traffic, which is the property I'd have asked for if I'd thought to ask.
- **Distinct `audit_log` entry + `AuditEventName` addition on breach, plus the 80%-threshold early-warning signal.** Both are strictly better than my "structured log at minimum" placeholder. I described the breadcrumb an investigator would want; Tomás built the actual instrumentation, including the softer signal I didn't think to ask for. Accepted as written.
- **Sliding window over fixed calendar window, Redis-backed, purpose-built limiter over a new dependency.** These are implementation calls in his lane, not mine, and his reasoning (boundary-doubling on a fixed window; in-process memory silently under-enforcing the moment there's more than one instance) is sound on its face. I have no engineering standing to second-guess it and don't.
- **Enforcement placement (after authz, before team-lookup/precondition queries).** Accepted — this is also a better answer than anything I specified, since I didn't address ordering at all.

## 4. Net changes to the resolution

Keeping this to what actually changes from Tomás's document:

1. **Add** a per-actor `100 / rolling 24 hours` sustained cap, implemented with the same sliding-window/Redis approach and the same audit/`AuditEventName` treatment as his other two limits. Error code `TEAM_006_DAILY_LIMIT_EXCEEDED`.
2. **Merge language, not mechanics:** the 429 response `message` field (for both the per-actor burst breach and the new daily-cap breach) should include the escalation path I specified in my original Section 4 — that an admin who has a legitimate need to exceed the limit has somewhere to go, not just a wait time. Tomás's response envelope shape and error `category`/`code`/`correlationId` fields are unchanged; this is a copy addition, not a schema change.
3. **Keep, narrowed:** my original Section 5 time-boxed escape hatch (time-boxed increase, itself audited, auto-reverting) — but only for the daily cap, not the 10-minute burst window. A brief pause inside a single sitting doesn't need an exception process; a rollout that would need its 24-hour ceiling raised does.
4. **No change** to his per-actor 10/10-min number, his 50/10-min global limit, his audit/alerting design, or his implementation guidance. All accepted as proposed.

## Acceptance criteria — updated for the merged design

- 11th call from the same actor within a rolling 10-minute window → `429`, `TEAM_006_RATE_LIMIT_EXCEEDED`, `Retry-After` header.
- 51st call across all actors combined within a rolling 10-minute window → `429`, global-limit variant, distinct from the per-actor code.
- 101st call from the same actor within a rolling 24-hour window → `429`, `TEAM_006_DAILY_LIMIT_EXCEEDED`, `Retry-After` header.
- 8th call from an actor within a 10-minute window emits the `team.manager_association_rate_approaching` event without rejecting the request.
- A test asserting calls from a different actor are unaffected by another actor's per-actor and daily-cap state, but are counted toward the shared global-limit state.
- A 429 on any of the three limits writes the appropriate `audit_log` entry and structured event, and does not write a `team_memberships` row.
- Limit resets correctly at each window's boundary (per-actor 10-min, global 10-min, per-actor 24-hr) under the sliding-window semantics, not a fixed-bucket reset.

This resolves Q6 jointly, pending Tomás's confirmation on item 1 above (the daily cap addition) and a decision on whether the escape-hatch mechanism in item 3 is one he wants to own operationally, consistent with how my original proposal deferred that mechanism to the security analyst.
