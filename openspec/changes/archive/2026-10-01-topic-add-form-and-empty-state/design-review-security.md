# Design Review: Security (topic-add-form-and-empty-state)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Artifacts reviewed:** `design.md`, `proposal.md`, `specs/topic-customization-lock/spec.md`, `specs/topic-management-screen/spec.md`
**Code checked:** `packages/backend/src/routes/content.ts` (TOPIC-002, ~L550–L715), `packages/backend/src/routes/topics.ts` (TOPIC-003 ~L110–L145, ~L262–L340, ~L699–L830), `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/backend/src/app.ts` (cookie), `packages/frontend/src/pages/TopicManagementPage.tsx` (rendering conventions)
**Verdict:** **Approve with conditions.** One condition (S1, a parity test) is required before implementation is accepted. The rest are recommendations or notes. This change adds one boolean to a read endpoint and a UI for a write endpoint that already exists. It does not move any server-side authorization boundary.

---

## 1. What changes in the threat model

| Surface | Before | After | Net |
|---|---|---|---|
| `POST /teams/:teamId/topics` (TOPIC-003) | Reachable by any standing facilitator via a hand-crafted request | Same endpoint, same checks, now reachable from a button | Authorization boundary unchanged. Practical reach is wider (see §6) |
| `GET /teams/:teamId/topics/all` (TOPIC-002) | Returns lists, lock, `canEditAnnotations` | Adds `canAddTopics: boolean` | Discloses nothing the caller doesn't already know (their own role) |
| Rendering of `name` / `prompt` / `firstSessionDescription` | Already rendered on this screen as React text | Also in outcome messages and duplicate warnings | Same sink type (React text node) |
| Remove/Restore refetch path | Full-screen error on failure | Inline alert | No security effect |

No new endpoint, no schema change, no new identity flow, no new session or token handling, and no WebSocket surface. That is the correct shape for a change of this kind.

---

## 2. Can `canAddTopics` diverge from TOPIC-003's real authorization?

This was the main question I was asked to check, so here is the derivation from the code.

**TOPIC-002** calls `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)`. That function:
- no user row → deny (`NOT_A_FACILITATOR`)
- `application_admin` → **allow, before any membership check**
- any other non-`facilitator` role → deny
- `facilitator` and active member → deny (`FACILITATOR_IS_TEAM_MEMBER`)
- `facilitator` and not a member → allow

The proposed flag is `decision.actorGlobalRole === "facilitator"`, computed only after the decision has allowed the caller.

**TOPIC-003** calls `checkStandingFacilitatorAuthorization`, a different function. It reads the same `evaluateStandingFacilitatorAccess` row and allows exactly `facilitator ∧ ¬isMember`.

**Result today:** among callers TOPIC-002 admits, `canAddTopics === true` holds exactly when TOPIC-003's 403 checks would pass. That covers non-member facilitators. Admins (including an admin who is also a team member) get `false`, matching TOPIC-003's rejection. Both functions read live, uncached rows in a single query, so the only divergence is time-of-check/time-of-use (role revoked or membership added between GET and POST). The server enforcement covers that, and the design's 403 handling handles it correctly. Spec G1 ("the flag computes no membership") is accurate.

**Where it can drift:** the equivalence is **implicit**. It depends on three things staying true together:
1. TOPIC-002's helper still rejecting member facilitators before the flag is computed,
2. TOPIC-003 still using a different, facilitator-only helper,
3. whoever fixes #176 updating both the flag and TOPIC-003 "in the same change", as the spec text says.

Nothing in the design enforces (3) mechanically. The spec sentence is a promise, not a control. A #176 fix that widens TOPIC-003 but forgets the flag fails closed: the admin just doesn't see the button. The reverse fails open: the button shows and the server returns a 403. Neither direction is exploitable, because the server is authoritative. But drift in the fail-open direction is exactly the "UI says yes, server says no" bug that ends up "fixed" by loosening the server.

**S1 (required): parity test.** Add one table-driven backend test that runs, for each caller class, both TOPIC-002 and a TOPIC-003 request against an unlocked team, and asserts `canAddTopics === (POST status !== 403)`. Caller classes: facilitator non-member, facilitator member, `application_admin`, `application_admin` who is also a member, engineer, engineering manager. This turns the spec's "same change" sentence into a failing test the moment the #176 fix touches one side only. It belongs in `content.test.ts` or a small cross-route test, and it fits the existing task for the flag's tests. It is a test, not a scope increase.

**S2 (recommendation, not required):** consider exporting one predicate (for example `canAddCustomTopic(globalRole)`) from `standing-facilitator-access-helper.ts`, and using it both for the flag and inside TOPIC-003's check. The design states that TOPIC-003's contract doesn't change and the helper's author deliberately kept it separate, so I am not asking for this refactor now. If #176 is fixed by making TOPIC-003 call the `OrAdmin` helper, that is the natural moment to do it.

