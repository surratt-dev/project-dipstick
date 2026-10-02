# Proposal Review: Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Change:** `topic-003-admin-authorization` (issue #176)
**Focus:** Strategic alignment, adoption, scope proportionality
**Verdict:** **Approve with two conditions.** Neither condition blocks design or implementation.

---

## Bottom line

This is the kind of change I want: small, closes a HARD requirement gap, and adds no new surface. The topic repair kit is half-built today. An admin can take topics away from a team but can't put one back, and the screen tells them "Topics can't be added from this account yet." That is a dead end in exactly the situation where we need a recovery path: a team whose facilitator left and whose topic list was stripped or inherited without a handoff. My biggest adoption risk is the ritual depending on one champion. Anything that lets the practice survive a champion leaving is worth doing, and this does it cheaply.

## Strategic alignment

| Goal | Does this serve it? |
|---|---|
| Ritual outlives any one person | **Yes.** An admin can restore a usable topic list without first recruiting a cross-team facilitator. |
| Low-friction onboarding and recovery | **Yes.** It removes a "can't do that from this account" dead end and two empty-state variants. Fewer states means less to explain. |
| Data access / anti-surveillance boundary | **Preserved.** Engineering Managers still get `403 NOT_A_FACILITATOR`. This does not give the management line a way to steer what teams discuss. I checked this specifically, and it is the property I care about most. |
| Integrity of the first session | **Preserved.** Admins hit the same customization lock (`409`) as facilitators. The first session still runs the canonical set. |
| Tool stays out of the room | **Preserved.** The #175 snapshot means an admin add can't change a session already in progress, and the design backs this with an integration test rather than prose. Good. |

## Scope proportionality

The scope is proportional. The code change is a role check, a flag flip, two removed empty-state rows and one word of copy. The rest is the debt the previous change already wrote into the living specs: contract prose, use case, validation report and parity test. Doing it in the same change is the point, since it keeps the endpoint and the UI flag from drifting apart again. I see no scope creep.

The team also held the line on adjacent work. Member-admin barring (F1), "added by" display (F2), the next-room notice (F3), #184, #198/#199 and #200 are all deferred. TOPIC-007 stays untouched. That is the discipline I asked for.

One note on process weight. This runs the full pipeline for what is, in code, a narrow authorization widening. I accept that because it touches authorization, and I'd rather over-review access control than under-review it. But the review stages should not become a reason to absorb any of F1 to F4 here. If a later reviewer pushes one of them in, treat that as scope creep and send it to its issue.

## Conditions

1. **F1 and F2 must be real GitHub issues with numbers before this merges, not just bullets in a proposal.** Both are trust issues, and trust is the thing that kills this ritual if we get it wrong.
   - **F2 (who added this topic?)** matters most to me. An admin can now author a prompt that participants answer in the room. If a facilitator walks in and can't say where a topic came from, engineers may read it as someone above them deciding what they talk about. The audit row records the actor, so nothing is lost. But the audit log is not something a facilitator sees. I'm fine deferring F2. I'm not fine with it evaporating. Put it on the milestone after this one, not in the general backlog.
   - **F1 (member-admin)** is the same social pressure the member-facilitator bar exists to prevent. Admitting member-admins for consistency with TOPIC-004/005/006 is the right call for #176. The question needs an owner and a decision date.
   - Add the issue numbers to the proposal's Follow-ups section or to `tasks.md`.

2. **Keep the admin population small and say so.** The low-risk argument rests on `application_admin` being a tiny, trusted group. That is true today. If we ever widen who holds that role (for example, handing it to EMs for convenience during rollout), this change becomes a way for management to inject topics into a team's ritual. One sentence in the design's risks section noting this assumption is enough. I'll own the policy side.

## What I'm not concerned about

- Rollout risk. Access only widens, there is no migration and no new reason codes, and the only client is our own screen.
- The FR-8.2 / FR-8.7 tension (D6). Admins can add topics but can't write a team's definition. That split is correct, and recording it so nobody "fixes" it later is the right move.

## Adoption impact

This is a modest, positive change. It won't move my success criteria on its own. It does remove a failure mode that would otherwise hit right after a team loses its champion, which is the moment adoption is most fragile. Ship it, file the follow-ups, and move on to the work that gets more teams to their sixth session.
