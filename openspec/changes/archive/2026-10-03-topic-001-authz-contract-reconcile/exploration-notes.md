# Exploration Notes: topic-001-authz-contract-reconcile (GitHub #187)

**Explorer:** Devon Calloway (Internal Champion, founding advisor)
**Mode:** opsx:explore, non-interactive. Judgment calls are marked **[Call]**. Section 8 records how each open question was resolved after review.
**Date:** 2026-10-02 (revised the same day after Facilitator (Priya Nair) and BA (Marcus Delgado) reviews; see "Feedback disposition")

---

## 1. Why I care

This is my kind of bug. Nothing is broken for users today, and nobody would notice it in a demo. But one endpoint quietly gives managers access that the contract says they should not have. The next feature on the roadmap (`teamAnnotation` on TOPIC-001) would turn that gap into a real leak of the team's own words to its manager.

The no-manager rule is not only about voting. It is about engineers knowing that the space where they describe their team's health belongs to them. The team definition ("Our team's definition", FR-8.7) is that kind of space: free text, written in the room, in the team's own words. If a manager can read it, people will write it for the manager. Then it stops being the team's definition.

So my position is simple. **Close the EM path now, while nothing depends on it.** It is the cheapest moment we will ever get.

This is not a new policy. Three documents already agree that EMs get no topic configuration: the use case "View Active Topic Configuration", Out of Scope (`requirements/use cases/08 - Topic Management - Use Cases.md` line 487); the `team-content-access` content matrix (EM column "None", spec line 122); and BRD FR-9.5 / Constraint 2 (BRD line 648), which lists what EMs may see and leaves topic configuration off. The code is the outlier. Nobody needs VP sign-off to make the code match.

**No user-visible change.** TOPIC-001 has no frontend caller (section 4). Topic Management reads TOPIC-002 and the live session reads the snapshot. No facilitator, participant, or EM workflow changes on the day this ships. The proposal should say this plainly so reviewers do not hunt for a UX regression that cannot exist.

---

## 2. What the code actually does today

### TOPIC-001 handler: `packages/backend/src/routes/content.ts` (about lines 461–526)

```
GET /api/v1/teams/:teamId/topics
  │
  ├─ non-canonical teamId ───────────────► 404 TEAM_NOT_FOUND (timing floor)   (#184)
  ├─ evaluateTeamAccess(userId, teamId)
  │     null ────────────────────────────► denyNullGrant → 403 (cross-team facilitator message or generic)
  │     path=admin ──────────────────────► denyAdminContentAccess → 403 + audit_log "admin.session_content_denied"
  │     path=member role=participant ────► 200
  │     path=member role=engineering_mgr ► 200   ◄── THE BUG
  │     path=facilitator (any grant status) ► 200
  └─ SELECT id, name, prompt, vote_type, display_order, status  (raw rows, snake_case)
     + isCustomizationLocked (camelCase, via hasCompletedFirstSession)
```

The response body is `{ teamId, topics: result.rows, isCustomizationLocked }`. The topic rows are raw DB rows (`id`, `vote_type`, `display_order`, `status`).

### The grant model: `packages/backend/src/auth/team-content-access-helper.ts`

`evaluateTeamAccess` returns a `TeamAccessGrant` discriminated union (`packages/shared/src/types/team-content-access.ts`). It checks these paths in order:

| Path | Condition | Grant |
|---|---|---|
| 0 | `global_role = application_admin` | `{ path: "admin" }` |
| 1 | active membership `role = participant` | `{ path: "member", role: "participant" }` |
| 2 | active membership `role = engineering_manager` **AND** `global_role = engineering_manager` | `{ path: "member", role: "engineering_manager" }` |
| 2' | EM membership but global_role does not match | degrades to `role: "participant"` + log event `team.access_grant_mismatch` |
| 3 | facilitator of a lobby/pre_session/active/wrap_up session, or a draft under 24h old, or a complete session inside the grace window | `{ path: "facilitator", ... }` |

