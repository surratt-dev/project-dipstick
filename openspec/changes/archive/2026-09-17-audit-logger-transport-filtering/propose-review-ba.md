# Business Analyst Review — audit-logger-transport-filtering

Reviewed by Marcus Delgado, 2026-09-17.

## Overall

Buildable. This is documentation-only work and the capabilities are specified to a
precision I don't often see at proposal stage — the runbook content and code comment are
drafted verbatim in `exploration-notes.md` and the proposal says explicitly they're meant
to be lifted as-is. An implementer should not need to come back and ask "what did you
mean?" That's the standard I hold requirements to, and this clears it.

## spec.md ↔ tasks.md mapping

Mostly 1:1. Task 3.2 explicitly walks through scenarios (a)-(d) of Requirement 1 and the
Future Consideration scenario of Requirement 2 as verification criteria — good, that's
acceptance criteria stated as explicit conditions, not left implicit.

**Gap:** Requirement 3 (code comment discoverable in `audit-logger.ts`, with its own
scenario) has no corresponding verification step in section 3. Task 2.1 builds the comment
but nothing in section 3 checks it landed in the right place, adjacent to the level
override, pointing to the runbook. Cheap fix — add a 3.4, or fold it into 3.1's diff check
with an explicit content assertion, not just "a comment-only addition happened."

## "Future consideration" framing vs. issue #3 action 3

This holds up better than I expected on first read. I pulled the actual issue text: action
3 says "**Consider** a startup check..." — that's already a soft ask in the source, not a
hard requirement the proposal is quietly downgrading. Pairing the deferral with a real
trigger condition (build alongside the `emitAuditEvent` rework, before a filtering
transport ships) and a direct issue reference is a legitimate disposition, not an
accountability dodge — and design.md's own Risks section (D3, D5) already admits the
mechanism is human-diligence-only with no build-time enforcement. I'd rather see that
risk owned in the doc, as it is, than hidden.

## New finding: Open Issues list not updated

`openspec/specs/first-access/spec.md` (Open Issues, line 210) still lists `#3` as active.
The proposal's own "Why" section leans on this list as the traceability anchor ("its own
Open Issues list still names issue #3, which this change closes"), but neither tasks.md
nor the Impact section includes a step to mark it closed there once this change lands.
Without that, the spec doc that this proposal cites as proof of traceability will be
stale the moment the PR merges — the kind of gap that turns into a scope dispute later
when someone asks "is #3 actually closed?" and greps the spec instead of the issue
tracker. Recommend adding a task: update the `#3` line in first-access/spec.md's Open
Issues (mirroring the "closed (change-name)" pattern already used elsewhere in that file)
as part of this change.

## Verdict

Approve with two small additions to tasks.md: a verification step for the code comment
(Requirement 3), and a step to close out `#3` in first-access/spec.md's Open Issues list.
Neither changes scope or design — both are inside the documentation-only footprint this
proposal already commits to.
