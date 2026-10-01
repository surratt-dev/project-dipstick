# Implementation review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** the working-tree diff against `main` for `topic-add-form-and-empty-state`, read against `design.md` (Decisions 1–11) and `implementation-notes.md`
**Focus:** whether the code matches the design, whether boundaries hold, and whether it is consistent with existing patterns in `packages/`. I looked closely at the refetch outcome contract, how long the interlocks are held, the component extraction, the team-keyed route, and the recorded deviations.
**Verification run:** the frontend Topic Management suites and `addCustomTopic.test.ts` pass (7 files, 216 tests). The backend `content.test.ts` and `topic-add-flag-parity.test.ts` pass (47 tests). `tsc --noEmit` reports no errors in any file this change touches, except one `decorateRequest("session", null)` error in the parity test. That error follows the existing pattern in `content.test.ts` and `e2e-verification.test.ts`, which have the same error on `main`.

**Verdict: Approve with one should-fix worth doing before merge.** No must-fix findings. The implementation follows the design closely, and every recorded deviation is justified. The server stays authoritative: `canAddTopics` is presentation-only, the `=== true` check fails closed, and TOPIC-003 keeps its own checks. The parity test turns the "same change as #176" promise into a real control.

---

## 1. Design conformance

| Area | Design | Implementation | Assessment |
|---|---|---|---|
| `canAddTopics` (D1) | Separate flag computed beside `canEditAnnotations`. Marked temporary pending #176. Read as `=== true`. Parity test across six caller classes. | `content.ts` computes it separately and the comment forbids merging it. The shared type and the REST contract both carry the "temporary" wording. The page reads `data.canAddTopics === true` with a do-not-refactor comment. Missing-field test present. Parity test covers six classes. | Matches. See S2 for one weakness in the test's fake database. |
| Quiet refetch on Remove/Restore (D2) | `fetchAllTopics()`. Dialog stays `submitting` until the refetch settles. Remove's `!res.ok` branch parses defensively. | `finishAfterTopicWrite()` runs the refetch, then the handler sets `idle`. `loadTopics()` is now called only on mount (and again on team change through the key). `submitArchive` uses a single `.json().catch(() => null)` parse. | Matches, with a gap in the lock (S1). |
| Interlock matrix (D3) | Matrix as specified. Add's in-flight reason takes precedence. One visible reason line. Sending closes a clean definition editor. | `movesDisabled`, `topicActionsDisabled`, `topicActionsReason`, Save order, and Edit all include `addSubmitting` and use `ADD_TOPIC_SUBMITTING_REASON` first. `reorder-locked-reason` and `definition-locked-reason` are hidden while `add-submitting-reason` shows. Submit's precedence is draft → definition → dialog. `closeCleanAnnotationEditor()` runs on send. | Matches. Each ✕ cell has a test in both directions. |
| Lock held until the outcome's refetch settles (D3, D6) | Covers the 201, 409, and network/5xx refetches. | The form stays in `phase: "submitting"` until `setAddForm(null)` or `returnAddFormToEditing()` runs, and both run only after `await fetchAllTopics()`. 403, 404, and 422 have no refetch and release at once. | Matches. Tested for 201. 409 and network are covered by the same code path but have no test of the timing (N4). |
| Handler shape (D6) | The `try/catch` wraps `fetch()` only. After a 201, every path ends in "Added …". Envelope check before showing the server's message. | Implemented as specified. The 201 body is parsed in its own `try`. `hasEnvelopeMessage()` gates the server message. Non-envelope bodies, including any unrecognised 409, take `refetchThenOfferRetry()`. | Matches. |
| Refetch outcome (D11) | `ok \| failed \| superseded`. Latest-issued wins. A superseded result applies nothing and reports nothing. | A `RefetchOutcome` union and a `latestRefetchId` ref. `isLatest()` is checked after `fetch`, after `json`, and in `catch`, so a superseded response never reports as failed. All five callers handle all three cases as the design specifies: stale reload, annotation recovery, Remove/Restore, add 201, 409, and network. | Matches. A clean implementation. N1 records one limit of the counter. |
| Team-keyed route (D11) | `<TopicManagementPage key={teamId} />` | `TopicManagementRoute` in the page module, used by `App.tsx` and by the three new suites. Tested with a reorder draft, a definition editor, and an add form (including no POST to either team). | Matches. See N2. |
| Extraction (D10) | Pure `addCustomTopic.ts`. Presentational form and empty state. State, submit handler, interlocks, and messages stay in the page. | Exactly that split. The form owns no fetch, interlock, or focus logic. The empty state is a pure function of the variant. The page owns `addForm`, `screenMessage`, `pendingFocusIds`, and every derivation. | Matches. See N3 and N5. |
| Single focus mechanism (D8) | One `pendingFocusId` resolved by `getElementById`, replacing the move-button ref map. | `queueFocus(ids[])` resolves the first enabled candidate in `useLayoutEffect`. Move buttons now have ids, and `FOCUS_FALLBACKS` maps to ids. No selectors are built, so `CSS.escape` is not needed. | Matches, and is a good generalisation: one mechanism serves both the reorder fallback and every outcome focus. |
| Shared types (D9) | Request and response types. `VoteType` reused. `field: keyof AddCustomTopicRequest`. | Implemented. The backend's validated body `extends AddCustomTopicRequest`, and `ValidationResult.field` is typed. The 201 is typed as `AddCustomTopicResponse`. | Matches. See N6. |

