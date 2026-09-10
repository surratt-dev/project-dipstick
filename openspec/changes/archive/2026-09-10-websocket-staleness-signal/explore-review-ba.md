# Explore-Stage Review — WebSocket Staleness Signal (BA)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, 2026-09-09)
**Against:** BRD OR-2.2, OR-3.5, OR-3.6, OR-4.4; originating gate tasks 9.1–9.3 in `archive/2026-09-07-websocket-delivery-time-authorization/tasks.md`

---

## Overall

This is a stronger-than-usual exploration doc, and I want to say that plainly before I start marking it up. Devon already did the thing I usually have to ask for twice: every claim traces back to a specific OR number, the ritual-integrity reasoning is stated as *why*, not just *what*, and the four gate bullets from 9.1 are answered one-for-one rather than summarized away. Section 2's three-way taxonomy of leak vectors (wording, timing, behavioral asymmetry) is exactly the kind of thing I want in a requirement, not left as an engineer's private mental model — it should survive into the proposal's requirement text nearly verbatim, because it's the difference between "don't disclose the cause" (unenforceable as written) and three independently checkable conditions.

That said, "well-reasoned" and "ready to become a requirement" aren't the same thing. A few places the notes correctly identify a risk but stop one step short of a testable condition, and one gap I don't think the notes see at all. Flagging both below so Propose isn't the stage that discovers them.

---

## 1. Gaps not surfaced in the notes (flag before Propose)

### 1.1 No state for "recovered" — the notes only define two states, but the participant experience needs a third

Section 5.1 defines `connected` and `unknown/reconnecting`. That covers going stale. It doesn't say what happens when a genuinely-flaky connection *comes back* — does the banner just silently disappear, or is there a "you're reconnected" acknowledgment? This matters for the same reason the rest of this document cares about symmetry: if a flaky connection gets an explicit "back online" confirmation and a revoked connection (which will never recover) just... sits there with a banner that never resolves, that asymmetry is itself informative once a participant has seen it happen twice. I don't think this needs a third *rendered* state — silently reverting to `connected` with no toast is probably the right, boring, disclosure-safe answer — but the notes should say so explicitly rather than leave it implicit. Reviewers coming after this document will assume unaddressed = undecided, not = decided-and-obvious.

**Suggested addition to the requirement:** "Recovery from `unknown/reconnecting` back to `connected` is silent — no distinct acknowledgment banner or transition treatment. This is deliberate: an explicit 'reconnected' event that only ever fires for the recoverable case would itself be the same disclosure this document exists to prevent."

### 1.2 Initial-connection failure isn't distinguished from mid-session staleness — should it be?

Everything in the notes is framed as a connection that *was* good and then went stale. There's a distinct case: a participant loading the session for the first time whose very first subscription attempt is rejected (never had a good connection to lose). Is that folded into the same `unknown/reconnecting` bucket and banner, or does "unable to join" need to be a different, allowed-to-be-different message? I think the notes' own logic argues it should stay in the same bucket — bullet (b) of 9.1 is literally "rejected subscription attempt," which is this case — but the notes don't say so in as many words, and an engineer building the state machine from scratch (Section 2 notes there's *no* prior frontend WebSocket code to pattern-match against) could reasonably build a separate "couldn't connect" path without realizing it collapses the same disclosure risk. Worth one explicit sentence.

### 1.3 Facilitator grid marker's lifecycle isn't specified

Section 5.3 says the grid gets a per-participant "last known state may be stale" marker. What the notes don't say: if that participant never reconnects for the rest of the session, does the marker stay in that state indefinitely, or does it eventually collapse into the existing `disconnected_no_vote` state the grid already has (per `redis-session-model.md`'s three-state model)? This isn't a nitpick — OR-2.2 caps the grid at "locked-in status... and nothing more," and a fourth persistent visual state that never resolves is a bigger footprint on that budget than a transient one. I'd want Design to state a TTL or fallback behavior for this marker, not leave it open-ended.

---

## 2. The five open questions — crispness assessment

### 2.1 Retry-strategy symmetry — **needs tightening before Propose**

The diagnosis is sharp (an asymmetric retry outcome is a leak even with identical banner text), but the question as written — "does retry itself risk exposing information... need the reconnection strategy specified" — is a research question, not yet a requirement. Propose needs a testable condition, not a question. I'd rewrite the deliverable this open question is pointing at as:

> **Acceptance condition:** The client's reconnection state machine must not branch on close-code value (4000 vs. raw network error/close) or on connection-attempt outcome type. Retry count, backoff schedule, and jitter must be identical code paths for both causes, verifiable by a test that forces both a 4000 close and a simulated network drop through the same handler and asserts identical retry timing.

That's buildable and testable. "Need the reconnection strategy specified" is not, on its own — it just restates that a decision is owed. Send it to Propose with the rewritten acceptance condition attached, not the bare question.

### 2.2 Timing floor — **crisp enough for Propose, with one caveat**

