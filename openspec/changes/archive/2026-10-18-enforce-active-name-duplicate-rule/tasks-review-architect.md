# Architect review of tasks.md (Ingrid Sollenberger)

Change: enforce-active-name-duplicate-rule (#299). Focus: task ordering against architectural dependencies. I read tasks.md, design.md and proposal.md.

## Verdict

The overall layering is right: shared, then backend, then frontend, then docs. This matches the design's build order. There are 4 ordering defects, 3 tasks that should be split, and 2 inconsistencies between tasks, design and proposal that would cause rework. None is a redesign. Fix them in tasks.md before implementation starts.

## Blocking findings (ordering)

**B1. Task 1.3 depends on 2.1.**
- 1.3 is an automated test that calls `findActiveNameConflict`. That function is created in 2.1, so 1.3 cannot be written first.
- It is also a test, not preparation or inventory.
- Fix: move 1.3 to after 2.1, ideally next to 2.4. Keep section 1 for read-only confirmation (1.1, 1.2).

**B2. Task 2.4 forward-references 4.1.**
- 2.4 says "the parity name-pair table (see 4.1)". 4.1 runs the same table through Add, restore, bulk and the client hint. Those routes and the client do not exist at section 2.
- Fix:
  - 2.4 owns the pure-function table: the finder, plus `planDefaultRestore` driven with the same pairs. This is the real parity guard, because D1 deliberately does not share control flow.
  - 4.1 owns only the route-level legs (Add, single restore, bulk).
  - The client-hint leg moves to section 6, after 5.1. It cannot be built in a backend test section.
  - Define the table once as an exported test fixture so all three legs consume one copy. Otherwise the legs drift, which is the same failure mode this change exists to fix.

**B3. The shared error-type union (2.3) can break the frontend build before section 5.**
- 2.3 introduces a discriminated union on `code`, with the aim that a bare-409 branch fails type-checking. The frontend callers that read `error.code` ad hoc are only updated in 5.3 and 5.4.
- If the union replaces what callers use today, the frontend is red between sections 2 and 5. If it is only additive and unused, it enforces nothing until section 5.
- Fix: state in 2.3 which one it is. Preferred: additive export, with the frontend adoption (and the resulting compile fixes) in 5.3 and 5.4.
- Add a checkpoint: build shared, then confirm backend and frontend still compile and pass before section 3 starts. Design says build order is shared, then backend and frontend, and no task has this gate.

**B4. Test flips (4.5) are separated from the behaviour change (3.2).**
- 3.2 reverses the #218 behaviour. The existing "single restore ignores the duplicate rule" tests and `topic-add-flag-parity.test.ts` fail the moment 3.2 lands. 4.5 comes two sections later, so the tree is red for the whole of section 3.
- Fix: do the flips in the same step as 3.1 and 3.2. Either fold 4.5 into them or order it immediately after, with an explicit "red until 4.5" note.
- The same applies to 5.1. Its changed `findDuplicate` signature breaks existing tests, and the task already says "update callers and tests", so that one is fine.

## Split or reorder

**S1. Task 2.3 mixes three artifacts across two packages.** Split into:
- 2.3a (shared): the `TOPIC_NAME_ACTIVE` code, the union type and the exports in `index.ts`.
- 2.3b (backend): `buildErrorEnvelope` `extra` parameter, the widened `ErrorEnvelope.error` type and the no-`extra` byte-equality test. This lives in `packages/backend/src/routes/error-envelope.ts`, not the shared package, and it is a prerequisite of 3.1.
- Putting 2.3b under "2. Shared package" hides a backend dependency of section 3. It should be the first task of section 3 or a clearly labelled 2b.
- The byte-equality test is a risk control on a builder every route uses. It should be written and green before any handler uses `extra`.

**S2. Task 5.4 is the largest task and covers four independent changes.** Split into:
- (a) the `submitRestore` `code` branch with client-owned fixed text and the persistent row message.
- (b) the `submitArchive` success reset of `restoreState`.
- (c) the `restoreDefaults` `code` branch and the `NAME_ACTIVE` vocabulary alignment.
- (d) a first step: read how `restore-error-${topicId}` renders relative to the confirm dialog. Design flags this as unverified, and (a) depends on the answer.
- (b) and (a) are coupled by the single-slot `restoreState`, so order them (a), then (b). (c) is independent and can be done in either order.

**S3. Task 3.5 is documentation and PR work sitting in the backend section.**
- The PR notes belong with 7.4.
- The threat-model note (HLA 8.1.1/8.2) is a document edit with no file path in the task. Name the path, and move it to section 7.
- The timing-floor and #305 deferral note belongs in the same PR-description bundle.
- Moving it out also removes the false impression that 3.x is blocked by it.

**S4. Tasks 3.3 and 3.4 are confirmations, not implementation.**
- Make them acceptance checks, run after 3.1 and 3.2, and back them with tests: 4.2 and 4.3 already assert no `force` effect and no audit row.
- Otherwise they are duplicate verification with no output. State what evidence is recorded.

## Inconsistencies to resolve

**I1. "Ship sections 1 to 4 first" contradicts the ship-together decision.**
- The legend and the proposal scope line say: if time slips, ship the server rule and shared function (sections 1 to 4) first.
- Design "Migration Plan" says an old client shows server text verbatim on restore and treats the unknown 409 as retryable on Add, and that ship-together is the mitigation.
- A server-only release leaves "Add anyway" in place on a click that now hard-fails. That is a broken experience, not a graceful partial.
- Fix: redefine the cut line. The minimum shippable unit is sections 1 to 4 plus 5.1 to 5.4 (the code branches and "Add anyway" removal) plus 6.1 to 6.3. What is cuttable is only the [OPT] items (4.4a, 5.5, 5.6).
- Either say so in the legend, or explicitly accept and record the interim UX. I recommend the former.

**I2. Task 3.3 says bulk restore is "untouched apart from the shared helper", but 2.2 and D1 say bulk is not routed through the finder.**
- The only thing bulk shares is `normalizeTopicNameForMatch`, which it already uses. The proposal also says bulk "now shares the one comparison function".
- Fix: change 3.3 to "bulk restore code unchanged (diff is empty)". Make the proposal wording match: shared normalizer, not shared finder.
- An empty diff is a checkable outcome. The current wording invites someone to refactor bulk, which the design excludes.

**I3. Task 7.3a is marked "subject to the PO confirmations in the proposal".** The proposal lists both confirmations as received (via Devon). Drop the conditional, or record the date and source, so a reader does not take it as an open gate.

## Smaller notes

- Task 1.2 and the 4.4 fallback: if the existing harness cannot do Add/Add or restore/restore, the whole R7 guarantee is untested. The "note the gap in the PR" fallback is acceptable, but it needs a named owner and a follow-up. Otherwise the lock-serialisation claim (D2) rests on reading code alone.
- Task 7.1 (REST contract) is a consumer-facing interface. It could come before sections 3 and 5, so backend and frontend are both written against one agreed shape. It is currently last and effectively written from the code. I rate this advisory: the body is already fully specified in D4, so there is little risk, but contract-first is cheaper to review.
- Task 8.2 should name the four delta spec files and confirm they exist in `openspec/changes/enforce-active-name-duplicate-rule/specs/`. tasks.md never references authoring them. If they exist, add a task item "verify spec precedence text matches D3's decided ordering" (pre-lock 422, then in-lock re-read 422, then 409).
- Task 4.7 extends the identifier-hygiene test and the log-capture assertion. Both depend on 3.1 and 3.2 having no name-bearing log lines. Fine, but 4.7 should run after 4.2 and 4.3, as it extends them.

## Proposed order (summary)

1. Read-only confirmations: 1.1, 1.2.
2. Shared: 2.1, 2.2, 2.3a, 2.4 (pure-function parity table, exported fixture), then 1.3.
3. Checkpoint: build shared; backend and frontend compile and pass.
4. Backend envelope: 2.3b with its byte-equality test.
5. Backend handlers: 3.1, 3.2, with 4.5 flips in the same step. Then 3.3 and 3.4 as acceptance checks.
6. Backend tests: 4.1 (route legs), 4.2, 4.3, 4.4, 4.4a, 4.6, 4.7.
7. Contract doc 7.1 (can move earlier).
8. Frontend: 5.1, 5.2, 5.3, then 5.4 split (d, a, b, c). Then [OPT] 5.5 and 5.6.
9. Frontend tests: 6.1 to 6.3, plus the client leg of the parity table.
10. Docs and PR bundle: 7.2, 7.3, 7.3a, 7.4, plus the relocated 3.5.
11. Wrap-up: 8.1, 8.2.

No security or boundary objection to the design itself. Server-side enforcement in the lock, no override, and a role-independent response are all sound. The findings above are about sequencing and task hygiene only.
