# Facilitator Review — Exploration Notes, Inline Team Creation (#44)

**Reviewed by:** Priya Nair (Facilitator, SME)
**Reviewing:** `openspec/changes/inline-team-creation/exploration-notes.md`
**Also read:** `requirements/use cases/02 - Session Setup - Use Cases.md` (both "Create Session for Existing Team" and "Create Session for a New Team")

---

## Overall

This is a solid piece of exploration — the technical archaeology (§2–§4, §7) is exactly the kind of thing I can't evaluate myself and I have no notes on it. My review is narrower: does this lead to a tool that gets out of my way during the moment I'm actually running a session, and does it handle the specific moment where I'm bringing a team into the ritual for the very first time. Two things stand out that I want on record before propose: the draft/lobby question (§9.6) needs a facilitator-shaped answer, not just an engineering-consistency answer, and there's a real gap around what "first session" support looks like at the *creation* moment, not just later at begin-voting.

---

## 1. On the draft-vs-lobby open question (§9.6) — my answer, with a caveat

I don't want the two-screen draft gate from the existing-team flow (#153) copied here wholesale. That gate exists for a specific reason — reviewing team context before an irreversible "open the room" action, per its own design rationale (D6). For a brand-new team there's genuinely nothing to review: no prior sessions, no history, no "is this the right team" ambiguity the way there can be when picking from a list. Forcing me through a second screen that has nothing on it is exactly the kind of friction that makes a tool feel like it's managing me instead of the other way around. So: I agree with Devon's lean toward landing directly in the session room, skipping `draft`.

**But** — and this is the part I want flagged before it gets waved through as "obviously skip it" — the *reason* the draft gate exists (protect against committing to an irreversible action based on a mistake) doesn't disappear here, it moves. In the existing-team flow, the irreversible thing is opening the room. In this flow, the irreversible thing is the team name itself. I'm typing a name into a free text box, not picking from a constrained list, and per the exploration's own §1 finding, there's no separate team-management screen — meaning if I fat-finger "Platfrom Team" instead of "Platform Team," that typo is now the permanent identity of this team across every session, trend chart, and handoff to another facilitator for as long as the team exists. That's a worse failure mode than picking the wrong team off a list, not a better one — a wrong pick from a list is at least a real, correctly-spelled team I can undo by starting over before I submit; a typo in a freeform field I might not even notice until session three.

So my ask isn't "bring back the draft screen." It's: **don't let "skip the draft status" quietly become "no confirmation moment at all."** Something as light as showing the typed name back to me on the submit button itself ("Create team 'Platform Team' and open session room") would catch most of what I'd actually fat-finger, without adding a screen or a status. That's a propose-stage UX call, not an engineering one — flagging it so it gets made on purpose.

## 2. First-session support is under-specified at the moment that matters most to me

My whole reason for caring about this feature is the first session for a new team — it's the hardest one I run, and it's the one where the application either shoulders some of the onboarding load or leaves me doing it all by memory. The exploration's §4 finding on `is_first_session` is the right technical catch (glad it's there, glad it's flagged as a named AC and not "inherit the existing endpoint's behavior"), but it's tracking the flag's *plumbing*, not what I actually see.

Two things I didn't see addressed, and want named as open questions for propose:

- **What do I see when I land in the session room for a brand-new team?** The use case's Main Flow step 10 just says "the session room, including the join link and the participant readiness view (initially empty)." For an existing team, I've been here before — I know what an empty readiness view means and what to do next. For a team I just created thirty seconds ago, landing on an empty room with no acknowledgment that anything happened (team created, twelve topics assigned, first session flagged) feels like the confirmation vanished. Even a single line — "Team created. Default topics assigned. Share the link below to get started." — would close that gap. Right now nothing in the exploration or the use case says this exists, and I don't want it assumed as "the empty state speaks for itself."
- **Do I get to see the topic set that got assigned?** Out of Scope explicitly excludes *customizing* topics at creation, and I'm not asking for that. But given §3's finding that the seeded six-topic default doesn't even match the documented twelve — I'd like a read-only confirmation of what landed on this team before I'm explaining vote types to a room of engineers who've never done this before. If the wrong set silently attaches, first session for this team runs on bad data and I won't find out until someone asks why "Project Trend" is the only Roman-numeral vote instead of two of them. This is a case where a small amount of visibility protects both me and the team's inaugural data.

