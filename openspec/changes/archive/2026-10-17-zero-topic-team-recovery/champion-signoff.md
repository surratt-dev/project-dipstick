# Champion sign-off: zero-topic-team-recovery (#200)

Devon Calloway, Internal Champion. Final check after implementation and archive.

## Verdict: PASS WITH NOTES. No concerns that block merge.

## Ritual constraints

- **No-manager rule: unaffected.** The new route writes topic rows only. No membership or participation code is in the diff (`git diff --stat` shows none, and task 8.2 records the same). The caller must be `application_admin`, read live from `users`. Engineering managers are refused (403 `NOT_AN_ADMIN`) like every other non-admin.
- **Simultaneous reveal: unaffected.** Nothing in the diff touches voting, reveal or session state beyond the room-open message text. The `/advance` change runs only on the existing 409 `NO_ACTIVE_TOPICS` path, after ROLLBACK, and only picks which message to return.
- **Facilitator from another team: unaffected.** A facilitator cannot call the endpoint at all (it is deliberately not `checkStandingFacilitatorOrAdminAuthorization`), so there is no new way for a same-team or any other facilitator to change topic state. The room-open standing-facilitator check is not modified.
- **Structural, not configurable.** No flag and no env toggle. The zero-active precondition is checked as a fresh statement inside the transaction, under the team topic advisory lock.

## Lock carve-out: contained as designed

- `checkCustomizationLockGate` is unmodified. The other four lock-gated writes (add, archive, restore, reorder) still call it, at the same call sites in `routes/topics.ts`. The new route does not call it, and `assign-defaults-lock-gate-source.test.ts` pins both facts permanently.
- The endpoint takes no body, query or source team id. It can only copy the canonical set from the sentinel template, so it cannot customize. The template team is refused with 404 and the existing audit row.
- The team stays `first_session`-locked after assignment (AC 9 is tested). Nothing unlocks the team, and there is no undo.
- `canAssignDefaults` is true only for an admin on a non-template team with zero active topics. It is presentation only, and the endpoint enforces its own checks. It uses the same `isApplicationAdmin` predicate as the endpoint.
- The "exactly one carve-out; any further one needs PO sign-off" wording is in the spec Purpose (task 9.2 verified) and in the use-case amendment.
- The three altered structural guard tests were widened narrowly. Existing assertions were not weakened. The one loosening is the sliding-window-limiter importer allow-list, which is pinned to a single new importer.
- The `defaultTopicsNotActive` fix (one row per default, preferring the active one) is small, tested, and consistent with the lock's intent. It prevents duplicate active names after a recovery.

## Notes (not blockers)

1. **N1: the facilitator-facing half of the recovery is mostly not delivered in the browser (architect F2).** `DraftSessionHost.tsx` ignores the server's 409 message when its refetch succeeds. A blocked facilitator therefore usually keeps seeing the misleading "Add or restore a topic on Topic Management" line, not "Ask an application administrator...". This is the D10 gap, and it is larger than I accepted. I accepted D10 on the assumption that the room-open message would be visible. Admin recovery works. The API and spec scenarios pass. The gap is real, though, and it is the same vague-escalation failure that ends up on my desk. Before merge, the PO should choose between:
   - (a) a small local fix that makes the 409 branch show the server message for the locked-zero variant, which I prefer, or
   - (b) acceptance with follow-up 8.4(d) at raised priority. If (b), task 8.4(d) must state that the room-open message is rarely seen, so the follow-up is not understated.
2. **Invented failure string (F1).** The generic assign failure copy ("The default topics couldn't be assigned. Try again.") was not in the spec. Record it in the topic-management-screen spec so spec and code agree.
3. **Duplicated settled 500 string in backend and frontend (N3).** This is drift risk. A shared constant would be better. It is not urgent.
4. **PR description.** Mention the widened rate-limit allow-list guard and the extra `assignBlockedReason` prop (F3, F4).
5. **Runbook.** Verify the N4 operability points are in the "Zero-topic teams" section of `docs/deployment.md`: the heading name that the 500 copy cites, the Redis-outage behaviour, and the trust-proxy checklist.
6. **FR-8.6 is not closed.** This change closes only the zero-active state, and the docs say so. Partial restore and "visible" stay open under follow-up 8.4(a). Do not report FR-8.6 as satisfied.

## Pre-merge conditions (open human gates, expected)

- **9.1 ratification** of the eight items by the PO/repo owner, with answers recorded on #200. This includes the permanent lock carve-out, the loosened H1 copy, the use-case amendments and the FR-8.6 residual.
- **Compliance answer** (ratification item 4) on the fail-open `topic.defaults_assign_failed` row after rollback. The fallback is log-only plus a runbook search.
- **Item 5**, the per-actor denial-audit bound of 10 rows per minute, to be confirmed.
- **N1 decision**, option (a) or (b), as above. I ask for it to be made explicitly before merge.
- **8.4 follow-up issues**, filed with numbers recorded: (a) FR-8.6 residual, (b) the restore name-collision check, (c) the TOPIC-002 denial bound, (d) the draft-page copy, (e) the threat-model update.
- **Post-release:** 8.1 re-run of the diagnostic and legacy-lobby queries.
- **8.3 usability pass** is non-gating, and is skipped if the diagnostic count was 0.

## Bottom line

The ritual's protective constraints are intact, and the lock carve-out is narrow, structural and test-guarded. I would not want a second carve-out, and the spec text now says so. My one real reservation is N1, which is about whether the facilitator can find out whom to ask. It is a usability gap, not a constraint breach.
