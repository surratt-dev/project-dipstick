# Exploration Notes — topic-003-admin-authorization (#176)

Explorer: Devon Calloway (Internal Champion / founding advisor)
Date: 2026-10-01
Status: exploration only — no code written, nothing committed. Revised after Facilitator (Priya Nair) and BA (Marcus Delgado) review; see §10.
Track: **FULL** pipeline (see §8).
Line numbers below are hints only; proposal/tasks must cite targets by heading or quoted anchor text (they drift on the first edit).

---

## 1. What the ritual actually needs here

FR-8.2 [HARD]: "After a team's first session, the facilitator **or Application Administrator** shall be able to add, remove, or reorder topics for that team."

From where I sit, the admin branch exists for one practical reason: a team whose topic list has gone wrong (stripped down, cluttered, inherited without a handoff) needs *someone* who can fix it without first finding a cross-team facilitator. That's the "ritual outlives me" property — the topic list must stay repairable. Today an admin can archive, restore and reorder, but **cannot add**. That leaves a half-working repair kit, and an admin who lands on an empty team sees the message "Topics can't be added from this account yet."

What I'm guarding while we widen this:

| Load-bearing constraint | Does #176 touch it? |
|---|---|
| First session uses the canonical default set (customization lock) | **Must not.** Admins must still get `409 TOPIC_CUSTOMIZATION_LOCKED` on a locked team. The lock check runs after authorization and doesn't depend on role, so the fix leaves it alone. A test should still pin that down. |
| Facilitator-from-another-team | Unchanged for facilitators. A member-facilitator still gets `403 FACILITATOR_IS_TEAM_MEMBER`. |
| No-manager participation | Not affected: `engineering_manager` still gets `403 NOT_A_FACILITATOR`. |
| Team definitions are the team's own words (FR-8.7) | **Must not change.** TOPIC-007 (annotation) stays facilitator-only. See §4. |
| Default set visible/restorable (FR-8.6) | Not touched. |

None of these constraints gets weaker. This is a fix that brings the code up to a HARD requirement. It doesn't make anything protective optional.

---

## 2. Current state (grounded)

```
                         facilitator    facilitator   application_admin   eng / EM
                         (non-member)   (member)      (any membership)
TOPIC-002 GET all          200            403            200                 403
TOPIC-003 POST add         201            403            403  <-- #176       403
TOPIC-004 DELETE archive   200            403            200                 403
TOPIC-005 POST restore     200            403            200                 403
TOPIC-006 PUT order        200            403            200                 403
TOPIC-007 PUT annotation   200            403            403  (FR-8.7, intended)  403
```

- `packages/backend/src/routes/topics.ts` ~L90: `checkStandingFacilitatorAuthorization(reply, userId, teamId, startTime, messages)` is reply-writing and facilitator-only. It has **two callers**: TOPIC-003 (L725, `ADD_CUSTOM_TOPIC_AUTH_MESSAGES`) and TOPIC-007 (L1478, `ANNOTATION_AUTH_MESSAGES`).
- `packages/backend/src/auth/standing-facilitator-access-helper.ts`: `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` is decision-only. It returns `{authorized, actorGlobalRole}` or `{authorized:false, reason}` and doesn't call `applyTimingFloor`. Its header comment says TOPIC-003 "is facilitator-only and stays that way … widening it is a separate, deliberately deferred change". **That comment has to be updated in this change.**
- TOPIC-004/005/006 each wrap it in a small per-endpoint function (`checkArchiveTopicAuthorization`, `checkRestoreTopicAuthorization`, `checkReorderTopicsAuthorization`) that writes its own 403 copy and applies the timing floor.

## 3. The fix shape

Mirror the existing pattern exactly. Add a `checkAddCustomTopicAuthorization(reply, userId, teamId, startTime)` wrapper that:
1. calls `checkStandingFacilitatorOrAdminAuthorization`
2. on rejection, calls `applyTimingFloor(startTime)` and then sends 403 with the same reason codes (`NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER`)
3. returns `{ rejected:false, actorGlobalRole }` so the lock-denial audit and the success audit record `application_admin` correctly. They already take `authResult.actorGlobalRole`, so no audit plumbing changes.

