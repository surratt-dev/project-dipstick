# Propose-Stage Review: session-timeout-continuity (#133)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `proposal.md`, `design.md`, and the four delta/new specs in `specs/`

## Bottom line

The scope split I asked for at explore stage made it into the proposal intact: (a) close-code fix + return-to + facilitator copy fix + facilitator-reconnect indicator, shippable now; (b) full state-restoration verification against OR-1.7, explicitly out of scope pending the live-voting UI. Nothing I flagged got silently dropped, and nothing outside that scope drifted in (OQ-2(a)/(c), the pre-expiry warning, D9's rendering mechanism — all correctly left alone). The delta specs are unusually precise for this stage: nearly every requirement carries WHEN/THEN scenarios I could hand to an engineer without translation.

Two things need fixing before this moves to implementation: **one factual citation error repeated four times across the artifacts**, and **two of my own explore-review acceptance conditions that never made it into tasks.md as checkable work**, even though nothing in the proposal disputes them.

## Requirements accuracy check (NFR-AUTH-005, OR-1.7, SEC-26, FR-4.5)

- **NFR-AUTH-005, OR-1.7, SEC-26** — verbatim quotes in design.md and proposal.md all check out against `requirements/BRD.md` lines 469, 369, and 598 respectively. No correction needed.
- **FR-4.5 — mis-cited, four times.** `proposal.md:11`, `design.md:65`, and `specs/websocket-staleness-signal/spec.md:7` and `:51` all attribute "facilitators never vote" to FR-4.5. FR-4.5's actual text (BRD.md:256) is: *"The facilitator's view during the voting phase shall display a readiness grid showing who has locked in versus who has not, by name. The facilitator's view shall not reveal individual vote values or the aggregate score before the reveal is triggered."* That requirement governs **non-disclosure of votes to the facilitator's view** — it says nothing about whether a facilitator is eligible to cast one.

  The underlying claim — facilitators don't vote — is true and well-supported (BRD.md:73's ritual narrative: "A facilitator from outside the team walks engineers through... each participant votes"; `entities-and-relationships.md`'s Facilitator relationship list, which includes "leads," "captures results in," "identifies," "prompts" but never "casts"). But there is no single hard requirement ID that states it directly. **Fix:** either cite the ritual-definition narrative (BRD.md:73) plus the entity relationships instead of FR-4.5, or — better, since this proposal is the first place a facilitator/participant distinction is being encoded into a formal, testable acceptance condition — flag to me that a hard requirement stating facilitator vote-ineligibility doesn't exist as a citable ID, and I'll add one. I'd rather close that gap now than have a future reader trace FR-4.5 and find it doesn't say what four documents claim it says.

## Capability-by-capability: specific enough to implement?

**`reauth-return-to`** — Yes. All four requirements have concrete WHEN/THEN scenarios (valid path accepted, non-allow-listed path silently dropped, scheme/authority-bearing value rejected, join-token precedence, single-use `getdel`, destination's own authorization still runs). The one deliberately open item — the complete allow-listed path set beyond `/session/:id` and `/team/:id` — is correctly *not* left vague in the spec; it's pushed to `tasks.md` 2.1 as a concrete pre-implementation confirmation step against `executeJoinFlow`'s existing redirect construction. That's the right way to handle a genuine unknown: named, owned, and gated before code lands, not hand-waved.

**`facilitator-reconnect-indicator`** — Yes, and this is the tightest of the four. Cause-blindness is stated as a hard requirement with its own scenario (payload contains only the boolean, across all three trigger causes), the authorization reuse is explicit (no new check), and the "exactly one consumer, `connectionHealth.ts` untouched" constraint has its own inspectable scenario. Nothing implicit here.

**`websocket-session-authorization` (MODIFIED)** — Mostly yes. The close-code scenarios are unambiguous and testable (tasks 1.4/1.5). One gap, carried over from my explore review and not addressed here — see "Acceptance conditions" below.

**`websocket-staleness-signal` (MODIFIED)** — Yes, with the FR-4.5 citation fix above. The `returnTo` CTA scenarios are explicit about what's permitted (one query param, current path + query only, never origin/cause/state) and what isn't. The vote-loss conditional correctly reduces to "a single checkable fact" (the `voteDraft.ts` grep test) rather than a judgment call — this is exactly the kind of precision I asked for at explore stage so nobody has to come back to me asking what "as appropriate" means. There is no "as appropriate" anywhere in these four specs, which I want to note as a positive, not just an absence of a problem.

## Acceptance conditions: two from my explore review didn't land

My explore-stage review (`explore-review-ba.md`, "Acceptance conditions by scenario") gave five scenario-level conditions. Checking each against `tasks.md` and the specs:

1. **Facilitator timeout mid-vote, pre-reveal** — close-code half is covered (tasks 1.4, 1.6). **The second half is missing**: I wrote "the topic must remain in the voting phase — no reveal, no auto-advance — until the facilitator completes re-auth and rejoins." Nothing in `tasks.md` or either delta spec asserts or tests this. I don't think anyone disagrees this should hold — it falls out of existing FR-4.1/OR-1.4 behavior being unchanged — but "unchanged behavior" is exactly the kind of assumption that should get one explicit confirmation task, not be left to fall out of the fact that nobody touched that code path. **Recommend adding to tasks.md §1:** a test or manual check confirming a topic does not advance or auto-reveal while its facilitator's connection is in `unknown-reconnecting`/`reauth-required`.
2. **Facilitator timeout mid-reveal (after commit, before all clients confirm)** — my condition was explicitly "confirm, don't newly build, that the reveal completes for all other clients regardless of the facilitator's own connection state." **Also missing from tasks.md.** Same category of gap as #1 — a one-line confirmation task, not new work, but currently absent.
3. **Participant timeout mid-vote** — covered. The close-code fix is connection-level, not role-gated (confirmed in the spec text: "the scheduled absolute-lifetime force-close," no role qualifier), so it applies to participants and facilitators alike. Task 1.4's assertion is generic enough to cover this.
4. **Participants when the facilitator drops** — fully covered by `facilitator-reconnect-indicator` and tasks.md §4.
5. **HTTP-side 401 parity** — resolved, not silently defaulted. `design.md`'s Open Questions section states the scope call explicitly (WS-side only, "on the grounds that a live session runs over WebSocket, not HTTP polling") and names it as a call for a future reviewer to revisit if they want parity in a follow-up. That's exactly the "attributed, not implicit" framing I asked for.

Items 1 and 2 are small — likely one added bullet each to `tasks.md` §1 — but I'd rather they land before implementation starts than get discovered as a gap during review, which is the exact pattern I flagged as a risk at explore stage ("edge cases discovered late become scope disputes").

## Vague language check

None found. I grepped both documents and all four specs for hedge words ("as appropriate," "reasonable," "TBD," "should," "might") — the only "should" hits are in `design.md`'s own Migration Plan and Open Questions sections (deploy-ordering guidance and a note to `tasks.md` to confirm route shapes), not inside any normative requirement text. Every `SHALL`/`SHALL NOT` requirement in the four specs is paired with at least one concrete WHEN/THEN scenario. This is implementation-ready prose, not aspirational prose.

## Recommendation

Approve pending two fixes, both small:

1. Correct the FR-4.5 citation in `proposal.md:11`, `design.md:65`, and both hits in `specs/websocket-staleness-signal/spec.md` — cite the ritual narrative/entity relationships instead, or ask me to add a proper requirement ID.
2. Add two confirmation tasks to `tasks.md` §1 (topic-stays-in-voting-phase during facilitator reauth; reveal-completes-regardless-of-facilitator-connection for the mid-reveal case) — both are "confirm unchanged behavior," not new engineering, but both were explicit acceptance conditions I gave at explore stage and neither is currently checkable against this task list.

Everything else — scope boundaries, the four capabilities' testability, the requirements citations other than FR-4.5, and the deliberate narrowing of the two MODIFIED security-relevant requirements — is ready to build against as written.
