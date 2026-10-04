# Design Review: Engineer (Marcus Oyelaran)

**Change:** 238-facilitator-reporting-chain-decision
**Reviewed:** `design.md` (D1–D5), `proposal.md` (with Appendix A and Appendix B, the follow-up issue draft)
**Checked against:** `packages/backend/src/auth/account-resolver.ts`, `routes/auth.ts` (callback, `/auth/session`), `routes/facilitator-sessions.ts` (draft create, `/advance`), `auth/audit-logger.ts`, `auth/session-store.ts`, `auth/team-content-access-helper.ts`, migrations 2, 8, 9 and 10, `packages/shared/src/types/auth.ts`, `frontend/src/App.tsx`, `frontend/src/pages/DraftSessionHost.tsx`, and #235's unmerged `design.md` and `specs/first-access/spec.md` (read-only scratchpad copy).
**Binding:** decision-log rows 1–13. I don't reopen any of them. Where a finding touches one, the fix stays inside it.

## Verdict

**Approve with conditions.** The documents-only design (D1–D5) is sound, and D2 (no spec delta) is the right call. The follow-up issue in Appendix B is where an engineer will build from, and it is **not implementable as written**. Two ACs depend on things the schema doesn't have or forbids, and the notice has no defined server-side state. All of these can be fixed in the Appendix B text, with no change to any decision. F1–F3 must be fixed before the orchestrator files #NNN. Once filed, the issue's scope freeze makes them much harder to fix.

---

## Must fix before #NNN is filed

### F1. Under row 11, "another facilitator recreates the draft" is blocked by `sessions_team_active_unique`

`migrations/10_sessions_team_active_unique.sql` creates a partial unique index on `sessions(team_id) WHERE status IN ('draft','lobby','pre_session','active','wrap_up')`. A stranded draft therefore holds the team's single non-terminal slot. When another facilitator calls `POST /api/v1/teams/:teamId/sessions/draft`, the INSERT fails with 23505. The handler (`facilitator-sessions.ts` ~l.423) turns that into `409 session_already_exists` pointing at the stranded draft. That facilitator then can't advance it either ("Only the facilitator who created the draft may advance it", ~l.835).

The 24-hour draft expiry is **lazy and read-side only**. `team-content-access-helper.ts` Path 3b stops content access, but the row stays `status = 'draft'` for good. The code comment at `facilitator-sessions.ts:252` confirms that no cleanup job exists. No route moves a draft to `abandoned`.

Result: the team is wedged until someone edits the database. "Recreate" can't happen without first retiring the stranded draft. (The same gap already exists for #235 Decision 12 revocations. #238 makes it a stated mechanism, so it now has to work.)

**Fix, staying inside row 11 (no reassignment, no new feature):** Appendix B should say how the stranded draft is retired before the recreation. The smallest option is a documented operator step: one `UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE id = $1 AND status = 'draft'`, plus a hand-written `audit_log` row (operation such as `session.draft_abandoned_by_operator`, actor = operator-recorded). Put it in:
- the pre-launch draft-check step, which then is "read-only check, then one targeted write per hit", not purely read-only. Say so.
- the docs troubleshooting entry, for conflicts that appear after launch.

If the user would rather this be a code path, that's a scope question for the user, not something to slip in during apply. Either way, the issue must not reach apply with "recreate" unachievable. Add an AC: *after the stranded draft is retired by the documented step, another facilitator's `POST …/sessions/draft` for that team succeeds.*

### F2. The draft list's "scheduled date" doesn't exist, and the column is `status`, not `state`

- `sessions` (migration 2 plus 9, 13, 14 and 20) has `created_at`, `room_opened_at`, `started_at`, … and no scheduled date. Drafts are inserted with `(team_id, facilitator_id, status, is_first_session, session_number)` only. AC 7 ("lists every stranded draft (team name, scheduled date)") and the Scope bullet ("scheduled date (not created date)") can't be met without a migration and a draft-creation UI change. The scope freeze rules both out.
- Appendix B's notice bullet says `state = 'draft'`. The column is `sessions.status` (`session_status` enum). The pre-launch query wording should match too.

**Fix:** list team name and `created_at`, labelled "created", or team name only. This isn't a decision-log row, so the BA or Facilitator can choose without reopening anything. Use `status` throughout.

### F3. The notice has no defined server-side state: where the flag lives, how it reaches the client, how dismissal works

