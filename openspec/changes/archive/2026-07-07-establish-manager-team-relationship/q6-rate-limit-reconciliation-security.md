# Q6 Reconciliation: Rate Limiting Threshold for TEAM-006

**Author:** Tomás Ferreira, Senior Application Security Analyst
**In response to:** `q6-rate-limit-proposal-ba.md` (Marcus Delgado)
**My prior position:** `q6-rate-limit-proposal-security.md`
**Status:** **AGREE WITH MODIFICATIONS** — see Section 6 for the specific changes required before I sign off on Q6 as resolved.

I read Marcus's document in full before writing this. Where he moved my number, he did it with a legitimate-usage argument I hadn't stress-tested hard enough. Where I still think his draft has a gap, I'm saying so directly rather than converging for the sake of converging — Q6 is a joint decision, not a majority vote, and a bad number here is a production incident, not a documentation disagreement.

---

## 1. Does my 10/10-min number actually survive his scenario (c)?

Marcus's scenario (c) — an admin or small script associating up to ~100 teams in a single onboarding day — is the right scenario to pressure-test against, and I didn't stress-test my number against it hard enough the first time. I tested my 10/10-min threshold against a "director takes over 8-10 teams in one sitting" scenario and called that the ceiling of legitimate burst need. I did not separately model a same-day, multi-hour bulk-rollout workflow, and Marcus is right that this is a real, product-motivated use case — the design doc's own multi-team-EM support is achieved by repeated TEAM-006 calls, and someone has to make all those calls when an organization first onboards.

Run the numbers on my original proposal: a 10-per-10-minute sliding window has a steady-state maximum throughput of 1 request/minute, sustained indefinitely. Completing 100 associations at that ceiling takes **a minimum of ~100 minutes**, and in practice more once you account for a script's own pacing slop or an admin needing to look up team IDs between submissions. That's not *impossible* — it fits inside a single business day — but it's materially worse UX than Marcus's 20/10-min number, which gets the same 100 associations done in ~50 minutes at steady state, and it does so for no additional security benefit I can point to, because (per Section 2 below) the number that actually matters for bounding attacker blast radius is the daily cap, not the burst window, once a daily cap exists.

**I'm moving off 10/10-min to 20/10-min per actor.** Once a hard daily ceiling is in place, the burst window's job changes: it no longer has to be the sole bound on total exposure, it only has to bound *how fast* damage can be done and guarantee an audited signal fires early in an attack. 20/10-min still does both of those — it still caps a compromised credential at 20 newly-exposed teams before the first 429, and it still fires the approach-warning signal (Section 4) well before that. It just also stops penalizing the legitimate rollout case for no compensating security gain. That's a trade I'll take.

---

## 2. The missing daily cap — this is a real gap, not a redundancy

This is Marcus's strongest point and I'm adopting it, not just tolerating it.

My original proposal relied entirely on the rolling 10-minute window and explicitly declined a daily/24-hour cap. I justified that partly on an assumption I should have stated explicitly and didn't: that the 90-minute absolute session lifetime (`middleware.ts`, `ABSOLUTE_LIFETIME_MS`) puts a natural ceiling on how long a single burst of activity can run. That assumption doesn't hold for the threat model's own named attacker. The threat is a *compromised credential*, not a stolen session token that expires and can't be renewed — an attacker holding valid credentials can simply re-authenticate when the session lifetime forces it, and keep pacing requests just under the per-actor threshold indefinitely. Nothing in my rolling-window-only design stops that. Run the math the other direction: 9 requests every 10 minutes, sustained for 24 hours, is up to ~1,296 associations — over ten times the blast radius Marcus's cap allows — and it never once trips a rate limit or writes a rate-limit `audit_log` row under my original proposal.

That gap is made worse, not better, by Finding 2.3: I proposed an 80%-threshold early-warning signal specifically so a pattern like "consistently sitting at 8-9 of 10 requests per window" would be visible to *something*. But as I said in my own document, nothing currently consumes that signal. A detection with nobody watching it is not a control, it's a future control. Until Finding 2.3's monitoring gap is closed, the only thing actually standing between a patient, rate-aware attacker and unbounded accumulation is a hard ceiling that doesn't depend on anyone watching a log stream in real time. That's exactly what a 24-hour cap provides and a rolling window alone does not.

