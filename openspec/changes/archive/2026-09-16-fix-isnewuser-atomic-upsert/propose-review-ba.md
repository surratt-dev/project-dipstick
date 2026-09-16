# Business Analyst Review — Proposal (fix-isnewuser-atomic-upsert)

**Reviewed by:** Marcus Delgado, Business Analyst
**Reviewing:** `proposal.md`, cross-checked against `tasks.md`, `design.md`, `specs/first-access/spec.md` (delta), the live `openspec/specs/first-access/spec.md`, and `requirements/use cases/01 - Identity and Access - Use Cases.md` (UC: First Access).

---

## Bottom line

Both defects I flagged against the exploration notes are fixed, and this proposal is a significant step up from that document in exactly the dimension I raised: the acceptance conditions are no longer implied by prose, they're enumerated as checkable line items in `tasks.md` with explicit "what would pass mechanically but prove nothing" call-outs. This is close to buildable as-is. I have one structural gap worth resolving before implementation starts (the Known Limitations/Open Issues update sits outside the formal spec-delta mechanism and the proposal's own Capabilities section blurs that distinction) and two small precision notes. Nothing here should block moving forward; the structural gap should get an explicit answer, not necessarily a rewrite.

## Verification of the two previously-flagged defects

1. **Wrong archived-doc path.** Confirmed fixed. The current `exploration-notes.md:15` cites `openspec/changes/archive/2026-07-05-first-access/implementation-review-security.md` and `.../implementation-review-architect.md` — the correct path. `proposal.md` itself doesn't cite the archived docs at all, so there's no path to get wrong there either. Closed.

2. **Missed second `isNewUser` consumer.** Confirmed fixed, and fixed in the place that matters most. `proposal.md`'s "Not in scope" line now reads: *"no change to either existing consumer of the flag (`auth.first_access_created`, `auth.success`'s `isFirstAccess`)"* — both named, matching what I verified at `auth.ts:220-225` in the exploration review. `design.md`'s Context section and `tasks.md` 1.4 also name both consumers consistently. Closed.

## Are capabilities specific enough to implement?

Read in isolation, `proposal.md`'s "Modified Capabilities" section is one dense paragraph — a reader relying on the proposal alone would need to infer the checkable form. But this proposal is not meant to be read in isolation: `tasks.md` operationalizes every clause into a numbered, file-and-line-scoped task, and `design.md` states the two acceptance gates I asked for in the exploration review nearly verbatim (Decision 2's "must not be accepted" framing for the concurrency test; the explicit `auth.ts` empty-diff check). Taken as a set, capability + design + tasks, this is buildable without a round trip back to me. I have no open "what did you mean by this" questions.

One specific check worth naming: `tasks.md` 2.2 explicitly carves the concurrency test out ("except the concurrency test, handled in 2.3") before the mechanical migration step, and 2.4 requires a grep-confirmed sweep for leftover `calls[1]` references. That's exactly the gap I was worried about in the exploration review (partial migration silently passing) — it's now closed as a stated, checkable step rather than something a reviewer has to notice on their own.

## Are acceptance criteria explicit or implicit?

Mostly explicit. The strongest example is Decision 2 in `design.md`, which states not just what the rewritten concurrency test must assert, but what a mechanically-passing-but-meaningless version of that test would look like ("a rewrite that mocks both calls returning `is_new_user: true`... must not be accepted"). That's the precise "prospective, checkable" framing I asked for — a reviewer doesn't have to re-derive intent, they have a negative example to check against.

The one place acceptance criteria remain implicit rather than explicit:

