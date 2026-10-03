# Explore Review: Facilitator (Priya Nair)

**Reviewer:** Priya Nair, Staff Software Engineer, cross-team Health Check facilitator (SME)
**Reviewed:** `exploration-notes.md` (Devon Calloway), 2026-10-02
**Lens:** Does this change stay invisible to a facilitator doing real work, before, during and after a session?

---

## Overall

Devon's notes are good and I agree with the stance. Most of this change is plumbing I should never notice. The rate limiter is the only part a facilitator will ever *see*, and the notes rightly treat it as the real work. My comments are about how and when a facilitator meets it. If the limiter fires, it must look like a deliberate guard and not like the tool breaking. My bigger worry is that it fires in the wrong *moment*: in the minutes before a session, or with a team watching.

I have no opinion on the Redis, Lua or extraction details. I defer to engineering there.

---

## Observations

### O1. The notes model one kind of curation sitting. There are three.

Section 2 describes "post-first-session tailoring". That's real, but in my experience topic work happens in three distinct moments, and each one tolerates a 429 differently:

| Moment | What I'm doing | Cost of a 429 |
|---|---|---|
| **Post-first-session tailoring** | Heavy edit with the team lead: archive several, add a few, reorder, annotate. | Annoying. I have time to wait. |
| **Pre-session prep (5–15 min before the room opens)** | A quick last pass: restore something a team asked for, add a topic someone raised in Slack, fix a definition. | **High.** I'm on the clock with people about to join. A "try again in 8 minutes" message can push the session start back. |
| **Facilitator handoff / returning after absence** | A new facilitator reviews and cleans up a list they inherited, often for several teams in a row. | Medium. It also hits exactly the person with the least context about why it happened. |

The pre-session window is the one that matters for "disappears into the background". The threshold decision should be tested against it explicitly, not only against the restore-the-baseline worst case.

### O2. Annotation edits can happen *with the room watching*.

The "shared team definition" (TOPIC-007) is often settled in conversation: the team argues about what "Codebase Health" means, agrees, and I type it in. Sometimes that happens in the lobby or right after a session while people are still on the call. The notes rightly say the limiter must never wrap room open, advance or voting. But if annotation joins the shared bucket (§5, which I support for consistency), a facilitator who has just done a big tailoring pass can be blocked from saving a definition **in front of the team**. That's the one place this change can make the ritual feel like software. Thresholds should leave clear headroom above a heavy tailoring pass, so the next annotation still saves.

### O3. Restore-the-baseline is the right worst case, and the ≥60/10 min floor seems reasonable.

I agree with Devon's reasoning: about 15–20 defaults, archive taking two requests, and a facilitator serving several teams on one per-actor budget. One addition: I look after three teams. If a reorg or a new team-template rollout made me re-tailor all three in one morning, I'd plausibly do 2–3× the single-team worst case in under an hour. The **daily** cap is where that bites, not the burst. A daily number copied from TEAM-006 (100/24h) would be too low for a multi-team facilitator on a heavy day.

### O4. Partial completion is the real usability hazard, more than the 429 itself.

Restore, archive and add are one request per topic. If I'm halfway through restoring 18 topics and hit the limit at topic 12, the list is in a half-done state. That's fine as long as:
- the topics that succeeded stay succeeded and the page shows them (the existing post-write refetch should cover this), and
- the 429 message tells me plainly that *some* changes saved, and *how long* to wait.

The notes don't consider this mid-batch state. It deserves a sentence in the proposal and a test.

### O5. The frontend already shows the server's error message on most write paths. That's useful.

I checked: `TopicManagementPage.tsx` archive (`:763`) falls back to the server's `error.message` when one parses, and the add, reorder and definition paths use similar fallbacks (`SAVE_FALLBACK_ERROR`, `DEFINITION_SAVE_FALLBACK_ERROR`, `ADD_RETRY_MESSAGE`). So a well-written **server-side** 429 message gets a facilitator most of the way even before any dedicated frontend work. A generic message like "Rate limit exceeded" would be shown verbatim, and it reads like an error. The envelope message should be written for a facilitator, not for an API consumer. That makes open question 10 cheaper than the notes imply. It's mostly copywriting plus making sure every write path shows the message.

