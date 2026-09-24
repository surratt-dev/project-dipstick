# BA Review: Exploration Notes — auth-events-audit-log-coverage (SEC-12/SEC-13)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion), GitHub issue #132
**Lens:** Are these ideas specific enough to carry into a proposal without a round-trip back to me or Devon? Where would the implementation team — or whoever picks up Design — hit "what did you mean by this?"

Overall this is the strongest of the three documents in this chain on grounding discipline — the call-site inventory catches two events (`auth.failure`, `auth.session_created`) that both predecessor documents missed, the `join.link_*` five-call-site table is exactly the kind of "grep the event name, not the file the issue points at" work I want to see, and the transaction-availability breakdown is a genuinely careful piece of analysis that will save Design from defaulting to the wrong precedent. The six open questions at the end are, without exception, real decisions correctly left to Design rather than pre-decided — I have no objection to any of them being open.

My findings below are places where I pulled a thread the document treats as settled and it didn't hold, or where a stated ask ("get a number," "state explicitly") doesn't yet say how that would actually get answered. I checked the current code for the two claims that most affect my own core concerns (role visibility, no-manager-participation) rather than taking the document's characterization at face value, the same way I checked `connection-reauthorization.ts` against the last document's claims.

---

## 1. Genuine gap: the `join.link_redeemed` mismatch is not the same shape as `team.access_grant_mismatch` — it's the mirror image, and the difference matters

The document states: "an account with `global_role = 'engineering_manager'` can redeem a join link and land in `team_memberships` with a participant-shaped row — the identical mismatch shape `team.access_grant_mismatch` already exists elsewhere in this codebase to detect (a `team_memberships` row whose `role` doesn't agree with the user's `global_role`)."

I read `openspec/specs/team-content-access/spec.md`'s mismatched-state handling to check this. `team.access_grant_mismatch` fires for exactly one direction: `team_memberships.role = 'engineering_manager'` **while** `users.global_role != 'engineering_manager'`. The scenario the document describes is the opposite pairing: `users.global_role = 'engineering_manager'` **while** `team_memberships.role = 'participant'`. Both are "a row whose role doesn't agree with global_role" in the loosest sense, but they are not the same condition, and the existing detector does not fire on the second one — nothing in this codebase currently notices it. Separately, `session-participation/spec.md`'s own no-manager enforcement checks `users.global_role` directly at the participation endpoint (not `team_memberships.role`), so this particular mismatch does not appear to let a manager actually vote — but it does mean an EM can sit in `team_memberships` looking like an ordinary participant, undetected by the one mechanism this codebase built to catch role/membership disagreement.

That's not a reason to change scope — the document is right that fixing the mismatch itself isn't this issue's job. But "identical shape, already detected" and "a new, currently-undetected shape, in the opposite direction" argue for different levels of urgency, and a Design reader taking the document's wording at face value could reasonably (and wrongly) conclude the existing `team.access_grant_mismatch` signal already has this scenario covered, or that no new anomaly is actually being introduced here — when the accurate statement is closer to "durability is the *only* record of this scenario that will exist anywhere, because nothing currently flags it as anomalous at all."

**Suggested rewrite:** *"That means an account with `global_role = 'engineering_manager'` can redeem a join link and land in `team_memberships` with a participant-shaped row. This is the mirror image of the mismatch `team.access_grant_mismatch` already detects (that event fires on `team_memberships.role = 'engineering_manager'` + `global_role != 'engineering_manager'`; this is `global_role = 'engineering_manager'` + `team_memberships.role = 'participant'`) — a different condition that no existing mechanism in this codebase currently flags as anomalous. `join.link_redeemed`'s durability would be the only record of this scenario existing at all, not a second copy of a signal that already exists."*

---

## 2. Vague: `auth.role_claim_mapped`'s "would show its work" claim doesn't yet say what the row needs to contain for that to be true

The ritual-fidelity section argues persisting `role_claim_mapped` would let someone answer "did an EM's role ever get misapplied, and when." I read the actual emit call (`auth.ts:318-324`): today it carries `userId`, `oidcSubject`, `globalRole`, `sourceIp`, `correlationId` — the **current** role value only, no previous-role field — and per the inline comment, it fires **on every sign-in** where the role is non-default, not only on a change. Persisting exactly those fields as-is would still support the claim, but only via an indirect method: reconstructing a transition by noticing where a login's `globalRole` differs from the previous row for that `userId`, or by an absence of rows implying the role reverted to the default (`engineer`, which doesn't emit this event at all and so leaves no row either). That's a workable answer, but it's a materially different acceptance condition than "the row shows the transition," and the document doesn't say which one it means.

