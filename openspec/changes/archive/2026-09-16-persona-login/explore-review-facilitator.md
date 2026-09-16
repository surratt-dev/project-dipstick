# Exploration Review: Persona Login

**Reviewed by:** Priya Nair (Facilitator, Subject Matter Expert)
**Date:** 2026-09-16
**Source reviewed:** `openspec/changes/persona-login/exploration-notes.md` (Devon Calloway, 2026-09-16)

---

## Preface: what I'm qualified to weigh in on here

I want to be upfront about scope. I'm not an engineer and I don't have opinions on `isPrivateAddress()`, OIDC gating, or the double-check redundancy Devon proposes — that's exactly the kind of infrastructure judgment I defer to the team on, and from a distance it reads as careful. What I *do* have standing to weigh in on is the thing I was asked to check: does this stay a disappearing dev convenience, or does it create any risk — direct or indirect — to the properties I hold the team to (reveal simultaneity, readiness-without-spoilers, advisory outlier flagging, facilitator-controlled pacing, role separation)? My review is filtered through that lens, not a general engineering review.

## Overall reaction

This is sound, and I appreciate that Devon framed it correctly from the start: "none of my four load-bearing rules... live anywhere near authentication." I agree with that boundary. The mechanism itself (`login_hint` passthrough, IdP-side auto-approve, untouched callback path) doesn't touch anything I'd fight about. My comments below are less "stop" and more "make sure the labels on this thing don't quietly teach the team the wrong mental model."

---

## Observations

1. **This correctly stays out of the ritual's UI.** Point 4 in the exploration notes — deliberately making this landing page look like scaffolding, the inverse of the "disappear into the background" goal for session UI — is exactly right, and it's the thing I most wanted confirmed. A real facilitator or participant should never see this page, and nothing in the sketch suggests it would leak into a live session. Good.

2. **The "Manager" persona label is the one I'd push hardest on, and for a different reason than Devon's.** Devon flags (point 3, and again in "Where I landed") that the label overpromises a role the app doesn't currently grant, absent seeded `team_memberships`/`global_role` data. I want to sharpen *why* that matters to me specifically: no-manager-participation is my single most load-bearing rule. If an engineer clicks "Manager," gets a fresh no-role account, and then successfully joins a session as a participant — they may reasonably conclude "I tested that a manager can't do X" when they tested nothing of the kind, because the account was never actually a manager in the app's eyes. That's not a UX inconvenience, that's a false negative on the rule I care most about. I'd want this treated as more than a "worth deciding" scope question — I'd want it decided before this ships, one way or the other, with the landing page being explicit about which it is.

3. **A single "Facilitator" persona button may not be enough to exercise the rule that matters to me second-most.** My other core rule is facilitator-from-another-team — a facilitator running a session must not belong to the team being reviewed. A one-click `facilitator-001` doesn't tell you which team that account is (or isn't) scoped to relative to whatever team you're testing against. If the seed data only gives you one facilitator identity, an engineer testing "does the app enforce cross-team facilitation" may not have the fixtures to actually exercise it — they'd need at least two team-scoped facilitator identities, or a facilitator + a team, to represent the constraint at all. This might already be out of scope for what "Persona Login" is trying to solve (it's a login shortcut, not a seed-data overhaul), but I'd want it asked explicitly rather than assumed away, because the alternative is a team believing they've smoke-tested facilitator/team separation via this tool when they haven't.

4. **I don't see a stated risk here, but I want it named anyway: convenience tooling can quietly become the *only* way engineers test.** Once a one-click persona login exists, it becomes the path of least resistance for every manual check during development — including checks that touch my two rules above. That's fine and good for velocity, but it raises the bar on point 2 and 3 above: if this tool is going to be the default way engineers reach for "log in as a manager" or "log in as a facilitator," it needs to actually represent those roles accurately, or it needs to say loudly that it doesn't. A tool that's *inconvenient* to misuse is safer than one that's *convenient* to misuse.

5. **Nothing in the notes describes what the landing page copy or layout actually looks like.** Devon's point 4 talks about the page needing to look "obviously like scaffolding," which I agree with, but there's no sketch of what that means concretely (four buttons and nothing else? account IDs visible? a banner?). I don't need to approve visual design, but before this goes to implementation I'd want to see a mock, mainly to check that if role-seeding is *not* implemented (per point 2 above), the caveat is visually impossible to miss — not a tooltip, not fine print underneath the button. Given how much weight I'm putting on point 2, "the button visually says something different from what it does" is the failure mode I'd flag hardest.

## Questions

- Is there an intended answer yet to "does Persona Login also seed `team_memberships`/`global_role` data," or is that genuinely still open? Devon leans toward yes eventually but treats it as separable — I'd like to know if it's separable *for this proposal* or deferred to a later one, since the honesty of the labels depends on knowing which.
- If role-seeding is out of scope for this change, will the four buttons be relabeled to something honest (e.g., "participant-001" instead of "Participant") until the labels are true, or will the labels ship ahead of the behavior they imply?
- Does "Facilitator" map to a single seeded account, or is there a plan (in this change or a follow-up) for team-scoped facilitator fixtures sufficient to test cross-team facilitation?
- Who signs off on the "looks like scaffolding, not product" bar before this ships — is that a design review, or does it fall to whoever picks up the ticket? I'd want to see it once before it's called done, the same way I've asked to usability-test the facilitator view.

## Suggested additions to carry into `design.md`

- Explicit decision (not "lean toward"): does this change seed matching role data for the four accounts, yes or no. If no, the landing page must say so per-button, not in a footnote.
- A note that "Facilitator" as a single seeded identity does not, by itself, let someone test facilitator-from-another-team — either scope that out explicitly or note it as a known limitation so nobody assumes coverage that isn't there.
- A rough mock or description of the landing page layout, specifically so the "obviously scaffolding" bar in point 4 of the exploration notes has something concrete to be checked against.

---

**Bottom line:** the mechanism is orthogonal to the ritual as designed, and I'm not worried about it leaking into what a real facilitator or participant sees. My concern is narrower and specific: the persona *labels* need to either tell the truth about what role they grant today, or say clearly that they don't — because the two rules I care most about (no-manager-participation, facilitator-from-another-team) are exactly the ones a mislabeled shortcut would give someone false confidence about testing.
