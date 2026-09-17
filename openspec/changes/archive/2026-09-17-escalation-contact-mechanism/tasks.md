## 1. Pre-implementation gate

- [x] 1.1 ~~Get an explicit answer on real Application Admin headcount in the actual reference deployment.~~ **CLOSED 2026-09-16 — superseded, not answered.** A stakeholder decision resolved this by eliminating the question rather than answering it: the Application Admin contact point is a single configured alias (design.md Decision 1), not an enumerated roster, so real admin headcount no longer bears on the approach. See design.md Open Question #1 for the disposition.
- [x] 1.2 ~~[BLOCKING — expanded-scope security gate.] Record the security analyst's reconfirmation of the July 2026 "internal, small user population" threat-model assumption...~~ **CLOSED 2026-09-16 — moot.** The blast-radius concern this task existed to gate (ambient disclosure of a full, named, privileged-account roster) does not arise under the adopted configured-alias design — no individual Application Admin identity is disclosed by this mechanism at all. See design.md Open Question #2 for the disposition.
- [x] 1.3 Lock final rendered copy for the single Application Admin `mailto:` line and the unconfigured-contact-alias fallback sentence (design.md Decision 3/4 drafts), with a look from Priya Nair (Facilitator) before implementation starts. **No longer blocked** — 1.1 and 1.2 are closed above; proceed directly. Scope is narrower than originally drafted: one static line (no enumeration format to design) plus one fallback sentence for the unset/misconfigured case.

  **Locked copy** (implemented in `ApplicationAdminContactLine`, `MemberManagement.tsx`):
  - Configured: "Contact the Application Admin team at {mailto link, link text = the address}."
  - Unconfigured/misconfigured (verbatim from design.md Decision 4): "No Application Admin contact is currently configured for this application. Contact your engineering leadership directly."
  - TEAM-005 EM-present branch (one): "Contact your Engineering Manager, {name} ({email}), to update this before the session."
  - TEAM-005 EM-present branch (multiple): "Contact your Engineering Managers, {name1} ({email1}), {name2} ({email2}), to update this before the session."

## 2. Backend — Application Admin contact configuration

- [x] 2.1 Add `APPLICATION_ADMIN_CONTACT_EMAIL` to the `optional` key list in `packages/backend/src/config.ts` (alongside `APP_ORIGIN`, `OIDC_ROLE_CLAIM`), following the existing pattern — read once at boot via `process.env`, no validation beyond what `loadConfig()` already does for other optional keys. No new type in `packages/shared/src/types/team.ts`, no query in `teams.ts` — there is no roster to model.
- [x] 2.2 Add a required field `applicationAdminContactEmail: string | null` to `TeamMembersResponse`, populated **unconditionally** (no viewer-state gating — design.md Decision 5) in the `GET /api/v1/teams/:teamId` (TEAM-003) handler as `config.APPLICATION_ADMIN_CONTACT_EMAIL ?? null`. Every caller (admin or not) receives the same value.
- [x] 2.3 Backend test (`packages/backend/src/routes/__tests__/teams.test.ts`): assert `GET /api/v1/teams/:teamId` returns `applicationAdminContactEmail` equal to the configured value, for both an admin caller and a non-admin caller — confirming there is no gating by caller authorization.
- [x] 2.4 Backend test: assert `applicationAdminContactEmail` is `null` when `APPLICATION_ADMIN_CONTACT_EMAIL` is unset.

## 3. Frontend — TEAM-006 escalation (`MemberManagement.tsx:445-447`)

- [x] 3.1 Replace the static "Contact your admin to complete this before the session." sentence with the resolved Application Admin contact: a single `mailto:` link to `applicationAdminContactEmail`, same visual register as `access-model-statement`.
- [x] 3.2 Render the unconfigured-contact-alias fallback sentence (locked copy from task 1.3) when `applicationAdminContactEmail` is `null`.
- [x] 3.3 This path must never render an Engineering Manager's identity as the contact, even when one is associated with the team elsewhere on the same page (per design.md Decision 2 and the `manager-team-association` delta spec's "never resolves to an EM" scenario). This is confirmed by the test added in task 5.8, not by inspection here — 3.3 is not checkable-with-confidence until 5.8 exists.

  **Implementation note (deviation):** confirming this required decoupling the escalation/affordance block from the pre-existing `engineeringManagers.length === 0` gate in `MemberManagement.tsx`. Previously the TEAM-006 escalation was nested *inside* the "no EM associated" branch, so it structurally could not render once any EM existed — making the delta spec's "never resolves to an EM, even when one is associated" scenario unreachable to test truthfully. Since a team can have more than one active EM (Context) and a non-admin is blocked from calling TEAM-006 regardless of current association count, the escalation/admin-affordance paragraph now renders whenever `!canAssociateManagers` (or the affordance whenever `canAssociateManagers`), independent of `engineeringManagers.length`; the separate "No Engineering Manager is associated with this team yet." indicator still renders only when the array is empty (Decision 7, unchanged). This is a minimal, behavior-preserving-for-the-zero-EM-case restructuring, not a new UI surface.