Then swap TOPIC-003's call site. **Leave `checkStandingFacilitatorAuthorization` in place**, since TOPIC-007 still needs it. After the swap it has one caller. The `messages` parameterization can stay as it is; whether to collapse it is a cleanup question, not part of #176.

Message copy: `"Only a facilitator can add a custom topic."` becomes inaccurate. Reason codes stay unchanged, so the API contract only changes in its prose. I'm counting this as part of the fix, not scope creep. A 403 message that names the wrong set of allowed roles would be a small lie. Exact strings:

| Reason code | Copy | Who receives it |
|---|---|---|
| `NOT_A_FACILITATOR` | `"Only a facilitator or an application admin can add a custom topic."` (new; matches TOPIC-004) | engineer, engineering manager, caller with no `users` row |
| `FACILITATOR_IS_TEAM_MEMBER` | `"A facilitator cannot add a custom topic to a team they are a member of."` (**unchanged**) | facilitator with an active membership on the team |

Optional, raised in the earlier security review (S2): a shared `canAddCustomTopic(globalRole)` predicate used by both TOPIC-002's flag and TOPIC-003. `topic-add-form-and-empty-state` design.md explicitly said "the natural moment is the #176 fix". **Decision point — handed to design.** The parity test already guards against drift, so the predicate is nice to have. My recommendation is to skip it to keep the diff small. Whichever way design goes, design.md must record it; if skipped, it states: "The parity test (`topic-add-flag-parity.test.ts`) is the sole drift guard between TOPIC-002's flag and TOPIC-003's authorization." An unrecorded lean is not acceptable.

## 4. Things that could go wrong if the design drifts

