# Business Analyst Review — Exploration Notes (fix-isnewuser-atomic-upsert)

**Reviewed by:** Marcus Delgado, Business Analyst
**Reviewing:** `openspec/changes/fix-isnewuser-atomic-upsert/exploration-notes.md`

---

## Bottom line

The technical substance here is unusually well-verified for an exploration doc — I checked every file/line claim I could and nearly all of them hold up exactly. That's the good news: this is closer to "ready to become a proposal" than most exploration notes I see. But it's a *code-fix* exploration, not a *requirements* exploration, and it reads that way: the acceptance conditions a proposal and its reviewers will need are implied by the prose rather than stated as checkable statements. I've verified the facts below and then flagged the handful of places where "ready to build" and "ready to hold someone accountable to" diverge.

## What I verified (traceability check)

I read the current state of every file the notes cite and compared line-for-line where a specific range was given:

| Claim | Verified against | Result |
|---|---|---|
| `resolveOrCreateAccount` structure, lines 88–176 | `packages/backend/src/auth/account-resolver.ts` | Exact match |
| HARD CONSTRAINT comment, lines 104–122 | same file | Exact match |
| SELECT query, lines 123–129 | same file | Exact match |
| Email-update-without-identity-match note, lines 133–140 | same file | Exact match |
| `row` destructuring / `ResolvedUser` construction, lines 158–175 | same file | Exact match |
| `users_oidc_unique` constraint, migration `2_create_tables.sql:13` | migration file | Exact match — confirms no migration is needed, as claimed |
| TEAM-006 xmax pattern in `teams.ts` | `packages/backend/src/routes/teams.ts` | Pattern matches; comment block is at 746–765, not 747–766 (off by one — trivial, not worth a task, but I'd tighten it before it's quoted in a proposal) |
| `teams.test.ts:850–905` mocking `is_new_row: true/false` | `packages/backend/src/routes/__tests__/teams.test.ts` | Content matches; note the file lives under `__tests__/`, not directly in `routes/` — fine as a short citation but a proposal task should use the real path |
| `account-resolver.test.ts` — ~13 test cases | `packages/backend/src/auth/__tests__/account-resolver.test.ts` | Exactly 13 `it()` blocks. Precise. |
| `makeUserRow()` helper, lines 22–39 | same file | Matches (helper body is 22–36; close enough) |
| Concurrency test, lines 180–209, asserts 4 calls + both `isNewUser: true` | same file | Exact match, including the assertion text |
| `openspec/specs/first-access/spec.md:201` — race documented as permanent constraint | spec file | **Exact line, exact claim.** This is the one citation in the whole document precise to the line. |
| `db.ts` uses plain `pg.Pool`, no pooler | `packages/backend/src/db.ts` | Confirmed — `new Pool({ connectionString: ... })`, nothing else in the stack |

One factual correction needed:

