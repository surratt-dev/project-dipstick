# Facilitator Review — Join Link Display & Copy (Issue #45)

**Reviewed by:** Priya Nair (Facilitator / SME persona)
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Focus:** real user pain, workflow friction, usability gaps, "disappears into the background" test

---

## Overall take

This is grounded in the actual screens, and §1 is the right thing to have caught before anyone wrote a task list. I want to say that plainly first, because the rest of this is mostly pressure-testing details, not disputing the core finding.

The routing gap in §1 is not just a technical correctness issue — it's the exact failure mode I worry about most as the person who'd actually be running the session: **a feature that exists in the codebase but not in my workflow.** I facilitate three teams on a rotation. When I start a session, I am in the room with people, I've just clicked "Open the room," and now I need to get a link into Slack in the next ten seconds without breaking my attention on the group. If that link only renders on a page nothing navigates to, it doesn't matter how well the copy button works — I never see it. I'd push hard for option (b): fix the real surface (`DraftSessionHost`), name the `SessionLobbyPage` dead-code question as a follow-up, don't let it block this. Good call already reflected in the notes.

That said, I don't think "the link is present and copyable" is the same question as "does this feel invisible in actual use," and I think the notes lean on the first without fully pressure-testing the second. Below is what I'd want answered before this goes to design.md.

---

## Observations & questions

### 1. "Prominently" is doing a lot of work in the AC, and the notes don't test it

The AC says "displayed prominently... at all times before the session begins." The notes confirm the link will be *present* in `live-readiness-view`, matching the existing `draft` precedent (small label, muted link text). That precedent — `color: #9e9e9e`, `0.875rem` label — reads to me as deliberately de-emphasized, appropriate for a "not yet joinable, don't bother copying this" state. Is that the right visual weight for the state where the link is the single most important thing on the page? During the actual "waiting for participants" window, sharing that link *is* the facilitator's task. If it's styled like a footnote, I will still have to hunt for it visually even after the routing gap is fixed — which reintroduces the friction this change is supposed to remove, just one layer down. This should be a design.md decision, not an inherited style.

### 2. What does re-sharing look like, mid-wait?

Sessions don't always fill on the first share. Someone's out sick, someone missed the Slack message, someone joins ten minutes late. Does the link (and copy button) stay live and in the same place for the entire `lobby` window, or does it only get attention once, at the top of the flow? The notes say "displayed at all times before the session begins," which covers this at the AC level, but I'd want explicit confirmation that a facilitator can come back to it three times during the same wait without re-navigating or re-finding it. This is a real pattern for me — I'm rarely the only one messaging, and there's always a second round of "wait, what's the link again?"

### 3. Copy-then-context-switch, not copy-then-look

The `MemberManagement.tsx` auto-clearing banner precedent is the right call stylistically — I don't want a toast stack, agreed with Devon on that. But the *interaction* pattern for this use case is different from a typical success banner: I click copy, then I immediately alt-tab to Slack to paste, then I come back. I'm not staring at the screen waiting for confirmation the way I might be after, say, renaming something. Five seconds might be gone by the time I've pasted and returned. That's not a functional bug — the copy already succeeded — but if the whole point of the confirmation is to reassure me before I move on, a confirmation that's already vanished when I glance back doesn't do that job. I'd ask design.md to at least consider this explicitly rather than assume the `MemberManagement` timing transfers unchanged. (I'm not asking for a toast library — just a check on the number.)

### 4. The `draft`-state question (§3) — I'd answer it differently than the notes' instinct

The notes lean toward: no copy button while `draft` (link not joinable yet), only once `lobby`+. I'd push back gently. In practice, I often prep a session a few minutes before I actually open the room — get the Slack message drafted, queue it up, then hit "Open the room" and send in the same motion. If I can't copy the link until *after* I've opened the room, that forces a strict two-step sequence (open room, then copy, then paste) instead of letting me stage the message in advance. I don't think this needs to block the change, but I'd want it treated as a real "first-session support" question, not just a minor-value judgment call — new facilitators in particular over-explain everything the first time, and having the link ready to paste *before* declaring the room open is the kind of small thing that makes the first session feel less improvised. Worth a real decision, not a default.

### 5. One thing missing entirely: what a late-joining participant sees, not just the facilitator

The exploration is scoped tightly to the Facilitator's copy action, which is correct per the use case. But it's silent on whether this change has any observable effect on the Engineer side — e.g., does anything about how the link is displayed or generated change what happens when someone clicks it mid-lobby? I don't think it should, based on what's here, but I'd want a one-line confirmation in design.md that this is purely additive on the facilitator surface and doesn't touch the join-link validation/session-aware-landing behavior in `openspec/specs/join-link/spec.md`. Worth stating explicitly so nobody has to re-derive it later.

### 6. Rejected-promise handling (§4) — agree with the notes, flagging why it matters to me specifically

Treating a rejected `navigator.clipboard.writeText()` the same as "unavailable" (no false confirmation) is the right call, and it directly matters to my workflow: I'm often on a locked-down corp laptop or presenting via a screen-share tool that can intercept clipboard permissions. If the app told me "Link copied" when it silently failed, I would paste garbage into Slack in front of the team and not find out until someone asks "what link?" That's a small but real credibility hit during a session I'm supposed to be running smoothly. Glad this got called out explicitly rather than left to whoever writes the fetch call.

---

## Does this disappear into the background?

Yes, on the shape described — a label, a link, one button, no modal, no QR code, matching the existing plain-text precedent. That's the right level of chrome for something that's pure plumbing around a ritual I already run by hand today. I have no concern about this touching reveal simultaneity, readiness/spoiler separation, outlier flagging, or pacing — it's nowhere near those surfaces, and the notes correctly identify that.

My concern isn't that this change *adds* friction — it's that the routing gap, if left unresolved, means the friction I have *today* (no link display at all, copy-paste from wherever I can find the token) simply continues unchanged for anyone who doesn't happen to land on `SessionLobbyPage`. That's not a new problem this introduces; it's the old problem persisting under a shipped-and-closed issue. I'd want the proposal to say, in plain language, "after this change, a facilitator running a real session will see X" — not "the AC is satisfied by component Y." Those are not automatically the same claim, and §1 is proof of that.

---

## Suggested additions to carry forward

1. A design.md decision on visual prominence for the `lobby`-state link (not "inherit the draft styling by default").
2. Explicit confirmation the link/copy control persists and stays discoverable for the *entire* waiting window, not just on first render.
3. A gut-check on the 5-second auto-clear given the copy-then-alt-tab-to-Slack pattern, rather than assuming the `MemberManagement` precedent's timing transfers unchanged.
4. A real decision (not a default) on whether copy is available during `draft`, with the staging-a-message-before-opening-the-room workflow considered explicitly.
5. One line in design.md confirming this change doesn't alter join-link validation or session-aware-landing behavior for the Engineer side.
6. Carry §1's framing into proposal.md verbatim: success is "a facilitator running a real session sees this," not "the AC passes against an isolated component."
