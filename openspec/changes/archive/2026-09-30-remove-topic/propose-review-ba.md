# BA Review — `remove-topic` Proposal

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `proposal.md`, `design.md`, `specs/remove-topic/spec.md`, `specs/topic-customization-lock/spec.md`, `specs/topic-management-screen/spec.md`, `tasks.md`, cross-checked against `requirements/BRD.md` (FR-8, FR-7) and `requirements/use cases/08 - Topic Management - Use Cases.md`, and spot-checked against the shipped code in `packages/backend/src/routes/topics.ts` and `standing-facilitator-access-helper.ts`.

**Overall:** This is the most rigorously specified change I've reviewed on this project. The specs use explicit Given/When/Then scenarios with concrete status codes and reason codes throughout — not one of my usual "what did you mean by this?" callbacks would apply to the cascade, the confirmation flow, or the audit posture. I have one finding I consider blocking (Finding 1), and it's not one of the two the team flagged for my attention — it's something I found cross-checking against FR-8.2. The two flagged items follow as Findings 2 and 3.

---

## Finding 1 (New, BLOCKING) — Application Administrators cannot archive a topic, contradicting FR-8.2 [HARD]

**FR-8.2** [HARD]: *"After a team's first session, the facilitator **or Application Administrator** shall be able to add, remove, or reorder topics for that team."*

`specs/remove-topic/spec.md`'s requirement for `DELETE .../topics/:topicId` reads:

> SHALL allow an authenticated user with `global_role = 'facilitator'` who is not an active member of the target team to transition that team's topic from `active` to `archived`...

There is no `application_admin` branch anywhere in the requirement, the scenarios, or design.md Decision 1/2's cascade. I checked the shipped code this design reuses verbatim (`checkStandingFacilitatorAuthorization` in `packages/backend/src/routes/topics.ts:83-125`, called via `evaluateStandingFacilitatorAccess`): it 403s any caller whose `global_role !== 'facilitator'`, with no admin carve-out. This is a pre-existing gap from TOPIC-003 (#49/#50), not introduced by this change — but this change reuses it verbatim for TOPIC-004 (Decision 1: "reusing the same `evaluateStandingFacilitatorAccess`... helpers TOPIC-003 already uses"), so it now also governs *removal*, not just addition.

What makes this more than an inherited gap worth a shrug: **this same change adds admin access to TOPIC-002 in the same file set.** Decision 9's authorization for `GET .../topics/all` is explicitly `global_role = 'facilitator' ... OR global_role = 'application_admin'`, and `specs/topic-customization-lock/spec.md` has a scenario confirming it ("An application admin can list any team's topics"). So within this one proposal, an application_admin can *read* a team's topic list via TOPIC-002, will see the new Topic Management screen render normally with a "Remove" button per row (nothing in Decision 10's frontend design gates the button on caller role beyond generic screen access), and will get a confusing 403 the moment they click it — because TOPIC-004 never checks for `application_admin` at all. That's not a latent gap sitting quietly in unused code; it's a concrete, shippable UX inconsistency this exact change introduces into a screen it is building for the first time.

**Ask:** before this goes to implementation, make an explicit decision — either (a) extend TOPIC-004's cascade to accept `application_admin` (and confirm whether TOPIC-003's existing gap should be fixed in the same pass, since it's the identical helper), or (b) if admin support for add/remove is being deliberately deferred, say so on the record in design.md's Non-Goals with a reason, the way this design already does for every other deferred item. What I don't want is for this to ship as a silent gap nobody decided — that's exactly the pattern this design has otherwise been careful to avoid everywhere else (see how deliberately Decision 9 documents *why* TOPIC-002 needs the admin branch). FR-8.2 is HARD, not PREF; this isn't a nice-to-have being triaged out.

---

## Finding 2 (Flagged for review) — Open Question 1's scoping boundary: proposal.md understates the size of the gap it's stepping around

I verified design.md's underlying claim directly against the codebase: grepping `packages/backend/src` for any write to `session_topics` outside test fixtures turns up only `UPDATE` statements (`facilitator-sessions.ts:1221,1613,1794,1861`) — never an `INSERT`. Design.md is correct: **no shipped endpoint populates `session_topics` at session creation, for any team, today.** That means `POST .../begin-voting` cannot succeed for *any* session in production right now, not only for teams that happen to reach zero active topics through this change's new archive endpoint.

Design.md states this clearly, in the Context section and again in Open Question 1. Proposal.md does not. Proposal.md's "What Changes" bullet 3 frames the `facilitator-sessions.ts` fix like this:

> "...this change does not let a team's protection from that crash depend on a single check holding under every future code path (a race, a future endpoint, a migration)."

That sentence reads as defense-in-depth reasoning for a narrow, contained fix — language like "a race," "a future endpoint," "a migration" implies the crash is a rare edge case being hardened against, not a condition that is, as far as this review can tell, *currently true for every session that has ever been created.* A reader of proposal.md alone — which is the document a PM or stakeholder is more likely to actually read — would reasonably conclude this change closes out the begin-voting risk. It doesn't; it converts an unconditional crash into an unconditional clean 409, which is real and worth doing, but "session start cannot currently work for anyone" is a materially different fact than what the proposal communicates.

