# Architecture Review — Task Sequencing

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** `tasks.md` only, checked against `design.md` (post two rounds of design review) and `proposal.md`. I am not re-reviewing the decisions themselves — Marcus and Tomás already did that, and I incorporated their findings into `design.md`. This pass asks a narrower question: does the *order* in which `tasks.md` asks someone to build this match the order in which the pieces actually become buildable? A task that assumes a file, a transaction, or a handler exists before an earlier task in the sequence has created it is a defect in the task list, not in the design.

**Verdict:** Two of the four specific items I was asked to verify pass cleanly. One passes in substance but has a task-list hygiene problem worth fixing before implementation starts. One has a real sequencing defect — not in the code it describes, but in a test task that was supposed to track a design.md decision and drifted from it. I'm also flagging a structural issue that sits underneath three of these four items: Sections 3 and 4 write as though an HTTP-testable endpoint already exists, but that endpoint isn't created until Section 5.

---

## 1. `pg_advisory_xact_lock` sequencing relative to the INSERT it protects — **Pass**

Task 5.4 places the entire mitigation inside one task, in the correct order: `BEGIN` → `pg_advisory_xact_lock(hashtext($1::text))` as the first statement → the `MAX(display_order)` read → the `INSERT` → `COMMIT`. This matches Decision 10's corrected SQL block verbatim. Because the lock, the read, and the insert all land in the same task rather than being split across separate tasks (e.g., "build the insert" now, "add the lock" later), there's no window in the task sequence where an implementer could reasonably build the unguarded version, run it, and only bolt the lock on afterward. No earlier task in the document attempts an insert against `topics` at all, so there's no stale "naive" version this task is correcting — Task 5.4 is the first and only place the insert exists, and it's already correct on arrival.

Task 5.7 (the concurrency test) is correctly sequenced after 5.4, and explicitly calls out that it must exercise genuine concurrency rather than two sequential calls — the right test for the specific MVCC failure mode Decision 10 documents.

No action needed here.

---

## 2. Timing-floor requirement across all check-ordering tasks (403/404/409/422/201) — **Fails partially; test task diverges from design.md**

The five early-return paths do each get an `applyTimingFloor` call assigned somewhere in the document: Task 3.6 covers 403/404/409, Task 5.3 covers 422, Task 5.4 covers 201, and Task 2.4 confirms the read-side path needs no new call. Taken as a checklist of "does every branch get a floor call," the coverage is complete.

The problem is in how tasks.md verifies that, and it's a real divergence from design.md, not a stylistic difference:

- **design.md's own words (Decision 9's Finding-1 amendment, the paragraph immediately after the decision statement):** *"Task 5.6's tests are extended with a timing-side-channel assertion (mirroring `content/__tests__/timing-oracle.test.ts`'s existing pattern) that the `403` path is not detectably faster than the `404`/`409`/`422` paths."* Design.md is explicit on two points: the test belongs in Task 5.6, and the comparison set is 403 vs. **404/409/422**.
- **What tasks.md actually did:** it invented a separate Task 3.7 — *"Write a timing-side-channel test... asserting the `403` response is not detectably faster than the `404`/`409` responses"* — dropping `422` from the comparison entirely, and Task 5.6 (line 41) contains no timing-oracle assertion at all.

This isn't just a missing test case. It's a sequencing defect: Task 3.7 sits in Section 3, before Section 5 has built the `422` validation path (Task 5.3) or the route file it lives in (Task 5.1). Even if someone noticed the missing `422` case and tried to add it to Task 3.7 as written, they couldn't — the code path being compared against doesn't exist yet at that point in the document. The design.md authors clearly anticipated this, which is exactly why they placed the assertion in Task 5.6 (after `422` and `201` both exist) rather than earlier. tasks.md's split undid that.