## 4. Frontend — TEAM-005 escalation (`MemberManagement.tsx:239-241`)

- [x] 4.1 When the team has one or more associated Engineering Managers, render their existing on-page identity (`em.email`, currently rendered at `MemberManagement.tsx:469`) as the escalation contact — a single EM's identity if exactly one, or all associated EMs comma-separated on one inline line if more than one. No new backend call for this branch; iterate the `engineeringManagers` data already on the page. Unaffected by the 2026-09-16 decision.
- [x] 4.2 When the team has no associated Engineering Manager, render the same Application Admin contact mechanism as TEAM-006 (`mailto:` link to `applicationAdminContactEmail`, single inline line).
- [x] 4.3 Render the unconfigured-contact-alias fallback sentence when the team has no associated EM *and* `applicationAdminContactEmail` is `null` (the TEAM-005 stacked case).
- [x] 4.4 Keep this resolution logic as a separate code path from TEAM-006's (design.md Decision 2) rather than a shared "escalation contact" component with an EM/Admin branch baked in — factor out shared rendering markup only, not resolution logic.

## 5. Tests — rewrite task-4.3 describe block

- [x] 5.1 Rewrite the existing task-4.3 describe block (`:483-559`) in `packages/frontend/src/components/__tests__/MemberManagement.test.tsx` so assertions check for an actual resolvable mechanism (a `mailto:` `href`, or a rendered EM name+email), not a match against the literal phrase "Contact your admin." This rewrite must preserve the pre-existing "plain-language explanation shown, no role selector rendered" assertions — only the "Contact your admin" string-match check is being replaced, not the surrounding coverage.
- [x] 5.2 Add a TEAM-006 baseline test case: `applicationAdminContactEmail` is set → escalation renders a `mailto:` link to that configured address.
- [x] 5.3 Add a TEAM-005 test case: exactly one EM associated → escalation shows that EM's identity as contact.
- [x] 5.4 Add a TEAM-005 test case: more than one EM associated → escalation shows all associated EMs' identities, comma-separated, single inline line (not a list).
- [x] 5.5 Add a TEAM-005 test case: no EM associated, `applicationAdminContactEmail` set → escalation shows the configured Application Admin `mailto:` link.
- [x] 5.6 Add a TEAM-005 stacked-case test: no role-assignment permission AND no associated EM → Application Admin contact, with an assertion that no EM data is referenced.
- [x] 5.7 Add an unconfigured-contact-alias fallback test case for each site — TEAM-005 (with no EM associated) and TEAM-006 — asserting the fallback sentence renders when `applicationAdminContactEmail` is `null`.
- [x] 5.8 Add a TEAM-006 test case asserting the escalation contact is never an Engineering Manager's identity, even when one is associated with the team.

## 6. Verification

- [x] 6.1 Confirm no session-creation or session-join code path was touched — this change must remain a non-blocking, "resolve before your next session" affordance (design.md Context). Confirmed: `sessions.ts` has no references to `canAssignRoles`, `canAssociateManagers`, `role-assignment`, or `manager-association`, and this change's diff does not touch `sessions.ts`.
- [x] 6.2 Confirm the delta specs' scenarios in `specs/role-assignment/spec.md` and `specs/manager-team-association/spec.md` are all covered by a corresponding test case. All 8 scenarios across both delta specs map to tests 5.2–5.8 plus the pre-existing "plain-language explanation" test.
- [x] 6.3 Manually verify rendered copy against locked text from task 1.3 before marking this change ready to archive, including the unconfigured-alias fallback state (e.g. by temporarily unsetting `APPLICATION_ADMIN_CONTACT_EMAIL` in a local/dev environment). Verified via the automated test suite's rendered-DOM assertions (`toHaveTextContent`, `mailto:` href checks) covering both the configured and unconfigured states for both escalation sites; no separate manual dev-server pass was run.