**I accept the 100/24-hour sustained cap as a required addition to this resolution, not an optional enhancement.** This closes a gap in my own proposal that Marcus's usage-driven analysis surfaced and my own re-derivation of the patient-attacker math confirms.

---

## 3. The escape hatch and the 429 wording

**429 response shape, error envelope, and escalation-path message: accepted as written.** The category/code/message/correlationId pattern matches this codebase's existing error envelope and Decision 4's precedent for caller-facing, specific error information. This is an internal, authenticated, admin-only endpoint — the exact threshold numbers and retry timing are not sensitive to disclose to the population of people who are authorized to call this endpoint at all, and telling a legitimate admin exactly what happened and what to do about it is the secure-and-usable outcome, not a tradeoff against security. Distinguishing `TEAM006_BURST_LIMIT_EXCEEDED` from `TEAM006_DAILY_LIMIT_EXCEEDED` as separate codes is also correct — an investigator (or an admin escalating) needs to know which ceiling was hit.

**No account lockout on breach: accepted, and I'd have insisted on this myself if it weren't already in his draft.** Rate-limit breach and suspected-credential-compromise are different signals with different evidentiary weight, and auto-locking a small, high-accountability admin population on a signal that's equally consistent with "legitimate rollout, no throttling in their script" as with "attacker" would train admins to treat 429s as something to route around rather than something to report. Keep them separate, as he proposes.

**Escape-hatch procedure: accepted in principle, with one hard modification.** The three properties he requires — time-boxed, audited (who requested, who approved, what value, when it expires), and auto-reverting with no manual restoration step — are exactly the secure-default shape I'd have designed myself: a control that doesn't depend on a human remembering to undo it later. I'll own building this, as he deferred.

The modification: **the request must go through an out-of-band approval channel, not a self-service request made from the same admin session that's asking for more of the exact capability the threat model is worried about a compromised version of.** Marcus's draft says "the admin ... requests ... through whatever mechanism the security analyst already uses for equivalent exceptions" — I'm treating that as a placeholder I need to fill in, not a detail I'm free to skip. Concretely: the approval step cannot be satisfied by anything reachable using only the admin's existing authenticated session or the credential the threat model already assumes might be compromised (e.g., not an in-app self-service toggle, not an email thread that a compromised account's own inbox access could forge or approve). It should route through a channel independent of that credential — a ticket a second person opens, a call, or equivalent — with a named human approver distinct from the requesting admin. This is not me relitigating the mechanism Marcus correctly left to me; it's me stating the one property that mechanism must have before I'll sign off, because an escape hatch reachable by the compromised credential itself is not an escape hatch, it's a bypass with extra paperwork.

---

## 4. Compensating signal: keep it, and extend it to the new daily cap

I'm keeping the 80%-threshold early-warning signal from my original proposal, recalibrated to the new numbers, and I'm adding a second instance of it against the daily cap — because the daily cap is precisely the mechanism that closes the patient-attacker gap in Section 2, and that gap is exactly the case where an early signal matters most.

- **Burst approach signal:** fires at 16 of 20 requests in the rolling 10-minute window (80% of the new per-actor burst threshold).
- **Daily approach signal (new):** fires at 80 of 100 requests in the rolling 24-hour window (80% of the sustained cap).

The daily-approach signal is the one that actually detects the "pace just under the limit for hours" pattern I described in Section 2 before the attacker reaches the hard ceiling, rather than only after. Both remain non-blocking, log-only signals — the request still succeeds — and both remain scoped to task 3.10 as "emit the event correctly," not "build the alerting pipeline," for the same reason I gave originally: that's Finding 2.3's scope, and I'd rather see admin-side and EM-side monitoring built once, deliberately, than have this endpoint's logging revisited a third time.

---

## 5. What doesn't change