**Recommendation:** delete Task 3.7. Fold its assertion into Task 5.6, restoring the 403/404/409/**422** comparison set design.md specifies. Task 3.6 (the implementation of the floor calls for 403/404/409) can stay where it is as an implementation task, but its test coverage should not be split off into an earlier, narrower task that contradicts the design doc it's supposed to verify.

A secondary note on Task 3.6 itself: it instructs the implementer to "record `startTime` at handler entry, before Task 3.1's query runs." "Handler entry" is a concrete reference to the `topics.ts` POST handler — code that Task 5.1 hasn't created yet at this point in the sequence. This is survivable if Section 3's checks are built as standalone functions that accept `startTime` as a parameter (in which case "handler entry" is really "caller's entry," and the actual recording happens in Section 5's handler) — but the task doesn't say that, and an implementer following the document in order would reasonably look for a handler to add `startTime` to and not find one. Worth a one-line clarification: either state explicitly that Section 3's checks are parameterized functions wired into the handler in Section 5, or move the `startTime`-recording instruction into Task 5.2 where the handler is actually assembled.

---

## 3. Successful-write audit logging in the same transaction as the INSERT — **Passes in substance; task placement is confusing**

The substantive requirement is correctly stated in both places it appears. Task 4.5 states the audit write must be "in the same database transaction as the topic INSERT," and Task 5.4 restates and owns it: "Also write the Task 4.5 success-audit row inside this same transaction." This is not an afterthought bolted on after the fact — the INSERT task and the audit-write requirement agree with each other and neither one ships without the other. Task 4.6's test ("no such row is written when the request is rejected at any earlier check") also correctly frames this as a transactional guarantee rather than a best-effort follow-up write.

The issue is purely one of document structure, but it's the kind of thing that causes real confusion during implementation: Task 4.5 sits in Section 4, which is sequenced *before* Section 5 creates `topics.ts` and its transaction (Task 5.1, 5.4). Read literally and in order, Task 4.5 asks for "a synchronous `audit_log` write... in the same database transaction as the topic INSERT" at a point in the document where no such transaction exists yet — it isn't built until Task 5.4, two sections later. The only reason this doesn't produce a real defect is that Task 5.4 happens to restate the requirement and actually do the work. That's a fragile arrangement: it depends on whoever implements Task 5.4 remembering to go back and satisfy Task 4.5's checklist item, rather than the document sequencing the work so that it's simply built once, in the right place, the first time.

**Recommendation:** relocate Task 4.5 (and its test, 4.6) to sit immediately after Task 5.4, in Section 5, alongside the INSERT they're inseparable from. Section 4 can keep the denial-path audit tasks (4.1–4.4), which genuinely are independent of Section 5's route file — the lock-gate check they hook into already exists by the time Section 4 is reached (built in Section 3), and a denial audit write doesn't require `topics.ts` to exist at all if the lock-gate check is a standalone function. The success-path audit write has no such independence; it belongs where the transaction is.

---

## 4. Auth-query-reuse/extraction task sequenced before tasks that would re-derive it — **Pass**

Task 3.1 is the only task in this document that implements the standing-facilitator authorization check, and the instruction to reuse `facilitator-sessions.ts`'s existing `POST /draft` query verbatim (or extract it to a shared helper) is embedded directly inside that same task — not stated as a separate, later "go back and deduplicate" cleanup step. Every other task that touches this check (Task 5.2) references it by number ("apply the authorization check (Task 3.1)") rather than re-implementing it. There is no window in the sequence where a second, independent copy of this query could get written before the reuse instruction takes effect, because there's only ever one task that writes it. This is the right way to close a drift risk — not by scheduling a dedup pass after the fact, but by making the duplication structurally impossible to introduce in the first place. No action needed.

---

## 5. Underlying structural issue: Sections 3 and 4 assume an HTTP-testable endpoint that doesn't exist until Section 5

This is the pattern connecting items 2 and 3 above, and it's worth naming on its own rather than leaving it as two isolated test-task complaints.

`topics.ts` doesn't exist as a file, and `POST /api/v1/teams/:teamId/topics` isn't registered anywhere, until Task 5.1. Task 5.2 is where the three write-side checks (3.1–3.3) actually get wired into a concrete handler for the first time. Yet:

- **Task 3.5** asks for tests confirming callers "receive" specific HTTP status codes (403/404/409) — that's a claim about a live endpoint's behavior, not about a standalone function's return value.
- **Task 3.7** (recommended for removal above) is the same problem, for timing.
- **Task 4.3** asks for a test asserting an audit row exists "immediately after a denied request" — a "request" implies something was sent to a running endpoint.
- **Task 4.6** asks for a test asserting "a successful Add Custom Topic write" produces an audit row — there is no successful write possible before Section 5 exists at all.

None of these four tasks can actually be executed at the point they're sequenced in the document. They can only run once Section 5's route file and handler wiring exist. In practice, whoever implements this will almost certainly build the route skeleton first regardless of what the task numbers say — that's the only path that compiles — but the document as written doesn't say that, and a literal top-to-bottom read gives the impression these tests are self-contained deliverables of Sections 3 and 4.

**Recommendation — pick one:**
- **(a) Reorder:** move Task 5.1 (create `topics.ts`, register the route, even as an empty 501 stub) to the front of Section 3, so the endpoint exists as a target before any test that exercises it over HTTP is written. Sections 3 and 4 then become "fill in this handler's checks and audit calls," not "build checks in a vacuum and test them against nothing."
- **(b) Annotate:** keep the current section grouping (checks / audit / endpoint, grouped by concern rather than by build order), but add an explicit note at the top of Sections 3 and 4 that their test tasks (3.5, 3.7, 4.3, 4.6) are integration-level and are not runnable — and should not be attempted — until Task 5.1/5.2 land. This preserves the current "group by concern" organization of the document (which has real value for a reviewer skimming for "where's the auth logic," "where's the audit logic") while being honest about build order.

I'd lean toward (b) combined with the Section 4.5/4.6 relocation in item 3 above: keep the concern-based grouping for the parts that are genuinely standalone (Section 1's lock helper, Section 3's check *logic*, Section 4's denial-path audit *logic*), but move anything that's actually only expressible against a live transaction or a live HTTP response (Task 4.5/4.6, Task 3.7) to sit next to the Section 5 code it depends on. That's a smaller edit than a full reorder and removes the two concrete defects (the dropped `422` case, the premature transaction reference) without disturbing the parts of the sequencing that are already correct.

---

## Summary of required changes to `tasks.md`

1. Delete Task 3.7; fold its assertion into Task 5.6, restoring the 403/404/409/**422** comparison set from design.md's Decision 9 amendment.
2. Relocate Task 4.5 and Task 4.6 to immediately follow Task 5.4, so the success-audit requirement lives next to the transaction it's inseparable from, rather than forward-referencing a transaction two sections ahead of it.
3. Add a one-line clarification to Task 3.6 (or Task 5.2) stating explicitly that Section 3's checks are implemented as functions parameterized on a shared `startTime`, wired into the concrete handler assembled in Section 5 — so "handler entry" doesn't read as a reference to code that doesn't exist yet at that point in the document.
4. Optionally, add a short note at the top of Sections 3 and 4 that their remaining integration-style tests (3.5, 4.3) are not runnable until Task 5.1/5.2 land, to set expectations for anyone working the list top-to-bottom.

Items 1 in this list (Decision 10/advisory lock sequencing) and 4 in the original brief (auth-query reuse) required no changes — both are already sequenced correctly and should not be touched.
