# Exploration notes: topic002-unknown-team-404 (#265)

Voice: Devon Calloway, Internal Champion. Thinking-partner notes only; no code changed.

## What I read
- Issue #265; `routes/content.ts` TOPIC-002 handler (~L845-1160); `routes/topics.ts` `checkWritableTeam` (~L188) and the 403 -> 404 -> 409 -> 422 cascade; `TopicManagementPage.loadTopics` (~L655); `team-not-found-envelope` spec; `topic-customization-lock` spec (L159, L299-303 name `team_found`); REST API Contract TOPIC-002 404 row (L696); `topic-management-screen` spec (403 text at L23).
- `team_found` appears in: content.ts L1143 (+ event field `teamFound`), content.test.ts (L940, L1620 pinned key set, L1718, L1760, L1871), topic-002-admin-audit-integration.test.ts (L185, L262-275), topic-annotation-integration.test.ts L364, audit-logger.ts comment L179, topic-customization-lock spec L159/L299, REST contract L696. `team-content-access` spec does not mention it (issue said "if it does"; grep says no).

## Intent, from where I sit
I don't care about the 404 for its own sake. I care that the audit log is honest and that the ritual's guardrails read the same from every door. Today the admin arm writes an `admin.topic_config_accessed` row saying "an admin accessed this team's topic config" for a team that is not there. An audit row that records access to nothing is noise at best. At worst it teaches reviewers to ignore the `admin.topic_config_*` stream, and that stream is the only thing watching admins reach into team topic config. The no-manager rule is protected partly by being able to say "here is every time an admin looked." Don't dilute that.

Second: a mistyped/stale link shows an empty, apparently valid team. A facilitator may then "fix" it by adding topics. They can't (the write routes 404), but the screen suggests a real team exists. A new team with no one to explain it to is exactly the adopter I'm worried about; the screen has to say plainly "Team not found."

