# Executive Review — session-creation-existing-team

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Verdict:** Approve. This is foundational-path work, appropriately scoped, and the bundled fix is the right call — not scope creep.

## Strategic alignment

This is about as close to zero-debate priority as I see in this backlog. Nothing else we've built — trend dashboards, action item tracking, the access model — has any value until a facilitator can actually stand up a session for a team. Right now that entry point doesn't exist. Every one of my success criteria (three teams at six-plus sessions, closed-loop action items, trend history worth looking at) is gated on this shipping. I'd be more worried if this proposal *weren't* near the top of the queue.

It also directly reinforces the property I told this team was non-negotiable: the facilitator-from-another-team boundary. That's not a generic bug fix to me — that's the trust model the whole ritual depends on. If a facilitator could ever plausibly run someone else's team's session, or if engineers came to believe that was possible, the psychological safety the tool is supposed to create is gone. I want that enforced correctly the first time, not "correctly in the UI, best-effort in the API."

## Scope proportionality — good discipline

I'm glad to see explicit exclusions: picker personalization for facilitators rotating across many teams, the not-yet-open join-link message, and a trend dashboard are all named and deferred as follow-ons rather than absorbed into this change. That's exactly the "ship to one team, iterate" behavior I've asked for. The `canFacilitateSessions` flag also reuses the existing `canAssignRoles` capability-flag pattern instead of inventing a second convention — that's the kind of restraint that keeps this codebase from accumulating two ways to do the same thing. Nine task groups is a real chunk of engineering time, but every group maps to something in the "Why" — I don't see filler.

## The bundling question — is fixing the auth gap here justified?

Yes, and I want to explain why rather than just wave it through, since I was specifically asked to look at this.

The test I apply to "should this ride along or be its own PR" is: does shipping the feature *without* the fix create a false sense of security? Here, the answer is clearly yes. A picker that correctly filters out the facilitator's own team is a UI-layer convenience, not an enforcement boundary — the enforcement has to live in the endpoint. If we ship the picker alone, we've built a locked-looking door with no lock: it looks compliant in a demo, and the gap only shows up when someone (or something) calls the API directly, which is precisely the bypass the companion use case describes. Splitting these into two PRs wouldn't reduce risk — it would just mean we ship the illusion first and the substance later, for no adoption benefit in between.

I also checked whether this is closer to "we discovered a live incident that needs an expedited security response" versus "pre-launch hardening on an endpoint nobody's had a working reason to call yet." Everything here reads as the latter: there's no session-creation UI in production today, so this endpoint has no legitimate caller until this change ships. That's the case where bundling is not just acceptable but correct — a standalone fix PR with no UI change in front of it would be process overhead with zero user-facing value, which is exactly the kind of internal-tooling bloat I've asked this team to avoid.

One thing I'd like confirmed before this merges, not as a blocker to the proposal itself: that `POST /draft` genuinely has no existing caller in production today (script, internal tool, anything). If it turns out something *is* already exploiting this silently, that's a different conversation — a security note, not a footnote in a feature PR — and I'd want to know about it directly rather than find out later.

## Minor notes, not blockers

- The use-case document corrections (precondition wording, steps 5–8 addendum) are correctly logged as a BA dependency rather than silently drifting out of sync with what ships. I want that traceability kept — a shipped behavior that quietly disagrees with its own use case doc is how "nobody trusts the docs" starts.
- The "Open the room" design deliberately reverses the use case's literal wording, and the proposal is upfront about that and ties it to ADR-007 rather than burying it. That's the right way to handle a deliberate deviation — flagged, justified, and tracked for sign-off (task 0.2), not discovered in review.

No concerns about my non-negotiables (team-boundary access control, manager read-only, data retention) — this change touches the first and strengthens it; it doesn't touch the other two.
