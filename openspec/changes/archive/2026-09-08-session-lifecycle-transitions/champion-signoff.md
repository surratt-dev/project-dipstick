# Champion Sign-Off — session-lifecycle-transitions

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-09-08
**Verdict: Signed off.** The ritual's intent is preserved. The one guarantee I said I cared about most at the start of this pipeline is now real, correctly gated, and independently verified by two separate reviewers.

---

## The simultaneous reveal — no longer unreachable code

I wrote, in the exploration notes, that this was "the load-bearing constraint I care about most in this application" and that it "has no code." That was true then. It isn't now.

I checked the two implementation reviews independently rather than taking either one's word for the other. Ingrid (Architect) and Tomás (Security) read the actual committed handler code — not tasks.md's claims about it — and both landed on the same facts: the reveal write is a conditional `UPDATE ... WHERE status = 'voting'` with a row-count check, a second call against an already-revealed topic returns a hard `409`, and the publish to `vote_revealed` only fires after the enclosing transaction's `COMMIT` succeeds, never before. Both reviewers traced this by line number against the actual transaction boundaries rather than trusting the design doc's description of it. Both independently ran the test suite and got the identical number: **418 passed, 1 skipped, 0 failed** — the skip being the pre-existing Redis/Postgres-gated integration test, not something this change introduced. That kind of exact agreement between two people who checked separately, rather than one person checking and the other citing it, is what "verified" is supposed to mean.

The advance-before-reveal side of the gate is equally solid: a hard `409` (`advance_blocked`) on any attempt to move past a topic that hasn't been revealed, auth-checked before the precondition in both handlers, confirmed by tests that assert the transaction is never entered when authorization fails — not just that the response body is right.

The 409s are also specified the way I asked for them to be, not left to the frontend to improvise: a re-reveal must render indistinguishably from a successful reveal, no error chrome, and an advance-before-reveal block must land the facilitator somewhere they can act, not a dead end. That's tracked as an explicit frontend acceptance task (5.2), not assumed to fall out of the API contract for free.

## The vote lock-in race fix — correctly prioritized, not smuggled in

This is the part I want to be plain about, because it's the difference between a change that does what it says and one that quietly ships a hole while fixing a different one. Once the reveal write became real, a vote submitted after reveal but before the lock-in handler checked topic status could have been silently admitted into an already-revealed topic's result set — a direct violation of FR-4.7's immutability guarantee, and the exact kind of exception-that-becomes-a-norm I've spent a long time watching happen to rituals like this one.

This wasn't found late and patched in. It's named in the proposal itself as a "required correctness fix, not previously identifiable as a gap because nothing ever set `session_topics.status = 'revealed'` before now," and tasks.md gates it as Group 2, ahead of Group 3's reveal write, specifically so the write couldn't ship without it. That's the right order and the right instinct: don't let the fix for one gap open a new one. Both reviewers confirmed the fix is real — a `session_topics` row lock in the lock-in transaction, a losing race resolves cleanly to `422`, and no deadlock is possible because each transaction takes at most one lock on the contested row.

The one honest asterisk here, and both reviewers named it independently rather than one catching what the other missed: the test asserting this fix is a single-request mocked-`pg`-client simulation, not a true concurrent-transaction integration test against live Postgres, because this codebase has no live-DB test lane at all — a pre-existing infrastructure gap, not something this change introduced or should have been expected to solve on its own. The row-locking logic itself was independently re-derived and confirmed sound by both reviewers against Postgres's actual locking semantics. I'd like a real integration test to exist before I'd call this fully closed, but I'm not withholding sign-off for a testing-infrastructure gap that predates this change and that both reviewers flagged with equal candor rather than papering over.

## What's still open — named, not dropped

Four of fifty-five tasks are unchecked, and I checked what they actually are rather than trusting the count:

- **3.12 / 4.15** — cross-change end-to-end verification against live Redis/Postgres, blocked on sandbox limitations. This belongs to the *other* change's task list (`websocket-delivery-time-authorization`) and needs someone to close it out before I'd call issue #26 fully resolved end-to-end, but it isn't a design gap in this change — the architect review says so directly, and I agree.
- **5.1 / 5.2** — frontend acceptance work, correctly deferred because there is no frontend in this codebase yet to do it against.

**Issue #27 (SEC-25/SEC-26)** is the one I want on record as now genuinely time-sensitive rather than theoretical. Tomás's review is precise about why: `publishVoteRevealed` and `publishTopicHistoryUpdate` were previously called only from unit tests — there was no production trigger. As of this change, they're called from real, committed writes. An idle connection whose authorization grant still evaluates true but whose token is stale, or which hasn't been re-challenged within the interval SEC-25 wants, will now actually receive real vote content the first time a reveal fires, where before there was nothing live to receive. Both the design-stage and implementation-stage security reviews flagged this as the same underlying gap crossing from theoretical to exercised. I'm not blocking on it — it's tracked, it's understood, and reprioritizing it is an operational decision above my seat — but I want it said plainly here too: this is no longer a "someday" ticket.

## The two deferred follow-on changes

I read both stubs, not just their existence. `team-membership-removal` and `topic-skip-and-creation-time-confirmation` are real, scoped continuations — each has a named owner (Marcus, per the exploration notes' own recommendation), a stated reason for deferral that traces back to a specific decision in this change's proposal, and a "scope to design when picked up" section that isn't vague. Neither is a loose thread quietly dropped to make this change look more finished than it is. `team-membership-removal` correctly carries forward the mid-session-removal open question I raised in the exploration notes rather than letting it disappear between two documents. `topic-skip-and-creation-time-confirmation` correctly bundles the skip-path design with the creation-time topic-list signal gap, which is the right call — they're the same underlying problem, not two separate asks.

## Closing note

The parts of this ritual that keep the wrong people out of the room — no-manager participation, facilitator-from-another-team — were never touched by this gap and aren't touched by this fix. What was missing was the part that makes the room do what it's supposed to do once people are in it, and that part is now real, tested, and reviewed by people who checked each other's work instead of taking it on faith. That's the standard I care about. This clears it.

**Signed off. No blocking concerns.**

— Devon Calloway
