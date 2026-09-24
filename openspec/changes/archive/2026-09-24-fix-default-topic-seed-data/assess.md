# Assessment: fix-default-topic-seed-data

**Author:** Devon Calloway, Principal Software Engineer (Internal Champion)
**Track:** Light — merged Explore + Propose pass
**Date:** 2026-09-24

---

## What the change is

`packages/backend/migrations/4_seed_data.sql` seeds six default topics into the sentinel `__default_topics__` team (`00000000-0000-0000-0000-000000000001`), which the application copies from whenever a team needs its default topic set. `requirements/use cases/08 - Topic Management - Use Cases.md`'s Acceptance Criteria for "Assign Default Topic Set to New Team" enumerates twelve. This change replaces the stale six-topic seed with a new migration that inserts the correct twelve, and adds a regression test pinning the twelve prompts so this can't silently drift again.

This is a data-correctness fix to seed content. No new table, column, endpoint, or code path is introduced.

## Why it matters

I wrote the original topic list years ago, informally, on a spreadsheet. The four Health Check dimensions I cared about most — production code, test coverage, pipeline confidence, and trend — are exactly the ones that got flattened when this seed migration was written: six rows where the canonical requirements call for twelve, with "Production Code" and "Test Suite" each collapsed from four facets down to one. A team's very first session — the one where first-session mode (OR-5.2) is supposed to walk them through the full intent of each question — currently shows them a thinner ritual than the one that's documented, and thinner than the one I've been running for a decade. That gap is invisible until someone actually reads the AC against the seed, which is what happened here: this was caught as a blocking finding during `inline-team-creation` (#44), not because anyone was looking for it.

It also blocks #44 directly: #44's default-topic-provisioning mechanism can copy six rows or twelve with no code change, but its integration test asserts twelve rows against the real seeded data. That test fails today. This change is a hard merge prerequisite for #44, confirmed by the `inline-team-creation` stub and by Marcus Delgado's (BA) review finding.

## Acceptance criteria: the twelve topics

Transcribed from `requirements/use cases/08 - Topic Management - Use Cases.md` AC (line 39), in source list order:

| # | `name` | `prompt` | `vote_type` | `display_order` |
|---|---|---|---|---|
| 1 | Production Code — Adding Features | How easy is it to add features to production code? | finger | 1 |
| 2 | Production Code — Reasoning | How easy is it to reason about production code? | finger | 2 |
| 3 | Production Code — Active Development | How would you rate the code under active development? | finger | 3 |
| 4 | Production Code — Entire Project | How would you rate the code for the entirety of the project? | finger | 4 |
| 5 | Test Suite — Effectiveness | Is the test suite effective? | finger | 5 |
| 6 | Test Suite — Consistency | Is the test suite consistent? | roman | 6 |
| 7 | Test Suite — Active Development | How would you rate the tests under active development? | finger | 7 |
| 8 | Test Suite — Entire Project | How would you rate the tests for the entirety of the project? | finger | 8 |
| 9 | Pipeline | Confidence in the pipeline | finger | 9 |
| 10 | Technology Stack | Are you comfortable with the technology stack? | roman | 10 |
| 11 | Pairing | How effective is pairing? | finger | 11 |
| 12 | Project Trend | Overall, is this project trending up, steady, or down? | modified_roman | 12 |

`name` values are mine — the AC gives prompt text and vote type only, not the short `name` field the schema requires (`topics.name NOT NULL`, distinct from `prompt`). I've named them by Topic Area (matching `entities-and-relationships.md`'s five Topic Areas) with a facet suffix where an area was split into more than one topic. Whoever implements this should treat these as a proposed naming convention, not gospel — but they need to land on something, since `name` can't be null.

**Resolved per Marcus Delgado's review (BA, `assess-review.md`):** item 12's AC bullet — `"Project Trend" (Modified Roman — up/steady/down)`— is the topic label, not a transcription instruction for the on-screen voting prompt. Marcus wrote the AC and confirmed his intent: `name = "Project Trend"` carries the label, and `prompt` takes the existing seed's full question text, `"Overall, is this project trending up, steady, or down?"`, verified character-for-character against the live `prompt` value in `packages/backend/migrations/4_seed_data.sql`. This keeps `name` and `prompt` distinct for item 12 the same way they are for every other topic. The table above reflects this resolution.

