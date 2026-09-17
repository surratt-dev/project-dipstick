# Tasks Review — auth-audit-correlation-fields

Reviewed by: Ingrid Sollenberger (Solution Architect)

**Verdict: Approve, no reordering or splitting required.**

## What I checked

The brief asked specifically whether task ordering respects architectural dependencies —
no test task should assume an `auth.ts` change that hasn't been done yet — and whether
the failure-path test task (2.3) depends on anything beyond what's already listed earlier.
I didn't take design.md's and proposal.md's claims about the code on faith; I read
`packages/backend/src/routes/auth.ts` directly, the same way I verified the
`executeJoinFlow` claim in the design review (see design-review-disposition.md).

## Dependency check

Group 1 (field additions) is entirely ordered before Group 2 (tests), and Group 2 before
Group 3 (verification). Within that:

- **Task 2.1** (field-presence assertions on `auth.callback_received`, `auth.session_created`,
  `auth.success`) depends on all of 1.1–1.3. Satisfied — it's sequenced after all three.
- **Task 2.2** (cross-event `correlationId` identity, success path, including
  `auth.first_access_created`) depends on 1.1–1.3 for the three modified sites, and on
  the pre-existing (untouched) `auth.first_access_created` emission for the fourth value
  it compares against. Satisfied — `auth.first_access_created` already emits
  `correlationId` today (auth.ts:227–235, added by the first-access change), so no new
  task is needed to make that value available; Group 1 doesn't need to touch it and
  doesn't.
- **Task 2.3** (cross-event identity, failure path: `auth.callback_received` → `auth.failure`).
  This is the one the brief flagged for special scrutiny. I confirmed against the current
  code (auth.ts, grep for the emit sites):
  - `auth.callback_received` (line 171) currently emits `sourceIp`, `stateNonce`, `success`
    — **no** `correlationId`. Task 1.1 is what adds it.
  - `auth.failure` in the `catch` block (line 354) **already** builds `auditFields` with
    `correlationId` included (line ~340), reading the same `const correlationId` bound at
    line 119. This is pre-existing, untouched by this change.
  - So task 2.3's dependency set is exactly `{1.1}`, which is listed earlier in the file.
    It does not depend on 1.2 or 1.3 (those touch `session_created`/`success`, which never
    fire on the failure path) and does not require any auth.ts change beyond what's
    already in Group 1. Confirmed: no gap.

- **Test feasibility.** I also checked that the test scaffolding tasks 2.1–2.3 assume
  actually exists: the success-path test at auth.test.ts:323 and the new-user test at
  auth.test.ts:408 both drive the handler through a real `app.inject()` call and capture
  every `emitAuditEvent` call via `mockEmitAuditEvent.mock.calls`, so extending either to
  pull `correlationId` off multiple named events (as 2.2 requires) is mechanically
  straightforward with the existing mock, not a new test infrastructure need. The
  "missing claims rejection (Task 12)" describe block at auth.test.ts:469 already exercises
  a callback-received-then-reject path with a captured `auth.failure` args, which is a
  real fit for 2.3's "existing missing-claims rejection tests" pointer.

## Line-number accuracy

Task 1.1–1.3 cite lines 171, 279, 284. Grepped the actual file: `auth.callback_received`
is at 171, `auth.session_created` at 279, `auth.success` at 284, and the `correlationId`
binding referenced by 1.1 is at 119 — all exact matches against current `auth.ts`, not
stale references from an earlier draft.

## Non-blocking observations

- Grouping by phase (all field additions, then all tests, then verification) rather than
  interleaving per-event is a reasonable structure for a change this size and doesn't
  create any ordering risk — nothing in Group 2 could be attempted before its Group 1
  dependency exists, since the whole group precedes it.
- No task exists to update `specs/auth-error-handling/spec.md` in this change directory —
  I checked, and it doesn't need one: the delta spec is already fully written (including
  the new "Correlation ID is identical across all events from one callback invocation"
  scenario) as a proposal-stage artifact, not an implementation task.

## Net effect

No changes requested to tasks.md. Ordering respects every dependency I could find,
including the one the brief asked me to verify by name.
