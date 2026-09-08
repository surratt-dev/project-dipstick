# Champion Sign-off — websocket-delivery-time-authorization

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-09-07
**Status:** Sign-off — Decision 5 honored in full; the one blocking dependency is disclosed everywhere a future reader would look, not just where a diligent one would look; two open gates (performance/skew measurement, Priya's UX sign-off) are correctly held open, not quietly closed

---

## Summary

I read every artifact this change produced, end to end — proposal, design (with all four review-disposition sections), tasks, my own exploration notes and both explore-stage reviews, both propose-stage reviews, both design-stage reviews, both tasks-stage reviews, both implementation-stage reviews, the delta spec, the now-synced main spec, GitHub issue #18 (the trigger), and my own prior sign-off on this exact gap from 2026-07-07.

The short version: this is the reading of Decision 5 I asked for two months ago, done properly. The person who built this did read Decision 5 before writing a line of code, and it shows in the places that are hardest to fake — the drift-risk "tell" I named in my own exploration notes (is the check called inside the per-message handler on every message, or cached at subscribe time) has a named regression test and a code-review checklist item, and the implementation-stage architect review traced through the actual dispatcher code and confirmed there is no cached grant anywhere on a registered connection. That is not a document telling me it's fine. That is someone checking.

I have no blocking concerns. I have one thing I want on the record about how two real bugs got caught, and one soft spot in an otherwise clean tracking chain that I want named so it doesn't quietly harden into "done" before it actually is.

---

## Decision 5 — honored in full

**Delivery-time, not queue-dequeue-time.** Verified, not assumed. `ws-event-dispatcher.ts`'s four `dispatch*` functions run the relevant authorization check inside `Promise.all` over the local candidate set, per candidate, on every incoming Redis message — the architect's implementation review traced this to source and confirmed no grant is ever stored on a `RegisteredConnection` object for reuse. This is exactly the failure mode I spent the longest section of my exploration notes on (Section 5: code that *looks* like per-event checking because it runs once per pub/sub message, but is actually subscription-time caching wearing a delivery-time costume). It did not happen here, and there's a named test (`ws-event-dispatcher.test.ts`, "re-runs the authorization check on every message") that would fail if it ever does.

**The specific named events.** All four — `vote_readiness_update`, `session_state_change`, `vote_revealed`, `topic_history_update` — have delivery-time checks, per-event scoping matched to what each event actually needs, and dedicated scenarios in the synced spec (the tasks-stage BA review caught that `session_state_change` was missing its own scenario despite having the heaviest test coverage of the four; it's in the spec now).

**No parallel authorization logic.** `evaluateTeamAccess` is reused verbatim for `topic_history_update`. The three session-scoped events needed something `evaluateTeamAccess` doesn't provide — a session-scoped predicate — and the response was a thin sibling, `evaluateSessionSubscriberAccess`, built alongside the existing helper, tested in isolation, using the same indexes, returning the same grant shape. That is the correct response to a genuine gap in the existing helper's contract. It is not a second implementation of the same idea; the security implementation review confirmed both helpers converge on identical precedence logic (admin-first, then membership) and neither has a hidden third path. Reuse of `serializeForFacilitator`/`serializeForMemberParticipant` for `vote_revealed` is equally clean — the security reviewer traced the payload adapter field-by-field and found no independently computed value anywhere in it. Decision 9's two-independent-layers rule, extended to the wire, held.

---

## Core constraints from the original access-control change

**No-manager-surveillance, extended to the admin-grant rejection I flagged during that change's own Explore.** Back in July I named Option B — Application Admins get administrative data, not session content — as my position, precisely because an admin's blanket access is an organization-wide surveillance path. This change closes the one place that boundary hadn't yet reached: a WebSocket subscription. `topic_history_update` explicitly rejects an `admin`-path grant, including the dual-role case (an admin who is *also* a genuine team member gets nothing, not a reduced view) — tested explicitly, not just asserted. Tomás's design review is right to flag that this is a real availability cost to a real person, and right that it's an inherited, not new, trade-off of Option B. I want that documented consequence to make it into onboarding guidance eventually, but it is not this change's job to write that guidance, and the trade-off itself is now recorded in design.md rather than only discoverable by reading spec scenario text closely.

**Simultaneous reveal via serializer reuse.** Confirmed structurally clean, as above. The one thing I'd still call genuinely open, not closed: whether the reveal *feels* simultaneous under the two-pods-two-independent-evaluations architecture Priya was right to worry about in Explore. That requires the cross-recipient skew measurement (Group 6), and Group 6 is honestly and visibly marked `DEFERRED` — not performed in this session because no live deployment exists to measure against. That's the correct call per Rachel's right-sizing instruction, and I'd rather see an honest "not measured yet" than a fabricated number. But it means the simultaneity guarantee is architecturally sound and numerically unverified, and that gap must close before a real pilot session, not just before this change is marked complete.

---

## GitHub issue #26 — a defensible call, and unusually well disclosed

Leaving the reveal, topic-advance/action-item-finalization, and membership-removal state-transition writes unimplemented — while building and fully testing the authorization layer against stubs — is the right engineering call, for a reason that matters more to me than the sequencing logic itself: **the repository owner made this decision explicitly**, after the Propose-stage BA review surfaced it, rather than an implementer inventing a scope boundary under pressure. That's the right process even when I might have leaned a different way myself.

Is there a risk of a future reader mistaking "authorization layer complete" for "feature complete"? I looked hard for this, because it's exactly the kind of gap that erodes trust in documentation over time — a green checkmark that means less than it looks like it means. I don't think it happens here, for a specific reason: **the disclosure isn't buried in a change folder that will get archived and forgotten. It's in the Purpose section of the living spec**, the first thing anyone reads when they open `openspec/specs/websocket-session-authorization/spec.md` for any reason at all, stating plainly that two of four events "are not yet wired to any production trigger" and naming exactly why. That is a materially different posture than "gate-blocked," the note it replaced — it's not a status flag, it's a paragraph a future reader has to actively skip past to miss. Combined with the `TODO(#26)` comment convention at every unwired call site (verified by both implementation reviewers to be present, specific, and not generic), and the fact that the buildable two-of-four events *are* fully wired into production rather than deferred out of excess caution, I'm satisfied this is a named gap, not a hidden one.

The one place I'd still push: a reader who only skims tasks.md's checkboxes — 49 done, and nothing in a checkbox glyph distinguishes "done and live" from "done and stubbed pending #26" — could walk away with more confidence than the annotations support. The annotations are good and specific (I checked several), but they require reading past the checkbox, not just counting them. That's a real but narrow risk, and it's the same risk that exists for any task list with inline caveats; I don't think it needs a new mechanism, but I want it named so nobody treats "49/66 checked" as the actual measure of what shipped.

---

## Priya Nair's UX sign-off gap (9.1 / 9.3) — correctly gated, same pattern as last time

This is the same shape of gate my predecessor sign-off (mine, from July) accepted for the facilitator-error-state UX review: implementation done, UX sign-off pending, and the thing that depends on the sign-off is explicitly blocked rather than allowed to proceed on an assumption. Task 9.1 is honestly marked blocked — Priya wasn't available this session — and task 9.3, the actual hard gate Rachel demanded at Propose stage, stayed hard through Design and Tasks review with identical wording each time nobody touched it. I traced this myself: neither design-stage reviewer mentions Group 9 at all (it wasn't in their lens), and that silence is correctly *not* read as erosion — Marcus Delgado's tasks-stage review explicitly checked for softening and found none. The one tightening I'd have asked for — that 9.1 needs Priya's actual sign-off, not just a filed document, before 9.3 can be considered satisfiable — was already caught and added by the tasks-stage BA review. Good. This is gated, not dropped, and the gate has the teeth Rachel asked for: the WebSocket authorization work may go live in a non-pilot environment, but no real team runs a live session until the staleness signal ships.

---

## The two bugs caught mid-pipeline — a qualified process success, with a lesson worth keeping

The close-code disclosure bug (two named constants resolving to the same value was clearly the *intent*, but the inherited code had them as genuinely distinct codes before this pass) and the EM-promotion gap (`evaluateSessionSubscriberAccess` fetching `membership_role` but never checking it) are both real defects that were not in the original design — they were introduced during implementation and caught during implementation review, by the architect and by testing that specifically targeted both mechanisms.

I want to call this what it is rather than round it in either direction. It is a process success in the sense that matters most: neither bug reached production, both were caught by a review layer built for exactly this purpose, and both fixes were verified — not just narrated as fixed — by an independent security pass reading the actual code and the actual tests, including the facilitator-path variant of the EM fix that a narrower patch might have missed. That is the two-layer-enforcement philosophy this whole project is built on, working correctly on the process that builds the product, not just in the product itself.

But I don't want to let "the net caught it" stand in for "we should be more careful about what needs a net." Both bugs were regressions against patterns that were *already established and already correct elsewhere in the same codebase* — `sessions.ts` already had the dual EM check; a single close code for all server-initiated closes was already the explicit, stated design intent, not a new invention. Neither bug was a hard design problem. Both were places where an existing, correct pattern had to be independently re-noticed and re-applied by a human, and wasn't, the first time. That's worth a name for whoever runs the next change: where a security-relevant pattern already exists once in this codebase (a dual-role check, a uniform error signal, a no-op-vs-throw assumption about a library call), the thing that should catch its second instance not matching the first is closer to a lint rule, a shared test helper, or a grep-based CI check than a hope that the reviewer remembers to compare them by hand again. I'm not asking anyone to build that now. I am saying it plainly so it isn't rediscovered as a surprise on the next real-time feature this codebase grows.

---

## Section 13 — tracing what I said must not vanish

I went back to my own exploration notes' closing section and checked each item against what actually landed, because that's the specific promise a sign-off exists to verify.

| Item flagged in Section 13 | Where it landed |
|---|---|
| Admin-grant rejection for `topic_history_update` — normative | Spec requirement, D2/D3, tasks 4.5/5.6/5.9, verified in code with the dual-role case explicitly tested. **Made it through, fully.** |
| SEC-25 idle-connection gap, distinct from SEC-27 | Spec requirement ("tracked, not satisfied"), D8's compensating 90-minute bound implemented and tested (3.2/3.6/4.1/5.10), verified in code by both implementation reviewers. **Made it through**, with one soft spot below. |
| SEC-25/26 tracked to one combined destination | GitHub issue #27, named. **Made it through** — see soft spot below. |
| SEC-14 audit-log ambiguity, resolved to per-action logging | D7, extended at Design stage (Tomás) to include vote submission, which I hadn't even asked for by name — SEC-13 named it and the gap got closed anyway. **Made it through, and further than I'd specified.** |
| 60-second fallback figure, corrected to "reference point, not validated bound" | Carried into design.md verbatim, never invoked (delivery-time was chosen), correctly not re-derived since the contingency never triggered. **Made it through**, and stayed correctly inert. |
| ~100ms placeholder, labeled and measured at p95/p99 | Correctly labeled throughout, but the actual measurement (Group 6) is honestly **DEFERRED** — no live environment existed to measure against. Not lost — clearly still open, not silently closed. |
| Cross-recipient skew measurement | Spec requirement added. Same as above: **correctly deferred, not silently dropped**, must close before a real pilot session. |
| Per-pod concurrency model, concurrent not serial | Implemented as `Promise.all`, verified in code. **Made it through.** |
| Client-experience gap — cause-of-revocation non-goal reaffirmed; staleness-signal named as Design deliverable | Non-goal reaffirmed and enforced (single close code, tested). Staleness signal became tasks 9.1/9.3 — open, correctly gated (see above). **Made it through**, still appropriately open. |

The one place I'd call a soft spot rather than a clean landing: task 8.2's owner (Marcus Oyelaran) and target quarter (Q4 2026) for the SEC-25/26 companion issue are recorded as a **proposal**, explicitly caveated as "pending final confirmation by the repository owner" — and that caveat sits next to a checked box. The architect's implementation review flagged this exact tension and I agree with her framing: it isn't wrong, because the task's own text is honest about what's settled versus proposed, and "a destination exists with a named owner" is what the gate actually asks for. But a checked box reads as more final than "proposed, unconfirmed" is. I want this to stay visible — not re-opened, just watched — until the repository owner actually confirms it, rather than letting the checkmark do the work the confirmation hasn't done yet.

Nothing from Section 13 vanished. Two items are correctly and visibly still open rather than closed, and one is closed with a caveat attached that a fast reader could miss.

---

## Verdict

I sign off. Decision 5 is honored in full, verified against actual code rather than taken on the documents' word — by the engineer, the security analyst, and the architect, each independently, at both design and implementation stage. The no-surveillance guarantee reaches the wire now, including the admin dual-role case I raised as a risk two months ago. The reveal's serializer-reuse guarantee is structurally sound; its felt-simultaneity property is not yet numerically verified, and that is disclosed everywhere rather than hidden.

Two things must happen before a real pilot team runs a live session, and both are already gated with the right teeth in tasks.md, not soft hand-offs: the cross-recipient skew measurement against a real environment (Group 6), and Priya's actual sign-off on the staleness signal (9.1/9.3). Issue #26 must resolve before this feature does anything a real facilitator would notice in a real reveal — the authorization layer is ready for that day; the trigger isn't built yet, and everyone who opens this spec will be told so before they read anything else.

The next thing I want carried forward isn't a gate — it's a habit. Two patterns that already existed correctly once in this codebase had to be independently rediscovered under review before they were consistent everywhere they needed to be. That's a good outcome for this change. It's a cheap enough pattern-matching problem that the next change shouldn't have to rely on a human catching it by inspection a second time.

— Devon Calloway