Appendix B says "return a conflict flag on `ResolvedUser`". That flag only lives for the duration of the callback request. The ACs need it later:
- on the *first non-session page* after sign-in. With `returnTo` (re-auth return path), that page can be several navigations later.
- at room-open (AC 8, "the user's last sign-in recorded a conflict").
- until it is dismissed, then gone until the next sign-in.

Nothing says where that state is held. The tempting shortcut for AC 8 is to query `audit_log` for the user's latest conflict row at room-open. That makes the audit trail an input to request handling. I'd block that: it couples authorization-path copy to an append-only compliance table, and it reads the wrong scope (user-wide, across devices) for a per-sign-in fact.

**Fix (pin it in Appendix B):**
- At callback, after `regenerate()`, set `roleConflict: { applied: "engineering_manager" | "application_admin" }` on the Redis session blob (`SessionData` in `session-store.ts`). "Shown on every sign-in, hidden after dismissal until the next sign-in" then falls out of `regenerate()` for free.
- A new `GET /auth/role-conflict-notice` returns `null` or `{ adminCase, strandedDrafts: [{ sessionId, teamName, createdAt }], contactText | null }`, typed in `packages/shared`. Keep it a **separate** endpoint, not a field on `/auth/session`, so a failed draft-list query can't break the call that gates the whole SPA. The error path is that the notice is skipped and the failure logged, nothing else.
- `POST /auth/role-conflict-notice/dismiss` clears the blob field. Dismissal is server-side, so a second tab doesn't show it again.
- AC 8 reads `session.roleConflict`, never `audit_log`. Reword it to "the current app session's sign-in recorded a conflict". Two browsers with different sign-ins can then legitimately show different 403 copy. Say that this is accepted.
- Justify the blob field against the `AuthSession` doc comment ("never cached in the Redis session blob"). That rule is about *authorization* signals. This is a sign-in *event* fact and grants nothing, because room-open still decides on live `global_role`. One sentence in the issue prevents a reviewer from flagging it as a pattern violation.

---

## Should fix (in the Appendix B / A.3 text)

### F4. D3 `outrankedRoles` is ambiguous for admin + pair

#235 D3 pins `outrankedRoles` for `["application_admin","facilitator","engineering_manager"]` as `["facilitator","engineering_manager"]`, and a #235 test will assert it. Appendix B's rule is "discard `facilitator`, then apply precedence". If D3 is computed after the discard, the value becomes `["engineering_manager"]`, the #235 test breaks, and nothing says which is right. **Fix:** state it. My recommendation is to compute D3 from the **pre-discard** allowlisted set, so the log still shows that `facilitator` was sent. Then name the #235 test that changes, or say that it doesn't. AC 5 should assert the exact array.

### F5. A.3 misses two constraints in #235's docs SHALL

#235 `first-access`, "Deployment documentation describes the role claim":
- says the section "SHALL contain **exactly** these items, plus the manager warning". Appendix B adds a conflict troubleshooting entry and an "alert-suitable event" mention. Both break "exactly" unless the item list is amended in the same PR. Add this to the A.3 "also amend" list.
- pins the warning to "the manager warning in **proposal.md**". When #NNN lands, #235 will be archived, and A.3 then asks the PR to edit an archived change's `proposal.md` Constraints. **Fix:** the #NNN delta MODIFIES the requirement so the warning text is inlined in the spec (single source), and the archived proposal stays untouched. The scenario then compares docs to spec, not docs to a historical proposal.

### F6. Put the conflict INSERT where #235 put the others

#235 D5 moves the transactional audit INSERTs into `writeAccountResolutionAuditRow` in `auth/account-resolution-audit.ts`, which has type-only imports and is called by both `routes/auth.ts` and the real-Postgres integration test. Appendix B's Scope says "`routes/auth.ts`: … inside the same `withAuditTransaction`". If the INSERT goes inline in the route, the integration test can't reach it, and AC 3 and AC 6 lose their honest test. **Fix:** "the conflict INSERT is added to `writeAccountResolutionAuditRow`, after the `first_access_created` or `role_claim_mapped` INSERT. The post-commit `emitAuditEvent` stays in `routes/auth.ts`." Also state the row's columns, which the metadata list doesn't cover: `actor_global_role` = applied role, `team_id` NULL, `target_user_id` NULL.

The resolver change also needs its shape stated. #235 F7 narrows `mapRoleClaimToGlobalRole` to return `UserRole`. Detection needs a richer result, for example `{ role, roleConflict }`, threaded into `ResolvedUser.roleConflict: boolean`. Name it, so two engineers don't invent two shapes.

### F7. "Live-session route" should be defined by path, not by session state, and `reauthRequiredHostParity` is the wrong test to extend

