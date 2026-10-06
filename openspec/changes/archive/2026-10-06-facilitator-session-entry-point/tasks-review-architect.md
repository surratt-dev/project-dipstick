# Tasks review: Facilitator session entry point (#237)

**Reviewer:** Ingrid Sollenberger, Solution Architect
**Artifact reviewed:** `tasks.md`, checked against `design.md` (revision 3), `proposal.md`, the spec delta, and the current code in `SessionCreationPage.tsx`, its test file, and `auth.test.ts`.
**Focus:** Do the tasks follow the architectural dependencies? Does any task assume something not yet built? Which actions face outward?
**Verdict:** **Approve with changes.** The build order of the code is sound. Sections 1, 2 and 3 touch disjoint files, and none needs another's output to compile or pass. The problems are one forward reference, one unstated premise in a test, a missing verification step, and a set of outward-facing actions written as implementer steps.

---

## 1. Dependency and ordering findings

### A1. 1.1(e) cites a test that 3.2 has not created yet (reorder)
1.1(e) asks for a comment "naming the backend tests from 3.2 that cover the other half of R4". 3.2 then says "Cite these by name in 1.1(e)'s comment". Three of the cited tests already exist (`role-map.test.ts`, `account-resolver.test.ts`, `role-claim-persistence-integration.test.ts`). The fourth, the new `/auth/session` `engineering_manager → canFacilitateSessions: false` assertion, does not exist until 3.2 runs, and its name is not fixed anywhere. An implementer working top-down would write a comment naming a test that does not exist, or guess its name.

**Change:** Move 3.2 ahead of 1.1. Renumbering is not needed if 1.1 opens with "Prerequisite: 3.2 done". Alternatively, split 1.1(e)'s comment into its own step after 3.2. Either way, the comment must quote the new test's actual `it(...)` title. Section 3 has no frontend dependency, so running it first costs nothing.

### A2. 2.1(i)'s "cite the existing gate test if one exists" rests on a false premise (fix)
`SessionCreationPage.test.tsx` has no test today for the `session && !session.canFacilitateSessions → <Navigate to="/" />` gate. I checked every `describe`/`it`, and no test sets `canFacilitateSessions: false`. The "cite instead of duplicate" branch therefore never applies, and the test has to be written.

There is also a harness trap. The file module-mocks `useNavigate`, but `<Navigate>` does not go through that mock, so asserting `mockNavigate` will not detect the redirect. The test must render under a `MemoryRouter` with a sentinel `<Route path="/" element={<div data-testid="at-landing"/>}/>`, which is the same pattern 1.1(a) uses.

**Change:** Rewrite the last sentence of 2.1(i) as "Add a gate test (none exists); assert the redirect with a sentinel `/` route, not `mockNavigate`."

### A3. D5a is verified in two halves, and only the walkthrough joins them (acknowledge, no split)
2.1(i) checks that `refreshSession` is called once on 403, using a static mock. It separately checks that a `false` flag redirects. No automated test shows that the refreshed context actually triggers the redirect. That is acceptable, because `AuthContext` is out of scope and its propagation is existing behaviour. But walkthrough step 8 is the only end-to-end evidence for the R8 alternative outcome, and it is marked **optional**.

**Change:** Make 4.1 step 8 required. Alternatively, add to 3.3's traceability note that the R8 redirect is covered by 2.1(i)'s two halves plus step 8, the same way R1 is treated.

### A4. 2.2's placement of the 403 check (clarify)
In `loadEligibleTeams` the `!res.ok` branch already calls `detectSessionExpiry(res)`, and that call reads the body. The `res.status === 403 → void refreshSession()` call must go **after** the `isSessionExpired` early return and before or beside `setListError`. It must not read the body again. The design says this, but the task text says only "on a non-expiry `res.status === 403`". There is a second `res.status === 403` branch in the same file, in the confirm-screen `POST /draft` handler, and the design explicitly says that one must not refresh. An implementer searching for `status === 403` will find that branch first.

**Change:** Add to 2.2: "in `loadEligibleTeams` only, after the `isSessionExpired` return. Do not touch the `POST /draft` 403 branch (D5a)." Add a negative test to 2.1(i): a confirm-screen 403 does not call `refreshSession`.

### A5. No typecheck in verification (add)
4.1 runs `npm test` and `npm run lint`. At the repo root, `lint` is `eslint .` only, and vitest does not typecheck. 1.1's fixture is supposed to be "correctly typed" (E6), and 3.1 extends `setupValidCallbackMocks` with `globalRole?: GlobalRole`. The tasks give nothing that would check either of those.

