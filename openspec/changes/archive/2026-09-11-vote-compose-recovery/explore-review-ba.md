# BA Review: Exploration Notes — vote-compose-recovery (issue #31)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion), GitHub issue #31
**Lens:** Are these ideas specific enough to carry into a proposal without a round-trip back to me or Devon? Where does the sequencing question need a firmer answer than "whoever picks up Propose should read this as a real question"?

This is a careful document and I don't think Devon is wrong about anything in it — the D4/D7 grounding is solid, the "what this is not" section does real scope-discipline work, and Section 4c's persistence constraints are exactly the kind of guardrail I'd otherwise have to add myself. My concerns are: (1) the sequencing question in Section 3 is named but not resolved, and I think it can be resolved rather than left as a judgment call for Propose; (2) several of the risk items in Section 4 are described richly in prose but don't yet have a testable acceptance condition attached; and (3) there's a consequence of "the UI doesn't exist yet" that the document doesn't draw out — it changes what an acceptance scenario can even mean at this stage, and the proposal needs to say so explicitly or the team will try to write E2E tests against components that don't exist.

I pulled the actual current state of `connectionHealth.ts` (`packages/frontend/src/realtime/connectionHealth.ts`) to ground point 1 below — it's more finished than the exploration's framing suggests, and that changes my recommendation.

---

## 1. The sequencing question (Section 3) — I recommend scoping this decoupled from #32, and I can make that concrete rather than a judgment call

Devon leans toward option (b) — "the persistence/restore mechanism and its contract, decoupled from exactly which component calls it" — but frames it as a preference the Propose author should weigh, not a settled scoping decision. I'd make it a settled decision, and I'd go a step further than Devon's framing.

