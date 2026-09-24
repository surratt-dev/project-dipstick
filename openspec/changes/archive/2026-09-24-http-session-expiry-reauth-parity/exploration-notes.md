# Exploration Notes: http-session-expiry-reauth-parity

**Author:** Devon Calloway (Internal Champion / SME), explore stage, GitHub issue #146.

**Revision note:** Updated after review from Priya Nair (Facilitator, `explore-review-facilitator.md`) and Marcus Delgado (Business Analyst, `explore-review-ba.md`). Both reviews are careful and I'm adopting essentially all of it — where a reviewer asked me to resolve something I'd left as an open question, I resolved it and said so; where a reviewer asked me to verify an assumption, I went and checked it against the code rather than just restating the ask. I found nothing in either review that trades away a protective constraint or expands scope beyond what's warranted, so there's no pushback to record here — this revision is adoption, not negotiation. Line-item responses are inline at the relevant section; nothing is left as "noted for later" that either reviewer asked to be resolved now.

## What this is, and what it isn't

Issue #146 is `session-timeout-continuity`'s own Open Questions section (and tasks.md task 5.5) closing the loop it deliberately left open: that change fixed the WebSocket-side absolute-lifetime expiry to route to the disclosed `reauth-required` treatment, and gave that treatment's CTA a `returnTo` mechanism to land the user back where they were. It explicitly declined to touch the HTTP side beyond naming the gap and filing this follow-up. I signed off on that scope split myself (`champion-signoff.md`, "Not our call, correctly deferred") because the two gaps are qualitatively different in severity — the WS gap stranded a connection silently and permanently; the HTTP gap only surfaces in a narrow race window and fails visibly and retryably. That severity read still holds. This is the smaller, second half.

I want to be precise about scope the same way that change's own design.md was: this is not OR-1.7 (rejoin with topic/vote state restored — the live-voting UI still doesn't exist), not the pre-expiry warning, and not a general-purpose HTTP interceptor for every possible error class. It's specifically: when a session-scoped fetch call gets back a `session_expired` 401 mid-ritual, does the user land somewhere coherent, using the same disclosed treatment and the same return-to mechanism the WS side already shipped — or do they get today's generic "try again" message that doesn't tell them why retrying won't work.

## Grounded in what's actually built today — and the issue's own inventory needs two corrections

I read the actual call sites and route handlers rather than trusting the issue body's list, per the standing instruction. Two things don't hold up exactly as stated.

**Correction 1 — `teams.ts` is not actually a `session_expired`-emitting route.** The issue's inventory names `teams.ts`, `facilitator-sessions.ts`, and `sessions.ts` as "the other `session_expired`-emitting routes." I grepped all three for `category: "session_expired"` directly:

```
facilitator-sessions.ts:219, 1796   category: "session_expired"   ("User not found" — no row for caller)
sessions.ts:104, 251                category: "session_expired"   ("User not found" — no row for caller)
teams.ts:393, 544, 1067             category: "invalid_request"   ("User not found" — same condition)
```

