# BA Review: Tasks — http-auth-audit-log-coverage (SEC-12/SEC-13)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `tasks.md` (current, post-revision), cross-checked line-by-line against `proposal.md`, `design.md`, and `specs/auth-error-handling/spec.md`
**Lens:** Taken together, do the tasks cover every capability the proposal commits to? Is any requirement detail present in the proposal or spec but missing, softened, or ambiguous by the time it reaches a task an implementer would check off?

I read this fresh rather than diffing against the pre-revision version, per the brief. I did, however, re-open my own `propose-review-ba.md` and the engineer/security design reviews afterward, purely to confirm their findings actually landed rather than just being acknowledged in prose — that check is in Section 3.

---

## 1. Capability coverage — proposal to tasks, checked item by item

I went through every bullet in `proposal.md`'s "What Changes" and every requirement/scenario in the delta spec and traced each to a specific task. Nothing in the proposal is uncovered.

| Proposal / spec commitment | Task(s) | Verdict |
|---|---|---|
| `session_invalidated` gets a DB row at all four call sites (3× `middleware.ts` + `auth.ts` logout) | 3.1–3.3, 4.1 | Covered, one task per `reason` value, no site skipped |
| `token_refresh_failure` gets **no** row; `retryCount`/`failureType` relocate into `session_invalidated`'s metadata | 1.1, 1.2, 3.2, 3.3, 5.5 | Covered — and the plumbing gap (retryCount doesn't cross the function boundary today) is its own prerequisite section (1), not folded silently into 3.2/3.3 |
| `token_refresh_success` gets **no** row, path untouched | 3.4, 5.4 | Covered, with an explicit regression test (5.4) that a success produces zero additional DB calls |
| Fail-open, both round trips, one true bound, distinguishable timeout vs. error, paired signal | 2.1–2.3, 5.6, 5.7 | Covered — 5.7's "not ~1000ms" phrasing shows the single-`withTimeout` correction is understood, not just copy-pasted |
| `team_id` NULL uniformly across all four rows, including the logout site | 2.4, 4.1, 5.8 | Covered, with 5.8 specifically testing the "active session present" case so D4 can't be silently "fixed" later without someone noticing the spec disagrees |
| Reuse `resolveActorGlobalRole`; do not import `resolveTeamIdForAudit` | 2.4 | Covered, and correctly stated as a double-sided instruction (import one, don't import the other) rather than just "reuse the helper" |
| `sourceIp` added to the four existing `session_invalidated` log emissions | 3.1–3.3, 4.1 | Covered, each with "no other change to that log emission" — which matters, see Section 3 |
| `docs/deployment.md` gets `auth.audit_write_failed` as a 19th at-risk event | 6.2 | Covered |
| Spec delta reconciled against shipped behavior before archive | 6.1 | Covered |
| Follow-on issue: wider `auth.ts`/`join-links.ts` gap | 6.4 | Covered |
| Follow-on issue: NFR-AUTH-005 session-continuity risk | 6.5 | Covered, and covered *well* — see Section 4 |
| Follow-on: `auth.audit_write_failed` added to the monitoring-gap tracking item | 6.3 | Covered |
| No new admin-facing config surface | — (nothing to task) | Correctly absent; a non-goal doesn't need a checklist item |
| No schema migration | — (nothing to task) | Correctly absent |

Every "Modified Capabilities" line in `proposal.md` and every ADDED/MODIFIED scenario in `specs/auth-error-handling/spec.md` has a task or test that would fail if the behavior weren't built. I did not find a scenario in the spec with no corresponding task.

---

## 2. One asymmetry worth naming explicitly, not silently accepting

`proposal.md`'s "Explicitly out of scope" section names **four** things this change deliberately doesn't do. Three get a task that turns "worth its own issue" into an actual filed issue at or before archive:

- the wider `auth.ts`/`join-links.ts` gap → **6.4**
- NFR-AUTH-005's session-continuity risk → **6.5**
- (and the "not monitored" gap folds into) → **6.3**

The fourth — `connection-reauthorization.ts`'s `runSweepCheck` unhandled-promise-rejection gap — gets no task at all. I checked whether this is an oversight or a deliberate distinction, and I think it's deliberate: the proposal's own language for this one is visibly softer than the other three ("Not fixed here; **if it's worth fixing**, it's its own small issue on its own merits" vs. the other three's "recommended, explicitly, as its own follow-on tracking issue" / "worth its own future issue"). `design.md`'s Non-Goals repeats the same hedge. So this reads like a considered "not even worth a tracking issue yet" call, not a dropped stitch.

I'm not asking for a task to be added — the proposal itself doesn't commit to filing this one, so tasks.md isn't obligated to invent a commitment the requirement never made. But this is exactly the kind of asymmetry that becomes a scope dispute later ("why did three of four out-of-scope items get a tracked follow-on and not the fourth?") if nobody states it was a decision. I'd rather see one line added to Section 6 — even just "runSweepCheck's gap is deliberately not filed as a follow-on per proposal.md's own softer framing; revisit if it's ever touched for another reason" — than leave the omission to be read as an inconsistency by whoever picks this up next. Cheap, not blocking.

---

## 3. Confirming my own propose-stage finding actually closed, not just gestured at

