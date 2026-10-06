# Follow-ups: facilitator session entry point (#237)

**Drafted by:** Marcus Oyelaran (implementer), task 4.6. **Nothing here has been filed.** The orchestrator or a human files the five issues and posts the #247 comment after merge (task 4.7). The issue numbers are then linked in `proposal.md` at archive (task 4.8).

Order follows the executive sponsor's ranking: 1 and 2 are adoption-blocking and go first.

---

## 1. Resume an in-progress draft or lobby session from the facilitator UI

**Labels:** `bug`, `facilitator`, `adoption-blocking`, `frontend`, `backend`
**Source:** proposal Follow-ups #1; design.md Follow-ups 1 (security review S-9); proposal Non-goals (option D).

**Body**

#237 gives a facilitator with a home team a one-click path to `/sessions/new`. Once they have started a session, though, the app gives them no way back to it: no list of their open draft or lobby sessions, and no marker in the picker. If they navigate away, they have to find the URL again. This change moves the facilitator one screen further before they get stuck. The executive sponsor and the facilitator reviewer both rank this as the next point of friction, so it is adoption-blocking for the facilitator flow.

**Requirements (security review S-9):**
- "Only the caller's own sessions" is enforced **server-side**: the query is scoped by `facilitator_id = caller`, and the resume and read endpoints check it. Do not fetch a broader list and filter it on the client.
- The caller's role is re-read live from `users.global_role` on every request, as every other handler does. Do not trust a cached role or the client's `canFacilitateSessions`.

**Out of scope here:** the abandon transition (issue 2).

---

## 2. Abandon a session from the facilitator UI

**Labels:** `bug`, `facilitator`, `adoption-blocking`, `backend`, `frontend`
**Source:** proposal Follow-ups #4; design.md D6 and Follow-ups 4 (security review S-9). Ranked alongside issue 1 at the executive sponsor's request.

**Body**

No route moves a session to `abandoned`. The `session_status` enum has the value, but the write routes are only `draft`, `advance`, `start`, `begin-voting`, `participants`, `reveal`, `topics/advance` and `complete`, and `complete` accepts only `wrap_up`. Every team created through `POST /api/v1/teams` also starts with a `lobby` session owned by its creator.

As a result, a facilitator who starts a session by mistake cannot recover, and the team stays blocked by the active-session unique index (`migrations/10_sessions_team_active_unique.sql`). A team whose new-team lobby never runs keeps an open session indefinitely. The #237 walkthrough works around this with a local-only SQL update, which is not acceptable anywhere else.

**Requirements (security review S-9):**
- The new transition uses the same authorize, transaction and audit shape as `advance` and `complete`.
- An `audit_log` row is written **in the same transaction** as the status change.
- `session.state_changed` is emitted **after commit**.
- Authorization checks `facilitator_id` against the caller **plus** a live role check.
- It sets `abandoned_at` together with `status = 'abandoned'` (`sessions_abandoned_has_timestamp`).
- When this ships, it replaces the walkthrough's local SQL (design D6).

---

## 3. "Topics" link on a facilitator's home team leads to a denial

**Labels:** `bug`, `facilitator`, `frontend`
**Source:** proposal Follow-ups #2 and Non-goals. Bundle with issue 1 if that is cheap.

**Body**

`TeamPage` shows a "Topics" link to everyone. A facilitator viewing their **home** team (where they are a member) follows it and gets a `FACILITATOR_IS_TEAM_MEMBER` denial. #237 deliberately put its Facilitator block apart from this link (design D1) so the two are not read as a pair, but the dead-end link remains.

Decide whether the link should be hidden or relabelled for this case. The server check stays the control; whatever the UI does is presentation only.

---

## 4. `facilitator-002` persona with a seeded home-team membership

**Labels:** `dev-experience`, `testing`, `facilitator`
**Source:** proposal Follow-ups #3 and Non-goals.

**Body**

The local IdP has a single facilitator persona, `facilitator-001`, with no team. Exercising the cross-team path (a facilitator with a home team, which is the normal case) needs a manual setup today: the #237 walkthrough creates a team, abandons its lobby session by SQL and redeems the join link.

