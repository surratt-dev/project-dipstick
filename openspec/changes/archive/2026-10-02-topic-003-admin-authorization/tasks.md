## Conventions

- **Unit lane stays green after every task.** Every task in sections 1–5 ends with the backend and frontend unit suites, typecheck and lint passing. Section 1 is a single atomic task for this reason: the endpoint, the TOPIC-002 flag and `topic-add-flag-parity.test.ts` change together, and the parity test is that task's exit condition. **Never edit the parity test except as task 1.1 says** (flip the admin rows to `ADMITTED_CAN_ADD`); do not flip rows back to match a half-done state.
- **Real-DB tests.** Every new real-Postgres test keeps the house `describe.skipIf(!dbUp)` probe and throws when `!dbUp && process.env.REQUIRE_DB`.
- **Locate code by quoted text.** Line numbers below are approximate as of the pre-change tree and drift as earlier tasks land; the quoted comment or code text is authoritative.
- **[HUMAN]** tasks need a person (credentials, sign-off, an accountable decision, filing in an external tracker). The implementing agent does not attempt them and leaves them unchecked.
- **[AT ARCHIVE]** tasks are done during archive, not during apply.
- Apply is complete when every task without one of these labels is checked.

## 1. Atomic flip: TOPIC-003 endpoint, TOPIC-002 flag, parity test

