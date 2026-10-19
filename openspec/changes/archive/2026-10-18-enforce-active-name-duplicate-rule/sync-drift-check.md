# Sync drift check (#299) - Ingrid Sollenberger, Solution Architect

Scope: main specs (restore-topic, add-custom-topic, topic-management-screen, bulk-restore-default-topics), REST API Contract, use case 08, BRD, HLA, against the uncommitted code.

## Result: no code/spec mismatches found

Verified against code:
- Main specs contain the delta requirements; the removed "Single restore is unchanged by the existence of bulk restore" requirement and its "ignores the duplicate rule" scenario are gone from specs and docs.
- Add (topics.ts): rule runs after 422 validation, inside the per-team lock, before the display_order read; ROLLBACK, timing floor, `Cache-Control: no-store`, no audit row, envelope keys exactly category/code/message/correlationId/conflictingTopicId/conflictingName (extras spread first, cannot overwrite base keys).
- Single restore: in-lock re-read, non-archived -> 422 TOPIC_ALREADY_ACTIVE (no no-store, matches the spec NOTE) precedes the name rule; lowest displayOrder then id named; same finder as Add (`findActiveNameConflict`); bulk keeps its own seen-set with parity pairs.
- Frontend: blocking Add message text, blank-name wording, nameBlock clears only on Name change, no override control, branch on `code` (never bare 409), server 409 refetches and keeps values, restore-row message text and role="alert", row message cleared by next restore or successful archive, locked-team message lacks the shared phrase, bulk skipped line now "an active topic with this name already exists" (matches screen spec line 1291).

## Doc fixes made
1. REST API Contract: "when An active topic" -> "when an active topic" (Add and Restore TOPIC_NAME_ACTIVE paragraphs).
2. BRD FR-8.2 and FR-8.6 traceability notes said "PROPOSED reading, pending Product Owner confirmation", contradicting the Resolved open-question entry. Aligned them to "Product Owner decision recorded in #299"; only the look-alike limitation stays PROPOSED/pending.
3. HLA 8.1.1 (i) and 8.2: said the 409 discloses the conflicting topic to `application_admin`; the response is identical for every role (spec and code). Reworded.

## Residual items (not changed)
- The Product Owner decision date in the BRD open-question entry is still "to be filled in by the PO".
- Look-alike limitation (accents, NFC/NFD, internal whitespace) remains PROPOSED pending PO confirmation in BRD, use case 08 and REST contract.
- Prompt-only warning button label changed from "Add anyway" to "Add it anyway" in code; no spec or doc fixes the label (spec only forbids an "Add anyway" control for the name block), so no drift, but tests keyed on the old label should be checked by the QA.