## 2. Recorded deviations

All of them are acceptable:

- **No reorder-draft variant of "survives a failed post-Remove refetch" (task 2.5).** This is correct, not a gap. `topicActionsLockedByDraft` disables Remove while a draft is dirty, so that state cannot be reached. Writing the test would mean weakening an interlock the tasks forbid touching. The add-form variant, which is the only draft that can coexist with a Remove, is tested.
- **No page test for a superseded post-201 refetch (task 6.5).** I agree it cannot be reached through the UI. The clean editor's refetch is issued before the POST, and "add submitting" disables every control that could issue a newer one. The branch exists, is three lines, and matches the spec text. The superseded mechanism itself is tested through a reachable race (Remove refetch overtaken by a Restore refetch). If the team wants the spec sentence backed by a test, `fetchAllTopics` would need to be injectable, and that is not worth doing for an unreachable branch.
- **Parity test uses a fake database that answers by SQL text, not live Postgres.** Acceptable for a unit-suite drift control, because both routers run their real authorization helpers. S2 asks for one anchor assertion.
- **Form phases `editing | confirmingDiscard | submitting`, with `duplicate` as a field rather than a `warningDuplicate` phase.** Acceptable, since the design gave the shape only as "e.g." A non-null `duplicate` is orthogonal to the phase, which actually simplifies "editing Name/Prompt dismisses the warning".
- **Disabled radios while submitting, the visible `add-topic-submit-reason`, and `VOTE_TYPE_LABELS` moved to `addCustomTopic.ts`.** All are consistent with existing screen patterns.

## 3. Findings

### Must-fix

None.

### Should-fix

**S1. A second Remove opened during the first one's refetch can release the lock early.**
Decision 2 relies on "the dialog stays `submitting` until the refetch settles, so the controls it disables stay disabled". The way the dialog is closed undermines that.

- `topicActionsDisabled` does not include `isTopicDialogOpen`. The matrix row "remove/restore dialog open" leaves Remove and Restore enabled. So while Remove A is submitting (DELETE plus refetch), Remove B on another row is still clickable.
- `startRemove(B)` replaces `removeState` with B's confirmation. If the facilitator confirms B, then A's handler finishes with an unconditional `setRemoveState({ status: "idle" })` (`TopicManagementPage.tsx` ~L783). That closes B's dialog while B's DELETE and refetch are still in flight.
- Moves, Save order, and Edit then re-enable mid-write. That is exactly the window engineer review S1 closed: a draft built from the old saved order, and a stale `PUT /topics/order`.

Restore has the same shape (~L836).

The race existed before this change, but this change widens it: the window used to be the DELETE only, and is now DELETE plus GET. It also makes the design's guarantee untrue as stated. The server still rejects the stale order (409/422), so there is no data corruption, but the facilitator gets a confusing stale-order error.

**Fix (two lines, no new interlock):** close the dialog only if it still belongs to this call:
```ts
setRemoveState((cur) => (cur.status === "submitting" && cur.topic.topicId === topic.topicId ? { status: "idle" } : cur));
```
Do the same in `submitRestore`. Add one test: confirm B during A's pending refetch, resolve A, and assert that moves stay disabled until B settles.

An alternative is to disable every Remove/Restore while any Remove/Restore is submitting. That is a matrix change, so it would need a spec touch. The functional-update fix does not.

**S2. The parity test can pass without testing anything if the fake's SQL matching drifts.**
`fakeQuery` routes on substrings (`"FROM users u"`, `"team_memberships"`, `"COUNT(*) AS count FROM sessions"`, …). Unmatched SQL falls through to `{ rows: [] }`. If a later refactor changes the authorization query text, the standing-facilitator rows become TOPIC-002 403 plus POST 403. That takes the `else` branch and passes. The control would then stop controlling anything, silently, and it is the one security review S1 made required.

**Fix:** add an anchor assertion for the baseline class, for example:
```ts
if (label === "non-member standing facilitator") { expect(list.statusCode).toBe(200); expect(post.statusCode).toBe(201); }
```
Alternatively, assert that every class reaches at least one 200 or 201 somewhere in the table. This costs one line and keeps the drift control honest.

### Nits

