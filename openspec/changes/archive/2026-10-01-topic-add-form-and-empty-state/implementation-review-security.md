# Implementation Review: Security (topic-add-form-and-empty-state)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** `git diff main` plus new files on `agent-team/55-topic-add-form-and-empty-state`. Backend: `routes/content.ts` (TOPIC-002 flag), `routes/topics.ts` (TOPIC-003 typing only), `routes/__tests__/topic-add-flag-parity.test.ts`, `routes/__tests__/content.test.ts`, `shared/src/types/topic.ts`. Frontend: `pages/TopicManagementPage.tsx`, `pages/addCustomTopic.ts`, `components/AddCustomTopicForm.tsx`, `components/ActiveTopicsEmptyState.tsx`, `pages/__tests__/TopicManagementPage.add.test.tsx`.
**Tests run:** `topic-add-flag-parity.test.ts` (6/6), `content.test.ts` (41/41), `TopicManagementPage.add.test.tsx` (64/64). All pass.
**Verdict:** **Accept.** The required condition (S1) is met. No must-fix findings. One should-fix tightens the parity test so it cannot pass vacuously.

---

## 1. Conditions from the design review

| Condition | Status | Evidence |
|---|---|---|
| **S1 (required).** Parity test across caller classes | **Met** (see §3 for one gap) | `topic-add-flag-parity.test.ts`: all six caller classes; asserts `canAddTopics === (POST !== 403)`, and POST 403 whenever TOPIC-002 rejects |
| S2. Shared `canAddCustomTopic` predicate | Deferred, as agreed | `tasks.md` names it as a stated deliverable of #176 |
| S3.1 Outcome and warning strings rendered as text | Met | Every sink is a `{…}` text node. No `dangerouslySetInnerHTML` or `innerHTML` anywhere in the new code |
| S3.2 Focus by ID, not by a selector built from topic text | Met | `TopicManagementPage.tsx` ~L119–L129 and ~L883–L893: IDs are built from `topicId` and passed only to `document.getElementById`. No `querySelector`, so `CSS.escape` isn't needed |
| S3.3 XSS regression test | Met (nit §4) | `TopicManagementPage.add.test.tsx` ~L690: `<img src=x onerror=alert(1)>` appears as literal text in the status message and the row heading, and `document.querySelector("img")` is `null` |
| S3.4 `error.message` only from a parsed envelope | Met | `hasEnvelopeMessage` (~L201) requires an object `error` with a **string** `message`. 403 and 404 show the server message only through that guard. A 422 never shows server text (it maps to client-owned copy). Anything else falls through to the fixed retry copy. There is a test for a 502 with an HTML body (~L861) |
| Fail-closed `=== true` | Met | `data.canAddTopics === true` (~L1207), with a "do not refactor" comment. Test "is absent when the response has no canAddTopics field (fails closed)" |
| S4. Sentinel-team flag or a comment on #188 | Not done in code. Tracked as human item H6 | Acceptable. The spec keeps the flag a pure function of role |
| D8 in the default-topics handoff; creator handoff points at `audit_log` | Met | `handoffs/default-topics-not-active-name-join.md` L20 and L30; `handoffs/custom-topic-creator-attribution.md` L13 |

## 2. `canAddTopics` versus TOPIC-003 authorization

`content.ts` ~L677: `const canAddTopics = decision.actorGlobalRole === "facilitator";`. It is computed only after `checkStandingFacilitatorOrAdminAuthorization` has admitted the caller, so the set of possible values is `facilitator ∧ ¬member` (true) or `application_admin` (false, whether or not the admin is a member).

TOPIC-003 (`topics.ts` ~L113–L145, ~L713) still uses the facilitator-only `checkStandingFacilitatorAuthorization` over the same `evaluateStandingFacilitatorAccess` row. It allows exactly `facilitator ∧ ¬member`. The two agree for every caller TOPIC-002 admits. Both reads are live and uncached. The only divergence is time-of-check/time-of-use, which the server's own 403 covers.

The `topics.ts` diff is type-only: `ValidatedAddCustomTopicBody extends AddCustomTopicRequest`, `VALID_VOTE_TYPES: readonly VoteType[]`, and a typed 201 response. The authorization order (403 → 404 → 409 → 422), the advisory lock, and the in-transaction audit row are unchanged. I confirmed the 201 body carries no field the old body did not.

The comment correctly says the flag must not be merged with `canEditAnnotations`. That keeps a #176 fix from accidentally granting admins the annotation editor (FR-8.7).

## 3. The parity test and its fake database

**Is a SQL-text-routing fake adequate here?** Yes, with one fix. The property under test is the **decision logic** of two route handlers over the same caller fact. Both handlers run unmodified, and both reach that fact through `evaluateStandingFacilitatorAccess`, so the SQL semantics (the `LEFT JOIN`, `removed_at IS NULL`) are shared by construction and cannot drift between the routes. A real Postgres instance would add confidence in the query, not in parity. The fake also fails loudly in most drift scenarios:
- If the lock query or the team-existence query changes text, the POST returns 404 or 409, or the GET reports locked. Either way, `expect([201, 403])` or `isCustomizationLocked === false` fails.
- If **one** route switches to a new authorization query the fake doesn't route, that route sees no user and denies everyone. The non-member facilitator row then fails, because GET reports true and POST returns 403 (or GET returns 403 while POST returns 201).

