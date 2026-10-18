# Facilitator review: exploration notes for bulk-restore-default-topics (#218)

Reviewer: Priya Nair, Facilitator (SME). Worked independently.

## Overall

The notes are strong on guardrails and thin on the person standing at the screen. Almost every item is about server correctness, audit and limiter. That is right for the backend, but the notes never describe a facilitator's actual moment: it is the day before a session, I am on the topic management screen, and I want the shared language back. The notes do protect the live session (runtime untouched, no config, no pacing impact), which is the part I care about most. A management-screen feature that stays out of the room is fine. My concerns are about whether it is quick and unsurprising when I use it, and whether it can leak into the session.

## Observations

1. **Pain point is captured, but only in one sentence.** "Twelve steps, each with its own dialog" is real. What is missing is the cost of the failure mode: I tailor, I regret it on the night before a session, and I am rushing. A multi-step chore at that moment means I either skip it or run the session with a topic set the team did not intend. The notes should frame this as pre-session prep under time pressure.

2. **Appending restored defaults at the end is the thing I would notice most.** The order of topics is the order of the session (FR-2.7). If my custom topics sit first and the defaults land last, I will be surprised unless the dialog says so. The notes do propose honest copy ("added to the end of your list, in this order"); I agree that is necessary, not optional. But the notes treat "reorder with existing controls" as a sufficient answer. Reordering up to 12 topics one at a time is the same chore this feature exists to remove. I accept deferring reset-to-canonical-order, but the proposal should state the known cost plainly and say how many reorder steps a typical case needs.

3. **The "go back to baseline" path is the 90 percent case, and it works.** Archive some defaults, no customs, restore all: canonical order comes back. Good. Please make this the primary acceptance scenario, not an afterthought in 4.6.

4. **Duplicates after zero-topic recovery (5.2) is correctly flagged as the sharpest edge, but the notes treat it as a data problem.** For me it is a trust problem. Two copies of "Mad/Sad/Glad"-style topics in an active list would show up in the room, in front of the team, as duplicate cards in the vote. Whichever rule is chosen, duplicates must never be silently produced. Skipping and reporting is better than restoring and warning.

5. **Result feedback is under-specified for a person, well specified for an API.** "Nothing to restore" for the empty case is good. For the success case I want one line: "Restored 5 topics. They are at the end of your list." Not a banner, not confetti (agree with 5.9). I also want to see the restored topics visibly identifiable afterward, otherwise I am scanning the list to find what came back.

6. **Stale preview (5.10): agree with report-what-actually-happened.** But the result message must differ visibly from the preview if the set changed, for example "Restored 4 topics (1 was already restored)". Otherwise I will believe my preview.

7. **Dirty-draft interaction (5.11) is a real usability point.** Losing unsaved definition text because a refetch ran is exactly the kind of thing that makes me stop trusting a tool. Good catch. Please make the disabled-with-reason message plain: "Save or discard your edit first."

8. **Mutual exclusion with a live or scheduled session is not discussed.** The notes say the session runtime is untouched, which is good, but not what happens if I click restore while a room is open or a session is in progress for this team. FR-2.7 says the order in effect at room open is the session's order. Does a restore mid-session change what participants see? It must not. If topics are snapshotted at room open, say so and add a test; if not, the bulk action must be blocked or must not affect the live session. This is the single biggest gap for "disappears into the background during sessions".

9. **Who sees the control.** The notes cover authorization at the API level (facilitator non-member or admin). They do not say what a member sees. A participant should not see the button at all, not a disabled one with a lecture. A disabled button with a reason is right for me (dirty draft); hiding is right for people who cannot use it.

10. **Does the audit trail help me or watch me?** One row per action is fine. But "who restored" is shown to whom? The notes say no leaderboards. I would add: nothing about restores is visible to participants, and nothing in the team-facing UI reads as a record of who tinkered with the topic set.

## Questions

- If I restore defaults between sessions and the previous session's history references those topics, does the trend view for them look sensible, or confusing? The notes defer this (5.12). I want the gap explained in plain language somewhere, even if the fix is later, because a facilitator who picks up a team (continuity) will see a hole and not know why.
- What does a facilitator with a team that has archived 11 of 12 defaults see in the confirm dialog? A list of 11 names is long. Is it scrollable, collapsed, or truncated with a count?
- If the restore partially overlaps with something I have deliberately archived because the team disliked it, is there any way to exclude one? The notes say all-or-none. I think that is correct for this issue, but the proposal should say that selective restore is single restore, and that the dialog should make this obvious ("To bring back only some, restore them one at a time").
- Is there an undo? I restored too many. Archiving each again is the original chore in reverse. A one-line acknowledgement that there is no bulk undo, and why that is acceptable, would be honest.

## Suggested additions to the exploration

1. A short "facilitator scenario" section with the pre-session story and the three outcomes: back to baseline (main), tailored plus a few defaults back (order cost), nothing to restore.
2. An explicit statement on live or in-progress sessions: restore cannot alter the order or content of a session already opened.
3. Hide the control from non-facilitators; disable with a reason only for facilitators who are temporarily blocked.
4. Result copy requirements: count, "added to the end", and a delta line if the actual set differs from the preview.
5. Visual marker or ordering aid so restored topics are easy to find after the refetch (even a temporary highlight on the management screen only, never in session views).
6. A note that selective restore and bulk undo are consciously not offered, with the single-restore path named as the alternative.
7. Usability test item: I offered to test the facilitator view. Include this management flow in that test, with a scripted case of archive 5, restore all, and confirm I can tell what happened without reading the list.

## Verdict

The exploration would lead to a feature that stays out of the session as long as item 8 is closed. It is currently over-weighted toward constraint integrity and under-weighted toward what the person sees and decides in the minute they use it. Nothing here needs to change the "same operation as N single restores" principle, which I agree with. It needs a facilitator-facing paragraph and the live-session guarantee spelled out.
