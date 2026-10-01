Target: NEW issue

## TOPIC-001 (`GET /api/v1/teams/:teamId/topics`): authorization and response shape disagree with the contract

Found during topic-annotation (#53) design review (security B1, engineer M1). Not fixed there, because it changes a shipped endpoint's authorization.

**1. Engineering managers get `200`.** The handler (`packages/backend/src/routes/content.ts`, the TOPIC-001 handler around lines 459–500) denies only a null grant and `path === "admin"`. An engineering-manager member is served the team's topic list, and `content.test.ts` (the "engineering_manager grant" test near line 349) asserts that `200`. The REST API Contract's access matrix says engineering managers are denied.

**2. The access-matrix row is wrong in more than one cell.** It lists application admins as "Yes", but the code denies them (`denyAdminContentAccess`). The "TOPIC-002 to TOPIC-007" row was also wrong for the facilitator-only TOPIC-003. topic-annotation split that row for TOPIC-003 and TOPIC-007 only.

**3. Casing drift.** TOPIC-001 returns raw snake_case rows (`vote_type`, `display_order`) where the contract specifies camelCase.

**Why it matters now:** the contract lists `teamAnnotation` on TOPIC-001. topic-annotation deliberately did **not** add it ("not returned; deferred until a consumer exists"). With EM access as it is today, adding it would hand a team's free-text definitions to managers and break the no-manager rule.

**Proposed:** reconcile the access row, the code, and the casing in **one** reviewed change. Deny engineering managers on TOPIC-001 (update the test that asserts `200`), confirm admin denial is intended and fix the matrix, and remap the response to the contract shape once its first real consumer exists. **Deny EMs before TOPIC-001 ever returns `teamAnnotation`.**
