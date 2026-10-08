# Explore review: template-team-not-usable (#214), Facilitator view

*Reviewer: Priya Nair (Facilitator, SME), 2026-10-06. Reviewed `exploration-notes.md` and spot-read
`SessionCreationPage.tsx`, `TeamPage.tsx`, `TopicManagementPage.tsx` and the draft/new-team routes
in `facilitator-sessions.ts`. Nothing was run.*

My lens: does the picker and the session room stay quiet and trustworthy, so I can pay attention
to the people instead of the tool? Most of this change is backend plumbing I defer on. These notes
cover where the plumbing shows up on my screen.

---

## Observations

1. **Devon has the core pain right.** A team called `__default_topics__` in my picker makes me
   hesitate before every session: is that a real team, did someone set it up for me, should I
   click it? Even if nobody ever picks it, it's noise at the moment I want the fewest decisions.
   Taking it out of the picker is the single most visible win here. I'd make it the first thing
   the proposal promises.

2. **Chain B is described the way it would actually happen.** I've rehearsed before a new team's
   first session myself. The odd entry in the picker is exactly where a nervous facilitator would
   try it, and the session room gives no sign that it's the canon. It isn't malice, it's
   preparation. That's why "refuse it unconditionally" is right and "warn the facilitator" is not:
   a warning is one more thing I have to read and dismiss.

3. **The practice-mode risk (§8) is the most important human point in the notes.** If people were
   rehearsing on the template, removing it pushes them to rehearse on a real team. A dry run on a
   real team leaves real votes, a real reveal and a session in that team's history, and that
   history is what the next facilitator reads for continuity. That's worse than the bug. I support
   checking the data first. If the check finds practice sessions, filing the follow-up should be
   required, not optional.

4. **"Permanently locked" copy (§7) is the right instinct.** The current line, "cannot be customized
   until this team completes its first session", invites someone to try to make that happen. The
   suggested copy ("These are the canonical default topics every new team starts from") tells the
   reader what they're looking at. I agree with putting the reason on the server (`lockReason`).

5. **Per-endpoint parity is fine for me as long as my screens show honest messages.** I don't mind
   which status code the API returns. I do care what the confirm screen says (see Q2).

6. **The picker's empty state already reads well.** If the template was the only team on someone's
   list, filtering it out shows the existing "no teams you can facilitate right now … Create one"
   message (`SessionCreationPage.tsx:443-447`). That's the right outcome and needs no new copy.
   Worth naming in the proposal so nobody adds a special case.

## Usability concerns the notes don't cover

7. **Stale picker → confirm screen → misleading error.** A facilitator who loaded the picker before
   deploy (or kept the tab open) can still choose the template. The draft POST then returns
   404 `TEAM_NOT_FOUND`. The confirm screen only handles 409 and 403 explicitly. A 404 falls through to
   *"Something went wrong creating this session. Please try again."* (`SessionCreationPage.tsx:273`).
   Trying again won't help, and a facilitator a few minutes from a session will keep trying. The
   list is marked stale, so "Back" refreshes it, which is good, but the message should send people
   there. Suggest a 404 branch: "This team is no longer available. Go back to choose another team."
   That copy fits a missing team too, so parity holds.

8. **Facilitators and participants in the middle of a session at deploy time.** If an environment has a
   non-terminal sentinel session (the pending #188 data check), the guards and the DB constraint
   cleanup could end that session while people are in it. Nothing should end a session without the
   facilitator ending it. The notes treat the data check as a gate on the migration. I'd also like
   the proposal to say what happens to an open sentinel session: cleaned up in a maintenance
   window, never mid-session, and how a facilitator holding a link would know.

9. **Participants holding an old sentinel join link.** They'll land on `/join-error?joinError=invalid`.
   That's correct for parity, but check that the page's copy points them back to their facilitator
   ("ask your facilitator for a new link") rather than reading like they did something wrong. If the
   copy is already right, say so in the proposal and move on.

10. **The new-team form hits the template's name.** `POST …/sessions/new-team` checks name collisions
    against every `teams` row, the template included (`facilitator-sessions.ts:589`). A facilitator
    who types `__default_topics__` gets *"A team named "__default_topics__" already exists."* That's
    unlikely and harmless, but it's one more place the sentinel shows through as a team. Either
    accept it explicitly in the proposal or leave it out of scope on purpose. Don't let it be
    discovered later.

11. **Other read surfaces I'd look at in a session.** The notes cover the screens that write. I'd also
    like one line confirming the template can't appear in the read views I use for continuity:
    session history, the trend dashboard, any EM or admin team list. If it shows up there with
    leftover practice data, a facilitator picking up a team will see results that don't belong to
    anyone. "Blocked by membership, so unreachable" is a fine answer if it's true. Write it down.

12. **The #237 entry point depends on this list being correct.** The "Facilitate another team's
    session" link on `TeamPage` takes me straight to the picker, so the first thing a facilitator sees
    from their own team page is the template. That makes the picker filter more urgent than
    "low traffic" suggests.

## Questions

- **Q1.** Did the #188 environment data check find any sentinel sessions or votes? That answers
  whether practice mode is a real need (Obs 3) and whether anyone could be mid-session at
  deploy (Obs 8). Who owns running it, and when?
- **Q2.** Will the proposal include the confirm-screen 404 copy change (Obs 7), or is the frontend
  out of scope apart from the picker and Topic Management? I'd count it in scope: it's part of
  making the template disappear.
- **Q3.** For Topic Management, will an admin who opens `/team/<sentinel>/topics` see a page title
  with the raw name `__default_topics__`? If the server sends `lockReason: "canonical_defaults"`,
  could the page also show "Default topics" as a readable heading instead of the sentinel name?
- **Q4.** With the DB constraint in place, an unguarded route fails as a 500. Where would a
  facilitator see that, and what would it say? Fail-closed is right, but a generic error in the
  session room mid-ritual is the kind of thing that breaks the room's focus. Is the structural
  test confident enough that no facilitator-facing route can reach the constraint?

## Suggested additions to carry into the proposal

- A short **user-visible outcomes** section ahead of the route tables: (a) the template never appears
  in the picker, (b) a stale selection fails with a message that sends the facilitator back,
  (c) old sentinel links show a friendly invalid-link page, (d) Topic Management describes the
  canonical set honestly, (e) no session in progress is ended by this change.
- A frontend task for the confirm-screen 404 branch (Obs 7), with a test.
- A regression test that the picker empty state appears when the template was the caller's only
  eligible team (Obs 6).
- Explicit dispositions for the new-team name collision (Obs 10) and the read-only surfaces
  (Obs 11), even if both are "accepted, out of scope".
- Make filing a "facilitator practice mode" issue a conditional deliverable, triggered by the data
  check finding sentinel sessions. Keep the rule that practice never touches the canon or a real
  team's history.

**Overall:** the exploration should lead to a tool that recedes during sessions. The structural
approach removes a decision instead of adding a warning, and that's what I want. The gaps are at
the edges: stale screens, people already holding links, and error copy. That's where a facilitator
would actually run into this change.