`teams.ts`'s three 401s are the *identical* "no row in `users` for `session.userId`" condition the other two files hit — but categorized `invalid_request`, not `session_expired`. That's a real, pre-existing inconsistency in this codebase (same failure, two different category labels depending which file you're in), not something #146 introduced. It matters here specifically because if the design keys its detection off `category === "session_expired"` (which I think it should — see below), a `teams.ts` call site with this exact same underlying problem won't be caught by that check today, while the same problem on a `sessions.ts` or `facilitator-sessions.ts` call site will be.

**Resolution rule (Marcus's review, item 1 — this isn't independent of the `MemberManagement.tsx` scope call, it's downstream of it):** `MemberManagement.tsx` is the only frontend call site in this inventory that hits any of `teams.ts`'s three affected sites (`GET /teams/:teamId`). So:

- If `MemberManagement.tsx` is pulled into this change's scope (open question 6, below) → the `teams.ts` category fix is in scope too, in this change, not filed separately. Without it, the shared detection helper (keyed on `category === "session_expired"`) silently fails to catch a `teams.ts`-sourced 401 on a call site this change claims to cover — the exact "retry forever with no explanation" failure mode #146 exists to close.
- If `MemberManagement.tsx` is deferred → the category fix buys this change nothing (nothing it builds ever reads `teams.ts`'s category field), so it becomes a correct-but-unrelated drive-by fix carrying its own small regression risk. File it as a separate, non-blocking cleanup issue, no urgency.

Design doesn't need to weigh this independently — resolve open question 6 first and this one falls out mechanically.

**Checked, not just flagged (Marcus's review, item 1, second half):** I went back and confirmed directly whether any existing frontend code branches on `category === "invalid_request"` for these three `teams.ts` sites specifically, since relabeling would be a behavior change to a working path if so, not the mechanical fix I was characterizing it as. `MemberManagement.tsx`'s `loadMembers` (the only consumer of `GET /teams/:teamId`) checks `!res.ok` only — it never parses the response body or reads `category` at all (`packages/frontend/src/components/MemberManagement.tsx:104-107`). The one place in the frontend that *does* branch on `category === "invalid_request"` is `AuthErrorPage.tsx:13`, and that's reading a `category` URL search param off the OAuth callback's `/auth/error?category=...` redirect — an entirely separate code path from `teams.ts`'s fetch-response body, unrelated to this change. So: confirmed, not merely assumed — relabeling `teams.ts`'s three sites is a one-line-per-site correction with no existing consumer to break, in either branch above.

**Correction 2 — none of those six route-level 401s are actually where the ritual-relevant expiry comes from.** I went looking for where the *real* absolute-lifetime/revoked-token `session_expired` — the one that actually fires mid-session, the one #146 is about — originates, and it isn't scattered across route handlers at all. It's one place: `packages/backend/src/auth/middleware.ts`'s `authMiddleware` `onRequest` hook (lines 156-242), which runs before every non-public route. Three branches, all `category: "session_expired"`:

- No session/`userId` at all (line 164)
- `Date.now() - sessionCreated > ABSOLUTE_LIFETIME_MS` (line 180) — the 90-minute ceiling, the same constant `scheduleForceClose` uses on the WS side
- Token refresh returns `revoked` (line 215)

This hook is a single, already-existing, already-centralized choke point that every session-scoped request already passes through. The six route-level 401s I corrected above are a narrower, secondary case (a user row that's gone missing — closer to a data-integrity edge case than a session-timeout event) and, based on what triggers them, not the scenario #146 is actually about. I'm naming this because it changes how I'd think about "is this a cross-cutting audit of a dozen ad hoc handlers" — the *server* side of this problem is already unified into one hook and needs no new work. The entire gap is client-side: nothing reads the `category` field this hook (or the two secondary route-level cases) already sends.

## The real frontend call-site inventory is larger than "the three in `SessionLobbyPage.tsx`"

Confirmed those three (`action-items-review`, `start`, `begin-voting`) — none of them read the 401 body, all three fall into the same generic error-message branch as a 500 or a network failure. But grepping every `/api/v1/*` fetch in the frontend turns up more session/team-scoped call sites than the issue names:

```
SessionLobbyPage.tsx      action-items-review (GET), start (POST), begin-voting (POST)   <- issue names these
DraftSessionHost.tsx      facilitator-state (GET), advance (POST)                         <- NOT named in the issue
MemberManagement.tsx      teams/:teamId (GET)
EmSessionHistoryPage.tsx  em/sessions (GET)
EmTrendDataPage.tsx       em/trends (GET)
EmActionItemsPage.tsx     em/action-items (GET)
SessionCreationPage.tsx   eligible-for-session (GET), sessions/draft (POST)
voteRevealedLatency.ts    reveal-latency (POST, fire-and-forget metric)
```

`DraftSessionHost.tsx` is the one I'd flag as a real gap in the issue's own scoping, not just a nice-to-have addition. It's the facilitator's control surface for opening the room (`advance`) before a session reaches the lobby — same shape of in-session, facilitator-triggered, ritual-blocking action as `handleStartSession`, same "generic error message on any non-ok response" handling (`body?.error?.message ?? "Could not open the room. Please try again."`), same missing reauth routing. If a facilitator's absolute lifetime expires in the window between clicking "Open the Room" and the response landing, they get a misleading "please try again" — retrying will 401 again, forever, with no indication why. That's the exact failure mode #146 is written to fix, on a call site the issue didn't name. I'd want Design to treat this as in-scope alongside the three `SessionLobbyPage.tsx` sites, not discovered later as a gap in this change's own coverage.

**Acceptance conditions for both of `DraftSessionHost.tsx`'s call sites, stated separately (Marcus's review, item 2 — the GET was riding in on the POST's justification and needs its own reasoning, not an analogy):**

> Given a facilitator on `DraftSessionHost.tsx` whose absolute session lifetime (90 min) expires between clicking "Open the Room" and the `advance` response landing, when the response is a `session_expired` 401, then the page renders `ReauthRequiredTreatment` (`role="facilitator"`, `returnTo` = current path) instead of "Could not open the room. Please try again."

> Given a facilitator who lands on `DraftSessionHost.tsx` — a refresh, a stale bookmark, a tab left open — after their absolute session lifetime has already expired, when the mount-time `GET facilitator-state` call (`loadFacilitatorState`) returns a `session_expired` 401, then the page renders `ReauthRequiredTreatment` in place of "Unable to load this session," the same as the POST case above.

These are two separate 401 branches in the component today (`packages/frontend/src/pages/DraftSessionHost.tsx:58-65` for the GET, `:85-91` for the POST) and both need the routing — Priya's review (item 7) caught that the GET path could easily get missed if implementation only fixes the button click it's easiest to picture. I'm naming both as their own tasks.md items so that doesn't happen.

**The confirm step's in-memory state does not survive a reauth round trip — stating this on purpose (Priya's review, item 3).** `advanceState.phase === "confirming"` (`DraftSessionHost.tsx:39,49`) is plain React state, not persisted anywhere. If a facilitator's session expires *after* clicking "Open the room" but *before* clicking "Yes, open the room" — while they're reading the confirm copy — and something else 401s, or they come back to a stale tab, `returnTo` lands them back on the bare draft view, not back on the confirm step. That's correct behavior, consistent with the general `returnTo`-gets-you-to-the-page-not-the-action nuance below — I'm stating it explicitly for this page specifically, because it's the one call site in this inventory with a two-step confirm in front of the POST, and I don't want an implicit "reauth resumes where I left off" assumption to survive into a mock unchallenged.

**This call site is room-opening only, nowhere near the reveal path — stating it outright (Priya's review, item 4).** `advance` moves a session from `draft` to `lobby`. There is no live-voting or reveal UI wired into `DraftSessionHost.tsx` or reachable from it, and OR-1.7 (state restoration) and the live-voting UI don't exist yet anywhere in this codebase. This change does not touch, and does not come near, the vote-reveal path. I'm saying this plainly here — not leaving it to be inferred — because "DraftSessionHost" and "facilitator control surface" are exactly the words that could get this issue cited later as prior art for reveal-adjacent work it never touched.

**No new copy fork needed (Priya's review, item 6).** `ReauthRequiredTreatment.tsx` already omits the vote-loss sentence when `role="facilitator"`, unconditionally regardless of cause — that was the fix from the `session-timeout-continuity` review cycle, already shipped. `DraftSessionHost.tsx`'s two new call sites just pass `role="facilitator"`, same as the existing facilitator-side consumer. Nothing new to design in `ReauthRequiredTreatment` itself.

The EM pages (session history, trends, action items) and `MemberManagement.tsx`/`SessionCreationPage.tsx` are lower-stakes — none of them are mid-ritual, live-session actions; an EM viewing a trend dashboard hitting a stale-session 401 is not the "silent forced disconnect mid-vote" category of problem. I'd still want them covered by whatever shared mechanism gets built (no reason to leave them out if the mechanism is generic), but I wouldn't hold the ritual-critical fix hostage to auditing every one of them individually — that's exactly the kind of scope creep the original change's design.md was careful to avoid.

## A finding that changes the shape of the design question: `SessionLobbyPage.tsx` already has the WS-side signal in hand and throws it away

This is the one I think is most worth Design's attention. `SessionLobbyPage.tsx` already calls `useConnectionHealth(connect)` for its own purposes (subscribing to `session_state_change` over the socket) — but it destructures only `{ socket }` (line 111), discarding the `state` value the hook also returns. That `state` is the exact `"connected" | "unknown-reconnecting" | "reauth-required"` machine the WS-side fix already wired to the same `ABSOLUTE_LIFETIME_MS` cutoff (`session-timeout-continuity` Decision 1: `CLOSE_FORCE_EXPIRED` now aliases `REAUTH_GRACE_EXPIRED_CLOSE_CODE`). In other words: on this specific page, the moment the same 90-minute ceiling this issue cares about elapses, `state` already flips to `reauth-required` — the page just never looks at it.

That raises a real design fork, not just an implementation detail:

```
┌─────────────────────────────────────────────────────────────┐
│  Option A — fetch-response-driven                            │
│  Each call site inspects its own 401 + category on response  │
│  General; works on pages with no live socket (DraftSessionHost,│
│  EM pages, SessionCreationPage — none of these open a WS)     │
│  A second, independently-derived detector of the same fact,   │
│  on pages that ALSO have a socket already telling them this   │
├─────────────────────────────────────────────────────────────┤
│  Option B — reuse useConnectionHealth's `state` where present │
│  Zero new detection logic on SessionLobbyPage — just stop     │
│  discarding `state` and render ReauthRequiredTreatment when   │
│  it's "reauth-required", same as SessionConnectionHost already│
│  does                                                          │
│  Doesn't help the fetch that's already in flight when the     │
│  WS close fires — and doesn't exist at all on pages with no   │
│  socket (most of the inventory above)                         │
└─────────────────────────────────────────────────────────────┘
```

Neither one alone is sufficient, and I don't think this is actually an either/or. The WS force-close and an in-flight HTTP request's own 401 are two independent evaluations of "now minus sessionCreatedAt" against two different clocks (a server-side scheduled timer vs. a request arriving at the `onRequest` hook) — there's no ordering guarantee between them. A POST that's already in flight when the boundary is crossed gets its own authoritative 401 regardless of what the socket is doing; relying on `state` alone would leave a real window where the fetch response arrives before the socket's scheduled close does. So the fetch-response check is load-bearing and necessary on its own regardless of what `useConnectionHealth` reports.

**Resolved, not left open (Marcus's review, item 3 — I'd left this as a question for Design even though the doc had already done most of the reasoning; that was a miss, and I'm closing it here rather than punting it downstream):**

`SessionLobbyPage.tsx` should stop discarding `state` and render `ReauthRequiredTreatment` on `state === "reauth-required"`, **in addition to** the fetch-response check. Idempotency rule: **first signal to arrive renders the treatment; the second signal, whichever it is, is a no-op** — if `ReauthRequiredTreatment` is already showing, neither a subsequent 401 nor a subsequent `state` flip re-renders it, re-triggers it, or causes a flicker. That's a testable acceptance condition regardless of which channel happens to fire first in a given run.

**Why `session-timeout-continuity`'s Decision 5 precedent doesn't apply here, stated explicitly rather than left as an unresolved tension:** Decision 5 was about two *unreliable* code paths independently *guessing* at the same fact — e.g., a local per-pod registry drifting from the authoritative Redis-backed one, where only one of the two guesses is actually right and they can silently disagree. What's happening here is different in kind: the WS close timer and the HTTP 401 are two *independently authoritative* signals of the *same real-world event* (the 90-minute absolute-lifetime cutoff), arriving through different channels with no ordering guarantee, and both are correct whenever they fire — there's no "wrong" one to distrust. That's a race between two correct sensors, not one fact with two guesses. The fix for a race is first-wins/second-is-no-op, not suppressing one channel — suppressing the fetch-response channel would reopen the exact gap (an in-flight POST 401ing with the socket not yet closed) that made the fetch-response check load-bearing in the first place. I want this stated so it doesn't read as inconsistent with Decision 5's own reasoning — it isn't; it's a different shape of problem.

Worth noting as a smaller, adjacent point: `SessionLobbyPage.tsx` renders *no* connection-health UI at all today, in either state — it never mounts `ConnectionStatusBanner`. A participant sitting on this page during an ordinary `unknown-reconnecting` blip gets no indication of that either. That's a separate, pre-existing gap (mirrors the same shape as `AuthContext.tsx`'s unparameterized-redirect gap `session-timeout-continuity`'s design.md already named and declined to touch) — I'm naming it so it doesn't get silently folded into this issue's scope, not proposing to fix it here.

## The `returnTo` mechanism reuses cleanly — with one nuance worth stating plainly

The backend half of this is entirely done already. `/auth/login`'s `returnTo` handling, the UUID-pinned allow-list (`/session/:id`, `/team/:id`, optional query string), the CRLF/backslash/scheme rejection, and `/auth/callback`'s redirect are all shipped, tested, and unmodified by anything this issue would need. `ReauthRequiredTreatment.tsx` already accepts `returnTo`/`role` props and both existing call sites already compute `returnTo` the same way (`window.location.pathname + window.location.search`). This means #146, unlike `session-timeout-continuity`, is very likely a **frontend-only** change — no new backend route, no new allow-list entry (`/session/:id` already covers `SessionLobbyPage.tsx` and `DraftSessionHost.tsx`'s `/team/:teamId/session/:sessionId` shape needs checking against the allow-list's `/team/:id` pattern, since that route's path shape is `/team/:teamId/session/:sessionId`, not bare `/session/:id` or `/team/:id` — I did not find a third allow-listed shape for a combined `/team/:id/session/:id` path). **That's a concrete gap Design needs to close, not assume**: if `DraftSessionHost.tsx` is in scope (and I think it should be, per above), its own URL shape needs to either already match one of the two existing patterns or get added as a third allow-listed shape — it doesn't today by my reading of `RETURN_TO_ALLOW_LIST` in `auth.ts`. **This task is conditional on the `DraftSessionHost.tsx` scope decision (open question 4 / Marcus's review item 2), not an unconditional line item** — don't add an allow-list entry for a route this change doesn't end up touching. Suggested task wording, ready to drop into tasks.md once that scope decision lands: add a third `RETURN_TO_ALLOW_LIST` entry matching `^/team/${UUID_PATTERN}/session/${UUID_PATTERN}(?:\?.*)?$`, same UUID-anchored precision as the two existing patterns, no broader wildcard, running through the existing `rejectReturnToCharacters` check unmodified.

The nuance: `returnTo` gets someone back to the *page*, not back to the *in-flight action*. For a GET call (`action-items-review`, `facilitator-state`) that's sufficient — the page re-fetches on mount and the user sees current state. For a POST action call (`start`, `begin-voting`, `advance`) that 401'd, landing back on the page does not resume or retry that POST — the user has to click the button again. That's the correct behavior (not a gap to fix), but it's worth stating explicitly rather than leaving an implicit assumption that "returnTo" means "and also finish what I was doing."

**Stated as a design requirement, not an aside (Priya's review, item 4 — this was under-weighted in my first pass):** because the `authMiddleware` hook's `session_expired` check runs in `onRequest`, before any route handler executes, a `session_expired` 401 on a POST is guaranteed to mean the action never ran server-side. This is a requirement this change relies on, not incidental color, specifically for `DraftSessionHost.tsx`'s `advance` call: the confirm dialog's own copy promises "cannot be undone," and that promise stays true through a reauth interruption only because a 401 on that POST is guaranteed to mean the room did not open. If a facilitator hit reauth mid-click on "Yes, open the room" and *couldn't* be sure whether the room had opened before their session died, that would turn a clear, bounded failure into an ambiguous one — on the one action in this inventory whose entire warning copy is about irreversibility. design.md should carry this forward as a stated requirement the `DraftSessionHost.tsx` fix depends on, not something the reader has to re-derive.

## Which rendering shape: inline treatment, or hard navigate?

The WS-side `reauth-required` state renders `ReauthRequiredTreatment` in place — a persistent, `role="alert"` banner the user must click through, never an automatic navigation. Two ways this issue could realize "route to the same treatment":

1. **Inline, matching the WS precedent exactly:** on a `session_expired` 401, the call site swaps its content for `<ReauthRequiredTreatment role={...} returnTo={...} />`, same component, same click-through CTA, no automatic navigation.
2. **Auto-navigate:** on the same 401, immediately `window.location.href = "/auth/login?returnTo=..."`, skipping the in-page prompt entirely.

I'd push hard toward (1), for the same reason D1/D2 in `reauth-required-client-prompt`'s design.md landed where they did: an automatic navigation the user didn't initiate is a new interaction pattern nowhere else in this app uses for this state, and it's exactly the kind of surprise Devon-flavored concern I'd raise — a page that yanks itself out from under someone because a background fetch 401'd reads as "software running on the engineer," not a room they're in control of leaving. It also keeps the CTA discipline consistent: every existing `reauth-required` surface requires a click; this shouldn't be the one exception. This also sidesteps a bad interaction: if a facilitator's `start` POST 401s while they're mid-typing something else on the same page (unlikely on this specific page, but the general shape matters for future call sites), auto-navigating out from under them loses more than the click that triggered it.

**Why inline still wins on `DraftSessionHost.tsx` specifically, even under time pressure (Priya's review, item 2 — this is the one call site where "just get them back in fast" is a real counter-argument, and I want to say explicitly why it loses):** this is the one surface in the inventory where someone could argue urgency cuts toward auto-navigate — people are already waiting to join, so skip the click and get the facilitator back in as fast as possible. I don't buy it. A facilitator under time pressure is the person *least* likely to be reading the screen carefully; getting yanked to a login redirect with no explanation while they still think they're mid-click is more disorienting, not less, precisely because they're rushed. Inline, click-through stays the answer here too.

What the urgency *does* change is a layout requirement, not the rendering choice: `DraftSessionHost.tsx` already has a two-button confirm step ("Yes, open the room" / "Cancel") sitting exactly where this banner would need to render, and a rushed facilitator misreading a reauth prompt as another confirm-dialog button would be a bad moment to get wrong. The banner's CTA needs to be visually unmistakable from the confirm dialog's own buttons on this specific page — not a general styling note, a requirement tied to this layout collision. **I want a mock of the reauth banner rendered over the confirm-dialog layout before this UX is considered settled** — that's Design/proposal work, not something to build at exploration stage, and I'm flagging it here so it doesn't get skipped as "just reuse the existing component" once implementation starts.

## Ritual mechanics and protective constraints — checked, unaffected

Same conclusion I reached for the WS-side change, for the same reason: nothing here is a new authorization decision. `returnTo` is a destination, already validated and already re-authorized on landing by the destination route's own checks — this issue adds call sites that reuse that mechanism, it doesn't touch the mechanism itself. Re-authentication still runs through the same OIDC flow every login uses; a facilitator or participant who clicks through and lands back on `SessionLobbyPage`/`DraftSessionHost` resumes a role they already held, not a new one. No manager-participation, facilitator-from-another-team, or simultaneous-reveal logic is anywhere near this surface. I don't see a constraints-as-configurable-options risk here either — there's no new toggle, no new timing value, nothing to make optional.

One thing worth a sentence: `handleStartSession`/`handleBeginVoting`/`advance` are all facilitator-gated actions. A participant should never see these buttons in the first place (existing role-gating, unmodified), so this issue doesn't add any new facilitator/participant distinction beyond what `ReauthRequiredTreatment`'s existing `role` prop already handles (vote-loss sentence on/off).

## Forward note: what the room experiences while the facilitator is stuck in reauth on "open the room" (Priya's review, item 1)

This isn't work for this change, but I want it named rather than silently absent. With `DraftSessionHost.tsx`'s `advance` in scope, there's a narrow but real stall mode: a facilitator clicks "Open the Room," their absolute lifetime expires in that exact window, they get routed to `ReauthRequiredTreatment` inline, click through, land back on `DraftSessionHost`, and click "Open the room" again. From the facilitator's side that's a clean, bounded interruption — exactly what this change is built to produce. But I went looking for what a participant sees on the other end of that same window, and there isn't a participant-facing surface to design against yet: the only things that consume a join token today are the facilitator's own "not yet joinable" badge on the draft screen and `JoinErrorPage.tsx`. No "waiting for the facilitator" screen exists.

I'm not asking this issue to build one — that would be scope creep into a UI surface that doesn't exist, and inventing it here is exactly the kind of expansion this exploration has been careful to avoid elsewhere. What I want on record: **whoever eventually builds the participant-facing join/waiting experience needs to know that "the facilitator clicked Open the Room and nothing happened for a while" is a real, if narrow, failure mode this change can produce**, and that a silent stall there will read to a room of people staring at a join link as the tool being broken, not as a bounded auth interruption on the other end. One line in proposal.md's forward-looking notes, the same way the `ConnectionStatusBanner` gap on `SessionLobbyPage.tsx` is named without being fixed here.

## Provider-agnosticism check

Same conclusion as every prior change in this area: `/auth/login?returnTo=...` is already provider-agnostic (confirmed directly in `auth.ts` — the `returnTo` handling runs identically regardless of which OIDC provider is configured), and this issue adds no new IdP-aware code. Consistent with [[project_oidc_multi_provider]] — nothing here should become an Entra-specific shortcut.

## Shared 401-detection helper: stated contract (Marcus's review, item 5)

Open question 1 (below) leaned toward a shared helper without pinning down its shape — that's not yet a spec, and it's exactly the kind of gap that's invisible to whoever writes the exploration and obvious in hindsight to whoever implements call site four of five. Stating it now:

- **Body handling: the helper parses the response body itself, callers don't pre-parse it and hand in a parsed object.** Several call sites already call `.json()` once for their existing generic-error path (`DraftSessionHost.tsx`'s two branches, for example) — a second `.json()` read on a `Response` throws. The helper needs to own the read (or accept the `Response` before anyone else consumes its body), and existing call sites restructure to read the body once, through the helper, not twice.
- **`role` is a caller-supplied input, not derived from the response.** Nothing in the response body says whether the caller is a facilitator or participant — that's page-level context (which button rendered, which route it is), not something the 401 body encodes. Each call site passes its own `role` through to `ReauthRequiredTreatment` the same way the two existing consumers already do.

## Open questions for whoever picks up Design

1. **Mechanism shape at each call site:** a small shared helper (e.g., something that takes a `Response` and returns whether it was a disclosed session-expiry, so each call site can branch to `ReauthRequiredTreatment` uniformly) vs. hand-editing each call site's existing `if (!res.ok)` branch to add a `res.status === 401` check first. I'd lean toward a shared helper — the whole point is these call sites currently duplicate the same "generic non-ok handling" shape independently, and letting them independently reimplement the 401 special-case too just relocates the duplication problem instead of closing it. Should mirror `ReauthRequiredTreatment` itself: one shared implementation, not N call sites each getting their own judgment call about what counts as a session-expiry. Contract stated above.
2. **Detection key: `status === 401` alone, or `status === 401 AND category === "session_expired"`?** I lean toward the latter, given the `teams.ts` category inconsistency I found and the possibility of other 401 causes (e.g., a route-specific authorization 401 that isn't a session-timeout at all) getting mis-routed into a "your session expired" message that isn't true. Reading the response body on every 401 is new — none of the three named call sites read the body today.
3. ~~Does `SessionLobbyPage.tsx` also react to `useConnectionHealth`'s already-available `state === "reauth-required"`, in addition to the fetch-response check?~~ **Resolved above:** yes, consume both, first-signal-wins/second-is-a-no-op.
4. **Is `DraftSessionHost.tsx` in scope?** I think yes — see the acceptance conditions for both its call sites stated above. If yes, its route shape (`/team/:teamId/session/:sessionId`) needs the third `returnTo` allow-list entry specified above; that task is conditional on this scope decision.
5. **Is the `teams.ts` `invalid_request`/`session_expired` category inconsistency fixed in this change or filed separately?** Resolved above as mechanically downstream of question 6 — not independent.
6. Full inventory sign-off: EM pages, `MemberManagement.tsx`, `SessionCreationPage.tsx` — in scope for completeness, or deliberately deferred as non-ritual-critical the way this exploration frames them? I don't have a strong lean; either is defensible, but it should be a stated decision in proposal.md, not an implicit one. This is the one open question left genuinely open — resolving it mechanically resolves questions 4 and 5.

## Already proposal-ready — don't relitigate these (Marcus's review, item 6)

- The severity/scope split from `session-timeout-continuity` (WS gap vs. HTTP gap) — well-grounded, correctly not reopened here.
- The `returnTo`-lands-on-the-page-not-mid-action nuance, and the no-partial-execution guarantee (`session_expired` runs in `onRequest`, so a 401'd POST is guaranteed never to have executed) — both precise, both now stated as requirements above, not gaps to fix.
- Inline rendering over auto-navigate, including on `DraftSessionHost.tsx` specifically under time pressure — argued and settled, consistent with D1/D2 precedent.
- Provider-agnosticism — consistent with [[project_oidc_multi_provider]], no Entra-specific assumption anywhere in this surface.
- OR-1.7, the pre-expiry warning, and WS-side work — correctly excluded, no scope creep.
- The vote-reveal question — `advance` is room-opening only, doesn't touch or come near the reveal path (stated above).
- The vote-loss copy fork — already handled by `ReauthRequiredTreatment`'s existing `role` prop; `DraftSessionHost.tsx`'s new call sites just pass `role="facilitator"`.

## Recommendation

This is a small, mostly-mechanical, frontend-only change, and I don't think it needs the scope debate the WS-side change did. Concretely:

- **In scope:** a shared client-side helper (contract stated above) for recognizing a `session_expired` 401 (checked against `category`, not bare status) and rendering `ReauthRequiredTreatment` in place (not auto-navigating), wired into `SessionLobbyPage.tsx`'s three call sites (as the issue names, plus now also consuming `useConnectionHealth`'s `state` per the resolved architecture fork above) and `DraftSessionHost.tsx`'s two (a correction to the issue's own inventory, each with its own stated acceptance condition above).
- **Needs an explicit decision, not a default:** whether the lower-stakes EM/team-management pages are included (open question 6) — this is the one item still genuinely open, and it mechanically resolves the `teams.ts` category-label question once it's decided.
- **Confirm, don't assume:** the `returnTo` allow-list already covers every route shape this change needs — it does not, today, for `DraftSessionHost.tsx`'s combined team+session path (task specified above, conditional on the scope decision).
- **Not in scope, correctly:** OR-1.7 state restoration, the pre-expiry warning, anything WS-side (already shipped), and the participant-facing waiting UI (doesn't exist yet — forward note only, above).

I checked, again, for a path around the no-manager or facilitator-from-another-team rules: there isn't one. This is exclusively about what a user sees after an authorization decision the server already made, never about how that decision is made.

## References consulted

- GitHub issue #146 (this issue) and its full body, including the referenced Open Questions/tasks.md task 5.5
- `openspec/changes/archive/2026-09-22-session-timeout-continuity/` — design.md (Decisions 1, 3, 4, Open Questions), tasks.md (task 5.5), champion-signoff.md — the WS-side precedent and this issue's direct provenance
- `openspec/changes/archive/2026-09-18-reauth-required-client-prompt/design.md` — D1 (assertive/persistent, non-modal), D2 (CTA is user-initiated, never auto-navigated, live from first render), D9 (single shared rendering subcomponent) — the precedent I'm holding the inline-vs-auto-navigate question against
- `packages/backend/src/auth/middleware.ts` — `authMiddleware`'s `onRequest` hook (lines 156-242), the single real source of ritual-relevant `session_expired` 401s
- `packages/backend/src/routes/sessions.ts`, `facilitator-sessions.ts`, `teams.ts` — grepped directly for `category: "session_expired"` vs `category: "invalid_request"`, confirming the category-label inconsistency
- `packages/backend/src/routes/auth.ts` — `RETURN_TO_ALLOW_LIST`, `validateReturnTo`, `/login` and `/callback` handlers — confirmed provider-agnostic, confirmed no allow-list entry for a combined team+session path
- `packages/frontend/src/pages/SessionLobbyPage.tsx` — all three fetch call sites read directly, and confirmed it calls `useConnectionHealth` but discards `state`
- `packages/frontend/src/pages/DraftSessionHost.tsx` — read directly; confirmed the same generic-401-handling gap on `facilitator-state`/`advance`, not named in the issue
- `packages/frontend/src/components/ReauthRequiredTreatment.tsx`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx` — confirmed current `returnTo`/`role` prop shape and how existing call sites compute `returnTo`
- `packages/frontend/src/realtime/connectionHealth.ts` — confirmed `useConnectionHealth`'s `{ state, socket }` return shape and the state machine's existing wiring to `REAUTH_GRACE_EXPIRED_CLOSE_CODE`
- `packages/frontend/src/auth/AuthContext.tsx` — confirmed the separate, pre-existing, explicitly-not-this-issue's-problem unparameterized-redirect gap named in the issue body
- Grep of all `/api/v1/*` fetch call sites across `packages/frontend/src` — the full inventory beyond `SessionLobbyPage.tsx`
- `requirements/implementation team personas/Internal Champion - Persona.md` — my own standing concerns (constraints-as-configurable-options, the tool feeling like software rather than a room)
- Memory note: OIDC auth must remain provider-agnostic (Entra is primary today, not exclusive) — checked against this issue; no provider-specific assumption found

**Added in this revision, addressing reviewer feedback:**

- `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado) — the two reviews this revision responds to, addressed inline throughout
- `packages/frontend/src/components/MemberManagement.tsx:96-113` — read directly to confirm `loadMembers` never parses the `teams.ts` `GET /teams/:teamId` response body or branches on `category`, resolving Marcus's ask to verify rather than assume this before calling the `teams.ts` relabel mechanical
- `packages/frontend/src/pages/AuthErrorPage.tsx:11-18` — confirmed its `category === "invalid_request"` check reads an unrelated OAuth-callback URL param, not the `teams.ts` fetch-response body — ruled out as a consumer that a `teams.ts` relabel would break
- `packages/frontend/src/pages/DraftSessionHost.tsx` — re-read in full to verify the exact line ranges of both 401 branches (`:58-65` GET, `:85-91` POST), the in-memory `confirming` phase (`:39,49`), and that no reveal/live-voting UI is wired into or reachable from this component
