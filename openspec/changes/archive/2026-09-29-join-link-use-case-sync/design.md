## Context

This change is a documentation-sync fix, not a system design problem. `requirements/use cases/02 - Session Setup - Use Cases.md`'s "Copy Session Join Link" use case fell out of sync with `openspec/specs/join-link-copy/spec.md`, which the archived `join-link-display-copy` change (#45) created. All five edits transcribe decisions that are already final and shipped — see `assess.md` and `assess-review.md` in this change directory for the full traceability chain (each edit is cited back to a specific `spec.md` requirement and, where relevant, verified directly against `packages/frontend/src/pages/DraftSessionHost.tsx`).

No design document would normally be needed for a change like this (per the instruction's own criteria: no cross-cutting change, no new dependency, no security/performance/migration complexity, no ambiguity to resolve before writing). This file exists only because the schema requires it to unlock `tasks`; it stays minimal by design.

## Goals / Non-Goals

**Goals:**
- Update the five identified sections of the "Copy Session Join Link" use case so the document matches shipped, settled behavior.

**Non-Goals:**
- No application code changes.
- No changes to `openspec/specs/join-link-copy/spec.md` or any other capability spec.
- No new decisions — every edit transcribes an answer that was already reached and shipped in the archived `join-link-display-copy` change.

## Decisions

None. There is no technical choice to make here — `assess.md`'s "No architectural decision needed — confirmed" section traces each of the five edits to its settled source (`spec.md` requirements 1-4, cross-checked against exploration/review docs and, for component-naming claims, the actual `DraftSessionHost.tsx` code). The only "decision" made during this change's Assess stage was whether a fifth, adjacent drift item (stale confirmation-banner copy) belonged in scope — resolved by BA review (`assess-review.md`) to fold it in, since it too was already settled fact, not a new judgment call.

## Risks / Trade-offs

- **Line-number drift**: `assess.md`'s proposed edits cite specific current line numbers in the use case document. If an unrelated edit to an earlier use case in the same file lands first, those line numbers could shift. Mitigation: the Implement stage locates each section by its current heading/content, not by line number alone, before editing.