- **Task 3.3** says the Open Issues line for #8 should be "removed (or move to a Resolved/Closed list, creating one if this is the first closed issue)." This is a decision deferred to implementation time rather than resolved now. It's a minor thing and either outcome is fine substantively, but "creating one if this is the first" is exactly the kind of open-ended instruction that produces two different-looking correct answers from two different implementers. Since I checked and can confirm: there is currently no Resolved/Closed section anywhere in `openspec/specs/first-access/spec.md`'s Open Issues section, so this **will** be the "first closed issue" case. Worth just deciding now (I'd lean toward "remove the line entirely" — the spec doesn't currently carry a closed-issue ledger, and inventing one as a side effect of this change is scope beyond what's needed) rather than leaving the choice open for whoever picks up task 3.3.

## Structural gap: Known Limitations / Open Issues edits sit outside the spec-delta mechanism

This is the one item I'd flag as needing a decision rather than a nitpick. `specs/first-access/spec.md` (the delta file in this change) states under REMOVED Requirements:

> "No requirement is removed... The related Known Limitations entry and Open Issues line for #8 are updated directly in `openspec/specs/first-access/spec.md` at archive time... those are prose sections outside the Requirements delta format, not requirement-level changes."

That's an accurate description of a real limitation in the delta format — Known Limitations and Open Issues are prose sections, not modeled requirements, so the ADDED/MODIFIED/REMOVED mechanism genuinely can't express "delete this bullet." Tasks 3.2 and 3.3 correctly pick this up as explicit manual edits. My concern is narrower: `proposal.md`'s own Capabilities section says the `first-access` capability change *"removes the Known Limitations entry and Open Issues line for #8"* as if that's part of what the capability delta covers, when the delta file itself is explicit that it is not. A reviewer who reads only `proposal.md`'s Capabilities section (which is a reasonable thing for a reviewer to do — it's the summary layer) would reasonably expect to find that removal reflected in the spec diff, and it deliberately isn't there.

This isn't a defect in the plan — tasks.md correctly tracks the work — but it is a place where the proposal's own summary overstates what the formal delta contains. I'd suggest one of:
- Tighten the Capabilities bullet to say the removal happens "as a direct edit alongside the delta, tracked in tasks.md 3.2/3.3" rather than describing it as something the capability delta itself does, or
- Confirm with whoever owns the archive/sync tooling that a direct prose edit outside the delta file is an accepted pattern for this kind of change (it may well be — I'm flagging the inconsistency between documents, not asserting the mechanism is wrong).

Either resolves it; I don't have a strong preference between them.

## Cross-check against requirements/use cases/01 - Identity and Access - Use Cases.md (UC: First Access)

No conflicts. The use case's acceptance criteria operate one level above where this fix lives — "a user with no existing account... receives a new account automatically," "a user who authenticates a second time is matched to their existing account" — and none of them depend on how `isNewUser` is *derived*, only on the account-creation behavior itself, which this change explicitly does not alter (confirmed against `specs/first-access/spec.md` delta: Scenario text for "First-time user authenticated" and "Returning user authenticated" is unchanged from the live spec). This proposal is correctly scoped as an internal mechanism fix that doesn't touch anything the BRD-level use case cares about.

## Line-citation spot check

I re-verified the two line ranges the proposal's supporting docs depend on against the current file state (not just the exploration notes' prior verification, in case the file moved since):
- `account-resolver.ts:104-125` — HARD CONSTRAINT comment block and SELECT query: still matches (comment block runs 104-121, SELECT 122-125 in current file — a few lines off from the exploration notes' 104-122/123-129, likely from incidental drift since that review; not worth a task, but whoever picks up task 1.1/1.3 should re-locate by content, not by memorized line number).
- `teams.ts` is 838 lines; the cited `746-766` xmax comment range is internally consistent with prior verification.

No path or cardinality errors found this round — this is a precision note, not a new defect class.

## Recommendation

Proceed. Resolve the Capabilities-section-vs-delta-file inconsistency (pick one of the two framings above) and make an explicit call on task 3.3's "remove vs. create a Closed list" branch before implementation starts; neither requires re-opening design decisions. Everything else — capability specificity, acceptance criteria, scope boundary, consumer inventory — is proposal-ready.
