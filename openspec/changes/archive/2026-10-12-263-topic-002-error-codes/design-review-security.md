# Security Review of Design: 263-topic-002-error-codes

Reviewer: Tomás Ferreira, Security Analyst. Inputs: `proposal.md`, `design.md`, `tasks.md`, and the denial branch in `packages/backend/src/routes/content.ts` (lines ~865-905).

## Verdict

**Approve, no blocking findings. Security sign-off NOT required for this change.** I agree with the proposal's recommendation, on the conditions in "Sign-off position" below. Informed, not approver, is the right role. Five small items (S1-S5) should be folded in before implement; none needs another design round.

## Summary of security impact

This change adds one response member (`error.code`) to a 403 body whose two variants are already distinguishable by `error.message`. It does not touch: who is authorized (`checkStandingFacilitatorOrAdminAuthorization`), the order authorize, audit insert, event, floor, send, the audit row shape, the timing floor, `Cache-Control: no-store`, or any query. I checked the current branch: the code value will come from `decision.reason`, which is already the audit `metadata.reason`. The authorization boundary is not moved.

## Authentication and authorization

- No authentication change. The session is resolved before this branch; the handler is unchanged upstream of the 403.
- Authorization remains server-side and first. The design's test that a participant gets the same `NOT_A_FACILITATOR` body for an existing and a non-existent canonical UUID is the right one: it pins authorize-before-lookup, which is the property that stops this endpoint becoming a team-existence oracle. Keep it.
- The malformed-id 404 (`isCanonicalUuid`, line ~855) precedes authorization. That is pre-existing and reveals nothing (a malformed id names no team). Not in scope, no finding.
- D6's "clients MUST NOT use `error.code` to grant, unlock or hide an access decision" is the correct contract statement. It is documentation, not a control; the control is that the server decides. That is how it should be, and I accept it as sufficient because there is nothing client-side that can unlock anything.

## Information disclosure and oracle risk (exposing the code)

My view: **acceptable; the code adds no information beyond what the message already discloses.**

- Disclosed today, to any authenticated caller who hits TOPIC-002: the two messages differ, and the member message names the rule ("a team they are a member of"). The code is a one-to-one relabel of that bit. Information content is unchanged: exactly one bit (member-facilitator vs not).
- What the bit reveals: to a `FACILITATOR_IS_TEAM_MEMBER` caller, that they are a member of that team (they know already). To a `NOT_A_FACILITATOR` caller, that they are not a standing facilitator or that they are a global EM (they know already). Both facts are about the caller. No third-party data leaves.
- The oracle that matters is a facilitator probing arbitrary team ids to learn which teams exist or which teams they belong to. Probing many team ids as a facilitator yields `NOT_A_FACILITATOR`-class vs `FACILITATOR_IS_TEAM_MEMBER`, and the second only for teams where the caller is already an active member. A facilitator can learn their own memberships, which they can already see elsewhere. No cross-team inference. Combined with the authorize-before-lookup test above, no new oracle.
- Machine-readable matters in one respect: a stable code makes scripted enumeration marginally cheaper than prose matching. The marginal gain is nil here because the enumerated bit is the caller's own state. I am not asking for mitigation. If a future change adds a code that distinguishes EM or admin denials, that does change the answer, and the proposal already says to escalate it. I endorse that rule and ask that it be written into the contract text (S3).
- Rate limiting and probing of the denial path: unchanged. Each denial writes an audit row (fail-open), so a probing burst leaves a trail by user. Good.
- `NOT_A_FACILITATOR` for a global EM deliberately does not reveal EM status. Good; the "no EM-specific code" decision is correct and is a security-relevant decision the design should keep prominent (it is in the proposal; see S3).

## Audit logging