**Change:** Add `npm run typecheck -w packages/frontend` and `npm run build -w packages/backend` (or the equivalent `tsc --noEmit`) to 4.1.

### A6. No spec-delta validation (add)
No task checks the delta in `specs/session-creation/spec.md` against the tasks. R8's D5a alternative is already in the delta (spec lines 32 and 90), so the delta is current. The gap is that nothing runs `openspec validate facilitator-session-entry-point`, and nothing confirms R1–R11 still map one-to-one to tests at the end.

**Change:** Add to 4.1: run `openspec validate`, and confirm that each of R1–R11 maps to a named test or walkthrough step. The R-to-task mapping in 3.3 can be extended to all eleven.

### A7. Walkthrough premises to verify before step 6a (minor)
- Step 6a assumes that deactivating "Other" empties the picker. That holds only if the local database has no other active teams besides "Home". The task should say "on a fresh `docker compose` volume", or tell the implementer to deactivate every non-Home team.
- Step 5 assumes the "Home" join link is still redeemable after step 3 abandons that team's session. The design argues this through `resolveJoinLandingPath`. If redemption fails, the walkthrough stalls at step 5, so the implementer should record the observed behaviour rather than work around it.

### A8. Within-section order is correct
1.1 then 1.2, and 2.1 (harness first) then 2.2, are test-first and self-contained. 3.1's helper extension comes before its test. 4.1 tests before the walkthrough. Nothing else assumes unbuilt work.

---

## 2. Outward-facing actions: defer to the human or orchestrator

The implementer should **prepare text**, not act. The following steps are written as implementer instructions and should be re-marked.

| Task | Action | Problem | Change |
|---|---|---|---|
| **4.3** | File four issues, file a new audit issue, **comment on #247** | Outward-facing GitHub writes. "When this merges" is also after the implementer's PR, so the implementer cannot perform it in sequence. The "(Human: issue filing.)" tag sits under an imperative "file…" list, which is ambiguous. | Split: **4.3a (implementer)** drafts each issue body and the #247 comment, including the S-9 server-side requirements, in a "Follow-ups to file" section of the PR description. **4.3b (orchestrator/human, after merge)** files the issues and posts the #247 comment. **4.3c (after 4.3b)** links the issue numbers in `proposal.md`, at archive. |
| **4.3** (tail) | "link them in `proposal.md`" | Depends on issue numbers that do not exist until 4.3b, and edits the change directory after merge. | Move to 4.3c / archive (see above). |
| **4.2** | "Request Priya's walkthrough" | Asking a human stakeholder for review is outward. It is marked *(Human)* but sits inside an implementer task. | Split: the implementer writes the release notes; the orchestrator requests the review. |
| **3.3, 4.1, 4.2** | "State this in the PR" / "record in the PR description" | Opening or editing the PR is orchestrator-owned in this pipeline. | Rephrase as "add to the PR description draft" and leave opening the PR to the orchestrator. |
| **4.4** | Annotate the use case "at archive time" | Not an implementer action. It belongs to the archive stage. | Mark *(Archive stage)* and leave it unchecked by the implementer. |

The walkthrough's local SQL (4.1 steps 3, 6a and 8) is **not** outward-facing. It is labelled local-only per D6/S-8, which is correct, and it should stay out of any document that leaves the PR.

---

## 3. Architectural constraints: confirmed preserved by the tasks

- **Server authority.** No task moves a check to the client. 1.2 and 2.2 consume `canFacilitateSessions` and `/eligible-for-session` and add no filtering or pre-selection (D3).
- **Scope guard.** No task touches backend routes, schema, `AuthContext`, `App.tsx`, `SignOutButton`, `NoTeamPage` or any live-session component. The only backend edits are tests, and 3.1's helper extension is test-only.
- **Re-sync is bounded.** 2.2 adds one `refreshSession()` call on one status code, in one function, with no new dependency on `session`, so it cannot loop (D5a).

---

## Required changes (summary)

1. Move 3.2 before 1.1, or make 1.1(e)'s comment depend on 3.2 (A1).
2. Fix 2.1(i): add the gate test, and assert it with a sentinel route (A2).
3. Make walkthrough step 8 required, or add R8 to the traceability note (A3).
4. Pin 2.2's 403 hook to `loadEligibleTeams` after the expiry return, and add a negative test for the confirm-screen 403 (A4).
5. Add a typecheck/build step and `openspec validate` to 4.1 (A5, A6).
6. Split 4.3 into draft (implementer), file and comment (orchestrator, after merge), and link (archive). Split 4.2's review request out. Mark 4.4 as archive-stage (section 2).
