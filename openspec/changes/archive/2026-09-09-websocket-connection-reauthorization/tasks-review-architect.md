# Tasks-Stage Review: websocket-connection-reauthorization

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Stage:** Tasks (tasks.md, cross-checked against design.md and proposal.md)
**Date:** 2026-09-09
**Scope of this review:** task ordering against architectural dependencies only. I am not re-litigating the SEC-25/SEC-26 mechanism decisions (D1–D9a) — those went through two full design revision passes, including the grace-period-recovery rebuild after the original mechanism was found structurally unbuildable, and I'm not reopening that here. This review asks one question: does the sequence in which tasks.md asks the team to build things match the sequence in which the design actually requires things to exist.

---

## 0. Bottom line

The big-rock sequencing is sound: Group 1 is the right shape for a shared-prerequisite group, Group 3 does not actually need Group 4 to exist in order to be built and tested, and the Group 4/Group 5 split of the marker-consumption-then-audit-write sequence is a clean one-directional dependency, not a broken handoff. I did not find a circular dependency anywhere in Groups 1–5.

I found four real issues, all fixable as tasks.md edits, none requiring a design reopen:

1. **Task 1.9 forward-references two files that don't exist yet.** It asks Group 1 to add module-local constants "in `connection-reauthorization.ts`" and "in `connection-token-refresh.ts`" — but those files are *created* by tasks 2.1 and 3.1, which come after Group 1. Section 1.
2. **Group 4's "Depends on" header is missing Group 2.** Task 4.5's negative-acceptance scenario requires the SEC-25 sweep close path (Group 2) to exist. Section 2.
3. **Group 6's "Depends on" header is missing Group 3.** Task 6.2 requires a SEC-26 refresh cycle to be running concurrently with the sweep, not just the sweep. Section 2.
4. **Group 8 mixes true final gates with duplicate regression checks that could be confirmed immediately after the group that actually produces them** — 8.1 duplicates 1.4, 8.5 duplicates 3.7. Not wrong, but worth calling out explicitly so nobody reads Group 8 as "nothing here is checkable before everything else lands." Section 4.

The two specific hand-off relationships I was asked to look at hardest — Group 3's "hand off to Group 4" language, and the Group 4/Group 5 split at task 4.4/5.1 — both came back clean, with one clarifying note on the former. Sections 3 and 3b.

---

## 1. Task 1.9 depends on files Group 1 hasn't created yet

Group 1's header states: *"No dependencies. Must land before Groups 2–5 can compile against real types."* Read plainly, that's a claim that Group 1 is self-contained — nothing in it should require anything from a later group.

Task 1.9 breaks that claim:

> "Add `REAUTHORIZATION_INTERVAL_MS = 5 * 60 * 1000` **(module-local, in `connection-reauthorization.ts`)** and a 30-second grace-period constant **(module-local, in `connection-token-refresh.ts`)**."

Neither file exists at task 1.9's point in the sequence. `connection-reauthorization.ts` is created by task 2.1 ("Create `connection-reauthorization.ts`, exporting `scheduleReauthorizationSweep`..."). `connection-token-refresh.ts` is created by task 3.1 ("Create `connection-token-refresh.ts`, exporting `scheduleTokenRefreshMonitor`..."). Both of those are Group 2 and Group 3 tasks respectively — both of which declare themselves as depending on Group 1, not the reverse.

This is a real forward reference, not just an awkward reading. A team executing Group 1 literally cannot complete 1.9 as written without first doing part of 2.1 and part of 3.1 (at minimum, creating the two files). In practice an implementer will either (a) create two near-empty stub files in Group 1 containing only the constant, which 2.1/3.1 then treat as "already exists, add the exports" rather than "create," quietly contradicting 2.1/3.1's own "Create..." phrasing, or (b) skip 1.9 when doing Group 1 and come back to it once 2.1/3.1 exist, which means Group 1 is not actually completable top-to-bottom in one pass the way its header implies.

