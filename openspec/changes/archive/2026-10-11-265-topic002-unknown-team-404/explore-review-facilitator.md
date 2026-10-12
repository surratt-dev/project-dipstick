# Facilitator review (Priya Nair): exploration notes for topic002-unknown-team-404 (#265)

Caveat up front: this is a backend audit-and-error-path change. I will never see most of it during a session. My review is about the one place I do touch it, the topic management screen, and about whether the change keeps the tool out of my way.

## What the notes get right
1. The "Team not found." screen is called out as the real user-facing outcome. Today a stale or mistyped link shows an empty but apparently valid team. That is exactly the kind of thing that costs me two minutes before a session while I wonder whether the team lost its topics. A plain statement is the right fix.
2. Dropping the topic list, definition block and write controls on 404 (note 6) is correct. A dead page should not look half-alive.
3. An existing team with zero topics must stay 200 and empty (note 27). That is the realistic case for a brand-new team. If this ever 404s I will think I broke something on a first session, which is the worst moment.
4. Authorization before lookup, so a participant cannot probe for teams. Fine by me; participants should not see this screen at all.
5. Template team behaviour unchanged. I use it to preview topics before onboarding a team; do not take that away.

## Pain points and friction not captured
1. **Why did I land here?** The notes treat the 404 as a typo case. In practice I reach a bad team id through: a bookmarked link, a link pasted from another facilitator at handoff, or a team that was renamed, recreated or deactivated. "Team not found." alone is a dead end. Suggest the screen offer a way out: a link back to my team picker / team list, and ideally the id I requested so I can compare it with what a colleague sent. Do not make me use the browser back button.
2. **Deactivated teams.** Note 23 says a deactivated team still exists and keeps returning 200. For me, a team that has been retired but still shows an editable-looking topic screen is the same confusion as the ghost team, just reversed. Not for this change to solve, but ask: does the screen indicate a deactivated team? If not, record it as a follow-up so nobody assumes this change fixed "stale link" confusion fully.
3. **Message wording.** "Team not found." is accurate, but a facilitator may read it as "I did something wrong" or "my team was deleted." A second line such as "The link may be out of date, or you may not have access to a team with this id" would reduce panic. Careful with the second half: it must not confirm existence to unauthorized users, and the 403 screen already exists for that. Wording needs a pass from whoever owns copy, and the 403 and 404 texts should read as a matched pair.
4. **Silent blanking on refetch (note 38, item 7).** This is the one that worries me most for live use. If I am editing topics, an annotation refetch fires, and the response is now a 404 (or any non-ok), the screen must not wipe what I am looking at without explanation. Rule I want: a quiet refetch failure never replaces visible content with an error page and never loses an unsaved edit. A small inline notice is fine. Please make this an explicit acceptance criterion rather than "check it handles non-ok gracefully."
5. **Session-time irrelevance.** Please confirm in the design that none of this touches the live session path (facilitator control surface, readiness, reveal). If the 404 change rides on shared helpers, a regression there would cost far more than the problem it fixes. A one-line statement of "live session routes unaffected" is enough.

## Usability concerns on the frontend 404 handling
1. Gating the message on the envelope `code: TEAM_NOT_FOUND` and falling back to "Failed to load topics." for proxy or non-JSON 404s (note 37) is the right call. I would rather see an honest generic error than a confident wrong one. Agree with the notes.
2. The generic failure state should offer a Retry action. A transient network or proxy failure during prep should not require a full page reload.
3. The 404 state should be announced to assistive tech (role alert or focus move to the message), consistent with how the 403 state behaves. Check they match.
4. No loading flash: the page should not show the empty team shell for a moment before switching to "Team not found." Since the check now happens server-side before data, the first render should go straight to the error; verify no intermediate empty-list render.

## Questions
1. Is there any facilitator-facing place that links to TOPIC-002 with a team id that could be stale (handoff links, emailed links, notifications)? Those are where I would actually hit this.
2. After a 404 on the topic screen, what does the rest of the app do with that team id (selected team in a picker, remembered last team)? If the app remembers the bad id, I will land on the dead page every visit. Should the 404 clear the remembered selection?
3. TOPIC-001 vs TOPIC-002 giving 403 vs 404 for the same unknown id (note 28): when I move between the session screen and the topic screen with the same bad id, will the user-visible messages contradict each other ("not allowed" vs "not found")? The one-sentence contract note helps developers, but is the user experience coherent?
4. Audit asymmetry (403 audited, 404 not): agreed on the reasoning, but who reads the log? If a facilitator-who-is-also-a-member keeps hitting a 403 audit row from a legitimate workflow, is that noise acceptable?

## Suggested additions to the notes
1. Add to test inventory (frontend): quiet refetch returning 404/403/500 leaves existing content and any unsaved edits intact.
2. Add to test inventory (frontend): 404 state has a navigation path back (team list or picker) and, optionally, shows the requested id.
3. Add to the design.md "whys": the 404 copy is meant to help a facilitator recover, not to explain internals.
4. Add an explicit non-goal: no changes to live session routes or participant views.
5. Add a follow-up item: deactivated-team indication on the topic screen, and handling of a remembered stale team id.
6. Keep the audit/design justifications already proposed; I agree that undocumented ordering rules get "tidied" away.

## Does this lead to a tool that disappears during sessions?
For the change itself, yes: it is prep-time error handling plus audit hygiene, and nothing in it adds load during a session. The risk is indirect. If the 404 path ships as a dead end, or a refetch blanks a screen mid-edit, it becomes one more thing I have to manage by hand. The notes are strong on the server side and thin on what I experience; the additions above close that gap. I am happy to look at the 404 screen copy and layout in a usability pass before it ships.
