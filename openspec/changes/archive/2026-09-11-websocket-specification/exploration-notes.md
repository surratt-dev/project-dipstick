# Exploration Notes — WebSocket Specification (issue #24)

**Explorer:** Devon Calloway, Internal Champion / Principal Engineer, founding advisor
**Change:** `websocket-specification`
**Mode:** explore (no code, no application changes — this document is thinking, not the deliverable)

---

## Why I'm looking at this personally

This one landed on my desk because it isn't really a documentation task. Documentation tasks are "write down what we built." This is closer to "write down what we *meant*, and check whether what got built still matches it." Those are different jobs, and the second one is the one I actually care about.

The reveal is the single mechanic the whole ritual depends on. Simultaneous, server-triggered, no partial visibility, no ordering leak. If the WebSocket layer gets that wrong — even in a way that's invisible in a two-person demo — the ritual stops being honest and nobody notices until someone anchors on someone else's vote and the trust erodes quietly. That's exactly the kind of drift I don't get to see happen in real time, because I'm not in the room for sprint ceremonies anymore. A spec document is one of the few remaining points where I (or anyone after me) can catch it before it ships.

So my working question for this exploration isn't "what should the WebSocket spec say." It's: **does the code that already exists actually do what FR-4.6/4.6.1 and the ritual require, and if the spec is written after the fact, will it describe reality or paper over a gap?**

---

## The uncomfortable discovery: this is not a greenfield spec

I went into this expecting to write a forward-looking design document — payload shapes, lifecycle diagrams, the usual. What I found instead is that **most of the real-time layer is already built, tested, and shipped**, across five separate changes that each solved one slice of the problem:

```
websocket-session-authorization        → delivery-time authz for 4 content-access events
websocket-connection-reauthorization   → SEC-25/26/27 idle sweep + silent token refresh
websocket-staleness-signal             → client-side connection-health state machine
vote-compose-recovery                  → draft vote persistence across reload
session-lifecycle-transitions          → the actual reveal/advance writes + WS fan-out wiring
```

None of these five changes is the WebSocket Specification issue #24 asked for. Issue #24 is *older* — it's a todo.md item that's been sitting open since the REST API Contract validation pass, and in the meantime the FSE and SA went ahead and built the real-time layer piecemeal, informed by scattered proposal/design docs rather than one consolidated spec. The document this issue wants was supposed to be a **gate** ("real-time layer implementation cannot begin until this document is approved" — issue text, and todo.md verbatim). The gate didn't hold. Implementation happened anyway, issue by issue, and now the spec is being asked to catch up to production code instead of preceding it.

That changes what "success" looks like for this change. This is not "design the WebSocket layer." It's **"write the spec that reconciles what five separate changes each partially decided, and use that reconciliation to find out whether FR-4.6.1 — the one HARD requirement this issue exists to protect — is actually satisfied."**

It is not. More on that below.

---

## Finding 1 (the one that matters most): FR-4.6.1's `serverTimestamp` does not exist anywhere in the shipped payload

FR-4.6.1 is `[HARD]`. It is the single most specific thing this issue's "must specify, at minimum" list calls out by name. I traced the actual reveal payload all the way through:

```
packages/shared/src/types/realtime.ts
  VoteRevealedTriggerPayload   { sessionId, sessionStatus }              ← internal Redis envelope
  VoteRevealedPayload = ParticipantContentView | FacilitatorContentView  ← what the client receives

packages/backend/src/realtime/vote-revealed-payload.ts
  buildVoteRevealedPayload() → serializeForFacilitator / serializeForMemberParticipant
```

Neither the internal trigger payload nor the per-recipient serialized payload carries a server-generated timestamp field. I grepped the whole shared/backend/frontend tree for `serverTimestamp` and for any latency-calculation code on the frontend — nothing. The only timestamp in the neighborhood is `revealedAt`, and that lives exclusively in the `already_revealed` error-state response (`team-content-access.ts`), not in the `vote_revealed` event payload itself, and it's not documented anywhere as satisfying FR-4.6.1's obligation.

