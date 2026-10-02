# Design Review — topic-003-admin-authorization (#176)

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Artifacts reviewed:** `proposal.md`, `design.md`, `tasks.md`
**Code checked:** `packages/backend/src/routes/topics.ts`, `packages/backend/src/routes/content.ts`, `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts`, `topics.test.ts`, `session-topic-edit-isolation-integration.test.ts` + `helpers/real-db.ts`, `packages/frontend/src/pages/addCustomTopic.ts`, `components/ActiveTopicsEmptyState.tsx`, `components/AddCustomTopicForm.tsx`, `pages/TopicManagementPage.tsx` and its `.add` / `.empty` tests.

**Verdict: Approve with one blocking fix (B1), which is in the frontend half.**

The backend half is clean and small, and it follows the existing pattern closely. D1 is the right call. `checkStandingFacilitatorOrAdminAuthorization` already returns `actorGlobalRole`, and the lock-denial audit (`checkCustomizationLockGate`) and the in-transaction success audit both read `authResult.actorGlobalRole`, so `application_admin` reaches both audit rows with no new plumbing. The wrapper issues the same single `evaluateStandingFacilitatorAccess` query as before, so the ordered-mock unit tests in `topics.test.ts` keep their query sequence. TOPIC-003 never calls `readOpenSessionCreatedAt` and its response has no role-dependent fields, so admins can't use it to learn anything about session state. `audit_log.actor_global_role` is `TEXT NOT NULL` with no CHECK constraint (migration 8), so the new value inserts. Task 3.7 can be built: `real-db.ts` has `fx.user("application_admin")` and `appFor(userId)` builds one app per actor, so a facilitator can open the room and an admin can add the topic in the same test.

The problems are a contradiction at the screen boundary and some stale comments that the planned grep won't catch.

---

## Blocking

### B1. D4 / tasks 4.1–4.2 contradict each other and break the screen's fail-closed rule

D4 drops `canAddTopics` from `activeEmptyStateVariant` and cuts the variants to three. In `ActiveTopicsEmptyState.tsx` today, the variant alone decides whether the add button renders (`addAction = variant === 2 || variant === 4`). The component has no other input that says whether the caller may add. So after D4 as written:

- The empty-state "Add custom topic" renders for **any** unlocked empty team, whatever the flag says.
- Task 4.2 says "The add action still renders only when `canAddTopics && !isCustomizationLocked`", but with D4's signature the component has nothing to read that from. The design also says "No extra defensive branch."
- `TopicManagementPage.tsx:1222` has the comment "`=== true`, so a missing flag (frontend-first deploy) fails closed. Do not refactor to `!!` or a default." `TopicManagementPage.add.test.tsx` tests that rule for the heading trigger. D4 would quietly drop it for the empty-state trigger. There is no empty-state test for a missing flag, so nothing would catch it.

