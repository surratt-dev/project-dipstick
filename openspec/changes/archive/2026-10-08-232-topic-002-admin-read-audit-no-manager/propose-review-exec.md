# Proposal Review: Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Change:** 232-topic-002-admin-read-audit-no-manager (#232)
**Reviewed:** proposal.md (with a skim of design.md, tasks.md and the issue)
**Focus:** Strategic alignment, scope proportional to value, scope creep

## Verdict: Approve, with three non-blocking notes

This is the kind of change I want us to make without hesitating. It closes a live hole in the one boundary I have called non-negotiable: managers do not see what the team writes about itself. It does that with a small footprint: one handler, one frontend message, no migration, and no change to the shared helper. Ship it.

## Strategic alignment

**It serves my deepest concern directly.** My success criterion 4 is "no engineer has raised a concern that the data is being used in a way that feels evaluative." The proposal opens by calling this a candour problem first and an access-control gap second, and that is the right framing. "Our team's definition" is only worth anything if engineers write it for each other. If one engineer finds out that their manager, who also happens to be an admin, can read it, the story spreads across teams faster than any release note. A single incident like that costs us more adoption than any feature on the roadmap gains us.

**Denying the whole response is the right call, and I support it on policy grounds.** I agree that stripping only the annotation fields is not an equivalent fix. A manager who sees the topic list, the prompts and the archive history is still looking at how the team frames its own health. A null annotation that reads as "the team wrote nothing" is worse than a clear "not available to the team's manager." Allow-list beats deny-list here, and I don't want a future free-text field to leak by default.

**Deciding this separately from #208 is the right call.** The no-manager rule is hard. The member-admin write question in #208 needs judgement. Holding a hard-rule fix hostage to a judgement call would leave the gap open for no benefit. The mechanism (a TOPIC-002-local check, with the shared helper and write wrappers left byte-for-byte unchanged) keeps #208's options open, and a reviewer can check that cheaply.

**The audit visibility guard matters and should stay in.** Auditing admin reads is about watching the watchers, which fits the trust story. Turning that log into a "who read your team's config" view for managers would flip it into surveillance pointing the other way. It is good that this is written down as a constraint and not left to chance. The counts-only metadata rule (no topic names, no text) is also right.

**The release-note gate is right.** I don't want us telling engineers something that isn't true yet. Holding #187's line until this merges, and explicitly not claiming that managers can't change topics, protects the credibility we will need when we roll out to the next teams.

## Scope versus value

The scope is proportional. The code surface is small, and every task maps to one of the two gaps, the regression pins, or the docs the issue asked for. I see no feature creep.

Items I checked for creep and accept:

- **Auditing the denial (`admin.topic_config_denied`).** It is small, and it is the only signal we would get that a dual-hat admin is trying to reach their own team's data. Keep it.
- **Correcting the "same transaction" wording for admin-read audits.** This is a policy-level spec change, but it codifies what `teams.ts` already does and touches no other code. It is acceptable because it removes a requirement we were silently not meeting.
- **`actor_idp_roles_include_em` in the audit metadata.** It is speculative, but it is a single boolean and cheap to remove later. I accept Security's reasoning that leaving dual-hat managers invisible costs more.
- **Explaining the 403 on the screen.** This one is not creep. A bare "no access" message reads like a bug and generates support pings. One sentence of explanation is cheap goodwill.

## Notes (non-blocking)

1. **#208 is now the bigger risk, and I want it prioritised, not just commented on.** The proposal says it plainly: a manager who can add, archive and reorder their own team's topics through the API is closer to the core harm than one who can read the definitions. After this ships we are at `GET 403 / POST 201` for the same person. I accept that split as a temporary state. I do not accept it as a resting state. Follow-up 1 should go on #208 and ask for it to be scheduled in the current milestone, and the decision should be brought to me if it touches who can shape a team's topics.

2. **Keep the paperwork proportional to the fix.** This change carries about 1,100 lines of exploration, review, design, spec and task text for what is, in code, one authorization branch and two audit writes. For a no-manager-rule fix I'll accept that, because getting it wrong is expensive. But I don't want this depth to become the default for every small bug. My standing concern is that over-engineering delays value, and the first teams need sessions, not specs.

3. **Fail-closed on audit write is fine here. Don't copy it everywhere without thinking.** Returning `500` when the audit row can't be written is the right trade for an admin-only configuration screen with low traffic. That pattern should not spread to facilitator or live-session paths, where availability during a session matters more to adoption. The proposal already confirms facilitator flows don't touch the new code, which is what I need.

## Adoption check

This doesn't move adoption forward directly. No new team runs a session because of it. It protects adoption, and that matters more at this stage. We have only one chance at a first impression with each team's engineers about whether this is their data. I'd rather spend a week here than spend a quarter rebuilding trust.

Approve. Merge it, then post the #208 comment and get #208 scheduled.

— Rachel Okonkwo