Neither of these needs to block propose — but I'd rather they land as explicit open questions than get silently decided as "no, out of scope" by inheriting whatever the existing-team room view already shows.

## 3. Team-name uniqueness — case sensitivity (§6, open question 4): I have a real example

The exploration flags exact-vs-normalized match as a product call it's not positioned to make. I'll make it: I've personally seen near-duplicate team names happen in practice — not in this application, but in the physical version of this ritual, where one team's lead wrote "Platform" on a signup sheet and another wrote "platform-team" three weeks later, and nobody noticed until I was staring at two nearly-identical rows in a spreadsheet trying to figure out which session belonged to which team. That's exactly the continuity problem I rely on this application to solve for me (Success Criteria #3–4 in my persona notes — trend history and handoff context only work if "the team" is a single, unambiguous thing). I'd push for a normalized (case/whitespace-insensitive) uniqueness check, not exact match. This is a small server-side decision now; it's a much bigger cleanup problem later once six sessions of trend data are attached to the wrong-cased duplicate.

## 4. Question: can I get back to the picker cleanly if I start the new-team form by mistake?

The exploration (§5) makes a strong and correct case that this should be a third state in `SessionCreationPage`'s existing state machine rather than a separate route. I have no engineering opinion on that, but I do have a usability one: if I click "Create a new team" and then realize I actually meant to pick an existing team from the list, is there a clean way back to the picker with nothing left behind — no orphaned draft, no team half-created? The use case's Main Flow implies nothing is created until step 5 ("validates team name") / step 6 ("creates the team record"), which suggests backing out is safe by construction, same as the facilitator-neutrality point in §8. I'd just like this stated explicitly as an AC or a note in propose ("navigating back from the new-team form to the picker before submission creates nothing and is always available") rather than left implicit — it's a one-line addition and it's the kind of thing that's obvious to an engineer reading the code and invisible to a facilitator who just wants to know if it's safe to click around.

## 5. Empty-state copy (§5, open question 3) — agree this needs real language, not a bolted-on button

Strong agreement with the exploration here. A facilitator with zero eligible existing teams — which, per the Preconditions note, includes a newly-granted Facilitator who hasn't been added to anyone's team yet — hitting a screen that used to be a dead end and now has one new button, with no updated framing, is a bad first impression for exactly the audience I care most about getting right: people who are new to this tool and possibly new to the ritual itself. I'd want this copy to actively invite new-team creation ("Don't see your team? Create one to get started") rather than reading as "here's nothing, except also here's this other option." Small thing, but it's the first sentence a brand-new facilitator sees.

## 6. Not a concern, just confirming out of scope

Reveal simultaneity, readiness-without-spoilers, outlier flagging, and session pacing — none of these are touched by team creation, and I don't think they should be. Confirming I checked, not raising anything.

---

## Summary

- **Draft/lobby (§9.6):** skip the draft-status gate — but don't let that also mean skipping a lightweight confirmation of the typed team name before an unfixable typo becomes permanent. Propose stage should decide the shape of that confirmation explicitly, not by default.
- **New addition:** the moment I land in the session room for a new team needs *some* acknowledgment that team creation + topic assignment succeeded — currently unaddressed.
- **New addition:** consider read-only visibility into the assigned topic set at creation, especially given §3's finding that the current seed data may not match the documented default — this is the one session where I most need to trust what's in front of me.
- **Team-name uniqueness (§6):** normalize for case/whitespace, based on a real recurring failure mode from the physical ritual.
- **New question:** explicit confirmation that backing out of the new-team form before submission is always safe and leaves nothing behind.
- **Empty-state copy (§5):** agree with the exploration; the copy should invite new-team creation, not just tolerate it.
