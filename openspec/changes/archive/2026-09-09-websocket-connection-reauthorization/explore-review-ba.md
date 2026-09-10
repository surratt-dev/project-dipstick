# BA Review: Exploration Notes — websocket-connection-reauthorization (SEC-25/SEC-26)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion), GitHub issue #27
**Lens:** Are these ideas specific enough to carry into a proposal without a round-trip back to me or Devon? Where would the implementation team hit "what did you mean by this?"

Overall this is a strong exploration document — it's grounded in the actual code (not the archived design's description of it), it correctly keeps design-stage decisions (one heartbeat vs. two) out of scope, and it does the traceability work I care about most: every constraint is tied back to a BRD line or an existing code precedent. My concerns below are about a handful of places where that same discipline stops short of a testable acceptance condition, plus one scope question and one gap I don't think the document knows it's missing.

---

## 1. Genuine gap: "role" re-check is missing from the document's own framing

This is my biggest finding. The document consistently describes SEC-25 as a **membership** re-check — every mention of the mechanism (Grounded-in-code section, the core tension section, the ritual section, the open questions) talks about `team_memberships.removed_at`. "Role" appears nowhere in the document's own prose, even though:

- The task that spawned this exploration is titled "idle-connection membership/**role** re-check."
- The already-shipped SEC-25 spec requirement this document is building on (`openspec/specs/websocket-session-authorization/spec.md`, lines 109–131, 235) is explicit that periodic re-authorization must catch a **membership or role change**, and specifically calls out the dual-signal EM check as load-bearing: EM status must be evaluated from *both* `users.global_role` and `team_memberships.role`, independently, because either alone is sufficient to revoke live-session access, and a promoted user's `session_participants` row is **not** deleted, so row-existence isn't sufficient either.

The document's reuse argument (bullet 5 of "Grounded in what's actually built today" — reuse `evaluateSessionSubscriberAccess`/`evaluateTeamAccess` verbatim) probably already covers this correctly, since those functions presumably encode the same dual-signal check the delivery-time path uses. But the document never says so, and its own prose elsewhere narrows the problem to "membership." That's exactly the kind of gap that produces a periodic sweep that's tested against a `removed_at` scenario and never against an EM-promotion-mid-connection scenario, because nobody who wrote the acceptance scenarios was told to think about role.

**Suggested rewrite:** add one line to the "Grounded in what's actually built today" section: *"The periodic sweep must re-derive EM status from both `users.global_role` and `team_memberships.role`, independently, exactly as the delivery-time check does — this is not new scope, since `evaluateSessionSubscriberAccess`/`evaluateTeamAccess` already do this, but it needs to be named so whoever writes acceptance scenarios includes an EM-promotion case, not only a removed-membership case."*

---

## 2. Vague → needs to become a Design-stage decision, not stay an open question: in-flight client state (Open Question 5)

Open Question 5 asks whether "session state must not be corrupted by the disconnection" (BRD SEC-26) reaches client-side in-flight state — e.g., a vote composed but not yet locked in — or is purely about server-side session-store integrity.

I don't think this can stay an open question carried into tasks.md. The ritual section of this same document names the exact failure mode I care about most as a BA on this project: *"a participant getting silently dropped right as they're about to lock in a vote."* That's not a hypothetical edge case for me — it's adjacent to the same simultaneous-reveal integrity concern that shaped the original requirements. If a silent token refresh can blow away an in-progress, uncommitted vote entry with no server-side record of it, that's a UX and ritual-trust failure, not just a technical nuance, and it needs a stated answer before proposal, not a footnote for whoever writes tasks.

**Suggested rewrite:** promote this out of "Open questions for whoever picks up Design" into its own named decision, at the same tier as the one-heartbeat-vs-two tension already gets. Concrete acceptance condition to propose: *"GIVEN a participant has composed but not submitted a vote, WHEN a silent token refresh completes (successfully or not) mid-connection, THEN the client's composed-but-unsubmitted vote value is not lost and the participant is not forced to re-enter it."* If the answer turns out to be "this is purely a server-side session-store guarantee and client-side draft state is explicitly out of scope," that's fine — but it has to be a stated decision with a reason, not silence.

---

## 3. Vague: the disclosure/non-disclosure line is well-argued but has no acceptance condition yet

The distinction the document draws — SEC-25 revocation closes must stay indistinguishable (reuse `STALE_SIGNAL_CLOSE_CODE`), SEC-26's own-token-expired case is a legitimately disclosed signal — is the right call and clearly reasoned. But as written it's a principle, not something an implementer or a test can check against. Two things are missing:

- What the client actually receives for the SEC-26 "please re-authenticate" case (a distinct WS message type? a specific close code other than 4000? something sent before close?) is undefined here — reasonably, since that's named as Priya's UX call. But the document should still state the **constraint** on whatever she designs: this signal must be structurally incapable of being sent on a SEC-25 revocation path. Not just "shouldn't be," but a statement of what would make that impossible to mix up (e.g., the two code paths must not share a single "send re-auth signal" function that both closes call into with different flags — if they do, someone can flip the wrong flag).
- A concrete negative acceptance scenario is missing: *"GIVEN a connection is closed because SEC-25 revoked membership, THEN the client receives `STALE_SIGNAL_CLOSE_CODE` (4000) and nothing else — no SEC-26 re-auth-required signal is sent, sent-then-withdrawn, or otherwise observable on this path."*

