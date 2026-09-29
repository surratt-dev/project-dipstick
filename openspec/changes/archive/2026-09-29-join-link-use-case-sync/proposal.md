## Why

`requirements/use cases/02 - Session Setup - Use Cases.md`'s "Copy Session Join Link" use case has drifted out of sync with the app: `join-link-display-copy` (#45, archived 2026-09-24) had to resolve four ambiguities in it by inference during exploration and proposal, and recorded the resolutions only in its own archived documents (`exploration-notes.md`, `propose-review-ba.md`, `explore-review-ba.md`, `specs/join-link-copy/spec.md`) — never back in the source use case. Both of the Business Analyst's reviews on that change independently flagged this as the one real gap left open. Left unresolved, the next exploration pass that starts from the use case document alone will re-derive (or mis-derive) the same four settled answers from scratch. This change closes that gap now, per GitHub issue #165.

## What Changes

- Update `requirements/use cases/02 - Session Setup - Use Cases.md`'s "Copy Session Join Link" use case in five places, transcribing decisions that are already settled and shipped (no new decisions made):
  - **Preconditions**: name the concrete component (`DraftSessionHost`'s `draft-control-view`/`live-readiness-view` branches), explicitly disclaim `SessionLobbyPage` (tracked separately as #164), and note the use case now legitimately spans both `draft` and `lobby`+ status.
  - **Main Flow step 1**: a small consistency edit so it doesn't still say "the session room" after Preconditions drops that ungrounded phrase.
  - **Alternate Flows**: add a new flow for a rejected `navigator.clipboard.writeText()` promise, treated identically to "Clipboard API unavailable."
  - **Acceptance Criteria**: replace the unmeasurable "displayed prominently... at all times before the session begins" bullet with concrete, testable conditions for both `draft` and `lobby`+ states, and state the settled draft-state copy-button availability explicitly.
  - **Main Flow step 4**: pin the confirmation banner's exact text ("Link copied", no "e.g." hedge) and its 8-second auto-clear duration.
- This is a documentation-only change. No application code is touched, and no existing `openspec/specs/` capability's requirements change — the settled behavior these edits describe was already fully specified and shipped by the archived `join-link-display-copy` change.

## Capabilities

### New Capabilities
None — this change adds no new capability.

### Modified Capabilities
None — no `openspec/specs/` capability's requirements are changing. This change updates a `requirements/use cases/` source document to match requirements that were already shipped via the `join-link-copy` capability spec (`openspec/specs/join-link-copy/spec.md`, created by the archived `join-link-display-copy` change). That spec itself is not modified here.

## Impact

- **Affected file:** `requirements/use cases/02 - Session Setup - Use Cases.md` ("Copy Session Join Link" use case section only).
- **Not affected:** application code, `openspec/specs/join-link-copy/spec.md`, the archived `join-link-display-copy` change directory.
- **Traceability:** closes GitHub issue #165, which was filed per BA review (`propose-review-ba.md` §1, `explore-review-ba.md` §4) of the archived `join-link-display-copy` change.
