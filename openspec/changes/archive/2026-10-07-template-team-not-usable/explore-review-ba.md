# Explore review (BA): template-team-not-usable (#214)

*Reviewer: Marcus Delgado (Business Analyst), 2026-10-06. Reviewed `exploration-notes.md` against
issue #214 and spot-checked the code it cites. Focus: can each idea become a requirement with a
testable acceptance condition?*

## Verdict

This is a strong exploration. The inventory is concrete. File and line references match what I
spot-checked (`getOrCreateJoinLink` at `facilitator-sessions.ts:463` and `:2388`, the four
`team_memberships` writers, and the picker query with no sentinel filter at `:2485-2495`). Finding
Chain B and `/auth/callback` turns up real gaps that the issue missed. The proposal must name both
explicitly, so neither gets treated as a scope dispute later.

The notes are weakest at the point where they become requirements. The core rule, "the template is
never a subject of the ritual", is stated as a principle, but its boundary is never written as a
closed list. Several decisions are left as "lean" or as an open question. The issue's own acceptance
criteria are looser than what the notes conclude. The sections below fix those gaps.

---

## 1. Clarifications needed (block the proposal until answered)

| # | Question | Why it blocks | My recommended answer |
|---|---|---|---|
| C1 | **Has the #188 environment data check run, and who owns it?** (Notes §8, OQ9) | Option B (DB `CHECK`) fails to migrate if sentinel rows exist, and the scope of the session guards (OQ2) depends on whether non-terminal sentinel sessions exist. Two requirements can't be finalised without this. | Name an owner before the proposal goes out. The proposal states one of two outcomes: "0 rows in `sessions`, `team_memberships` and `join_links` for the sentinel", or "N rows, handled by the cleanup in requirement X". It must not say "pending". |
| C2 | **Is the DB constraint in scope, yes or no?** (OQ1) | The notes say "A + B" but leave it open. The two scopes need different tasks, a migration and a rollback plan. | Yes, on `sessions.team_id`, `team_memberships.team_id` and `join_links.team_id`. Make it conditional on C1 returning zero rows. Otherwise the cleanup migration ships first, in the same change. |
| C3 | **What happens to existing sentinel rows if C1 finds any?** (OQ5) | "Revoke by migration?" is a question, not a requirement. Deleting sessions or votes conflicts with history preservation, which is the principle I fought for on topics. | Revoke join links (set them expired or revoked, don't delete). Soft-remove memberships (`removed_at`). Keep sessions and votes, but exclude them from every read model. This needs product sign-off from Brian. Raise it as an explicit decision and don't leave it to the implementer. |
| C4 | **Which session routes are guarded in the app layer, and which rely only on the constraint?** (OQ2) | "Entry points structurally, the rest via the constraint" leaves `complete`, `advance` and `facilitator-state` unspecified. `facilitator-state` is a GET that **writes** a join link, so it is an entry point by the notes' own definition. | Guard these in the app layer: `POST …/sessions/draft`, `GET …/sessions/:sessionId/facilitator-state` (it mints links), and `POST …/sessions/:sessionId/complete` (it unlocks the template). Constraint only for the rest. List each route by name in the proposal. |
| C5 | **Audit operation name.** (OQ3) | Tests assert on it, and Ops will filter on it. A name chosen during implementation becomes a contract by accident. | One operation, `team.template_access_denied`, with `metadata.endpoint` (method and route pattern) and `metadata.surface ∈ {session, membership, join_link}`. One name keeps a single Ops query. The metadata supplies the detail. |
| C6 | **`lockReason` field: server or client?** (OQ6) | It changes a shared type, which the tasks and the frontend need to know. | Server field, as the notes lean. Specify the enum exactly: `lockReason: "first_session" \| "canonical_defaults" \| null` (`null` when unlocked). |
| C7 | **Retire #188's accepted difference #1?** (OQ7) | It changes the spec. If it's left open, the spec keeps describing a reachable state that no longer exists. | Yes, retire it, but only if C2 is "yes". Without the constraint, a membership created out of band (ad-hoc SQL) still makes it reachable. |
| C8 | **Do any other read surfaces expose sentinel data?** The notes raise EM views and trend data (§4, §5) but don't inventory them. | If C3 keeps historical sentinel sessions, every read model that aggregates sessions has to exclude them. That surface is not inventoried. | Add a short inventory of the session and vote read models (trend, EM view, action items, `last_session_at` in the picker). Either state that "no sentinel rows exist, so N/A" (from C1), or add an exclusion requirement for each one. |

---

## 2. Vague areas and suggested rewrites

### V1. "The template is never a subject of the ritual" (notes §1)
**Problem:** This is a good principle but not a requirement, because nobody can test "subject of the
ritual".
**Rewrite as the owning requirement (in `default-topic-provisioning`):**
> The system SHALL NOT persist any row in `sessions`, `team_memberships` or `join_links` whose
> `team_id` is the template team id. Topic reads (TOPIC-001, TOPIC-002, `/topics/all`) and the
> copy into new teams are unaffected.

**Acceptance:** After the full structural test suite runs, and in each environment after migration,
`SELECT count(*)` for the sentinel id is 0 in all three tables. Any `INSERT` with the sentinel id is
rejected by the database (when C2 is yes).

### V2. "Respond as if the team does not exist" (issue and notes §5)
**Problem:** The notes define this correctly as per-endpoint parity, but the issue's acceptance
criteria don't. "As if it does not exist" is also undefined for routes that have no team in the path.
**Rewrite:** Carry the §5 table into the proposal **as the requirement**, one scenario per row. Add
these two rows that the table is missing:

| Route | Template response | Precondition order |
|---|---|---|
| `GET …/sessions/:sessionId/facilitator-state` (when `:teamId` = sentinel) | 404 "Session not found." and **no join link minted** | after 401 and the role 403 |
| `POST …/sessions/:sessionId/complete` (when the session belongs to the sentinel) | that route's "Session not found." 404, and `hasCompletedFirstSession(sentinel)` stays false | after 401 and 403 |

**Acceptance (per row):** status code, body `code`/`message`, and headers all match the
missing-team (or missing-session) response from the same endpoint for the same actor. Exactly one
`team.template_access_denied` audit row. Zero rows written to `sessions`, `team_memberships` and
`join_links`.

### V3. Response timing
**Problem:** #188 used a 150 ms timing floor. The notes mention it only for topic writes and don't
say whether the new guards apply it.
**Clarify and rewrite:** "Each template denial SHALL apply the same timing floor as the #188 guard"
(if the floor exists to defend parity), or "No timing floor; the template id is public" (if it
doesn't). Pick one. My lean is to apply it, for consistency, because a guarded route that is
measurably faster or slower than its missing-team path undermines the parity claim.

### V4. Picker exclusion (issue scope 2)
**Problem:** The notes are concrete here. My only gap is the acceptance condition.
**Acceptance:**
- A facilitator with zero memberships calls `GET /api/v1/teams/eligible-for-session`, and the
  response contains no entry with `teamId = 00000000-…-0001` and none named `__default_topics__`.
- An ordinary team that the facilitator doesn't belong to is still listed (no over-filtering).
- The filter uses the imported `DEFAULT_TOPICS_TEAM_ID` constant as a bound parameter. A grep test
  or review check confirms there's no new UUID literal.

### V5. "Show the template as permanently locked" (issue scope 5, notes §7)
**Problem:** "Permanently locked" is a UI phrase. The notes propose copy, but the copy is phrased as
"for example".
**Rewrite:**
> For the template team, TOPIC-002 SHALL return `isCustomizationLocked: true` and
> `lockReason: "canonical_defaults"` regardless of session history. Topic Management SHALL show:
> "These are the canonical default topics every new team starts from. They can't be edited here."
> It SHALL NOT show the "until this team completes its first session" copy.

**Acceptance:**
- An API test confirms that `/topics/all` for the sentinel returns `true` / `"canonical_defaults"`.
- An API test confirms that a normal team with no completed session returns `true` / `"first_session"`.
- An API test confirms that a normal team with a completed session returns `false` / `null`.
- A UI test confirms that each reason renders its own copy and that no edit controls render for
  `canonical_defaults`.
- `hasCompletedFirstSession` is **unchanged**. Add a test asserting the helper has no sentinel
  branch, to stop the coupling drift the notes warn about.

Also decide TOPIC-001 (`content.ts:597`). "Worth making consistent if it's a one-liner" is not a
decision. My recommendation is to include it with the same flag semantics, or to state explicitly
that it is out of scope because it can't be reached once sessions are blocked.

### V6. Structural test (issue scope 4, notes §6)
**Problem:** The issue's acceptance ("fail if any team-scoped session or membership write route
accepts the template") is weaker than the notes' own analysis, because it would miss
`facilitator-state`, `/api/join/:token` and `/auth/callback`. OQ4 leaves the file layout and the
selection rule open.
**Rewrite the acceptance criterion:**
> The structural test SHALL enumerate routes via `onRoute` and select every route matching
> `^/api(/v\d+)?/teams/:[^/]+/(sessions|members|managers|join-links)(/|$)` in **any method**,
> plus a named `EXTRA_IN_SCOPE_ROUTES` list that contains at minimum `GET /api/join/:token` and
> `GET /auth/callback`. Each selected route has an actor and a request builder in a per-route
> table. A selected route with no table entry fails the test (fail closed, no exemption list).
> For each route, the test asserts the V2 parity response, one audit row and zero sentinel rows.

**Acceptance for the test itself:** Add a temporary unguarded route in the test (for example,
`POST /api/v1/teams/:teamId/sessions/__probe`) and show that the suite fails. This proves the
selection catches new routes. #188 should have had this check too.

On file layout, I recommend a sibling file. The actor model is different enough that extending the
#188 file would make both harder to read.

### V7. "Practice need goes underground" (notes §8)
**Problem:** This is a real user-need risk, but its trigger is vague ("check before deciding
whether … needs filing").
**Rewrite:** "If C1 finds **any** sentinel `sessions` rows, file a follow-up issue,
'Facilitator practice mode', linked to #214, before this change archives. If it finds zero, record
'no evidence of practice use' in the proposal." This is a binary rule with a named artifact.

### V8. Test data leakage (notes §8)
**Problem:** The risk is named but has no control.
**Acceptance:** No test in the suite inserts a sentinel row into `sessions`, `team_memberships` or
`join_links`. With C2, the database enforces this. A CI step asserts zero sentinel rows after the
backend suite runs.

---

## 3. Traceability gaps

- **BRD and FR references.** The notes cite FR-8.1 and FR-8.6 for the template's purpose. The new
  requirements need a cited source for "facilitator from another team" and "no manager
  participates" (the rules the template trivially satisfies). Add the FR or use-case IDs so the
  spec deltas in `session-creation`, `manager-team-association`, `role-assignment` and `join-link`
  trace back to them.
- **Spec home (OQ8).** I agree: put the owning rule in `default-topic-provisioning`, and put
  check-order deltas in the four capability specs. Also add `topic-customization-lock` (for
  `lockReason`) and `topic-management-screen` (for the copy). Both exist in `openspec/specs/` and
  neither is in the OQ8 list.
- **Issue acceptance vs. proposal acceptance.** The proposal should state that it **supersedes**
  the issue's three acceptance bullets with V1, V2, V4, V5 and V6, and say why (the
  `/auth/callback` and `facilitator-state` gaps). That way reviewers don't grade against the
  weaker list.

---

## 4. Explicitly out of scope (state these in the proposal so they don't become disputes)

- A facilitator practice or sandbox mode (see V7 for the trigger to file it).
- A `teams.kind` column (option D) and marking the sentinel deactivated (option C, rejected).
- A DB constraint on `topics` (deferred to F3 by #188).
- Any admin override or feature flag that allows the template to be used as a team (notes §5:
  "structural, not configurable"). Write this as a requirement ("no configuration SHALL enable…")
  and not only as a non-goal.
