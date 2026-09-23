# Explore-Stage Review: session-timeout-continuity (#133)

**Reviewer:** Marcus Delgado, Business Analyst (standing owner for scoping/prioritizing this issue per the issue's own Owner note)
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion)

## Bottom line

Devon's routing-bug finding is real and specific enough to act on — I verified it against the code, not just the write-up. But Devon's own most important open question (Question 1: is OR-1.7's rejoin-with-state-restored contract implemented today for the ordinary case?) resolves in the direction Devon flagged as the larger-scope outcome, not the smaller one Devon leaned toward recommending. I want that stated plainly before this goes to proposal, because it changes what "done" means for #133.

## What I verified and confirms Devon's read

- `packages/backend/src/realtime/websocket-routes.ts:60` — `const CLOSE_FORCE_EXPIRED = STALE_SIGNAL_CLOSE_CODE;`, used at line 334 on the absolute-timeout force-close path. Confirmed, not paraphrased.
- `packages/backend/src/realtime/connection-token-refresh.ts` defines and uses a distinct `REAUTH_GRACE_EXPIRED_CLOSE_CODE` on the refresh-failure path (line 166) — a different code exists and is already wired to a different, better outcome.
- `packages/frontend/src/realtime/connectionHealth.ts` branches on close code exactly once, at `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (line 220) → `reauth-required`. Every other close, `STALE_SIGNAL_CLOSE_CODE` included, is one undifferentiated bucket → `unknown-reconnecting`, confirmed by the module's own header comment (lines 15-22).
- Zero references to `session_expired` anywhere in `packages/frontend/src` — confirmed by grep, matches Devon's claim exactly.

Devon's hypothesis is not vague and does not need re-verification at proposal stage — it's a one-line code citation, not an inference. **Recommend the proposal treat "the absolute-timeout force-close sends the disclosure-blind code instead of the disclosed reauth code" as an established fact, not an open question.**

## Where I need the exploration notes corrected before proposal

**Question 1 has an answer, and it's the one that makes this bigger, not smaller.** I went looking for whoever consumes `session_registration_snapshot` on the frontend — the mechanism Devon flagged as "looks like it's the mechanism for exactly this" but couldn't trace end-to-end. There is no consumer. `grep -rn "session_registration_snapshot" packages/frontend/src` returns nothing outside a test-file comment (`voteDraft.test.ts`), and that comment is explicit that the wiring is deferred: `vote-compose-recovery`'s own `tasks.md` (archived 2026-09-11) leaves tasks 8.1–8.3 unchecked, with 8.1 reading "**once the compose UI exists**... wire the compose UI's mount-time effect... to call `restoreDraft`."

That's because the compose UI doesn't exist. I checked the frontend page tree for the live-session voting screen OR-1.7 describes rejoining into — topic display, vote casting, the readiness grid with real data, the reveal control — and found:
- `SessionConnectionHost.tsx` — its own header comment states it is "not a feature-complete live-session page" and that "building the full live-session voting UI... is explicitly out of scope."
- `FacilitatorConnectionHost.tsx` — same disclaimer, and it renders `FacilitatorReadinessGrid` against **hardcoded `STUB_ROWS`**, not real participant data.

There is currently no page in this codebase where a facilitator can trigger a reveal, or where a participant casts a vote, against real session state. **"Does ordinary reconnect-and-rejoin work today" is close to a category error as currently framed — there is no "ordinary" live-session experience yet to reconnect into.** This isn't a criticism of Devon's read; the trace requires knowing the frontend page tree, which is exactly the kind of check that needs verification against the running app rather than the diff, as Devon's own notes already said. It just needs to land as an answer, not stay an open question, before proposal.

**Suggested rewrite of Devon's Recommendation section:** replace "this is very likely a routing/signaling fix... provided Open Question 1 confirms the rejoin-with-state-restoration half of that contract is real today" with something like: *"Open Question 1 is resolved: the rejoin-with-state-restoration half of OR-1.7 is not implemented today — the live-session voting UI itself (topic display, vote casting, real readiness grid, reveal control) does not exist in the frontend yet; only stubbed connection-health hosts do. This means #133's honest scope is two separable pieces with two separable owners/timelines: (a) the close-code routing fix, which is small, real today, and can ship independently — wiring `CLOSE_FORCE_EXPIRED` to `REAUTH_GRACE_EXPIRED_CLOSE_CODE` gets a facilitator/participant out of the infinite-retry trap and into the existing `reauth-required` CTA regardless of what session state they land back into; and (b) 'does the facilitator actually land back at the correct topic with the readiness grid intact,' which cannot be verified, built, or accepted against real UI until the live-session voting screen exists as a change of its own. (b) is not blocked by #133 and #133 is not blocked by (b) — but the proposal must not imply (a) alone satisfies OR-1.7's full text, and must not schedule an acceptance test for (b) against UI that isn't there."*

This matters for scoping because if I don't correct it now, we risk a proposal.md that writes acceptance criteria implying full state-restoration verification, which nobody can execute — and I'd rather name that gap now than have it discovered at implementation like Devon's own stated worry about edge cases becoming scope disputes.

## Requirements accuracy check (OR-1.7, NFR-AUTH-005, SEC-26, FR-4.1, FR-4.6.1)

All of Devon's verbatim quotes check out against `requirements/BRD.md` and `04 - Live Voting - Use Cases.md` at the cited lines. One addition Devon's notes missed:

**BRD.md §16, OQ-2 ("Session State Recovery After Interruption — Partially Resolved") is directly on point and currently unaddressed in the exploration notes.** It confirms OR-1.7's resolved half (verbatim match to what Devon quoted) but explicitly lists as **still open**: *"(b) what timeout or staleness policy applies to a session stuck in an active or wrap-up state."* That's this issue, by the BRD's own accounting — not a new discovery, a previously-flagged gap this issue is positioned to close. I'd cite OQ-2(b) directly in the proposal as prior evidence this gap was anticipated, and note that (a) reassigning facilitator control and (c) partial-session retention are explicitly NOT this issue's scope — don't let them drift in.

SEC-26's read is correct and the sharpest observation in the notes: the requirement's own sentence structure ("notify... grace period... [terminate]... The absolute maximum session lifetime... must be enforced even if a valid token is present") reads as one continuous behavioral spec that the implementation split into two paths, one graceful and one not, without a documented reason. I agree this is very likely to be an oversight in how broadly SEC-26 was applied at build time, not a deliberate call — worth Design/the Full Stack Engineer confirming, since the issue names Marcus Oyelaran as required sign-off.

FR-4.1 and FR-4.6.1 connections are correctly scoped as "worth naming, not a violation" and "a different failure class, not a latency problem" respectively — I don't think either needs rewriting.

## Concrete acceptance conditions the proposal should carry forward

Devon's notes correctly identify the need for these but don't state them as testable conditions. Here's my pass, organized by the scenarios the issue body itself invites ("mid-vote," "mid-reveal," "facilitator drops"):

1. **Facilitator's absolute timeout fires while a topic is in the voting phase (mid-vote, pre-reveal):** WS force-close must send the disclosed reauth code. Client must land in `reauth-required`, not `unknown-reconnecting`. Per the existing use-case contract (line 371), the topic must remain in the voting phase — no reveal, no auto-advance — until the facilitator completes re-auth and rejoins. *(This one is testable today, independent of the live-voting-UI gap above, because it's a backend/connection-health-level behavior.)*
2. **Facilitator's absolute timeout fires mid-reveal (after clicking, before all clients confirm receipt):** Out of scope for #133 to newly define — FR-4.6.1's reveal is already a one-way server-side transition per the Trigger Reveal use case notes ("no un-reveal"); a facilitator logout after the transition has committed server-side does not need to block or roll back anything. Acceptance condition: confirm (don't newly build) that the reveal, once server-committed, completes for all other clients regardless of the facilitator's own connection state.
3. **Participant's absolute timeout fires mid-vote (composed, not yet locked in):** Explicitly out of scope per the issue body's own reference to #31 — don't re-litigate composed-vote-state persistence here. Acceptance condition for #133 specifically: the participant reaches `reauth-required`, not an infinite retry loop; what happens to their compose state on the other side of re-auth is #31's territory.
4. **Participants when the facilitator is the one who dropped:** OR-1.7 and the use cases only specify the facilitator's own reconnect experience — I don't see a spec'd "facilitator is away" indicator for participants (Devon's Open Question 5 is right to flag this as absent, not just unverified). I'd resist inventing one in this proposal; recommend deferring it as a separate, explicitly-scoped follow-up rather than folding it into #133's acceptance criteria, consistent with how #31 was carved out. If Design disagrees, that should be a stated decision, not a silent scope-creep.
5. **HTTP-side 401 on `session_expired` (any page, not mid-WS-session):** No shared interceptor exists today (confirmed). I'd treat this as in-scope for #133 only if the proposal's stated goal is "fix the signal wherever it's broken," not if it's "fix the live-session experience specifically" — Design should pick one framing explicitly rather than let it default by omission.

## Is anything here too vague to carry into a proposal?

One thing: the issue's own "Named next step" lists three candidate directions (pre-expiry warning, server-side grace/extension, accept-and-recover). Devon's notes correctly avoid pre-selecting one, and I want that discipline to hold into proposal — but the proposal document itself will need to make a call, and right now nothing in either the issue or the exploration notes says who makes it or against what criteria. Per the issue's Owner note, that's my call to make, with Priya Nair as required domain reviewer. My leaning, consistent with Devon's: fix the signal (this is closer to a bug than a feature, per the SEC-26 reading above) and treat a pre-expiry warning as a separate, later decision — but I want that stated as a scoping decision in the proposal, attributed, not left implicit.

## Provider-agnosticism check

Confirmed independently: `ABSOLUTE_LIFETIME_MS` and the reconnect path both run through the app's own session/OIDC-callback machinery, not provider-specific logic. No correction needed to Devon's finding here. [[project_oidc_multi_provider]]