**Recommendation:** Move the constant declarations into the tasks that create their owning files — fold `REAUTHORIZATION_INTERVAL_MS` into task 2.1 and the grace-period constant into task 3.1 — and drop them from 1.9. If there's a documentation reason to keep "here are all the new constants" enumerated in one place in Group 1 (e.g., as a design-traceability summary), keep 1.9 but reword it to say explicitly that it's listing constants whose *declarations* land with the files that own them in Groups 2/3, not that Group 1 itself adds them. The current wording reads as an executable task, not a summary.

---

## 2. Two "Depends on" headers under-state their real dependencies

Both of these are labeling gaps, not sequencing defects — in both cases the groups are already correctly ordered *after* the group the header omits, because they come later in document order and because no earlier task assumes anything from them. The problem is that the stated dependency is incomplete, which matters here because these headers are the mechanism the rest of the document uses to tell an implementer "don't start this until X is done" — an incomplete header risks someone starting the group, hitting the missing piece only at the specific task that needs it, and treating that as a surprise rather than a stated precondition.

**Group 4** (SEC-26 Grace Period) states *"Depends on: Groups 1, 3."* But task 4.5 reads:

> "a connection closed via the SEC-25 sweep path (Group 2) receives `STALE_SIGNAL_CLOSE_CODE` and no `reauth_required` message..."

That's a test that exercises Group 2's close path directly — it can't be written or run until Group 2 exists. The header should read "Depends on: Groups 1, 2, 3."

**Group 6** (Reveal-Timing Independence Verification) states *"Depends on: Group 2."* But task 6.2 reads:

> "Integration test firing a `vote_revealed` push concurrently with an in-flight SEC-25 sweep tick **and SEC-26 refresh cycle** on the same connection..."

That's both mechanisms running concurrently, which means Group 3 has to exist too, not just Group 2. The header should read "Depends on: Groups 2, 3."

**Recommendation:** Amend both headers. This is a two-line fix and it's worth making regardless of how obvious it is in context — these headers are exactly the artifact someone skims when deciding what's safe to pick up next, and both currently understate the real precondition.

---

## 3. Group 3's "hand off to Group 4" — checked as requested, comes back clean, with one clarifying note

The specific concern raised: does Group 3 (SEC-26 refresh) genuinely depend only on Group 1, as its header claims, given that task 3.4 says to "send the client `reauth_required` ... and hand off to Group 4" for grace-period handling?

I traced this against what Group 3's own tests actually require. Task 3.8's acceptance list — silent refresh with no client message, retry-then-`reauth_required` producing exactly one `session.token_refresh_failed_live` row, `sessionCreatedAt` untouched, the already-refreshed-session skip, `"no_refresh_token"` reschedule — never touches the grace-period timer, the Redis correlation marker, or `REAUTH_GRACE_EXPIRED_CLOSE_CODE`. Task 3.7's ordering test (Decision D3a's `destroy()`-always-wins guarantee) is scoped to the conditional write, also independent of Group 4. So Group 3 is genuinely testable end-to-end — including everything task 3.4 is responsible for — without Group 4 existing. The header's "Depends on: Group 1" is accurate for what Group 3 needs to *build and verify its own scope*.

Where it's worth a clarifying note: task 3.4's "hand off to Group 4" is not a call into an already-built external API — it's a forward pointer to code that Group 4 (specifically task 4.2, "On grace-period start (task 3.4): write ... to Redis ... Start a single `setTimeout`") adds to the *same file* Group 3 creates in 3.1 (`connection-token-refresh.ts`). That's a sensible way to split the work — Group 3 owns "decide the refresh failed and the client needs to know," Group 4 owns "start and bound the grace window" — but as written, an implementer doing Group 3 first will reach task 3.4 and find nothing yet to hand off *to*. The likely resolution (send `reauth_required`, write the audit row, and literally do nothing else until Group 4 adds the grace-timer-start call at the same site) is inferable from the design doc but isn't stated in tasks.md itself.

**Recommendation:** Add one clause to task 3.4: *"Grace-period initiation itself (the Redis marker write and the `setTimeout`) is added by task 4.2 at this same call site — if Group 3 is implemented before Group 4, this step is a no-op placeholder until then."* This turns an implicit, design-doc-only inference into an explicit statement in the task an implementer is actually looking at.

### 3b. Group 4/Group 5 split at task 4.4 → 5.1 — checked as requested, correctly ordered