Devon's stated dependency is that issue #31's hook point — "persist... before the re-authentication navigation begins" — has no `before` to attach to because nothing calls `window.location.href = "/auth/login"` on the `reauth-required` state yet (that's #32). That's true as far as it goes, but I think it's solving the wrong problem. A "persist right before navigation" design has a reliability question even once #32 exists: `window.location.href` assignment doesn't guarantee synchronous code after it runs to completion, and anything hung off `beforeunload`/`pagehide` to catch that moment is a well-known flaky pattern for anything that has to be correct 100% of the time (bfcache, mobile OS process kill, etc.). I don't think "flush on the way out the door" is the right shape for a mechanism that's supposed to protect a piece of ritual-integrity state.

**Suggested rewrite of Section 3's conclusion:** persist on every compose-value change (debounced or not — an implementation choice, not a requirements one), not as a one-shot write triggered by the navigation. This has two effects worth stating explicitly in the proposal:

- It removes the dependency on issue #32 entirely, not just "decouples" from it. There is no call site to hook into `window.location.href` for — the compose UI's own `onChange`/`onSelect` handler is the only integration point this change needs, and that's owned by whoever builds the compose UI, not by #32.
- It's actually more correct for the risk case Devon didn't name: an ordinary tab close or crash during the closed-fist moment, with no SEC-26 event involved at all, is already covered for free by a write-on-change design (`sessionStorage` survives a reload of the same tab regardless of why the reload happened) and costs nothing extra to support. A write-before-navigate design would only ever help the SEC-26 case Devon is scoping for.

I'd still keep the change scoped to "SEC-26 grace-period recovery" for the *why this matters* framing (that's the ritual-integrity story, and it's the issue this traces to) — but the mechanism itself shouldn't be built as something that only fires on that one path. State that distinction explicitly in the proposal so nobody reads "scoped to SEC-26 recovery" as "the persistence write is conditional on detecting SEC-26 recovery specifically." It isn't, and it doesn't need to be.

One correction to the document's own grounding, not a disagreement: Section 3 states "nothing calls `window.location.href = "/auth/login"` in response to that state today." True, but `useConnectionHealth`'s `state` value (including `"reauth-required"`) is already a public return value consumed today by `ConnectionStatusBanner.tsx` and `FacilitatorReadinessGrid.tsx` — any future component, including #32's eventual redirect trigger, can already react to `state === "reauth-required"` via its own `useEffect`. The thing that's actually missing isn't a hook point on the health-state side; it's (a) the effect that calls `window.location.href`, which is #32's job, and (b) the compose UI's own React state to persist, which is a separate untracked dependency. Worth stating precisely, since "no hook point exists" and "the consuming component hasn't been written yet" are different claims and the proposal should make the narrower, correct one.

**What this means for scoping the proposal:** build and merge the persistence/restore module now, as a standalone, unit-testable contract (see Section 3 below on what "done" can mean without a UI). Do not gate this change on #32 landing. Do gate the *integration* — the compose UI actually calling `persistDraft`/`restoreDraft` — on the compose UI existing, but that's a wiring task tracked wherever the compose UI change ends up living, not a blocker on this proposal being written, reviewed, or even implemented.

---

## 2. Vague: 4a's restoration precondition needs a stated acceptance scenario, including the "no current topic at all" case

Section 4a's mitigation direction is good and specific about the *shape* of the check (`sessionId` + `sessionTopicId`, checked against server-authoritative current topic, must be `voting`) but stops short of a GIVEN/WHEN/THEN, and it misses one branch: what happens when the session has moved all the way into `wrap_up`? Per `session-topic-lifecycle`'s `SESSION-012` (confirmed by reading the spec directly), advancing past the final topic clears `sessions.current_topic_id` entirely — there's no "current topic" to compare against at all, not just a different one.

**Suggested rewrite — add these as explicit acceptance scenarios:**

- *GIVEN a persisted draft for `(sessionId, sessionTopicId)`, WHEN the fresh connection registers and the server-authoritative current topic for that session matches both fields AND that topic's status is `voting`, THEN the draft is restored into compose state.*
- *GIVEN a persisted draft for `(sessionId, sessionTopicId)`, WHEN the fresh connection registers and the server-authoritative current topic differs (topic advanced), or the topic's status is no longer `voting` (revealed, complete), or the session has moved to `wrap_up` (no current topic at all), or the `sessionId` itself no longer matches an active session for this participant, THEN the draft is discarded silently and cleared from storage — no banner, no toast, no visible difference from "nothing was composed."*

That second scenario is really four distinct discard conditions collapsed into Devon's one sentence ("Anything else gets silently discarded"). I don't think the *behavior* is in question — discard is clearly correct in all four — but a proposal that only enumerates "wrong topic" and doesn't name "session ended entirely" as its own case is the kind of gap that gets found during implementation and bounced back as a question, which is exactly what I'm here to prevent.

---

## 3. Vague: 4b's precedence rule needs to be stated as a data-flow ordering, not just "locked-in wins"

"Locked-in wins, always" is the right rule and I have no notes on the rule itself. But as written it doesn't say *when* the restore logic is allowed to run relative to receiving server-authoritative state, and that ordering is exactly the kind of thing that's obvious in the author's head and invisible to whoever implements it six weeks later.

**Suggested rewrite:** state explicitly that restoration is a two-step sequence, not a race: (1) the fresh connection registers and receives server-authoritative state, including this participant's own lock-in status for the current topic, from the registration payload; (2) only after that payload is in hand does the restore logic read `sessionStorage` and decide whether to apply, discard, or ignore it. There should be no code path where the `sessionStorage` read happens, or where its result gets applied to UI state, before step (1) completes. Add the acceptance scenario directly:

*GIVEN a persisted draft exists for the current `(sessionId, sessionTopicId)` tuple, WHEN the fresh connection's registration payload indicates this participant has already locked in a vote for that topic (via whatever mechanism — a stale second tab, a retry that actually succeeded), THEN the draft is discarded and the UI reflects the server-reported locked-in state, never the draft value, regardless of which the local code would have computed first.*

---

## 4. Vague, and worth tightening before it becomes an accidental feature: 4c's "single-use" property needs a stated trigger for the clear, not just "cleared after"

Section 4c says the record should be "read once on the registration that follows a recovery, then cleared." Combined with my Section 1 recommendation (persist on every change, not just before navigation), I want to flag a real ambiguity: if the write happens continuously and the read/clear happens "on the registration that follows a recovery" — what registration counts? Every WebSocket registration this tab ever does (including an ordinary reconnect from a network blip, which per D7 already has in-memory state doing this job and shouldn't need `sessionStorage` at all), or specifically a registration that follows a `reauth-required`-triggered reload?

If it's read (and cleared) on *every* registration indiscriminately, this mechanism quietly becomes exactly the "ordinary refresh recovers your draft too" feature Devon's own 4c explicitly rules out as scope creep — not because anyone designed it that way, but because "the registration that follows a recovery" wasn't pinned down and an ordinary manual browser refresh also produces a fresh registration.

**Suggested rewrite:** state the read/clear trigger as precisely as the write trigger. I'd propose: the restore attempt happens once per page load, on the first WebSocket registration this tab performs after that load — which covers the SEC-26-recovery reload (the only reload this app's re-auth flow produces) without needing to detect "was this specifically a SEC-26 recovery" at all, since the write-on-change design from Section 1 makes that detection unnecessary. An ordinary in-tab reconnect (no page reload) never re-attempts a restore, because it never re-runs the "first registration after page load" code path in the first place — that code only runs once, at mount. Worth naming this as the actual mechanism rather than leaving "the registration that follows a recovery" as a phrase that sounds precise but doesn't specify what triggers the check.

Also missing from 4c: the record's actual shape. Given how much I care about entity definitions being explicit in this project's requirements, I'd want the proposal to state the persisted record as a real structure, not just "a tuple" — e.g., `{ sessionId: string, sessionTopicId: string, value: VoteValue, composedAt: string }` (or whatever fields end up load-bearing), with a stated key format for the `sessionStorage` entry itself. This is a small thing to write down now and a real thing to be missing when someone else implements it.

---

## 5. Missing: an explicit acceptance condition for "the compose UI doesn't exist yet" as a testing consequence, not just a scoping note

This is the point I most want on record before this goes to Propose. Several of Devon's own examples are written as user-observable scenarios — "the participant could end up staring at '3' pre-filled for a topic they never saw the prompt for." That's the right way to *explain* the risk, but it cannot be the shape of an acceptance scenario for this change, because there is no compose UI to stare at anything in yet, and per Section 1 above I'm recommending this change ship without waiting for one.

**Suggested rewrite — the proposal should state two tiers of acceptance condition explicitly, and say which tier applies to which scenario:**

- **Contract-level (verifiable now, in this change):** scenarios written against the `persistDraft`/`restoreDraft` (or equivalent) functions directly, with fixture data standing in for what a real compose component would supply — e.g., "given `restoreDraft` is called with a stored record for topic A and a current-topic argument of topic B, it returns `null` and clears storage." These are the scenarios from Sections 2–4 above, and they're fully testable today with no UI at all.
- **Integration-level (deferred, tracked, not blocking this change):** scenarios that require the actual compose UI and #32's redirect trigger to exist — "a participant who reloads via SEC-26 recovery sees their in-progress selection restored." These should be named in the proposal as follow-up verification owed once the compose UI lands, not written as if they're testable now, and not used to block this change's own completion.

Without this split, I'd expect exactly the failure mode my own success criteria warn about: someone tries to write the "participant sees their vote restored" test against components that don't exist, can't, and either fakes a component just to make the test pass (which verifies nothing real) or quietly drops the scenario and nobody notices it was never actually checked.

---

## What's already solid (no rewrite needed)

- **The D7 boundary statement (Section 2)** — precise about what's small (payload) versus what's protected (the moment), and it's the right frame for why this gets BA-level scrutiny at all despite being "one enum value."
- **4c's three hard properties** (single-use, no cross-device broadening, no server-side counterpart) — exactly the kind of scope fence I'd otherwise have to add myself. My Section 4 note above is a tightening of the single-use trigger, not a disagreement with the property.
- **4d, "don't let the fix grow new UI chrome"** — correctly tied to the standing concern (mine and Devon's) that this tool should disappear into the background once a session is running. I'd only add: state explicitly that a discarded/stale draft must be indistinguishable, from the participant's point of view, from a draft that was never composed at all — no partial-render-then-clear flash, no console-visible warning a curious participant could stumble into via devtools that contradicts the "nothing happened" framing.
- **Section 6, "what this is not"** — the explicit refusal to relitigate D1–D9a or to build a general resume-where-you-left-off feature is exactly the discipline I want carried into the proposal's Non-Goals section verbatim.

---

## Summary of asks before this moves to Propose

1. Resolve the sequencing question as a decision, not a judgment call: scope this as a standalone persistence/restore module, write-on-change (not write-before-navigate), with no dependency on issue #32 (Section 1).
2. Add the missing "session moved to `wrap_up`, no current topic at all" branch to the restore-precondition acceptance scenarios, alongside the wrong-topic case (Section 2).
3. State the locked-in-precedence rule as an ordering (server state arrives, then and only then is storage read/applied), with a concrete GIVEN/WHEN/THEN (Section 3).
4. Pin down exactly what triggers the single-use read/clear (first registration after page load, not "the registration that follows a recovery"), and state the persisted record's shape as a real structure (Section 4).
5. Split acceptance conditions into contract-level (testable now) and integration-level (deferred to compose-UI + #32 landing), and say so explicitly in the proposal so nobody tries to test against components that don't exist yet (Section 5).

None of these require new design work — they're each a paragraph of tightening on ideas Devon already has right in substance. But each is a place the current phrasing would send an implementer back to me or Devon with a clarifying question, which is exactly the round-trip this review stage exists to prevent.
