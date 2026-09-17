# Design Review — Full Stack Engineer (Marcus Oyelaran)

Reviewed: `design.md`, `proposal.md`, `tasks.md` against current code in
`packages/frontend/src/components/MemberManagement.tsx`,
`packages/backend/src/routes/teams.ts`,
`packages/shared/src/types/team.ts`,
`packages/backend/migrations/4_seed_data.sql`, and
`packages/frontend/src/components/__tests__/MemberManagement.test.tsx`.

**Verdict: implementable as designed, low risk, small surface area. Two corrections needed to the task list before coding starts, one architectural recommendation I'd like adopted, and I concur with keeping both BLOCKING gates blocking.**

## Gates — I concur, will not start 2.x/3.x/4.x until closed

Tasks 1.1 (admin headcount) and 1.2 (security reconfirmation) are correctly marked BLOCKING. Decision 3's single-line format is a real constraint on the query shape (do we need pagination/truncation logic, or is `SELECT ... WHERE global_role = 'application_admin' AND id != System`
always small?) — I don't want to write that query twice. I'll ping the security analyst per 1.2's assignment before touching `teams.ts`.

## Confirmed sound

- **Authorization boundary holds.** Both `GET /api/v1/teams/:teamId` and the legacy `/members` route already gate on `is_member OR application_admin` before any data is returned (`teams.ts:526-563`). Exposing Application Admin identity in that same response doesn't create a new disclosure surface beyond "people already authorized to view this team's page" — it's not admin-identity-to-anyone, it's admin-identity-to-authorized-viewers. Worth stating explicitly in the security reconfirmation ask (1.2), since it narrows what's actually being reconfirmed.
- **TEAM-005 EM-reuse branch is genuinely free.** `engineeringManagers` is already in `TeamMembersResponse` and rendered at `MemberManagement.tsx:452-476` (`em.email` at :469). Iterating it for the escalation line is pure frontend work, no new query, no new type beyond what's already there for that branch.
- **System-account exclusion precedent matches what Decision 1 proposes.** `migrations/4_seed_data.sql:17-24` confirms the sentinel is `id = 00000000-0000-0000-0000-000000000001`, `global_role = 'application_admin'`, `email = 'system@dipstick.internal'` — exactly the id the design says to exclude at the query level. Excluding by id (not by `email LIKE`, not by a display-layer filter) is the right call; it's also the only field here that's structurally guaranteed stable.
- **Keeping TEAM-005/TEAM-006 as separate resolution functions is the right call**, not just for the Q2 boundary reason the design gives — `checkAssignRolesAuthorization` and the TEAM-006 admin-only check are already two separate functions in `teams.ts` today. Mirroring that split in the new admin-contact resolution logic matches the file's existing shape rather than fighting it.
- **The self-referential comment at `teams.ts:283-291`** (Security review finding 7 — the bracketed-placeholder near-miss, explicitly naming "that gap is tracked separately as tasks.md task 4.2") confirms this design is closing a gap the codebase already knows about and has scar tissue from. Once this ships, that comment references a closed gap — file a one-line follow-up to update/remove it so it doesn't read as still-open. Not blocking, just don't want it to go stale and mislead the next reader.

## Corrections needed to tasks.md before implementation

1. **Task 2.2 should drop the legacy endpoint.** It reads "extend `GET /api/v1/teams/:teamId` / `GET /api/v1/teams/:teamId/members` as appropriate." `MemberManagement.tsx:5-7` states outright that the legacy `/members` endpoint (`LegacyTeamMembersResponse`) "is no longer used here," and it's marked `@deprecated` in `team.ts:36-39`. Extending a deprecated, unconsumed endpoint for this feature is pure scope creep — no caller needs it. Scope task 2.1/2.2 to `TeamMembersResponse` / `GET /api/v1/teams/:teamId` only.

