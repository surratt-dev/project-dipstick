# Tasks Review — Business Analyst (Marcus Delgado)

**Reviewing:** `tasks.md` against `proposal.md` (and, where needed to confirm a translation, the delta spec files under `specs/`).
**Question I'm answering:** do the tasks, taken together, cover every capability the proposal commits to — and is anything lost in translation from requirement to task?

## Overall

This is a well-translated task list. The two things I care about most on this change — simultaneous-reveal-adjacent integrity concerns don't apply here directly, but the analogous concern, **no participant identity leaking to the wrong audience** — is covered with more rigor than the proposal itself demands: Task 1 doesn't just replicate the EM dual-check, it catches and fixes a real gap in the existing `sessions.ts` query (missing `membership_exists` check) that the proposal didn't even know about, and adds audit logging that wasn't in my original requirements at all. That's the kind of thing I want to see — the security review's findings made it into concrete, numbered tasks with test coverage, not just a note in design.md that implementers might miss.

The registration-gap closure (D7) — the thing I was most worried would get silently dropped or re-deferred a second time, since it already survived one deferral in `session-lobby-routing-gap` — is Task 1, sequenced first and marked blocking. Good. The two-surface decision (D1), which the proposal spends real words justifying against the cheaper single-surface path, has its own cross-cutting verification task (6.1) confirming no drift between the two renders. Also good — that's exactly the kind of thing that erodes silently if nobody's explicitly checking for it.

## Two coverage gaps worth closing before implementation starts

**1. Page-refresh restore is tested for `DraftSessionHost` but not for `SessionLobbyPage`.**

The roster spec's own "Facilitator refreshes the page" scenario names both surfaces explicitly: *"WHEN the Facilitator refreshes `DraftSessionHost` or `SessionLobbyPage`... THEN the participant list is restored... AND no participants are lost, including any currently marked disconnected."* Task 4.3 tests this for `DraftSessionHost` by name ("page refresh restores the roster without navigating away"). Task 5.3, the equivalent test block for `SessionLobbyPage`, only lists "roster appears and updates live" and "non-facilitator branch withholds identity" — no refresh-restore case.

I'd guess the shared-component architecture (6.1 confirms no drift) is doing the reasoning work here — "if it's tested on one surface via the same hook, it's covered." I don't love relying on that inference for a requirement the spec states per-surface, especially since `SessionLobbyPage` already has its own pre-existing WebSocket lifecycle that `DraftSessionHost`'s doesn't (it's the older of the two integrations) — a refresh-restore bug specific to that page's existing connection-teardown/reconnect path wouldn't be caught by a `DraftSessionHost`-only test. Add a refresh-restore case to 5.3.

**2. The empty-state prompt (name + join link together) is built but never explicitly tested.**

Task 3.4 builds it correctly, including the requirement I care about — join link stays visible next to the "no one has joined yet" prompt, so the Facilitator isn't staring at a link-less dead end. But no test task asserts it renders. Task 3.6's unit test list doesn't include it; Task 6.2's e2e test starts from "two Engineers join... in sequence," which skips past the empty state rather than asserting it first. Backend task 2.3 tests the *API* returns an empty list correctly, which is a different thing from the *page* showing the right empty-state UI.

This matters more than it looks like on paper: the source AC's very first line is "displayed immediately after session creation, before any participants join" — the empty state isn't an edge case here, it's the state every session starts in, and it's the state a Facilitator sees on every single session for at least a few seconds. Untested UI in the state that's guaranteed to render first is exactly the kind of gap I've watched turn into a production surprise on internal tools. Add an explicit assertion (unit or e2e) that the empty-state prompt and the join link both render when the roster has zero participants.

## Smaller note, not a gap

The proposal's Impact section is explicit that the new shared roster component is "distinct from `FacilitatorReadinessGrid.tsx`, which is issue #33's live-voting component and answers a different question." Tasks 3.1–3.6 build the new component correctly but never reference this distinction directly. I don't think this needs its own task — it reads as a naming/architecture caution for whoever picks up Task 3, not a missing capability — but I'd flag it for the code-review checkpoint (6.1 seems like the natural home) so nobody building this a few weeks from now absentmindedly extends `FacilitatorReadinessGrid.tsx` instead of building the new hook, on the theory that "there's already a facilitator roster-ish component."

## What translated well, worth naming explicitly

- The non-goals (no quorum counter, no removal control, no "Present" badge) all show up as *negative* build instructions in Task 3.4 rather than being left to be inferred from silence — that's exactly the pattern I want, because an unstated non-goal is the first thing that gets "helpfully" added back in by someone who wasn't in the room for the original decision.
- D1's correction (structural extraction in `DraftSessionHost`, not a flat conditional) made it into Task 4.1 with the full failure-mode rationale (reconnect-backoff storm against `CLOSE_UNAUTHORIZED`) intact, not compressed into "refactor as needed." That's the difference between a task an engineer can build from directly and one that sends them back to design.md mid-implementation.
- D3a's unrecognized-`userId` re-fetch subtlety — easy to lose in translation since it's a one-paragraph design nuance — is preserved in both 3.1 (fetch function must be re-invocable) and 3.6 (explicit test for the re-fetch-and-real-name-renders behavior).
- The AC Reconciliation note (existing-team flow doesn't get the roster "immediately after session creation" the way new-team flow does) correctly generates *no* task — it's a documentation clarification, not a build item, and tasks.md doesn't manufacture busywork trying to "fix" a non-gap.

## Verdict

Two additions (refresh-restore test on `SessionLobbyPage`, explicit empty-state render test) and this is ready to build from. Everything else I'd have flagged — the registration gap, the two-surface commitment, the EM-exclusion propagation, the non-goals — is already there with the reasoning attached, not just the instruction.