### O6. Don't lose what I typed.

On a 429 the definition editor, the add-topic form and the unsaved reorder draft must keep their contents. The add form already preserves fields across retries (`:194`) and reorder keeps its draft on error. The definition editor should be confirmed too. Losing a carefully worded definition to a rate limit would be the worst version of this.

### O7. Fail-closed 503 during a Redis outage is acceptable, with one caveat.

I agree with Devon: Redis down probably means sessions are failing anyway. But the 503 message should say "temporarily unavailable, your topics are unchanged", not just "unavailable", so I don't wonder whether a half-applied reorder happened.

### O8. Items 1, 2 and 4 are invisible to me, and they should be.

The case-insensitive lock, the teamId validation and the consistent `TEAM_NOT_FOUND` don't change anything a facilitator sees. The one facilitator-relevant point is the template-guard hazard (`topics.ts:210`). "The baseline stays restorable" is a property I rely on when I tell a nervous team "we can always go back to the defaults". I support lowercasing at entry.

---

## Questions

1. **What does a facilitator actually read on a 429?** Please put the proposed message text in the proposal so I can review it. My suggestion: *"You've made a lot of topic changes in a short time. Changes so far are saved. You can continue in about N minutes."* Use minutes, rounded up, and never raw seconds.
2. **Do Restore or Remove buttons disable while limited, or do they let me click and fail again?** Repeated failing clicks feel broken. A disabled state with the countdown text feels intentional. (Frontend scope is open question 10. I'd argue that at minimum the message renders, and disabling is a nice-to-have.)
3. **Does the 429 surface where I was looking?** Archive errors render per row (`removeState.topicId`). Reorder errors render near Save. Is there a single place for a page-wide "you're paused" state, or does each control report it separately?
4. **Is the budget per actor or per (actor, team)?** The notes say per actor. That's the right security choice, but a multi-team facilitator would be surprised that work on Team A affects Team B. The message should not imply "this team is locked".
5. **Are admins on the same bucket and thresholds?** An application admin doing a multi-team cleanup is the heaviest legitimate user.
6. **Is anyone alerted when a real facilitator trips the limiter?** The audit row exists. If a legitimate facilitator ever hits it, that's a signal the threshold is wrong. Someone should look at that, not just log it.

---

## Suggested additions to the exploration / proposal

1. **Add the pre-session prep window (O1) and the in-room annotation case (O2)** to the threshold inputs alongside restore-the-baseline. Add a ritual-integrity checkbox: *"A facilitator who has just done a full tailoring pass can still save a definition and make small pre-session edits without a 429."*
2. **Size the daily cap for a multi-team facilitator on a heavy day (O3)**, not by analogy to TEAM-006.
3. **Bring frontend 429/503 messaging into scope, at least minimally** (resolve open question 10 as "in"). Facilitator-facing server message copy, `Retry-After` shown in minutes, and every write path displays it. Without it, the limiter's first real trigger looks like a bug, which I agree is an adoption risk.
4. **Specify mid-batch behavior (O4).** Successful writes persist and are shown, and the message says changes so far are saved. Add a test that restores N topics, gets limited at N−k, and checks the page reflects the k that succeeded.
5. **Preserve unsaved input on 429/503 (O6)** for the definition editor, the add form and the reorder draft.
6. **Treat a legitimate-facilitator 429 as a threshold bug (Q6).** The decision document should say how a facilitator reports one and who revisits the numbers.
7. **Follow-up, not this change:** a single "Restore default topics" bulk action would remove the worst case altogether and would be a nicer facilitator experience than 18 individual restores. It's worth filing as a separate issue so the limiter thresholds don't have to carry that burden forever.

---

## Verdict

The exploration is sound on ritual safety: the limiter stays off the live-session path, uses a per-actor budget and doesn't open an enumeration oracle. It's lighter on **the moment a facilitator meets the limiter**. Cover the pre-session window, in-room annotation, mid-batch partial state and the 429 copy, and this change will stay in the background the way it should.
