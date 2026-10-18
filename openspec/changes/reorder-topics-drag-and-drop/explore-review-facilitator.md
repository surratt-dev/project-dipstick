# Facilitator review: exploration notes for drag-and-drop Reorder Topics (#181)

Reviewer: Priya Nair, Facilitator (SME). Lens: real facilitator workflow, friction, and whether the tool stays out of the way.

## Overall

The notes are careful and mostly aimed at the right things. My main critique is that they are written almost entirely from the code's and the ritual-guardrails' point of view. They never describe a facilitator actually doing this task, in a real moment, with a real intent. I am glad to see the "drag is quiet, no new data" instinct. I am worried about a few spots where the proposed behavior could make the screen noisier or more error-prone than the buttons it supplements.

## Where the notes match real pain

1. Drag on a laptop is what I reach for first. Section 1 says so correctly. Four small up/down buttons per row feel like a form, not a list. Moving a topic from position 9 to position 2 by button means seven clicks and watching the focus. That is the real friction and the notes undersell it. Please state it concretely in the proposal as the motivating case: long-distance moves.
2. "A facilitator should not be able to tell from the results which way they reordered" is exactly right.
3. Save/Discard as the safety net for accidental drags is right, and the draft model is why I would trust this.
4. Keeping the locked first-session state free of handles is right. A new team should not see a control that does nothing.

## Pain points and friction not captured

1. **When I actually reorder.** The notes never say. I reorder before a session, usually the day before, at a desk, thinking about which topics this team needs to hit first, or to put a heavy topic (e.g. on-call, incidents) away from the end of the hour when energy is low. That is a calm, unhurried, laptop task. Tablet matters less than the notes imply (the whole touch and auto-scroll investment). Ask whether touch is really needed for v1 or whether it is cost driven by the use case's wording. If the answer is "tablet was named in #52", fine, but say so.
2. **Could it ever happen mid-session?** It must not. I never want to be in a session and see reorder affordances. The notes say "not in the live-session surface". Good. Add an explicit statement that reordering happens from team settings only and that a session already open is never touched. A facilitator who reorders after a session has started will wonder if it applied. The pinned copy covers this; make sure it is also visible after a successful save, not just before.
3. **Which topics are movable.** Archived topics: are they excluded from the list entirely? Notes imply yes ("active rows"). Say what a facilitator sees for archived topics during drag so there is no confusion about dropping "between" an archived topic and an active one.
4. **Seeing the effect.** After a drop, I want the new order obvious and the position numbers right. The notes say numbers update on commit only. In practice, with the order not changing until drop, I get no feedback while dragging beyond the drop line. A clear, single drop-line indicator is essential, and the dragged row should remain visibly identifiable (not vanish). Spell out that the indicator must be unambiguous with tall rows, since an expanded definition editor makes rows several screens tall.
5. **Tall rows are the real usability problem.** Section 3 mentions it for auto-scroll but not for the drag UX. If a definition editor is open, dragging a row across a long list is miserable. Consider collapsing rows (or showing a compact row) while dragging. I would rather have a compact "reorder view" than auto-scroll heroics. At minimum, put this as an open question.
6. **Undo.** After a bad drop, I want to put it back. Escape cancels only during the drag. After the drop, is there an undo of the last move, or only "Discard" which throws away everything? A facilitator who has done five good moves and one bad one should not have to start over. Open question: single-level undo of the last move, or at least say Discard is the only recovery and accept it.
7. **Concurrent facilitators / stale.** Multiple facilitators exist across teams (I hand off teams). The 409 stale case is mentioned as unchanged. What does a facilitator see and lose after a stale error following a long drag session? The notes say behavior is unchanged but from a facilitator's view, losing a carefully hand-ordered list is the worst moment. Confirm the message tells me what happened and whether my draft is kept.
8. **Draft loss on navigation** is called "accepted for v1". With drag making reordering faster and more likely to involve a lot of moves, I would call out that the `beforeunload` prompt must actually fire in a normal laptop flow, and be worded plainly.
9. **Mistaken drag while trying to edit.** The notes cover handle-only and a threshold. Also: the handle should be far enough from the Remove/Archive buttons that a slip does not land on a destructive control. Check spacing.
10. **Discoverability.** A small quiet handle is right for me, but a new facilitator must notice it. A grip icon plus a tooltip on hover ("Drag to reorder") and a cursor change is enough. No tutorial, no coach marks.
11. **First-session teams.** Locked teams should get the same explanation they get for the buttons, rather than silent absence of the handle. If the buttons show a "locked until first session" reason, the handle's absence should not leave me wondering why my colleague's team lets them drag. Match the existing reason copy.

