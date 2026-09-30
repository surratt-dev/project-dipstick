# Engineer Review — remove-topic design.md

**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Scope:** Implementability, boundary cleanliness, technology choices, hidden coupling, missing error paths — checked against `packages/backend/src/routes/topics.ts`, `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `content.ts`, `facilitator-sessions.ts`, `audit-logger.ts`, `topic-lock-helper.ts`, and `packages/backend/migrations/2_create_tables.sql`.

## Verdict

Implementable, and the reasoning throughout is sound — the check-ordering, the audit posture, the advisory-lock reuse, and the frontend pattern reuse all check out against the actual code. One finding is blocking: the design names a new function shared across two route files but never says where it lives, and the obvious place to put it collides with a boundary this codebase has already drawn deliberately. One finding is non-blocking but should be resolved before implementation starts, because it'll otherwise get "resolved" ad hoc by whoever writes the code, three different ways across three PRs.

## Finding 1 (BLOCKING) — `checkStandingFacilitatorOrAdminAuthorization`'s file location and reply-writing responsibility are unspecified, and the codebase's existing pattern makes the obvious placement wrong

Decision 1 and Decision 9 both describe a "new shared enforcement function... reused by both TOPIC-002's `content.ts` handler and TOPIC-004's `topics.ts` handler." Task 3.1 repeats this without resolving it either. Nowhere does the design say which file this function lives in.

I checked how the existing version of this split actually works:

- `evaluateStandingFacilitatorAccess` (`standing-facilitator-access-helper.ts`) is fact-only — no `FastifyReply`, no status codes, no messages. It's imported by both `topics.ts` and `facilitator-sessions.ts`. This is the layer that's actually shared today.
- `checkStandingFacilitatorAuthorization` — the thing that takes `reply`, decides `403` vs. pass, and writes TOPIC-003-specific messages ("Only a facilitator can add a custom topic.") — is a private, unexported function local to `topics.ts`. I grepped for it: it has exactly one caller, in the same file. It is **not** shared across route files today, and that's not an oversight — every enforcement-plus-response function in this codebase stays local to the route file that owns the specific wording of its errors, while only the fact-only DB read gets promoted to `auth/`.

The design's new function is explicitly the enforcement-plus-response kind (it's specified by its rejection behavior: "reject `403 NOT_A_FACILITATOR` if...", "reject `403 FACILITATOR_IS_TEAM_MEMBER` if..."), and it's explicitly meant to be called from both `topics.ts` and `content.ts`. That's a new shape nothing in this codebase does today. Two concrete problems fall out of leaving this unresolved:

1. **If it's implemented in `topics.ts` and exported for `content.ts` to import**, that's a route file importing from another route file — nothing else in the codebase does this (`content.ts` imports from `auth/team-content-access-helper.ts`, not from `topics.ts`). It also means `content.ts`'s TOPIC-002 handler would depend on `topics.ts` loading correctly, an implicit coupling between two features that are supposed to be independently reviewable.
2. **If it writes directly to `reply` (matching the existing `checkStandingFacilitatorAuthorization` shape), the two call sites need different message text** — TOPIC-002 is a read ("view this team's topics"), TOPIC-004 is a destructive write ("archive a topic for this team"). A single hardcoded message serving both is either wrong for one of them or generic enough to be unhelpful for both. The design's own TOPIC-002 error-table correction (Decision 9) doesn't supply replacement wording either, so this isn't just an implementation detail being left to the coder — the design doesn't have an answer yet.

**What I'd do:** put the shared piece in `auth/` (e.g., extend `standing-facilitator-access-helper.ts` or a new sibling file) as a **decision-only** function — no `reply`, no message text, just a discriminated result:

```typescript
type StandingFacilitatorOrAdminDecision =
  | { authorized: true; actorGlobalRole: string }
  | { authorized: false; reason: "NOT_A_FACILITATOR" | "FACILITATOR_IS_TEAM_MEMBER" };

