# Proposal Review: Reorder Topics (#52) — Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Artifact:** `openspec/changes/reorder-topics/proposal.md`
**Verdict:** **Approve with conditions.** The strategy is right and the guardrails are right. The UX section needs trimming before it goes to design and tasks.

---

## 1. Strategic alignment: does this help adoption?

Yes, in a small way, and I'm fine with that. Reorder isn't a feature that gets a team to its first session. It helps with the second through sixth sessions, which are the ones my success criterion #1 depends on ("three or more teams, six sessions each"). A facilitator who can't put the heavy topics first when they keep getting skipped at the end of the hour will start to see the ritual as rigid. Rigid rituals get abandoned. Closing out the "add, remove, and adapt within guardrails" set is a reasonable use of a small change.

What I value most in this proposal is the three guardrails it keeps in place, and I endorse all three without reservation:

- **The first-session lock covers reorder, and denials are audited.** Good. Canonical first session means consistent baselines across teams, and that consistency is what I need to compare trends.
- **Session snapshots and history are never rewritten.** This is non-negotiable for me. Trend data is only worth anything if it's longitudinal. A change that could quietly re-sequence a past or in-flight session would undermine the whole dashboard.
- **No automatic ordering by score.** Strongly agree. Ordering by "lowest score first" makes the tool read as a management optimizer, and that is the surveillance perception I'm most worried about. Please keep this in design.md as a recorded decision so nobody brings it back later as a "smart default."

## 2. The bundled `display_order` collision migration: **in scope, and correctly placed first**

My default reaction to "we're also fixing an unrelated bug in this PR" is suspicion. In this case the bundling is justified:

- I checked it. `2_create_tables.sql:58` has `CONSTRAINT topics_team_order UNIQUE (team_id, display_order, status)`, and the archive → add → archive reproduction in exploration §3b is plausible against the shipped code. Right now a facilitator can get a 500 from nothing more than normal use of features we've already shipped. That's an adoption risk in itself: a champion who hits a server error while tidying the topic list loses confidence in the tool.
- Reorder turns a rare bug into a common one. Shipping reorder without the fix would be negligent. Shipping the fix without reorder would be fine, but it's the same one-line intent and the same review, so doing both together costs less.
- The fix is the smallest correct one: it relaxes a constraint and needs no data backfill. It also records the actual intent, which is that position only matters among active topics.

**Condition:** make the migration an independently revertible first commit or task group, as the proposal already says, and put the §3b reproduction in as a regression test. If reorder gets held up in review, I want the fix able to ship on its own. Note this in tasks.md.

## 3. Endpoint scope: proportional

The endpoint reuses the TOPIC-003/004/005 conventions verbatim, so there's almost no new policy surface, and that's what I want to see. A few comments:

- **Admin admitted from day one (FR-8.2).** Fine, it's consistent with 004/005. The proposal notes that TOPIC-003 is still the outlier (#176) and leaves it alone. That's correct scoping. Don't fix it here.
- **One `409 TOPIC_ORDER_STALE` code that doesn't reveal whether an ID exists.** Good. Cheap, and it fits the team-boundary data-access posture I care about.
- **`openSessionCreatedAt` in the response.** Acceptable because it's one nullable field that heads off a real point of facilitator confusion ("why didn't my new order show up?"). It must stay a single field. If it grows into a session-lookup payload, that's creep.
- **Length cap of 200, two-phase renumber, no-op returns no audit row, last-writer-wins.** These are all proportional, and in several cases they're explicit decisions not to build something (for example, no optimistic concurrency tokens). I appreciate that restraint.

## 4. UX polish: **over-scoped for a reorder control. Trim it.**

This is where I push back. The UI bullet has grown into a small feature. Here's the list:

| Item | My call |
|---|---|
| Move up / Move down buttons, position numbers | **Keep.** This is the core value. |
| Pinned "applies to sessions created after you save" copy | **Keep.** It's one sentence and it prevents a support question. |
| Local draft with Save / Discard bar | **Keep**, but make it simple. |
| Focus retention and `aria-live` announcements | **Keep.** Accessibility isn't optional polish, and buttons-only is the right call. |
| Hidden when locked or when fewer than 2 topics | **Keep.** This is trivial. |
| Distinct handling for stale, locked, and transient errors | **Keep, minimally.** Stale should reload the list and say so. Locked and transient can use the screen's existing error pattern. Don't design three bespoke experiences. |
| Move to top / Move to bottom | **Defer.** It's nice to have. With about 11 topics, up and down is enough. |
| Disabling Remove/Restore while the draft is dirty, with a stated reason | **Question it.** A simpler rule is that Remove and Restore discard the draft after a confirm, or that they just work and the stale check catches the conflict. Pick whichever is cheaper to build and test. |
| Navigate-away prompt, in-app **and** `beforeunload` | **Defer or reduce.** Losing an unsaved reorder of about 11 items costs the user a few seconds. A route guard plus `beforeunload` adds more test surface than the risk justifies. If the team feels strongly, do `beforeunload` only. |

My concern here is the one I raised at kickoff: internal tools grow in scope. Every item above is defensible by itself, and together they probably double the frontend work and the number of spec scenarios for a feature that facilitators will use a few times a quarter. **Condition:** the design stage should cut this to the "Keep" rows and move the rest into the Follow-ups list next to drag-and-drop.

## 5. Requirements-doc edits: **in scope, but keep them surgical**

It's appropriate to update the TOPIC-006 contract, the use case, the FR-2.7 restatement, and the Validation Report row in the same PR. Specs that drift from code are how the next team ends up building the wrong thing. The FR-2.7 restatement matters most because it closes off a per-session reorder path that would conflict with the first-session lock. I agree with **restating it rather than retiring it**.

**Condition:** the doc edits should only correct what this change makes true. Don't rewrite or reformat the surrounding sections, and don't let the BRD edit pick up new preferences. One diff hunk per document where possible, so the reviewer can check them quickly.

## 6. Known limitations: honest, and acceptable

The inability to prove "the new order is used in subsequent sessions" end to end (#175) is an inherited gap, and the proposal says so plainly instead of stretching to close it. That's the right choice. I'd rather have #175 prioritized on its own than have it slip into this change. **Recommendation:** raise #175's priority. It now blocks the end-to-end value of two shipped features (restore and reorder), and eventually of the trend dashboard I care most about.

## 7. Conditions for approval (summary)

1. The collision migration goes in as a first task group that can be reverted and shipped on its own, with the §3b repro as a regression test.
2. Trim the frontend scope to the "Keep" rows in §4. Move to top/bottom and the dual navigate-away guard go to follow-ups. Simplify the dirty-draft Remove/Restore interaction.
3. Requirements-doc edits limited to corrections this change makes true, with no drive-by rewrites.
4. "No automatic ordering by score" recorded as a design decision.
5. `openSessionCreatedAt` stays a single nullable field.

With those, this is a proportionate, well-guarded change, and it closes a real production bug along the way. Proceed.
