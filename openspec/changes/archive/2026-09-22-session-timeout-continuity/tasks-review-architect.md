# Architect Review: tasks.md Ordering and Dependencies

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering and dependency correctness only. Design decisions (Decisions 1-6) are treated as settled; this review does not revisit them.

## Summary

Task ordering in the current tasks.md is sound. I checked the three specific dependency chains named for this review plus a general pass over inter-group dependencies. I found no blocking ordering defects — no task assumes infrastructure that a later task builds. Two minor, non-blocking notes are included for completeness.

## Targeted checks

### 1. Does 4.1 (lifting `useConnectionHealth` to `SessionConnectionHost`) precede tasks that depend on socket access?

Yes. 4.1 is the first task in Group 4. Its direct dependents are correctly sequenced after it:

- 4.2 (regression test on `ConnectionStatusBanner`'s rendered output) — immediately after 4.1, correct.
- 4.8 ("takes the socket lifted in task 4.1") — explicitly references 4.1 and is sequenced after it, and after the backend mechanism (4.3-4.7) it also needs to be meaningful.
- 4.9 (indicator component consuming 4.8's module) — correctly after 4.8.

No task before 4.1 assumes the lifted socket exists. No issue.

### 2. Does the Redis-backed publish/dispatch mechanism get built before the tasks that call it?

Yes. Order is 4.3 (`publishFacilitatorConnectionStatus` in `ws-pubsub.ts`) → 4.4 (`dispatchFacilitatorConnectionStatus` case) → 4.5 (per-session Redis flag for prior-disconnect detection) → 4.6 (wiring the publish call into the two `websocket-routes.ts` call sites, which needs both the publish function from 4.3 and the read-before-write flag from 4.5 to decide *whether* to publish). All three prerequisites land before 4.6 uses them. 4.7 (confirm authorization reuse) follows 4.4, which is what it's confirming. No issue.

### 3. Are 1.7/1.8 ("confirm unchanged behavior") sequenced sensibly relative to the close-code fix?

Yes, and for the right reason: 1.7 and 1.8 are not testing anything the close-code fix changes — the facilitator-connection-blocks-auto-advance behavior (1.7) and the mid-reveal-completes-regardless behavior (1.8) hold identically whether the force-close sends `STALE_SIGNAL_CLOSE_CODE` or `REAUTH_GRACE_EXPIRED_CLOSE_CODE`, since both leave the connection in the same down state from the server's perspective. Placing them after 1.1-1.6 (implement fix, verify fix) is the correct posture: they are regression confirmations run *after* the change to prove nothing else moved, not prerequisites the fix depends on. No issue.

## General pass — other groups

- **Group 2 (return-to):** 2.1 (define allow-list/UUID shape) correctly precedes 2.2 (login handler validates against it) and 2.4 (callback reads what 2.2 wrote). Group 2 precedes Group 3, matching the Migration Plan's backend-before-or-with-frontend ordering.
- **Group 3 (CTA/copy):** depends on Group 2's `returnTo` contract (3.2) and is correctly sequenced after it. Internal ordering (props → CTA handler → copy → call sites → tests → doc-comment update last) is sound.
- **Group 5 (spec sync/cross-checks):** correctly last; depends on all prior groups being complete.
- **Cross-pod concern (Decision 5):** the task list's own ordering (4.3→4.4→4.5→4.6) already reflects the corrected mechanism from Marcus's blocking finding — no leftover task still describes local-registry iteration.

## Minor, non-blocking notes

1. **2.2 vs. 2.3 runtime order.** Design.md Decision 3 states the CRLF/backslash/scheme checks (task 2.3) run *before* the allow-list pattern match (task 2.2). The task list presents them in the opposite order (2.2 then 2.3). This won't cause a real defect — both land in the same handler before anyone tests it — but an engineer implementing strictly in task order could write the allow-list match first and bolt the guards on after. Consider either reordering (2.3 before 2.2) or merging them into one task so the list order matches the intended runtime order.
2. **Shared-file coordination.** Task 3.4 and task 4.1 both edit `ConnectionStatusBanner.tsx` (3.4 adds `role`/`returnTo` props passed to a child; 4.1 changes how the component itself receives `state`/`socket`). Not a dependency conflict — the Migration Plan already ships both in the same frontend step — but worth a one-line pointer in tasks.md so whoever picks up Group 4 doesn't have to rediscover that Group 3 touched the same file first.

## Conclusion

No reordering or splitting is required for architectural correctness. The two notes above are hygiene suggestions, not blockers.