**Fail-closed default is correct.** The migration plan treats a missing `canAddTopics` as `false`. Keep it that way: the frontend must use `=== true`, not truthiness on a possibly-undefined field coerced elsewhere. Worth one assertion in the component tests.

---

## 3. Data access boundaries

- **Duplicate check does not leak across teams.** It runs entirely client-side against the `active[]` and `archived[]` lists TOPIC-002 already returned for **this** `teamId`. Both TOPIC-002 queries filter on `t.team_id = $1`. The server has no uniqueness check, so there is no server-side oracle a caller could probe to learn about other teams' topics. **Keep it that way.** If fuzzy or server-side duplicate detection is ever added (deferred in Non-Goals), it must be scoped by `team_id` in the query itself, and that change needs a security review. A "does a topic named X exist?" endpoint without a team filter would be a cross-team enumeration oracle.
- **`defaultTopicsNotActive` is correctly left alone.** Its fallback `topicId: row.team_topic_id ?? row.default_topic_id` returns IDs belonging to the template team (`00000000-…-0001`) to any TOPIC-002 caller. That is a pre-existing, low-severity disclosure of template-team identifiers, and it feeds directly into #188, because it hands callers valid topic IDs on the sentinel team. The decision not to read it on this screen (proposal "What Changes", last bullet) is good from a security standpoint too. I'd add a line to `handoffs/default-topics-not-active-name-join.md` noting that the fallback exposes template-team topic IDs, so whoever fixes the join also removes that.
- **Nonexistent team:** TOPIC-002 does not check team existence (it returns `teamName: ""` and empty lists). For a standing facilitator it would return `canAddTopics: true`. `isCustomizationLocked` will be `true` because no completed sessions exist, so the control stays hidden, and TOPIC-003 answers 404 anyway. No exposure. Noting it because the flag's correctness here depends on the lock, not on the flag.
- **Deactivated teams:** `checkTeamExists` deliberately does not filter `deactivated_at` (Decision 11 of the earlier change), so a facilitator can add topics to a deactivated team via this form if it is unlocked. That is pre-existing and stated elsewhere, but this design doesn't mention it. **Implicit decision, flagged:** confirm that's intended for the UI path too.

---

## 4. Rendering of user-supplied text (XSS)

The risk is low and the existing conventions are right:
- The page already renders topic text and definitions as React text nodes with `white-space: pre-wrap`, with an explicit "never `dangerouslySetInnerHTML`" comment (`TopicManagementPage.tsx` ~L177). No `innerHTML`, markdown renderer, or HTML sink exists in `packages/frontend/src`.
- The new sinks are the "Added '<name>' …" status, the "Archived/Restored '<name>' …" alerts, and the duplicate warning naming the matched topic. If these are template-literal strings rendered as `{message}`, they are safe.

**S3 (recommendation):** these rules are what keep it that way during implementation:
1. Build outcome and warning strings as plain strings rendered as text. Never pass them to an HTML-setting API, an `aria-*` attribute assembled with HTML, or `document.title` via any templating that interprets markup.
2. Focus the new row and the archived match by **React ref or a lookup keyed on `topicId`**, not by `document.querySelector` with a selector built from `name`. If a selector is built from `topicId`, use `CSS.escape`. The `topicId` comes from the server and is a UUID today, but #184 already notes `teamId` isn't UUID-validated on these routes. Don't assume the format.
3. Add one component test that submits a name like `<img src=x onerror=alert(1)>` and asserts it appears as literal text in the success message and the row heading. It is cheap and catches a future regression to an HTML sink.
4. Render the server's `error.message` (403/404/422 paths) only when the response parsed as the JSON error envelope. For non-JSON bodies (a proxy's HTML 502 page, for example), use the fixed network/5xx copy. The design's 5xx path already uses fixed copy. Make sure the 403/404 branch doesn't fall through to rendering a raw body.

**Deferred and implicit, flagged:** names and prompts accept any Unicode up to the length limit, including bidi overrides and zero-width characters. These are visible to other facilitators and, once #175 lands, to participants. This is a spoofing and confusion concern rather than code execution, and the exact-match duplicate check is trivially bypassed by them (which is acceptable, since the check is a hint). Not in scope here. I'd like it on the list for #184's hardening pass, or for whichever change first shows custom topics in session.

**CSRF:** the session cookie is `sameSite: "strict"` (`app.ts` L84) and the POST is JSON. No new exposure from the new form.

---

## 5. Audit logging

