# Facilitator Review: auth-events-audit-log-coverage (Explore Stage)

**Reviewer:** Priya Nair (Facilitator SME)
**Reviewing:** exploration-notes.md (Devon Calloway)

## Framing

I'm reviewing this the way I review anything that touches the application: does it protect the four things I actually care about (reveal simultaneity, readiness-without-spoilers, advisory-not-prescriptive outlier flagging, facilitator-controlled pacing), and does it keep the tool invisible during a live session rather than adding to what I have to manage? Devon's notes already ran that exact check against my three core ritual constraints (no-manager-participation, facilitator-from-another-team, simultaneous reveal) in the "Where this touches the ritual" section, and I want to say up front: that's the right move, and the answer is honestly "mostly doesn't touch it." I'm not going to manufacture session-mechanics concerns where none exist. What follows is where I think the "mostly" needs a closer look, plus one process observation.

## Observations

1. **This correctly stays out of my lane, and says so.** None of the nine-to-eleven events sit between a live session and a vote, reveal, or topic advance. No new read surface, no admin dashboard, nothing that could become a spoiler channel or a surveillance-feeling display. If this ships exactly as scoped, it disappears into the background the way a good audit trail should — I'd notice it only if I ever needed to ask "did something go wrong," never during a session. That's the right shape for infrastructure like this.

2. **`auth.role_claim_mapped` and `join.link_redeemed` are the two events that actually connect to something I'd care about, and the notes correctly identify why.** My Success Criterion 4 is "no manager has participated, and no exception has been made" — provable, not just asserted. A durable record of role transitions is the only way anyone answers that two years from now. I want to underline this rather than let it sit as a minor bullet: if this issue gets deferred or trimmed, `role_claim_mapped` should be the last event cut, not an easy one to wave off as "just infra."

3. **The notes are honest that nobody read the audit trail back out to any product surface — good, but that leaves a gap in who's speaking for the *other* end user here.** I was interviewed extensively for the facilitator/participant experience, and I've been offered a usability pass before ship. Who is the equivalent voice for the person who will actually query `audit_log` during an incident — presumably a security or ops engineer? Nobody in this document is playing that role. A field like `userId` being present in one `join.link_rejected` emission and absent in a structurally-identical sibling (the "small field inconsistency" callout) is exactly the kind of thing that looks like a footnote in exploration and becomes a 2am problem for whoever's reconstructing an incident without it. I'd want someone who actually does incident response to have a say before Design finalizes field shape, the same way I get a say before the reveal mechanic ships.

## Usability Concerns Not Yet Named

4. **Login-path latency is the one place this *could* leak into a session-adjacent experience, and it isn't discussed.** The notes flag `auth.authorization_initiated` and `auth.callback_received` as reachable by unauthenticated traffic and worth a write-amplification cost estimate — but they frame that purely as a security/DoS cost. There's a second angle: if a synchronous DB write gets added to the login path and it adds perceptible latency, that lands squarely on "first-session support." A new team's first session is already the highest-friction one I run — people are learning vote types, getting comfortable with the format, and now also logging in through OIDC for the first time. Any added lag at that exact step compounds onboarding friction I'm already managing by design, not by workaround. I'd want Design to confirm a latency budget for any auth-path write, explicitly framed as "does this touch first-login experience," not just "does this create a DoS cost."

5. **Don't let `audit_log` and the session-history/trend-dashboard data get conceptually merged.** They're unrelated data stores serving unrelated purposes, and the notes keep them properly separate — but I want that written down as a boundary, not just true by omission. My continuity concern (Success Criterion 3, handing a team off to another facilitator) is served by session history and trend data, never by this audit trail. If a future change ever proposes surfacing audit events anywhere facilitator-adjacent "since we're already tracking it," that's a different review with different stakes, and this issue's own note ("no new read endpoint, full stop") should be the thing that gets pointed back to.

## Questions for Design

1. If `role_claim_mapped`'s whole value is "prove the no-manager rule held," is a raw DB query genuinely how anyone will ever check that, or does this eventually need a queryable surface for someone auditing role history? Not asking this issue to build one — asking whether Design should say out loud that this is a deliberately deferred need, the same discipline Devon is asking for on the event list itself.
2. Same question as observation 3, stated as a question: who signs off on field shape (the `userId` inconsistency, the `sourceIp` gaps) from the perspective of someone who'll actually query this under incident pressure? If the answer is "nobody specifically," I'd flag that as a gap the same way I'd flag a facilitator view getting built without a facilitator's sign-off.
3. Is there a latency number for any write added to `/auth/login` or `/auth/callback` before it's authenticated? If Design's answer is "negligible, single-digit ms," that's fine and this can be closed as a non-issue — but I'd want it closed with a number, not assumed.

## Suggested Additions

- Add a line to design.md (or wherever Design records this) explicitly stating that `audit_log` will not surface in any facilitator- or participant-facing view, now or as a stated non-goal — cheap to write now, expensive to have to re-litigate later if someone proposes it in passing.
- If login-path latency is measured and found negligible, record the number. If it's not negligible, treat it as a first-session-onboarding cost, not only a security cost, when Design weighs the fail-open/timeout mechanism for `authorization_initiated`/`callback_received`.
- Name, even briefly, who owns "usability" for the audit trail's actual consumer (incident responder / security engineer) so field-shape decisions like the `userId`/`sourceIp` inconsistencies get a real reviewer, not just a "worth a look" note that nobody circles back to.

## Bottom Line

This exploration does what I'd want it to do with something outside my core domain: it checks against my actual constraints instead of assuming a security change is automatically fine, finds two real connections (`role_claim_mapped`, `join.link_redeemed`) instead of zero or a padded generic list, and is explicit that nothing here creates a new surveillance or spoiler surface. My pushback is narrow: the "invisible infrastructure" framing is correct for participants and facilitators, but it shouldn't be a license to skip a usability pass for the people who *do* have to use this trail directly. Give that role the same seriousness you'd give my usability pass on the facilitator view, and confirm the login-path latency question with a number, and I have no objection to this moving to Design.
