# Propose-Stage Review — WebSocket Staleness Signal (BA)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `proposal.md`
**Against:** BRD OR-2.2, OR-3.5, OR-3.6, OR-4.4, SEC-25, SEC-26; `exploration-notes.md`; my own `explore-review-ba.md`; `openspec/specs/websocket-connection-reauthorization/spec.md`

---

## Overall

Before I get to the one thing I think blocks this, I want to confirm the good news, because it's real: the three rewrites I handed Propose at Explore stage — retry-symmetry as a testable acceptance condition, the grid-marker bound, and the shared-component requirement — all landed, and not as something-resembling-them. I diffed my own wording against the proposal's:

- **Shared-component requirement** (my §2.4) → proposal bullet 2 ("exactly one client-side connection-health module... No second implementation may be built independently, including by issue #33's later work"), word-for-word with one improvement: it adds "when it picks up the reauthorization-flow case," which is a real clarification I didn't write.
- **Retry-strategy symmetry** (my §2.1) → split correctly across two places: the "MUST NOT branch on close-code value" language in bullet 1, and the testable condition itself verbatim in the retry-symmetry bullet. Splitting it didn't lose anything.
- **Grid-marker bound** (my §2.3) → landed close to verbatim, including the cause-blind clause, the TTL/lifecycle requirement, and a genuine addition (the "which moments in the session lifecycle" bullet) that I didn't ask for but is a real gap-closer.
- The three Section 1 gaps (recovery silence, initial-connection fold-in, grid-marker lifecycle) are all now explicit requirements, not implicit decisions. Good.

So the verbatim-check passes. This review is about what's new since Explore, not a re-litigation of what I already signed off on.

---

## 1. Blocking: the proposal doesn't account for `websocket-connection-reauthorization`'s wire signals

This is the finding I don't think anyone has surfaced yet, and I want to be direct that I'm partly responsible for not catching it at Explore — `exploration-notes.md` §4 cites my own sign-off on `websocket-connection-reauthorization` by name, so I had the context and didn't push on this specific angle then. Flagging it now rather than letting Design inherit it silently.

**What's missing:** The proposal's entire disclosure model is built around one wire signal — `STALE_SIGNAL_CLOSE_CODE` (4000), shared by delivery-time rejection and the SEC-25 sweep's revocation close. I checked the code to confirm the sweep really does reuse 4000 (`connection-reauthorization.ts:109`), so that part of the proposal's premise is solid.

