## Why

The team membership screen already tells a facilitator or engineer *that* they lack authority to change roles or associate an Engineering Manager — but it stops at "Contact your admin," with no name, address, or path to actually do that. For a facilitator running a session with a team they've never worked with before (the exact scenario this application exists to support), "contact your admin" is a dead end: they have no idea who the admin is. In practice that dead end routes back to whoever has been explaining this ritual by hand for years, which is precisely the informal-help-desk failure mode the application was built to eliminate.

This gap is not new — it is a named, tracked condition. Rachel Okonkwo's (VP Engineering) sign-off on the admin-only TEAM-006 EM-association restriction was explicitly conditioned on this escalation path being built, not deferred (`MemberManagement.tsx:210-226`), and `tasks.md` task 4.2 has sat as the only unchecked item in its section since. GitHub issue #15 and BRD FR-1.6a name the requirement directly: "Contact the admin" with no mechanism does not meet the spec. This change closes that gap for real, for both places it appears — the TEAM-005 role-assignment escalation and the TEAM-006 EM-association escalation.

## What Changes

- Add a real, resolvable contact mechanism to the TEAM-006 (EM-association) escalation message: enumerate current Application Admins (name + `mailto:` link) as a single inline line of passive text, in the same visual register as the existing `access-model-statement` pattern — no new UI surface, no modal, no interactive flow.
- Add the same Application-Admin-contact mechanism to the TEAM-005 (role-assignment) escalation message **for the case where no Engineering Manager is currently associated with the team** (no EM data exists to fall back to).
- For the TEAM-005 escalation **when one or more EMs are already associated** with the team, reference that EM's (or, if more than one, all associated EMs', comma-separated) existing on-page name/email (`MemberManagement.tsx:469`) as the contact instead of an Application Admin — this endpoint's authorized-actor set legitimately includes the team's own EM(s), per `role-assignment/spec.md`. A team can have more than one active EM (the uniqueness constraint is per user-team pair, not per team, and `MemberManagement.tsx` already renders `engineeringManagers` as a list), so this branch extends the multi-admin comma-separated format to the multi-EM case rather than assuming exactly one. This is a data-reuse change, not new backend work.
- Add an explicit zero-Application-Admin fallback: when no real Application Admin exists (a reachable state — `global_role` is an IdP-asserted claim with no in-app management UI and no DB invariant guaranteeing at least one holder), render a specific fallback sentence naming the actual state rather than silently repeating "Contact your admin" or rendering a non-actionable address. The seed sentinel `System` account (`00000000-0000-0000-0000-000000000001`) must be excluded from the Application Admin query used here, or the zero-admin state will silently render a non-human `system@dipstick.internal` mailto link instead of the honest fallback.
- Rewrite `MemberManagement.test.tsx`'s task-4.3 describe block (`:483-559`) so it asserts the presence of an actual resolvable mechanism (a `mailto:` href, or a rendered admin/EM identity), not a match against the literal phrase "Contact your admin." Add explicit test cases for the TEAM-005 stacked case (no permission AND no associated EM), the multi-EM case, and the zero-Application-Admin fallback.
- **Not in scope**: no facilitator-continuity tracking (whether a later facilitator can see that escalation was already requested) — that requires its own data model and UI surface and is being recommended as a separate follow-on issue, not bundled here. No in-app messaging/request system (Option D) — out of proportion to a text-and-data fix and not what FR-1.6a asks for.

## Capabilities

### New Capabilities
(none — this closes a gap in two existing capabilities' requirements)

### Modified Capabilities
- `role-assignment`: The TEAM-005 escalation-message requirement (currently satisfied by generic "Contact your admin" text) is tightened to require a specific, resolvable contact mechanism — the associated EM's identity when one exists, otherwise Application Admin identity, otherwise a named zero-admin fallback.
- `manager-team-association`: The TEAM-006 escalation-message requirement is tightened the same way — Application Admin identity (this endpoint has no EM fallback, since Application Admin is its only authorized actor), otherwise the named zero-admin fallback.

## Impact

- **Frontend**: `packages/frontend/src/components/MemberManagement.tsx` — both escalation-message render blocks (`:239-241` TEAM-005, `:445-447` TEAM-006).
- **Backend**: Application Admin identity (name + email) is not currently exposed to non-admin callers in any API response consumed by this screen. The endpoint(s) backing this view need to start surfacing Application Admin identity data for the escalation cases that require it (TEAM-006 always; TEAM-005 only when no EM is associated). The TEAM-005 case with an EM already associated needs no new backend work — that data (`em.email`) is already fetched and rendered on the page.
- **Tests**: `packages/frontend/src/components/MemberManagement.test.tsx` task-4.3 describe block rewritten, with new cases for the TEAM-005 stacked case and the zero-admin fallback.
- **Open, non-blocking for this proposal but must be resolved before design locks the mechanism** (carried forward from exploration, not resolved here — see `exploration-notes.md` §5):
  1. **Real Application Admin headcount in the actual reference deployment** — not discoverable from this repo; decides whether "enumerate all, comma-separated, one line" stays viable or a stable alias (Option B) should be reconsidered instead. Needs an answer from whoever administers the real deployment's IdP role-claim assignments.
  2. **Reconfirmation of the July 2026 security threat-model assumption** ("internal, small user population," which is why naming individual admins by name+email was judged acceptable) — no in-repo evidence it's changed, but needs an explicit one-line reconfirmation from the security analyst before design finalizes the mechanism, not silently inherited.
  3. **Exact rendered copy** for the multi-admin line and the zero-admin fallback sentence — format is constrained (single inline line, no directory/list layout) but final wording should get a design-phase review pass.

  *(Resolved by design.md Decision 2: TEAM-005 and TEAM-006 stay separate resolution paths, sharing only rendering markup — not one shared contact-resolution component. Removed from this open-items list.)*