This is exactly the kind of thing the document correctly declines to decide elsewhere (field mappings are explicitly out of scope per the issue's "What this issue is NOT") — but whether the ritual-fidelity claim requires an explicit `previousRole`/`fromRole` field, or is satisfied by snapshot-per-login plus reconstruction-by-diff, is a fact about what the claim needs, not a field-mapping decision itself, and it changes how strongly Design should weight this event. I'd want that stated rather than left as an implication.

**Suggested rewrite:** *"Note for Design: today's `role_claim_mapped` emit carries only the current `globalRole`, fires on every applicable login rather than only on change, and has no `previousRole`/prior-value field. Persisting it as-is still supports the ritual-fidelity claim above, but only by reconstruction — diffing consecutive rows for a `userId`, with the caveat that a reversion to the default role (`engineer`) emits nothing and so is visible only as an absence, not a row. If that indirection isn't acceptable, adding a previous-value field is a field-mapping decision for Design to make explicitly, not something exploration should have assumed away."*

---

## 3. Vague: SEC-13's "authenticated user identity" field has no stated answer for the two events that fire before authentication exists

SEC-13 requires every audit log entry to include "authenticated user identity" among its five mandatory fields. The document places `auth.authorization_initiated` and `auth.callback_received` in the "strong candidate, bounded by login-funnel volume" camp and argues at length about their unauthenticated-reachability cost — but doesn't address that these two events, by construction, fire before any user identity is known. I checked both emit sites (`auth.ts:180-185`, `auth.ts:246-251`): neither carries a `userId` today — `authorization_initiated` has `sourceIp`, a truncated `stateNonce`, and two booleans; `callback_received` has `sourceIp`, the truncated `stateNonce`, `success`, and `correlationId`. If either gets a durable row, what satisfies SEC-13's "authenticated user identity" column — `NULL`, the truncated state nonce as a correlation key, or something else — is an open question the document doesn't name, even though it names comparable field-availability questions elsewhere (`team_id`, `userId` on `join.link_rejected`).

This isn't a reason to exclude these two events; it's a gap in an otherwise-careful "does this event have what SEC-13 needs" pass, worth closing before Design inherits an assumption either way.

**Suggested rewrite:** *"Open question: neither `authorization_initiated` nor `callback_received` carries a user identity today (both fire pre-authentication) — SEC-13 requires 'authenticated user identity' as a mandatory field on every entry. Design needs to state what satisfies that column for these two rows: `NULL` (matching Decision D4's precedent of a deliberate, uniform gap rather than an inconsistent partial fill), the truncated `stateNonce` as a correlation key back to the eventual `auth.success`/`auth.failure` row, or some other identifier — not left implicit."*

---

## 4. Vague: the volume-number asks ("get a number," "whatever's queryable") don't say where that number would actually come from, and the document's own citations suggest it may not exist yet

Three places in the document ask for a real number before a scope decision: `join.link_rejected`'s volume profile (Open Question 4), and the unauthenticated-reachability cost for `authorization_initiated`/`callback_received`. Both are framed as "pull whatever's queryable from the existing structured log." But `docs/deployment.md`'s own Logging section — which this document cites elsewhere for the transport-filtering risk — states plainly that "no transport is configured anywhere in this codebase today," and issue #3's reachability-check request was deferred for the identical reason: there's no shipped destination to query yet. If logs today only exist as stdout on ephemeral pods with no aggregation layer behind them, "pull an estimate from the structured log" may not be an actionable instruction for whoever picks up Design — there may be no number to pull, full stop, unless someone already has ad hoc access to raw pod logs from a long enough window to matter.

This is the one place I think the document's own admirable "I don't have a number and wouldn't guess one" discipline needs one more sentence: what happens if no number is obtainable at all. D1's precedent (cited approvingly here) asked for a `token_refresh_success` estimate and, as far as I can tell from the archived design, that request was never actually resolved with a hard number before the design proceeded — which suggests this codebase doesn't currently have an easy answer to "how do I query production log volume," and repeating the same open-ended ask a second time without naming that risk means Design may hit the identical dead end.

**Suggested rewrite:** *"Before asking Design to pull a volume estimate: confirm whether production logs are shipped anywhere queryable today (`docs/deployment.md` states no transport is configured as of this writing). If no query path exists, say so explicitly and give Design a fallback: proceed on the qualitative reasoning above with a stated assumption, or treat 'no volume data obtainable' itself as the reason to default to the more conservative choice (exclude / no synchronous row) until observability exists to revisit it — rather than leaving 'get a number' as an open action item that may have no path to completion."*

---

## 5. Vague: the recommendation doesn't say whether a deferral this time re-opens the same issue-spawning pattern the document spends its first section establishing

The opening section is explicit that this is the third link in a chain where each change named its own leftover gap and spun it into a new tracked issue (#27 → #30, #30 → #132). The Recommendation section asks Proposal to "name it the same deliberate way this issue itself was named" if anything gets deferred again — but doesn't say whether "named" means a Non-Goals bullet in proposal.md is sufficient on its own, or whether the pattern requires actually filing a fourth tracked issue the way the first two deferrals did. Given how much weight the document places on this discipline in its opening paragraph, leaving the mechanism ambiguous at the point it actually matters (the moment Proposal decides what to defer) is the kind of gap that turns into "well, it was in the Non-Goals section, that counts" after the fact.

**Suggested rewrite:** *"If Proposal defers anything named in this document — `auth.failure`/`auth.session_created` again, `join.link_rejected` pending a volume answer, or anything else — it should both state the deferral in proposal.md's Non-Goals (as the last two changes did) AND open a tracked GitHub issue for it before this change is considered done, matching #27→#30 and #30→#132 exactly rather than only the first half of that pattern."*

---

## What's already solid (no rewrite needed)

- **The `auth.failure`/`auth.session_created` discovery.** Both are real, correctly-cited gaps (three call sites and one call site respectively) that two prior documents in this chain missed. Naming them as an open question for Proposal rather than silently absorbing or silently continuing to omit them is exactly the discipline this chain needs.
- **The `join.link_*` five-call-site table.** Correctly identifies that `auth.ts`'s `executeJoinFlow` duplicates two-thirds of `join-links.ts`'s event surface, with exact line ranges. This is precisely the "grep the event name, not the file the issue points at" catch that prevented the fourth `session_invalidated` site from being missed a second time.
- **The transaction-availability grouping.** Splitting events into "no Postgres write in the call path" vs. "a write already in flight nearby" and naming the correct precedent for each group (bare-INSERT-fail-open vs. in-transaction) is exactly the kind of grounding that stops Design from cargo-culting `session-invalidation-audit.ts` just because it's the newest example in the file. Open Question 3 correctly leaves the actual choice to Design.
- **The `team_id` non-ambiguity check.** Verifying that Decision D4's NULL convention doesn't mechanically apply here (every `join.*` call site has an unambiguous `team_id` in scope) rather than assuming the precedent transfers is good discipline, explicitly checked rather than inherited.
- **The "no new read endpoint" grep.** Confirming no `FROM audit_log` read/display path exists anywhere in the backend, stated as a fact Design should keep true rather than a footnote, directly supports my own standing concern about individual-comparison surfaces without overstating it into something this issue needs to fix.
- **The provider-agnostic check**, run again and explicitly against the standing instruction, with a stated negative result rather than silence.

---

## Summary of asks before this moves to Design/Propose

1. Correct the `join.link_redeemed`/`team.access_grant_mismatch` comparison — mirror-image mismatch, not identical, and currently undetected by anything (Section 1).
2. State explicitly whether `role_claim_mapped`'s ritual-fidelity claim requires a `previousRole` field or is satisfied by snapshot-per-login reconstruction (Section 2).
3. Name what satisfies SEC-13's "authenticated user identity" field for `authorization_initiated`/`callback_received`, both of which fire pre-authentication with no `userId` today (Section 3).
4. Before asking Design to "pull a number," confirm a queryable log destination actually exists in production — if it doesn't, say so and give Design a fallback path rather than an open-ended ask (Section 4).
5. Make explicit whether a deferral this time requires filing a fourth tracked issue (matching #27→#30, #30→#132) or whether a Non-Goals bullet alone satisfies the pattern this document itself set up as the standard (Section 5).

None of these require reopening the scope calls the document already made well (the per-event severity/frequency lens, the transaction-grouping, the decision not to pre-decide which events get a row) — they're about making claims the document treats as settled actually hold up, and making the asks it leaves open actually actionable by whoever picks them up next.
