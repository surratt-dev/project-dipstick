# Explore Review: Facilitator (Priya Nair)

**Reviewing:** `exploration-notes.md` (topic-add-form-and-empty-state, #55)
**Reviewer:** Priya Nair, Staff Engineer and cross-team Health Check facilitator
**Date:** 2026-10-01
**Lens:** Does this capture real facilitator pain and workflow friction? What usability concerns are missing? Will the result fade into the background during sessions?

---

## Overall read

Devon has found the right problem. Today, if a team says "we should be tracking on-call," I can't act on it without someone using curl, so in practice it doesn't happen. Of the findings, the description mismatch (2.1) and the "Restore instead?" nudge (2.6) matter most to me. The interlock analysis (2.4) is careful work. What the notes don't cover much is *when* and *why* a facilitator actually adds a topic, and what happens the first time that topic reaches a room. Most of my additions are about that.

---

## Observations

### O1. Adding a topic is a between-sessions job that starts in a session
The real trigger is nearly always a live moment. Someone in the discussion says "the thing that's actually killing us is the partner integration." That usually ends up as an action item, and I add the topic later, often days later, sometimes as a different facilitator (handoff). The notes treat the add form as a standalone screen task, which is fine for this change. Two consequences follow:
- The person typing the topic may not be the person who heard the discussion. The **description, or whatever we call it, is a handoff artifact.** That supports Devon's option 1 label ("Notes for facilitators"), and I'd go further: say whose note it is (see Q3).
- This page is not used during a live session. That's good for "fading into the background." The session view stays clean, and the cost of a slightly richer form here is low. I wouldn't strip the form down so far that the guidance (O3) disappears.

### O2. Finding 2.1 is right, and option 2 has the same hole today
I agree strongly with the core finding. A custom topic is by definition the *least* familiar topic in the set, yet it is the only kind that can never carry orientation text into the room. That runs against what I care about for first-session support. **The first time a custom topic appears is effectively a first session for that topic.**

One correction to the options: option 2 (point facilitators to the team definition) is also not reaching the room today, because the notes say in-session annotation display is "pending #175." If the form copy says "Add a team definition … to explain it during sessions," we would be making the same false promise 2.1 warns against, only one field over. The copy has to be honest about #175 as well, or the hint must be worded so it doesn't promise in-session display ("A team definition is the place to explain what this topic means for your team").

My preference: option 1 (honest label) plus a carefully worded option-2 hint, **and** a filed follow-up for showing custom topics' orientation text on their first appearance in a session (topic-level first appearance, not team-level `is_first_session`). That follow-up is the version that actually fixes the ritual.

### O3. Vote-type guidance is under-specified, and vote type can never be changed
2.2 says "mirror the existing `VOTE_TYPE_LABELS`," but those labels are only names ("Finger Voting", "Roman Voting", "Modified Roman Voting"). They don't explain the scale. A facilitator who hasn't run many sessions will pick by name. Two needs:
- A one-line meaning per option, shown inline next to the choice and not hidden in a tooltip: Finger = rate 1–4; Roman = thumbs up or down; Modified Roman = up / sideways / down.
- An explicit statement that **vote type can't be changed after creation** (Non-Goal in section 4). A wrong choice means removing and re-adding the topic, which splits its trend. Facilitators should see that *before* they submit, not discover it six sessions later.

Should the vote type have no default selection? Making the facilitator choose deliberately is worth one extra click. A pre-selected Finger will get accepted without thought.

### O4. The "Restore instead?" nudge (2.6) is the most valuable item in the doc
From a facilitator's point of view this is not an edge case. It is the common case. A team removes "Project Trend" because it felt irrelevant, and three months later someone wants it back and types it in fresh. Without the nudge, the team gets two trend histories for the same question, and my fourth success criterion ("after six sessions, the trend tells me something I wouldn't have noticed") quietly breaks. The nudge should:
- match on name *and* on prompt (the use case's open note), case-insensitive and trimmed;
- on an archived match, offer "Show it in Archived Topics" (reusing the single restore path from 3.2) as the primary action, with "Add as a new topic anyway" still available. It is a warning, not a block;
- on an active match, say so plainly. Two active topics with the same name confuse the room during the vote.

### O5. The empty state analysis (3.1) is correct, and keeping it small is correct
I have never seen a team reach zero topics, and I agree with Devon not to build onboarding art for it. The case-2 copy matters more than it looks. A facilitator who hits it is probably about to run a session, so "Contact an application administrator" needs to name *something actionable*. If there is no real recovery path today (open question 7), say that in the spec rather than in copy that implies one exists.

### O6. Lock, no teaser: agreed, with one follow-on
I agree there should be no disabled Add button on locked teams. The first session on the canonical set is load-bearing, and I've been asked for exceptions before. The follow-on is **discoverability right after unlock.** The first time I open this page after a team's first session, I should be able to find Add without scrolling past 12 topic rows. The notes place the form "below the active list, above Archived." That works for the form, but consider a trigger button near the Active Topics heading (or at least make sure it is visible without scrolling on a typical laptop).

### O7. The dirty-form policy (2.4 #4): loose, done properly
From the facilitator side, the realistic sequence is "add topic, then move it up to where it belongs." I would rarely have the add form half-typed while doing something else. So the strict lock-out would mostly add friction that nobody hits, and a fourth disabled-reason string to read. I lean the same way Devon does: loose, with quiet refetch so nothing can wipe typed text. One addition: if the form is dirty and the user collapses it, ask before discarding, or keep the draft when it reopens. Losing a carefully worded prompt to a stray Cancel click is the same failure as losing it to `setError`.

### O8. "Future sessions," not "the next session"
Agreed (2.7 / #175). The success message should also tell me *where* the topic went: "Added 'On-call Handoff' to the end of the list. Use the move buttons to change where it falls in the session." Order matters to session pacing (heavier topics early vs. late), and the default "append last" is often not where I'd want it.

---

## Questions

- **Q1.** Who owns the decision on the description label (open question 1)? I'd like to review the final field label and helper copy before they're specced. This is exactly the kind of wording that changes how a facilitator walks into the room.
- **Q2.** Is there any way, even read-only, for a facilitator to see how a topic will *look* to participants (name vs. prompt prominence)? I'm not asking for a preview in this change. But do we know which field the participant view shows most prominently? Field guidance ("Name is the short label, Prompt is the question people vote on") should match what participants actually see.
- **Q3.** Does TOPIC-002 expose who created a custom topic and when? Archived rows already show `archivedBy`/`archivedAt` for exactly this continuity reason. A facilitator picking up a team should be able to see "Custom · added by Priya, Aug 2026" without a handoff conversation. If the backend doesn't expose it, is it in scope as a small read addition alongside `canAddTopics`, or a follow-up?
- **Q4.** Should the form show the current active topic count ("This team has 12 active topics")? Long topic lists are the most common way sessions overrun. A quiet count, not a warning, helps facilitators self-regulate without the app nudging anyone.
- **Q5.** Do max lengths (name 100, prompt 500) fit the session UI? A 100-character name will wrap badly on the participant voting card. Should the form suggest a shorter name (for example a soft character counter) without changing the server rule?
- **Q6.** On an admin (#176 gating): what does an admin see instead of the Add button? Nothing, or a one-line "Adding topics is currently facilitator-only" note? I'd prefer nothing plus a spec reference, so admins aren't invited to file it as a new bug.

---

## Suggested additions to the exploration/proposal

1. **Copy honesty about #175 for the team-definition hint as well** (O2). Neither field reaches the room today.
2. **Follow-up issue:** show a custom topic's orientation text the first time it appears in a session (topic-level "first appearance"). Name it as the real fix for 2.1.
3. **Vote-type scale explanation inline, plus a "can't be changed later" note** (O3). Consider no default selection.
4. **Promote the duplicate name/prompt warning with "Show in Archived" into scope**, not just an open question (O4). It protects trend continuity, which is the main reason the ritual works over time.
5. **Discard confirmation, or draft preservation, when collapsing a dirty add form** (O7).
6. **Success copy that mentions reordering** (O8).
7. **Add trigger visible without scrolling** on an unlocked team (O6).
8. **Creator/created-at on custom rows**, as scope or as a follow-up (Q3).
9. **Usability check:** before this ships, I'd like 15 minutes to add two custom topics on a test team, one fresh and one colliding with an archived default. That is enough to validate the labels and the nudge.

---

## Summary

- The exploration targets a real gap: today custom topics effectively can't be added, so the "flexibility within guardrails" promise is only half kept.
- 2.1 is the key finding, but option 2's hint has the same #175 problem, so the copy must not promise in-session display for either field.
- A custom topic's first appearance is a "first session" for that topic. File a follow-up so its orientation text reaches the room.
- Vote type needs inline scale explanations and a "can't change later" note. The existing labels are only names.
- Bring the duplicate warning that offers "Show in Archived" into scope: it is the main protection for trend continuity.
- Loose dirty-form policy with quiet refetch, plus a discard guard on collapse. No teaser on locked teams. Keep the empty state small and honest.
- Small additions: success copy that mentions reordering, an Add trigger visible without scrolling, and creator/date on custom rows.
- The page isn't used live, so this change does not threaten in-session focus. I'd like a short hands-on check before it ships.
