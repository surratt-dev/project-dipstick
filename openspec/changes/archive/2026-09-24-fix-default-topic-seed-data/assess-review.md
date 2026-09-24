# Review: fix-default-topic-seed-data assessment

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `assess.md` (Devon Calloway)
**Date:** 2026-09-24

---

## Verdict

Approve, with one finding that needs a decision before this is implemented — not a design decision, but a content decision, and it's mine to make since it's my AC wording that's ambiguous. Everything else in the assessment checks out against source documents I read directly, not just Devon's transcription of them.

## What I verified directly

I read `requirements/use cases/08 - Topic Management - Use Cases.md` (the AC, line 39), the live `packages/backend/migrations/4_seed_data.sql`, and `requirements/entities-and-relationships.md` myself, rather than trusting the assessment's tables. I also ran my own checks against `packages/backend/src/routes/teams.ts` and the migrations directory rather than accepting Devon's grep results as given.

- **The 12-row transcription table is accurate.** I compared every prompt string and vote type in Devon's table against the AC bullet word for word. No drift, no paraphrasing errors. Display order (1–12) matches the AC's list order, which is the correct source for "canonical order" per the use case's Main Flow step 3.
- **The six verbatim-carried descriptions are exact.** I diffed Devon's quoted text for items 1, 5, 9, 10, 11, 12 against the live text in `4_seed_data.sql` character for character. All six match exactly. No paraphrasing crept in under the claim of "verbatim."
- **The naming convention is correctly grounded.** Devon's rationale — group by Topic Area with a facet suffix — rests on `entities-and-relationships.md` having five Topic Areas (Production Code, Test Suite, Pipeline, Technology Stack, Pairing) and no "Project Trend" area. I confirmed that directly (lines 36–41 of that doc). This matches my own model: Project Trend was never a Topic Area, it's the standalone closing question, which is why it's correct that only Production Code and Test Suite get split into facets and the other three (plus Trend) stay singular. Devon didn't just invent a naming scheme — he found the one my own entity model already implies.
- **"No data-correction pass needed" — confirmed independently, not just re-derived from Devon's grep.** I read `teams.ts` myself. There is exactly one `POST` handler in that file (`app.post` at line 1049), and it's `/api/v1/teams/:teamId/managers` — establishing a manager on an *existing* team, not creating one. I also checked the most recent session-creation commit (`f84dd51`, "session creation for existing teams") and it explicitly only handles existing teams. So Devon's claim holds up under my own read, not just his: there is no team-creation code path on `main` today, therefore nothing could have copied the stale six-topic seed into a real team.
- **Migration numbering — confirmed independently.** `ls packages/backend/migrations/` tops out at `10_sessions_team_active_unique.sql`, so `11` is next. I also checked the stashed `#44` branch directly (`git stash show -p`) and it does reference `migration 11` for the teams-name-unique index, confirming the renumbering note is real and not speculative.

I have no notes on any of the above. Devon did the legwork and it's right.

## The one thing that needs my judgment call: item 12's `prompt`

This is the real finding, and it's the kind of thing the assessment should have caught but didn't.

The AC's twelfth bullet reads: `"Project Trend" (Modified Roman — up/steady/down)`. Devon transcribed this literally: `prompt` = `"Project Trend"`. Taken at face value, that means the text an Engineer sees on screen during live voting for the closing question is the two-word label "Project Trend" — not a question, not even a descriptive phrase, just a name.

Compare that to every other entry in the AC:
- Ten of the twelve are full questions ("How easy is it to...", "Is the test suite...", "Are you comfortable with...", "How effective is...").
- Item 9, "Confidence in the pipeline," is the one Devon already flagged as non-question phrasing — but it's still a descriptive phrase a participant can read and act on.
- Item 12 is different in kind, not just in phrasing: it's a bare label, and it happens to be identical to the `name` I'd expect the implementer to assign this topic (which is exactly what the existing six-topic seed already does — `name = 'Project Trend'`).

That last point is the tell. In the current seed, `name` and `prompt` are deliberately distinct for every topic, including this one: `name = 'Project Trend'`, `prompt = 'Overall, is this project trending up, steady, or down?'`. Devon's own callout in the assessment (`name` values are "distinct from `prompt`" per the schema) is correct as a general principle — and item 12 is the one place his own proposal would violate it, because he'd be setting `prompt` to the same string a reasonable `name` field would also use.

I wrote the AC. When I wrote `"Project Trend"` for that bullet, I was using it the way I use it everywhere else in my own docs — as a topic label, not as a transcription instruction for the literal on-screen voting prompt. My intent for that closing question was never "flash the words 'Project Trend' at people and expect them to know what to do with a modified-roman vote" — it was the fuller framing that's already live: *"Overall, is this project trending up, steady, or down?"* That phrasing is also what the carried-forward description (item 12's description, which Devon is correctly reusing verbatim) is written to pair with — the description talks about "vote up if things are genuinely improving," which reads naturally after a question, not after a label.

**Recommendation:** Don't silently take the AC literal here. This is the one entry where I'd flag it before the migration is written, the same way Devon already flagged item 9 for me. My answer, so this doesn't have to bounce back to me a second time: keep the existing seed's full question — *"Overall, is this project trending up, steady, or down?"* — as the `prompt` for item 12, and let `name = "Project Trend"` carry the label the AC bullet was actually naming. This is not a new content-authoring task like the `first_session_description` gap; it's recovering wording that already exists and was clearly what "Project Trend" was shorthand for. Everything else about item 12 (vote_type, display_order, description) is fine as proposed.

## Everything else drafted (the six new facet descriptions)

I reviewed the six newly-authored `first_session_description` drafts (items 2, 3, 4, 6, 7, 8) against what I meant when I split Production Code and Test Suite into four facets each. Two things I specifically checked for:

1. **Does the Active Development vs. Entire Project split actually reflect distinct intents, or is it padding?** It's real. The distinction — "the code you're in right now" vs. "the codebase as a whole, including the parts nobody's touched in a year" — is exactly why I split these out. Teams consistently rate their current working area differently from legacy code, and collapsing that into one number was a real loss in the old six-topic seed. Devon's descriptions for both facets, on both areas, capture this correctly and in parallel language across Production Code and Test Suite, which is what I'd want.
2. **Style consistency with vote type.** Item 6 (Test Suite — Consistency) is the one facet using `roman` instead of `finger`. Devon wrote its description in "Vote up if... Vote down if..." binary framing, matching how the other roman-vote topic (Technology Stack) is already written — not the 1-4 scale framing used for finger topics. That's the right call and I'd have flagged it if he'd gotten it wrong.

No changes needed to the six drafted descriptions. They should be labeled as drafted-not-transcribed in the proposal, as Devon already recommends.

## Minor, not blocking

- Item 9's non-question phrasing ("Confidence in the pipeline") — already resolved per the assessment's note that I confirmed this is intentional. Nothing further needed from me here.
- The BRD discrepancy (5 topics, no Trend) — agreed this is stale documentation, not in scope for this change. Worth a follow-up ticket, not a blocker.

## Summary

No design decision here — confirmed, the assessment is right that this is a light-track data fix. One content decision needs to close before implementation: resolve item 12's `prompt` per my recommendation above (use the existing full question, not the bare "Project Trend" label). Once that's folded in, this is ready to build.