## Ritual constraints in play
1. **No-manager rule / admin arm.** The admin arm computes `membership_role` and `actor_idp_roles_include_em` (EM-flag metadata) for the audit. Those exist so we can see when an EM-affiliated admin reads a team. For a nonexistent team neither fact means anything (no membership can exist: FK). So moving the existence check before the arm is safe: nothing about the no-manager story is lost. Danger is the opposite: someone puts the check *after* the arm "to keep the arm's prefix reads identical" and an audited row slips out for a ghost team. Order is the whole point.
2. **Facilitator-from-another-team.** `FACILITATOR_IS_TEAM_MEMBER` 403 must keep winning over 404 for a member facilitator of... an existing team. For a missing team there are no members, so a facilitator reaches 404, never the member-403. A participant gets `NOT_A_FACILITATOR` 403 even for a missing team (authorization before lookup). Keep it: an unauthorized caller must not learn whether a team exists (enumeration resistance; the timing floor is part of that).
3. **Audit of denials (#264).** The 403s are audited (fail-open). The 404 must not be: write routes don't audit missing-team 404s, and the issue says so. Resist the temptation to add a "denied: team not found" row; we'd be logging attacker typos and giving a way to flood audit_log (a 404-for-random-uuid loop). Open question for the team: is there a rate/volume argument for the *asymmetry* (403 audited, 404 not)? I think yes, and it should be written down in the design so nobody "fixes" it.
4. **Template team.** `__default_topics__` is a real row in `teams`, so the new existence check passes and its TOPIC-002 behaviour is unchanged, including the admin-read audit row (#232: "every team, the template team included"). Whether template reads should 404 is #214-family; keep out. Regression test required. Flag: a reviewer might read "names no team" as including the template; the spec must say it does not.
5. **Not a performance tool / no per-engineer data.** Not touched, but the audit metadata keeps text-free (counts only). Don't add the requested id to anything beyond `team_id` as now.

## Design questions I'd press on
- **Where does the existence check live?** Issue: after `assertTopic002AuthorizedRole`, before admin arm; fold into the name query so a found team costs no extra query. Moving `SELECT name FROM teams WHERE id=$1` earlier does that: found -> name in hand; missing -> 404. The facilitator query count (by SQL text) stays equal. The admin path loses nothing either; it just runs the name read before membership/role-set reads. Note the issue says "reuse `SELECT id`" but also "fold into name query": pick `SELECT name` (reusing the existing text) so the #259 SQL-text-count test needs no change. If instead a new `SELECT id` is added, the count test breaks and the facilitator gains a query, violating an acceptance criterion. Decide explicitly.
- **No `deactivated_at` filter.** Matches `checkWritableTeam` and Decision 11. A deactivated team still exists; keep it consistent. Check no deactivated column filter sneaks in via a shared helper.
- **Order vs timing floor.** 404 path: `await applyTimingFloor(startTime)` then `noStore(reply).code(404).send(teamNotFoundEnvelope())`. Use the envelope function, never the literal (structural test greps for "Team not found."; the frontend string "Team not found." lives in frontend, outside the backend grep, but verify the grep scope).
- **Timing side channel.** Authorized unknown-team 404 now returns faster in raw work than an authorized 200 (fewer queries). The floor flattens it; confirm the floor value covers the 200 path's worst case, otherwise authorized callers (facilitators are low-risk, admins trusted) can distinguish. Low severity since the caller is already authorized, and the issue accepts that authorized callers learn existence.
- **`team_found`: remove vs keep constant.** I back removal. A key that is always `true` is a lie-by-omission waiting to happen: someone later reads it as a live check. But removal changes a pinned key set in audit rows; consumers (dashboards, any log queries) of `team_found` would silently read undefined. Historic rows already written with `team_found: false` (and `true`) stay in the DB; the spec should say old rows may carry the key. Also drop `teamFound` from the structured log event (content.ts event payload L~1157). Also fix the `audit-logger.ts` L179 comment. Check whether anything else reads the metadata (grep found only tests).
- **Mid-request deletion race.** Team deleted between existence check and data reads -> empty 200 with name from earlier. Teams are not hard-deleted today (`deactivated_at`), so I'd call it theoretical; note it and move on. Also the archive/active reads could stay empty for a real team with no topics, which must still be 200, not 404 (test: existing team with zero topics -> 200 empty). That is the main drift trap: keying 404 on "empty lists" rather than "no team row".
- **TOPIC-001.** Unknown team gives 403 via evaluateTeamAccess (no grant). Add the test; do not change. The contract then has two different answers to the same input across TOPIC-001 and TOPIC-002 (403 vs 404), and that is deliberate: TOPIC-001 is session-scoped (authorization-before-lookup), TOPIC-002 is role-scoped. Write one sentence in the contract so it doesn't look like a bug to the next reader.
- **Case sensitivity.** `isCanonicalUuid` precedes; writes lowercase `teamId` after the boundary (#184 Decision 9). TOPIC-002 passes `teamId` as-is; check whether upper-case canonical UUIDs are accepted by `isCanonicalUuid` and whether `SELECT ... WHERE id=$1` handles them (Postgres uuid compare is case-insensitive; but the template-team comparison `teamId === DEFAULT_TOPICS_TEAM_ID` is string-based). Not in scope unless the check introduces a string compare; just don't add one.

## What could go wrong if the design drifts
1. Existence check placed before authorization: an unauthenticated-to-team caller (participant) could enumerate teams by 404 vs 403. Pin order with tests: participant and member-facilitator on an unknown/known team get 403.
2. Check placed after the admin arm: ghost-team audit rows continue, or the 404 arrives after membership/role-set reads, and failure signals (`admin.audit_write_failed`) fire for non-events.
3. Adding a separate `SELECT id` query: facilitator +1 query, #259 count test fails, or someone "fixes" the test by loosening it.
4. Writing an audit row (or an `admin.topic_config_denied`) on the 404: audit growth from guessable uuids and a log of non-events.
5. Keeping `team_found` as an always-true constant and leaving the old spec scenario ("200 ... team_found = false") in place: spec and code disagree; `openspec validate --strict` may pass while the scenario is false. Replace the scenario, don't just add.
6. Frontend: only mapping 404 inside the generic `!res.ok` branch with message from body; but a non-JSON 404 (proxy page) must still read "Team not found."? Hmm: a proxy 404 would then be mislabelled as team-not-found. Prefer: show envelope message when the body is a standard envelope with `code: TEAM_NOT_FOUND` (or the shared `hasEnvelopeMessage`), otherwise the generic "Failed to load topics." For a real 404 from the app the envelope is always there. Decide and test both. Also: show no topic list, no definition block, no write controls on 404 (same as the 403 state), and not as a network error.
7. The quiet-refetch/other TOPIC-002 callers in the page (annotation refetch after 404/422) should not regress: a refetch that now 404s on a vanished team should not blank the screen incorrectly; check the quiet refetch path handles a non-ok gracefully (it was previously 200-empty).
8. Template team accidentally 404ing (e.g. someone filters the existence query on `id <> DEFAULT_TOPICS_TEAM_ID` to share a helper with the write routes, which reject the template). Regression test pins 200 + the admin audit row.
9. Doc drift: the contract row restored to "malformed or unknown id" must not claim the template team 404s. Also remove the "tracked optional follow-up" sentence from L696.

## Test inventory I'd expect (mapped to acceptance criteria)
- Unit (content.test.ts): facilitator + unknown team -> 404, envelope, no-store, timing floor called; admin + unknown -> 404 and zero audit inserts, no membership/role-set reads; participant + unknown -> 403 identical to participant + existing (audited per #264); member-facilitator on existing team -> 403; facilitator on existing team -> identical SQL-text multiset to before; existing team with no topics -> 200; deactivated team -> 200; uppercase UUID matching no team -> 404; template team -> 200 unchanged; `team_found` removed from key set.
- Backend: TOPIC-001 unknown team -> 403 regression.
- Integration (real Postgres): unknown team -> 404 for facilitator and admin; `audit_log` count delta 0 (for the admin, and for the facilitator). Note the participant 403 case does write a #264 denial row, so scope the zero-delta assertion to the 404 cases only.
- Structural: `team-not-found-envelope-structural.test.ts` still green; content.ts uses `teamNotFoundEnvelope()`.
- Frontend: 404 with envelope -> "Team not found." (no list, no controls, announced like the 403 state, no empty-shell flash, same navigation way-out as 403); 404 non-JSON -> "Failed to load topics."; quiet refetch returning 404/403/500 leaves content and unsaved edits intact with an inline notice; existing 403 and generic failure unchanged.

## Docs touch list
- REST API Contract L696 TOPIC-002 404 row.
- `topic-customization-lock/spec.md`: replace scenario at L156-159 with a 404 scenario; amend the metadata requirement at L299-303 (drop `team_found`); the "Team ids that name no team" paragraph #232 added.
- `topic-management-screen/spec.md`: new 404 state beside the 403 requirement (L23).
- `team-content-access/spec.md`: grep found no `team_found`; likely no edit (confirm "unknown team" wording there for TOPIC-001).
- `audit-logger.ts` comment L179; `team-not-found-envelope` spec list of covered routes (add TOPIC-002 explicitly, currently only "content routes" loosely).

## Verdict
Small, safe, worth doing, as long as the order is: boundary 404 -> shared authz (403, audited) -> role assertion -> existence/name read (404, not audited) -> admin arm (audited 200). The thing I want written into the design.md is the *why* for each of: no audit on 404, check after authz, no extra query for facilitators, template team untouched. Without the whys, each of those looks like an arbitrary quirk and someone will "tidy" it.

## Resolved decisions (after Priya's and Marcus's reviews)
1. **Remove `team_found`.** New `admin.topic_config_accessed` rows carry no `team_found` key; historic rows may carry it with either value; `teamFound` is dropped from the structured log event; `audit-logger.ts` comment fixed. "Confirm no external log/dashboard consumer of `team_found`" is a verification task in tasks.md (owner: implementer), not an open requirement. Not "constant".
2. **Requirement = same SQL texts for a standing facilitator.** A standing facilitator on an existing team executes exactly the pre-#265 multiset of SQL texts (test asserts equality, not a looser bound). Mechanism (move the existing `SELECT name FROM teams WHERE id=$1` earlier; no new `SELECT id`) goes in design.md. Admin query order: only the absence of membership/role-set reads on 404 is required; if the #259 tests pin admin order, update them deliberately and say so in the task.
3. **404 copy only for the envelope code.** Frontend shows "Team not found." only for a 404 whose body carries `code: TEAM_NOT_FOUND`. Any other 404 (proxy, non-JSON) shows the generic "Failed to load topics." Brian to confirm a bare 404 is never labelled team-not-found; I am proceeding on that basis. This supersedes the issue's loose "or the envelope message".
4. **Timing floor is a call-site requirement only.** The 404 path calls the same `applyTimingFloor` routine as the 403 path before replying. Adequacy of the floor value is out of scope; recorded as a known low-severity residual (callers reaching it are already authorized).
5. **Template team.** `__default_topics__` exists in `teams`, so TOPIC-002 returns 200 and, for admins, writes the access row as today. "Names no team" does not include the template; the spec says so literally.
6. **Quiet refetch.** After a successful initial load, a refetch that returns any non-ok (404, 403, 500) retains the prior list and any unsaved edit and shows a small inline notice; it never swaps visible content for an error page. Explicit acceptance criterion (accepted from Priya; it also answers Marcus's "pick one"). The initial-load 404 still renders the full "Team not found." state with no list, definition block or write controls.
7. **Mid-request deletion race: explicit non-goal.** Teams are soft-deactivated, never hard-deleted, so the window does not exist in practice.
8. **Case sensitivity: plain non-goal.** No new string comparison on `teamId` is introduced. One scenario: an uppercase canonical UUID matching no team returns 404.
9. **TOPIC-001 vs TOPIC-002 contract sentence (to land in the REST contract and design.md):** "TOPIC-001 is session-scoped and decides authorization before lookup, so an unknown team yields 403; TOPIC-002 is role-scoped and, once the caller's role is authorized, an unknown team yields 404."

### Needs user confirmation (policy question, proceeding on the issue's behaviour)
**Audit asymmetry: 403 is audited (#264), 404 is not.** Reasoning: an audit row for a nonexistent team records access to nothing, and an unauthenticated-to-team caller looping random UUIDs could flood `audit_log`; the issue states no audit on 404, and write routes already do not audit missing-team 404s. But this is data-access policy, which I (and Marcus) defer to Brian / the VP of Engineering on. Implementation proceeds with no audit row on 404. Priya's related question (noise from a legitimate member-facilitator hitting 403 audit rows) is unchanged by this issue and belongs with #264.

### Actor matrix (adopted from Marcus; replaces the muddled "member-facilitator on unknown team")
A member-facilitator of a missing team cannot exist (FK), so that case is dropped rather than tested.

| Actor | Team state | Expected | Audit row |
|---|---|---|---|
| No session | any | existing behaviour, unchanged | unchanged |
| Participant | unknown or exists | 403 NOT_A_FACILITATOR, byte-identical either way | #264 denial row (unchanged) |
| Facilitator who is a member of the requested team | exists | 403 FACILITATOR_IS_TEAM_MEMBER | #264 denial row |
| Standing facilitator (not a member) | unknown | 404 TEAM_NOT_FOUND, no-store, timing floor called | none |
| Standing facilitator | exists / zero topics / deactivated / template | 200, no extra query | none |
| Admin | unknown | 404 TEAM_NOT_FOUND, no-store, timing floor called | none; no membership/role-set reads; no `admin.audit_write_failed` possible |
| Admin | exists / template / deactivated | 200 | exactly one `admin.topic_config_accessed`, no `team_found` |

Named scenarios (drift guards): existing team with zero topics returns 200 with empty lists and the real `teamName`; deactivated team returns 200 (no `deactivated_at` filter); non-canonical id still 404s before any query (regression); TOPIC-001 unknown team stays 403.

### Review feedback incorporated
- Facilitator (Priya): quiet-refetch criterion (6); 404 state announced to assistive tech the same way as the 403 state and shown on first render with no intermediate empty-team flash (frontend tests); 404 state offers the same way-out navigation the 403 state has (match it; if the 403 state has none, that is a follow-up, not new scope); the 403 and 404 copy read as a matched pair; explicit non-goal that live session routes (facilitator control surface, readiness, reveal) and participant views are untouched, with a review step confirming no shared helper those routes use is changed; design.md "why" that the 404 copy exists so a facilitator can recover, not to explain internals. Priya offered a usability pass on copy and layout before ship; accepted.
- BA (Marcus): decisions 1-4 closed above; "honest audit log" restated as measurable (zero `audit_log` inserts on 404); enumeration resistance restated as byte-identical participant responses; docs items become verification tasks with outcomes recorded; actor matrix adopted; test inventory no longer says "or constant".

### Acceptance conditions (rewritten, testable)
1. Unknown canonical UUID, standing facilitator or admin: 404, body equals `teamNotFoundEnvelope()`, `Cache-Control: no-store`, timing floor invoked.
2. Same id, participant: response identical to a participant on an existing team.
3. On any TOPIC-002 404: `audit_log` row count unchanged; admin path ran no membership/role-set query.
4. Admin on an existing (incl. template, deactivated) team: exactly one `admin.topic_config_accessed` row, metadata has no `team_found`; pinned key-set tests updated.
5. Standing facilitator on an existing team: SQL-text multiset equals the pre-change multiset.
6. Existing team with no topics: 200, empty lists, correct `teamName`.
7. `DEFAULT_TOPICS_TEAM_ID`: 200 as before; admin access row still written.
8. TOPIC-001 unknown team: 403 (unchanged).
9. Page gets 404 with `code: TEAM_NOT_FOUND`: "Team not found.", no list, no definition block, no write controls, no network-error/generic text. A 404 without that envelope shows "Failed to load topics.".
10. Quiet refetch returning 404/403/500 after a successful load leaves existing content and unsaved edits intact, with an inline notice.
11. Docs: contract row reads "team does not exist (malformed or unknown id)" with the "tracked optional follow-up" sentence removed; the old "200 ... team_found = false" scenario is replaced, not supplemented; `openspec validate --strict` passes.

### Scope additions beyond issue #265 (call out in the proposal so they are not later treated as creep)
Quiet-refetch behaviour and its test; `team-not-found-envelope` spec update naming TOPIC-002 explicitly; zero-topics, deactivated and uppercase-UUID drift-guard scenarios; participant byte-identical assertion; TOPIC-001/TOPIC-002 contract sentence.

### Pushed back / deferred (scope creep for #265)
- **Deactivated-team indication on the topic screen:** follow-up. This change keeps a deactivated team at 200, unchanged. Record that #265 does not fully solve "stale link" confusion.
- **Clearing a remembered/stale team id (picker selection, last-team memory) after a 404:** follow-up; app-wide navigation state, not part of this endpoint fix. Needs its own issue and a look at where the id is remembered.
- **Showing the requested id and a second explanatory copy line ("link may be out of date or you may lack access"):** not required. Risk that the second half hints at existence to unauthorized users; the 403 screen already covers lack of access. Copy goes through the owner of copy and Priya's usability pass; the requirement is only the fixed "Team not found." string.
- **Retry action on the generic failure state:** only if the page already offers one; otherwise follow-up.
- **Inventory of stale-link sources (handoff links, emails, notifications):** not a code change here; note as a question for Brian, feeding the follow-ups above.
- **Deactivated-team behaviour, remembered-id clearing, retry button:** listed under non-goals in the proposal alongside "no live session or participant view changes".