The frontend routes are per session, not per state: `/session/:id`, `/session/:id/live` and `/session/:id/facilitator` span lobby through wrap-up, and `/team/:teamId/session/:sessionId` is `DraftSessionHost`. "Lobby, pre-session, active, reveal and wrap-up routes" doesn't map onto `App.tsx`.

**Fix:** define the suppressed set as path patterns (`/session/*` and `/team/:teamId/session/*`, including the draft host, where the conflicted user gets the AC 8 403 copy anyway). Implement it as one exported `isLiveSessionPath(pathname)`, unit-tested against every `App.tsx` route.

`reauthRequiredHostParity.test.tsx` asserts byte-identical output of two connection hosts. Absence of a notice is a different property, and adding it there muddies the parity test. Use a dedicated test that mounts the app shell at a `returnTo` live path, asserts the notice is absent, then navigates to `/` and asserts it renders.

### F8. Reuse the existing contact config

`config.ts` already has `APPLICATION_ADMIN_CONTACT_EMAIL`, exposed via `teams.ts` as `applicationAdminContactEmail` and typed in `shared/src/types/team.ts`. Appendix B's "deployment-configured contact text" reads as a new setting. Unless the Facilitator copy review needs free text, reuse the existing value with the generic fallback when it's unset. That's one less config surface and one less docs row. If free text really is needed, say: new optional env var, length-capped at startup, rendered as a React text node (never `dangerouslySetInnerHTML`).

### F9. Spec-landing order: "#235 merged" is not enough

D2 says the follow-up "lands them as a delta against the #235 requirement once #235 is merged". The delta only syncs cleanly once #235 is **archived and synced** into `openspec/specs/first-access` and `auth-error-handling`. Merged-but-unarchived produces exactly the MODIFY-a-missing-requirement failure that D2 describes. **Fix:** change "Blocked by: #235" in Appendix B to "#235 merged **and archived**", or say that #NNN's archive must follow #235's.

---

## Minor

- **M1. Missing rollback note in Appendix B.** Rolling back #NNN returns the pair to `facilitator` at the next sign-in. Conflict rows stay, and the room-open copy reverts. That's fine, but say so, as #235 does.
- **M2. Pre-launch query clause (a)** (`global_role = 'engineering_manager'`) also catches facilitators legitimately promoted to manager. That's correct and wanted (row 11 treats them the same), but say so, so the operator doesn't treat the hits as false positives.
- **M3. Event inventory in `docs/deployment.md`.** The Logging section lists the transactional `auth.*` group by name. The new operation joins that list, and `AuditEventName` gets a comment block in the house style. Add both to the Scope bullet.
- **M4. Simulator persona.** Adding a both-roles persona to `docker/oidc/accounts.js` and `DEV_LOGIN_OPTIONS` shifts persona-count assertions (#235 F6 hit `interactions.test.js`). List that file in the follow-up's impact.
- **M5. Stale counts.** `design.md` Context says "rows 1–11", and the log now has 13. Proposal Open item 2 is still listed as open, but row 13 resolved it ("No — row 10 attestation only"). Move it to "Closed since exploration".
- **M6. `openspec validate --strict` with zero deltas.** OpenSpec's change validator expects at least one delta and will likely flag this change if anyone runs it. The precedent (`2026-09-29-join-link-use-case-sync`) archived without one. Note in tasks.md that the archive step is documents-only (`--skip-specs` or equivalent), so the next operator isn't surprised.

---

## D2 (no spec delta) assessment

Sound. I checked `openspec/specs/first-access` and `oidc-auth` on `main`: no precedence requirement exists, so a MODIFIED delta has nothing to attach to, and an ADDED one would describe unbuilt behaviour. A "decision recorded" requirement isn't system behaviour. The precedent applies. D2 needs two clarifications: F9 (archive order, not merge order) and F5 (where the warning text's single source should live after #235 is archived). Neither changes the conclusion.

## What's good

- The rule table in Appendix B is directly test-shaped. AC 1 ("every row is a passing resolver test") is the right contract.
- Transactional coupling of the conflict row with the existing `withAuditTransaction`/`AuditWriteError` path, and the explicit "this is not rejected option (c)" line, prevent the most likely misreading.
- Room-open keeps deciding on live `global_role`; the conflict flag only changes copy. Authorization stays where it is. `DraftSessionHost` already renders the server's 403 message, so AC 8 needs no frontend change beyond the test.
- The structured-log field set equals the audit metadata set, and the explicit no-raw-claims assertion (AC 4), follow #235 S4 correctly.