1. **Someone "fixes" TOPIC-007 for consistency.** Both endpoints share `checkStandingFacilitatorAuthorization` today, so a lazy implementation could widen the shared function and admit admins to annotation too. That would break FR-8.7, which is deliberate: the definition is in the team's words, recorded by someone who was in the room. The correct move is to switch TOPIC-003's *call site* and leave the shared function alone. The TOPIC-007 code comment at L1472 already says "Do not 'fix' this for consistency." Tests for TOPIC-007's admin 403 must keep passing untouched.
2. **Lock bypass for admins.** If anyone short-circuits the cascade for admins (e.g. "admins are trusted, skip the lock"), the first session stops being guaranteed to run the canonical set. Add an explicit test: an admin on a locked team gets `409 TOPIC_CUSTOMIZATION_LOCKED` and the lock-denial audit row records `actor_global_role = 'application_admin'`.
3. **Check order regresses.** The order must stay 403 → 404 → 409 → 422, with a timing floor on every early return. Because the new wrapper is decision-only underneath, the floor has to be called explicitly. An admin is never rejected at 403, so "an admin case" in the 403 floor suite tests nothing. The floor assertions that matter are: admin → 404 (nonexistent canonical-format team ID), admin → 409 (locked team), and both 403 branches emitted by the **new wrapper** (engineer/EM → `NOT_A_FACILITATOR`; member-facilitator → `FACILITATOR_IS_TEAM_MEMBER`). Admin check-order scenarios: admin + nonexistent team + invalid body → 404 (not 422); admin + locked team + invalid body → 409 (not 422); admin + unlocked team + invalid body → 422 with the existing field errors.
4. **Flag and endpoint drift (the important one).** TOPIC-002's `canAddTopics` is hardcoded `facilitator`-only in `content.ts` L688. The live spec says it **SHALL** become true for admins *in the same change* as #176. `topic-add-flag-parity.test.ts` will fail if only one side is flipped, which is the intended design.
5. **An admin add reaches a live session.** It can't: #175 (#205) snapshots `session_topics` at room open, so an admin add while a room is open changes nothing in that session's topic list or order. That is load-bearing for "the tool stays in the background during the session", so it gets one integration test (admin adds while a room is open → the open session's topic list is unchanged), not just an assertion in prose.

## 5. Pre-committed coupling — NOT scope expansion

The previous change (`topic-add-form-and-empty-state`) wrote these into the living specs and code comments as **obligations of the #176 fix**. They belong in scope:

| Item | Location |
|---|---|
| Flip `canAddTopics` to true for `application_admin` | `packages/backend/src/routes/content.ts` L680–688 (keep it separate from `canEditAnnotations`) |
| Flip parity-test admin rows `ADMITTED_CANNOT_ADD` → `ADMITTED_CAN_ADD`, and delete the constant | `packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts` L117–130 |
| Remove empty-state rows 3 and 5 (they become unreachable) | `packages/frontend/src/pages/addCustomTopic.ts` `activeEmptyStateVariant` L145–158; `packages/frontend/src/components/ActiveTopicsEmptyState.tsx` (variant 5 copy, header table); `ActiveEmptyStateVariant` type |
| **Replace** (not remove) the row 3 / row 5 admin tests with positive admin tests: (a) admin, unlocked, no active topics → empty-state add action shown; (b) admin, unlocked, active topics → heading add trigger shown; (c) admin, locked → locked variant, no add action | `packages/frontend/src/pages/__tests__/TopicManagementPage.empty.test.tsx` L80, L98 |
| Update the shared type comment | `packages/shared/src/types/topic.ts` L79–87 |
| Spec deltas | `openspec/specs/add-custom-topic/spec.md` — requirement titles "A standing facilitator can add a custom topic to an unlocked team" and "…enforces the customization lock and standing-facilitator authorization" become inaccurate; proposal must say whether the delta RENAMEs+MODIFIEs them or ADDs siblings (my preference: rename to "A standing facilitator or application administrator …"). "Non-facilitator" scenarios become "neither facilitator nor admin"; add admin success, admin-as-member success, admin-on-locked-team 409, and the admin check-order scenarios in §4.3; `openspec/specs/topic-customization-lock/spec.md` L189–215 (`canAddTopics` requirement body becomes: "`canAddTopics` SHALL be `true` for every caller TOPIC-002 admits, that is, every non-member `facilitator` and every `application_admin`. It SHALL NOT be derived from `canEditAnnotations`, whose administrator exclusion (FR-8.7) is permanent." Replacement scenario: WHEN an `application_admin` requests a team's full topic list, THEN the response includes `canAddTopics: true` and `canEditAnnotations: false`. The parity scenario stays **unchanged** — that is its purpose.); `openspec/specs/topic-management-screen/spec.md` L509–523 and L910–931 (drop the admin no-control clause and rows 3/5) |
| Contract/requirements prose | `requirements/design/REST API Contract.md` L612 (parenthetical says TOPIC-003 excludes admin), L631 (`canAddTopics` "TEMPORARY"), L695 (TOPIC-003 Authorization line), L735 (403 row wording), L762 (TOPIC-004's note that TOPIC-003 is unaffected); `requirements/use cases/08 - Topic Management - Use Cases.md`, "Use Case: Add Custom Topic" — not just the Actor line: Actor → "Facilitator (or Application Administrator, per FR-8.2)"; Preconditions (auth + standing-facilitator bullets) add "or the actor is an Application Administrator (any team, regardless of membership)"; last Acceptance Criterion → available to a standing Facilitator (non-member) and an Application Administrator, not to Engineers, Engineering Managers, or a member-Facilitator. Goal stays facilitator-voiced. Mirror the Reorder use case's form. `REST API Contract - Validation Report.md` FR-8.2 row: proposal notes it claimed "Covered" before it was true; optionally append "(admin branch: #176)" |
| Stale helper comment | `standing-facilitator-access-helper.ts` header (lists two callers; says TOPIC-003 "stays that way") |

The type-union question: removing rows 3 and 5 means changing `ActiveEmptyStateVariant` from `1|2|3|4|5` to three variants, and possibly dropping the `canAddTopics` argument from `activeEmptyStateVariant`. The spec says the rows "SHALL be removed in the same change". **Resolved as a rule (design records it):** the add trigger (heading and empty-state action) renders only when `canAddTopics === true` and `isCustomizationLocked === false`. The empty state has exactly three variants: locked; unlocked with archived topics; unlocked without archived topics. No scenario covers `canAddTopics: false` on an unlocked team, and the screen SHALL NOT show an add action in that state. No extra defensive branch, no extra test for an unreachable state.

## 6. Answers to the "check other endpoints" brief

- **TOPIC-006 Reorder:** no gap. It already uses `checkStandingFacilitatorOrAdminAuthorization` (`checkReorderTopicsAuthorization`, topics.ts ~L498), with tests at topics.test.ts / topics-integration.test.ts 5.1. Its admin-specific `openSessionCreatedAt = null` behavior is out of scope.
- **TOPIC-004 Archive / TOPIC-005 Restore:** no gap. Both already admit admins.
- **TOPIC-007 Annotation:** excluding admins is **intentional**, not a gap (BRD FR-8.7, added by `topic-annotation` #53; use case L326/L357/L360). Don't touch it.
- **Frontend reachability for admins:** the `/team/:teamId/topics` route is `ProtectedRoute`-only, and the `Topics` link on `TeamPage.tsx` L111 renders unconditionally. Admins already reach the screen (TOPIC-002 admits them). The add control is hidden for them *only* because of `canAddTopics === false` (`TopicManagementPage.tsx` L1224–1225, L1482). Once the flag flips, the heading trigger and the empty-state add action render for admins with no other frontend change. **No additional frontend scope is needed beyond §5.**

## 7. Explicitly flagged as out of scope (do not absorb)

- Merging or deleting `checkStandingFacilitatorAuthorization`, or un-parameterizing its messages. It still serves TOPIC-007.
- Admin-who-is-also-a-team-member. **Accepted decision for #176** (record in design.md): FR-8.2 places no membership restriction on Application Administrators, and TOPIC-004/005/006 already admit member-admins with tests; TOPIC-003 follows. I am *not* comfortable leaving it there for the ritual — it is the same social pressure the member-facilitator bar exists to prevent — so it becomes a **tracking issue covering TOPIC-003/004/005/006 together** (follow-up F1, §10). It does not get fixed piecemeal on one endpoint.
- #184 (archive race / TOPIC-003 hardening), #198/#199 (custom description visibility), #200 (locked empty-state recovery path). All are adjacent; none belong here. #200's acceptance already includes "update the #55 empty-state copy to point at whatever recovery exists", so admin-appropriate locked (variant 1) copy is handed there, not done here (§10).
- Facilitator visibility of admin-authored topics ("added by / added on" on the management row). Follow-up F2, §10.
- An "applies from the next room" notice after an add while a room is open. Applies equally to facilitator adds and to archive/reorder; not admin-specific. Follow-up F3, §10.
- Audit or rate-limiting changes. Existing Decision 13 resolution is inherited; the admin population is tiny.

## 8. Rollout consideration

**Track: FULL.** The earlier draft recommended lightweight; this run is on the full track. I don't object — the change touches authorization, a HARD requirement, three living specs, the contract and a use case, and a full design stage is the right place to record C1/C2/C4. The low rollout risk below is an argument about deployment, not about skipping design.


The original deferral argument was "shipped, deployed code with its own rollout considerations". On inspection the rollout risk is very small: the change only *widens* access, for one already-trusted role (`application_admin`) that can already archive, restore and reorder on the same teams. No data migration and no new reason codes. The only clients consuming the 403 message are our own screen, which never shows the add control to admins anyway. Low deployment risk; process weight is set by the track above.

## 9. Recommended next step

**Scope:** TOPIC-003 authorization switched to `checkStandingFacilitatorOrAdminAuthorization` via a new `checkAddCustomTopicAuthorization` wrapper. `checkStandingFacilitatorAuthorization` retained for TOPIC-007 (its only remaining caller). 403 copy per §3. All §5 coupling items, including the full use-case and spec-heading changes. Helper header comment updated. One-sentence FR-8.7 tension note in design (§10).

**Decisions design.md must record:** shared predicate yes/no (C1, §3); frontend `canAddTopics:false` rule (§5); admin-as-member accepted per FR-8.2 with tracking issue linked (§7); form helper-text wording (§10 A6).

**Required acceptance tests:**
1. Admin (non-member), unlocked team, valid body → 201; topic appended at end of display order; one `audit_log` row `operation = 'topic.custom_added'`, `actor_global_role = 'application_admin'`, in the same transaction as the insert.
2. Admin with an active (`removed_at IS NULL`) membership on T, unlocked T, valid body → 201; same ordering and audit as (1).
3. Admin, locked team → 409 `TOPIC_CUSTOMIZATION_LOCKED`; one `topic.write_denied_locked` row with `actor_global_role = 'application_admin'` and `metadata.attempted_operation = 'topic.custom_added'` written before the 409; no `topic.custom_added` row.
4. Admin check-order: 404 beats 422; 409 beats 422; 422 on unlocked invalid body (§4.3).
5. Timing floor on admin 404 and 409, and on both 403 branches of the new wrapper (§4.3).
6. Engineer / EM / no-user-row → 403 `NOT_A_FACILITATOR` with new copy; member-facilitator → 403 `FACILITATOR_IS_TEAM_MEMBER` with unchanged copy.
7. TOPIC-007 admin-rejection tests pass **without modification** (annotation PUT → 403, `"Only a facilitator can edit a team's topic definition."`); TOPIC-002 for an admin returns `canAddTopics: true` and `canEditAnnotations: false`.
8. Parity test admin rows → `ADMITTED_CAN_ADD`; `ADMITTED_CANNOT_ADD` deleted; passes for all seven caller classes.
9. Admin adds while a room is open → the open session's `session_topics` are unchanged (§4.5).
10. Frontend: positive admin tests (a)–(c) from §5; `ActiveEmptyStateVariant` reduced to three.

## 10. Review response

**Accepted**
- BA C1–C3, V1–V7, G1–G4: folded into §3, §4, §5, §9. The BA was right that "admin timing floor" tested nothing; the floor now targets the paths an admin (and the new wrapper) can actually reach. "Rewrite or remove" became "replace with positive tests" — removing them would leave the user-visible outcome of #176 unproven.
- BA C4 / Facilitator #6, A5: admin-as-member recorded as an accepted decision under FR-8.2, *plus* a tracking issue (F1). Both reviewers converged here and I agree it shouldn't evaporate.
- Facilitator A1: the snapshot-at-room-open guarantee is now stated (§4.5) and gets an integration test (§9 #9). This is the property that keeps the tool out of the room.
- Facilitator A4: design.md carries one sentence: "FR-8.2 lets an Application Administrator author a custom topic's name, prompt and first-session description; FR-8.7 keeps only the *team definition* (annotation) facilitator-only, because it records what was said in the room. Do not 'resolve' this by restricting the add form's fields for admins." Correction to the review: the add form's own help text says engineers don't see the first-session description during sessions today (#198/#199 track its visibility); participants do see the admin-authored *prompt*, so the tension is real but sits on the prompt more than the description.
- Facilitator A6 / Q1 (narrowly): copy review of add-form helper text, toast and 403 strings as an admin sees them. Only one string reads as facilitator-assuming: the description help text "…what this topic means for your team." Recommendation to design: "…for this team." No broader copy rewrite.

**Rejected / not absorbed**
- Facilitator A2 as an in-scope change (admin-specific variant 1 copy). The locked zero-topic state is reachable by admins *today* (TOPIC-002 already admits them), so #176 doesn't create the problem, and #200's acceptance already owns rewriting that copy to point at real recovery. Writing interim admin copy now would be rewritten by #200. Recorded hand-off: a comment on #200 noting the admin-viewer case (F4).
- Facilitator Q2 ("applies from the next room" notice). Not admin-specific — facilitator adds, archives and reorders have the same semantics — and adding notices to the management screen for one role is the wrong place to start. Follow-up F3 if anyone hits real confusion.
- Facilitator A3 ("added by" display) in scope. I share the concern — a facilitator walking into the room unable to answer "who added this?" is exactly the handoff gap the tool exists to close — but it's a new display surface, not a coupling obligation. Audit already captures the actor, so nothing is lost by deferring. Follow-up F2.
- Lightweight-pipeline language (both reviews): superseded; this is the full track (§8).

**Handed to propose/design**
- C1 shared `canAddCustomTopic` predicate (my recommendation: skip; record parity test as sole guard).
- Spec delta operation for the renamed add-custom-topic requirements (RENAMED+MODIFIED vs ADDED).
- Final wording of the description help-text tweak.
- Whether the Validation Report row gets the "(admin branch: #176)" annotation.

**Follow-ups to file (not #176)**
- F1. Admin-who-is-a-team-member across TOPIC-003/004/005/006 — should a member-admin be barred like a member-facilitator?
- F2. Facilitator awareness of admin-authored topics ("added by / added on" on the management row).
- F3. "Takes effect from the next room" notice for between-session edits while a room is open (all roles, all write endpoints).
- F4. Comment on #200: locked empty-state copy must also read correctly when the viewer is an application admin.
