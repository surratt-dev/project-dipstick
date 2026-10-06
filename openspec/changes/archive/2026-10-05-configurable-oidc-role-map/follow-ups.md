# Follow-ups for #243 (not filed)

Recorded for the PR description; not filed as GitHub issues. A human with repo
access files each one and replaces the matching "to be filed" marker in
`proposal.md` "Follow-ups" with its link (task 7.4).

**#235 / #241 status at task 0.1 (2026-10-05):** both OPEN. PR #236 (merged) is
the docs-only decision record, not the #235 resolver work. Gate passed; no
reconciliation needed yet. Re-check at task 7.3. #241 still covers proposal
follow-up 2 (durable record of a discarded facilitator mapping).

---

## FU-1. Facilitator demoted while their session is live

**Title:** Define behaviour when a facilitator loses the facilitator role mid-session

**Body:**
With configurable role mapping (#243) a group or `OIDC_ROLE_MAP` change plus a
re-sign-in during a live session can strip a facilitator's `global_role`.
Nothing ends or reassigns the session. Some facilitator-only actions in
`routes/facilitator-sessions.ts` gate on `sessions.facilitator_id` and read
`global_role` only for audit, so they may still succeed after demotion.
`facilitator-demotion-mid-session-integration.test.ts` (added in #243) pins the
observed behaviour of each action; see `security-review.md` "Implementation
findings" for the actions that still succeed (proposal follow-up 10 is folded
in here).

Decide: should demotion end, pause or reassign the session, and should every
facilitator-only action re-check `global_role`?

Also cover the variant from the implementation security review (N1): a facilitator re-mapped to `engineering_manager` mid-session keeps the facilitator-path live event stream (including `vote_revealed`) of the session they opened, which conflicts with the spirit of the no-manager rule. Recommended fix: re-check the live `global_role` in every `facilitator_id`-gated handler and in subscriber Path 3, and decide the hand-off behaviour for the orphaned session.

**Priority:** must be resolved before a second team goes live. Until then the
docs tell operators not to change the map while sessions are live.

## FU-3. "Your resolved role" indicator

**Title:** Show signed-in users their resolved application role

**Body:**
After #243 a user's role is derived from IdP groups through `OIDC_ROLE_MAP`
with fixed precedence. Users (and the operators helping them) have no in-app
way to see which role they resolved to, which makes "why can't I run a
session?" hard to answer without logs. Add a small, non-sensitive indicator of
the resolved internal role (never the IdP group names).

## FU-7. Per-user session invalidation for urgent revocation

**Title:** Operator tool to invalidate one user's sessions

**Body:**
Roles are re-resolved only at interactive sign-in (#243; token refresh does not
re-resolve). An IdP-side demotion, including removal of `application_admin`,
can take up to about 90 minutes (the absolute session lifetime) to apply, and a
backend restart does not shorten it because sessions live in Redis. There is
no operator tool to end one user's sessions. Add one (CLI or admin endpoint),
audited, so urgent revocation is immediate.

## FU-8. Runtime manager-mapping effectiveness signal

**Title:** Periodic count of sign-ins by resolved role

**Body:**
The production boot guard in #243 proves an `engineering_manager` key exists in
`OIDC_ROLE_MAP`, not that it matches anyone. A typo, case mismatch, renamed
group or Entra overage silently drops managers to `engineer`, and the
no-manager rule fails open. Emit a periodic count of sign-ins by resolved role
(no claim values) so "zero `engineering_manager` resolutions in 30 days" is
visible to operators.

## FU-9. Role map fingerprint in the startup summary

**Title:** Add a short hash of the canonical role map to the `OIDC_ROLE_MAP:` boot line

**Body:**
Security review S9 (#243). The startup summary reports per-target counts only.
A short hash of the canonicalised map would let operators see that the map
changed between deploys (including admin grants) without printing keys. Define
the canonical form (sorted keys, JSON) and the hash (e.g. first 12 hex chars of
SHA-256).

## FU-11. Explanatory message for an application admin refused session entry

**Title:** Admin-specific copy when an application admin is refused a session

**Body:**
#243 (design D11) denies application admins participant registration, vote
lock-in and live session events. For this release a refused admin sees the
lobby's generic `no-access` state; the only access-model copy in the UI
describes Engineering Managers. Add admin-specific copy in
`SessionLobbyPage.tsx` (and `MemberManagement.tsx` where the access model is
explained), in the spirit of BRD FR-2.4's "explanatory message".

## FU-12. Unmapped-claim warning is noisy on group-list claims (impl security review N5)

**Title:** Reduce noise of the "no value is in OIDC_ROLE_MAP" sign-in warning for array claims

**Body:**
With `OIDC_ROLE_CLAIM=groups`, an ordinary engineer whose groups match nothing in the map (e.g. only "All-Staff") produces one warn line per sign-in. The line already fires only when **no** value maps (partial matches are silent), which is exactly what the `oidc-role-mapping` spec requires ("A claim with at least one value but zero mapped values SHALL log exactly one warning per sign-in attempt"). So for group claims most engineers warn on every sign-in, and operators may learn to filter the line that would also reveal a misspelled manager key. Options: `info` for array claims and `warn` for string claims, or drop the per-sign-in line once FU-8's periodic per-role counts exist. Needs a spec change, so deferred from #243.

## FU-13. Restrict the identity-default "local issuer" check to loopback / the bundled stub (impl security review N3)

**Title:** Tighten the issuer gate for the built-in identity role map

**Body:**
The identity default applies when `OIDC_ISSUER` passes `isPrivateAddress`, which includes RFC 1918 ranges. A non-production deployment pointed at a real self-hosted IdP on a private address with no map gets the identity default. If that IdP lets users edit the configured attribute, a user could make themselves `application_admin`. #243 documents "set `OIDC_ROLE_MAP` for any real IdP, even on a private network". The `oidc-role-mapping` spec deliberately ties the gate to the persona-login check ("as already determined for the persona-login gate"), so tightening it is a spec change that should cover persona-login too. Proposed: a shared `isLocalStubIssuer()` accepting only `localhost`/`127.0.0.1`/`::1` (and the compose service hostname if the backend ever runs inside compose). Deferred from #243.

## FU-14. Test-file typecheck debt (impl architect review C7)

**Title:** Make `tsc -p packages/backend/tsconfig.json` (including tests) pass

**Body:**
The build config excludes `__tests__`, and the test files have about 200 typecheck errors from before #243 (`possibly undefined` mock-call indexing, the `decorateRequest(..., null)` pattern, etc.). #243 adds no new class of error; its new test files are clean except where they use the existing patterns. Consider a `tsc --noEmit` CI step over tests once the debt is paid.

---

Conditional follow-ups:

- **FU-5 (duplicate-key scanner):** not needed. The scanner was implemented
  within its budget in task 1.3.
- **FU-10 (actions that succeed after demotion):** folded into FU-1. Task 2.3
  found that `start`, `begin-voting`, `reveal`, `topics/advance`, `complete`,
  `facilitator-state` and `participants-roster` all still succeed for a
  demoted facilitator; only `advance` (draft -> lobby) re-checks the live role.
  Add this list to the FU-1 body when filing.

---

# PR description material (task 6.5)

**Suggested PR title** (what `gh release create --generate-notes` will show):
`BREAKING: require OIDC_ROLE_MAP for production and non-local IdPs; configurable OIDC role map (#243)`

## Upgrade notes

> Durable copy: `docs/deployment.md`, "OIDC role map" → "Upgrading". The release owner pastes this section into the GitHub release body (task 7.2).

**Breaking:** after this release, the backend **fails to boot** in production without `OIDC_ROLE_MAP`, and on **any** deployment whose `OIDC_ISSUER` is not a local address without it, whatever its `NODE_ENV`.

1. **Before upgrading**, set `OIDC_ROLE_MAP` on every deployment whose `OIDC_ISSUER` is not a local address. Production also needs at least one `engineering_manager` key. Normally add `facilitator` and `application_admin` keys too. If your IdP already sends the internal role strings in the role claim, this map keeps today's behaviour:

   ```bash
   OIDC_ROLE_MAP='{"application_admin":"application_admin","engineering_manager":"engineering_manager","facilitator":"facilitator","senior_engineer":"senior_engineer"}'
   ```

   **New grants:** an IdP that already sends `facilitator` or `senior_engineer` on the configured claim will now grant those roles at the users' next sign-in.
2. **Deploy**, then grep the boot output for `OIDC_ROLE_MAP:`. Check `source=configured` and the counts, and read any warnings.
3. **Post-deploy check:** a designated facilitator signs in again and creates a draft session. A successful boot alone does not prove this works.
4. **Behaviour changes for application admins:** admins can no longer register in, vote in or receive live events of sessions, even in teams they belong to. A refused admin sees the generic no-access state. The vote lock-in `403` message is now `"You are not eligible to lock in votes in this session."` for every rejected caller (formerly `"Engineering Managers cannot lock in votes."`).
5. **Rollback: check whether it is safe first.** The previous release ignores `OIDC_ROLE_MAP` and only accepts the internal strings `engineering_manager` and `application_admin` on the role claim. No schema changed.
   - **Identity map** (your IdP already sends the internal role strings): rollback is safe. Users granted `facilitator` or `senior_engineer` by this release drop back to `engineer` at their next sign-in.
   - **Translating map** (keys are your IdP's group or role names, e.g. `OIDC_ROLE_CLAIM=groups`): **rollback demotes every mapped user to `engineer` at their next sign-in, including every manager and every admin.** Managers are then admitted to live sessions as engineers, with no error and no audit signal, which re-opens the no-manager rule. Admins lose admin access. **Do not roll back** such a deployment until the IdP has been switched to send the internal strings (`engineering_manager`, `application_admin`) on the configured claim for the right people. Safe procedure: (1) configure the IdP to emit `engineering_manager` or `application_admin` for the members of the mapped groups as a **single string value** on a claim (the previous release does not understand array claims such as `groups`), and point `OIDC_ROLE_CLAIM` at that claim; (2) verify on the current release, with that claim and an identity map, that managers and admins still resolve correctly (boot line, then a manager signs in and the `auth.role_claim_mapped` audit row shows `engineering_manager`); (3) only then redeploy the previous release. If you must roll back immediately, stop running sessions until managers can be re-verified.

## Status of #235 / #241 (task 0.1)

Both OPEN on 2026-10-05. No reconciliation needed. Re-check before merge (task 7.3).

## #243 acceptance-criteria comment (task 7.3, not posted)

Text to post on #243 (or apply as an edit to its acceptance criteria). Not posted from the implementation agent.

> Acceptance criteria updated to match the delivered change (`openspec/changes/configurable-oidc-role-map/proposal.md`, "Deviations from the literal text of #243"):
> - Unset map: four self-mappings (`application_admin`, `engineering_manager`, `facilitator`, `senior_engineer`). `engineer` comes from the fixed fallback, not from a mapping.
> - `engineer` is rejected as a map target.
> - A missing claim logs nothing, except for Entra claim overage (`reason: "claim_overage"`). An unmapped claim logs one value-free warning.
> - Production requires the map **and** at least one `engineering_manager` target.
> - The identity default applies only with a local/private `OIDC_ISSUER` outside production. A real IdP without a map fails boot in every `NODE_ENV`.
> - `application_admin` cannot register as a session participant, lock in votes or receive live session events (binding decision on security finding S1).
> - AC 7's `mapRoleClaimToGlobalRole` unit tests are delivered as `resolveGlobalRole` tests (`packages/backend/src/auth/__tests__/role-map.test.ts`) plus resolver tests in `account-resolver.test.ts`.
