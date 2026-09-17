## Context

Two escalation messages on the member management view ("Contact your admin," `MemberManagement.tsx:239-241` for TEAM-005 role-assignment and `:445-447` for TEAM-006 EM-association) currently satisfy the BRD's minimum-acceptable text but not FR-1.6a's actual requirement: a specific, resolvable contact path. This was a named, tracked gap at the time TEAM-005/006 shipped — Rachel Okonkwo's (VP Engineering) sign-off on TEAM-006 being admin-only was explicitly conditioned on this escalation path being built, not deferred — and both specs already document the gap in a "Preferred (not yet implemented)" / commented-risk form.

Exploration (`exploration-notes.md`) established the following as resolved fact, not open question, and this design treats them as fixed inputs:

- **No session-start blocking.** Neither escalation site gates session creation today (`sessions.ts` never queries role-assignment or manager-association state in the session-creation path). This change is a "resolve before your next session" affordance, not a gate, and must not become one — a blocking modal would also violate the passive-text constraint below.
- **Zero-Application-Admin is a live, reachable state**, not a hypothetical bootstrap edge case. `global_role` is an IdP-asserted claim, re-written unconditionally on every login (`account-resolver.ts:118-130`); there is no in-app promote/demote UI and no DB invariant guaranteeing at least one admin exists. A misconfigured IdP claim mapping can zero it out at any time.
- **The seed sentinel `System` account** (`00000000-0000-0000-0000-000000000001`, `global_role = 'application_admin'`) exists solely to own the default-topics sentinel team and must be excluded from any query that lists Application Admins for this feature, or a zero-admin state will silently render a non-human `system@dipstick.internal` mailto link — the same class of failure as the task-3.10 placeholder-text near-miss, just produced by a query bug instead of a literal bracket.
- **`mailto:` satisfies FR-1.6a's "email address."** It's the more actionable rendering of the same mechanism, not a weaker substitute requiring "equivalent mechanism" justification.
- **The two escalation sites are asymmetric**, not copies of each other: TEAM-005's authorized-actor set is Application Admin *or* an active EM for that team; TEAM-006's is Application Admin only. This shapes the decisions below.
- **A team can have more than one associated EM.** `team_memberships_active_unique` (migration 7) is a partial unique constraint on `(user_id, team_id) WHERE removed_at IS NULL` — unique per *user*-team pair, not per team. Nothing prevents two different users from each holding an active `engineering_manager` membership for the same team. `MemberManagement.tsx` already renders this as a list (`engineeringManagers.map(...)`, `:452` on) and `TeamMembersResponse.engineeringManagers` (`packages/shared/src/types/team.ts:73`) is typed `TeamMember[]`, plural. The TEAM-005 EM-fallback branch below must resolve for zero, one, or many EMs, not assume exactly one.

## Goals / Non-Goals

**Goals:**
- Every "you can't do this" escalation message on this view resolves to an actual, actionable contact — a name and `mailto:` link, or (TEAM-005 with an EM present) the EM's existing on-page identity — never a dead end.
- The zero-Application-Admin state renders a named, honest fallback instead of silently reintroducing the unhelpful pattern this change exists to eliminate.
- The rewritten task-4.3 test suite can only pass against a component that actually surfaces a mechanism — not against the old wording with cosmetic additions.

**Non-Goals:**
- No new interactive UI (request forms, "message an admin" flows, modals, notifications). This stays passive text, matching the existing `access-model-statement` pattern.
- No facilitator-continuity tracking (whether the next facilitator can see that escalation was already requested by someone else). Real gap, real complexity (its own data model and UI surface) — recommended as a separate follow-on issue.
- No general-purpose admin directory or admin-management UI. This surfaces just enough identity data to make the two escalation messages actionable.
- Does not reopen the TEAM-006 admin-only decision (Q2) — the TEAM-006 contact path resolves to Application Admin only, never to an EM, even though an EM may exist for that team in a display-only capacity elsewhere on the page.

## Decisions

### Decision 1: Application Admin identity becomes visible to non-admin callers, for escalation purposes only

The backend currently has no code path that exposes `users.global_role = 'application_admin'` identity to a non-admin caller. This change adds one, scoped narrowly: whatever endpoint(s) back the member management and team administration views begin including Application Admin name + email in the response payload for the escalation cases that need it, excluding the seed `System` account (`id = 00000000-0000-0000-0000-000000000001`) by id at the query level, not by a display-layer filter — a display-layer filter is bypassable by any future consumer of the same query.

**Alternative considered — configured org-wide contact alias (Option B in exploration):** a single stable address (e.g., `dipstick-admin@company.com`) sidesteps the "how many admins do we show" question entirely, but introduces a new deployment-time configuration surface that repeats the exact failure mode from the task-3.10 near-miss if ever left unset, and only becomes clearly preferable if the real admin count turns out to be large enough that a comma-separated line is unreadable (open question, see below). Not adopted now; the door is left open in Decision 3 if the headcount answer comes back large.

**Alternative considered — in-app request/message flow (Option D):** rejected. This is a new messaging/notification system, not a contact-mechanism fix, and is a much bigger UI surface than the "disappears into the background" constraint tolerates.

### Decision 2: The two escalation sites get different contact-resolution logic, not one shared component

