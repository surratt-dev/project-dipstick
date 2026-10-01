# Explore Review: Topic Annotation (Facilitator)

**Reviewer:** Priya Nair (Facilitator, SME)
**Reviewed:** `exploration-notes.md` (Devon Calloway, 2026-09-30)
**Lens:** Does this solve real facilitator pain? Does it stay in the background during a session?

---

## Overall

Devon has the pain right. I rotate across three teams, and "what did this team mean by Codebase Health last time?" is a question I answer from memory or a handoff note today. A written team definition next to the prompt is one of the few features that directly supports my success criterion #3: pick up an existing team's session with no handoff conversation. The snapshot model, the first-session lock, keeping text out of the audit log, and "no annotation means no element" are all correct, and I would not reopen them.

The notes are strong on data integrity and weaker on **when and how a facilitator actually captures a definition**. That is where the friction is.

---

## Observations

### O1. The moment of agreement and the editor are in different places

The use-case trigger says "the team **during a session** agrees on what a topic means." In practice that happens in discussion after a reveal: someone says "wait, are we counting test flakiness here?", the room settles it, and that becomes the definition. The only editor in this change is the Topic Management screen, which I would open after the session, possibly the next day. By then the exact wording is gone, or I'm reconstructing it from memory. That is the same drift problem this feature exists to fix.

I'm **not** asking for an editor in the live session view. Editing mid-session pulls me out of the room, and the snapshot model means it wouldn't take effect anyway. I'm asking the exploration to name the gap and pick a low-cost bridge. Suggested additions below (S1).

### O2. Snapshot-at-creation collides with sessions created ahead of time

Sessions have a `draft` status (`facilitator-sessions.ts:399`), so a facilitator can create a session before running it. If #175 snapshots at **creation**, this sequence breaks:

1. I create Thursday's session on Monday while prepping.
2. On Tuesday the team lead pings me: "can you tighten the Codebase Health definition per last retro?" I edit it.
3. Thursday's session shows Monday's text. I have no idea why.

Reorder has the same exposure, so it's not new. But for annotation, the most natural editing window is exactly between scheduling and running a session. The exploration should ask #175 whether the snapshot is taken at creation or at the first transition out of `draft` (lobby or begin). From my side, **snapshot when the session leaves `draft`** is the behavior that matches what a facilitator expects. If it stays at creation, the save confirmation has to say so (see O3).

### O3. "Applies to future sessions" must be said where I save

Under the snapshot model, an edit made while a session is in progress (or a draft exists, per O2) won't show in that session. That's right for integrity, but it surprises people. If I edit during a break because the room agreed on something, I'll expect to see it on the next topic. The save confirmation should state the effective scope in plain words, for example "Saved. Shows from the next session." If a non-completed session already exists for this team, say so explicitly: "Thursday's session will still show the previous definition."

### O4. The facilitator view needs the annotation too, not just participants

The notes frame display as #57 (participant vote prompt). I'm the person who most needs the annotation on screen, because I'm the outsider in the room. I read it aloud, or at least glance at it before saying "next topic." #56 (topic-advance, facilitator side) should carry it as well. Please name both issues as consumers, not just #57.

### O5. Description vs. annotation will confuse the room unless they look different

Both can appear next to the prompt. The use case says they serve different purposes, but participants won't know that. If they're two similar grey paragraphs under the prompt, people will skim both or neither. I need:

- A short, consistent label for the annotation, e.g. **"Our team's definition"**. Not "Annotation", which is a software word.
- A clear order: prompt, then team definition, then description (or the description folded away). The team's words should outrank the generic explanation, because they are the more specific of the two.
- The same label on the Topic Management screen, so a facilitator sees the same term in both places.

### O6. The "draft lock" question in §4.9 is a misread

`topicActionsLockedByDraft` in `TopicManagementPage.tsx:606` is the **unsaved reorder draft** (`isDirty || isSaving`), not a draft session. It exists so a Remove/Restore refetch can't clobber unsaved order changes. So the question splits in two:

- Draft *session*: covered by O2.
- Unsaved reorder draft: annotation save almost certainly triggers a refetch. Either disable annotation editing while the order is dirty (consistent with Remove/Restore, same "Save or discard your order changes first." copy), or make sure the save doesn't reset `draftOrder`. Engineer's call, but it needs a task.

### O7. An inline editor adds unsaved state to a screen that already has one

The page already has a sticky Save/Discard bar for reorder and a `beforeunload` guard. An inline annotation editor is a second kind of unsaved state. Decide up front:

- Only one annotation editor open at a time.
- Navigating away with unsaved annotation text triggers the same guard.
- Esc or Cancel restores the saved text with no prompt.

Otherwise I'll lose a carefully worded definition to a stray click.

### O8. Lock-state read-only is good, and the empty state matters

When the screen is locked (pre-first-session), I'd expect no annotation controls and no annotation text, since none can exist yet. The existing lock notice should say annotating becomes available after the first session. That's a small onboarding win: it tells a new facilitator the feature exists and when to use it. Use case note 370 makes the same point.

