# team-membership-removal

**Status:** Stub — not yet proposed. Filed by `session-lifecycle-transitions` (tasks.md task 7.4).

**Owner:** Marcus Delgado (Business Analyst), per the exploration notes' Section 3 recommendation.

## Why this is deferred, not built here

`session-lifecycle-transitions`'s proposal.md names team membership removal explicitly as Out of Scope:

- A separate, orthogonal change with a different authorization owner (admin/EM roster management, not facilitator session control).
- **Corrected by `reassign-action-item-owner` (2026-09-29):** this bullet previously named GitHub issue #23 (open action-item reassignment authorization) as a dependency, on the basis that `VOTE-004`'s "new owner must be an active participant" constraint was not yet designed. It now is: `reassign-action-item-owner` designs and ships that constraint in full (the new-owner eligibility cascade — active, non-EM, not the calling facilitator — at `PATCH /api/v1/action-items/:actionItemId/owner`). This is no longer an open dependency for this stub.
- Nothing `session-lifecycle-transitions` builds depends on membership removal existing, and nothing it builds needs to anticipate this change's design.

## Known open question carried forward

**Mid-session membership removal** — what happens to a participant's connection, in-flight vote, and the facilitator's readiness grid if a team membership removal lands while that person is in a running session — is a real open question at the boundary of this change and `session-lifecycle-transitions`. It belongs here because its trigger (a roster event) and its owner (admin/EM authorization) both live in this change, not in the session-runtime code. Note: `session-lifecycle-transitions`'s own session-runtime code (`evaluateSessionSubscriberAccess`, the vote lock-in handler) already reads `team_memberships.removed_at`/`role` live on every check, whether or not anything sets them yet — so this change does not need to modify that code, only decide what removal *does* to a live session.

## Scope to design when this change is picked up

- Admin/EM authorization model for who can remove a team member.
- Mid-session removal effects (connection handling, in-flight vote, readiness-grid consistency), per the open question above.

**Corrected by `reassign-action-item-owner` (2026-09-29):** this list previously also named "resolution of GitHub issue #23 (open action-item reassignment authorization)" as a prerequisite or bundled decision for this stub. That issue (`VOTE-004`) is now designed and shipped by `reassign-action-item-owner` — it is no longer part of this stub's remaining scope. Note also that this endpoint's own namesake scenario (reassigning away from a departed owner) cannot occur organically until this change sets `team_memberships.removed_at` in a real production code path; `reassign-action-item-owner`'s validation is correct and buildable regardless, since reassignment has other legitimate, already-reachable uses.