- **The archived review docs are at the wrong path.** The notes cite `implementation-review-security.md` "Follow-on 3" and `implementation-review-architect.md` "Constraint Verification" as living at `openspec/changes/first-access/...`. They don't — that directory doesn't exist. The real path is `openspec/changes/archive/2026-07-05-first-access/implementation-review-security.md` and `.../implementation-review-architect.md`. I confirmed both sections exist there with the content described (Follow-on Recommendation #3, and the "Constraint Verification" section). **This needs to be fixed before it goes into a proposal** — a reviewer who tries to click through on the citation as written will hit a missing path, which undercuts exactly the kind of traceability this document is otherwise good at.

## Clarification needed: the "sole consumer" claim is wrong, and it matters for your scope boundary

Section 1 states: *"The current sole consumer, the `auth.first_access_created` audit event ... tolerates duplicates by design."* Priya's facilitator review (`explore-review-facilitator.md`, already in this directory) traced this further than the exploration notes did and found a **second** consumer: `auth.ts`'s `auth.success` audit event carries `isFirstAccess: user.isNewUser` and fires on *every* authentication, not just first access. I re-verified this directly at `packages/backend/src/routes/auth.ts:220–225` — it's real.

This doesn't change the technical fix or the net assessment — both consumers are audit-log fields, both are duplicate-tolerant, neither is a UI or non-idempotent side effect. But it changes what the proposal needs to say precisely, for two reasons:

1. **"Sole consumer" is a specific, falsifiable claim, and it's false.** If a proposal or a future engineer takes "sole consumer" literally and later goes looking for "the one place that reads `isNewUser`" to reason about impact, they will miss `auth.success`/`isFirstAccess`. Small thing, but this is exactly the kind of drift-from-fact that turns into a scope dispute later.
2. **The scope boundary in §2 ("not a new isNewUser consumer") is stated as a rule about the future, but the inventory of the present is what makes that rule enforceable.** "No new consumers" only prevents scope creep if the proposal also states, correctly, what the existing consumers are. Right now it names one; there are two.

**Suggested rewrite for §1/§2, to carry into the proposal:**

> The current consumers of `isNewUser` are both audit-log fields, not UI or non-idempotent side effects: `auth.first_access_created` (fires only when `isNewUser` is true) and `auth.success`'s `isFirstAccess` field (fires on every authentication, carries the flag value). Both tolerate duplicate/incorrect-but-safe values today, and neither is changed by this fix. This change must not add, modify, or extend either audit event's semantics, and must not introduce a third consumer.

That last sentence is the part actually missing — the current draft says "not a new consumer" but never says "and don't touch the two that exist," which is the more likely accident (e.g., someone "while I'm in here" tidying the `isFirstAccess` field name).

## Are "close issue #8 on ship" and "update spec.md" concrete enough to become tasks?

Partially. Both correctly name a specific artifact (issue number; file + line), which is more than most exploration docs give me. But neither states the **end state** precisely enough that a reviewer can check it off without re-deriving intent:

- **"Update `openspec/specs/first-access/spec.md:201`"** — update it *to what*? The notes say "reflect that the constraint has been closed, with a pointer to this change," which is a good instruction to a human but not an acceptance condition. As written, two different engineers could produce different results that both satisfy "updated it": one might delete the "Known Limitations" entry entirely, another might leave it and append a note. The spec file also lists issue #8 separately under "Open Issues" (line 215) — the notes don't mention this second location at all, and it needs the same treatment or the spec will contradict itself (one section says "closed," the Open Issues list still shows #8 as open).
  **Suggested acceptance condition:** *"The 'isNewUser SELECT-before-upsert race' entry under Known Limitations (spec.md:201) is replaced with a short closed-status note naming this change by name/ID. The corresponding line under Open Issues (spec.md:215, `#8 — [Architecture] isNewUser SELECT-before-upsert race`) is removed or moved to a Resolved/Closed list, consistent with how other closed issues are represented elsewhere in this spec file (worth checking: is there a precedent pattern for closed issues in this doc, or will this be the first one?)."*

- **"Close the loop on Issue #8 itself when this ships"** — doesn't say *how*. Is this a manual close after merge, or is the expectation that the PR/commit uses a closing keyword (`Closes #8`) so it's automatic? Different teams do this differently, and "close issue #8" as a task-list line item is not verifiable by a reviewer unless the mechanism is named — otherwise "did we do this" becomes a manual double-check nobody remembers to do, which is a little ironic given this whole change exists to eliminate exactly that kind of unenforced manual step.
  **Suggested acceptance condition:** *"PR description/commit message includes `Closes #8` (or team's standard closing syntax), OR: task list includes an explicit manual step to close #8 post-merge, owner named."*

## Vague area: "net assessment" reads like a conclusion, not a requirement

Section 5 is well-reasoned but is written entirely in prose ("low blast radius," "the one thing worth a second pair of eyes," "the two things that quietly slip through"). None of this is wrong, but none of it is stated as something a reviewer can check off either. For a guardrail-closure change specifically — where the whole point is "stop relying on someone remembering to check" — I'd want the proposal's task list to convert every one of these prose warnings into an explicit gate:

- [ ] Concurrency test rewritten to mock two single-query calls (one `is_new_user: true`, one `false`) and asserts `mockQuery` called exactly 2 times (not 4)
- [ ] Concurrency test's assertion proves *derivation from the DB response*, not merely a reduced call count (i.e., a test that mocks both calls returning `is_new_user: true` and asserts both `isNewUser: true` would pass mechanically but prove nothing — this should explicitly fail review)
- [ ] All 13 existing test cases updated for single-query mock shape; no `mock.calls[1]` index references remain
- [ ] `makeUserRow()` helper extended with `is_new_user` field
- [ ] Stale "HARD CONSTRAINT" comment block (lines 104–122) replaced, mirroring `teams.ts:746–765` style
- [ ] `openspec/specs/first-access/spec.md` updated at both the Known Limitations entry (line 201) and the Open Issues entry (line 215)
- [ ] `packages/backend/src/routes/auth.ts` diff is empty (confirms no caller-side scope creep)
- [ ] Issue #8 closed, mechanism specified

This is the single biggest gap between what's here and what's proposal-ready: the analysis is complete, but it needs to be inverted from "here's what a rushed implementation could get wrong" (retrospective, prose) into "here's what must be true for this to be done" (prospective, checkable).

## Scope boundary precision — otherwise good, one gap

The "not a redesign / not a new consumer / not a migration" framing in §2 is genuinely precise and I have no changes to the role-mapping, displayName-fallback, or email-update boundaries — those are correctly fenced off with line citations. The one gap is the consumer-count issue above. Once that's corrected, I'd consider §2 proposal-ready as written.

## Non-blocking note

The document is titled/framed as an SME exploration by Devon Calloway, and it's strong on that front. Nothing here should read as "this needs another round of exploration" — it's a small set of precision fixes (one wrong path, one wrong cardinality claim, and converting the prose risk list into checkable acceptance conditions) that a proposal author can fold in directly.
