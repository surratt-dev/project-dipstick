# Proposal Review: Executive Stakeholder (Rachel Okonkwo)

Change: topic002-unknown-team-404 (#265). Focus: strategic alignment and proportionality.

## Verdict

Approve with conditions. The core change is right and small. The surrounding scope is not proportional to a low-severity bug, and I want it trimmed before it ships.

## What I support

- **The audit log stays honest.** The admin audit stream is how we show that administrator reads of team topic configuration are watched. It serves my data-access and no-surveillance concerns directly. A row recording access to nothing weakens that signal. Fixing it is cheap and defensible.
- **No new data is collected.** The proposal records no requested ids and adds no query. That fits "this is the team's data, not management's reporting tool."
- **Unaudited 404 (open decision 1).** I confirm it. An authorized caller looping random UUIDs should not be able to flood `audit_log`, and the write routes already behave this way. No VP-level objection. Consider this decision closed unless Brian has a counter-argument.
- **Participants still get an identical 403.** Authorization before lookup preserves team-boundary enforcement, which is the property I care about most.
- **"Team not found." copy.** Plain wording helps a new team's first session. It also helps the onboarding path I am counting on.

## Concerns

1. **Scope is out of proportion to the severity.** The issue is a one-endpoint status-code fix plus a screen message. The proposal lists six self-declared additions, a three-spec delta, a contract-doc change, and a pinned audit key-set test change. The "scope additions" section is honest, but the cost is still there. Before I would call this proportionate:
   - **Keep:** the 404 itself, the reorder, the screen message, the `team_found` removal, and the contract-row fix.
   - **Keep, because they protect the guardrails:** the participant byte-identical assertion, and the deactivated-team and zero-topics 200 drift guards. These are cheap tests and they protect the access model.
   - **Question or cut:**
     - Quiet-refetch behaviour (addition 1). It is new UI behaviour that the issue does not ask for. If it is a few lines, keep it. If it needs its own design discussion, defer it.
     - The tighter `code: TEAM_NOT_FOUND` frontend rule (addition 6). I agree it is correct. It should be a one-line condition, not a feature.
     - The TOPIC-001 vs TOPIC-002 explanatory sentence (addition 5). Keep it only if it is a single sentence, as stated.
2. **Process weight for a low-severity bug.** The change carries an exploration doc, two persona reviews, a proposal, a design doc, and a tasks list. That is a lot of ceremony for a single-status-code fix. For the next change of this size I would expect the lightweight pipeline. I am not asking to redo this one.
3. **Adoption relevance is indirect.** This does not move my success criteria (three teams with six sessions, a closed loop, a trend insight). It protects trust in the audit trail, which supports criterion 4. It does not unblock any team. It should therefore not displace work that gets the first team running. I accept it as hygiene, not as a priority.
4. **The deferred items are right to defer, but they must stay deferred.** The non-goals cover the deactivated-team indication, clearing stale team ids, the template team 404, and session routes. They are a growing queue of "follow-ups." Do not let #265 absorb any of them. The stale-link question to Brian (open decision 4) is useful, but only if it leads to an issue and not to scope growth here.
5. **Open decision 3 (usability pass by Priya before ship).** This is acceptable if it is a quick review of the copy and layout. It must not become a gate that delays a low-severity fix.

## Conditions for my approval

- Cap the work at the "Keep" list above. If the quiet-refetch or any other addition grows beyond a trivial change during implementation, drop it and file a follow-up.
- No additional audit-policy changes under this issue. The 404 stays unaudited.
- Merge once the existing open decisions are confirmed by Brian. No further executive review is needed unless the 404 starts to be audited or the participant 403 changes.

## Questions I would like answered (non-blocking)

- Is there evidence of real users hitting stale team links today? If not, the screen change is lower value than the audit fix and should be sized accordingly.