D4 says `canAddTopics: false` on an unlocked team is an "unreachable state" and needs no test. It can be reached: a response with the flag missing (frontend deployed first) or `false` (the backend-rollback case this design's own Migration Plan describes) is that state.

**Required change:**
1. Keep the variant function to three message/structure variants (locked, unlocked + archived, unlocked + none). That part of D4 is fine.
2. Pass the add permission into the empty state separately. Either add an `addAllowed: boolean` prop, or make `onAddTopic` optional and render the button only when it is given. The page passes the existing `addAllowed` (`!locked && canAddTopics === true`), so the heading and the empty state share one gate.
3. Add one empty-state test: unlocked, no active topics, `canAddTopics` missing → message "This team has no active topics.", no add action (and "Show archived topics (n)" still shows when archived topics exist). This replaces the old row-5 test as the drift guard; it doesn't test a dead branch.
4. Rewrite D4's last paragraph to say this, and change task 4.2 to name the prop.

---

## Should fix

### S1. The Migration Plan's rollback sentence is wrong
"If a backend rollback happens with a newer frontend, admins would see the control and get a 403." The old backend returns `canAddTopics: false` for admins, so the heading trigger stays hidden. With B1 fixed, the empty-state trigger stays hidden too, and nobody gets a 403. Without B1, the empty-state trigger would show and the form would display the old backend's "Only a facilitator can add a custom topic." (the page shows server `error.message` for 403 in `returnAddFormToEditing`). Restate it as: "a rollback hides the control for admins; no 403 path."

### S2. Stale comments that the grep in task 6.2 won't catch
Task 6.2 greps for "#176", "temporar" and the variant-5 copy. These comments don't contain any of those, and they'll be wrong after the change:
- `topics.ts` ~L58–72: the "Task 3.1 — standing-facilitator authorization check" block describes **TOPIC-003** as `global_role = 'facilitator'` only. After this change that function serves only TOPIC-007, so the comment needs to say TOPIC-007 / FR-8.7.
- `topics.ts` ~L99–103, inside `checkStandingFacilitatorAuthorization`: "for this endpoint's cascade".
- `topics.ts` ~L352–358 (archive wrapper) and ~L492–496 (reorder wrapper): "checkStandingFacilitatorAuthorization (TOPIC-003, above) … has no application_admin branch". This should now say TOPIC-007.
- `topic-add-flag-parity.test.ts` header: the two sides are "computed by two different helpers … that agree today only by coincidence". After D1 they use the same decision helper. Update the header in task 3.9 to say what the test now guards: the `content.ts` role expression and the TOPIC-003 wrapper.

Add these to task 1.4 / 3.9, or add `grep -n "TOPIC-003" packages/backend/src/routes/topics.ts` to 6.2 and check each hit.

### S3. Delete `ADD_CUSTOM_TOPIC_AUTH_MESSAGES`, don't edit it
Task 1.2 says "Change the `notAFacilitator` copy in `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` (or the new wrapper's message)". Pick one. Once the call site moves to the new wrapper, that constant has no callers. If it's left in, the old "Only a facilitator can add a custom topic." string survives as dead code, and the next person to grep for the 403 copy finds two answers. Put the messages inline in `checkAddCustomTopicAuthorization` like the archive/restore/reorder wrappers do, and delete the constant.

---

## Notes (non-blocking)

- **N1. A fourth copy of the same wrapper.** Archive, restore, reorder and now add are the same 15 lines with different strings. A `makeFacilitatorOrAdminCheck({ notAFacilitator, isTeamMember })` factory would remove the duplication, but I agree with D1/D3 that it shouldn't happen in #176. If F1 (member-admin bar) lands, it will change all four together. That is the point to collapse them, because then they change in one place. Mention it in F1's draft.
- **N2. D3 expression vs. `decision.authorized`.** In `content.ts`, `canAddTopics` is computed only after the decision is authorized, and the helper admits exactly those two roles, so the explicit `=== "facilitator" || === "application_admin"` is always `true` there. Naming the roles is fine and reads well. If F1 or a future role ever changes what the helper admits, the parity test (with its explicit `expected` column) catches the drift. That's correct; I'm only noting that the parity test is now the sole thing keeping the two sides honest.
- **N3. Help text still points admins at something they can't edit.** After D7 the text reads "…Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for this team." Admins have `canEditAnnotations: false`. The sentence is aimed at the facilitator, so it still reads acceptably, and D7 is right to keep the change to one word. Mention it to #200's copy pass; don't fix it here.
- **N4. Error paths I checked and am happy with:** an admin demoted between GET and POST gets a 403 whose new copy appears in the form (existing path, no new state). An admin racing a facilitator's add is serialized by the existing `lockTeamTopics` advisory lock, so `display_order` stays dense. Admin on a locked team: 409 with the `write_denied_locked` row first, and the page's existing 409 refetch path re-renders the locked variant. Admin hitting a nonexistent team: 404 after the floor, the same as for a facilitator.
- **N5. Test 3.5 floor assertions.** These follow the archive-wrapper unit tests (mock `applyTimingFloor`, assert it was called before `reply.send`). Make sure the `NOT_A_FACILITATOR` branch is tested with both an `engineering_manager` and a no-`users`-row caller, since `grant === null` is a separate return in the shared helper.

---

## Summary of requested changes

| # | Change | Where |
|---|---|---|
| B1 | Gate the empty-state add action on a passed-in `addAllowed`, not on the variant; add a missing-flag empty-state test; reword D4 | design D4, tasks 4.1/4.2/4.5 |
| S1 | Correct the rollback sentence | design Migration Plan |
| S2 | Update stale TOPIC-003 comments in `topics.ts` and the parity-test header | tasks 1.4, 3.9, 6.2 |
| S3 | Delete `ADD_CUSTOM_TOPIC_AUTH_MESSAGES`; messages go inline in the new wrapper | task 1.2 |