Add a `facilitator-002` persona in `docker/oidc/accounts.js` (role claim `facilitator`) with a seeded home-team membership, and document it in `docs/local-development.md`. This is the fixture for facilitator usability testing, and #247 (reporting-chain eligibility) will need it.

---

## 5. Comment for #247: enforce the chain at `POST /draft`, not only in the listing

**Type:** comment on the existing issue #247 (not a new issue).
**Source:** proposal Follow-ups #5; design.md Follow-ups 5 and Risks (security review S-3, S-2).

**Comment text**

> Carry-forward from #237 (facilitator session entry point), security review S-3 and S-2.
>
> 1. **Enforcement belongs at `POST /teams/:id/sessions/draft`.** The reporting-chain check needs to go on `POST /draft` (enforcement, with an audit row) **as well as** on `GET /api/v1/teams/eligible-for-session` (presentation). Filtering the listing alone is not enforcement: anyone can call `POST /draft` with a team id they already know.
> 2. **Non-revelation is wider than the list.** 01c requires that the chain is not revealed. #237's picker copy names only the membership rule and never says "every team" or "all other teams", so it does not make things worse, but copy is necessary and not sufficient. #247's design also has to cover:
>    - the absence of a known team from `/eligible-for-session` (the listing enumerates org-wide teams, so a facilitator who knows a team exists can infer chain membership from its absence);
>    - the `POST /draft` refusal body (01c §3);
>    - existence oracles such as `TeamNameCollisionResponse` on `POST /api/v1/teams`.
>
> #237's entry point links to exactly `/sessions/new` and never lists, filters or pre-selects teams on the client, so the chain filter takes effect with no UI change.

---

## 6. Audit role-based denials on the facilitator path

**Labels:** `security`, `audit`, `backend`
**Source:** proposal Follow-ups #6; design.md Risks and Follow-ups 6 (security review S-6).

**Body**

`POST /teams/:id/sessions/draft` returns 403 "Only a facilitator can create a draft session" without writing an `audit_log` row. `POST /api/v1/teams` audits the same kind of denial as `team.creation_denied_role`. #237 makes this path one click away, so the pre-existing gap is easier to reach. It was deferred because #237 makes no server change.

- Add `session.draft_denied_role` on `POST /draft`'s role 403, consistent with `team.creation_denied_role` (same actor, role and correlation fields).
- Auditing the `GET /eligible-for-session` 403 is optional, because it is a read.
- Link this to 01c's open scope item "auditing standing-access refusals".

---

## Recorded, not filed

- **Deactivated teams are not refused at `POST /draft`** (security review S-4), by a prior decision (`routes/topics.ts:171`). If deactivation is ever meant to be a security boundary rather than housekeeping, it needs its own issue.
- **TeamPage's "Members" heading lists the caller's own memberships, not the team's members** (engineer review N5). Worth fixing if anyone revisits TeamPage's information architecture.
- **`AuthProvider` re-fetches `/auth/session` on every client-side pathname change** (implementation review, architect finding 2). `fetchSession` depends on `navigate`, whose identity changes with the pathname under `<BrowserRouter>`. That costs one round-trip per navigation and re-runs the 401 dev-login probe. Whether it is intended belongs to whoever next touches `AuthContext`. Making `fetchSession` stable would remove an incidental re-sync, so decide it there, not in a page.
- **The `GET /eligible-for-session` 403 re-sync leaves no audit trail** (implementation review, security F-2). This is by scope: a revoked facilitator's repeated attempts show up only in access logs. Covered by issue 6 above. Make sure it is actually filed.
- **The R5 server guard is a SQL string match** (implementation review, architect finding 6 / security F-3). `not.toMatch(/tm\.role|membership_role/)` would miss a role predicate written with another alias or moved into a CTE. If R5 becomes load-bearing for #247, add a behavioural test on the real-Postgres harness from #235: a facilitator with an `engineering_manager` membership on team X is not offered X.