export async function checkStandingFacilitatorOrAdminAuthorization(
  userId: string,
  teamId: string,
): Promise<StandingFacilitatorOrAdminDecision>
```

Then `topics.ts`'s TOPIC-004 handler and `content.ts`'s TOPIC-002 handler each write their own `reply.code(403).send(...)` with endpoint-appropriate messages, keyed off `reason` — exactly mirroring how `checkStandingFacilitatorAuthorization` already wraps `evaluateStandingFacilitatorAccess` today. This is a small change to the design (one paragraph in Decision 1, a one-line addition to tasks.md 3.1 and 7.1) but it needs to be made in the design doc, not discovered independently by whoever picks up Task 3.1 vs. whoever picks up Task 7.1.

## Finding 2 (should resolve before implementation) — the confirm=true re-derivation (Decision 5 / Task 5.2) doesn't gate anything and nothing consumes its result, so as specified it's inert

Decision 5's stated purpose for server-side re-derivation is staleness protection: "a page reload or navigate-away-and-back... must not let a stale, client-held count silently confirm an archive against a *different*, current set of open items than what was actually shown." That's a real concern and I agree with the "never trust a client-held count" principle generally.

But Task 5.2 specifies the re-derivation this way: call the Task 2.1 helper again "purely to confirm the topic is eligible to archive (its result does not gate the outcome once `confirm=true` is present); proceed directly to the archive `UPDATE` regardless of what the helper returns."

Trace what that means concretely: the helper's return value is not compared to anything, not written to the audit row (Decision 7 / Task 6.1's audit metadata is `{ topic_id }` only — no action-item count or list), not returned to the client, and doesn't affect the `UPDATE`'s `WHERE` clause (which is already gated on `id`/`team_id`/`status = 'active'`, independent of this query). The topic's continued eligibility to archive is already fully re-verified by steps 2–6 of the cascade, which run unconditionally on every request including the `confirm=true` one. So the query Task 5.2 describes runs, inside the transaction, while the per-team advisory lock is held, and its result goes nowhere.

Two ways to resolve, either is fine, but the design should pick one:

- **Drop the re-query on the `confirm=true` path entirely.** If nothing acts on its result, it's dead work extending the critical section of a lock that also blocks `POST /topics` for the same team. The staleness property Decision 5 wants is already satisfied by re-running the *whole* cascade fresh on every request (no session-held state) — that's the actual protection, and it doesn't need this specific query's result to work.
- **Or make the re-derivation observable**, if the intent was genuinely to capture what was actually open at confirm-time (this reads like the more likely original intent, given how much weight Decision 5's "Why" puts on staleness): write the freshly-derived `openActionItemCount` (and maybe the id list) into the success audit row's `metadata`, alongside `topic_id`. That would make "the server re-derives and that re-derivation is meaningful" true in an observable way, and it's a one-line addition to Task 6.1.

I'd pick the second option — it costs one field in a JSONB column that's already being written in the same transaction, and it turns "we re-checked, trust us" into an actual record of what was open when a facilitator archived over a warning. But either is implementable; what's not implementable as literally specified is "re-derive it and then don't use it," because that'll read as a bug to the next engineer, not a deliberate choice.

## Confirmed sound (no changes needed)

- **Advisory lock reuse (Decision 3).** Both `POST /topics` (existing, `topics.ts:390`) and the new archive path take `pg_advisory_xact_lock(hashtext(teamId))` — identical key, both as the first statement in their transaction, both auto-released on `COMMIT`/`ROLLBACK`. This is a single lock resource serializing all topic-count-affecting writes for a team; there's no second lock anywhere in either path, so there's no ordering for two transactions to disagree on and no deadlock risk. Contention (an add and an archive for the same team briefly serializing against each other) is the correct, intended behavior here, not a bug.
- **Migration.** `topics.archived_by uuid NULL REFERENCES users(id)` is additive, nullable, no backfill — matches the existing pattern of `archived_at` on the same table (already nullable, already unused by any shipped write path per `2_create_tables.sql:44-56`). Fits the existing numbered-migration convention (`packages/backend/migrations/`, currently through `15_action_item_history_owner_columns.sql`); the design doesn't assign a number, which is a trivial gap the implementer resolves by picking `16_...` at PR time, not a design defect.
- **Cascade ordering (Decision 2).** Checked step-by-step against the existing TOPIC-003 cascade in `topics.ts`: the leak-prevention reasoning (team-scoped checks before topic-scoped checks, topic existence before topic status, status before the last-active guard, the hard block before the resumable warning) is internally consistent and matches the precedent it cites.
- **Frontend pattern reuse (Decision 10).** `MemberManagement.tsx` does have exactly the two-step local-state confirm/re-submit shape the design describes (`RoleChangeState`'s `awaiting_confirmation` status, confirmed at `MemberManagement.tsx:69-191`). Pointing the new screen at this precedent instead of introducing a shared `Modal` component is the right call — there's genuinely no second consumer today.
- **`begin-voting` throw fix (Decision 8).** Verified the crash first-hand: `facilitator-sessions.ts:1195` does `throw new Error(...)` with no surrounding try/catch that would turn it into a clean response — it's an unhandled `500` exactly as described. The replacement shape (`{ error: { category, message, correlationId } }`, no `code`) matches the file's own adjacent convention at lines 1155-1163, not `topics.ts`'s envelope. Correct call to match local convention over cross-file consistency here — this file already has its own shape.
- **`getOpenActionItemsForTopic` query (Decision 5).** `action_items.session_topic_id` is genuinely a nullable FK into `session_topics`, itself keyed by `topic_id` (`2_create_tables.sql:86-101, 122-140`) — the join is necessary, not gratuitous, and `action_item_status` is a real enum (`1_create_enums.sql:28`) so `status = 'open'` is a valid filter.

## One thing I'd want confirmed, not blocking

Task 9.7's manual-verification step is the only place `openActionItems` drill-down list actually gets exercised end-to-end against a real confirm-then-reconfirm flow. Given Finding 2 touches exactly this code path, I'd want that manual pass re-run after Finding 2 is resolved, whichever direction it's resolved in — the fix changes what the second `DELETE` actually does under the hood even though the response shape (per Decision 5's contract) doesn't change.
