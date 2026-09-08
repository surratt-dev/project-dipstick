# BA Review: WebSocket Delivery-Time Authorization Exploration

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, 2026-09-07), cross-referenced against `websocket-session-authorization/spec.md`, `BRD.md` SEC-25–SEC-28 (§10.6) and SEC-12–SEC-14 (§10.3), and archived `design.md` Decisions 5 & 6.
**Lens:** Is each idea specific enough to become a requirement the implementation team can build against without a round trip to ask "what did you mean"? Can a stated acceptance condition actually be tested, or does it still hide a judgment call?

**Bottom line:** The headline decision — `@fastify/websocket`, Redis pub/sub required in the fan-out path, per-connection check evaluated inside the local pub/sub handler immediately before `.send()` — is specific enough to build from. It names a library, names a mechanism, and gives code-reviewable criteria for detecting drift (Section 5's "is the check inside the message handler or cached at subscribe time" tell). That part earns the "not an open question" framing in Section 0.

Several things under that headline are not yet at the same standard, and two of them are exactly the sort of thing that turns into a scope dispute mid-implementation if they go into Design as-is: the two "adjacent gap" callouts (SEC-14, SEC-26) are named but not resolved into a traceable disposition, and the fallback's "specific number" is specific in form but not yet in substantiation. Details below.

---

## 1. Clarifications Needed

1. **Message envelope / channel topology is undefined.** Section 3's diagram shows a single channel, `ws:events`, carrying all four event types for every team and session. Nothing specifies the message schema (event type, `sessionId` vs. `teamId`, payload) that a pod's subscriber uses to decide whether it has any "local candidate connections" to check. Without this, two implementers building against this document could produce incompatible registries. Needs at minimum: one channel or many (per-team/per-session), and the field list every published message carries.

2. **Local registry lifecycle (register/deregister) is unaddressed.** The per-pod "local registry of which sockets it is currently holding" (Section 3) is described only as it exists at delivery time. What registers a socket into it (connection? subscription?) and what removes it (disconnect, explicit unsubscribe, both)? Without deregistration, a delivery-time check could pass for a socket that has already closed, and `.send()` would throw — an implementation detail, but one the delivery-time model depends on to be well-defined at all.

3. **SEC-25's periodic re-authorization guarantee is not the same requirement as SEC-27's revocation guarantee, and the exploration treats them as one problem.** BRD SEC-25 (line 596) requires re-authorization "at meaningful intervals — no less frequent than once per token expiry window," independent of whether any content event fires. Delivery-time checks (as designed here) only run when there is an event to push. A facilitator's connection that receives zero events for an entire token-expiry window (an idle pre-session lobby, a quiet stretch of a session) gets **zero** re-authorization checks under this design — the check is event-triggered, not interval-triggered. This is not the same gap as SEC-26 (token refresh mechanics), which the exploration does flag; this is a piece of SEC-25 itself that the "delivery-time is strictly superior to a timer" argument (Section 4) doesn't actually cover, because delivery-time and periodic-interval are answering different questions. Recommend: either (a) state explicitly that SEC-25 is satisfied *for connections that receive events* and is separately unaddressed for idle connections, tracked the same way SEC-26 is tracked, or (b) confirm a periodic heartbeat re-auth is still needed independent of delivery-time checks and fold it into this change's scope.

4. **Admin-grant handling for `topic_history_update` is unaddressed.** Section 6's per-event mapping says this event "maps directly onto the existing helper with no new query needed" — `evaluateTeamAccess`. But `evaluateTeamAccess` returns `{ path: 'admin' }` uniformly for Application Admin callers (design.md Decision 8), and Decision 2 requires that *session content* endpoints reject an `admin` grant with 403 while *administrative data* endpoints accept it — the helper itself doesn't know which kind of endpoint is asking. `topic_history_update` fires when "historical session data is updated (e.g., action items finalized)" — action items are named in BRD Constraint 1 as session content, restricted to team members, EM, and facilitator, not admins. If the WebSocket handler for this event doesn't replicate the HTTP handler's admin-grant rejection, an Application Admin who subscribes to a team's event stream gets action-item updates pushed to them with no authorization gate stopping it — recreating, over WebSocket, exactly the surveillance path Decision 2 closed over HTTP. This needs to be stated as an explicit requirement, not left implicit in "reuse the existing helper."

5. **Concurrency model for per-recipient checks within one pod is unspecified**, and it isn't just a performance question — it's an acceptance-testability question. Section 3's diagram says "for EACH local candidate socket: evaluateTeamAccess... RIGHT NOW," which reads procedurally but doesn't say whether these run concurrently or serially. Section 9's test plan asks for "per-event, per-candidate-connection latency" as if it's a single number, but that number means something different depending on which model is chosen. This should be a named Design decision with a stated worst-case local fan-out width, the same way the transport and fan-out mechanism were stated as decisions rather than left as details.

6. **SEC-14 audit-log granularity is not specified even as a question.** Section 7 correctly notices the gap between BRD SEC-14 (WebSocket events must be logged "with the same fidelity as HTTP requests") and the fact that neither the spec nor tasks.md Group 9 mention audit logging — but it doesn't ask the one question that determines the scope of the fix: **does "same fidelity" mean one audit_log row per triggering action (e.g., one row when a reveal is triggered, which presumably already happens via the HTTP/action-authorization path that triggers the reveal), or one row per delivered WebSocket push (i.e., a row per recipient who received `vote_revealed`)?** These have very different implementation costs and very different audit-log volumes, and BRD SEC-13's added clause — "WebSocket-originated events must additionally include the WebSocket session identifier" — only makes sense under one of those two readings. Propose needs this disambiguated before "close or defer" (Section 7's own framing) can be acted on.

7. **SEC-26 tracking has a rationale but no owner or destination.** Section 7 says the gap is "flagged as adjacent and out of scope for Group 9, not resolved, so it doesn't get assumed as covered" — that's a correct rationale, but it stops short of tracking. There's no named issue, no owner, no target change. A requirement this specific in the BRD (90-minute cap, silent refresh, defined grace period, "session state must not be corrupted") does not stay tracked by being mentioned in an exploration doc's prose; it needs a destination (a companion GitHub issue, or an explicit line in this change's own out-of-scope list with an owner) or it will be rediscovered later as a surprise, which is precisely the failure mode Marcus's role exists to prevent (see Success Criterion 4: "the requirements documents are the first place the team looks — not a Slack message to Marcus").

8. **The ~100ms figure in Section 9 has no traceable source.** Unlike the 60-second fallback bound (which at least traces back to design.md's own example), "the ~100ms threshold where UI feedback starts to feel delayed" is introduced here for the first time, unsourced, and immediately softened with "comfortably under." Either trace it to an existing UX/perf requirement (none of BRD, design.md, or the spec state it) or label it plainly as an engineering placeholder pending confirmation — don't let an unsourced number sit next to the rigorously-derived 60-second figure looking equally authoritative.

---

## 2. Vague Areas

- **"Comfortably under the ~100ms threshold" (Section 9, item 2).** No percentile, no sample size, no explicit pass/fail line. This is the same category of imprecision the document itself calls out as unacceptable elsewhere ("meaningful intervals... is not a decision," Section 1) — it should not survive into Design in this form. Decision 7's own precedent (95th/99th percentile under realistic load, not the mean) is sitting right there in the same design.md this exploration cites; Section 9 should adopt it explicitly rather than reverting to a soft qualitative bar for the *proof* of the very decision the rest of the document treats with numeric precision.

- **"Should either close or explicitly defer" (Section 7, SEC-14).** Section 0 states plainly that this document does not carry undecided questions forward — "a call that says 'we'll decide the transport later'... is not a call." The SEC-14 treatment is exactly that unmade call, just for a different requirement. If the standard set in Section 0 applies, it should apply here too: name a recommended lane (see Clarification 6 above) rather than handing Propose an open fork with no default.

- **"Sixty seconds is not an arbitrary 'reasonable-sounding' number — it's the figure I already proposed for this exact gap" (Section 8).** Continuity with a prior document is a reason the number won't surprise anyone; it is not a reason the number is *correct*. The original design.md itself introduced 60 seconds as an illustrative example ("e.g., 'no more than 60 seconds'"), not a derived or measured value. Reusing an example for consistency and asserting it as "not arbitrary" conflates two different properties. See Section 5 below for the fuller assessment.

---

## 3. Scrutiny: Is the transport/fan-out/delivery-check decision testable and specific enough?

At the level Section 0 claims to resolve — **which library, whether Redis pub/sub is required, and where exactly the check sits relative to the wire write** — yes. This is a genuine decision, not a placeholder:

- Library and rationale are named and falsifiable (Socket.IO's room-emit abstraction is named as the specific anti-pattern to avoid, with a mechanism, not a vibe).
- Redis pub/sub's necessity is derived from an existing, cited architectural commitment (`High-Level Architecture.md` lines 626/765), not asserted independently.
- The check's placement — "inside each backend instance's local pub/sub message handler, individually per local socket, immediately before that socket's `.send()` call" — is a code-reviewable claim. Section 5 goes further and gives the exact tell a reviewer would use to catch a regression (check called per-message vs. cached at subscribe time). That is about as testable as a design-level description gets before code exists.

What is **not yet** at that standard is the layer directly below it — the mechanics Design will need to actually build the thing without re-deriving decisions the exploration didn't make. Clarifications 1, 2, 4, and 5 above are the concrete gaps: message schema, registry lifecycle, admin-grant handling for the one team-scoped event, and concurrency model. None of these undermine the headline decision, but none of them are answered by it either, and a Design document that treats the headline decision as "fully specified" without addressing these will produce the exact ambiguity Section 0 is trying to avoid, one layer down.

**Recommendation:** carry the headline decision forward as resolved (agree with Devon's framing there). Do not carry forward the impression that Group 9 is now fully de-risked — Design still owes concrete answers to Clarifications 1, 2, 4, and 5, and those should be named as Design's remaining work, not rediscovered as surprises during Tasks.

---

## 4. Scrutiny: Are SEC-14 and SEC-26 properly scoped?

**SEC-26 (token expiry mid-connection):** Correctly identified as adjacent and correctly given a rationale for exclusion (it's a connection-lifecycle concern; the spec is scoped to the four content-access events). That much is "out-of-scope-with-rationale," which is the right shape. But rationale alone doesn't close the loop for a BRD-level security requirement this specific (90-minute hard cap, silent refresh, defined grace period, no corrupted session state) — it needs a **destination**: a tracked issue, an owner, and ideally a target relative to this change's ship date. As written, "flagging... not resolved" is a statement of awareness, not a disposition. I'd treat this as **not yet properly scoped** — it's one step short. The fix is cheap: name the tracking issue (existing or to-be-created) and an owner in the document that ships to Propose.

**SEC-14 (WebSocket audit logging):** This one is the weaker of the two treatments. It correctly identifies that a gap exists between the BRD and both the spec and tasks.md, and correctly declines to invent a fix inside an exploration document. But it doesn't get to "explicitly deferred with a stated owner" (the standard the task set), nor does it get to "in-scope with acceptance criteria" — it lands on "Propose should either close or explicitly defer," which is neither. Given that two of the four in-scope events (`vote_revealed`, `session_state_change`) are named verbatim in SEC-14's text, and given that this document otherwise refuses to hand forward undecided questions (Section 0), I'd flag this as the one place the document's own stated standard for itself is not met. **Recommendation:** Propose should resolve Clarification 6 (per-action vs. per-delivery audit granularity) and either write the resulting audit requirement into this change's acceptance criteria or explicitly move it to a named follow-up with an owner — not carry the fork forward unresolved.

---

## 5. Scrutiny: Does the 60-second fallback bound meet the spec's "specific numeric latency bound" requirement?

**Short answer: it satisfies the letter of the requirement, not yet the spirit, and the document's own contingency framing ("if, and only if... behind a documented load measurement") is honest about that — but the number itself deserves more scrutiny before Design treats it as pre-approved.**

The spec's actual bar (`websocket-session-authorization/spec.md`, Implementation status) is: *"a specific, documented latency bound; 'meaningful intervals' is not an acceptable specification."* Sixty seconds is unambiguously a specific number, not a phrase — on that narrow textual test, it passes.

Three things weaken it as a genuinely load-bearing bound, though, and Design should not inherit it uncritically:

1. **Provenance is continuity, not derivation.** The number comes from design.md's own illustrative example ("e.g., 'no more than 60 seconds'"), and the exploration's stated reason for keeping it is that the team has "already seen" it — a reason to avoid confusion, not a reason the number is fit for purpose. Nothing in either document derives 60 seconds from session characteristics (how much could a removed member see in 60 seconds of a live vote-in-progress session? Section 4's own argument — "a removed team member who keeps receiving `vote_revealed` events... for even sixty more seconds has, functionally, already seen data they should never have seen" — actually argues *against* 60 seconds being an acceptable number at all, which the document doesn't reconcile. It's presented as a contingency number while simultaneously being used as an example of an unacceptable exposure window.)

2. **No enforcement mechanism is described for the bound itself.** Decision 7's timing-floor precedent works because the floor is a value the application code directly controls (a `Math.max` applied to response time) and a guard can assert the constant equals the measured value. A 60-second revocation bound is not directly controlled the same way — it emerges from whatever scheduling mechanism implements the fallback (per-connection timer? periodic sweep across all connections?), and the exploration names neither. Without naming the mechanism, there's no way to state *why* 60 seconds — rather than 45 or 90 — is the actual worst case that mechanism produces. The "startup guard analogous to `timing-oracle.ts`" idea (Section 8) only guards that a configuration constant equals a chosen value; it does not verify the runtime mechanism actually bounds revocation latency to that value under load.

3. **No percentile or maximum-claim discipline.** "Maximum 60 seconds" is stated as an absolute, but nothing in Section 8 or 9 describes how a maximum (as opposed to an average or a percentile) would actually be verified. This is the same rigor gap as the ~100ms figure in Clarification 8 — the document holds itself to percentile-based, measured rigor for the primary decision and reverts to an assumed-good number for the contingency.

**Recommendation:** Keep the *contingency structure* as designed — a documented load measurement gates whether the fallback is invoked at all, which is the right discipline. But do not let 60 seconds itself be treated as pre-validated. If the fallback is ever invoked, Design should be required to (a) name the specific scheduling mechanism, (b) re-derive or re-confirm the bound against that mechanism's actual worst case under measured load, and (c) state the bound at a percentile, the same way Decision 7 requires for the timing floor — not carry 60 seconds forward by inheritance alone.

---

## 6. Suggested Rewrites

**Section 6 (per-event mapping table), add a row-level note for `topic_history_update`:**
> "The WebSocket handler MUST reject an `admin`-path grant from `evaluateTeamAccess` for this event, mirroring the HTTP session-content endpoint's rejection of admin grants under Decision 2. An Application Admin subscribed to a team's event stream MUST NOT receive `topic_history_update` pushes."

**Section 8, reframe the fallback number:**
> "If invoked, the fallback bound is a maximum of 60 seconds from the `team_memberships.removed_at` database commit to cessation of delivery, **at the p99 measured under the same load conditions used to justify invoking the fallback in the first place**, using the specific scheduling mechanism (sweep interval or per-connection timer, to be named in Design) that implements it. The 60-second figure carried from the original design.md example is a starting reference point, not a pre-validated bound — it must be re-confirmed against the chosen mechanism's actual measured worst case before being written into a production guard."

**Section 9, item 2, replace the qualitative target:**
> "Measure p95 and p99 authorization-check-plus-send latency per candidate connection under [N] concurrent sessions and [M] events/second (values to be set by Design based on realistic peak usage). Document the measured values. Pass condition: p99 latency does not exceed [X]ms, where X is derived the same way Decision 7's response-time floor was derived — from a measured distribution, not an assumed UI-perception heuristic."

**Section 7, SEC-14 paragraph, replace the open fork with a recommended default plus an explicit decision point:**
> "SEC-14 requires WebSocket events to be logged with HTTP-equivalent fidelity, and `vote_revealed`/`session_state_change` are named explicitly. Before Propose: confirm whether the underlying triggering action (e.g., the reveal action itself) is already audit-logged via its HTTP/action-authorization path — if so, this change's scope is limited to adding the WebSocket session identifier (per SEC-13) to that existing entry, not creating new per-recipient log rows. If the triggering action is not already logged independently of its WebSocket delivery, this change must add that logging as an in-scope acceptance criterion, not a follow-up."

**Section 7, SEC-26 paragraph, add a tracking clause:**
> "SEC-26 is out of scope for Group 9. Tracked as [issue/change reference — to be created if none exists], owned by [name], to be resolved [before/independent of] this change shipping to production."

---

## Summary for whoever picks this up next

- The headline transport/fan-out/delivery-time decision is specific and testable enough to build from — keep it as resolved.
- Four sub-decisions still need Design-stage answers before Tasks can be written without ambiguity: the pub/sub message schema, registry lifecycle, admin-grant rejection for `topic_history_update`, and the per-pod concurrency model for recipient checks.
- SEC-25's periodic re-authorization guarantee is not fully satisfied by an event-triggered delivery-time check alone (idle connections get no re-check) — this is distinct from the SEC-26 gap already flagged and should be named separately.
- SEC-26 is correctly rationale-scoped as out-of-scope but has no owner or tracking destination yet — needs one before this ships.
- SEC-14 is the weaker of the two "adjacent gap" treatments: the exploration names the gap but doesn't ask the one question (per-action vs. per-delivery audit granularity) that would let Propose actually close or defer it with confidence.
- The 60-second fallback bound is numerically specific enough to satisfy the spec's literal "not a vague phrase" bar, but its provenance (an inherited example, not a derived value) and the absence of a named enforcement mechanism mean it should not be treated as pre-validated if the contingency is ever invoked.