This one's in good shape: it names the exact precedent to reuse the *pattern* of (`CONTENT_TIMING_FLOOR_MS` / `timing-oracle.ts`), correctly declines to reuse the *module* (server-side, different purpose), and explicitly demands a number rather than "add some delay." That's the right level of specificity for Explore to hand off. The caveat: Propose should state the floor as a requirement ("a minimum floor exists, applied identically to both causes") even before Design picks the exact millisecond value — don't let the requirement wait on the number. The number is legitimately a Design-stage decision (it may need real latency data); the *existence and uniform application* of the floor is not, and should be locked in now so Design can't quietly skip it.

### 2.3 Readiness-grid marker design — **appropriately deferred, but needs a bound stated now, not just a wireframe request**

Correctly flagged as needing an actual mock rather than prose — I agree, "visually minimal" isn't something I can sign off on sight-unseen. But I don't want Design to fill that blank with total freedom either. Give Design a measurable constraint to design against, not just a request for a picture:

> **Acceptance condition:** The marker adds at most one new visual state to the grid's existing state set (today: connected+locked-in, connected+not-locked-in, disconnected+no-vote per `redis-session-model.md`). It must not introduce a distinct color/icon language beyond what the grid already uses for "disconnected." It is visible only in the facilitator view (OR-4.4) and carries no information that would let the facilitator distinguish "this participant is stale because of revocation" from "this participant is stale because of network flakiness" from "this participant hasn't reauthorized yet" (issue #33's case) — the marker is cause-blind, not just visually minimal.

That last clause matters and isn't explicit in the notes yet: the same disclosure discipline that applies to the participant-facing banner (§2 of the notes) has to apply to this marker too, and right now the notes only argue minimalism from an OR-2.2 "and nothing more" angle, not from the disclosure angle. Worth stating both.

### 2.4 Shared-component approach — **ready as-is, could be stated as a requirement now rather than an open question**

This is the crispest of the five. "One shared source of truth, committed now while there's only one caller" is a decision, not a question — the notes already argue for it and only frame it as "open" out of procedural caution. I'd promote it directly into the proposal:

> **Requirement:** A single client-side connection-health module is the sole implementation of the `connected` / `unknown-reconnecting` state machine, consumed by both the participant view and the facilitator grid. No second implementation may be built independently, including by issue #33's later work — #33 must consume this module, not fork it.

No further tightening needed here. Send as a requirement, not a question.

### 2.5 Priya's copy sign-off — **not a clarity gap, but flag it as a hard dependency in the proposal, not a footnote**

This isn't vague — it's a known, named blocker already gated at tasks.md 9.1/9.3 in the archived change, and the notes correctly don't try to resolve it themselves. My concern is procedural, not about the notes' precision: the proposal needs to carry the same teeth tasks.md 9.1/9.3 already has ("a filed draft that does not resolve all four bullets does not close this task... 'filed' and 'signed off' are not the same completion condition"), not soften it into an ordinary open question alongside the other four. The copy sketched in §5.2 ("Your view may be stale. Refresh to continue.") should be labeled in the proposal as a placeholder pending Priya's sign-off, explicitly not implementation-ready text, so nobody downstream mistakes a champion's sketch for an approved string. Suggest the proposal restate the 9.3 gate language directly rather than paraphrase it — this is one place where losing precision in translation would matter.

---

## 3. Traceability check

Ritual-relevant requirements this change touches, and whether the notes ground them correctly:

| Requirement | Notes address it? | Comment |
|---|---|---|
| OR-2.2 (readiness grid: locked-in status and nothing more) | Yes, §3 bullet 1 | Correctly treats the new marker as new information density that has to justify itself against this cap. See 2.3 above for making the bound concrete. |
| OR-4.4 (readiness grid is facilitator-only) | Yes, §3 bullet 1 | Correctly extends the audience restriction to the *stale/accurate distinction itself*, not just the underlying readiness value. Good catch — this is the kind of inference I'd otherwise have had to add myself. |
| OR-3.5 / OR-3.6 (simultaneous reveal, zero pre-reveal visibility) | Yes, §3 bullet 2 | Correctly identifies this as adjacent-not-identical: OR-3.5 covers the reveal event, this change covers connection-health visibility mid-session. The notes don't overclaim direct OR-3.5 coverage, which I appreciate — a sloppier document would have. |

No gaps in the OR traceability itself. My concerns above are about acceptance-condition precision, not about which requirements got cited.

---

## 4. Verdict

Send to Propose. Three of the five open questions (timing floor, shared component, Priya's sign-off) are already at or near proposal-ready — I've suggested tightened wording above that Propose should use largely verbatim. Two (retry symmetry, readiness-grid marker) need the acceptance conditions I've drafted in 2.1 and 2.3 folded in before Propose treats them as settled; as currently worded they're good diagnostic questions but not yet requirements a reviewer could check a design against. Also carry forward the three gaps in Section 1 (recovery-state silence, initial-connection-failure handling, grid-marker lifecycle) — none of them are hard, but all three are the kind of thing that becomes a scope dispute mid-implementation if nobody wrote down the answer now.