My `propose-review-ba.md` flagged, as the one blocking-ish finding at that stage, that the new `audit_log` row had no stated home for a session identifier — SEC-13's "target resource identifier" — even though the structured log it's meant to outrank already carried one. I checked whether that made it all the way through to `tasks.md`, not just into `design.md`'s prose:

- Task 2.3 builds `metadata` as `{ reason, authSessionId, ...metadata }` with the field named explicitly, not left implicit.
- Task 5.3's assertion list says "asserting `reason` and `authSessionId` are present on every branch" — the acceptance test I asked for actually exists.
- The rename from `sessionId` to `authSessionId` (security review Finding 3) is threaded consistently through 2.2, 2.3, and 5.3 — I checked for a stray old name and didn't find one in a task body.

Good. This is the standard I want every finding held to: not "the design doc says it," but "there's a task, and a test, that would catch a regression against it."

The one place I'd flag as worth a second look, precisely because the naming distinction is subtle: tasks 3.1–3.3 and 4.1 all say to add `sourceIp` "to that existing `emitAuditEvent(..., "auth.session_invalidated", ...)` call itself... no other change to that log emission." That "no other change" is doing real work — it's what stops an implementer from also renaming that log's pre-existing `sessionId` field to `authSessionId` by analogy, which would be wrong (design.md is explicit that the *log* keeps its old field name; only the *new DB row's metadata* uses the new name). It's correctly worded as written. I'm noting it here only because it's the one spot where two very similarly-named fields with deliberately different names sit two lines apart in the same function, and I'd rather the review record show this was checked than have it rediscovered as a "why are there two names for the same thing" question mid-implementation.

---

## 4. What's already solid — worth calling out, not just gaps

- **Task 1.1/1.2** turns the engineer review's blocking Finding 1 (`retryCount` doesn't actually cross the function boundary) into its own numbered section ahead of everything else, with the exact line numbers and current return statements quoted. This is the right place for a corrected assumption to live — as a prerequisite, not folded quietly into 3.2/3.3 where a future reader would have no reason to suspect a return-type change happened.
- **Task 2.1/2.3** (single `withTimeout` covering the full SELECT+INSERT sequence, not one per call) matches Decision D5's corrected mechanism precisely, and task 5.7's phrasing ("not ~1000ms... confirms Decision D5's corrected single-`withTimeout` mechanism") shows the *reason* for the redesign survived into the test description, not just the number.
- **Task 5.1** doesn't just say "add mocks" — it explains *why* the existing tests would otherwise fail non-deterministically ("either fail non-deterministically or 'pass' only by coincidentally hitting the new fail-open path"), which is the kind of detail that stops an implementer from writing a mock that happens to make the assertion green without actually exercising the intended path.
- **Task 6.5** is the strongest task in the document from a BA standpoint: it doesn't just say "file an issue," it specifies title, concrete risk statement, provenance (naming both Priya's and Rachel's reviews so a future reader doesn't have to re-derive why this was split out), explicit non-goal framing, and a required named next step so the issue can't sit unowned. This is exactly the traceability standard I want every follow-on item held to, and it's a good model for the thinner one-liner in 6.4.
- **Section 5 overall** reads as a coherent acceptance-test suite against the spec's scenarios, not a generic "write tests" placeholder — 5.4/5.5 in particular directly test the *absence* of a row (token_refresh_success, token_refresh_failure), which is easy to under-specify and wasn't here.

---

## 5. One test-coverage suggestion, non-blocking

`resolveActorGlobalRole`'s existing no-row-found fallback to `"unknown"` is called out three separate times across this change's documents (design.md D5's parenthetical, and both the engineer and security design reviews) as "not a failure case" — a successful resolution, not something that should trip the new fail-open path. That's a reasonable claim, but right now it's asserted, not tested. Task 5.6 tests a *simulated DB error* on the role lookup; nothing in Section 5 tests the *simulated no-row-found* case (a `userId` that resolves zero rows) and asserts the write still succeeds normally with `actor_global_role: "unknown"` rather than triggering `auth.audit_write_failed`. In practice this is low-risk — a session with `session.userId` set almost certainly corresponds to a real `users` row — but given Section 5 already builds out the full happy-path/error-path/timeout-path matrix, this is the one cell of that matrix left implicit rather than stated. Cheap to add as a 5.10 if the team wants the acceptance suite to actually assert what three separate documents currently just claim.

---

## Summary of asks

Both are non-blocking; neither reopens a scope decision:

1. **Cheap, traceability-only:** add one line to Section 6 stating that `runSweepCheck`'s unhandled-rejection gap is deliberately not being filed as a follow-on issue (unlike the other three out-of-scope items), so the asymmetry reads as a decision rather than an inconsistency (Section 2).
2. **Cheap, optional:** add a test asserting that a no-row-found `actor_global_role` resolution ("unknown") completes the write normally rather than triggering the fail-open path — closing the one untested cell in an otherwise thorough Section 5 (Section 5).

Everything else checked out. This tasks.md covers every capability the proposal and spec commit to, my own propose-stage finding is fully closed (not just gestured at in a design doc), and every blocking/high finding from both design-stage reviews (engineer: retryCount, latency bound, test mocking; security: `sourceIp` on the failure signal, honest detectability framing, `authSessionId` rename) is present as an actual task or test, not left as something an implementer has to re-derive from `design.md`'s prose. I'd clear this to move into implementation as written.