## Usability concerns missing

- **Feedback of the saved result.** After Save, confirm the new order in plain language. A drag-ordered draft that looks right but silently fails to save is the nightmare case.
- **Accessibility of a hidden handle.** The notes' lean that the handle is `aria-hidden` and not focusable means a keyboard-only or switch user sees a visible control that does nothing for them. That is acceptable only if the buttons are always visible and adjacent. Not my call, but I would want an accessibility reviewer to confirm, as the notes say.
- **Touch accidents.** On a tablet, a scroll that turns into a drag is a real concern. The notes mention it; I'd make "scrolling by touching the body of the row must never move a topic" an explicit acceptance criterion.
- **Rapid repeated drags.** A facilitator will move several topics in a row. Make sure focus and announcements do not pile up or get chatty (the notes' single announcement per drop is good).
- **Screen real estate.** Handle plus position number plus four buttons per row is a lot of chrome. Consider whether the four buttons (top/up/down/bottom, I assume) should visually recede when drag is available, while remaining present and operable. This must not conflict with the SHALL that they remain.

## Does it disappear into the background?

Mostly yes, provided:
- no animation, toast, count, or celebration on drop (notes agree: announce only);
- no change to anything in the live session;
- the draft/Save model is unchanged, so reordering feels like editing a list, not operating a feature.

The risk is not the ritual, it is clutter and slips on the settings page: tall rows, destructive buttons next to the handle, and no way to undo one bad move. Fixing those makes this a tool I stop noticing. Note that this page is not used during sessions at all, so "disappears" here means "I finish in under a minute and forget about it".

## Suggested additions to the notes

1. A concrete user story: "As a facilitator preparing for next session, I move the last topic to near the top in one gesture."
2. A statement of who reorders and when (pre-session, laptop primary, tablet secondary) and whether that changes the touch investment.
3. Compact or collapsed rows during drag as an alternative to auto-scroll for tall rows.
4. An undo-last-move question.
5. Spacing and visual separation between handle and destructive buttons.
6. Locked-state explanation copy consistent with the buttons.
7. Clarity on what the facilitator sees after a stale conflict (draft kept or lost).
8. An acceptance criterion: touch scrolling on a row body never reorders.

## Questions

1. How often do facilitators really reorder? If it is a few times a year per team, is the dependency and spike effort proportional? (The notes ask this implicitly; I'd say it plainly.)
2. Is long-distance move (several positions) the dominant case, or mostly swapping neighbors? That determines whether drag earns its place over the buttons.
3. Will usability testing with me happen on a laptop first, and a tablet second? I am willing to test; I want the order of devices agreed up front.
4. Does a "move to top/bottom" button already exist? If so, the remaining drag value is middle-of-list moves only, and the notes should say so honestly.
5. What does the facilitator see if drag is disabled because an editor is open (note 5.6)? A visible reason matters; a silently inert handle is the worst version.

## Verdict

Direction is sound. I would sign off on the exploration as long as the proposal adds the real-use scenario, treats tall rows and undo as explicit questions, and keeps the quiet, no-feedback-on-drop stance. Happy to do the tablet and laptop check described in item 7 of the open questions.
