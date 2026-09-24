# Security Review — `join-link-display-copy` (Re-review)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** `design.md`, `tasks.md` (revised, post-#166), plus the #166 change itself and the code it landed.
**Scope:** verifying Finding 1's resolution against real code, not the design doc's narrative of it; re-assessing Findings 2 and 3.

---

## Finding 1: RESOLVED

I traced the full chain independently rather than trusting the design doc's claim.

- **Token origin, now:** `getOrCreateJoinLink()` (`packages/backend/src/routes/facilitator-sessions.ts:178-...`) selects from `join_links` using `JOIN_LINK_ACTIVE_SQL` (`revoked_at IS NULL AND expires_at > NOW()`, defined once in `packages/backend/src/auth/join-link-creation.ts:14`), and on a miss calls `createJoinLink()` — the same audited helper `POST /api/teams/:teamId/join-links` uses — which inserts into `join_links` with a 32-byte `randomBytes` token and emits `join.link_created` to `audit_log` (`join-link-creation.ts:34-82`).
- **Both anchor points wired:** `facilitator-sessions.ts:438` (`POST /draft`) and `facilitator-sessions.ts:2063` (`GET .../facilitator-state`) both call `getOrCreateJoinLink`. Confirmed by grep — no remaining reference to `sessions.join_token` anywhere in `packages/backend/src`, `packages/backend/migrations`, or `packages/shared/src` outside of historical comments and pre-migration SQL files.
- **Column actually removed, not just unused:** `migrations/13_sessions_join_token_nullable.sql` (Migration A, `DROP NOT NULL`) and `migrations/14_sessions_drop_join_token.sql` (Migration B, `DROP COLUMN`) both exist. The rolling-deploy sequencing rationale for splitting them checks out.
- **URL construction matches the served route:** `buildJoinLinkPath()` (`packages/shared/src/types/auth.ts:63-65`) returns `/api/join/${token}` — a single shared function, imported by `DraftSessionHost.tsx:184` (``\`${window.location.origin}${buildJoinLinkPath(data.joinToken)}\```) and by #166's own e2e verification test. `join-links.ts:85` registers `GET /api/join/:token` at exactly that path, validates via the same `JOIN_LINK_ACTIVE_SQL` predicate, and on success inserts `team_memberships` plus a conditional `join.link_redeemed` audit row in one transaction.

Evidence chain: `facilitator-state` response → `join_links` row (audited creation) → `buildJoinLinkPath` → `GET /api/join/:token` (audited redemption). This is a real, working, auditable path end to end. The specific defect I raised last review — a session-scoped, unvalidated token rendered at an unregistered URL — no longer exists in the code. **Cleared.**

## Finding 2: Adequately addressed

`design.md`'s Risks section (first bullet, "On the clipboard-write delta specifically") now states the precise thing I asked for: the DOM exposure is unchanged, the new mechanism is a one-click `writeText()` call that lowers copy friction versus manual selection, and this does not change the credential's blast radius (team-scoped, single-role, time-bounded, revocation deferred by `join-link`'s own accepted decision). That's the honest, specific framing I wanted in place of "not a new risk." No further change requested.

## Finding 3: Still accurate, still non-blocking

Design.md's Risk section documents the `draft`-vs-`lobby` UX gap but does not add a sentence on audit-signal absence for the copy/distribution action itself. This is unchanged from my prior review and remains correct: `join.link_created`/`join.link_redeemed` are real, audited events on the now-fixed creation/redemption path, but there is still no signal for "the facilitator viewed/copied this token via facilitator-state," same as before. I don't consider this a regression introduced by #166 — it was already true — and I'm not blocking on it. Worth a one-line addition to the Risks section if the authors want it fully closed out, but it's cosmetic at this point.

## Fresh scan of D1–D6 for new security surface

- **D4 (timer/cleanup, stacking guard, unmount cleanup):** purely client-side `setTimeout`/`useRef`/`useEffect` state machine controlling a confirmation banner's visibility. No new data fetch, no new endpoint, no persistence. No security surface.
- **D2 (feature-detect, collapse to one `"unavailable"` state):** correctly avoids `execCommand('copy')`'s false-success problem, as I noted last time. Still correct.
- **New `data-testid` attributes (D1, D5):** DOM markers only, not rendered as visible text beyond what already exists; no new data exposed.
- **No new backend endpoints, no new fields in `FacilitatorSessionStateResponse`.** This change is frontend-only, confirmed by the design's own Non-Goals and by my own read of the diff scope.

Nothing new to flag.

## Recommendation

**Cleared to implement.** Finding 1 is resolved and independently verified against the actual code and migrations, not just the design narrative. Finding 2's language is adequately fixed. Finding 3 remains a valid, non-blocking observation, unchanged from before. No blocking issues remain.
