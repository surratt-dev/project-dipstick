# Champion Review: TEAM-006 Threat Model

**Reviewer:** Devon Calloway, Internal Champion
**Lens:** Ritual intent and participant trust — not implementability. Marcus's lane is whether this is buildable; mine is whether the thing being built still protects what participants were promised.

---

## 1. Finding 1.3 — real, but precisely scoped. Don't let it become "the ritual is broken."

Tomás's attack path 1.3 (`threat-model.md:32-63`) is correctly rated HIGH, and I want to be exact about what it does and doesn't put at risk, because it would be easy to read "an EM can get EM-level access without Application Admin sign-off" and panic about the wrong thing.

**What it does not touch:** Decision 5's attribution boundary. Section 4 of the threat model (`threat-model.md:145-150`) confirms `em-views.ts` never selects `voter_id` regardless of which door — TEAM-006 or the TEAM-005 bypass — produced the `role: 'engineering_manager'` grant. A participant's vote is exactly as unattributable to any EM under finding 1.3 as it would be under the clean path. The no-manager-participation rule and the simultaneous-reveal mechanic aren't in this attack tree at all — nobody gets into a live session through this gap. I checked, because this is the line I care about most, and it holds.

**What it does touch, and why that still matters to me:** Decision 1 exists because I don't want EM access to be something that happens by default or by accident — I want it to require someone with institutional accountability to make a deliberate choice, on the record. Finding 1.3 means that promise is currently false: any EM in good standing on Team A can hand full historical/aggregate/action-item visibility to a colluding Team-A participant, with zero admin involvement and an audit trail that says `team.role_changed` instead of `team.manager_established`. That's not "just" an audit-trail cosmetic issue — the audit trail *is* the accountability mechanism Decision 9 was built to provide. A grant with no correctly-labeled record is a grant nobody can find when they go looking for it.

So: this is real, it's not the ritual's core promise (vote secrecy, no live access) being broken, and it is a governance gap that deserves the HIGH rating and the deployment block Tomás recommends. Precise language matters here — I'd tell a participant "your vote is still safe" without hesitation. I would not tell them "only Application Admins can ever grant your manager historical access" until 1.3 is closed, because right now that's not true.

## 2. Decision 13 section (`threat-model.md:154-176`) — framing honored correctly.

I was explicit that this needed to read as an accepted, named inference path, not a reopened question. Tomás's writeup does this correctly:

- Leads with an unambiguous framing statement before any mechanics (`threat-model.md:156`): "not a bug... not recommending it be closed."
- Correctly separates the *permitted* facts (aggregate score, action item existence, assignee name — each independently decided in Decision 5 and Decision 13) from the *inference* a human draws by combining them. That's the right way to describe it: no system component discloses a vote value at any point.
- The comparison to "a facilitator or any team member... simply being present in the room" (`threat-model.md:170`) is exactly the calibration I'd want. This isn't a new risk the software introduced — it's the same social reality the spreadsheet-and-facilitator version of the ritual always had. That framing should reassure me, not alarm me, and it does.
- Explicitly declines to assign it a residual-risk-requiring-action rating (`threat-model.md:176`) and keeps it out of the "gap" rows in the findings table.

One small wrinkle, not a violation: he does attach a severity label ("Low-to-Moderate, team-size-dependent") even while saying he won't score it as a gap. That's a little bit of belt-and-suspenders language from a security analyst's habits, and I understand the instinct — but a rating attached to something declared "not a gap" invites a future reader to squint at it. I wouldn't ask for a rewrite over this. I'd just note it so nobody two years from now sees "Moderate" in a table and decides that means "open."

The closing line about pointing to "this document and Decision 13 as evidence the tradeoff was deliberate" reads a little CYA, but this is an internal security artifact, not something a participant will ever read — that's the right audience calibration, not a problem.

## 3. Would this surprise a participant? No — and that's the right outcome.

Nothing in this document tells a participant something they weren't already promised or that contradicts the one-sentence statement in Decision 8. The full-history exposure (Section 4, Decision 6) and the assignee-name visibility (Decision 13) were both resolved before this threat model existed — Tomás is quantifying an already-accepted scope, not expanding it. He's also not softening it: "~75 sessions' worth of aggregate health data and every action item the team has ever logged, in one API call sequence" (`threat-model.md:143`) is a plainly stated number, not minimized. If I ever have to explain to a participant what their EM can see, this document gives me an accurate, undersold-nothing basis for that conversation. I don't see language anywhere that oversells danger to score points either — the tone throughout is "here's what's true," which is what I want from this kind of document.

## 4. Pushback: the recommended fix for 1.3 doesn't fully close what Decision 1 requires.

This is my one substantive objection, and it's exactly the kind of thing I was asked to watch for — a fix that looks complete but leaves the constraint half-restored.

Tomás's recommended mitigation (`threat-model.md:63`) is two-part: (a) `evaluateTeamAccess` requires *both* `membership_role` and `global_role` to equal `engineering_manager`, and (b) TEAM-005 refuses to set `membership_role = 'engineering_manager'` unless the target's `global_role` is *already* `'engineering_manager'`.

Walk through what (b) still permits: `global_role` is a **global** flag, not team-scoped (Decision 2 sets it once per user via the IdP claim, not per team). So it is entirely possible for a real, legitimately-established EM of Team B — who also happens to be an ordinary participant on Team A — to already carry `global_role = 'engineering_manager'`. Under the proposed fix, any existing Team-A EM could still call TEAM-005 on that person and flip their Team-A `membership_role` to `'engineering_manager'`. Both of the fixed checks now pass. That person gets full EM read access to Team A's history — and **TEAM-006 was still never called for Team A.** No Application Admin decision, no `team.manager_established` audit record, for that team. The fix as written closes the "recruit an ordinary engineer into EM-for-this-team" case but not the "recruit an EM-somewhere-else into EM-for-this-team" case — and the second case is arguably worse, because the person doing it doesn't even need to compromise or collude with anyone outside people who already have exactly the permissions the fix checks for.

If this gets "fixed" by shipping only the two checks as literally described, Decision 1's actual guarantee — that establishing *this team's* EM relationship is always a deliberate, Application-Admin, audited act — is still not true. The only fix that actually restores Decision 1 is narrower than what's written: **TEAM-005 must never be able to originate a `membership_role = 'engineering_manager'` row for any team, full stop.** That capability belongs to TEAM-006 alone, regardless of what the target's `global_role` already is elsewhere. TEAM-005 should be limited to transitions that don't create a new EM relationship for a team — demoting an existing team EM back to participant is fine; creating one is not, ever, by any actor other than TEAM-006.

I'd want whoever verifies the 1.3 fix (Tomás flags a follow-up pass before sign-off, `threat-model.md:209`) to check specifically for this cross-team-EM variant, not just re-test the single-team-collusion scenario described in the document as written. I'm flagging this now so it doesn't get missed at verification time.

---

## Verdict

**Comfortable that this document satisfies task 1.6.** It's thorough, it's honest about severity in both directions (doesn't inflate 1.3 into a ritual-integrity breach, doesn't downplay it into a nice-to-have), it correctly holds the line on Decision 13's framing without relitigating it, and it gives me language I can actually use with a participant without either alarming them falsely or hiding something they'd want to know. Decision 5's boundary is intact and independently verified — that's the one thing that would have made me stop this rollout outright, and it isn't in question here.

I'm not comfortable calling Phase 2 production-ready — but that's Tomás's own recommendation too, and my one addition is that the fix for 1.3 needs to close the cross-team-EM variant above, not just the version written in the document. Once that's confirmed at the follow-up verification pass, I have no further objection from the ritual-integrity side.