- **TEAM-006 (EM-association escalation):** always resolves to Application Admin contact. There is no EM fallback here by design — Application Admin is TEAM-006's only authorized actor (Q2, resolved), and pointing this contact at an EM would quietly reopen that decision.
- **TEAM-005 (role-assignment escalation):**
  - When the team has exactly one associated EM, the escalation resolves to that EM's identity — already fetched and rendered a few lines down on the same page (`em.email`, `MemberManagement.tsx:469`). No new backend call; this is read-reuse of data already on the page.
  - When the team has **more than one** associated EM, the escalation lists all of them, comma-separated, in the same single-inline-line format as the Application Admin fallback (Decision 3) — this is a direct extension of that pattern, not a new rendering mode. This branch exists because the data model permits multiple active EMs per team (`team_memberships_active_unique` is per user-team pair, not per team; see Context) and `MemberManagement.tsx` already renders `engineeringManagers` as a list. Still no new backend call — the same on-page EM data is reused, just iterated instead of singular.
  - When the team has **no** associated EM (including the TEAM-005/TEAM-006 stacked case — a facilitator lacks role-assignment permission *and* no EM exists to fall back to), TEAM-005 falls back to the same Application Admin contact mechanism TEAM-006 uses.

These are kept as two separate code paths rather than one shared "escalation contact" component, because they have genuinely different authorized-actor sets and different fallback chains (TEAM-005: EM → Admin → zero-admin fallback; TEAM-006: Admin → zero-admin fallback only). A shared component would need a branch for "does this site have an EM fallback tier" anyway — that branch is the actual difference between the two requirements, and hiding it inside a shared component makes it easier to accidentally collapse the two paths later (e.g., a future edit that "simplifies" TEAM-006 into reusing TEAM-005's EM branch, which would reopen Q2). Implementers may still factor out shared rendering (the single-line, comma-separated, `mailto:`-link markup) — the fork is in resolution logic, not necessarily in JSX.

### Decision 3: Rendering format — one inline line, comma-separated, no directory layout

However many Application Admins resolve (one, several, or the zero-admin fallback), the escalation renders as a single line of text in the same visual register as `access-model-statement`: comma-separated `name (mailto:email)` entries, no per-admin cards, no bulleted or numbered list, no vertical stacking. The moment this becomes a list with its own visual rhythm, it stops being passive text and becomes a directory — the exact UI-chrome outcome this change is supposed to avoid.

If the real Application Admin headcount (open question below) comes back large enough that a single comma-separated line becomes unreadable, that is itself the signal to revisit Decision 1's rejection of the configured-alias alternative (Option B) — not a reason to let the enumeration spill into a list layout.

### Decision 4: Zero-Application-Admin fallback copy

When the (System-excluded) Application Admin query returns zero rows, both escalation sites render:

> "No Application Admin is currently configured for this application. Contact your engineering leadership directly."

This is a placeholder for final review (see open questions) but is not itself a placeholder bug in the task-3.10 sense — it names the actual system state and gives a real, if generic, next step, rather than repeating "Contact your admin" with nothing after it.

## Risks / Trade-offs

- **[Risk] A future edit collapses the TEAM-005/TEAM-006 resolution paths into one, silently reintroducing an EM fallback on TEAM-006 and reopening Q2.** → Mitigation: keep the two resolution functions/queries named and tested separately (see tasks.md and the delta specs' scenarios); the rewritten task-4.3 tests assert TEAM-006 never renders EM identity, only Admin identity or the zero-admin fallback.
- **[Risk] The zero-admin query accidentally includes the seed `System` account**, silently rendering a non-actionable `system@dipstick.internal` link instead of the honest fallback. → Mitigation: exclude by id at the query layer (Decision 1), with an explicit test case asserting the fallback renders when the only "admin" row is the System account.
- **[Risk] Real Application Admin headcount is larger than assumed**, making the single-line format (Decision 3) unreadable or making individual-name disclosure a worse fit than a stable alias. → Mitigation: this is a named blocking open question below; the format decision (Decision 3) explicitly names the reconsideration trigger.
- **[Risk] The July 2026 security threat-model assumption ("internal, small user population," under which naming individual admins was judged acceptable) is stale.** → Mitigation: named blocking open question below, requires explicit reconfirmation before implementation proceeds, not silent inheritance.
- **[Trade-off] TEAM-005's EM-fallback path and Admin-fallback path are separate branches rather than a uniform "look up authorized contact" abstraction.** Slightly more code for a small feature, but keeps the TEAM-006/Q2 boundary explicit and testable rather than implicit in a shared function's branch logic (see Decision 2).

## Open Questions

Carried forward from exploration (`exploration-notes.md` §5) — not resolved by this design, and this change should not proceed to implementation copy-lock until #1 and #2 are answered:

1. **[BLOCKING] Real Application Admin headcount in the actual reference deployment.** Not discoverable from this repo. Needs an answer from whoever administers the real deployment's IdP role-claim assignments: how many users currently hold the `application_admin` claim? Decides whether Decision 3's single-line format stays viable or the configured-alias alternative (Decision 1's rejected option) should be reconsidered.
2. **[BLOCKING] Reconfirmation of the July 2026 security threat-model assumption** ("internal, small user population," the basis for judging individual-admin-identity disclosure acceptable). Needs an explicit one-line yes/still-true from the security analyst before this ships, not silently inherited from a two-month-old review. Owner: whoever picks up `tasks.md` 1.2 pings the security analyst directly and records the answer — see task 1.2 for the assignment.
3. **[Non-blocking, pre-ship] Exact rendered copy** for the multi-admin line and the zero-admin fallback sentence (Decision 4's text is a working draft). Format is fixed by Decision 3; wording should get a review pass, per Priya Nair's (Facilitator) explicit ask to see rendered copy before ship.
4. **[Non-blocking] Whether a follow-on issue should be filed now for facilitator-continuity tracking** (a later facilitator seeing that escalation was already requested) — named out of scope for this change, recommended as a separate issue, not filed as part of this design.
