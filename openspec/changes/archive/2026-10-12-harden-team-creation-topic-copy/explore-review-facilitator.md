# Facilitator review: harden-team-creation-topic-copy (#215)

Reviewer: Priya Nair (Facilitator, SME). Read: exploration-notes.md.

Short version: this is plumbing, and I am glad it is being handled as plumbing. My only stake is that when I create a team in front of a new group, nothing visible happens except a team with the right twelve topics in the right order. On that test the notes mostly pass. A few places where my experience as the person standing in front of the room is missing.

## Observations

1. The 500 on team creation is the pain I care about, and the notes name it correctly. Creating a team is often the first thing I do in front of people I am onboarding. A raw failure there costs me the room's confidence in the tool before we have voted once. The notes treat this as "loud but obvious"; for me it is the worst-timed failure possible, because I cannot fix it live. Fixing it is the right priority.

2. The silent failure is worse, and I agree. A resurrected archived default means a new team votes on a topic the other teams retired. I would not notice, and neither would they. Comparability across my three teams is the thing I use the trend data for. Good call making the filter and the restore list share one definition.

3. Renumbering to contiguous 1..n is fine by me. I care about relative order, not the integers. The order of topics is part of the rhythm of a session (I know where the heavier topics land). So the order must stay the canonical order, which `row_number()` over `display_order` preserves. Confirm that the tie-break never reorders non-duplicate rows.

4. The restore list (`defaultTopicsNotActive`) is something I actually see on the topic management screen. Sorting out that an archived template default is not offered as "restore" is right. The notes correctly protect the case I do use: a team that archived its own copy of a default must still be able to restore it. That is the valuable direction, keep the test.

5. The anomaly warning event goes to an operator. As a facilitator I cannot see it and should not need to. Good. But see question 2.

## Questions

1. If the template has zero active defaults, what does the person creating the team see? The notes say it already throws `NoActiveTopicsError`. What I need is plain language: "this team could not be set up with the standard topics, contact an administrator", not a stack-style message, and the team should not be half created. Does the transaction roll back the team row, the membership, and the first session together, so I can simply retry later?

2. If creation succeeds but the template had an anomaly (duplicates, gaps), does anything in the UI differ for me? I would say no, and that is the right answer. Please confirm no facilitator-facing banner is added. Warnings for operators, silence for me.

3. Teams already created under the bug: the notes say not repairable here. For me the question is whether any of my teams could be affected. Is there a read-only check an administrator can run so I can be told "your teams are fine" rather than finding out in a session? I would not want to discover an extra topic mid-vote.

4. Does the first session snapshot (`snapshotSessionTopics`) run after the renumbering in the same transaction, so the first-session topic list and the team topic list agree? A first session is already the hardest one to run. A mismatch between what the team has and what the session shows would be a visible oddity.

5. The side finding on the name-only join producing two rows for one default: could that show as a duplicate "restore" entry on the screen I use? If so, it is user-visible and I would like it filed, not just noted.

## Suggested additions

1. Add an acceptance statement from the user's side: "A new team created by a facilitator always starts with exactly the active default topics, in canonical order, numbered 1 to n, every time, regardless of template history." Easy for me to verify by eye in a real session.

2. Add a check that `first_session_description` (the first-session guidance I rely on for onboarding) is copied intact and unchanged by the renumbering insert. The column list is being rewritten for `INSERT ... SELECT`; a dropped column here would silently remove my onboarding help text. Put it in the regression assertion.

3. Add a check that the copied topics' vote types and prompts are unchanged. Obvious, but the insert is being rewritten.

4. Make the failure message for the zero-active-defaults case part of the spec, in plain language, with no internal ids.

5. Make the template invariants health test (twelve active defaults, contiguous order) run in CI as proposed. I would also like it documented somewhere a non-engineer can read: the list of the twelve default topics, as the canonical set.

6. Once built, I will do a spot check in a real browser: create a team as facilitator, confirm twelve topics in order, archive one of the team's own defaults, confirm it appears under restore, restore it. That takes five minutes and covers the only two paths I touch. Please schedule it before merge, as offered in my usability role.

## Does this lead to a tool that disappears into the background?

Yes, for this change. The best outcome is that I notice nothing: team creation works first time, topics are in the right order, restore offers only what makes sense. The decision to decline the database trigger also suits me, since it adds migration friction for engineers without any benefit I would feel. The risk to watch is scope creep into anything facilitator-visible (banners, warnings, new copy). Keep the diagnostics on the operator side.