The specific concern: task 4.4 ("check for a live marker... hand off to Group 5 for the `session.connection_recovered` audit write") and task 5.1 ("At the point Group 4/task 4.4 resolves a marker match: ... write `session.connection_recovered`") describe one atomic registration-time sequence split across two groups. Is this a sensible split or a broken handoff?

It's a clean, one-directional dependency: 5.1 depends on 4.4 (the marker-detection code must exist before the audit write that fires "when a marker match is found" has anywhere to attach), and nothing in Group 4 depends on Group 5 — the marker gets consumed (deleted, single-use) regardless of whether the audit row is ever written. Group 5's header correctly states "Depends on: Groups 2–4." I don't think this is a broken handoff.

One coordination note, not a dependency-order defect: 4.4 and 5.1 both modify the same registration-time code block (both route handlers, at connection-registration time). If these are picked up as separate work items by separate people, there's a real chance of one PR landing "detect marker, delete it" with no audit write for a review cycle, then a second PR adding the write — which is fine sequenced (4 lands, then 5), but worth flagging so whoever plans the work doesn't split 4.4 and 5.1 across people who aren't coordinating, given they're editing the same handful of lines.

---

## 4. Group 8 (Final Gate): which items are genuinely blocked on everything, and which aren't

I checked each of Group 8's six tasks against what it actually needs to exist:

| Task | What it checks | Actually requires |
|---|---|---|
| 8.1 | Group 1 extraction introduced no HTTP behavior change | Group 1 only — **this is 1.4, restated.** |
| 8.2 | Disclosure-boundary scenarios 4.5/4.6 pass | Groups 1–4 (and, per Section 2 above, transitively Group 2 for 4.5) |
| 8.3 | No interval/grace-period/kill-switch is configurable, anywhere touched by Groups 1–5 | Groups 1–5, genuinely — it's an explicit sweep of everything those groups touch |
| 8.4 | All three new `audit_log` operations produce real rows | Groups 2, 3, 5 (each contributes one of the three operations) |
| 8.5 | `destroy()`-then-stale-write ordering never resurrects a session | Groups 1, 3 only — **this is 3.7, restated.** |
| 8.6 | File a tracking issue for the pre-existing HTTP-side audit gap | Nothing — no code dependency at all |

8.2, 8.3, and 8.4 are true final gates — they either explicitly scope themselves across all of Groups 1–5, or (8.2) depend on the last-landing group in the chain they check. Those belong exactly where they are.

8.1 and 8.5 are, respectively, near-verbatim restatements of task 1.4 ("Verify the full existing `middleware.ts` test suite passes unmodified... Add a test for the copy-back step itself") and task 3.7 ("Concurrency/ordering test for Decision D3a: an HTTP-side `destroy()` that runs before a stale, in-flight WS-side `conditionallyUpdateSession` write results in the session staying destroyed... Also test the reverse ordering"). If 1.4 and 3.7 are done correctly, 8.1 and 8.5 are already satisfied the moment Groups 1 and 3 land — there's no reason either has to wait for Groups 5, 6, or 7 to finish.

This isn't a defect — re-confirming a hard invariant at the final gate, right before shipping, is a defensible practice, especially for 8.5 given the "surveillance-adjacent" framing the document already applies to 8.2. But as written, Group 8 reads as a single block that's only checkable once everything else is done, and two of its six items aren't actually gated on that at all. 8.6 similarly has zero code dependency and could be filed the day this design was accepted.

**Recommendation:** No task-list restructuring needed, but add a one-line note at the top of Group 8 distinguishing "these are whole-system final confirmations (8.2, 8.3, 8.4)" from "these are point-in-time regression re-checks against invariants established earlier (8.1 re-checks 1.4, 8.5 re-checks 3.7) that can and should be confirmed as soon as their owning group lands, and are re-listed here only as a final-sweep sanity check before sign-off." That keeps the final-gate discipline intact while telling an implementer they don't need to sit on their hands waiting for Group 7 before re-running 8.1's suite.

---

## 5. Specific items verified — clean, no issues

