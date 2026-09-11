# Architecture Review: `vote-compose-recovery` tasks.md ordering

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task sequencing and dependency correctness only — specifically, does Group 7 (backend snapshot) correctly precede Group 8 (frontend consumption), and does anything in Group 8 rely on something from Group 7 that isn't declared as a dependency. Domain model, UX, and ritual semantics are out of my scope per standing practice.

**Verdict: Group 7 → Group 8 sequencing is sound and explicitly stated. One lower-severity forward-reference in Group 4 is worth tightening. No hidden dependency found in Group 8.**

---

## 1. Group 7 → Group 8 ordering is correct and grounded in the real codebase, not an assumption

Group 7's header states plainly: "It must land before task 8.1 (frontend wiring) can be attempted against a real payload, so complete 7.1–7.5 before starting 8.1." That's the right call, and it's not a paper dependency — I verified it against the actual state of the repo rather than taking design.md's description on faith:

- `packages/backend/src/realtime/websocket-routes.ts` today shows exactly the registration sequence design.md D3c describes: `connectionRegistry.register` → `scheduleForceClose` → `scheduleReauthorizationSweep` → `scheduleTokenRefreshMonitor` → `await checkAndRecordGraceRecovery(...)`, all inside one unprotected `void (async () => {...})()` IIFE with no `try/catch`. Task 7.4's ordering requirement ("strictly after those three have run, own try/catch, never throw past it") is therefore an instruction to insert into real, already-merged code — not a task assuming infrastructure that hasn't been built.
- `safeSend` (imported from `connection-registry.js`) and the `reauth_required` single-connection send pattern task 7.4 references both already exist in `connection-token-refresh.ts`.
- `evaluateSessionSubscriberAccess`, `SessionStatus`, and `SessionTopicStatus` (the latter two needed for task 7.1's payload type) all already exist in `packages/shared/src/types/session.ts` and `packages/backend/src/auth/session-subscriber-access-helper.ts`.
- The DB schema (`packages/backend/migrations/2_create_tables.sql`) confirms `sessions.current_topic_id`, `session_topics.status`, and `votes.voter_id`/`votes.session_topic_id` match D3c's query exactly, and `sessions.ts`'s `INSERT INTO votes ... ON CONFLICT (session_topic_id, voter_id) DO UPDATE` confirms a `votes` row is written at lock-in time (not only at reveal), which is what makes `v.id IS NOT NULL` a valid "has locked in" test in task 7.2/7.3.

Nothing in Group 7 assumes unbuilt backend infrastructure. This is exactly the kind of implicit-assumption risk I'd normally expect to find in a "the payload will send itself" scoping — it isn't present here.

## 2. Internal Group 7 sequencing (7.1 → 7.2 → 7.3 → 7.4 → 7.5) is correct bottom-up build order

Types before implementation (7.1 before 7.2), implementation before its own unit tests (7.2 before 7.3), implementation before the call site that wires it in (7.2 before 7.4), wiring before the integration test that exercises it end-to-end (7.4 before 7.5). No task in this group assumes a later task's output. This is the right shape.

## 3. Group 8 does not secretly need anything from Group 7 that isn't declared

Task 8.1 explicitly names its Group 7 dependency ("using the `session_registration_snapshot` payload built in Group 7 above"). Task 8.2 depends on issue #32 (external, correctly flagged) and, implicitly, on 8.1 having landed — that transitive link isn't spelled out in 8.2's own text but is unambiguous from context (an E2E scenario needs the wiring first). Minor clarity nit only, not a defect: consider adding "(after 8.1)" to 8.2's text so a future reader doesn't have to infer it.

I checked for the more dangerous failure mode — Group 8 relying on backend behavior *not* listed as a Group 7 deliverable (e.g., a "topic changed" push for an idle connected participant) — and design.md's Open Questions section already surfaces this explicitly as a known gap Group 8's eventual implementer must not assume is solved. That's the right way to handle a real gap: named, not buried.

## 4. One forward-reference worth tightening: task 4.1 vs. Group 7

Task 4.1 (Group 4, which precedes Group 7 in the file) reads: `restoreDraft(registrationPayload)` accepting a payload "shaped like `SessionRegistrationSnapshotPayload` (design.md D3a; built server-side in Group 7 below)." Design.md D3a's own text disambiguates this correctly — "Contract-level tests here use fixture objects matching this shape; Group 7 builds the real payload" — meaning Group 4 is meant to use a locally-scoped structural type, not a literal cross-package import of a type that (if built strictly in file order) wouldn't exist yet when Group 4 is implemented.

This is low severity, not a blocking reorder: only "Group 7 before Group 8" is stated as a hard requirement anywhere in the document, so nothing prevents Groups 1–6 and Group 7 from being built in either order or in parallel, and TypeScript's structural typing means any shape drift between Group 4's local type and Group 7's canonical `SessionRegistrationSnapshotPayload` would surface as a compile error the moment task 8.1 wires the real payload in — a natural, if late, backstop.

Recommendation: add one clause to task 4.1 making the decoupling a stated decision rather than something an implementer has to infer — e.g., "define a local structural type for this parameter (do not import `SessionRegistrationSnapshotPayload` from `packages/shared` here — Group 7, which defines it, is not a dependency of this group)." This removes the temptation for whoever implements Group 4 first to reach for a cross-package import that may not resolve yet, and makes explicit what is currently only implied by design.md's D3a commentary.

## Summary table

| Check | Result |
|---|---|
| Group 7 before Group 8 stated as hard dependency | Yes — Group 7 header, explicit |
| Group 7 internal sequencing (types → impl → unit tests → wiring → integration tests) | Correct |
| Group 7's backend call sites (`scheduleReauthorizationSweep` etc.) verified to already exist | Yes — confirmed against `websocket-routes.ts` directly |
| Group 7's DB assumptions verified against actual schema/write path | Yes — `votes` row written at lock-in, matches D3c/D3d |
| Group 8 hidden (undeclared) dependency on Group 7 | None found |
| Group 8 hidden dependency on unbuilt infra outside this change | None found; the one real gap (no live topic-change push) is named in Open Questions, not hidden |
| Minor issue | Task 4.1's forward reference to Group 7's type should be tightened to state explicitly that Group 4 uses a local structural type, independent of Group 7's build order |