How "EM-ness" is decided: the only grant that says `role: "engineering_manager"` needs **both** `users.global_role` and `team_memberships.role` to be `engineering_manager` (restrict-team-005-em-promotion, Decision A).

**Verified after BA review (helper lines 165-187):** the path 2' grant is `{ path: "member", role: "participant", teamId, actorGlobalRole: global_role }`. It **drops the membership role.** `actorGlobalRole` is the non-EM global role, so the grant is byte-for-byte indistinguishable from an ordinary participant grant. The only trace is the `team.access_grant_mismatch` log event. My original claim that OR semantics "needs no new query" was wrong for this case. It holds only for the reverse case (global EM with a participant membership), where `actorGlobalRole === "engineering_manager"` is on the grant.

Two more facts from the code:
- Path 3 is reached only when the caller has **no** active membership row on the team. Facilitator grants carry `actorGlobalRole` read live from `users`.
- Session creation requires `global_role = 'facilitator'` (`facilitator-sessions.ts` lines 318, 547). So a facilitator grant with `actorGlobalRole = engineering_manager` cannot be created through the app. It can only arise if the IdP-sourced global role changes to EM during the facilitator's window.

### How other endpoints deny EMs (is there a helper to reuse?)

**No shared "deny EM" helper exists.** Each endpoint uses its own pattern:

- `routes/em-views.ts`: an allow-list. `grant === null || grant.path !== "member" || grant.role !== "engineering_manager"` → 403. This is the inverse of what we need.
- `routes/sessions.ts:378-391` (vote lock-in): checks the raw columns with **OR** semantics (`global_role === "engineering_manager" || membership_role === "engineering_manager"`). This is stricter than the grant model.
- `routes/action-items.ts:548`: `membershipRow.role !== "participant"`. This is an allow-list on the raw membership row.
- `content.ts` itself already branches on `grant.path === "member" && grant.role === "engineering_manager"` for serialization (lines 844, 974). That gives us a ready-made predicate shape.

**[Call, revised]** The rule is stated in the spec as an allow-list (section 8, Q1), not as a coding preference. TOPIC-001 returns 200 only to a non-EM participant member or a non-EM eligible facilitator. Every other grant, including any future grant variant, gets 403. The deny-list snippet `grant.path === "member" && grant.role === "engineering_manager"` is **not sufficient** on its own, because it misses both mismatch states. The mechanism for detecting path 2' (an additive field on the grant, such as `membershipRole`, or a second read in the handler) is the architect's choice. My lean is the additive grant field, since it costs no query and other handlers can ignore it.

---

## 3. What the requirements say (exact current wording)

### REST API Contract: TOPIC-001 section (`requirements/design/REST API Contract.md`, about lines 535–596)

> **Authorization:** One of:
> - Active `participant` member of the team, OR
> - `facilitator` with an active session for the team
>
> `engineering_manager` role does not grant access to the topic configuration.

The TOPIC-001 prose **already denies EMs and does not list admins.** The prose is right and the code is wrong.

Note on facilitator wording: the contract says "facilitator with an active session", but the grant also admits a draft under 24h and the post-complete grace window. This change's spec text refers to "an eligible session facilitator as defined by `evaluateTeamAccess` / `team-content-access`" and does not restate the window. Aligning the contract prose is a follow-up (see "Follow-ups").

The response shape in the contract is camelCase: `topicId, name, prompt, voteType, displayOrder, isDefault, firstSessionDescription, createdAt, updatedAt`, plus top-level `teamId` and `isCustomizationLocked`. A comment says `teamAnnotation` is "NOT returned; deferred until a consumer exists", with the Decision 8 warning about EMs. The error table lists `404 Not Found`, "Team does not exist". In practice an unauthorized caller always gets 403 (authorization-before-lookup), so the 404 row describes only the malformed-id case added by #184.

