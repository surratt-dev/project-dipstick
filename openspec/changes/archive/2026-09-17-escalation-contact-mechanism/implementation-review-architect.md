# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** escalation-contact-mechanism
**Scope of review:** `packages/backend/src/config.ts`, `packages/backend/src/routes/teams.ts`, `packages/backend/src/routes/__tests__/teams.test.ts`, `packages/frontend/src/components/MemberManagement.tsx`, `packages/frontend/src/components/__tests__/MemberManagement.test.tsx`, `packages/shared/src/types/team.ts`, against `design.md` (as of the 2026-09-16 stakeholder-decision revision) and the two delta specs.

## Verdict

**Approved.** The implementation matches the design faithfully, respects the boundaries I care about, and the one flagged deviation is a legitimate, necessary structural fix — not scope creep.

## Design conformance

- **Config placement.** `APPLICATION_ADMIN_CONTACT_EMAIL` was added to `config.ts`'s `optional` list, read once at boot via `process.env`, no new getter — matches the existing pattern (`APP_ORIGIN`, `OIDC_ROLE_CLAIM`) exactly, and matches Decision 5's "backend-sourced, consistent with the rest of the config module" call. No parallel `import.meta.env` mechanism was introduced in the frontend, as the design required.
- **No roster query, no `AdminContact` type.** Confirmed — `teams.ts` does one config read (`config.APPLICATION_ADMIN_CONTACT_EMAIL ?? null`), no DB query, no `System`-account exclusion logic. `team.ts` gains exactly the field the design specified: `applicationAdminContactEmail: string | null`. No `AdminContact[]`.
- **Unconditional population, no viewer-state gating.** Verified in `teams.ts:665-669` — the field is set on the response object unconditionally, before any admin/non-admin branch. Backend tests (2.3, 2.4) assert this for both caller types plus the unset case. Correct per the superseded-Decision-5 rewrite.
- **Two separate resolution paths, not one shared component.** TEAM-006 (`canAssociateManagers` branch) resolves to Admin-contact only. TEAM-005 (`canAssignRoles` branch) resolves EM → Admin → unconfigured-fallback, reusing already-fetched `engineeringManagers` data with no new backend call. `ApplicationAdminContactLine` is shared *rendering* only, exactly as Decision 2's closing note permits ("implementers may still factor out shared rendering... the fork is in resolution logic, not necessarily in JSX"). Decision 2's core boundary — nothing routes TEAM-006 through an EM — holds.
- **Rendering register.** Single inline `<p>`/`<span>` lines, no lists, no cards; multi-EM case is comma-separated on one line (`formatEmContacts`), matching Decision 3.
- **Unconfigured fallback copy.** Verbatim match to Decision 4 / task 1.3's locked copy on both sites.
- **Audit logging.** No new `audit_log` entry was added for this read, consistent with Decision 6 — confirmed by inspection of `teams.ts`.

## The flagged deviation: decoupling the TEAM-006 escalation from `engineeringManagers.length === 0`

This is the one substantive judgment call in the diff, and it holds up.

**Before:** the TEAM-006 escalation/admin-affordance block was nested inside `{engineeringManagers.length === 0 ? (...) : (<ul>...)}`, so it was structurally impossible for the escalation text to render once any EM existed, for either an admin or a non-admin viewer.

**After:** the escalation/affordance block is now its own `{canAssociateManagers ? (...) : (...)}` conditional, independent of EM count; the "No Engineering Manager is associated with this team yet" status line remains separately gated on `engineeringManagers.length === 0`, unchanged.

I checked this against both the design and the delta spec directly, not just the engineer's stated rationale:

- `specs/manager-team-association/spec.md`'s scenario **"TEAM-006 escalation never resolves to an Engineering Manager"** is written as: *given* an EM is already associated with the team, *when* a user without TEAM-006 permission views the page, *then* the escalation still shows Application Admin contact only. The scenario's premise — a non-admin viewing the page **with an EM already present** — is unreachable under the old nesting; the escalation block simply would not exist in the DOM for that scenario to assert against. The old structure didn't satisfy this requirement by omission, it made the requirement untestable and, on inspection, actually unsatisfied: a non-admin blocked from TEAM-006 with an EM already on the team saw no escalation text at all.
- This is also required on the merits, not just for testability: a non-admin can never call TEAM-006 regardless of current EM count (the data model permits multiple active EMs per team — Context, carried into both specs), so gating the escalation on "no EM yet" was never the correct condition. The old behavior was a latent bug inherited from the prior feature branch, not a deliberate design decision this change was supposed to preserve.
- I confirmed test 5.8 (`packages/frontend/src/components/__tests__/MemberManagement.test.tsx:583-606`) exercises exactly this: EM present + `canAssociateManagers: false` → escalation renders, contains "Application Admin," and asserts the EM's name/email are absent. It fails under the old structure (the `getByTestId` would throw) and passes under the new one. Test 541 (`does NOT show the TEAM-006 escalation when canAssociateManagers is true`) confirms the admin path is unaffected by the restructuring — gating is still correctly on `canAssociateManagers`, not reintroduced coupling to EM count.
- Blast radius is contained: admins now also see the "Use the admin panel..." affordance persist alongside an existing EM list rather than disappearing once one EM is associated. That's a reasonable, minimal side effect of removing the shared conditional (not a separately-designed UI change) and is consistent with the data model already supporting multiple EMs per team — an admin plausibly wants to add a second EM.

I ran both the backend and frontend test suites for the touched files (48/48 and 40/40 passing) and a `tsc --noEmit` diff against `main` on the backend package — no new type errors introduced by this change (pre-existing unrelated errors in `facilitator-sessions.test.ts`, `connectionHealth.test.ts`, etc. are present on `main` too, at the same or higher count).

**Conclusion on the deviation:** legitimate and necessary, not scope creep. It doesn't reopen Q2 (TEAM-006 still never resolves to an EM — the tests specifically guard against that), and it's the minimum structural change required to make the spec's own scenario true rather than merely unfalsifiable.

## Boundaries and consistency with existing patterns

- No `sessions.ts` involvement — confirmed this remains a non-blocking affordance, not a gate (Context / task 6.1 self-check verified by inspection).
- Server is still the sole authority for `canAssignRoles`/`canAssociateManagers`; the frontend only branches on flags already computed server-side, no new client-side authorization logic introduced.
- The one new response field is a shared, non-secret configuration string — correctly not folded into any authorization or data-classification concern.

No further findings. No changes requested.