- **Success:** TOPIC-003 already writes `topic.custom_added` to `audit_log` **inside the insert transaction**, with actor, role, IP, team and `topic_id`, and also emits the structured log event. Good. Because topic `name`, `prompt` and `vote_type` are immutable (no edit endpoint, and the design explicitly rules one out), the `topics` row plus the audit row reconstructs who added what and when. This is also the only creator record today, so the `custom-topic-creator-attribution` handoff should reference `audit_log` as the interim source of truth and not assume none exists.
- **Lock denial:** `topic.write_denied_locked` is written synchronously before the 409. Good.
- **Authorization denial (403):** **not audited** on TOPIC-003 or TOPIC-002. This is pre-existing and consistent across the topic endpoints, so I'm not asking this change to fix it. Recording it as an **implicit, deferred decision**: a repeated 403 `FACILITATOR_IS_TEAM_MEMBER` is precisely the signal of someone trying to curate their own team's topics. Suggest folding it into #184's hardening pass.
- **No new events needed** for the flag, the empty state, or the client-side duplicate check. Client-side "Add anyway" overrides are not security events and should not be logged as such.

---

## 6. Abuse and availability (reference only, out of scope)

The form turns a curl-only capability into a button. Under the standing, org-wide facilitator model, any non-member facilitator can add topics to **any** unlocked team. That is by design (Philosophy 1), and the boundary is unchanged. What does change is the cost of abuse:
- **No rate limit** on TOPIC-003 (#184 item 3). Topics can only be archived, never deleted, and TOPIC-002 returns all of them unpaginated. A compromised facilitator session, or a script riding one, can grow a team's topic set without bound, permanently. **Defer to #184; do not absorb.** I'd raise #184's priority slightly now that a UI exists.
- **#184 advisory-lock case sensitivity** applies to TOPIC-003's `pg_advisory_xact_lock(hashtext($1))`. The frontend always uses the canonical `teamId` from the route, so the form doesn't make it worse. Stays in #184.

---

## 7. Template team (#188)

TOPIC-003 has no sentinel-team guard, and #188 says it "should be checked at the same time". Today a write to `/teams/00000000-…-0001/topics` returns 409 **only because** the sentinel has no completed session. If someone loads `/team/00000000-…-0001/topics` in the browser, TOPIC-002 admits a standing facilitator and returns `canAddTopics: true` with `isCustomizationLocked: true`, so the form is hidden by the lock alone.

This change adds the first UI that would expose a template-team write if that accidental protection ever lapsed. **Do not absorb #188.** But:

**S4 (recommendation, optional):** computing `canAddTopics = false` when `teamId === DEFAULT_TOPICS_TEAM_ID` is one condition in code that already has the constant in scope (`content.ts` L529). It is presentation-only and **is not a substitute** for the server guard #188 requires. If the team prefers to keep the flag a pure function of role (spec G1), that is acceptable. In that case, add a comment on #188 noting that the add form now exists and the sentinel is protected only by the lock.

---

## 8. Deferred and implicit security decisions (summary)

| # | Decision | Status in design | Owner / tracker |
|---|---|---|---|
| D1 | Flag/endpoint parity is maintained by a spec sentence, not a control | Implicit | **S1 test (this change)** |
| D2 | Administrators cannot add (FR-8.2 defect) | Explicit, temporary | #176 |
| D3 | No rate limiting on topic creation | Not mentioned | #184 |
| D4 | 403 denials on topic endpoints are not audited | Not mentioned | Suggest #184 |
| D5 | Sentinel team protected only by the lock | Not mentioned | #188 (+ optional S4) |
| D6 | Adds allowed to deactivated teams | Inherited, not restated | Confirm intent |
| D7 | Unicode control/bidi characters in topic text | Not mentioned | Suggest #184 or first in-session display change |
| D8 | `defaultTopicsNotActive` leaks template-team topic IDs | Not mentioned (screen avoids the field) | Add to existing handoff |
| D9 | Duplicate check must stay team-scoped if it ever moves server-side | Implicit (client-side today) | Note for future change |

---

## 9. Conditions

**Required before implementation is accepted:**
- **S1.** Parity test across caller classes: `canAddTopics` ⇔ TOPIC-003 does not return 403.

**Recommended (non-blocking):**
- **S2.** A shared `canAddCustomTopic` predicate when #176 is fixed.
- **S3.** Rendering rules and one XSS regression test. Render `error.message` only from a parsed envelope. Use ref- or ID-based focus with `CSS.escape` if a selector is used.
- **S4.** Optional `canAddTopics = false` for the sentinel team, or a comment on #188.
- Add D8 to `handoffs/default-topics-not-active-name-join.md`. Point the creator-attribution handoff at `audit_log`.
- Assert that the frontend treats a missing `canAddTopics` as `false` (`=== true` check).