### REST API Contract: Appendix B, Authorization Matrix (about line 3030)

```
| TOPIC-001 | Own team (read) | Teams with active session | No | Yes | |
```

- **Engineering Manager column: "No".** This is correct. The issue's point 1 is a code-vs-contract gap, not a matrix error.
- **App Admin column: "Yes".** This is wrong against the code (403 + audit).
- **The TOPIC-002 to TOPIC-007 split described in issue point 2 is already done.** The matrix now has separate rows for TOPIC-002, TOPIC-003 (admin "Yes", per #176), "TOPIC-004 to TOPIC-006", and TOPIC-007 (admin "No"). The issue text is stale here. Only the TOPIC-001 admin cell is still wrong. TOPIC-003 is also no longer facilitator-only (#176 admitted admins), so the issue's phrase "facilitator-only TOPIC-003" is outdated.

### Living spec: `openspec/specs/team-content-access/spec.md` (content-type access matrix, line 122)

```
| Topic configuration | Read-only | Read/Write during session setup | None | Read-only (metadata, no session data) |
```

The same spec, under "Application Admin access is limited to administrative data", lists "Topic configuration metadata" as an endpoint category **admins may access**. The archived design (`2026-07-07-enforce-access-control-on-team-content/design.md`, Decision 2) says the same thing. Task 5.10 then applied a blanket "admin → 403" to every handler in `content.ts`, including `/topics` (task 5.4). **So admin denial on TOPIC-001 was a side effect of where the handler lives, not a considered decision.** The audit row it writes (`admin.session_content_denied`, message "Application Admins do not have access to session content.") mislabels topic configuration as session content.

### Other specs that touch TOPIC-001

- `openspec/specs/topic-annotation/spec.md` (about line 232): "TOPIC-001 SHALL NOT include the team annotation... A future change that adds the annotation to TOPIC-001 SHALL first deny engineering managers on that endpoint. This change does not alter TOPIC-001's authorization." This is the tripwire. Our change should update the "admits engineering managers" rationale in this requirement.
- `openspec/specs/topic-customization-lock/spec.md` (line 41): `isCustomizationLocked` is present on every *successful* response "regardless of the requesting user's role". This reads as if every role gets a 200. Reword to: "present on every `200` response, for every caller the endpoint admits (see `team-content-access`). A denied caller receives no lock state." 
- `openspec/specs/session-topic-lifecycle/spec.md` (line 159): in-session display reads the snapshot (`currentTopic.topicAnnotation`), never TOPIC-001.
- `openspec/specs/default-topic-provisioning/spec.md` (line 50): TOPIC-001 must keep serving template-team rows (FR-8.6) to members. An EM of the template team, if one exists, is denied like any other EM. The scenario should say so, so nobody "fixes" `template-team-topic-writes-integration.test.ts` 4.3 by admitting EMs.
- `openspec/specs/reorder-topics/spec.md` (line 23): a scenario asserts a subsequent `GET /topics` reflects the new order. This is still true for authorized callers.
- Use case "View Active Topic Configuration" (`08 - Topic Management - Use Cases.md`): line 487 excludes EMs from topic configuration. Lines 486 and 495 also say engineers see topics only in the session room and do not see the full configuration. That second point conflicts with the contract and `team-content-access`, which admit participants to TOPIC-001. It does not affect this change (participants keep what they have), but it matters for Q2 and Q6 below.
- BRD: FR-1.4 (EM cannot vote; defines the EM as "any user assigned the EM role for a given team"), FR-8.2, FR-8.7, FR-9.5 (EM read-only Trend/History with anonymous distributions). **No BRD line grants EMs topic-configuration access.** EMs already see topic *names* through TREND-001 and SESSION-007/008, which is the sanctioned path, so denying TOPIC-001 does not starve the EM views.

---

## 4. Who calls TOPIC-001 today? (decides whether the camelCase remap is in scope)

**No production consumer.**

- Frontend: the only `fetch(\`/api/v1/teams/${teamId}/topics\`)` in `packages/frontend/src` is the **POST** (TOPIC-003) at `TopicManagementPage.tsx:1351`. The Topic Management screen reads TOPIC-002 (`/topics/all`). There is no GET caller.
- Shared types: `packages/shared/src/types/topic.ts` (lines 18–22) states it outright: "TOPIC-001 ... has no consumer".
- Backend-internal: session-topic snapshotting reads the `topics` table directly, not the HTTP endpoint.
- Docs/scripts: `docs/test-scripts/topic-add-form-hands-on-check.md` references only frontend `/team/:id/topics` routes.
- The only callers are tests:
  - `packages/backend/src/routes/__tests__/content.test.ts`: the lock-flag block (lines 312–391), including **"is present regardless of caller role — engineering_manager grant" (line 357, asserts 200)** and **"does not remap existing snake_case fields to camelCase" (line 371, asserts `vote_type`/`display_order`, no `voteType`)**. Also the R7 no-annotation test (line 815) and the malformed-id table (line 872).
  - `packages/backend/src/routes/__tests__/topic-annotation-integration.test.ts`: **"TOPIC-001 called by an engineering manager returns no annotation fields (security S1)" (about line 519) asserts `statusCode` 200** for an EM. Its comment says "deny EMs on TOPIC-001 first -- do not relax this test." This change is exactly that event. The test should flip to 403 **and keep** the "body does not contain the annotation text" assertion, which is still a valid (stronger) guarantee.
  - `template-team-topic-writes-integration.test.ts` (line 324, scenario 4.3): a member reads the template team's rows. It matches on `topic["id"]`, so a camelCase remap would touch it.

**Implication for the casing remap.** The 2026-09-29 design declined the remap ("Decision 5 addendum", engineer review m1) because it would break "any current consumer". **That reason no longer holds: there is no consumer.** So the remap is non-breaking *today*, and it gets harder the moment a consumer exists. The issue proposes deferring it "once its first real consumer exists". I see two defensible positions:

| Option | For | Against |
|---|---|---|
| A. Authz only now; casing deferred (issue's proposal) | Smallest blast radius; keeps the security fix easy to review; nothing needs the shape | The first consumer inherits snake_case or has to do the remap itself under feature pressure; the drift stays recorded in the contract |
| B. Authz + remap now | Zero consumers means truly non-breaking; one reviewed change to the contract shape, as the issue's title implies; removes the "one camelCase key beside snake_case" oddity | Has to add columns not selected today (`is_default`, `first_session_description`, `created_at`, `updated_at`), rename `id`→`topicId`, and drop `status` (not in contract); more test churn; mixes a cleanup into a security fix |
| C. Retire TOPIC-001 entirely | No consumer, overlaps TOPIC-002/TREND-001; removes a whole surface the no-manager rule has to defend | Contract and specs reference it; FR-8.6 template-read scenario uses it; a larger contract decision than this issue asked for |

**[Call, revised: A]** Defer the remap. See section 8, Q2 and the disposition section for why I moved off my earlier lean toward B. Option C gets one sentence in the proposal as "considered, not chosen", naming both sides of the participant-need question.

---

## 5. The admin cell: deny or admit?

Both answers are safe for the ritual. Admins reading topic configuration exposes no session data, and admins already read the full configuration, including annotations (read-only), through TOPIC-002.

| Option | Effect |
|---|---|
| **Keep admin 403 (fix the matrix to "No")** | Smallest change. Admins have a strictly better endpoint (TOPIC-002). But the specs say admins *may* read topic configuration metadata, so the matrix cell, the TOPIC-001 prose, and the team-content-access spec all need a note: "admins read topic configuration via TOPIC-002; TOPIC-001 denies them". The audit row/message still calls it "session content", which is inaccurate. |
| Admit admins (code matches matrix "Yes") | Matches Decision 2's stated intent. But it opens a new admin read path whose admin-read audit logging (the spec requires a row in the same transaction) does not exist on this handler, and it would need its own test and review. That is scope creep for no consumer. |

**[Call]** Keep the denial and fix the docs. Record in design.md that the denial originated in task 5.10's blanket rule, and that we are now *confirming* it deliberately, with TOPIC-002 as the admin route. Do not rename the audit operation `admin.session_content_denied`, because audit consumers may key on it; `metadata.endpoint` already tells the cases apart. Both reviewers agree.

The message text ("do not have access to session content") is inaccurate for topic configuration, but fixing it means changing the signature of `denyAdminContentAccess`, which every `content.ts` handler shares. That is cosmetic and outside the issue. Follow-up, not this change.

---

## 6. What could go wrong if the design drifts

1. **Denying EMs with a deny-list that misses the mismatch paths.** A user can hold an EM membership row with a non-EM `global_role` (path 2'). Today they are degraded to a participant grant, so they would still get 200. The reverse is reachable today by design, not just by accident: `global_role = engineering_manager` with a *participant* membership row. TEAM-005 is demotion-only and leaves `users.global_role` untouched (`teams.ts` ~line 618), so every demoted EM lands here. Join-link redemption inserts `role = 'participant'` with no `global_role` check (`join-links.ts` ~line 169). The vote endpoint (`sessions.ts` 378-391) treats *either* signal as "is an EM". **For the no-manager rule, OR is the right answer.** See section 8, Q1.
2. **Making it configurable.** No flag, no admin override, no "allow EMs to view topic config" setting. This is a structural rule, like the TEAM-005 promotion block. The spec uses TEAM-005's wording: "unconditionally, for every actor, with no feature flag, configuration setting, or administrative override".
3. **Adding `teamAnnotation` in the same change.** It is tempting, since EMs are now denied. Don't. The annotation still has no consumer, in-session display uses the snapshot, and adding it would widen this change's review surface. The topic-annotation spec says "first deny EMs". It does not say "then immediately add it".
4. **A denial response that reveals something.** An EM is a legitimate team member, so their 403 reveals nothing about whether the team exists. Acceptance conditions:
   - The body is exactly `denyAccess`'s envelope (`category: "forbidden"`, "You do not have access to this team's content.", fresh `correlationId`), with `Cache-Control: no-store`. It is never the cross-team-facilitator message.
   - The same `applyTimingFloor(startTime)` is applied once before send. The EM 403 is not observably faster than a null-grant 403, checked the way `topic-customization-lock`'s timing scenario does.
   - Neither the `topics` SELECT nor `hasCompletedFirstSession` runs. No topic names, annotation text, or `isCustomizationLocked` reach a denied caller.
5. **Forgetting the paired integration test.** If someone "fixes" the unit test but not `topic-annotation-integration.test.ts`, CI fails on the integration workflow. If someone relaxes the no-leak assertion while editing it, we lose the canary. Flip the status, keep the canary.
6. **Leaving the spec rationale stale.** Five places say this endpoint admits engineering managers. After this change they would be false, and a future reader might conclude that the gate for adding the annotation is still closed. Update each to "EMs are denied (#187); annotation still not returned until a consumer exists":
   (a) contract TOPIC-001 `teamAnnotation` comment (~lines 575-578);
   (b) `topic-annotation` spec requirement (~line 232), both "admits engineering managers" and "does not alter TOPIC-001's authorization";
   (c) `content.ts` SQL comment (~line 499);
   (d) `packages/shared/src/types/topic.ts` lines 18-22;
   (e) the S1 comment in `topic-annotation-integration.test.ts`.
   Acceptance: `grep -rn "admits engineering managers"` over `openspec/specs`, `requirements/`, and `packages/` returns nothing.
7. **Locking out the people who should keep access.** A wrong allow-list could deny a real participant or facilitator, and the original plan tested only the EM flips. That is the one way this change could surface in a live room. Regression tests for 200 on participant and facilitator sit next to the flipped EM tests.
8. **A mis-tagged engineer.** Under OR, a real engineer who was tagged EM by mistake (path 2') loses TOPIC-001. They are already blocked from voting by `sessions.ts`, so this adds no new harm. The `team.access_grant_mismatch` log event, which still fires before the denial, is how an admin finds and fixes the mis-tag. Design.md should say so, so support has a path other than "file a ticket".

---

## 7. Proposed scope (for the proposal stage)

### Who keeps access

| Caller | Before | After |
|---|---|---|
| Participant member (own team, non-EM global role) | 200 | 200, unchanged |
| Eligible facilitator (open session, draft under 24h, grace window; global role `facilitator`) | 200 | 200, unchanged |
| EM by membership and global role (path 2) | 200 | **403** |
| EM membership, non-EM global role (path 2') | 200 | **403** |
| Global EM, participant membership (demoted, or joined by link) | 200 | **403** |
| Application Admin | 403 + audit | 403 + audit, confirmed; reads via TOPIC-002 |
| No relationship | 403 | 403, unchanged |

**In:**
- Spec: a new requirement in `team-content-access`, "The active-topics endpoint admits only participant members and eligible session facilitators" (BA's R1, with the facilitator clause from section 8 Q1). Scenarios: path 2 EM denied; path 2' EM denied; global EM with participant membership denied; participant 200; facilitator 200; admin 403 with one audit row; timing; no leak even when the topic is annotated; template-team EM denied.
- Code: the allow-list in the TOPIC-001 handler, plus whatever mechanism the architect picks for path 2'.
- Tests: flip `content.test.ts` line 357 to 403 and assert that neither query ran. Flip `topic-annotation-integration.test.ts` S1 to 403 and **keep** the no-leak body assertion. Add tests for path 2' and global-EM/participant. Add participant and facilitator 200 regression tests.
- Contract, TOPIC-001 section: a "Corrected (#187)" authorization note. A one-line scope boundary like TOPIC-002's: "EM-facing views use TREND-001 / SESSION-007/008; EM flows do not call TOPIC-001." An "As built (#187)" note on the response block (raw snake_case rows; camelCase is the target; the first change that adds a consumer SHALL do the remap). Error table: 404 reworded to "`teamId` is not a canonical UUID (`TEAM_NOT_FOUND`), returned before any query; a well-formed id for a nonexistent team returns 403". 403 reworded to "Caller is not an active participant member or an eligible session facilitator for this team; includes the team's engineering managers and Application Admins". Add TOPIC-001 to the "Path id shape" note (line ~1096).
- Contract matrix line 3030: EM cell "No (403, #187; membership or global role)"; admin cell "No (403 + audit; reads via TOPIC-002)"; Notes "EM denied unconditionally; no override".
- `team-content-access`: note that admins' topic-configuration read is served by TOPIC-002, not TOPIC-001.
- `topic-customization-lock` line 41 and the `topic-annotation` requirement reworded (section 3). The topic-annotation tripwire and the contract "As built" note say the same thing, so one reader finds both.
- Refresh the five stale comments (section 6.6), with the grep acceptance check.
- design.md: record the TOPIC-001-only divergence from Decision E (section 8 Q1), the admin-denial origin (section 5), and the mismatch-log diagnostic (section 6.8).

**Out:** adding `teamAnnotation` to TOPIC-001; the camelCase remap; admitting admins; retiring TOPIC-001; renaming audit operations; changing the admin denial message; changing Decision E's degrade-to-participant on any other endpoint; realigning the contract's facilitator-window prose.

Pipeline: **lightweight**, with a security reviewer. Scenarios for path 2, path 2', global-EM/participant, and no-leak are the security-relevant ones.

---

## 8. Open questions: resolutions

1. **EM definition. Resolved: OR semantics, applied to the actor on every grant path.** A caller is an EM for this rule when their active membership role for the team is `engineering_manager` **or** their `users.global_role` is `engineering_manager`. Grounding: BRD FR-1.4 defines the EM by team assignment, so a path 2' user *is* the team's EM. The global-EM/participant state is reachable by design (demotion, join links). The vote lock-in already uses OR. The app must not call a person "too much of a manager to vote" and "a participant who may read the team's words" at the same time.
   - **Mechanism:** the path 2' grant drops the membership role (verified, section 2), so this needs either an additive field on the grant or a second read. The spec states the behavior; the architect picks the mechanism. The proposal must not claim "no new query".
   - **Facilitator grants:** the predicate looks at the actor, not the path. A facilitator grant is denied only when its live `actorGlobalRole` is `engineering_manager`. The app cannot create that state (session creation requires `global_role = facilitator`); it arises only from IdP drift during the window. Denying it fails closed and does not decide whether EMs may facilitate other teams. SESSION-001 already decides that. A normal facilitator (global role `facilitator`) is never denied, and a test pins that.
   - **Scope:** this is a deliberate divergence from Decision E on TOPIC-001 only, because this is the endpoint whose roadmap carries the team's own free text. Recorded in design.md. Whether the global-EM/participant state should see session history or trends anywhere else is a data-access policy question for the VP of Engineering, so it goes to a follow-up.
2. **Casing remap. Resolved: A (defer), with a tripwire.** Reasons: issue #187 says remap "once its first real consumer exists". The ritual stake here is the EM denial, and a security fix should stay small enough to review cleanly. The remap is not a rename: it adds four columns, renames `id`, and drops `status`, which is a contract-shape decision that deserves its own review. And the "first consumer" argument depends on who that consumer is, which the requirements do not settle (Q6). The risk that the first consumer inherits snake_case is handled by a requirement, not by guessing: the contract's "As built" note and the topic-annotation tripwire both say the first change that adds a TOPIC-001 consumer SHALL do the remap. That consumer will know which fields (`isDefault`, `firstSessionDescription`) it needs.
3. **Admin denial message. Resolved: leave the current text unchanged in this change; the rewording is a follow-up.** Keep the operation name and `metadata.endpoint`.
4. **404 and 403 rows. Resolved: reword both** (section 7), and add TOPIC-001 to the "Path id shape" note.
5. **Spec owner. Resolved: `team-content-access`.** `topic-customization-lock` scopes itself to the lock flag.
6. **Retire TOPIC-001. Resolved: not in this change.** The proposal's "considered, not chosen" line names the open question on both sides. The Facilitator review notes that TOPIC-001 is the only topic-configuration read a participant has, which makes it the natural endpoint for first-session onboarding. The BA review notes that the use case (lines 486, 495) says engineers see topics only in the room, which argues for retiring it. That is a requirements gap for the BA to resolve with facilitator stakeholders.

---

## Follow-ups (outside this change)

- **Decision E elsewhere (VP of Engineering):** should a global-EM user with a participant membership reach session history or trend data as a participant on any other endpoint?
- **Participant need for TOPIC-001 (BA):** reconcile the use case (engineers see topics only in the room) with the contract and `team-content-access` (participants read TOPIC-001). The answer decides between the camelCase remap and retirement.
- **Facilitator-window prose:** align the contract's "facilitator with an active session" with the grant (active statuses, a draft under 24h, the grace window), on TOPIC-001 and wherever else that wording appears.
- **Admin denial message:** TOPIC-001-specific text ("Application Admins view topic configuration on the Topic Management screen."), which needs a message parameter on `denyAdminContentAccess`.

---

## Feedback disposition

### Accepted

| Source | Item | Where |
|---|---|---|
| BA | Cite the use case, the matrix, and FR-9.5 to show this is a defect, not new policy | Section 1 |
| BA | Path 2' grant drops the membership role; "no new query" is false. Verified in the helper | Sections 2 and 8 Q1 |
| BA, Facilitator | OR semantics, consistent with the vote lock-in | Section 8 Q1 |
| BA | Global-EM/participant state is reachable by design (demotion, join links); corrected my TEAM-004 guess | Section 6.1 |
| BA | Decision E divergence recorded as deliberate and TOPIC-001-only; policy question goes to a follow-up | Section 8 Q1, Follow-ups |
| BA | Spec owner `team-content-access`; R1 requirement and scenarios | Sections 7 and 8 Q5 |
| BA | Allow-list stated as a spec rule, not a preference (V1) | Sections 2 and 7 |
| BA | Acceptance criteria for timing, body, and no-query (V2-V4) | Section 6.4 |
| BA, Facilitator | TEAM-005 no-override wording verbatim (V6) | Section 6.2 |
| BA | Enumerate the five stale comments plus a grep acceptance check (V7) | Section 6.6 |
| BA | Explicit EM and admin matrix cells (V9); 404/403 row rewording; "Path id shape" note | Section 7 |
| BA | Reword `topic-customization-lock` line 41 and the `topic-annotation` requirement (R2, R3) | Sections 3 and 7 |
| BA | Template-team EM scenario | Sections 3 and 7 |
| BA | Use-case tension on participant need, as the argument for retirement | Sections 3, 8 Q6, Follow-ups |
| BA | Explicit "Out of scope" list (R5) | Section 7 |
| Facilitator | "No user-visible change" sentence for the proposal | Section 1 |
| Facilitator | "Who keeps access" table | Section 7 |
| Facilitator | Participant and facilitator 200 regression tests; path 2' and global-EM tests | Sections 6.7 and 7 |
| Facilitator | A normal facilitator is never denied, pinned by a test | Section 8 Q1 |
| Facilitator | Contract note: EM flows do not call TOPIC-001 | Section 7 |
| Facilitator | Mismatch log as the diagnostic for a mis-tagged engineer | Section 6.8 |
| Facilitator | Participant onboarding as a plausible first consumer, named in the retirement line | Section 8 Q6 |

### Accepted with modification

- **Facilitator Q1, "a facilitator grant is never denied by this check."** I kept the intent and changed the rule. A facilitator whose global role is `facilitator` is never denied, and a test pins it. A facilitator grant whose live global role has drifted to `engineering_manager` is denied. That person is a manager by the BRD's own test, and exempting them because of the path they came through is the kind of exception that becomes a norm. This does not decide cross-team EM facilitation, because the app already cannot create that session. The BA's "whatever grant path" wording says the same thing.

### Rejected or deferred

- **Facilitator Q3: the camelCase remap now (Option B).** Deferred (section 8 Q2). I leaned toward B in the first draft, so here is why I changed my mind. The argument for B rests on participant onboarding being the first consumer. The BA review shows the use case does not yet support a participant need for the full configuration. Building the response for a consumer whose need is disputed is guessing, and doing it in a security fix makes the fix harder to review. The tripwire hands the remap to the change that will actually know which fields it needs. Issue #187 also says to defer it.
- **Facilitator Q4: argue against Option C.** Not adopted as a position. Both arguments go in the "considered, not chosen" line, and the BA follow-up resolves the requirements gap. It is not this change's call.
- **Facilitator Q5 and BA V8: realign the facilitator-window prose in this change.** Deferred to a follow-up. The drift is real, but it does not affect the correctness of the EM denial. The new spec text refers to "an eligible session facilitator" by reference to `team-content-access`, so it adds no new drift. Rewording the facilitator definition touches every endpoint that uses "active session" and widens the review past what #187 asked for.
- **BA OQ3: TOPIC-001-specific admin denial message.** Deferred to a follow-up. The text is inaccurate but harmless, and fixing it changes a helper signature shared by every `content.ts` handler. The BA review itself says it can be dropped and must not block the EM fix.