So: the reveal event ships today, in tested production code, without the field the BRD calls HARD and without which there is no way for a client to compute delivery latency or for monitoring to catch a violation of the 15-second SLA. Nobody is currently *measuring* whether the ritual's simultaneity guarantee holds in production. That's not a paperwork gap — that's the actual protective mechanic (FR-4.6, "no participant sees any vote before the facilitator triggers reveal, and it happens for everyone at once") running unverified.

I want to be precise about why this happened, because it's not sloppiness — it's exactly the failure mode a missing spec produces. `websocket-session-authorization`'s "Cross-recipient delivery skew" requirement (its own spec, which I read in full) requires *measuring* skew across fan-out recipients and checking it against a documented budget — but that requirement is about *authorization-check-plus-send* latency across the server's own fan-out, not about *end-to-end client-observed* latency from a server timestamp, which is what FR-4.6.1 actually asks for. Two different, complementary latency guarantees; only one of them got built, and it's the one that doesn't come with a BRD line number attached to a specific field name. The dedicated WebSocket Spec document is exactly the artifact that would have forced someone to check both against the BRD side by side and notice one was missing. It didn't exist, so nobody did.

**This should be treated as a live gap, not a documentation nit.** My recommendation for the proposal stage: this change should either (a) specify the field and hand off a small, scoped implementation task to add it (this is a one-field addition to an existing serializer path, not a redesign), or (b) if that's out of scope for a docs-only change, escalate it explicitly as a blocking finding rather than silently describing the current payload as-is and normalizing the gap. I will not sign off on a spec that documents the current `vote_revealed` payload as compliant with FR-4.6.1 when it isn't.

---

## Finding 2: the event *names* in every prior document are wrong, and the spec has to pick a side

The issue text, todo.md, and the REST API Contract's Appendix D all use dot-notation names: `reveal.trigger`, `vote.submit`, `topic.advance`, `vote.locked`, `session.revealed`, `topic.advanced`, `participant.joined`, `participant.left`, `actionitem.created`, `actionitem.updated`.

The actual shipped code uses a completely different, already-settled vocabulary:

