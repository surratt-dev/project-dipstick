## 1. Pre-implementation gate

- [ ] 1.1 Get an explicit answer on real Application Admin headcount in the actual reference deployment (design.md Open Question #1). **This answer can change the approach, not just unblock the one already designed:** if the count is small enough for a readable comma-separated line, proceed with Decision 3 as written. If it is large enough that a single inline line would be unreadable, stop and actually revisit Decision 1's rejected configured-alias alternative (Option B) before writing code — don't ship the enumeration format anyway because the tasks below are already drafted for it.
- [ ] 1.2 Get an explicit reconfirmation from the security analyst that the July 2026 "internal, small user population" threat-model assumption still holds (design.md Open Question #2), before shipping individual Application Admin name/email disclosure. **Owner:** whoever picks up this task pings the security analyst directly (not a passive "carried open question") and records the explicit answer in this task before checking it off.
- [ ] 1.3 Lock final rendered copy for the multi-admin line and the zero-admin fallback sentence (design.md Decision 4 draft), with a look from Priya Nair (Facilitator) before implementation starts.

## 2. Backend — Application Admin identity exposure

- [ ] 2.1 Add a query (or extend an existing one in `teams.ts`) that returns current Application Admins' `name` + `email`, excluding the seed `System` account (`id = 00000000-0000-0000-0000-000000000001`) by id at the query level.
- [ ] 2.2 Expose this data via the response(s) consumed by the member management and team administration views (extend `GET /api/v1/teams/:teamId` / `GET /api/v1/teams/:teamId/members` as appropriate) for the escalation cases that need it: always for TEAM-006's view, and for TEAM-005's view when no EM is associated with the team.
- [ ] 2.3 Ensure the zero-admin state (query returns zero rows after excluding `System`) is distinguishable in the response from "data not yet loaded," so the frontend can render the fallback deterministically rather than guessing from an empty array.

## 3. Frontend — TEAM-006 escalation (`MemberManagement.tsx:445-447`)

- [ ] 3.1 Replace the static "Contact your admin to complete this before the session." sentence with the resolved Application Admin contact: name(s) + `mailto:` link(s), comma-separated, single inline line, same visual register as `access-model-statement`.
- [ ] 3.2 Render the zero-admin fallback sentence (locked copy from task 1.3) when no real Application Admin is returned.
- [ ] 3.3 Verify this path never renders an Engineering Manager's identity as the contact, even when one is associated with the team elsewhere on the same page (per design.md Decision 2 and the `manager-team-association` delta spec's "never resolves to an EM" scenario).

## 4. Frontend — TEAM-005 escalation (`MemberManagement.tsx:239-241`)

- [ ] 4.1 When the team has one or more associated Engineering Managers, render their existing on-page identity (`em.email`, currently rendered at `MemberManagement.tsx:469`) as the escalation contact — a single EM's identity if exactly one, or all associated EMs comma-separated on one inline line (same format as the multi-admin case) if more than one. No new backend call for this branch; iterate the `engineeringManagers` data already on the page.
- [ ] 4.2 When the team has no associated Engineering Manager, render the same Application Admin contact mechanism as TEAM-006 (name(s) + `mailto:` link(s), single inline line).
- [ ] 4.3 Render the zero-admin fallback sentence when the team has no associated EM *and* no real Application Admin is returned (the TEAM-005 stacked case).
- [ ] 4.4 Keep this resolution logic as a separate code path from TEAM-006's (design.md Decision 2) rather than a shared "escalation contact" component with an EM/Admin branch baked in — factor out shared rendering markup only, not resolution logic.

## 5. Tests — rewrite task-4.3 describe block

- [ ] 5.1 Rewrite `MemberManagement.test.tsx`'s existing task-4.3 describe block (`:483-559`) so assertions check for an actual resolvable mechanism (a `mailto:` `href`, or a rendered admin/EM name+email), not a match against the literal phrase "Contact your admin."
- [ ] 5.2 Add a TEAM-005 test case: exactly one EM associated → escalation shows that EM's identity as contact.
- [ ] 5.2a Add a TEAM-005 test case: more than one EM associated → escalation shows all associated EMs' identities, comma-separated, single inline line (not a list).
- [ ] 5.3 Add a TEAM-005 test case: no EM associated → escalation shows Application Admin contact.
- [ ] 5.4 Add a TEAM-005 stacked-case test: no role-assignment permission AND no associated EM → Application Admin contact, with an assertion that no EM data is referenced.
- [ ] 5.5 Add a TEAM-005 and a TEAM-006 test case each for the zero-Application-Admin fallback (only the seed `System` account exists) → fallback sentence renders, `system@dipstick.internal` is not rendered as a contact.
- [ ] 5.6 Add a TEAM-006 test case asserting the escalation contact is never an Engineering Manager's identity, even when one is associated with the team.
- [ ] 5.7 Add a test asserting the multi-admin case renders as a single inline comma-separated line, not a list or multiple elements with independent layout.

## 6. Verification

- [ ] 6.1 Confirm no session-creation or session-join code path was touched — this change must remain a non-blocking, "resolve before your next session" affordance (design.md Context).
- [ ] 6.2 Confirm the delta specs' scenarios in `specs/role-assignment/spec.md` and `specs/manager-team-association/spec.md` are all covered by a corresponding test case.
- [ ] 6.3 Manually verify rendered copy against locked text from task 1.3 before marking this change ready to archive.
