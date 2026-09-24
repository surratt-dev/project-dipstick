# Facilitator Review — Join Link Redemption Wiring (Issue #166)

**Reviewed by:** Priya Nair (Facilitator persona)
**Reviewing:** `exploration-notes.md` (Devon Calloway)

---

## Overall

This is a solid technical exploration and I don't have corrections to the bug-tracing or the shape-mismatch argument in §1 — the get-or-create-per-team model is the right one, and I want to say explicitly *why* it matters to me: it's good for continuity across facilitators. If the link is stable per team rather than reminted every session, then a link I pin in a team's Slack channel, or hand off to a facilitator covering for me, stays valid across sessions instead of quietly rotting the next time someone drafts a session. That's exactly the kind of thing that lets a handoff happen without a conversation. Keep that property.

My concerns are about what happens at the moment a real person acts on this link, not about the token mechanics.

---

## Observation 1: The badge and the "when do I actually tell people to click it" problem

Devon's right that "(not yet joinable)" becomes a false statement the moment redemption is wired. But I want to reframe the stakes slightly, because this isn't just a truth-in-advertising issue to me — it's an onboarding-workflow issue.

Part of the value I already committed to from the #45 exploration was staging: I copy the link during `draft`, before I click "Open the room," so I can drop it in Slack or read it out loud ahead of time. That means the *first* thing a badge like this needs to do is tell me, correctly, when it's safe to tell my team "go ahead and click it." Once the badge no longer describes the real gate (session access, not team access), whatever replaces it has to still answer that operational question for me in plain language — not just be accurate about what's gated underneath.

**Suggested addition to design.md:** whatever wording replaces "(not yet joinable)" should center the facilitator's actual question — "is this safe to hand out yet, and what will happen if someone clicks it right now" — not just correct the noun being gated. Something like distinguishing "this link works" from "clicking it right now gets you nothing but a team roster page" would serve me better than a technically-accurate phrase like "team access only."

## Observation 2: The lobby-landing gap is not an edge case — it's the default first-session experience, and it's invisible to me too

This is the one I want to push hardest on, and I think it's understated in the notes even though Devon named it clearly.

Trace who actually hits this. During staging (`draft`), I'm the one being told the link is ready. My natural next move — especially with a **new team**, where I'm trying to make the first session as low-friction as possible — is to share it right then, before I've clicked "Open the room," so people can join ahead of time and I don't spend the first five minutes of a live session walking people through account creation. That's not a misuse of the feature; for a new team, that's the workflow I'd actually use.

Once #166 ships on its own, the link *works* — team membership succeeds — but the person lands on `TeamPage`, sees a roster, and nothing that looks like "you're in, wait here." From their side, this looks exactly as broken as the current fully-dead link, except now it's *intermittently* broken in a way that depends on session status they have no visibility into. Today, a facilitator gets "this link does nothing," which is unambiguous and gets reported as a bug. After #166 alone, a facilitator gets "it worked for some people and dropped others onto some team page," which reads as flaky, not broken — a much worse thing to be debugging live, in front of a new team, during the exact first-session window I'm most trying to protect.

And here's the part that's specifically my problem, not just the Engineer's: **I don't find out either.** Devon's notes already say it — "No live participant-presence signal reaches the facilitator's live-readiness-view." If I share a link during `draft` or `lobby` and three people click it, I have no readiness signal, no roster update, nothing telling me they're there. I'll assume the link is still broken and either re-share it (confusing them further, since it "already worked" for them) or start the session down three participants without knowing why. That's a direct hit against the control-surface property I care about most — I should never be flying blind on who's actually arrived.

**Questions for design.md, not asking Devon or Priya to resolve here:**
- Is #166 intended to ship before, after, or simultaneously with #164? If #164 is meaningfully behind, has anyone weighed whether shipping redemption alone actually makes the facilitator's first-session experience *worse* than today's cleanly-dead link?
- If #166 ships first, is there an interim mitigation worth the small cost of building — even something as blunt as a one-line note under the copy button during `draft`/`lobby`: "people who click this before you open the room won't see a waiting screen yet — best to hold sharing until you're ready to start"? That's a workaround, not a fix, but it's cheap and it directly protects the first-session moment I care about most.
- Separately from the badge wording: should `facilitator-state` or the live-readiness view surface *any* signal — even a crude one, like "N people have joined the team since you opened this page" — so I'm not silent on this until #164 lands? I don't need full presence tracking; I need to not be the last to know.

## Observation 3: Does this still disappear into the background?

For the redemption fix itself — yes. Fixing the token and the path is invisible, in the good way: it just makes a thing that should already work, work. That's the right kind of change.

The risk is entirely in the gap between #166 and #164. If nothing is said or done about it, the first time a facilitator (probably me, onboarding a new team) shares a link before opening the room and gets confused reports back from participants, the tool stops disappearing and starts requiring an explanation — from me, live, to a team on their first exposure to the ritual. That's the opposite of what I need this to be. I'd rather this exploration name that risk loudly in design.md than have it discovered the same way the original bug was: by someone tracing a "Partial" checkbox after the fact.

## Observation 4: Not a concern, just confirming scope

None of this touches reveal simultaneity, readiness-without-spoilers, outlier flagging, or session pacing — the four things I'd otherwise stop everything to protect. This change is entirely upstream of a session ever going live, so I have no objection on those grounds. My concerns above are about onboarding friction and facilitator visibility, not ritual integrity.

---

## Summary of asks for design.md

1. Badge/messaging replacement should answer "is it safe to share this right now" in plain terms, not just correct the gated noun.
2. Explicitly address sequencing risk between #166 and #164 — does shipping redemption alone, before landing is fixed, make the first-session experience worse than today's inert link? If so, is an interim mitigation (a caution note during draft/lobby, or a minimal join-count signal to the facilitator) in scope for this change even though the full #164 fix isn't?
3. If no mitigation is taken, this needs to be stated as plainly as Devon already suggested for the AC — but stated to *me*, not just to engineering: I need to know, before I use this with a live team, that sharing early can produce silent confusion I won't see either.