**Suggested rewrite:** add this as an explicit acceptance condition, not just prose in the ritual section, so it survives into the spec deltas as a testable scenario rather than a stated intention.

---

## 4. Vague: "no less frequent than once per token expiry window" needs a stated interpretation, not just a missing number

Open Questions 2 and 3 correctly flag that the interval and grace-period *numbers* are undefined and need to come from OIDC config rather than be invented. Agreed, and good that the document doesn't try to invent them under pressure. But there's a second ambiguity here that isn't about the missing number — it's about the BRD phrase itself. "No less frequent than once per token expiry window" could be read two ways: (a) the check interval must be **shorter than or equal to** the token-expiry-window duration (check at least once per window), or (b) the interval simply can't exceed the window, with no stated floor on how much shorter it should be. I read it as (a), and I think that's the only sensible reading, but the document should say so explicitly rather than let each future reader re-derive it. This is a one-line fix but it's exactly the kind of "accurate but ambiguous" phrasing that generates a clarification round-trip later.

**Suggested rewrite:** add to Open Question 2: *"Reading adopted: the check interval must be ≤ the token-expiry-window duration (i.e., 'at least once per window'), not merely 'no longer than one window.' State this explicitly in design.md so it isn't re-litigated."*

Separately: unlike the interval (genuinely needs an OIDC-config lookup), the SEC-26 grace period has an existing precedent in this codebase (`REFRESH_RETRY_DELAY_MS` and the retry-then-kill pattern in `middleware.ts`). I'd push back gently on treating both numbers as equally open — the grace period could reasonably get a strawman value in design.md derived from that existing constant, rather than being left as open as the interval, which has no equivalent precedent to derive from.

---

## 5. Scope question the document doesn't resolve: team-scoped connections, not just session-scoped

`ConnectionRegistry` is described as holding both session-scoped and team-scoped sockets, and `evaluateTeamAccess` is named as one of the two authorization functions the sweep should reuse. But every narrative example in the document — the quiet lobby, the participant about to vote — is a session-scoped scenario. Nothing in the document states plainly whether the periodic SEC-25 sweep is meant to run against team-scoped (dashboard/trend-view) connections too.

I don't think this is a hard call — BRD SEC-25 says "the connected client" without qualifying by connection type, and a team-scoped dashboard viewer sitting on stale team membership is exactly as real a gap as a quiet session lobby. But since the document's examples all skew toward session-scoped, an implementer reading quickly could reasonably (and wrongly) conclude the sweep only needs to cover session lobbies. Say it directly.

**Suggested rewrite:** one line in "Grounded in what's actually built today": *"The periodic sweep is in scope for both session-scoped and team-scoped connections in the registry — a stale team-scoped dashboard viewer is the same SEC-25 gap as a stale session lobby, not a separate concern."*

---

## 6. Minor, not blocking: facilitator-specific blast radius isn't addressed

Not a documentation defect, more a note for whoever picks up Design, consistent with how much this project's requirements lean on the facilitator view being a distinct control surface from the participant view: if a facilitator's connection is the one that gets force-closed by a SEC-25 revocation or a SEC-26 grace-period expiry mid-session — say, mid-reveal — the blast radius is session-wide, not personal, in a way a participant's dropped connection isn't. The document treats "the ritual" uniformly across roles in its ritual-impact section. I'm not asking for this to be solved here — it may well be legitimately out of scope for this effort and belong to a facilitator-continuity concern elsewhere — but it should at least be named as a considered-and-deferred item rather than not mentioned at all, given how central the facilitator/participant distinction is to the rest of this project's requirements.

---

## What's already solid (no rewrite needed)

Calling these out because they're good acceptance-condition material as written, and I don't want them lost in a list that's otherwise mostly gaps:

- **"Must not become admin-configurable"** — concrete, testable, correctly tied to the existing no-manager-rule precedent.
- **"A successful token refresh must not reset the 90-minute absolute-lifetime clock"** — concrete, testable, and correctly flags the specific plausible bug (conflating with `session.touch()`'s sliding-TTL behavior) rather than stating the constraint abstractly.
- **The reuse argument for `evaluateSessionSubscriberAccess`/`evaluateTeamAccess`** — this is exactly the kind of "no third implementation" constraint I'd otherwise have to add myself in review; good that it's already explicit.

---

## Summary of asks before this moves to Design/Propose

1. Add the role/EM-check dimension explicitly (Section 1) — currently only "membership" is named.
2. Promote the in-flight vote/client-state question (Open Question 5) from an open question to a stated Design-stage decision with a concrete acceptance scenario.
3. Turn the disclosure/non-disclosure principle into a testable negative scenario (Section 3).
4. State the adopted reading of "no less frequent than once per token expiry window" explicitly (Section 4).
5. State explicitly whether team-scoped connections are in scope for the SEC-25 sweep (Section 5) — I believe yes, but the document should say so.
6. Note the facilitator-blast-radius question as considered-and-deferred, even if not solved here (Section 6).

None of these are large — they're each a sentence or two — but each one is a place where the current phrasing would send an implementer back to Devon or me with a clarifying question, which is exactly the round-trip this stage exists to prevent.
