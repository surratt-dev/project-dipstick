# Implementation Review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `topic-003-admin-authorization` (#176)
**Scope reviewed:** uncommitted working tree on `agent-team/176-topic-003-admin-authorization` against `design.md` (D1–D9, Risks, Migration Plan) and every unlabeled task in `tasks.md`.

## Verdict

**Approve. No blocking issues.**

The implementation does what the design decided, in the places the design said it would, and nothing more. The authorization boundary between TOPIC-003..006 (facilitator or admin) and TOPIC-007 (facilitator only, FR-8.7) is now drawn by which function each endpoint calls, not by a parameter or a comment. That was the point of D1, and it holds.

## Verification performed

I ran these myself rather than relying on the checkboxes:

- Backend: `topics.test.ts`, `content.test.ts`, `topic-add-flag-parity.test.ts`, `topic-add-admin-integration.test.ts` (real Postgres was up, so the 5 integration tests actually ran rather than skipping), `topic-annotation.test.ts`: 302 passed.
- Frontend: `TopicManagementPage.empty`, `.add`, `.annotation`, `addCustomTopic.test.ts`: 163 passed.
- `npm run typecheck` (frontend), `tsc -p tsconfig.build.json` (backend), ESLint on all touched paths: clean.
- `openspec validate topic-003-admin-authorization --strict`: valid.
- `git status` confirms `topic-annotation.test.ts`, `topic-annotation-integration.test.ts` and `TopicManagementPage.annotation.test.tsx` are **unmodified** (task 3.3).

Note: `tsc --noEmit -p .` on the backend reports about 200 errors, all in test files outside this diff's added lines (pre-existing; the project's build config excludes tests). Not attributable to this change.

## Design conformance

| Decision | Status | Evidence |
|---|---|---|
| D1 new wrapper; shared function untouched | Met | `checkAddCustomTopicAuthorization` in `topics.ts` is structurally identical to `checkArchiveTopicAuthorization` (decision call, then floor, then 403 with the reason code, same `AuthorizationResult` shape). `checkStandingFacilitatorAuthorization` keeps its signature and behaviour, and grep shows one caller (TOPIC-007, ~L1508). `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` is deleted; "Only a facilitator can add a custom topic" has no hits under `packages/`. Audits still read `authResult.actorGlobalRole`. |
| D2 403 copy | Met | New `NOT_A_FACILITATOR` copy matches TOPIC-004's "application admin" term; member copy unchanged; reason codes unchanged. |
| D3 explicit role expression, no shared predicate | Met | `content.ts` names both roles, stays separate from `canEditAnnotations`, and its TEMPORARY comment is replaced. |
| D4 three variants + required `addAllowed` | Met | `activeEmptyStateVariant` drops `canAddTopics`; `ActiveTopicsEmptyState` takes required `addAllowed`; `addAction = addAllowed && variant !== "locked"`; page passes the same `addAllowed` the heading trigger uses (`=== true`, fails closed). Variant-5 copy removed. |
| D5 member-admins admitted | Met | Unit and real-DB tests cover member-admin → 201; parity row is `ADMITTED_CAN_ADD`. |
| D6 no field restriction for admins | Met | Form untouched apart from D7. |
| D7 helper text | Met | "for this team." in form and test. |
| D8 spec delta | Met | Strict validation passes. |
| D9 validation report | Met | "Covered (admin branch: #176)". |
| Risks: TOPIC-007 not widened | Met | Comment substance kept; only the "(TOPIC-003's)" parenthetical dropped and TOPIC-003 added to the sibling list. |
| Risks: admins under the lock | Met | 409 + `topic.write_denied_locked` row with `application_admin` and `attempted_operation = topic.custom_added`, asserted with mocks **and** against real `audit_log`. |
| Risks: open-room snapshot | Met | Integration test 2.7 compares full `session_topics` rows before and after, and checks TOPIC-002 `active` ends with the new topic. |
| Migration Plan (rollback hides control) | Met | Drift test (e) parameterized over absent and `false`. |

## Task-by-task check (unlabeled tasks)

All unlabeled tasks (1.1, 2.1–2.7, 3.1–3.3, 4.1–4.3, 5.1–5.3, 6.1–6.3) are actually done in code or docs, not only checked off. Points I specifically confirmed:

- **1.1:** parity header rewritten and the "A #176 fix … MUST" paragraph removed; `ADMITTED_CANNOT_ADD` gone; `content.test.ts` asserts `canAddTopics: true`, `canEditAnnotations: false`, and both lists; shared type doc comment has no temporary/#176 wording.
- **2.1:** the 201 key set is asserted exactly, so any session field would fail it, which is stronger than the single `openSessionCreatedAt` check the task asked for. Audit row asserted on the transaction client between `INSERT topics` and `COMMIT`.
- **2.5:** floor asserted on admin 404, admin 409, and all four 403 callers (engineer, EM, no-user-row, member-facilitator).
- **2.6:** rejected callers tested against a locked team and against a nonexistent team with an invalid body; `mockDbQuery` called once, which proves nothing past authorization ran.
- **3.1:** every comment the task names is corrected (`grep -n "TOPIC-003" topics.ts`: remaining hits are accurate "reused unchanged from TOPIC-003" notes on 404/409 steps).
- **4.3:** (a1), (a2), (b)–(f) and the `addAllowed={false}` component guard are all present; (c) correctly avoids asserting admin locked copy (#200).
- **5.1:** role matrix TOPIC-002 and TOPIC-003 rows updated; TOPIC-003 kept as its own row.
- **6.1:** the remaining "#176" hits in `packages/` and `requirements/` are provenance notes ("added by #176"), not claims that #176 is open. Acceptable.
- **6.2:** `follow-up-issues.md` has F1–F7 drafts and a PR section with blank placeholders only; providers enumerated from config (simulated OIDC for local/CI, Entra primary, plus an "any other provider" line). No invented names or issue numbers. The multi-provider framing is consistent with the project's OIDC stance.

## Non-blocking observations

1. **Variant type changed from `1|2|3|4|5` to string literals** (`"locked" | "unlocked_with_archived" | "unlocked_none_archived"`). The design only asked for three members. I prefer this: named variants can't be confused with the old row numbers. It's a small, unrecorded design deviation, though, so mention it in the PR description.
2. **Stale test labels.** `TopicManagementPage.empty.test.tsx` still names its facilitator cases "row 1 / row 2 / row 4" under a describe now titled "the empty-state variants". Cosmetic; rename when next touched.
3. **Fourth copy of the per-endpoint wrapper.** Expected and accepted (engineer N1); the factory collapse belongs with F1 when all four change together. Make sure the F1 draft still says so when it's filed.
4. **Helper header range "TOPIC-003..007"** in `standing-facilitator-access-helper.ts` reads correctly only together with the next clause, which names TOPIC-007 as the facilitator-only path. It's accurate, just dense.

## Remaining human/archive items (not part of this review's gate)

6.4 and 6.5 are **merge gates**: file F1 and F2 and record their numbers, and name the IdP role-assignment administrator for each configured provider. 6.6 is non-gating, and 6.7 happens at archive. None of these blocks implementation sign-off, but the PR must not merge with the 6.4/6.5 blanks unfilled.
