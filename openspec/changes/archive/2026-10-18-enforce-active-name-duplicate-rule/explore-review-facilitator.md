# Explore review: Facilitator (Priya Nair)

Subject: exploration-notes.md for #299, given PO decisions (1) remove "Add anyway" on an active-name match, (2) no override of any kind, 409 on Add and single restore, bulk restore keeps skipping.

## Overall

I support the decision. In a live session, a duplicate topic name is a real hazard: two rows reading "Code review" make me ask the room "which one are we on?" while the clock runs, and the trend line for that topic forks without anyone noticing. Preventing it at the door is better than cleaning up later. My concern is not the rule but what the facilitator sees when the rule fires. The notes are strong on server mechanics and thin on the human moment. Most of my observations are about that.

## Observations

1. **Who actually hits this, and when.** Topic management is prep work, done between sessions or in the first minutes before a session. The restore conflict is the more likely trigger: I archived "Deployment confidence", someone added a new "Deployment confidence", and I now click Restore on the old one. That is a person tidying, not a person under pressure. The Add conflict is the "I did not realize it already existed" case, usually because the list was long or the match was archived-vs-active. Neither should be a dead end, but neither is a live-session emergency. This lowers the stakes of the hard reject, and it also means the message can afford to teach.

2. **The notes never say what the restore-conflict user sees.** Section 6 says "tell the user which active topic has that name" and stops. That is the key usability moment and deserves a design line. Minimum bar: a message that names the conflicting topic ("An active topic named 'X' already exists, so this one was not restored"), says nothing was changed, and offers a next step. A generic "Something went wrong" or a bare 409 toast is a failure here.

3. **"What to do next" is missing from both paths.** After a rejection the facilitator has three real options and the UI should surface them:
   - Leave the active one and forget the archived one (do nothing).
   - Archive the active one first, then restore the archived one (swap).
   - Choose a different name (Add only).
   The notes give the user no route to the swap. Since there is no rename, "archive the active one, then retry" is the only way to get the older topic back, and that costs the active topic's history continuity. At minimum the error copy should say "Archive the active topic first if you want to restore this one." Better, the error could link/scroll to the conflicting active row (the response already carries `conflictingTopicId`; use it).

4. **Add: the "Add anyway" removal changes the hint into a dead end unless copy is rewritten.** The notes flag the button but only as a decision to take. With it gone, the hint on an active match must say what to do: change the name, or (if the intent was the same topic) use the existing one. Do not leave the user staring at a warning with a disabled or missing submit and no explanation. Question: does the Add button disable while an active match is showing, or stay enabled and fail with 409? I would prefer disabled with an inline reason, so the server 409 is a backstop (race, second tab, stale list) and not the normal path. If the client hint can fully predict the rejection, the 409 should rarely be seen.

5. **Stale list is the realistic way users see the server 409 on Add.** Two facilitators or two tabs: the client hint compared against a list that was already out of date. The 409 message for that case should not read as an accusation. Suggest the client refresh the topic list on this error so the hint then explains the conflict with current data. Otherwise the user retries, fails again, and loses trust in the tool.

6. **Hint vs. server mismatch has a user-facing side effect.** The hint also matches on prompt equality, the server does not. If the hint stays a warning for prompt matches but is now a hard block for name matches, the user sees two visually similar warnings with different consequences. Make the copy distinguish them ("same name, cannot add" vs "same question, you can still add"). Otherwise people will assume every warning blocks, or none do.

7. **Case and whitespace make the rule feel arbitrary if the message does not show the match.** "Code Review " vs "code review" is rejected. The user sees two names that look slightly different on screen. The message should quote the existing name as it is stored (the notes already plan to echo `conflictingName`) so the match is legible. The Unicode decision (accents distinct) is fine for a duplicate rule but means "Équipe" and "Equipe" both pass; acceptable, but do not claim in copy that names are "unique".

8. **Bulk restore stays skip-and-report: confirm the report is understandable alongside the new single messages.** A facilitator who restores defaults in bulk and sees "3 skipped, name already active" and then single-restores one and sees a different phrasing will wonder if two rules exist. Use the same vocabulary in both places ("an active topic with this name already exists").

9. **Legacy duplicates are a user pain point the notes defer, and I disagree with fully deferring.** Existing teams that already have two active "X" topics: the facilitator can still archive one, so they are not stuck. But if they archive one and later try to restore it, they are blocked by the other, which is correct but surprising. The related and more annoying case: a team with a legacy pair cannot be told apart in the vote picker. A read-side indicator is out of scope for this change, but I would want it as a tracked follow-up issue, not just "mention to PO". I agree with leaving rename out here.

10. **Keeping the tool in the background.** The tool should only be in the foreground during prep, and the fix actually helps: it removes a class of "wait, which one is this?" moments from the live vote. What would put it in the foreground is a rejection that stops the facilitator in prep with no clear next step (items 2 to 4), or a locked-team message being confused with a name-conflict message. The notes correctly keep the lock check first. The UI must make the two 409s visibly different in wording, not just in code (the notes mention callers branching on `code`; add a checked requirement that no caller shows the lock message for the name conflict or the reverse).

11. **No ritual-integrity risk.** The rule does not touch reveal simultaneity, readiness, outlier flagging or pacing. I have no objection on those grounds, and agree with Devon that it is not load-bearing for the ceremony.

12. **Admin and facilitator parity is right.** An admin who restores topics into a team and gets blocked will hit the same message. Make sure the copy does not assume the reader is the team's own facilitator.

## Questions

1. On an active-name match in the Add form, is the submit button disabled with a reason, or enabled and the server rejects? (My preference: disabled with reason.)
2. After a restore 409, does the UI scroll to/highlight the conflicting active topic using `conflictingTopicId`, or only show text?
3. After an Add 409 caused by a stale list, does the client refresh the list?
4. Is the rejection shown inline near the action (row-level for restore) or as a transient toast? A toast that disappears makes the conflicting name unrecoverable; prefer inline, persistent until dismissed or the user acts.
5. Does the single-restore success/failure state survive when the list also contains the bulk "Restore default topics" action, i.e. can the user confuse a single failure with a bulk skip report?
6. Are screen-reader users told about the conflict (error announced, not only a color change)? Accessibility is not mentioned in the notes.

## Suggested additions to the change

- A "user-visible behavior" section in the design stating exact copy intent for: Add active-match hint (no "Add anyway"), Add 409 fallback, single restore 409, with the conflicting name quoted and a stated next step.
- A task to rewrite the active-match hint so it is a block with an explanation, and a test that the "Add anyway" control is gone for active matches only (archived-match "Add as a new topic anyway" stays).
- A task to refresh the topic list on either 409 so the next view is accurate.
- Shared vocabulary across bulk skip report, single restore error, and Add error.
- A spec scenario for "restore blocked, user archives the conflicting topic, retries, succeeds" so the swap path is a tested, documented flow.
- A follow-up issue for visible indication of legacy duplicate active names (and optionally rename), created now so it does not get lost.
- Request a short usability pass with me on the copy before ship; I offered to test the facilitator view and this takes ten minutes.
- Update use case 08 so the documented user flow includes the rejection and the swap path, not just the "server does not enforce" line being removed.