**N1. The counter covers refetches, not other writes that patch `data`.** `saveOrder` and `submitAnnotation` call `setData(prev => …)` without bumping `latestRefetchId`. A refetch issued *before* such a write can still land after it and overwrite it. Example: a move closes a clean editor that has `refetchOnClose`, which fires a GET, then Save order runs quickly. This predates the change and is not a regression, and Decision 11 scoped the counter to refetches. Worth one sentence in the helper's comment, though, so nobody assumes "latest wins" covers every write. Natural fix later: bump the counter whenever a write applies its own patch.

**N2. The page without the key is still exported and used unkeyed.** The three older suites (`TopicManagementPage.test.tsx`, `.reorder`, `.annotation`) still render `<TopicManagementPage />` directly. That is harmless in tests. But the safety property ("team change resets state") now depends on callers going through `TopicManagementRoute`. Either add a one-line comment on `TopicManagementPage` saying "route through `TopicManagementRoute`; never mount unkeyed", or stop exporting the page in a later clean-up. The implementation notes say "the page suites render through it", which is true only of the new suites.

**N3. Components now import from `pages/`.** `AddCustomTopicForm.tsx` and `ActiveTopicsEmptyState.tsx` are the first files in `components/` that import from `../pages/`. The design put `addCustomTopic.ts` in `pages/` (following the `topicOrder.ts` precedent), so this follows the design. Still, `components → pages` is an inverted dependency. Also, `AddFormPhase` is defined in the component while the union that uses it lives in the page. Low priority: when a third consumer appears, move the pure module (and `AddFormPhase`) to a neutral location such as `src/topics/`.

**N4. Interlock timing is tested only for the 201 refetch.** "Keeps other controls locked until the post-add refetch settles" covers 201. The 409 and network/5xx refetches hold the lock through the same `phase` mechanism but have no timing assertion. Adding one deferred-GET test per path would make Decision 3's "until the outcome's refetch settles" fully demonstrated.

**N5. The page has grown to 1,913 lines (from 1,414) even after extraction.** The add handler, its outcome branches, and the derivations sit in the page, as Decision 10 intends, and they are plain functions declared after the early returns (correct: they are not hooks and they need a non-null `data`). This pattern differs from the `useCallback`-above-returns style used for every earlier handler. That is a reasonable trade-off, but it is now the page's second idiom. Advisory: the next change to this screen should extract a `useTopicsResource(teamId)` hook (data, `loadTopics`, `fetchAllTopics`, the counter) before adding anything else.

**N6. Type tightness.** `VOTE_TYPE_LABELS` is `Record<string, string>`. `Record<VoteType, string>` would make a new vote type a compile error. The `?? topic.voteType` fallback can stay for unexpected server values. The backend's `VALID_VOTE_TYPES: readonly VoteType[]` is also not checked for exhaustiveness. A `satisfies Record<VoteType, true>` lookup or an exhaustive tuple would close that.

**N7. Submit carries no `title` while in flight.** The page passes `submitDisabledReason={null}` during submitting, so Submit and "Add anyway" have no `title`, while every other control disabled by the in-flight add carries `ADD_TOPIC_SUBMITTING_REASON`. "Adding…" is self-explanatory, so this is cosmetic. Either pass the constant or note the exception beside the comment on `submitDisabledReason`.

## 4. Boundaries and operability

- **Server authority:** unchanged. The flag is presentation only. TOPIC-003 enforces role, membership, team existence, and the lock on its own. The client duplicate check is labelled a hint and is scoped to this team's TOPIC-002 lists. No new endpoint, no schema change, and no persistent or ephemeral state crosses the Redis/Postgres line.
- **Deploy order:** `=== true` makes a frontend-first deploy degrade to today's behaviour, as the Migration Plan states. Rollback is a revert.
- **Contract documentation:** the REST API Contract carries `canAddTopics` with its temporary status and its independence from the lock. TOPIC-003's request and response shapes were already documented. The use-case doc changes are clarifications with pointers to the handoffs, not silent edits.
- **Observability:** no new server paths, so there is nothing to add. TOPIC-003's existing `topic.custom_added` audit row remains the record of who added a topic.

---

## Summary

- **Verdict:** approve with one should-fix. No must-fix findings. The code matches Decisions 1–11, and every recorded deviation is justified.
- **Refetch result:** the `ok | failed | superseded` result is implemented cleanly, with the latest-issued check at every await, and all five callers handle each case as designed.
- **Interlock timing:** the add lock is held until the 201, 409, and network refetches settle.
- **S1:** A second Remove or Restore opened mid-refetch can be closed early by the first call's unconditional `idle`. That re-enables moves while a write is in flight. Fix with a functional update that checks the topic id.
- **S2:** The parity test's fake database can drift into passing without testing anything. Add one anchor assertion for the baseline facilitator class.
- **Structure:** the form and empty state are correctly presentational, and state stays in the page. The `components → pages` import and the page's size (N3, N5) are follow-ups.
- **Team-keyed route:** correct and tested. Document that the bare page must never be mounted without the key (N2).
- **Nits N1, N4, N6, N7:** the counter limit, two missing timing tests, vote-type exhaustiveness, and Submit's in-flight `title`.
