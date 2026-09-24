# BA Review: http-session-expiry-reauth-parity — Exploration Notes

**Reviewer:** Marcus Delgado, Business Analyst
**Stage:** Explore → Proposal readiness check
**Source reviewed:** `exploration-notes.md` (Devon Calloway), verified independently against `packages/backend/src/routes/auth.ts`, `teams.ts`, `packages/frontend/src/realtime/connectionHealth.ts`, and `packages/frontend/src/pages/SessionLobbyPage.tsx` / `DraftSessionHost.tsx` before writing this.

**Verdict up front:** this is one of the more buildable exploration docs I've reviewed in this project — it corrects the issue's own inventory against real code twice, and most of its recommendations are already stated as decisions rather than options. But three of the four items I was asked to scrutinize are currently written as "Design should decide" where the doc itself already contains enough reasoning to *make* the call, or to state precisely why it can't yet. Handing Design an open question the exploration already has 80% of the answer to just moves the ambiguity downstream instead of resolving it — that's the failure mode I'd flag on any exploration doc, this one included.

---

## 1. `teams.ts` category mismatch (§ open question 5) — this isn't a standalone decision, it's coupled to open question 6

The doc treats "fix `teams.ts`'s `invalid_request`/`session_expired` mislabel in this change, or file separately" (open question 5) and "is `MemberManagement.tsx` in scope" (open question 6) as two independent unresolved items. They aren't independent — one determines the other.

I checked: `MemberManagement.tsx` is the *only* frontend call site in the inventory that hits `teams.ts`'s three affected 401 sites (`teams/:teamId` GET). If `MemberManagement.tsx` is deferred (which the doc itself leans toward — "lower-stakes... not mid-ritual"), then nothing this change actually builds ever reads `teams.ts`'s category field, and fixing the label buys this change nothing — it becomes a correct-but-irrelevant drive-by fix with its own (small) regression risk, and belongs in its own issue. If `MemberManagement.tsx` *is* pulled into scope, the fix becomes load-bearing: the shared detection helper keys on `category === "session_expired"` (open question 2's leaning), so without the fix, a `teams.ts`-sourced 401 silently falls through to the generic error message — the exact failure mode this change exists to close, on a call site the change claims to cover.

**Concrete criterion to give Design, replacing the current open-ended framing:** resolve open question 6 first. Then question 5 resolves mechanically:
- `MemberManagement.tsx` in scope → the `teams.ts` category fix is in scope too, in this change, because the change's own acceptance criteria can't be met without it.
- `MemberManagement.tsx` deferred → file the category fix as a separate, non-blocking cleanup issue. No urgency, no coupling to this change's ship date.

One more thing worth putting in front of Design before they pick either branch: **confirm no frontend code currently branches on `category === "invalid_request"` specifically for these three `teams.ts` sites** (as opposed to just checking `!res.ok`). If something does, relabeling is a behavior change to an existing, presumably-working code path, not the "one-line, not new design" fix the exploration characterizes it as — and that changes the risk calculus even in the in-scope branch. I didn't find one in my spot check, but the exploration doc doesn't claim to have checked this either, and it should before proposal.md asserts this is mechanical.

---

## 2. `DraftSessionHost.tsx` scope expansion — justified for one call site, unstated for the other

The exploration's case for pulling `DraftSessionHost.tsx` in is good and specific: same facilitator-gated, ritual-blocking, in-session-action shape as the three named `SessionLobbyPage.tsx` sites, same generic-401 fallback message, same "retrying just 401s again forever" failure mode. That's a real acceptance condition, not an analogy — I'd write it as:

> Given a facilitator on `DraftSessionHost.tsx` whose absolute session lifetime (90 min) expires between clicking "Open the Room" and the `advance` response landing, when the response is a `session_expired` 401, then the page renders `ReauthRequiredTreatment` (role=facilitator, `returnTo` = current path) instead of "Could not open the room. Please try again."

That's buildable and testable as written. Put it in proposal.md close to verbatim.

**What's missing:** the argument is built entirely around `advance` (the POST, the ritual-blocking action). `facilitator-state` (the GET) is listed alongside it in the inventory but never independently justified — it's carried in by "both call sites," not by its own reasoning. That's the same shape of gap Marcus's own concern about edge-case scope disputes exists to catch: if `facilitator-state`'s inclusion is obvious (I think it probably is — a GET that 401s on page load or poll is the same "user doesn't know why retrying won't work" problem, just lower-stakes because it's not a click-triggered action), say so explicitly with its own one-line acceptance condition, rather than letting it ride in under `advance`'s justification. If it's *not* obviously the same, that's worse — it means the doc is expanding scope by bundling rather than by argument, which is exactly what I'd push back on in a proposal review. Either way, don't leave it implicit.

---

## 3. The architecture fork (fetch-response vs. `useConnectionHealth` state vs. both) — the doc argues itself most of the way to an answer, then stops short of giving it

This is the one I'd send back hardest. Compare how the doc handles its two open design forks:

