# Sync Verification — Solution Architect (Ingrid Sollenberger)

Change: `restrict-team-005-em-promotion` (GitHub #109), post Stage 6 (Sync Specs).
Verifying Marcus Delgado's (BA) sync of `openspec/specs/team-content-access/spec.md` and
`openspec/specs/role-assignment/spec.md` against the shipped code, independently.

## 1. Is the sync accurate and complete for the two delta specs in scope?

**Yes, on both counts. Verified directly, not taken on Marcus's word.**

**`team-content-access/spec.md`** — read against `team-content-access-helper.ts:129-188`:
- Path 1 narrowed to the `participant` sub-case only (spec lines 25-28; code lines 129-136) — confirmed, no independent `engineering_manager`-from-`membership_role` grant remains.
- Path 2 is the sole EM-grant path, dual-check in one query (spec lines 30, 57-62; code lines 165-173) — confirmed. `global_role` and `membership_role` come from the single `userResult` query at code lines 82-95, not two reads.
- Mismatched-state handling (spec lines 48, 63-68; code lines 165, 175-187) — confirmed exactly: degrades to `{ path: 'member', role: 'participant', ... }`, never `null`, never a bare `engineering_manager` grant; emits `team.access_grant_mismatch` via `emitAuditEvent` (log-only, code line 175) with `userId`, `teamId`, `globalRole`, `membershipRole`; no synchronous `audit_log` row, matching the spec's explicit prohibition on that point.

**`role-assignment/spec.md`**, "Authorized actor can change a team member's membership role" — read against `teams.ts:711-869`:
- Unconditional promotion block, no actor-role branch (spec lines 22-26; code line 817, condition is `fromRole === "participant" && newRole === "engineering_manager"` with no actor inspection) — confirmed.
- Ordering guarantee from design.md Decision B (after `checkAssignRolesAuthorization`'s 403, after the no-op fast path, before the transaction) — I traced this myself rather than trusting the report: `checkAssignRolesAuthorization` 403 at line 738 → subject-membership 404 at line 764 → no-op fast path at line 785 → Decision B block at line 817 → `client.connect()`/`BEGIN` at line 874+. Matches design.md exactly. Marcus's report didn't call this out explicitly; worth recording as independently confirmed.
- Redirective error shape naming TEAM-006 (spec scenario line 31-36; code lines 859-868) — confirmed.

**`role-assignment/spec.md`**, "Role change is audited" — read against `teams.ts:823-852` and `:949-965`:
- `audit_log` (not `role_change_audit`) is the correct current table — confirmed against the actual INSERT statements at both line ranges. This was pre-existing staleness unrelated to #109; Marcus's fix during this sync is correct and I'd have made the same call.
- `team.role_change_denied` synchronous row + `emitAuditEvent`, written before the error response (code lines 823-852, immediately preceding the `reply.code(403).send` at line 859) — confirmed against spec's new scenario (lines 105-110).
- `team.role_changed` demotion audit (code lines 949-965) unchanged in shape, confirmed against spec lines 94-97.

No discrepancies found in the delta scope. Sync is accurate and complete for what it touched.

## 2. Task 1.8 (design.md Open Question 8) — my decision as Non-Goals owner

**Decision: No, TEAM-006 does not gain an equivalent zero-Engineers warning as part of this change. This is deferred to a separate, explicitly-scoped follow-on proposal — not decided by omission, decided on purpose, now, in writing.**

Reasoning:
- A proactive pre-action warning is user-facing behavior with its own design surface: copy (subject to the same kind of Facilitator sign-off design.md's Open Question 4 already requires for the redirective-error copy), a two-submission confirmation flow, and its own test matrix. That is new scope, not a mechanical carry-forward of an existing guard — Non-Goals' "no new EM capabilities, no new admin UI" line applies squarely to it.
- This change's entire purpose is closing a security gap (#109) under a security-review track (Tomás Ferreira signed off Decisions B/E/F under that framing). Bundling a net-new UX safety feature into a security-hardening change blurs what's being reviewed and risks delaying the security fix on an unrelated feature decision — the opposite of what "structural, not preferential" (Decision C) is going for.
- No operational cliff results from waiting: the underlying data-integrity risk (a team ending up with zero Engineers) is a UX safety net, not an access-control boundary. Its absence doesn't reopen the #109 gap or create a new privilege-escalation path; it's a missing confirmation dialog. That's the right kind of gap to schedule deliberately rather than rush into this change.
- Decision G's detection-control query work (Open Question 6) is a closer natural home for thinking about zero-Engineers detection systematically (it already touches "query the current team_memberships state for anomalies") — a follow-on proposal can evaluate whether a shared mechanism serves both.

Action: I'm recording this as the closed decision for task 1.8. Task 6.4 (Solution Architect confirms 1.6/1.7/1.8 were each acted on) is satisfied for 1.8 by this document. Tasks.md task 1.8 should be checked off with a pointer to this file.

## 3. New discrepancy Marcus flagged — the now-unreachable zero-participant-warning requirement

**Confirmed independently.** With the promotion block at `teams.ts:817` firing before `client.connect()`/`BEGIN` (line 874), the transaction block's zero-participant check (line 935) is reachable only via demotion (`engineering_manager → participant`) — and demotion strictly increases the participant count, so the check's `participantCount === 0` branch can structurally never evaluate true through TEAM-005 anymore. The code's own comment at lines 921-934 says exactly this and documents it as a deliberate, defensive dead branch — I agree with that call (Full Stack Engineer's reasoning, adopted at design review 2026-09-16): don't delete a correctness guard that would matter again if a future change reopens a promotion path through this transaction.

I also checked the UC doc (`requirements/use cases/01 - Identity and Access - Use Cases.md`) — tasks 5.1-5.3 are done and correct: AC4, the Main Flow, and the "Role change would leave zero Engineers" Alternate Flow all correctly state the warning is no longer reachable through this UC and name design.md Open Question 8.

**This leaves the OpenSpec main spec, not the UC doc, as the one place still describing unreachable behavior as live.** `openspec/specs/role-assignment/spec.md`'s "Pre-action warning when role change would leave zero participant-role members" requirement and its "Role change reduces Engineers to zero — 422 returned on first submission" scenario (main spec lines 117-156) describe a `participant → engineering_manager` PATCH reaching the 422 check. Under the shipped code that PATCH now 403s at Decision B and never reaches the transaction at all. This requirement was correctly left out of this change's delta (it's a different requirement than the two Marcus touched), so the sync itself did nothing wrong — but the main spec, post-sync, is now inaccurate about reachability in a way that's a direct, mechanical consequence of this change's own code, not an unrelated pre-existing issue.

**My call: correct this now, before archiving — not a genuine deferral.**

- This isn't like `#13`'s rate-limiting gate or the em-views.ts migration (independent code, independent root cause, correctly named as out-of-scope elsewhere in these specs). The drift here was caused by *this* change's Decision B. The change that created the gap should be the one that documents it, same as it did for the UC doc.
- Marcus already applied exactly this standard once in this sync pass, fixing the unrelated `role_change_audit` → `audit_log` staleness on the grounds that sync should leave specs matching reality. A causally-connected discrepancy deserves at least the same treatment as an unrelated one he chose to fix anyway.
- Leaving the main spec silent creates a doc-vs-doc contradiction: the UC doc now correctly says "no longer reachable," while the OpenSpec main spec — the more code-adjacent, more authoritative artifact — still describes the 422 path as live. An engineer who reads only the OpenSpec spec (the more likely reference during implementation work) would be misled.
- The fix is small and additive, consistent with the "leave the code, document explicitly" pattern already used both in the code comment (lines 921-934) and elsewhere in these same spec files ("Known deviation — em-views.ts routes" appears twice in `team-content-access/spec.md`). I'm not asking for the requirement or its transaction-locking guarantee to be deleted — the locking/count-check machinery is still correct, load-bearing, defensive code.

**Recommended correction to `openspec/specs/role-assignment/spec.md`** (small delta, to be added to this change before archive, not a new proposal):
- Add a note to the "Pre-action warning..." requirement: as of `restrict-team-005-em-promotion` (#109), this requirement's trigger condition can no longer be reached through TEAM-005 — the unconditional promotion block rejects any `participant → engineering_manager` transition before the transaction/count-check ever runs. The transaction-locking and count-check mechanics remain live code, kept deliberately as a defensive guard against a future write path (not deleted — see `teams.ts:921-934`), but are presently dead code for TEAM-005's only remaining transition (demotion, which strictly increases participant count). TEAM-006, the sole remaining promotion path, has no equivalent check — see task 1.8 above, decided: no new guard added in this change, tracked as a separate follow-on.
- Annotate (don't delete) the "Role change reduces Engineers to zero — 422 returned on first submission" scenario as describing the dead/defensive branch, matching the code's own framing.

This is a documentation-only addition to a spec already touched by this change's sync step, costs a few sentences, and closes a drift this change itself introduced. I don't see a good reason to let it sit wrong until a hypothetical follow-up.

## 4. Other drift found beyond Marcus's report

None beyond what's already named and tracked (the `em-views.ts` known deviations in `team-content-access/spec.md`, and design.md's Open Questions 4/6/7). The one additional thing I verified myself rather than took on trust is the Decision B ordering guarantee (§1 above) — it holds exactly as designed.

## Summary verdict

1. Sync accurate and complete for both delta specs — verified independently against code, no corrections needed to what Marcus touched.
2. Task 1.8: decided now — no TEAM-006 zero-Engineers warning in this change; deferred to a separate follow-on proposal, on purpose, in writing.
3. The newly-flagged unreachable zero-participant-warning requirement in the main `role-assignment/spec.md`: correct it now, as a small addition to this change before archiving — it's a direct consequence of this change's own Decision B, not an unrelated pre-existing gap, and the UC doc has already set the precedent for stating this plainly.
4. No further undocumented drift found.
