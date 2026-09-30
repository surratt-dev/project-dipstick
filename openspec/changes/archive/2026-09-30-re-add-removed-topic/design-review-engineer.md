# Engineer Design Review — re-add-removed-topic (TOPIC-005)

Reviewer: Marcus Oyelaran, Full Stack Engineer

## Summary

I verified every reuse claim in `design.md` against the real source in `packages/`, not just against the prose. The claims hold up — this is unusually well-grounded design work. `checkStandingFacilitatorOrAdminAuthorization`, the `hashtext(teamId)` advisory lock pattern, `checkCustomizationLockGate`/`checkTeamExists`/`applyTimingFloor`, the `topics_team_order UNIQUE (team_id, display_order, status)` constraint, the `AuditEventName` union's conventions, and both frontend local-state patterns (`RemoveTopicState` in `TopicManagementPage.tsx`, the `RoleChangeState`-style pattern in `MemberManagement.tsx`) all exist exactly as described, with the exact shapes and signatures the design cites. No `implementable-in-theory` drift found on the backend reuse surface. Approved to build, with two things I want closed first (Finding 1 is the one I'd actually block on) and one documentation gap for Section 7.

## Findings

### Finding 1 [Medium — implementability gap] — Decision 3's transaction doesn't specify the zero-rows-updated race, which TOPIC-004 already handles explicitly

`design.md` Decision 3's SQL block ends with the `UPDATE ... WHERE id = $topicId AND team_id = $teamId AND status = 'archived'` and then `COMMIT` — with no branch for the UPDATE returning zero rows. Decision 2's "Alternatives considered" explicitly rejects omitting the status check and *relying* on this WHERE clause silently affecting zero rows, on the grounds that it would return "a misleading `200` for a no-op write." Decision 3 itself then says the WHERE clause is "belt-and-suspenders consistent with TOPIC-004's `UPDATE ... WHERE status = 'active'` clause" — but TOPIC-004's actual belt-and-suspenders handling isn't just a WHERE clause, it's a full branch:

```
packages/backend/src/routes/topics.ts:686-698
if (archiveResult.rows.length === 0) {
  // Topic was archived by a concurrent request between Task 3.3's
  // pre-check and this UPDATE ...
  await client.query("ROLLBACK");
  await applyTimingFloor(startTime);
  return reply.code(422).send(buildErrorEnvelope(..., "TOPIC_ALREADY_ARCHIVED"));
}
```

This is a real race: the pre-transaction status precheck (Decision 2 step 5 / tasks.md 2.3-2.4) runs *before* the advisory lock is taken, exactly like TOPIC-004's Task 3.3 precheck does. Two concurrent restores against the *same topic* (not just the same team) can both pass the precheck, then serialize on the advisory lock, and the second one through will hit zero rows on its UPDATE. Neither Decision 3's SQL block nor tasks.md Task 3.1 says what the handler does in that case. Copying Decision 3's SQL literally — which is exactly what an engineer picking up Task 3.1 in isolation would do — produces a handler that either throws on an empty `RETURNING` result (if one was expected) or silently returns a stale/undefined position, not the `422 TOPIC_ALREADY_ACTIVE` the rest of the design says this state deserves.

**Recommendation:** add the zero-rows branch to Decision 3 explicitly (mirroring topics.ts:686-698, with `TOPIC_ALREADY_ACTIVE` instead of `TOPIC_ALREADY_ARCHIVED`), and add a task under tasks.md Section 3 for it, plus a concurrency test for "two concurrent restores against the *same* archived topic — one succeeds, one gets `422`." The existing 3.3/3.4 tests cover *different* topics only.

### Finding 2 [Low — stale cross-reference] — tasks.md Task 4.1 cites "design.md Decision 7," which doesn't exist in this design.md

`tasks.md` Section 4, Task 4.1: `"...metadata: { topic_id } (design.md Decision 7)."` This design.md's own decisions run 1 through 6, with Decision 6 being "Audit posture: `topic.restored` on success, mirroring `topic.archived`" — the exact decision Task 4.1 is implementing. This is almost certainly a leftover from before the trend-gap decision was split out per the team-lead's framing ("6 decisions, after a revision that dropped a since-removed trend-gap decision") — the audit-posture decision was probably Decision 7 before the renumbering and tasks.md wasn't updated. Contrast with Task 8.3, which correctly disambiguates by naming the other document explicitly ("matching the precedent `remove-topic` design.md Decision 7"). Task 4.1's bare "(design.md Decision 7)" reads as this document and is wrong. One-line fix: change to "Decision 6."

### Finding 3 [Medium — scope-coverage gap in Section 7] — REST API Contract.md's TOPIC-005 Notes still promises the deferred trend-gap signal, and no task touches it

I read the contract directly (`requirements/design/REST API Contract.md`, TOPIC-005 section). Its Notes block currently reads:

> Sessions where the topic was absent while archived appear as gaps in trend charts. The API returns data that makes gaps visible — session records where the topic was absent are identifiable by the absence of a `session_topics` row for that `topic_id`.

This sentence is a direct textual artifact of the trend-gap signal that `proposal.md`'s "Scope Decision" section defers to a follow-up change. tasks.md Section 7 corrects three other things at this same file location — the `Authorization` line (7.1), the `403` error-table row (7.2), and the `RestoreTopicResponse` interface's missing `restoredBy` (7.3) — but no task touches this Notes paragraph, and it isn't mentioned in proposal.md's "Requirements documentation" list either. Left as-is, the shipped contract will describe gap-visibility behavior this change explicitly does not build, in the same document being edited for the other three corrections in the same PR. Someone reading the contract after this ships will reasonably conclude the gap-signal already exists.

**Recommendation:** add a fourth correction to Section 7 (7.1 could reasonably absorb it, or a new 7.1b) striking or rewriting that Notes sentence, consistent with how proposal.md already handles the parallel case in the use-case document (Task 7.5).

## What I did not flag

- Provenance columns (Decision 4): additive, nullable, same shape as `archived_by`'s migration (`16_topics_archived_by.sql`) which I read in full — clean precedent, no migration-numbering conflict (next is 17).
- Frontend reuse (Decision 5): `RemoveTopicState`'s discriminated union in `TopicManagementPage.tsx` is a real, already-shipped pattern; adding a restore-confirmation variant is mechanical. `MemberManagement.tsx`'s own separate local-state union confirms "no shared Modal" is the established convention, not a one-off.
- Audit posture (Decision 6): `AuditEventName`'s existing entries follow a consistent one-event-per-transition convention; `topic.restored` fits without needing a new pattern.
- Lock-denial audit plumbing: `checkCustomizationLockGate`/`writeLockDenialAudit` take a free-form `attemptedOperation` string already — TOPIC-005 passing `"topic.restored"` requires no change to the shared helper.