- **Per-actor keying on `session.userId`, not IP.** Unchanged and unaddressed by Marcus's draft in a way that would change it — he independently arrived at the same actor-scoping rationale for the same reason (the asset being protected is the credential, not the network path).
- **Redis-backed, shared-state, purpose-built limiter (not `@fastify/rate-limit`).** Unchanged. Marcus's draft references "the rate-limiting middleware already stubbed at `teams.ts:637–641`" without prescribing the implementation, so there's no conflict here — this remains my recommendation and I'll verify it in the pre-production review.
- **No target-team or target-user dimension.** Unchanged; neither of us proposed one, for the same reason (the attacker controls the target, so only the actor-scoped limit closes every variant).
- **Distinct `audit_log` row on breach, plus a distinct `AuditEventName`.** I'm treating this as compatible with, not contradicted by, Marcus's draft — he says the 429 "does not need Decision 9's transactional `audit_log` treatment," which I read as "doesn't need the same in-transaction atomicity guarantee as the TEAM-006 write itself" (correct — there's no `team_memberships` row to be atomic with), not "skip the durable audit table in favor of an application log line." I want that made explicit here so an implementer doesn't read his wording as license to log only to stdout: **both the burst-limit and daily-limit breach events must write a durable `audit_log` row** (`actor_user_id`, `actor_ip`, `team_id`, which limit was breached, observed count), written synchronously and reliably before the 429 is returned, in addition to the structured `AuditEventName` event for downstream alerting.

---

## 6. Summary — what changed, and what's still required before I sign off

| Dimension | My original | Marcus's proposal | Joint resolution |
|---|---|---|---|
| Per-actor burst | 10 / rolling 10 min | 20 / rolling 10 min | **20 / rolling 10 min** (moved to his number — Section 1) |
| Per-actor sustained | None | 100 / rolling 24 hr | **100 / rolling 24 hr** (adopted — Section 2) |
| Global secondary (all admins) | 50 / rolling 10 min | Not addressed | **100 / rolling 10 min** (scaled to preserve the original 5x buffer over the new per-actor burst number) |
| Approach/early-warning signal | 80% of burst only | Not addressed | **80% of burst (16/20) AND 80% of daily (80/100)** (extended — Section 4) |
| On-breach response | 429 + `Retry-After` + distinct `audit_log` row + `AuditEventName` | 429 + `Retry-After` + escalation-path message | **Both**, explicitly: Marcus's error-body/escalation wording + my durable `audit_log` requirement for both limit types |
| Escape hatch | Not addressed | Time-boxed, audited, auto-reverting; approval mechanism deferred to security | **Accepted, with approval channel specified**: must be out-of-band from the requesting admin's own session/credential, with a named approver distinct from the requester (Section 3) |
| Account lockout on breach | Not addressed | None — separate, richer-signal-driven decision | **Agreed, unchanged** |
| Keying, store, implementation approach | Actor-keyed, Redis, purpose-built limiter | Not addressed (compatible) | **Unchanged** |

**Still required before I consider Q6 fully resolved and task 3.10 unblocked:**

1. The escape-hatch approval step must be written into the spec as requiring an approval channel independent of the requesting admin's own session/credential — not just "a mechanism the security analyst uses." I'll supply the specific procedure, but the *property* (out-of-band, named distinct approver) needs to be in the resolution text itself, not left implicit.
2. The daily-cap approach-warning signal (80/100) needs to be added to task 3.10's acceptance criteria alongside the burst-approach signal and the two breach tests Marcus already specified.
3. Task 3.10's acceptance criteria should be updated for the new numbers (21st→20th, and add the 101st-call daily test Marcus already wrote, which I have no changes to).
4. The global secondary limit (100/10-min, scaled from my original 50) should be added explicitly to the spec text — it isn't in either of our documents as adopted numbers yet, only mine at the old ratio.

None of these four are number disputes — they're the residue of merging two independently-written documents into one buildable spec. Once they're folded in, I'm ready to co-sign.

**Recommendation, non-blocking:** consider a global 24-hour aggregate cap (all admins combined) as defense-in-depth against a multi-admin-compromised-close-together scenario extended over a full day, not just a 10-minute window. Neither of us has proposed one, and I'm not making it a condition of closing Q6 — the per-actor daily cap already does the primary job the threat model asks for — but it's a natural companion to the global 10-minute secondary limit and I'd like it scoped as follow-up work whenever Finding 2.3's monitoring gap is addressed, rather than dropped entirely.
