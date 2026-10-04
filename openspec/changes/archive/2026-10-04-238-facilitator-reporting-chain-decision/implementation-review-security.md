# Implementation Review: Security (Tomás Ferreira, Senior Application Security Analyst)

Change: `238-facilitator-reporting-chain-decision` (documents only). I reviewed:
- `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`;
- `proposal.md` Appendix B (#NNN, the conflict-rule issue) and Appendix C (#MMM, draft takeover). Both are filed verbatim as GitHub issues;
- `design.md`, `decision-log.md` rows 1–20, and my own `design-review-security.md`.

I checked claims against `packages/backend/src` on this branch. I am not reopening rows 1–20.

**Important context for the issue drafts:** `surratt-dev/project-dipstick` is a **public** repository. An unauthenticated GitHub API request returns 200. Everything in Appendices B and C, and everything later recorded on those issues, is world-readable.

**Verdict: approve with conditions.** S1–S7 are reflected accurately. The audit-content rules and the row 18 check are correct. The interim operator step is sound. Before the orchestrator files the issues, two items must be fixed in the issue text: M1 (personal and environment data recorded on a public issue) and M2 (the takeover is not specified as an atomic compare-and-set).

---

## Must-fix (before filing the issues)

**M1 (Medium): the record-keeping steps in Appendix B tell the operator to put personal and environment data on a public issue.**

The pre-launch draft check (proposal.md:542-552) says: "Record the operator, date, environment, query, hits and the action per hit on this issue." Hit clause (c) comes from "the IdP administrator's list of users who held both roles". The operator step says "Record each use on the relevant issue" (proposal.md:461), and the IdP attestation is recorded "with name and date" (proposal.md:538-540). On a public repo, these instructions would publish:
- which named employees held manager and facilitator roles. That is personal data, and it is also a map of who holds privilege in the deployment;
- "environment" details and query output, which in practice tend to include hostnames, database names or connection details.

Fix: add one rule to both steps and to the operator-step bullet. **On this public issue, record only:**
- the operator's GitHub handle;
- the date;
- an environment *label* (for example `production`), never a hostname or connection string;
- the hit count;
- the action per hit, keyed by session id.

User names, emails and the IdP administrator's list, plus any full query output, go in the internal ticket. The issue carries only that ticket's reference. That is the same reference that goes in the operator audit row's `ticket` field. For the attestation, record that an attestation was received, the date and the internal ticket reference. Do not paste the attestation itself.

**M2 (Medium): Appendix C does not require the takeover to be an atomic compare-and-set. That leaves a check-then-update race with room-open, and a stale confirmation can displace a different owner than the one shown.**

AC 2 refuses a takeover "when the session is not `draft`". AC 6 covers only two concurrent takers. As written, the issue allows this sequence: read the row, check it, then `UPDATE sessions SET facilitator_id = $taker WHERE id = $1`. Two races follow from that:
- **Owner opens the room during the takeover.** The owner's room-open UPDATE is guarded (`facilitator-sessions.ts:918`: `facilitator_id = $3 AND status = 'draft'`), but the takeover UPDATE is not. If room-open commits first, an unguarded takeover then reassigns a **lobby** session. That is reassignment of an opened session, which is explicitly outside rows 11 and 14.
- **Ownership changes after the prompt.** The confirmation prompt shows owner A. If a third facilitator takes the draft over in between, the confirmed action displaces owner B, whom the taker never saw.

Fix: add to Behaviour and the ACs:
- the UPDATE is `... WHERE id = $1 AND status = 'draft' AND facilitator_id = $expectedPreviousOwner`. The expected owner is the one the confirmation showed, and the client sends it back;
- the taker's live `global_role` and non-membership checks run inside the same transaction;
- zero rows updated means `409` and no audit row;
- new AC: **a takeover racing the owner's room-open leaves the session with exactly one facilitator. If room-open won, the takeover is refused and the session stays with the owner. If the takeover won, the owner's room-open is refused.**

---

## S1–S7 reflection (design-stage findings)

| Finding | Reflected? | Where |
|---|---|---|
| S1: "recreate" impossible, so the draft needs a defined, audited disposal | **Yes**, and superseded by the user's choice of takeover (rows 14–17) plus an interim operator step | 01c §6; Appendix B Scope (proposal.md:451-461), AC 8 (runs the step verbatim and proves the 409 clears); Appendix C. The notice copy no longer promises a mechanism (proposal.md:438-439). |
| S2: draft read grant survives re-resolution | **Yes**, option (b), row 18 | 01c §6; Appendix B Scope (proposal.md:462-464), scenario (384-385), AC 12, which also tests the positive case. I confirmed that Path 3(b) currently has no role predicate (`team-content-access-helper.ts:212-223`). The fix is correctly scoped to the `draft` branch only. |
| S3: extent and duration of access past room-open | **Yes** | 01c §6 lists control, live events, per-voter attribution, action items and trends, 30 minutes after completion, and no limit while the session is non-terminal. The Appendix B docs include the read-only query (proposal.md:478). |
| S4: "role-claim" precision; constant `conflictingRoles`; negative cases | **Yes** in Appendix B (proposal.md:394-398; AC 4 covers `superuser` plus its count, `Facilitator`, and the string form). 01c is acceptable but less precise (see N1). The optional `roleConflict: true` on `advance_denied_role` is included (proposal.md:449-450). |
| S5: conflict flag is server-side, never from the client, and selects copy only | **Yes** | Appendix B Scope (proposal.md:404-413, 444-448): Redis `SessionData`, "never taken from the client", the 403 decided by the live `global_role` alone, copy never read from `audit_log`. |
| S6: dependency on #235 D9 | **Yes** | Appendix B header (proposal.md:315-319); 01c §9. |
| S7: simulator persona | **Yes** (no action) | AC 11. |
| Consistency: gaps 1–2 accepted risk (row 13) | **Yes** | 01c §8 marks both as accepted risk, citing row 13. |

## Audit content rules

- **Conflict row.** Metadata is limited to `{ oidcSubject, appliedRole, conflictingRoles, previousRole, correlationId }`. `conflictingRoles` is a code constant. There are no raw role-claim values, no non-allowlisted elements and no counts. The row is in the same transaction as the role UPSERT and fails closed, and the structured log carries the same field set. **Correct.**
- **Operator row and takeover row.** Both are fixed field sets with no role-claim values (proposal.md:456-459, 600-603). **Correct**, subject to N2 on `ticket`.

## Interim operator step (rows 17, 19)

- **Single transaction.** UPDATE and audit INSERT in one transaction, with "roll back unless exactly one row" and a `status = 'draft'` guard. This satisfies the `abandoned_at` CHECK. **Correct.**
- **Actor identity.** `actor_user_id` is the operator's own `users.id`, which matches row 19. `target_user_id` and `team_id` come from `RETURNING`, not hand entry. **Good.**
- **Residual:** `actor_global_role` = "their role" is hand-entered. See N2.
- **Privilege.** The step needs direct production DB write access. That is existing operator privilege, not a new credential, and every use is audited. Acceptable. Because AC 8 runs the documented SQL verbatim, the documented text and the tested text cannot drift. **Good.**

## Row 18 live-role check

This is correctly specified as an extra predicate on Path 3(b) only, with a negative and a positive test (AC 12). Sessions past room-open are untouched, which is consistent with S3 and row 11. No other draft-keyed read path exists:
- the WS subscriber Path 3 covers `lobby…wrap_up` only;
- TOPIC-001 already denies an EM-role caller.

## Takeover authorization (Appendix C), and new risks

**What is correct:**
- The taker must have a live `global_role = 'facilitator'` and no active membership on the team.
- The draft's own owner is excluded.
- An explicit confirmation is required, and the server never takes over implicitly (AC 3).
- One fail-closed audit row is written in the same transaction, with `target_user_id` = the previous owner.
- No new session row is created, and the unique index is unaffected.
- `application_admin` cannot take over, because the role must be exactly `facilitator`. That is correct, since there is no admin reassignment (row 14).

**What the previous owner keeps:** nothing that is checked server-side.
- Room-open checks `facilitator_id` live (`facilitator-sessions.ts:835`, guarded UPDATE at `:918`).
- Path 3(b) is a live query with no cache (`team-content-access-helper.ts:205-223`).
- Drafts have no WS subscriber grant.

They keep whatever they already read during preparation. That cannot be revoked and is no worse than today. AC 5 tests the server-side loss. **Correct.**

**New risks the takeover introduces:**
1. **Displacement of a legitimate, active draft (row 15: any draft).** Any facilitator can silently take another facilitator's prepared session for a team. The confirmation prompt guards against mistakes, not against malice, and the audit row is detective only. This is the user's decision (row 15), so it is not a must-fix. Open question 1 is the right control: from a security standpoint, I recommend resolving it to an in-app notice to the previous owner at minimum (N3).
2. **Race with room-open / stale confirmation.** See M2.
3. **Draft-window extension (open question 4).** Resetting the 24-hour window on takeover gives the taker no more than creating a fresh draft would. Inheriting the remainder is stricter. Either is acceptable, provided `created_at` is not rewritten (N4).
4. **Entry point on the 409 (open question 2).** If the `409 session_already_exists` response is enriched with the draft's owner or session id, the enrichment must happen only after the caller has passed the same checks as takeover (live facilitator role, non-member). Otherwise the 409 becomes an oracle for who is preparing which team (N4).

## Sensitive content in text bound for public issues

I scanned Appendices B and C. They contain:
- no secrets, tokens or credentials;
- no hostnames, IPs or URLs;
- no real email addresses. `APPLICATION_ADMIN_CONTACT_EMAIL` is an env-var name, not a value.

The only person names are team personas (Priya Nair), which is fine. File paths and the operator SQL reveal schema shape, which is already public in the repo. The issue text itself is clean. The risk is what the text *instructs people to record later*: see M1.

---

## Non-blocking

- **N1 (01c §5 wording).** "It never contains raw claim values" is defined by the colon that follows it, and "identifiers the application already audits" covers `sub`. To match S4 and Appendix B exactly, prefer "raw **role-claim** values".
- **N2 (operator step).**
  - Fill `actor_global_role` with `(SELECT global_role FROM users WHERE id = $operator)` inside the transaction, and abort if no row is found. That way the operator's id is validated and the role is not hand-typed.
  - Constrain `ticket` to an internal ticket reference, with no free text or personal data. This ties in with M1.
- **N3 (takeover open question 1).** Security recommends an in-app notice to the previous owner. Also audit denied takeover attempts (open question 6), as `session.advance_denied_role` does, since this is an authorization boundary that can be probed.
- **N4 (takeover open questions 2 and 4).**
  - Enrich the 409 only after the caller passes the takeover checks.
  - Never rewrite `created_at`. If the window resets, use a separate column so the audit trail keeps the true creation time.
- **N5 (`POST /auth/role-conflict-notice/dismiss`).** Make sure it sits behind the same CSRF and same-origin protections as the other state-changing `/auth/*` routes. The impact is low, because dismissal only hides copy.
