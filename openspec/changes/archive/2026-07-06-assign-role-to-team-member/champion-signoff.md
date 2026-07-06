# Champion Sign-Off: assign-role-to-team-member

**Author:** Devon Calloway, Internal Champion
**Date:** 2026-07-06

---

## Sign-Off

I am signing off on this change. The constraints I have been carrying manually are now structurally enforced in code. That is the whole point.

---

## What I Checked

### 1. No-manager-participation rule — structurally enforced

The session-participation spec was updated as a prerequisite before any role assignment code shipped. The session participation endpoint now queries both `users.global_role` AND `team_memberships.role` in a single LEFT JOIN before recording a participant. If either field is `engineering_manager` for the relevant team, the request is rejected. Server-side. Not a UI toggle. Not a warning. A hard rejection.

This matters because this change creates a working path to set `team_memberships.role = 'engineering_manager'` without touching `users.global_role`. Before this change, a user could have the global role of `engineer` and the team membership role of `engineering_manager` — and the old single-field check would have let them into a session. That window is now closed. Both fields are checked. The check runs on each request directly from the database — no cached role value, no session-stored role, no Redis shortcut. The no-manager rule is as strong as it has ever been and I can prove it.

The mid-session case is also handled correctly. Votes locked in before a role change are preserved and counted at reveal. Lock-in attempts submitted after the role change are rejected. The lock-in handler re-reads the database on each operation — it does not use a role value established when the WebSocket connection opened. A long-lived connection does not become a bypass path.

### 2. Facilitator-from-another-team constraint — unaffected and explicitly documented

This change does not touch the facilitator independence constraint, and the spec now explicitly documents why it is independent of membership role. The check is on the existence of a `team_memberships` row — not on the role value in that row. A user with `team_memberships.role = 'engineering_manager'` on a team is still ineligible to facilitate that team's sessions. The two constraints are separate and both hold.

This was a point I wanted to see stated explicitly in the spec, not left to inference. It is there.

### 3. Session integrity and simultaneous reveal

The real-time facilitator grid update (Task Group 6 — the question of whether the facilitator sees a role change reflected live during an active session) is explicitly deferred to the WebSocket infrastructure change. This is an accepted operational risk for this delivery. I accept it on one condition, which I am stating below.

The data-layer guarantees are in place regardless: votes are preserved, post-change lock-ins are rejected, role changes are immediate. What is not in place is the facilitator's control surface staying current during a live session if an admin changes a role in another browser tab. That is a real scenario. It is deferred, not forgotten.

### 4. Core constraint summary

| Constraint | Status |
|---|---|
| No-manager participation — both DB fields checked | Structurally enforced at the session participation endpoint |
| No-manager participation — mid-session role change | Post-change lock-in rejection enforced; pre-change votes preserved |
| Facilitator from another team | Unaffected; explicitly documented as membership row existence, independent of role value |
| Role changes immediate, no caching | Per-request database read; Redis prohibition documented at implementation site |
| Audit trail transactionally coupled | Audit INSERT and role change UPDATE in same transaction; if audit fails, role change rolls back |
| TEAM-006 not called; `users.global_role` not written | Verified by test; the two-layer role system is maintained |

---

## Open Items I Want Tracked

These are not blockers on this change. They are things I expect to see closed before I consider the work done.

### O1 — Escalation path: minimum met, preferred not implemented

The member management view shows a plain-language explanation when a user cannot assign roles. That is the minimum. The preferred implementation — surfacing the admin contact name and an in-app request path — is not yet in place. The architect review noted this and named Marcus Oyelaran as the owner.

I want to be direct about why this matters to me beyond a preference: Rachel Okonkwo accepted Option A (admin-only role assignment) on the explicit condition that the escalation path would be built in. If a facilitator discovers a misconfigured role fifteen minutes before a session and hits a dead-end with no actionable path, that is a failure of the tool. One facilitator experience like that becomes the story that team tells everyone they know. The minimum is acceptable for now. The preferred implementation is required for adoption at scale. Owner: Marcus Oyelaran. I want a named target date.

### O2 — Task Group 6 must carry into the WebSocket infrastructure change

When the WebSocket change is designed, Decision 6's requirements must be explicitly carried in from the start: role-change events must be scoped to the session facilitator and the directly affected user only. No broadcast to all connected clients. The event payload must contain only data each recipient is authorized to see. This is not a WebSocket convenience feature — it is a constraint that affects how the event bus is designed. It must be in the design document for that change before implementation begins, with a citation to this document as the source.

### O3 — Three deferred verifications need named owners and change targets

Three verification tasks are deferred because the endpoints they test do not exist yet:

- **Task 7.3:** Demotion from EM immediately returns 403 from the session history endpoint. Pending: session history implementation.
- **Task 7.6:** Session-initiation guard blocks a session when the team has zero participant-role members. Pending: session initiation implementation.
- **Task 7.7:** A user with `membership_role = 'engineering_manager'` cannot set up a session for their team. Pending: session setup implementation.

The spec requirements for all three are correct and in place. When those features are implemented, these verifications must be picked up explicitly — not rediscovered. I want them named in the relevant change proposals when those changes are scoped.

### O4 — Bootstrapping must be resolved before first team onboarding

Marcus Delgado (BA) owns a bootstrapping documentation deliverable targeting Q3 2026. The question is how the first Application Admin and first Facilitator accounts are provisioned. The security review confirmed this is required before any team is onboarded. I am holding that line. A team attempting their first session against an application with no provisioned admin is not a reasonable edge case — it is the default for every new deployment.

### O5 — TeamPage.tsx vocabulary violation

The existing team membership list in `TeamPage.tsx` renders `m.role` directly, exposing `participant` and `engineering_manager` as visible text. The architect review flagged this. It predates this change but Decision 8 now governs all role-displaying surfaces. This should be fixed in the next maintenance pass — it is a one-line change (apply `ROLE_LABELS`).

---

## Closing Note

This change does the thing I have been waiting for. Role assignment is the gate everything else was standing behind. The no-manager rule was a policy statement with no enforcement path when a user's team membership role had not been set. It is now a structural check with a structural prerequisite. The ritual's integrity is not dependent on someone remembering to document the rules — it is enforced in code.

The open items above are real and I expect them to be closed. But they do not change my read of this change: it is correct, the constraints are preserved, and the foundation is in place.

— Devon Calloway