2. **Test file path is stale.** `proposal.md` and `tasks.md` (5.1) cite `MemberManagement.test.tsx:483-559`. The actual file is `packages/frontend/src/components/__tests__/MemberManagement.test.tsx` (confirmed: task-4.3 describe block is there, at line 483 — line number happens to match, path doesn't). Cosmetic, but worth fixing so whoever picks up task 5 isn't searching the wrong directory.

## Recommendation: make the admin-identity query unconditional, not display-conditional

Task 2.2's phrasing — "expose... for the escalation cases that need it: always for TEAM-006's view, and for TEAM-005's view when no EM is associated" — reads as instructing the *backend* to decide whether to run the admin-lookup query based on a condition (EM presence) that's really a *frontend rendering* decision. That couples backend response-shaping to frontend display logic and creates a synchronization risk: if the backend's "no EM associated" check and the frontend's "is `engineeringManagers` empty" check ever drift (e.g., someone changes one without the other), you get a silently broken escalation — no error, just a missing contact, which is exactly the dead-end failure mode this whole change exists to eliminate.

Concretely: add `applicationAdmins: AdminContact[]` (see type note below) to `TeamMembersResponse` and populate it **unconditionally** on every `GET /api/v1/teams/:teamId` response, the same way `engineeringManagers` is always populated regardless of `canAssociateManagers`. Let the frontend decide when to render it (TEAM-006 always; TEAM-005 only when `engineeringManagers.length === 0`). This is one small, cheap, indexable query (`global_role = 'application_admin' AND id <> System`) run once per request — the cost difference versus conditional evaluation is negligible, and it removes an entire class of backend/frontend logic-sync bug for free. It also sidesteps task 2.3 entirely (see below).

## Task 2.3 ("zero-admin state distinguishable from not-yet-loaded") — I think this is solving a problem that doesn't exist here

`TeamMembersResponse` is a single atomic JSON payload — there's no partial-load state once the fetch resolves. The frontend already handles "not yet loaded" as `data === null` (`MemberManagement.tsx:160-162`, `Loading team members…`). Once `data` is populated, `applicationAdmins: []` is unambiguous: the query ran and found nothing. This is exactly the same pattern already in production for `engineeringManagers: []` today (renders `no-em-association-indicator`, not a loading state). I'd drop task 2.3 as written, or reword it to "confirm `applicationAdmins` is always present as an array (never `undefined`/omitted) in the response" — a **type-level** guarantee, not a runtime-distinguishability mechanism. Making the field required (not optional) in the shared type is what actually gets you this for free: TypeScript will force every response-builder and every test fixture (`membersResponseWithAssignRoles` et al. in the test file) to supply it, so a missing-field bug is a compile error, not a runtime ambiguity. This is the shared-types-as-correctness-tool pattern already used throughout this codebase — I want to keep using it here rather than inventing a new sentinel value.

## Type addition

Needs a new shared type in `packages/shared/src/types/team.ts` — I'd add a minimal dedicated shape rather than reusing `TeamMember` (which carries a `role: MembershipRole` field that doesn't apply to a global admin identity):

```ts
export interface AdminContact {
  userId: string;
  displayName: string;
  email: string;
}
```

`userId` isn't strictly required for rendering but keeps `.map()` keys stable and matches the existing convention (`TeamMember.userId` used as React key at `MemberManagement.tsx:280,454`). Add `applicationAdmins: AdminContact[]` (required, not optional) to `TeamMembersResponse`.

## Gap not addressed by design or tasks: audit trail for non-admin reads of admin identity

Every existing admin-data read in `teams.ts` gets an audit row — `admin.membership_list_accessed`, `admin.team_detail_accessed`, both gated on "actor is `application_admin`" (`teams.ts:461-489`, `632-658`). This change introduces the inverse case for the first time: **non-admin actors reading admin PII** (name + email). Neither `design.md` nor `tasks.md` says whether that read should be audited. Given how consistently this codebase audits administrative-data access in both directions elsewhere, I think this is a real question, not a hypothetical — but it's a security-policy call, not an engineering one. I'd fold it into the task 1.2 security-analyst conversation rather than deciding it myself in code: "should a non-admin viewing another user's Application Admin contact info generate an audit_log row the way admin reads of member data already do?" If the answer is no, that's fine — but it should be an explicit no, not silence.

## Accessibility note (non-blocking)

Decision 3's comma-separated inline line with `mailto:` links remains keyboard/screen-reader accessible even at moderate admin counts — each `<a>` stays independently focusable inside one `<p>`, same as any inline link list. The only failure mode at scale is visual line-wrapping/readability, which is exactly what task 1.1's headcount answer is supposed to gate. No separate accessibility concern beyond what Decision 3 already anticipates.

## Summary of required changes before/at implementation

- [ ] Fix task 2.2 to scope to `GET /api/v1/teams/:teamId` only (drop legacy `/members` endpoint)
- [ ] Correct test file path reference to `__tests__/MemberManagement.test.tsx`
- [ ] Make `applicationAdmins` population unconditional in the backend, filtered for display client-side (supersedes conditional wording in 2.2)
- [ ] Reword or drop task 2.3 in favor of a required (non-optional) `AdminContact[]` field
- [ ] Add `AdminContact` type + `applicationAdmins: AdminContact[]` to `TeamMembersResponse` in `packages/shared/src/types/team.ts`
- [ ] Raise the audit-logging question with the security analyst alongside task 1.2
