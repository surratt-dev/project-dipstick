# Facilitator Review: Exploration Notes for "Remove a Topic" (issue #51)

**Reviewer:** Priya Nair, Facilitator (Subject Matter Expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Lens:** does this capture the real friction of my between-session workflow, and does it keep the ritual itself calm — not whether the API contract is internally consistent, which isn't mine to referee.

---

## Overall take

This is good, careful groundwork, and I want to say plainly: I agree with the instinct in §7 to keep the screen small. I facilitate three teams on a rotation and I do not want a fourth admin console to learn. "Light bookkeeping, not a project management tool" is exactly right, and I'd fight to keep that framing through implementation.

That said, this document was written by someone reasoning from the code and the contract inward. A few things that matter to me in the actual moment of doing this — mid-week, between sessions, often for a team that isn't even my "home" team — aren't here yet. None of these touch reveal integrity or in-session mechanics; this whole feature happens off-ritual, between sessions, which is exactly where it should stay. My concerns are about whether it stays *calm* and *trustworthy* once it's there.

---

## Observations & questions

### 1. The "last topic" call: I'd push back on Devon's lean, not just note it as open

Devon's instinct (§4) is a soft warning at removal time, not a hard block, on the reasoning that a hard block "disconnects" the constraint from the moment it matters (session start). I understand the logic, but from where I sit, it has the order of harms backwards.

A warning I can click past while tidying up topics on a Tuesday afternoon is a warning I *will* click past — I'm doing this quickly, between other things, for a team I may not run again for two weeks. The moment that actually costs me something is standing in front of a team at session start with zero topics configured. That's not a UI edge case to me, that's the exact "the reveal gets built as close enough" failure mode I distrust in general: a soft nudge that *feels* like it handled the case but doesn't actually prevent the bad outcome from reaching the room.

I'd rather removal of the last active topic be a hard stop — not because it's a ritual-integrity issue (it isn't), but because "discovered mid-ritual, in front of the team" is the worst possible place for *any* rough edge to surface, topic-related or not. If the team wants to genuinely reduce to zero topics, that should require an explicit, unambiguous action, not something that can happen as the tail end of a routine cleanup pass. Worth putting to Ingrid as a real disagreement, not settled by Devon's lean.

### 2. Open-action-item warning: a count isn't enough to act on

Devon's escalating dialog (§2) shows "N open action items are attached to this topic and will remain open, unlinked from future sessions." I want to flag this from the facilitator's chair: a bare number doesn't tell me whether this is safe to proceed past. Is N=3 trivial (stale items nobody cares about) or serious (a team's live commitments)? I don't have those three action items memorized — I run three teams, not one.

If I'm going to be asked to make a judgment call at that moment, I need enough to actually make it: at minimum, let me expand or click through to see *which* action items, not just how many. Otherwise the dialog performs diligence without giving me the information diligence requires, and I'll end up either confirming blindly (defeats the point of the warning) or leaving the tab to go look them up elsewhere (breaks the light-bookkeeping flow Devon wants to protect).

Also, on wording: "unlinked from future sessions" is correct but it's engineering language. What I need to know in plain terms is closer to: "these will stay open, but nothing will remind anyone about them going forward." That's the actual consequence I care about.

### 3. Continuity across facilitators — nothing here addresses whether *I* can see why a topic disappeared

This is the gap that matters most to me personally. When I pick up a team from another facilitator, or come back after a few months away, I rely on the trend dashboard and session history to reconstruct context without a handoff conversation. If a topic vanishes from the active list, and all I get is "it's gone," that's a worse experience than the paper-and-spreadsheet era it's supposed to improve on — at least there I could ask the person who did it.

Devon's §6 covers an *audit* event (`topic.archived`) but that's framed as a system/security record, not something a facilitator can see. I'd want the topic management screen (or the removed-topics list that the Re-Add use case already implies exists) to show, per removed topic: when it was archived and, ideally, by whom. Otherwise every facilitator inheriting a team has to either notice a topic is missing and wonder, or never notice at all. This should be a stated decision in design.md, not something left implicit because the audit log technically has the data somewhere.

### 4. Cross-team mix-ups are a real risk under the standing-facilitator model, and the confirmation copy is where I'd catch a mistake

I don't just facilitate one team. Under the standing, org-wide model this change is building against, I could plausibly be looking at a team's topic list that isn't one of my usual three — filling in for someone, or reviewing before a first handoff. The failure mode I'm worried about isn't malicious, it's "I had two tabs open and archived the wrong team's topic." The generic confirmation dialog Devon proposes says "This topic's historical data will be retained" — good, that's reassuring — but it should also unambiguously name the *team* and the *topic*, not just the topic, so the confirmation itself is the safety net for exactly this kind of mistake. I didn't see this called out, and I'd want it as an explicit copy requirement, not left to whoever writes the component.

### 5. Is the minimal screen a dead end, or does it feel like "tidying"?

I want to affirm Devon's instinct here, with one refinement. A screen that only shows an active list and a destructive action, with nothing else, risks feeling like a demolition tool rather than a bookkeeping one — even though I agree it shouldn't grow add/reorder/annotate chrome yet. The difference between "calm tidying" and "a scary button screen" is going to come down to small things: does each row still show the prompt, vote type, and description (per the existing View Active Topic Configuration use case) so I recognize what I'm looking at, or is it stripped down to just names? I'd want the minimal screen to still read as "here is your team's topic configuration" with one action available on it, not "here is a delete list." Worth being explicit in design.md that the row content matches View Active Topic Configuration's existing acceptance criteria even though editing is out of scope.

### 6. Entry point — I'd escalate this from "worth a decision" to "blocking for this issue"

Devon flags (§7) that no nav entry point into this screen exists anywhere in `TeamPage.tsx` today, and lists it as something to decide. From my side, this isn't a nice-to-have footnote — if I can't find the screen, the feature doesn't exist for me, and neither does it for the next facilitator who inherits a team and doesn't know to look for it. I'd want this resolved in design.md, not deferred as an implementation detail, precisely because "how does a facilitator discover this exists at all" is a continuity concern as much as a UX one.

### 7. One thing I want confirmed, not designed: timing relative to session start

The use case notes (and Devon's §5) confirm that archiving a topic can't retroactively affect an in-progress session — good, that matches how I'd expect it to behave. But I didn't see anything address the adjacent moment: if I archive a topic for a team shortly before I'm about to start their next session (which is a completely normal time for me to be tidying up topics), does the session-start flow pick up the updated active list correctly, or is there any caching/staleness risk between "I just archived this" and "I just clicked start session"? This is probably already fine given how `session_topics` is populated at start, but I'd like it stated as confirmed, the same way Devon confirmed the in-progress-session safety, so it isn't quietly assumed.

---

## Where I think the notes already got it right (worth keeping, not re-litigating)

- The always-shown generic retention message, with the conditional open-action-item escalation layered on top — one flow, not two separate always-shown dialogs — matches how I'd want to experience this. I don't want a "are you sure?" ritual on every single removal when most of the time there's nothing more to say.
- Not building add/reorder/annotate chrome into this issue. Those are real needs eventually, but bolting them on here would turn a five-minute cleanup task into a project.
- Recognizing this is a between-session, off-ritual action with no bearing on reveal simultaneity or session pacing — correct, and I don't have concerns about this feature from that angle at all.

---

## Summary for Ingrid

The two things I'd want carried into design.md as explicit decisions, not left implicit:
1. Last-topic removal should be a hard stop, not a soft warning — the cost of getting this wrong lands in front of a team, which is the one moment I most need the tool to protect me from surprises.
2. Facilitator-visible provenance on removed topics (when, by whom) — without it, this feature actively works against continuity across facilitators, which is one of the properties I most want this application to give me over the spreadsheet-and-memory status quo.

Secondary, but I'd still want them addressed before this ships: the open-action-item warning needs to let me see the items, not just a count; the confirmation copy should name the team as well as the topic; and the nav entry point needs to be a decided answer, not an open question carried past this issue.