One verbatim note: item 9, "Confidence in the pipeline," is the only AC entry not phrased as a question — everything else in the list is. I've transcribed it exactly as written rather than "fixing" the phrasing, since the AC is the confirmed source of truth (Marcus confirmed the twelve-item list is intentional, not a typo) and I have no standing to silently edit accepted requirements text. Worth a one-line callout to Marcus when this is implemented, in case the missing "?" is itself a transcription slip in the AC — low stakes either way, doesn't block the change.

### A real content gap: `first_session_description` is not in the source document

The AC list above gives `prompt` and `vote_type` for each topic. It does **not** give `first_session_description` — the expanded, first-session-only text required by OR-5.2 and the `topics.first_session_description` column. I want to be direct about this because the `inline-team-creation` stub's framing implied the AC doc would supply this field "verbatim," and it doesn't. This is a real content-authoring task, not a transcription task.

I don't think this rises to an architectural design decision — it doesn't touch code paths, schema, or the migration's structure. But it does need real content before the migration can be written, so I've drafted it below, in the same voice as the four descriptions already in `4_seed_data.sql` (which I'm treating as a style precedent, since they were presumably written against the same original topic list I started this ritual with):

1. **Production Code — Adding Features:** "Rate how straightforward it is to introduce new functionality. A 1 means adding features is painful — the code fights you. A 4 means it is clean and welcoming. Think about the last time you shipped something new." *(carried forward verbatim from the current seed's "Production Code" entry — closest existing match.)*
2. **Production Code — Reasoning:** "A 1 means understanding what a piece of code does, and why, takes real excavation — tribal knowledge, guesswork, or archaeology through git blame. A 4 means the code explains itself and a newcomer could trace the logic unaided."
3. **Production Code — Active Development:** "Rate the code you and the team are actively working in right now — this sprint, this quarter. A 1 means the code you touch day to day is a struggle. A 4 means it's a pleasure to work in."
4. **Production Code — Entire Project:** "Rate the codebase as a whole, including the parts nobody has touched in a year. A 1 means there are corners of this project nobody wants to open. A 4 means the whole thing, not just the parts you're in this week, holds up."
5. **Test Suite — Effectiveness:** "A 1 means the tests pass but bugs still reach production regularly, or the suite is so slow and flaky it is not trusted. A 4 means the team genuinely relies on the suite and it catches issues before they ship." *(carried forward verbatim from the current seed's "Test Suite" entry.)*
6. **Test Suite — Consistency:** "Vote up if the suite behaves the same way every run — same input, same result, no flake. Vote down if tests pass or fail unpredictably and the team has learned to re-run before trusting a red build."
7. **Test Suite — Active Development:** "Rate the tests covering the code you're actively working in. A 1 means you're shipping into areas with thin or absent coverage. A 4 means the code you touch day to day is well protected."
8. **Test Suite — Entire Project:** "Rate test coverage across the whole codebase, not just the parts in active development. A 1 means large areas are effectively untested. A 4 means the whole project has a safety net, not just the parts getting attention lately."
9. **Pipeline:** "A 1 means deployments are stressful, manual, or unpredictable. A 4 means you can ship at any time with full confidence that the pipeline will catch problems and roll back if needed." *(carried forward verbatim from the current seed's "Pipeline" entry.)*
10. **Technology Stack:** "Vote up if the team is fluent with the languages, libraries, frameworks, and infrastructure in use and they are well-suited to the problem. Vote down if the stack is unfamiliar, poorly suited, or actively getting in the way." *(carried forward verbatim from the current seed's "Technology Stack" entry.)*
11. **Pairing:** "A 1 means pairing rarely happens, is unbalanced, or leaves people feeling isolated. A 4 means the team pairs regularly, collaboration is balanced, and pair composition rotates well." *(carried forward verbatim from the current seed's "Pairing" entry.)*
12. **Project Trend:** "Vote up if things are genuinely improving — the code is getting cleaner, the team is more capable, delivery is becoming easier. Vote steady if things are holding. Vote down if the trajectory is negative. This is the single most important question in the session." *(carried forward verbatim from the current seed's "Project Trend" entry.)*

Six of these (1, 5, 9, 10, 11, 12) map 1:1 to an existing description and I've kept those verbatim for continuity. The other six (2, 3, 4, 6, 7, 8) are new drafts, needed because the AC splits "Production Code" and "Test Suite" into facets that didn't exist as separate topics before. These are mine to stand behind — I wrote the originals, I'm the domain authority the persona docs point to for exactly this kind of gap — but they should be called out as drafted-not-transcribed in the proposal, not presented as if they came from the use case doc.

## No architectural decision needed — confirmed

The stub asserts this explicitly; I've verified it holds:

- **No new schema.** The `topics` table already has every column this needs (`name`, `prompt`, `vote_type`, `display_order`, `is_default`, `first_session_description`) — confirmed against `requirements/design/database-schema.md` and the live `2_create_tables.sql`/`4_seed_data.sql`. This is a data-only migration in the same shape as the one it replaces.
- **No new code path.** Nothing reads or writes topics data differently based on there being six rows versus twelve. The row count is not load-bearing anywhere in application logic I can find.
- **No new pattern.** The migration is `INSERT INTO topics (...)` in the same form as the existing one, at the next sequential migration number.
- **The one open question the stub flagged (down-migration semantics)** isn't a decision either: the six-topic seed was wrong, so there's nothing correct to revert to. The straightforward answer is a down-migration that deletes the twelve default-topic rows for the sentinel team (mirroring the existing seed's down-migration pattern of `DELETE FROM topics WHERE team_id = ...`), which is symmetric and doesn't need a design call.

Nothing here required trading off two valid approaches, choosing a technology, or making a call Devon-the-architectural-reviewer would need to weigh in on. This is squarely a light-track, single-pass fix.

## Migration numbering

Main's current migrations run through `10_sessions_team_active_unique.sql`. **`11` is the next free number on main right now.** The stashed `#44` work (uncommitted, on `agent-team/44-inline-team-creation`, currently in the stash) also claims `11` for `11_teams_name_unique_normalized.sql` — but that migration only exists in the stash, not on main, so there's no actual collision today. Since this change is a merge prerequisite for #44 and will land first, it should claim `11_default_topics_correction.sql` (or similar), and whoever resumes #44 will need to renumber their stashed migration to `12` when they unstash and rebase. Worth a one-line note in this change's proposal so that's not a surprise later.

## Open question resolved: no data-correction pass needed

The stub asked whether any already-created team has topics copied from the stale six-topic sentinel rows, requiring a corrective data pass.

**No.** I checked for any code path on `main` that copies `is_default = true` rows from the sentinel team into another team:

- `packages/backend/src/routes/teams.ts` (1,329 lines) has no team-creation endpoint at all — no `POST` handler that creates a team on `main` today.
- The default-topic-copy mechanism (`default-topic-provisioning`) is entirely part of the stashed, unmerged `#44` work — it does not exist on `main`.
- The only places `INSERT INTO topics` appears outside `4_seed_data.sql` are two integration test fixtures (`facilitator-error-state-2-restricted-role.test.ts`, `facilitator-error-states-integration.test.ts`), and both insert a single bespoke test topic directly (`'Integration Test Topic'`) — not a copy from the sentinel default set.

So: no real team, and no test fixture, has ever received a copy of the stale six-topic set. This migration only ever touches the sentinel team's own rows. The stub's suggestion that this is "likely out of scope for a pre-launch application with no real teams yet" is correct, and I can confirm it rather than just guess at it — there is no other team, real or fixture, with copied default topics to correct.

## A tangential discrepancy worth flagging (not blocking)

While tracing this down I found a third document that disagrees with both the AC and the current seed: `requirements/BRD.md` (line 600) describes the seed data as "5 topics: Production Code, Test Suite, Pipeline, Technology Stack, Pairing" — no Project Trend, and no twelve-way split. That's a different number than either the current stale seed (6) or the corrected AC (12). This is old, unmaintained BRD prose, not a competing source of truth — the AC doc and Marcus's direct confirmation govern — but it means the BRD will read as stale once this ships. I'd flag it as a documentation follow-up (not a blocker, not part of this change's scope) rather than pull it into this fix.

## Recommendation

Proceed on the light track as scoped: one migration replacing the six-topic seed with the twelve above (including the drafted `first_session_description` text, called out as drafted), a symmetric down-migration, and a regression test pinning all twelve prompts, vote types, and display orders. No design-decision stage needed. Sequence this ahead of `#44` and reserve migration `11`.