To be clear on scope, I'm not asking this change fix the underlying gap — Decision 8's non-goal reasoning is sound, and re-scoping a "remove topic" change to also build session-creation's snapshot mechanism would be exactly the kind of scope-blur I'd normally be the one objecting to. My concern is narrower: **a finding of this severity shouldn't live only in an Open Question at the bottom of design.md.** Two concrete asks:

1. Add one sentence to proposal.md's Impact or "Companion fix" bullet stating plainly that this is a pre-existing, total gap (not scoped to this change's trigger condition), matching what design.md's Context already says. This is a one-line addition; the investigative work is already done.
2. Open Question 1 says this "should be tracked as its own follow-up rather than left to be rediscovered" — but nothing in tasks.md actually files that follow-up. Add a task (e.g., 11.5) to open a tracked issue for the `session_topics` snapshot-at-creation gap before this change is considered done, so "someone should know about this" doesn't quietly depend on whoever reads design.md's Open Questions section next. Given what this implies about every session today, I'd treat filing that issue as more time-sensitive than this change's own merge — worth raising with whoever owns `session-topic-lifecycle` now, not after.

---

## Finding 3 (Flagged for review) — Decision 6's `archived_by` column: justified, not scope creep, but undertraced

My read: this is **not** disproportionate scope creep. The technical case in Decision 6 is sound and I'd have made the same call — `audit_log.metadata` is an unindexed JSONB blob, and the codebase already has direct precedent for promoting "who/when" facts to first-class columns when they're product-relevant rather than audit-only (`action_items.resolved_in_session_id`, `action_items.resolution_note`). The migration is additive, nullable, needs no backfill, and is transparently declared in proposal.md's Impact section rather than smuggled in — that's exactly the standard I'd hold any schema change to, and it's met.

Where I'd push: **this requirement has no home in the requirements documents**, and it should. Neither FR-8 nor the "Remove a Topic" / "Re-Add a Previously Removed Topic" use cases mention provenance (who archived a topic) anywhere — this requirement originates entirely from Priya's facilitator-workflow review during exploration, which is a legitimate way for a real gap to surface, but right now it's traceable only to a design doc's "Why" paragraph, not to a numbered requirement. That's the exact gap I care most about closing on this project (see my "Traceability From Requirement to Feature" concern) — if someone six months from now asks "why does this column exist," the honest answer today would be "read Decision 6 of a design doc for an unrelated change," not a requirement.

**Ask:** tasks.md 10.5 already touches the "Remove a Topic" use case doc for the terminology/archive-state correction. Extend that same edit (or add 10.7) to add an Acceptance Criteria line to that use case — or to "Re-Add a Previously Removed Topic," whichever the team judges is the better home — stating that archived topics show who archived them and when. That's a small addition riding along an edit this change is making anyway, and it closes the traceability gap while it's cheap to close.

---

## Minor — use case doc line 241 is resolved but not on the update list

`08 - Topic Management - Use Cases.md`'s "Remove a Topic" use case, Notes section, line 241: *"Removal does not affect in-progress sessions. If a session is currently active, the removed topic will not be excluded from it until the next session begins. This edge case may need a decision."* This is fully resolved by `specs/remove-topic/spec.md`'s "An in-progress session is unaffected by a concurrent archive" scenario — the decision this line asks for has been made. Tasks.md 10.5/10.6 update the terminology, the out-of-scope archive-state line (232), and the last-topic note (211/240), but not this one. Low cost, same edit pass — worth folding in so the use case doc doesn't keep asking a question the design has already answered.

---

## What I did *not* find

- No vague or implicit acceptance criteria in `specs/remove-topic/spec.md`, `specs/topic-customization-lock/spec.md`, or `specs/topic-management-screen/spec.md` — every requirement has concrete status codes, reason codes, and ordering guarantees. This is buildable as written.
- FR-8.3 and FR-8.5 citations in proposal.md are accurate to BRD.md's actual text, including FR-8.5's `[PREF]` (not `[HARD]`) labeling — correctly represented.
- The check-ordering cascade (Decision 2) and its anti-enumeration reasoning are internally consistent and match the sibling change's established pattern; I don't have edge cases to add here.
- TOPIC-002/TOPIC-004 both correctly exclude "both default and custom topics can be removed using the same mechanism" (use case AC, line 227) — nothing in the cascade distinguishes topic origin, which is correct and preserves that AC without needing to restate it.

## Summary for sign-off

Recommend the team resolve Finding 1 before implementation starts — it's a HARD FR violation this change would ship as a concrete UX bug, not a hypothetical. Findings 2 and 3 are documentation/traceability fixes that ride along cheaply with edits this change is already making; I'd want them closed before I'd consider the requirements-documentation side of this change complete, but they don't block starting the backend/frontend work in parallel.