- Unchanged: row shape, event payload, ordering, and the audit time absorbed into the timing floor. The audit insert not sitting between the floor and the send is the right call and is preserved.
- **Explicit, deferred, accepted: fail-open on the denial audit (#264 D3).** A failed or timed-out insert still yields the 403 and the response is identical to a successful-audit response. I flag this because it is a real security trade-off recorded only as "existing behaviour". It means an attacker who can induce audit-table failures (DB pressure, a long-running lock) can probe unaudited. For a denial of a read-only list whose denial reveals one self-referential bit, I accept fail-open and I accept pinning it in tests. The structured event is still emitted with `rowWritten`, so the failure is itself visible in logs. I request that the follow-up list say that an alert on `rowWritten: false` rate is the compensating control (S1). The admin arm being fail-closed is the correct asymmetry: grants of access fail closed, denials fail open.
- The new test "the 403 still carries the code when the insert is rejected" correctly pins behaviour without changing it. Good.

## Correlation-id deferral (D3)

My view: **the deferral is acceptable, with one condition.**

- The linkage is useful for incident reconstruction: the response `correlationId` is a fresh `crypto.randomUUID()` unrelated to the audit row or the event, so a user who reports "I got this id" cannot be tied to a row. Under my own criteria (auditability as a control) this is a gap, but a narrow one: TOPIC-002 denials are reconstructable by `actor_user_id`, `team_id`, endpoint and timestamp, and the volume of denials per user is tiny. The reconstruction cost is low and the harm of a missed link is low.
- I agree that putting a key into the durable row `metadata` reopens #264's pinned shape and is not worth it here. I also agree with the event-only variant as the follow-up. The event is a log line, so there is no schema cost, and it would give support a join key.
- **Condition (S2):** the response `correlationId` is today a value that nothing in the system records. Support or a user quoting it will find nothing. Either say so plainly in the contract (the TOPIC-002 `correlationId` is not currently searchable in logs or audit), or take the event-only variant now since it is a one-line event payload addition with no durable change. I prefer the latter but do not require it; the documentation line is the minimum. Deferring is fine; leaving it implicit that the id is a lookup key is not. The same applies to the existing inline body today, so this is not a regression, but D6 is already editing that contract text.
- The named trigger for the follow-up (a Security request, or a failed lookup by user and time) is reasonable. Consider this note my standing request for the event-only variant if TOPIC-002 denials are ever alerted on.

## Threat model impact

- Assets: team topic list (low sensitivity but access-bounded); denial audit trail.
- New trust boundary crossings: none. New data flows: none. New inputs: none (the code is derived server-side from `decision.reason`; the spurious header/query negative test confirms no client input reaches it).
- STRIDE quick pass: Spoofing and Tampering, no change. Repudiation: no change (audit row identical). Information disclosure: see above, no net change. Denial of service: no change; the envelope adds a UUID and an object, trivial. Elevation of privilege: the main risk is a downstream client or later code treating `code` as an authorization input; mitigated by the contract sentence and by the server being the authority.
- Residual risk introduced by the stable vocabulary: a later contributor adds a third reason (for example for admins or EMs) to `decision.reason` and it flows to the client automatically, with no review gate, because the code is sourced from `decision.reason`. The design rejects an exhaustiveness check as too wide a diff. That is the one place I disagree mildly (S4): "a third reason would fail review" depends on a reviewer remembering. This is exactly the "controls that depend on discipline" pattern I flag. A parametrised test that asserts the set of observable codes equals exactly `{NOT_A_FACILITATOR, FACILITATOR_IS_TEAM_MEMBER}` is already in the plan (exactly-two bodies). Make that test's failure message say why (a new reason is a disclosure decision for Security). That gets most of the benefit without restructuring the branch.

## Deferred or implicit security decisions (inventory)

1. Fail-open denial audit retained and now pinned by tests (explicit in the design, but its security rationale is only implicit). See S1.
2. Correlation id unlinked to audit or event; response id unsearchable. Explicit as a deferral; the consequence is implicit. See S2.
3. No EM- or admin-specific code. Explicit in the proposal; not in design.md or the contract text. See S3.
4. No compile-time guard on new reasons leaking to clients. Explicit as a rejected alternative; the residual risk is implicit. See S4.
5. TOPIC-001's inline admin 403 (distinguishable by message, no code) and TOPIC-007 left unverified/unchanged. Explicit as non-goals. Note for the record: TOPIC-001's admin-vs-nongrant distinguishability is a pre-existing minor role disclosure that contradicts the stated generic-denial intent. I accept the low priority but ask it be filed (it is already follow-up 4).
6. Timing floor: unchanged, and the added envelope construction occurs after the floor, so its microsecond cost is outside the equalised window but identical across both reasons. No timing differential between the two reasons is introduced. No finding. (S5 asks for one cheap confirmation.)
7. Frontend handling of a 403 on refresh (whether it clears loaded data) is unverified; it is a UX bug, not a security issue, but it should not become a case where the page shows stale authorized data after a denial. Task 0.2 covers it.

## Requested changes (all small, none blocking)

- **S1.** Add to the design (Risks or D5) one sentence of rationale for fail-open: denial reveals only a caller-self bit; the event still records `rowWritten`; recommend alerting on `rowWritten: false`. Add to follow-ups as an optional operations item.
- **S2.** In D6 add a sentence to the contract: "`error.correlationId` on this 403 is generated per response and is not currently recorded in the audit row or the event." Or implement the event-only variant. Pick one.
- **S3.** Put the rule "no code may distinguish engineering-manager or application-admin denials without Security review" into the REST API Contract text next to the MUST NOT sentence, not only in the proposal.
- **S4.** Make the exactly-two-codes test explicit and give its failure message a pointer to Security review.
- **S5.** In the verification step, record that the two reasons' response times are not distinguishable beyond existing behaviour (an existing timing test should cover it; confirm it still covers both reasons after the code is added). No new test needed if it does.

## Sign-off position

I do **not** want Security sign-off to be required for this change. Rationale: no authorization decision, audit behaviour, data returned, or trust boundary changes; the disclosed bit is already disclosed; the code is server-derived with no client input path. I would **want** Security sign-off (and would escalate) if any of the following appear in the implementation: a new `decision.reason` value or a code that distinguishes EM or admin denials, any change to audit-row `metadata`, any change to the fail-open or fail-closed behaviour, any client-side branching on `error.code` that changes access rather than display text, or any change to ordering around the timing floor. Please state those triggers in the PR description so the reviewer can catch them.

I would like to be informed when the change merges and when the event-only correlation follow-up is filed. I will carry S1-S5 into the pre-production review checklist rather than hold this change for them.
