# Facilitator Review — Escalation Contact Mechanism Exploration

**Reviewed by:** Priya Nair (Facilitator / SME), 2026-09-16
**Reviewing:** exploration-notes.md (Devon Calloway, 2026-09-16)

---

## Where this lands for me personally

I want to name why I'm reading this closely even though it's pre-session admin plumbing, not the reveal or the vote mechanics I usually push hardest on: I *am* the persona this gap hurts. I facilitate three teams on rotation, and the exploration notes call out "facilitator from another team, zero prior relationship with this team's admin" as the exact failure case. That's not a hypothetical for me — that's Tuesday. If I open a team I don't normally run and see "Contact your admin" with no name or address, I don't have a Slack DM habit with that team's admin the way I might with my own. I'm stuck exactly as described. So: good that this got scoped seriously, and good that Devon flagged it as a first-impression risk — that tracks with my own "first session is the hardest" concern.

## What I like

- **No new UI chrome.** Text-and-link in the same visual register as `access-model-statement` is exactly right. I don't want a "Request Access" button competing for attention on a page I'm trying to get through quickly before a session.
- **Real, resolvable contact, not a placeholder.** The task-3.10 near-miss Devon cites (`[security/support channel]` literal bracket text shipping to production) is a good catch to reference — I'd have hit that exact dead end and had no idea it was a known bug versus intentional obscurity.
- **Recognizing the two sites aren't symmetric.** TEAM-005 falling back to on-page EM data when it's already there (Option C) is the right instinct — it's literally already rendered a few lines down, so reusing it costs nothing and gets me a name I might actually recognize if it's my own team's EM.

## Observations, questions, and gaps

1. **Timing isn't addressed — and it's the thing I actually care about.** Does this escalation message show up when I'm doing prep *before* a session, with time to email an admin and wait for a reply? Or can I hit this mid-setup, five minutes before participants join, with no way to proceed? The exploration treats this purely as a data/contact-resolution problem, but for me the bigger question is: **am I blocked from starting the session, or just blocked from fixing the underlying role/EM gap right now?** If the session can still run with the stale role assignment or missing EM, the contact mechanism is a "fix it for next time" affordance and the urgency is low. If it blocks session start, this needs much more than a passive text line — and that's a different conversation than the one happening in this document.

2. **No continuity across facilitators.** This is squarely my "Continuity Across Facilitators" concern from my own persona notes. If I hit this wall, email the admin, and then hand the team off (or another facilitator picks it up next session before the admin responds), does the next facilitator know I already escalated? Or do they independently hit the same dead end and send a duplicate email, both of us uncertain whether anyone's on it? A session-history or team-setup note ("EM association requested 2026-09-10, pending") would close this — but I don't see it discussed as in-scope or explicitly out-of-scope. I'd like that named one way or the other, even if the answer is "out of scope for this issue."

3. **Multiple-admin case (Option A) risks becoming a mini-directory.** If there are three Application Admins and the message lists three names and three mailto links, that's no longer "passive visible text" in the spirit of the access-model-statement pattern — it starts to read like a directory lookup. I don't have a strong opinion on the resolution (pick one, show all, alias), but whichever way it goes, I want to see the actual rendered copy before this ships, not just the data-shape decision. A three-name list dressed in the same small-gray-text styling as a one-line statement will *feel* different even if the CSS is identical.

4. **Zero-admin fallback must not quietly become "Contact your admin" again.** Devon flags this as an open question (§5.2) and I want to underline it from the usability side: if the query comes back empty and the UI falls back to generic unhelpful text, that's not a graceful degradation, that's the exact bug we're fixing, reappearing in a corner case. If this state is reachable at all, I'd rather see something honest ("No admin is currently configured for this application — contact your engineering leadership directly") than a silent regression to the old dead end.

5. **Does the message tell me what to *ask for*, not just who to ask?** The current copy for both sites is reasonably specific about the underlying need ("Only an Application Admin or an EM for this team can change roles" / "Associating an EM requires Application Admin access"), which is good — I'd know what to put in the email subject line. I just want to flag this as something to preserve, not silently simplify away when the contact link gets added. A name+email with vague surrounding text is a smaller improvement than a name+email with the current specific framing intact.

6. **One small thing in my favor, worth stating explicitly so it doesn't get lost:** the "admin must resolve to an actual Application Admin, never an EM" distinction Devon calls out for TEAM-006 is exactly right, and I'd extend the caution slightly — even for TEAM-005, if the fallback ever needs to reach for an Application Admin (no EM associated case), make sure that's a *different* person/contact than "whichever EM happens to be listed for a neighboring team" or any other adjacent-but-wrong contact. Wrong-department escalation is worse than no escalation, because now I've bothered someone who also can't help me.

## Does this risk becoming background noise vs. adding friction?

As scoped, no — I think this stays in the spirit of "disappears into the background" *if* the multi-admin and zero-admin cases render as calm, single-line text rather than lists or errors, and *if* nothing interactive gets added. My real residual worry isn't in this document at all — it's the timing question in #1. A perfect contact mechanism attached to a hard blocker that stops a session from starting is still a bad facilitator experience; it just fails later and with an email address attached instead of failing with nothing. I'd like that scoping question answered explicitly before this moves to design.