### SF-1 (should-fix): the test can pass vacuously

The test is purely relational, and its `else` branch accepts "GET 403 and POST 403". If the shared query in `evaluateStandingFacilitatorAccess` changes text (for example `FROM users AS u`, or the join is reworded so the `"team_memberships"` substring check misses it), `fakeQuery` returns `rows: []` for **both** routes. Every caller is then denied on both sides, and all six rows still pass. The control would go silent without failing. The same applies to any future change that denies everyone on both sides.

The header comment also says "update the expected column below", but there is no expected column.

**Fix:** add an `expected` field to `CALLER_CLASSES`, for example `{ get: 200, canAddTopics: true, post: 201 }` for the non-member facilitator and `{ get: 200, canAddTopics: false, post: 403 }` for both admin rows. Assert those values alongside the relational check. At minimum, assert that the non-member-facilitator row reaches `201`. This also makes the #176 fix a visible edit to the expected table, which is what the comment already promises.

### Nit N-1
Add a seventh row: "no user row" (`fakeQuery` returns `[]` for the auth query). Both helpers treat `null` as deny today. That is a separate branch in each helper, and it costs one line.

## 4. Rendering and the client

- **Duplicate warning sink.** `findDuplicate` returns the matched topic's `name` from server data. The form renders it as `&apos;{duplicate.name}&apos;`, which is text. This is safe. **N-2 (nit):** the XSS test covers the status message and the row heading but not this sink. Seeding an archived topic named `<img src=x onerror=alert(1)>`, typing the same name, and asserting no `img` element would cover the third sink at no real cost.
- **Duplicate check stays team-scoped.** It runs entirely on the client, against the `active` and `archived` lists TOPIC-002 returned for this `teamId`. No server oracle was added (D9 still holds).
- **IDs from `topicId` in attributes.** `id={`topic-heading-${topicId}`}` is set by React as an attribute value, so no markup can be injected. `getElementById` does no selector parsing. This is safe even if #184's unvalidated-ID concern lands a non-UUID value.
- **Request body.** `buildAddTopicRequest` sends only `name`, `prompt`, `voteType` and `firstSessionDescription`. The server re-validates everything. Client `maxLength` is UX only, and the server enforces its own limits.
- **N-3 (nit, pre-existing pattern):** `teamId` from `useParams()` is interpolated into fetch URLs without `encodeURIComponent` (~L624, L1303 and the existing calls). A crafted link such as `/team/..%2F..%2Fx/topics` could steer a same-origin POST to a different `/api/v1/...` path, but only after the victim fills in and submits the form. The JSON body only fits TOPIC-003's shape, and the cookie is `sameSite: strict`, so the practical impact is negligible. Worth fixing across the page during #184's ID-validation work, not here.
- **N-4 (nit, pre-existing):** the restore and annotation error paths (~L824, ~L1073) use `body?.error?.message ?? fallback` without the `typeof === "string"` check that the new add path and `submitArchive` (~L757) use. A non-string `message` would make React throw instead of falling back. This is not an injection risk. Using `hasEnvelopeMessage` everywhere would make the page consistent.

## 5. Data exposure on `GET /teams/:teamId/topics/all`

The only response change is `canAddTopics: boolean`. I checked the `content.ts` diff, the `GetAllTopicsResponse` type diff, and the REST API Contract diff. No new columns are selected, and no new joins or fields are added. The flag tells the caller only their own role-derived capability, which they already know. The 403 bodies are unchanged. The `teamName` and `defaultTopicsNotActive` disclosures were already there and are tracked in the D8 handoff.

## 6. Items still open (no action required for this change)

- **D2 / S2:** admins cannot add topics, pending #176 together with the shared predicate.
- **D3 / D4 / D7:** rate limiting, unaudited 403s, and bidi or zero-width text, all under #184. With a button now in place, I'd raise #184's priority.
- **D5 / S4:** the sentinel team is protected only by the lock. A human comment on #188 (H6) is still outstanding.
- **D6:** adds to deactivated, unlocked teams are still allowed. A human confirms intent (H5).

---

## Findings summary

| ID | Severity | Finding |
|---|---|---|
| — | must-fix | None |
| SF-1 | should-fix | The parity test passes vacuously if the shared auth query stops matching the fake. Add an expected-outcome column, or at least assert that the non-member facilitator gets a 201 |
| N-1 | nit | Add a "no user row" caller class to the parity table |
| N-2 | nit | Extend the XSS test to the duplicate-warning sink |
| N-3 | nit | Unencoded `teamId` in fetch paths (pre-existing). Fold into #184 |
| N-4 | nit | Restore and annotation error paths lack the string-type guard (pre-existing) |

**Summary:** S1 is met. `canAddTopics` is computed only after TOPIC-002 admits the caller, and it equals TOPIC-003's `facilitator ∧ ¬member` rule for every admitted class. The table-driven parity test exercises both real handlers. The SQL-text fake is adequate because both routes share one authorization query, but if that query's text stops matching the fake, every row is denied on both sides and the test still passes (SF-1). Rendering is text-only, focus uses `topicId`-based IDs through `getElementById`, the server message is shown only from a validated envelope, and a missing flag fails closed. `GET /topics/all` exposes nothing beyond the boolean. No must-fix findings. Accept.