- [x] 1.1 Make the following changes as **one task**; the unit lane is green only at its end (architect A1, A2):
  - **Wrapper.** In `packages/backend/src/routes/topics.ts`, add `checkAddCustomTopicAuthorization(reply, userId, teamId, startTime)` beside `checkArchiveTopicAuthorization` / `checkReorderTopicsAuthorization`. It calls `checkStandingFacilitatorOrAdminAuthorization`; on rejection it calls `applyTimingFloor(startTime)` and then sends 403 with the existing reason code; on success it returns `{ rejected: false, actorGlobalRole }` (design D1). Write its 403 copy inline, as the archive/restore/reorder wrappers do: `NOT_A_FACILITATOR` → "Only a facilitator or an application admin can add a custom topic."; `FACILITATOR_IS_TEAM_MEMBER` → unchanged copy (design D1, D2).
  - **Call site.** Switch the TOPIC-003 handler from `checkStandingFacilitatorAuthorization` to the new wrapper. Confirm the lock-denial and success audits still read `authResult.actorGlobalRole`, and that the 403 → 404 → 409 → 422 order is unchanged.
  - **Dead constant.** Only after the call-site switch, delete `ADD_CUSTOM_TOPIC_AUTH_MESSAGES`; `grep -rn "Only a facilitator can add a custom topic" packages/` then returns no source hit.
  - **Flag.** In `packages/backend/src/routes/content.ts`, set `canAddTopics` to `actorGlobalRole === "facilitator" || actorGlobalRole === "application_admin"`. Keep it separate from `canEditAnnotations` and replace the "TEMPORARY, pending #176" comment (design D3). Update the `canAddTopics` doc comment in `packages/shared/src/types/topic.ts` (no "temporary" and no #176 wording).
  - **`content.test.ts`.** Replace the "cannot add while #176 is open" assertion: TOPIC-002 for an admin returns `canAddTopics: true`, `canEditAnnotations: false`, and both `active` and `archived` lists present (BA M8).
  - **Old-copy assertions.** Update existing `topics.test.ts` assertions on the old `NOT_A_FACILITATOR` copy to the new copy.
  - **Parity test.** In `packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts`, flip the admin rows (non-member and member) to `ADMITTED_CAN_ADD` and delete `ADMITTED_CANNOT_ADD`. Rewrite the file header: the two sides no longer use different helpers that "agree today only by coincidence"; both now decide through `checkStandingFacilitatorOrAdminAuthorization`, and the test guards `content.ts`'s explicit role expression against the TOPIC-003 wrapper. Remove the "A #176 fix … MUST" paragraph (engineer review S2).
  - **Exit condition:** all seven caller classes in the parity test pass, and the full backend unit lane is green.

## 2. TOPIC-003 admin behaviour tests

- [x] 2.1 Admin (non-member), unlocked team, valid body → 201. The topic is appended at the end of the display order, and one `topic.custom_added` audit row with `actor_global_role = 'application_admin'` is written in the insert's transaction. The 201 body contains only topic fields: assert no session fields (e.g. no `openSessionCreatedAt`) (security review §5). This audit-row assertion, and 2.2's, is F1's interim compensating control and must not be weakened
- [x] 2.2 Admin with an active membership on the team, unlocked → 201, with the same ordering and exactly one audit row as in 2.1
- [x] 2.3 Admin, locked team → 409 `TOPIC_CUSTOMIZATION_LOCKED`. One `topic.write_denied_locked` row is written with `actor_global_role = 'application_admin'` and `metadata.attempted_operation = 'topic.custom_added'`, and there is no `topic.custom_added` row
- [x] 2.4 Admin check order: nonexistent canonical-format team + invalid body → 404 (not 422) with no `error.field`; locked + invalid body → 409 (not 422) with no `error.field`; unlocked + missing `voteType` → 422 with `error.field: "voteType"`. The 404 and 422 cases also assert no `topic.custom_added` row is written (BA M5, M7)
- [x] 2.5 Timing floor is applied on admin → 404, admin → 409, and both 403 branches of the new wrapper (engineer, `engineering_manager` **and** a no-`users`-row caller → `NOT_A_FACILITATOR`, since `grant === null` is a separate return in the shared helper; member-facilitator → `FACILITATOR_IS_TEAM_MEMBER`)
- [x] 2.6 Engineer, EM and no-`users`-row callers → 403 `NOT_A_FACILITATOR` with the new copy, each tested **against a locked team** (403, not 409; lock state not revealed) and **against a nonexistent team with an invalid body** (403, not 404, no `error.field`). Member-facilitator → 403 `FACILITATOR_IS_TEAM_MEMBER` with unchanged copy (BA M4)
- [x] 2.7 Real-DB integration test (house `skipIf(!dbUp)` / `REQUIRE_DB` pattern): an admin adds a topic while a room is open → the open session's `session_topics` (rows, topics and order) are unchanged, **and** the team's active topic configuration (TOPIC-002 `active`, or the snapshot of the next room opened) includes the new topic (BA M3)

## 3. Comments and TOPIC-007 non-regression

- [x] 3.1 Leave the behaviour and signature of `checkStandingFacilitatorAuthorization` and the TOPIC-007 call site untouched (comments only, below), and verify by grep that TOPIC-007 is now its only caller. Do not alter the substance of the TOPIC-007 "Do not 'fix' this for consistency" comment; only drop its now-stale "(TOPIC-003's)" parenthetical (~L1472) and list TOPIC-003 among the admin-admitting siblings it contrasts with. Also correct the comments that still describe TOPIC-003 as facilitator-only: the "Task 3.1 — standing-facilitator authorization check" block (~L58–72, now TOPIC-007 / FR-8.7 only), the "TOPIC-003 passes its original strings unchanged" note (~L79), the "for this endpoint's cascade" note inside `checkStandingFacilitatorAuthorization` (~L99–103), and the archive (~L352–358) and reorder (~L492–496) wrapper headers that cite "checkStandingFacilitatorAuthorization (TOPIC-003, above)" — these become TOPIC-007 (engineer review S2). Locate each by its quoted text (architect A6)
- [x] 3.2 Update the header comment of `packages/backend/src/auth/standing-facilitator-access-helper.ts` so it lists TOPIC-003 among the callers of `checkStandingFacilitatorOrAdminAuthorization` and removes "stays that way … deliberately deferred"
- [x] 3.3 Run the TOPIC-007 annotation suites (`topic-annotation.test.ts`, `topic-annotation-integration.test.ts`, `TopicManagementPage.annotation.test.tsx`) **without modifying them**. The admin PUT → 403 with "Only a facilitator can edit a team's topic definition." must still pass

## 4. Frontend

- [x] 4.1 Make the following changes as **one task** (architect A3); typecheck and the frontend unit lane are green at its end:
  - In `packages/frontend/src/pages/addCustomTopic.ts`, reduce `ActiveEmptyStateVariant` to three message/structure variants (locked; unlocked with archived; unlocked without archived) and drop `canAddTopics` from `activeEmptyStateVariant`. The variant no longer encodes add permission (design D4).
  - In `packages/frontend/src/components/ActiveTopicsEmptyState.tsx`, remove the variant 3/5 branches, the "Topics can't be added from this account yet." copy and their header-table rows (and the "Remove them in the #176 fix" note). Add a **required** `addAllowed: boolean` prop; "Add custom topic" renders only when `addAllowed` is `true` and the variant is not locked. "Show archived topics (n)" depends on the variant alone. Update the header comment to say the add action is gated by `addAllowed`, not the variant (design D4, engineer review B1).
  - Update the `TopicManagementPage.tsx` call sites for the new `activeEmptyStateVariant` signature, and pass the page's existing `addAllowed` (`!data.isCustomizationLocked && canAddTopics`, where `canAddTopics = data.canAddTopics === true`) to `ActiveTopicsEmptyState`, so the heading trigger and the empty-state action share one gate. The heading-trigger gating and the "`=== true` … fails closed" comment are unchanged.
  - Update `packages/frontend/src/pages/__tests__/addCustomTopic.test.ts` (the direct unit test of `activeEmptyStateVariant`) for the three-variant signature.
- [x] 4.2 In `packages/frontend/src/components/AddCustomTopicForm.tsx`, change the description helper text "…for your team." to "…for this team." and update `TopicManagementPage.add.test.tsx` (design D7)
- [x] 4.3 In `packages/frontend/src/pages/__tests__/TopicManagementPage.empty.test.tsx`, **replace** the row-3/row-5 admin tests with positive admin tests, one per spec scenario (BA M1, M2, M6):
  - (a1) admin, unlocked, no active topics, 3 archived → "Show archived topics (3)" and "Add custom topic" both shown
  - (a2) admin, unlocked, no active topics, nothing archived → "Add custom topic" shown, no "Show archived topics" action
  - (b) admin, unlocked, active topics → heading trigger shown
  - (c) admin, locked, no active topics → locked variant, no "Show archived topics" and no add action (do not assert the locked message text for admins; that copy is owned by #200)
  - (d) admin, unlocked, empty state → opens the form, submits a valid topic, mocked `201` + refetch → the new row appears and the empty state is gone (modelled on the facilitator equivalent)
  - (e) **missing-flag drift guard**, parameterized over `canAddTopics` absent **and** explicit `false` (the rollback case in design's Migration Plan): unlocked team, no active topics, 2 archived topics → message "This team has no active topics.", "Show archived topics (2)" shown, no "Add custom topic" anywhere on the page (replaces the old row-5 test)
  - (f) admin, locked, with active topics → no "Add custom topic" anywhere on the page, lock notice shown
  - Also add a component test of `ActiveTopicsEmptyState` with `addAllowed={false}` on each unlocked variant → no "Add custom topic" (the direct guard for engineer review B1)

## 5. Contract and requirements prose

- [x] 5.1 `requirements/design/REST API Contract.md`: in TOPIC-002's authorization parenthetical, stop listing TOPIC-003 as excluding admins; remove "TEMPORARY" from the `canAddTopics` description (true for every admitted caller); add the admin arm to the TOPIC-003 Authorization line; update the 403 `NOT_A_FACILITATOR` row wording; update TOPIC-004's note that TOPIC-003 is unaffected. **Role matrix (~L3031–3033, BA B1):** the TOPIC-002 row drops "`canAddTopics` false for admins (temporary, pending #176)"; the TOPIC-003 row's App Admin column becomes `Yes` and its Notes become "Facilitator (non-member) or admin (any team, per FR-8.2); code: `checkStandingFacilitatorOrAdminAuthorization`; customization lock enforced". Keep TOPIC-003 as its own row (its code reference differs from TOPIC-004 to TOPIC-006's note)
- [x] 5.2 `requirements/use cases/08 - Topic Management - Use Cases.md`, "Use Case: Add Custom Topic", mirroring the Reorder use case's form. Actor → "Facilitator (or Application Administrator, per FR-8.2)". The Preconditions' auth and standing-facilitator bullets add "or the actor is an Application Administrator (any team, regardless of membership)". The last Acceptance Criterion becomes: available to a standing Facilitator (non-member) and an Application Administrator, not to Engineers, Engineering Managers, or a member-Facilitator. The Goal stays facilitator-voiced. Add one sentence under Summary: "An Application Administrator follows the same flow with the same validation and lock rules." Add to the use case's Notes: "Engineering Managers are excluded from topic writes; FR-8.2 names only the facilitator and the Application Administrator."
- [x] 5.3 `requirements/design/REST API Contract - Validation Report.md`: append "(admin branch: #176)" to the FR-8.2 row (design D9)

## 6. Cleanup, verification and follow-ups

- [x] 6.1 Grep `packages/`, `requirements/` and this change's `specs/` deltas for leftover "#176", "temporar" and "Topics can't be added from this account yet" references, and resolve each one. **Do not edit `openspec/specs/`**: the living specs still contain these strings by design until the deltas merge at archive (6.7). Then run `grep -n "TOPIC-003" packages/backend/src/routes/topics.ts` and check every hit that describes authorization still reads true (the 3.1 list is the expected set; "reused unchanged from TOPIC-003" notes about the 404/409 steps are still correct) (architect A4, BA B1)
- [x] 6.2 Prepare the human follow-up work without doing it (architect B1): check that `follow-up-issues.md` has a ready-to-file draft for each of F1–F7. Draft a PR-description section with placeholders `F1: #____`, `F2: #____`, and one "IdP role-assignment administrator: ____" line per OIDC provider configured for each deployment environment (enumerate from deployment config such as `OIDC_ISSUER`; Entra is primary but not the only supported provider). Mark F1, F2 and the IdP-owner lines as merge gates. Do not invent issue numbers or names
- [x] 6.3 Final verification, after all edits above (architect A5): run the backend and frontend test suites, typecheck and lint, then `openspec validate topic-003-admin-authorization --strict`
- [x] 6.4 [HUMAN] **Merge gate.** File F1 (member-admin across TOPIC-003/004/005/006) and F2 (added-by display, on the milestone after this one) from `follow-up-issues.md`; record their numbers here (F1: #208, F2: #201) and in the PR description *(Done 2026-10-02: F1 filed as #208; F2 was already tracked as #201, so the admin context was added there as a comment instead of filing a duplicate)*
- [ ] 6.5 [HUMAN] **Merge gate.** Name in the PR description the IdP-side administrator of `application_admin` role assignment for **each** configured OIDC provider (design Risks; security review condition 1)
- [x] 6.6 [HUMAN] Not merge-gating. File F3 (next-room notice); post F4 as a comment on #200 about the admin viewer, citing FR-8.6; file F5 and F6 with the identity/session backlog and F7 with ops/monitoring *(Done 2026-10-02: F3 #209, F4 posted on #200, F5 #210, F6 #211, F7 #212)*
- [x] 6.7 [AT ARCHIVE] *(Done at sync, 2026-10-01: the deltas were merged into `openspec/specs/` by `opsx:sync`, so the living-spec prose was updated in the same pass and both grep checks pass. At archive, re-run the two greps only; the delta re-merge is idempotent.)* Owned by whoever runs `openspec archive` for this change, in the same PR's archive commit (BA M9). After the deltas merge, update the non-requirement prose of the living specs that the deltas cannot carry: the Purpose and "Implementation note — files" of `openspec/specs/add-custom-topic/spec.md` (name the administrator arm and `checkAddCustomTopicAuthorization` → `checkStandingFacilitatorOrAdminAuthorization` instead of `evaluateStandingFacilitatorAccess`), and the "Implementation note — `canAddTopics`" of `openspec/specs/topic-customization-lock/spec.md` (new expression; drop the "#176 fix must change" sentence). Checks: `grep -n "standing, org-wide facilitator (one not" openspec/specs/add-custom-topic/spec.md` returns no hit without the administrator clause beside it, and `grep -rn "#176\|temporar\|Topics can't be added from this account yet" openspec/specs/` returns no stale hit (architect A4, B2)

## Task review response

Responder: Marcus Oyelaran (Full Stack Engineer). No spec delta changes: neither review found a spec gap; all findings were task-level.

| Finding | Disposition |
|---|---|
| Architect A1 (1.2 deletes a constant still in use) | Accepted, via the alternative the review offered: wrapper, call-site switch and constant deletion are one task (1.1), deletion ordered after the switch. |
| Architect A2 (red window 1.3 → 3.9) | Accepted as an atomic task, not four slices. Slice 1 (unwired wrapper with its own 403 tests) would need exporting a private helper just to test it; testing the 403 branches through the route after the flip (2.5, 2.6) exercises the real path. Endpoint, flag, shared doc, `content.test.ts`, old-copy assertions and parity test are 1.1; admin behaviour tests are section 2; comments and TOPIC-007 non-regression are section 3. "Unit lane green" and "never edit the parity test except as 1.1 says" are stated conventions. |
| Architect A3 (frontend red window) | Accepted. Old 4.1–4.3 plus `addCustomTopic.test.ts` are now 4.1. |
| Architect A4 (6.2 would edit living specs) | Accepted. 6.1 excludes `openspec/specs/`; the living-spec grep is in 6.7 [AT ARCHIVE]. |
| Architect A5 (verification before last edits) | Accepted. Verification is 6.3, after the cleanup grep and PR prep. |
| Architect A6 (stale line numbers) | Accepted. Conventions and 3.1 say to locate by quoted text. |
| Architect B1 (6.3 mixes agent and human work) | Accepted. 6.2 agent prep (placeholders only, providers enumerated from config); 6.4, 6.5 [HUMAN] merge gates; 6.6 [HUMAN] non-gating. |
| Architect B2 (6.4 is post-archive) | Accepted. 6.7 [AT ARCHIVE]. |
| Architect B3 (3.7 real-DB pattern) | Accepted. In 2.7 and Conventions. |
| Architect legend | Accepted. [HUMAN] / [AT ARCHIVE] legend at top, copied from `2026-10-01-session-topics-snapshot-at-creation`. |
| BA B1 (role matrix missing from 5.1) | Accepted. Role-matrix rows added to 5.1; 6.1 grep widened to `requirements/`. TOPIC-003 kept as its own row rather than merged into TOPIC-004 to 006, because its code reference differs. |
| BA M1 (admin empty-state scenarios collapsed) | Accepted. 4.3 (a1) 3 archived, (a2) none archived. |
| BA M2 (admin, locked, active topics) | Accepted. 4.3 (f). |
| BA M3 (next-room clause of open-room scenario) | Accepted. 2.7 asserts the new topic is in the active configuration. |
| BA M4 (EM/no-row against locked and nonexistent teams) | Accepted. 2.6. |
| BA M5 (no success row on admin 404/422) | Accepted. 2.4. |
| BA M6 (fail-closed on explicit `false`) | Accepted, both options: 4.3 (e) parameterized over absent and `false`, plus an `ActiveTopicsEmptyState` `addAllowed={false}` component test. |
| BA M7 (no `error.field` on admin 404/409) | Accepted. 2.4. |
| BA M8 (admin TOPIC-002 lists present) | Accepted. 1.1 `content.test.ts` bullet. |
| BA M9 (owner of post-archive task) | Accepted. 6.7 names the archive runner, same PR's archive commit. |
