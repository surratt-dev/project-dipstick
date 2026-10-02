# Explore Review — Facilitator (Priya Nair)

Change: topic-003-admin-authorization (#176)
Reviewing: `exploration-notes.md` (Devon Calloway)
Lens: does this capture real facilitator pain and workflow friction, and does it keep the tool in the background during sessions?

---

## Observations

1. **The pain point is real and correctly named.** When a team's list has gone wrong, I'm often not the one available to fix it, especially after a handoff. An admin who can archive, restore and reorder but can't add is a half-working repair kit. It forces a "go find a facilitator" step for something that should take thirty seconds. Closing that gap is the right call.

2. **Removing empty-state variant 5 is a usability win.** "Topics can't be added from this account yet" is a dead end. It tells the person what's broken but not what to do next. Dropping rows 3 and 5 so that no reachable screen shows that message is the best user-facing outcome in this change. I support collapsing to three variants.

3. **The in-session surface is untouched, and that's correct.** TOPIC-003 is a between-sessions action. Since #175 (#205) snapshots `session_topics` at room open, an admin adding a topic while I have a room open won't change the live session's topic list or order. Nothing new appears mid-session, nothing re-sorts under me, and there's no surprise for participants. The notes don't say this explicitly, so I'd like it stated (see Suggested additions).

4. **Guarding FR-8.7 is the most important constraint here, and the notes guard it well.** Team definitions have to stay in the team's words. Annotation stays facilitator-only, and the shared helper must not be widened. I fully agree with §4.1 and the TOPIC-007 regression test.

5. **The lock is preserved.** A team's first session has to be the canonical set, no matter who is logged in. An admin getting 409 on a locked team is the right behavior, and the explicit test is good.

6. **The admin-as-team-member deferral (§7) is reasonable, but it shouldn't just evaporate.** We already bar a facilitator who is a team member, because the person shaping the topic list shouldn't also be in the vote. An admin who is a team member can now add topics to their own team, and that's the same kind of social pressure. I agree it isn't #176's job, but it needs a tracking issue (all four write endpoints), not only a note in the exploration.

## Usability concerns the notes don't cover

7. **Locked-team copy is now wrong for admins (variant 1).** The locked empty state says: "Ask the people who run this application for your organization to restore this team's default topics." When the viewer *is* an application admin, that sentence tells them to ask themselves. Once this change makes admins first-class topic editors, they'll hit this screen more often. Either show admin-appropriate copy for variant 1, or explicitly hand it to #200 and record that hand-off in the design. Don't leave it unacknowledged.

8. **Facilitators get no signal that an admin changed the list.** This is my biggest concern from inside the room. If an admin adds a custom topic between sessions, I may walk into my next session with a topic I've never seen, plus a `firstSessionDescription` I didn't write, and that description is what participants read the first time they vote on it. The audit table records `actor_global_role = 'application_admin'`, but nothing in the UI shows it. My first in-room question would be "who added this and why?", and I'd have no answer. That's exactly the handoff gap the session history is meant to close. I'm not asking to expand #176. I'm asking the design to:
   - acknowledge that admin-authored topics (and their first-session description text) reach participants without the facilitator necessarily knowing, and
   - decide whether "added by / added on" belongs on the topic management row now or as a follow-up issue.

9. **Admin-authored first-session description vs. the spirit of FR-8.7.** FR-8.7 keeps *team definitions* away from admins because admins weren't in the room. The add form lets an admin write the first-session description that participants see. FR-8.2 clearly allows admins to add, so this isn't a violation. It is a tension, though, and the design should state it in one sentence so a future reviewer doesn't "discover" it and try to fix it the wrong way, for example by blocking the description field for admins.

10. **Form copy should still read correctly for an admin.** Admins will now see the add form's helper text, placeholders and validation messages for the first time. If any of that text assumes the viewer is the team's facilitator ("your team", "what you discussed"), it will read oddly to an admin. A quick copy pass is enough.

## Questions

- Q1. Does the success toast or confirmation after an add say anything that assumes the viewer is the facilitator? (Same copy pass as item 10.)
- Q2. When an admin adds a topic on a team that has an open room, should the screen tell the admin it'll take effect from the *next* room? I'd lean yes, as one quiet line, because otherwise they may think the live session changed.
- Q3. For item 7, is #200's scope already meant to cover admin-specific locked copy? If not, what does the admin see on a locked team after this ships?
- Q4. The shared `canAddCustomTopic` predicate (§3 decision point) doesn't matter to me as a user, as long as the parity test stays. No objection to skipping it.

## Suggested additions to the exploration / proposal

- A1. State explicitly that admin adds never affect an open session (snapshot at room open, #175). Consider one integration test: an admin adds a topic while a room is open, and the open session's topic list is unchanged.
- A2. Add item 7 (variant 1 copy for admins) as either an in-scope copy tweak or an explicit, recorded hand-off to #200.
- A3. Add a "facilitator awareness of admin edits" note (item 8). Default it to a follow-up issue unless the design finds that a small "added by" display is nearly free.
- A4. Record the FR-8.7 / first-session-description tension (item 9) in one sentence in the design.
- A5. Open, or link, a tracking issue for admin-who-is-a-team-member across TOPIC-003/004/005/006 (item 6).
- A6. Do a quick copy review of the add form, toast and errors as seen by an admin (item 10).

## Bottom line

This exploration fixes a real repair-path gap without touching the reveal, the lock, readiness or session pacing, so the live session stays invisible to the change. That's what I want. What's missing is the other side of the gate. Once admins can add topics, facilitators need to not be surprised by them, and admins need screens whose copy doesn't assume they're someone else. None of this blocks the lightweight pipeline, but A1, A2 and A3 should be acknowledged in the design before implementation starts.