**Group 1 as a prerequisite for Groups 2–5, circularity check.** Excluding task 1.9 (Section 1), every other Group 1 task is genuinely self-contained: 1.1–1.4 (extraction, copy-back, exported constants, regression test) touch only `middleware.ts` and pre-existing test infrastructure; 1.5 (`conditionallyUpdateSession`) touches only `session-store.ts` and is additive to it, explicitly not modifying the unconditional `set()` the HTTP path depends on; 1.6 (`WsClientMessage` variant) touches only `packages/shared/src/types/realtime.ts`; 1.7–1.8 (`RegisteredConnection` fields, `deregister()` clearing) touch only `connection-registry.ts` and `websocket-routes.ts`'s two existing construction sites; 1.10 (`AuditEventName` additions) touches only `audit-logger.ts`. None of these read or assume anything from Group 2, 3, 4, or 5.

**Whether any task assumes shared code before the task that creates it, beyond 1.9.** I checked every explicit cross-reference in tasks.md: 3.1's `conn.fastifySessionId` (created 1.7) and session-store `get` (pre-existing) — clean; 3.3's `conditionallyUpdateSession` (created 1.5) — clean, correctly cited by task number; 3.4/4.1's `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (created 4.1, used starting 4.3) — clean, created before its first use within the same group; 4.2's Redis client reuse (pre-existing, `session-store.ts`/`auth.ts`) — clean; 5.1's `actor_global_role` resolution pattern (pre-existing, cited as matching `facilitator-sessions.ts`/`content.ts`) — clean; 5.2's read query against `content.ts` — correctly flagged in its own task text as new work, not reused plumbing, matching design.md Decision D9's corrected framing. No other forward references found.

**`reauthSweepTimer`/`tokenRefreshTimer` field lifecycle.** Task 1.7 adds both fields and the one-line invariant comment design.md's Engineer Finding 7 asks for (verbatim, re: the single `tokenRefreshTimer` handle spanning three sequential phases). Task 1.8 extends `deregister()` to clear both alongside the existing `forceCloseTimer`, with an explicit double-`deregister()` no-op test. Groups 2 and 3 each populate their respective timer field and rely on 1.8's clearing — correctly sequenced after 1.7/1.8, no group clears a timer field before 1.7 creates it.

**Group 7 (spec correction).** Already marked done, performed during Design-stage review per its own annotation — no ordering question applies.

---

## 5b. One gap not caught above: no task wires task 4.4's marker check into `websocket-routes.ts`

Groups 2 and 3 each have an explicit wiring task naming the exact call site — 2.4 ("Wire `scheduleReauthorizationSweep` into both route handlers... immediately after `scheduleForceClose`") and 3.6 ("Wire `scheduleTokenRefreshMonitor` into both route handlers, alongside `scheduleReauthorizationSweep`"). Task 4.4 ("At WS registration time (both route handlers, either scope): check for a live `dipstick:reauth-grace:{userId}` marker...") describes the same class of registration-time logic but has no equivalent "add this to `websocket-routes.ts`" statement — it's phrased as what happens, not where it's added. Given 4.4's logic sits at the same registration site as 2.4's and 3.6's, and those two tasks both bothered to name the file and the existing calls to place the new one alongside, 4.4's silence on placement reads as an omission rather than an intentional difference.

**Recommendation:** add the same wiring clause to 4.4 (or to whichever task 4.4/5.1 are merged into, per Section 3b's coordination note): "...added to both route handlers in `websocket-routes.ts`, alongside the existing `scheduleForceClose`/`scheduleReauthorizationSweep`/`scheduleTokenRefreshMonitor` registration-time calls."

---

## 6. What I did not check

Per this review's scope, I did not re-verify the correctness of the SEC-25/SEC-26 mechanisms themselves, the Redis conditional-write race fix (D3a), the refresh-token-rotation residual risk (D3c), or the non-disclosure boundary's security properties (D5) — those were reviewed and accepted at Design stage by the engineer and security reviewers, across two revision passes, and none of my findings above require reopening them. This review is strictly: given the decisions as made, does tasks.md sequence the work the way the decisions require it to be sequenced. Sections 1, 2, and 4 are the three places where the answer is "not quite as documented, but the fix is a tasks.md edit, not a design change."