- **Inline vs. auto-navigate (§ rendering shape):** frames the tradeoff, cites precedent (D1/D2 from `reauth-required-client-prompt`), and lands on a recommendation — "I'd push hard toward (1)." Design gets an answer plus the reasoning to override it if they disagree.
- **Fetch-response-only vs. also consuming `state`:** frames the tradeoff, cites precedent (Decision 5's "one fact, one call site" principle from `session-timeout-continuity`), correctly concludes the fetch-response check is non-negotiable regardless of what's picked ("load-bearing... regardless of what `useConnectionHealth` reports") — and then declines to answer, punting to Design with "decide explicitly... not an accident of whichever check runs first."

The doc has already done the hard part of this analysis. What it hasn't done is notice that Decision 5's precedent doesn't actually apply the way it's being cited. Decision 5 was about *two unreliable code paths independently trying to detect the same fact*, risking drift (e.g., a local per-pod registry vs. the authoritative Redis-backed one). What's actually happening here is different: two *independently authoritative* signals (a server-scheduled WS close timer, and a request that happens to land after the same cutoff) for the same real-world event, arriving through different channels with no ordering guarantee — closer to a race between two correct sensors than to "one fact, two guesses." That's not a reason to suppress one signal; it's a reason to make whichever fires first win, and the second a no-op. The doc gets 90% of the way to this conclusion in its own paragraph and then treats it as still open.

**What I'd ask the exploration to state as a recommendation, not a question:** yes, `SessionLobbyPage.tsx` should stop discarding `state` and render `ReauthRequiredTreatment` on `state === "reauth-required"`, in addition to the fetch-response check, with an explicit idempotency rule — first signal to arrive renders the treatment; if the second signal arrives after, it's a no-op (already rendered, don't re-render or flicker). That's a testable acceptance condition regardless of which check fires first in a given test run.

If the author genuinely wants to leave the A/B/both choice itself to Design's judgment (reasonable — it does touch other pages' architecture too), then at minimum the exploration needs to hand Design a testable definition of "correct" that holds under any of the three choices, so proposal.md isn't blocked on an implementation detail: no double-render, no flicker, no dropped state if both fire within the same tick. Right now neither the recommendation nor the fallback contract exists — that's the actual gap, not the tradeoff framing, which is fine.

---

## 4. `returnTo` allow-list gap — precise, verified, ready to become a task as-is (with one condition attached)

I checked this one directly against `packages/backend/src/routes/auth.ts:73-76`. The doc is exactly right: `RETURN_TO_ALLOW_LIST` has two entries, `^/session/${UUID}(?:\?.*)?$` and `^/team/${UUID}(?:\?.*)?$`, and `DraftSessionHost.tsx` (`useParams<{ teamId; sessionId }>()`, confirmed at line 42) uses `/team/:teamId/session/:sessionId` — a shape neither pattern matches. This is already precise enough to write as a task, not just a flagged risk. Suggested task wording:

> Add a third `RETURN_TO_ALLOW_LIST` entry matching `^/team/${UUID_PATTERN}/session/${UUID_PATTERN}(?:\?.*)?$` — same UUID-anchored precision as the two existing patterns, no broader wildcard. Runs through the existing `rejectReturnToCharacters` check unmodified (no new character-class logic). **Conditional on item 2 above resolving `DraftSessionHost.tsx` in-scope** — don't add an allow-list entry for a route this change doesn't end up touching.

That conditionality is the one thing worth making explicit in tasks.md rather than assuming: this task should be written as dependent on the scope decision in item 2, not as an unconditional line item that happens to be true today.

---

## Other clarifications worth tightening before proposal.md

- **Open question 1 (shared helper) needs a stated contract, not just a leaning.** "A small shared helper... something that takes a `Response` and returns whether it was a disclosed session-expiry" is the right shape but not yet a spec. Two things every call site's implementer will otherwise guess differently: (a) does the helper consume/parse the response body itself, or does the caller pass in an already-parsed body (several call sites likely already call `.json()` once for their existing generic-error path — a second `.json()` read on a `Response` will throw)? (b) is `role` (facilitator/participant) an input to the helper or decided independently by each call site? I'd guess (b) is "caller supplies it, not derivable from the response" — but say so, since it's the kind of thing that's obvious to whoever writes the exploration and invisible to whoever implements call site four of five.
- **"Lands somewhere coherent" (opening section) is doing a lot of work for an informal framing.** It's fine as scene-setting prose, but make sure proposal.md replaces it with the actual acceptance condition (render `ReauthRequiredTreatment` in place, no navigation) rather than carrying the soft phrasing forward into a requirements document.
- **Open question 6 (EM pages, `MemberManagement.tsx`, `SessionCreationPage.tsx`)** — the doc says "either is defensible... should be a stated decision in proposal.md." Agreed, but per item 1 above, this decision isn't independent of the `teams.ts` fix — sequence it first.

## What's already proposal-ready — don't relitigate these

- The severity/scope split from `session-timeout-continuity` (WS gap vs. HTTP gap) is well-grounded and correctly not reopened here.
- The `returnTo`-lands-on-page-not-mid-action nuance, and the "session_expired runs in `onRequest`, so a 401'd POST is guaranteed never to have executed" guarantee, are both precise and correctly framed as behavior to document, not gaps to fix.
- Inline rendering over auto-navigate: well-argued, consistent with D1/D2 precedent I verified directly. No changes needed.
- Provider-agnosticism check: consistent with [[project_oidc_multi_provider]] — confirmed no Entra-specific assumption, nothing further needed here.
- OR-1.7, pre-expiry warning, and WS-side work correctly excluded — no scope creep to flag.