| Appendix D / issue name | What's actually implemented | Where |
|---|---|---|
| `reveal.trigger` | **Not a WebSocket message at all.** It's `POST /api/v1/teams/:teamId/sessions/:sessionId/reveal` (REST), which writes the state transition, and only *after* commit publishes `vote_revealed` | `facilitator-sessions.ts`, `websocket-session-authorization` spec |
| `vote.submit` | **Not WebSocket.** Appendix D explicitly says vote submission is "WebSocket only — no REST trigger," but the real endpoint is `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in` (REST). Lock-in triggers `vote_readiness_update` as a *notification*, not as the submission mechanism | `sessions.ts` |
| `vote.locked` | `vote_readiness_update` (facilitator-only, identity + readiness, never the vote value) | `websocket-session-authorization` spec, `ws-event-dispatcher.ts` |
| `session.revealed` | Folded into `vote_revealed` | ditto |
| `topic.advance` (trigger) | `POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance` (REST, `SESSION-012`) | `session-topic-lifecycle` spec |
| `topic.advanced` (broadcast) | `topic_history_update` (team-scoped, not session-scoped — this is a registry/channel distinction the old naming doesn't even hint at) | ditto |
| `participant.joined` / `participant.left` | **Does not exist.** No WS event fires on lobby join/leave anywhere in the codebase I can find. FR-2.5 (real-time lobby participant list) is `[PREF]`, not `[HARD]`, which may be why it slipped, but it's still an unimplemented "must specify" item from this very issue | — |
| `actionitem.created` | **Does not exist.** No creation broadcast found. | — |
| `actionitem.updated` | Partially subsumed by `topic_history_update`'s `action_item_finalized` updateType, but that only fires at wrap-up finalization — FR-3.3's requirement that pre-session review status changes ("Open → In Progress") broadcast live to other participants does not appear to be wired to any WS event I could find | — |

This is the second reason this can't be a transcription exercise. If I write the spec by copying Appendix D's table, I will be publishing a document that is wrong about roughly half its own content on day one — and worse, wrong in a way that contradicts already-shipped, already-tested code, which is exactly the kind of authority-drift I'm supposed to be the check against. The spec has to describe what's real, name the two genuinely open gaps (`participant.joined`/`left`, `actionitem.created`/live `actionitem.updated`) as *open scope* rather than *already covered*, and correct Appendix D and todo.md's language rather than inherit it silently.

**Citation correction (Marcus's review caught two precision gaps here, both fixed):** the table above cites `websocket-session-authorization` as a source. That's the **capability spec name** (`specs/websocket-session-authorization/spec.md`), and it lives inside the archived change directory `2026-09-07-websocket-delivery-time-authorization` — the change-directory ID and the capability-spec name genuinely differ, not just by a stripped date prefix. Likewise, `session-topic-lifecycle` (cited for `SESSION-012`/`topic.advance`) is a second capability spec living inside the `session-lifecycle-transitions` change directory, not an undisclosed sixth source change. The proposal should state once, explicitly, that this document draws on five archived change directories, one of which (`session-lifecycle-transitions`) contains two capability specs (`session-lifecycle-transitions` and `session-topic-lifecycle`, both in scope for citation), and should cite capability-spec names consistently while noting the one directory/capability name mismatch (`websocket-delivery-time-authorization` → `websocket-session-authorization`) so a reader searching the archive by capability name doesn't come up empty.

---

## Finding 3: this document's job is narrower than it looks, and that's a feature

Reading `websocket-session-authorization/spec.md` in full, it already covers — thoroughly, with scenarios and a stated non-goal boundary — every content-access authorization question for the four events it names. `websocket-connection-reauthorization` covers the SEC-25/26/27 lifecycle machinery in comparable depth. `vote-compose-recovery` covers reconnection-safe draft state.

So this change's job is **not** to re-litigate authorization, reconnection, or token refresh — those are done, reviewed, and I have no quarrel with them (the delivery-time-check discipline in `ws-event-dispatcher.ts`, the disclosure-blind close codes, the per-pod concurrency discussion — all of that is exactly the kind of rigor I'd want, for what it's worth as an outside opinion). This change's job is to be **the connective document that was supposed to exist first**: the one place that lays out the full event catalog, the envelope shape, the connection lifecycle end to end, and error handling as a *coherent whole*, pointing into the specialist specs rather than duplicating them, and — critically — closing the one substantive gap (`serverTimestamp`) and naming the two open ones (`participant.joined`/`left`, live `actionitem.updated`) that none of the five specialist changes claimed as their own.

Practically, this suggests a shape for the coming proposal/spec stage:

```
websocket-specification (new capability spec)
├── Purpose: the whole-picture message catalog + lifecycle + error handling
├── Covers:
│    - Full event catalog with corrected names, one table, matching prod code
│    - Connection lifecycle (auth handshake → subscribe → delivery → close),
│      assembled from the 3 already-shipped mechanisms, cited not re-derived
│    - Error handling / close-code taxonomy (cites websocket-session-authorization's
│      non-disclosure requirement + websocket-staleness-signal's client state machine)
│    - The FR-4.6.1 serverTimestamp requirement — as a gap to close, with an
│      explicit requirement + scenario, not a description of current behavior
│    - The two missing events (participant.joined/left, actionitem.created/
│      live actionitem.updated) — scoped as either in-scope-to-build here or
│      explicitly deferred with an issue number, but not silently omitted
└── Does NOT cover (delegates by reference):
     - Delivery-time authorization mechanics (websocket-session-authorization)
     - Idle re-auth / token refresh (websocket-connection-reauthorization)
     - Client connection-health rendering (websocket-staleness-signal)
     - Vote draft persistence (vote-compose-recovery)
```

That "does not cover" list matters as much as the "covers" list. Every one of the five existing specs already has a hand-written non-goal boundary; the new spec should be the one place all five boundaries agree with each other, and I should sanity-check that they actually do (I didn't find a contradiction in what I read, but I also didn't read every scenario in `session-topic-lifecycle` line by line — worth a second pass at design time).

---

## Facilitator and participant experience pass (added per Priya's review)

Priya's review of this document landed a fair hit: everything above is written from the wire-protocol side — payload shapes, event names, REST-vs-WS routing — and never asks what any of it looks or feels like to the person running or attending a session. For a document whose actual job is to protect the ritual, not just the message catalog, that's a real gap, not a nice-to-have. I'm incorporating four of her five asks directly; I'm pushing back, partially, on the fifth.

**1. Connection health must reach the facilitator's readiness grid as a distinct signal.** Taking this on fully. The exploration above treated `websocket-staleness-signal` as a purely client-side, participant-facing concern. Priya's point is structural, not cosmetic: the readiness grid exists to reduce the facilitator's cognitive load by distinguishing signal from noise, and a silently-stale participant is indistinguishable from someone "still thinking" unless the tool says otherwise. That's the same category of problem FR-4.6/FR-4.7 solve for vote values — a signal that looks like something else isn't really being surfaced at all. **This becomes a spec requirement**, not just a review note: the catalog must state that connection-health state is a signal distinct from vote-readiness state, delivered to the facilitator view without being collapsible into or confusable with "still voting." `websocket-staleness-signal`'s own spec already builds a cause-blind state machine for the participant side; the new document's job is to state, as a cross-cutting requirement, that the facilitator's view consumes that same state machine's output as a third readiness-grid signal (distinct from "voted" / "not yet voted"), not a private client-side rendering decision left to whichever component happens to read it.

**2. Each recovery mechanism needs a stated visible-behavior answer, evaluated for mid-session disruption.** Taking this on fully — this is a real hole. For each of the three mechanisms, the spec needs an explicit answer to "what does the person see, if anything, while this is happening":
   - **Staleness signal:** already partially answered by `websocket-staleness-signal`'s own spec (a rendered treatment exists) — the new document should cite that treatment rather than re-derive it, and confirm it reads as informational, not alarming.
   - **Idle re-auth / token refresh (SEC-25/26/27):** the silent-refresh path is, by design, silent — no visible behavior, which is correct and should be stated as a requirement ("successful background refresh must not produce any visible state change"), not left implicit. The **forced-reauth** path is not silent — it's a full top-level re-login — and `websocket-connection-reauthorization`/`websocket-staleness-signal` already treat that as the `reauth-required` state with a generic rendered treatment. The new document should state plainly that this path is visible by necessity and point to the existing treatment rather than imply it's invisible.
   - **Vote-compose-recovery:** the spec should state that a restored draft reappears without requiring the participant to notice and re-enter it, and should confirm (by citing `vote-compose-recovery`'s own spec) whether restoration is silent or surfaces any indicator — whichever it is, it needs to be a stated behavior here, not left to be inferred from a capability spec's mechanics-only description.
   
   This doesn't require re-opening any of the three specialist specs' actual behavior — it requires this connective document to say, in one place, what each one produces on screen, so a reader can evaluate all three against the same "does this feel like the tool breaking" bar in one pass.

**3. Whether an SLA violation ever reaches the facilitator or session record — partial pushback.** Priya's question is legitimate and I don't want to wave it off, but I want to be precise about what FR-4.6.1 actually commits to before I write a spec requirement that goes further than the BRD does. The requirement text reads: *"Latency outside the 15-second bound must be surfaced in system monitoring."* That's it — the HARD requirement is a monitoring obligation, not a facilitator-visible or session-history obligation. Priya's instinct (a materially non-simultaneous reveal is a fact about that session's data quality, and the facilitator might reasonably want to know it happened, even after the fact) is a good one, and I don't disagree with it as a product idea. But it's a **new** requirement, not an interpretation of an existing one, and I don't think exploration notes for a docs-reconciliation change are the right place for me to unilaterally expand FR-4.6.1's scope — that's exactly the kind of quiet scope creep I'd object to if someone else did it to one of *my* constraints. **What I'm doing instead:** carrying this forward as an explicit open question for the proposal stage, addressed to the BA and facilitator SME jointly, rather than pre-deciding it here. If the answer is yes, it's a new acceptance condition on this change (or a follow-up); if no, that's a legitimate answer too, but it should be a decision someone made, not a gap nobody looked at. I'm not willing to have the spec silently promise session-history visibility that isn't in the BRD, and I'm equally not willing to have the spec silently foreclose it without anyone deciding.

**4. Error and close-code handling should carry the same non-spotlight principle as outlier flagging.** Taking this on fully, and I think it's actually a stronger point than Priya gave herself credit for. OR-2.4 already establishes, for outlier flagging, that the facilitator view "must communicate the statistical observation without visual treatment that prescribes a specific facilitation response or that would amplify discomfort for the flagged participant." A participant's connection dropping mid-topic is not the same event, but it's the same *shape* of risk: a system-generated signal that could, if rendered badly, turn a technical hiccup into a moment where the room's attention swings onto one person. **This becomes a stated principle in the new document's error-handling section:** connection and error states should be recoverable and low-drama by default — informative, not performative — extending OR-2.4's non-spotlight instinct from outlier flagging to connection/error UX generally. This doesn't change any of the three specialist specs' actual close-code behavior (all of it already reads as appropriately quiet, per Finding 3); it makes the underlying principle explicit and citable at the catalog level instead of something a reader has to infer separately for each spec.

**5. One-line acknowledgment on first-session UX — taking as written.** Priya's right that this doesn't need to become a scope item, just a pointer. Noting it here: connection/error UX during a team's *first* session — where an ambiguous reconnect banner is least likely to be correctly interpreted — is not being re-litigated by this change. If that ever needs dedicated attention, it's a future onboarding-experience change, not this one.

---

## Ritual-integrity invariants (revised per Marcus's review — named and traceable, not a personal checklist)

Marcus's review correctly called out that a list of things "I'll be checking the eventual spec against" only works as long as I'm the one checking. These need to be invariant statements *inside* the spec body, each traceable to the FR it protects, so any reader can verify them without knowing I exist. Restated that way:

| # | Invariant | Traces to | What the spec must state |
|---|---|---|---|
| 1 | **No pre-reveal vote value leak, anywhere in the message catalog.** | FR-4.6, FR-4.7 | A single cross-cutting statement, checkable against every event in the catalog table in one pass — not a property a reader has to reconstruct from independently reading `vote_readiness_update` and `vote_revealed`'s per-topic `reveal_status` gate. |
| 2 | **Simultaneity is measured, not assumed.** | FR-4.6.1 | See expanded definition below — this one was still underspecified even as a checklist item, and Marcus is right that "measured" needs an actual definition, not a gesture at Finding 1. |
| 3 | **Reconnection does not create a side door.** | FR-4.6, FR-4.7 | Stated plainly: "no reconnection payload includes another participant's vote or lock-in status before reveal," citing `session_registration_snapshot`'s self-disclosure-only design as the existing mechanism that already satisfies this. |
| 4 | **The facilitator's elevated visibility cannot see vote values pre-reveal.** | FR-4.6, FR-4.7 | Cite `VoteReadinessUpdatePayload`'s structural exclusion of vote value; state as a catalog-level invariant rather than a note buried in `websocket-session-authorization`. |
| 5 | **Nothing here is configurable.** | — (review guidance, not an FR) | Not an acceptance condition — I agree with Marcus that this is a watch-item for design-stage review, since nothing currently proposes an SLA toggle or similar. Carried forward as guidance for whoever reviews the design doc, not as spec text. |

**Invariant 2, expanded (per Marcus's review — this was the softest item in the original checklist):** "measured" needs to name the actual computation and its destination, not just assert that measurement happens.
- **Computation:** on receipt of the reveal event, the client computes `observed_latency = received_at − serverTimestamp` (both wall-clock, UTC), per FR-4.6.1's text ("clients must use this timestamp to calculate and log observed delivery latency").
- **Destination, in scope for this change:** the computed value is logged client-side and surfaced in system monitoring, per FR-4.6.1's literal text. That's the full extent of what the BRD currently commits to.
- **Destination, explicitly out of scope pending the open question above:** whether an SLA violation ever becomes visible to the facilitator or the session record is *not* decided by this invariant — see the pushback in the facilitator-experience section above. The spec should state the monitoring-only behavior as the baseline requirement and flag the facilitator-visibility question as a separately-tracked open decision, not fold an undecided product question into the invariant's definition.

---

## Open questions — resolved (per Marcus's review; these were too soft to carry into a proposal as personal leanings)

**1. Is closing the `serverTimestamp` gap in scope for this change?** Resolved: **build now.** Marcus is right that "I lean toward" isn't a decision two engineers can scope consistently against. This is a one-field addition to an already-identified serializer path (`vote-revealed-payload.ts`), the risk is low, and a spec that documents a HARD requirement as "not yet true, tracked elsewhere" for an indefinite period is exactly the kind of paper compliance I said in Finding 1 I wouldn't sign off on — leaving it as a deferred follow-up would contradict my own stated position. Acceptance conditions for the proposal:
   - The new spec contains a normative statement of the `serverTimestamp` requirement citing FR-4.6.1 by ID — not a description of current behavior.
   - The spec states plainly that the current shipped payload does **not** satisfy this requirement today (no "effectively satisfied" or "close enough" phrasing).
   - This change's task list includes the serializer addition itself, so the change closes the gap rather than only describing it.

**2. Are `participant.joined`/`left` and live `actionitem.updated` in scope to build, or to spec-and-defer?** Resolved: **spec-and-defer.** Both FR-2.5 and FR-3.3 are confirmed `[PREF]` (BRD.md lines 225, 237), and issue #24 was scoped from the start as a documentation deliverable, not an implementation ticket — pulling in two net-new WebSocket events, each with its own authorization/delivery/reconnection-safety design work, would blow past that scope and re-create the exact "spec catches up to code built under pressure" problem this change exists to fix. Acceptance conditions:
   - The spec documents both as normative future-state entries in the event catalog, each tied to its FR ID, each marked **NOT IMPLEMENTED**.
   - For each, the spec states either an existing follow-up issue number or, explicitly, "no follow-up issue exists; implementation is unscheduled" — I checked, and as of this writing no issue number exists for either. Silence is not an acceptable third option.

**3. Does anyone other than me need to bless the corrected Appendix D language?** Resolved: **no separate sign-off round — follow existing precedent.** `session-lifecycle-transitions` already established the pattern for this exact kind of correction: a dated, attributed note appended inline to Appendix D (the `reveal.trigger`/`topic.advance` correction at line 2947, and the `SESSION-005` correction at line 1270), with no new BA Validation Report cycle. This change should do the same — one consolidated, dated correction note covering `reveal.trigger`, `vote.submit`, `vote.locked`, `topic.advance`/`topic.advanced`, `participant.joined`/`left`, and `actionitem.created`/`updated`, in one place rather than six scattered edits. Marcus will review it for accuracy when drafted, the same role he played on the original Validation Report, but that's a review pass, not a sign-off ceremony — inventing one here would be inconsistent with how the last correction of this kind was actually handled. Additional acceptance condition: `todo.md`'s "WebSocket Specification" item is checked off and annotated with a pointer to the new spec, the way completed items elsewhere in that file already are.

**4. Cross-check non-goal boundaries against all five prior specs.** New task, added per Marcus's review — the "I didn't read every scenario in `session-topic-lifecycle` line by line" caveat from Finding 3 was a verification gap I was carrying forward as an unowned aside, which is exactly how a real contradiction slips through later. This becomes an explicit, owned task on the proposal's task list: cross-check the new catalog's non-goal boundaries against the stated non-goals in all five prior specs (`websocket-session-authorization`, `websocket-connection-reauthorization`, `websocket-staleness-signal`, `vote-compose-recovery`, `session-lifecycle-transitions`/`session-topic-lifecycle`) for contradiction, with a named owner and a checkbox — not a parenthetical in a finding.

---

## Where I landed

This is worth proposing. The reconciliation work alone — catching the `serverTimestamp` gap, correcting five documents' worth of stale event names against reality — justifies the change independent of whatever else the proposal stage decides to scope in. I'd rather this get written now, imperfectly, than continue to not exist while more capabilities get built against no spec at all.

Priya's and Marcus's review passes made this stronger without touching the substance I'd have refused to move on. Priya's asks add a facilitator/participant-experience dimension this document was missing entirely, and I've taken four of five on fully — the one place I pushed back (facilitator/session-history visibility of an SLA violation) is a real product question, but it's a new requirement, not a reading of an existing one, and I'm not the person who gets to decide that unilaterally in exploration notes. Marcus's asks were about converting soft leanings into buildable decisions, and I don't think any of them were wrong to ask for — a proposal built on "I lean toward" is a proposal that generates exactly the kind of mid-implementation Slack message he's trying to design out. Nothing in either review touched the structural constraints (no configurable SLA, no leaking vote values, the facilitator-from-another-team and no-manager rules that live outside this document's scope entirely) — those remain exactly as non-negotiable as they were before this review pass.