---

## Views on the open questions

**Q2: Display after reveal and during discussion. Yes, keep it visible, with two conditions.**
Discussion is where the definition matters most. "Is a 2 here about the code or about the tests?" gets settled by pointing at the screen. Conditions:
1. **The reveal must not move it.** The reveal is the event. If votes and aggregate appearing make the prompt block jump, collapse, or reflow, it distracts from the moment. The annotation should stay in a fixed position from voting through discussion.
2. **Secondary weight throughout**, as Devon says. Readable at a glance from across a room on a shared screen, never bigger or bolder than the prompt.

Owned by #57/#56/#62, but write it into those issues now as an acceptance criterion: "team definition remains visible and stationary through reveal and discussion."

**Q4: Clear confirmation. Yes, but the reasoning applies to overwrites too.**
A light inline confirm on clear is right ("Remove this team's definition? This can't be undone."), with no modal. But with no version history, **overwriting** is just as irreversible as clearing. I don't want a confirm on every edit, because that's friction for a routine action. What makes overwrites safe enough is showing the current text and its provenance *while editing* (see Q5), so I know whose words I'm replacing. Accept clear-only confirm on that basis, and record the reasoning so nobody adds an edit confirm later.

**Q5: "Last edited by X on date." Yes, small, on the management screen only.**
This is the most useful facilitator-continuity feature in the change. "Set by Dana, 14 Mar" tells me whether this is the team's settled definition or something written last week that I should check with the room. Placement:
- **Management screen:** one muted line under the annotation, in the same style as the archived/restored metadata.
- **Inside the editor:** visible, so I know whose wording I'm replacing.
- **Live session view: not shown.** Naming a facilitator next to the definition in front of the team makes it look like that person's view rather than the team's, which undercuts Devon's point #2. Participants see the team's words, unattributed.

**Q7: Concurrent edits. Last-writer-wins is acceptable. Don't build a token.**
Two facilitators editing the same team's same topic at the same moment is close to never in practice. Teams have one facilitator per session and a handful over a quarter. Provenance (Q5) already shows a surprise overwrite after the fact. If a stale-write check is cheap and the reorder page already has a stale-save recovery pattern, reusing it is fine, but I wouldn't let it block or grow the change.

**Scope, given the live-session view doesn't exist yet. Ship the management half, but don't let it count as "done."**
The management half has real value on its own today. It is the pre-session prep and handoff surface, and I'd use it before every session with a team I haven't seen in a while. So shipping backend plus management screen now is worth it. But:
- Put the session-display acceptance criteria (O4, O5, Q2) **into #56, #57, and #62 as written requirements** in this change's tasks, not as a Known Limitations paragraph that gets forgotten. Otherwise those screens get built from their own issue text, which doesn't mention annotation.
- Close TOPIC-007 / #53 as **partially delivered**, or split out the session-display piece, so nobody signs off on "engineers see the team definition" when they can't.

**Q1 (admin):** Not my call, but I agree with facilitator-only. Admins aren't in the room.
**Q6 (EM history):** Agree it's out of scope. When it is built, the snapshot annotation belongs in session history for facilitator continuity as much as for EMs. That's where I'd look first when picking up a team.

---

## Suggested additions to the exploration

- **S1. A capture bridge for O1** (pick one, all small):
  - (a) On session wrap-up or completion, a quiet link: "Did the team agree on a topic definition? Update it in Topic Management." Facilitator-only, dismissable, no nudge to participants.
  - (b) Make the Topic Management screen reachable in one click from the completed-session view.
  - (c) Accept the gap explicitly and say so in Known Limitations.
  I lean (b) now and (a) as a follow-up.
- **S2.** Raise O2 (snapshot timing vs. `draft`) as a question to #175 and record the answer in the `session-topic-lifecycle` spec change this exploration already proposes.
- **S3.** Save-confirmation copy that states the effective scope (O3), including the case where a non-completed session already exists.
- **S4.** Name both #56 and #57 (and #62) as display consumers, each with the "visible, stationary, secondary, unlabeled by person" criteria.
- **S5.** A fixed user-facing label ("Our team's definition" or similar) used on both screens. Avoid "annotation" in UI copy.
- **S6.** Unsaved-state rules for the inline editor (O7) and its interaction with the reorder draft (O6).
- **S7.** Helper text: Devon's one line is right. Make it read as guidance, not a warning. For example: "What this topic means for this team, in the team's words. Not for notes about people or how to vote." Shown in the editor only, not on the read view.
- **S8.** Usability check: I'll gladly walk through the edit flow on the management screen once it's in a branch. A 10-minute pass on the clear-confirm and provenance placement is enough.

---

## Will it disappear into the background?

On the management screen: yes, if O5–O7 are handled. It's a quiet, inline edit with a muted provenance line.

In the session: yes, **only if** it stays secondary, stationary through the reveal, unattributed, and absent when empty. All of that lives in screens this change doesn't build, which is why S4 matters more than anything else on this list.
