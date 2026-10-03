# Facilitator review: exploration notes for #188

Reviewer: Priya Nair (Facilitator, SME). Date: 2026-10-02.
Lens: does this capture real facilitator pain and workflow friction, and does the result stay out
of my way during a session?

---

## Observations

1. **The intent is right, and it is the facilitator's concern too.** When I pick up a team I have
   never worked with, the first session runs on the defaults, and I rely on those defaults being the
   same set every other team started with. If the template drifts, I lose cross-team comparability
   and I also lose my mental model of what a first session covers. I have explained these topics to
   new teams dozens of times, and I would be explaining topics that are no longer there. Devon's
   framing ("drift nobody can see") matches what I would actually experience: a new team's first
   session that looks normal but isn't.

2. **The notes treat this as an exploit. Accidental use is more likely, and the notes do not cover
   it.** `GET /api/v1/teams/eligible-for-session` (`packages/backend/src/routes/facilitator-sessions.ts`
   ~l.2455) returns every team where the caller has no membership and `deactivated_at IS NULL`.
   Nobody is a member of the sentinel, and the seed (`migrations/4_seed_data.sql` l.27) does not set
   `deactivated_at`. So, unless I have missed a filter, **`__default_topics__` appears in every
   facilitator's team picker on the Session Creation page** (`frontend/src/pages/SessionCreationPage.tsx`).
   That is the §4.1 path, reached by a mis-click, with no API knowledge required. A facilitator
   running a demo or a "dry run" to learn the tool could select it, step through every topic with
   no participants (the notes say nothing stops this), and complete it. They would have unlocked the
   template without knowing. I think this is the most realistic way #188 actually happens, and it
   should be stated in the problem statement.

3. **The fix closes the write side but leaves that picker confusion in place.** After #188 a
   facilitator who opens Topic Management on the template gets a 404 "Team not found", even though
   they reached it from a list the app gave them. That is a confusing message to read before a
   session starts. I agree the 404 is correct for direct API probing. But the picker should never
   offer the team in the first place, so the 404 is only ever seen by someone typing URLs.

4. **The test strategy is good for the ceremony.** "Send harmless requests and assert the specific
   code" means a regression cannot quietly corrupt the template for other test files. A broken
   template breaks team creation (the 500 scenario in §2), which breaks first sessions, which is
   the worst moment to fail: a new team in the room, with me trying to make a good first
   impression. I would raise the priority of that 500 scenario. It is a first-session outage, not
   just a data-integrity issue.

5. **It stays in the background.** Nothing here adds a step, a prompt, or a confirmation to the
   live session flow. The guard is a constant comparison before the lock gate, so it adds no
   latency to Topic Management for real teams. That is the right footprint.

6. **The FR-8.1 sentence in §4.4 matters to facilitators.** If someone later "fixes" the guard to
   allow admin maintenance through team endpoints, the template becomes editable from a screen that
   looks exactly like an ordinary team's Topic Management. Facilitators would have no visual cue
   that they were editing everyone's baseline. Keep the sentence in the spec.

---

## Questions

1. Is the sentinel actually shown in the Session Creation team picker today? If so, has anyone
   created a draft on it in a shared or dev environment? A quick check of `sessions` for
   `team_id = '...0001'` would tell us whether the template is already unlocked anywhere.
2. If a draft on the sentinel already exists in some environment, does it hold the facilitator's
   single active-session slot or show up in their session list? Could it block them from starting a
   real session?
3. Are any `topics` rows on the sentinel already non-default or archived (an earlier write that got
   through)? If so, we need a cleanup step or migration, not just a guard.
4. Should the audit row (§5, `topic.write_denied_template`) be visible to anyone a facilitator could
   ask? An audit row nobody reads does not help me. If it is only for incident review, that is fine,
   but say so.
5. Does the guard also need to cover reads (§4.5)? From my side the reads cause no harm, but if
   Topic Management can still *display* the template with edit controls that then fail, that is
   worse than refusing to show it. Which do we get after this change?

---

## Suggested additions

1. **Add the accidental-use path to the problem statement**: the sentinel listed in
   `eligible-for-session`, then a no-participant walk-through, then completion. Present it as the
   likely way this happens, ahead of fixture leakage.
2. **Raise the picker exclusion as a follow-up issue in the same batch as §4.1**, or bring it into
   scope. Filtering `DEFAULT_TOPICS_TEAM_ID` out of `eligible-for-session` is one `WHERE` clause and
   removes the confusing 404 in practice. My preference is to bring it into scope, because it closes
   the entry point a facilitator can actually reach. If it stays out of scope, the follow-up should
   be filed now, not "later".
3. **Add a spec scenario for the facilitator-visible outcome**: "Given a facilitator opens Topic
   Management for the template team by URL, they see the standard team-not-found state, not a
   partially rendered editor with failing controls." That makes the frontend behaviour explicit.
4. **Add a data check to tasks**: query existing environments for sentinel sessions, non-default
   sentinel topics, and archived sentinel defaults before declaring the fix done. A guard does not
   repair a template that has already been changed.
5. **List the 500-on-team-creation risk as the headline impact** in the proposal, ahead of
   "inconsistent template". "New teams cannot be created" is the impact facilitators would notice,
   and it lands in a first session.
6. Keep the structural "every topic-write route" test. I would want the same pattern for session
   lifecycle routes when §4.1 is done. Note that in the follow-up issue so the pattern carries over.