But `websocket-connection-reauthorization` (archived today, issue #27) introduced a **second, deliberately distinct** signal pair that this proposal never mentions:

- `REAUTH_GRACE_EXPIRED_CLOSE_CODE = 4001` (`connection-token-refresh.ts:34`) — a close code the reauthorization spec's own requirement ("Revocation closes and re-authentication signals are never conflated," spec.md:107-109) mandates must **never** be reused across the SEC-25 and SEC-26 mechanisms. It is deliberately not 4000.
- An explicit in-band `{"eventType": "reauth_required"}` message (`connection-token-refresh.ts:151`), sent to the client *before* that close — not a close code at all, an application-level signal the client receives while the socket is still open.
- The reauthorization spec explicitly reserves the client-side UX for this signal as its own tracked item: **issue #32**, named alongside #33 in spec.md:11 ("The client-visible UX for the SEC-26 re-authentication prompt... [is] frontend design work this spec does not define — tracked as GitHub issues #32 and #33"). This proposal names #33 five times. It does not name #32 once.

This isn't a paperwork gap — it's a real architectural question the proposal's current wording can't answer:

1. **Does the two-value state machine ("connected / unknown-reconnecting, no third value") receive and handle 4001 and `reauth_required` at all?** The retry-symmetry acceptance condition only forces "a 4000 close and a simulated network drop" through the test handler. 4001 is untested and unmentioned. An engineer building literally to this proposal has no instruction on what to do when the socket receives `reauth_required` or closes with 4001.
2. **If they're meant to fold into the same undifferentiated bucket** (which the disclosure logic in this proposal would argue for), that's a functional problem, not just a UX one: the reauthorization spec states recovery from a SEC-26 grace period is "always a fresh connection, never an in-place resume" (spec.md:63) — it requires a full top-level page navigation to the identity provider. A retry/backoff/jitter loop, applied identically per this proposal's own symmetry requirement, **cannot ever succeed** for that case. A participant would sit behind an "uncertain, reconnecting" banner that retries forever and never resolves, with no signal telling them the actual fix is to log in again. That's a worse outcome than the disclosure risk this proposal exists to close.
3. **If they're not meant to fold in** — if `reauth_required` is supposed to trigger something categorically different (a prompt to re-authenticate) — then the "no third value" claim in bullet 1 is not accurate as stated, and issue #32's eventual work will either have to fork this module (which bullet 2 explicitly forbids: "No second implementation may be built independently") or this proposal's state machine needs a third state it currently rules out by name.

I don't think this proposal needs to *solve* #32 any more than it solves #33 — the "deferred consumer" pattern already used for #33 is the right shape. But right now #32 isn't deferred, it's **absent**, and the absence matters because bullet 2's exclusivity requirement makes a forward-looking claim ("no second implementation may be built independently") that this proposal can't actually back up without at least naming how 4001/`reauth_required` relate to the bucket it's defining.

**What I'd want before this goes to Design:** one paragraph, in the Why or Impact section, that either (a) explicitly states 4001 and `reauth_required` also fold into the `unknown-reconnecting` bucket at the state-machine level, extends the retry-symmetry test to force a third case (4001) through the same handler, and names issue #32 as a second deferred consumer alongside #33 — with an explicit note that #32's actionable "please log in again" prompt is a *separate, later* UI surface layered on top of (not a fork of) this state machine, not something this bucket itself renders; or (b) argues explicitly why 4001/`reauth_required` are out of scope for this change and names the gate that keeps that reasoning from becoming an accident. Silence is the one option that isn't acceptable, given bullet 2's exclusivity language is already making a claim about all future consumers.

**Requirements this touches directly that the proposal doesn't cite:** SEC-25, SEC-26 — worth naming explicitly given the above, not just OR-2.2/OR-3.5/OR-3.6/OR-4.4.

---

## 2. Non-blocking: the grid's "existing three" states omits `disconnected_voted`

The proposal states the grid marker "adds at most one new visual state to the grid's existing three (`connected+locked-in`, `connected+not-locked-in`, `disconnected+no-vote`, per `redis-session-model.md`)." I need to own something here: that enumeration is my own wording, from my Explore-stage review (§2.3) — Propose copied it faithfully. But it's incomplete against my *own* domain validation notes in `redis-session-model.md:381`, which document a fourth roster state, `disconnected_voted`, that renders as "ready" (preserving OR-1.3 — a participant who disconnects after locking in keeps their "ready" indicator).

The proposal's three-state baseline silently drops this case. That matters here specifically because it raises a question the proposal doesn't answer: **does the new staleness marker apply to a `disconnected_voted` participant?** They're already shown as "ready" per OR-1.3, and their connection is, definitionally, not `connected`. If the marker is driven purely off connection status, a participant who voted and then went stale would now show both "ready" and "may be stale" — which is new information density OR-2.2 caps, and a state combination the proposal's "at most one new visual state" bound doesn't obviously account for since it started from an incomplete baseline.

Not a blocker on its own — but Design needs the corrected four-state baseline, not the three-state one, or this gets rediscovered as a Design-stage surprise.

---

## 3. Traceability check

| Requirement | Addressed? | Comment |
|---|---|---|
| OR-2.2 (readiness grid: locked-in status and nothing more) | Yes, grid-marker bullets | See §2 above — bound is correct in spirit, baseline it's measured against is short one state. |
| OR-4.4 (facilitator-only) | Yes, explicitly cited | Correctly extends to the stale/accurate distinction itself, not just readiness value — same good catch as Explore stage. |
| OR-3.5 / OR-3.6 (simultaneous reveal, zero pre-reveal visibility) | Yes, "Impact" framing | Correctly stays adjacent-not-identical, as at Explore. No overclaim. |
| SEC-25 / SEC-26 | **Not cited** | See §1 — this is the gap. The proposal engages with the *delivery-time-authorization* close code (4000) in depth but never names SEC-25/SEC-26 or their distinct signals, despite this change's stated purpose being "does the UI leak back in through a door the wire protocol closed" — SEC-26 opened a second door after Explore's framing was set. |

---

## 4. Everything else

- Open Design Questions section: appropriately deferred, correctly declines to average Priya's and the color-budget instruction together in prose. This is exactly the discipline I want at this stage — no complaints.
- Gate language (9.3's "filed" vs. "signed off," four-bullet completion condition): carried forward verbatim as I asked. Good — this is the one place precision-loss in paraphrase would have mattered, and it didn't happen.
- "BREAKING: None" — accurate, first frontend WebSocket client in the codebase, nothing to break.
- Facilitator-experience requirements (Priya's usability-test commitment, tooltip placeholder, no outlier-flagging affordances): correctly framed as requirements, not preferences, matching what I asked for at Explore.

---

## 5. Verdict

Do not send to Design as-is. One blocking item: §1 above — the proposal needs to explicitly account for `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (4001) and the `reauth_required` message, and name issue #32 the same way it already names #33, before Design starts building a two-state machine that may not have room for what #32 needs. This is a scope-boundary question, not a wording tweak, and it's cheaper to resolve now than after Design has committed to a mock built on the "no third value" claim as currently unqualified.

One non-blocking item: §2 — correct the grid's baseline state count from three to four (add `disconnected_voted`) and have Design state explicitly whether the staleness marker composes with, or is suppressed by, the existing "ready despite disconnection" treatment.

Everything else — the three verbatim carry-forwards, the OR-2.2/OR-3.5/OR-3.6/OR-4.4 traceability, the gate language, the Open Design Questions — is proposal-ready.
