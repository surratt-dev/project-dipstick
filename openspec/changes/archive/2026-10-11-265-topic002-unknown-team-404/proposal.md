# Proposal: topic002-unknown-team-404 (#265)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` as revised after Priya Nair's `explore-review-facilitator.md` and Marcus Delgado's `explore-review-ba.md`. Revised after `propose-review-ba.md` (Marcus) and `propose-review-exec.md` (Rachel Okonkwo). Traceability: issue #265 and the openspec specs (topic-customization-lock, team-not-found-envelope, topic-management-screen); nothing in the BRD or `requirements/` mentions TOPIC-002 or admin audit rows.*

## Why

I do not care about this 404 for its own sake. I care that the audit log stays honest and that the ritual's guardrails read the same from every door.

Today `GET /api/v1/teams/:teamId/topics/all` (TOPIC-002) answers a canonical UUID that names no team with `200`, an empty team name and empty lists. For an admin it also writes an `admin.topic_config_accessed` row saying "an admin accessed this team's topic config" for a team that is not there. That stream is the only thing watching administrators reach into team topic configuration, and the no-manager rule is protected partly by being able to say "here is every time an admin looked." A row recording access to nothing teaches reviewers to ignore the stream.

The second cost is on the screen. A mistyped or stale link shows an empty, apparently valid team. A new team with nobody to explain the tool to needs the screen to say plainly "Team not found."

## What Changes

- TOPIC-002 answers a canonical UUID with no `teams` row with `404 TEAM_NOT_FOUND` (shared `teamNotFoundEnvelope()`), `Cache-Control: no-store`, after `applyTimingFloor`, for a standing facilitator or an application admin.
- Order is fixed and is the point: boundary 404, shared authorization (403, audited), role assertion, team-name read (404, not audited), administrator arm (audited 200).
- The existing `SELECT name FROM teams WHERE id = $1` moves ahead of the admin arm. No new query: a standing facilitator on an existing team runs the same multiset of SQL texts as before. On the admin path, a 404 runs no membership-role or role-set read, writes no audit row and emits no audit event of any kind.
- `team_found` is removed from the `admin.topic_config_accessed` metadata and `teamFound` from its structured event. It would always be `true`. Historic rows may carry the key.
- The Topic Management screen shows "Team not found." (exactly the envelope message) for an initial-load 404 whose JSON body has `error.code === "TEAM_NOT_FOUND"`, reusing the existing error state and its "Back to team" link. Any other non-ok initial load, including a JSON 404 with a different code, shows "Failed to load topics."
- Docs: REST API Contract TOPIC-002 404 row (restored to "team does not exist (malformed or unknown id)", "tracked optional follow-up" sentence removed, status order reading `403 -> 404`), the `audit-logger.ts` comment, and one sentence on why TOPIC-001 (unknown team: 403) and TOPIC-002 (404) differ.

## Ritual constraints preserved

- **No-manager rule.** The `membership_role` and `actor_idp_roles_include_em` facts exist to show when an EM-affiliated admin reads a team. For a non-existent team no membership can exist (FK), so nothing of the no-manager record is lost by answering earlier. Every read of an existing team, template and deactivated teams included, is still audited exactly once.
- **Facilitator from another team.** `FACILITATOR_IS_TEAM_MEMBER` still wins for a member-facilitator of an existing team. A member-facilitator of a missing team cannot exist.
- **Enumeration resistance.** Authorization precedes lookup, so a participant gets a byte-identical `403 NOT_A_FACILITATOR` for an existing and a non-existent team. Authorized callers learn existence; the issue accepts that.
- **Denial audit (#264)** is untouched.
- **Not a performance tool.** Nothing new is recorded; no requested id lands anywhere beyond `team_id` as today.

## Non-goals

- Live session routes (facilitator control surface, readiness, reveal) and participant views.
- Deactivated-team indication on the topic screen; a deactivated team stays `200`. #265 does not fully solve "stale link" confusion.
- Clearing a remembered or stale team id (picker, last-team memory) after a 404.
- Making the template team `404` (#214 family). `__default_topics__` is a real row and is unchanged.
- Adding the requested id or a second explanatory line to the 404 copy (a "link may be out of date or you lack access" line risks hinting at existence to unauthorized users). The copy is exactly "Team not found.", matching the envelope message including the full stop.
- A retry action on the generic failure state; a new inline notice or any new UI for a failing quiet refetch (see Scope below); a new way-out navigation (the existing "Back to team" link is reused as is).
- What a `TEAM_NOT_FOUND` from a write action (add, remove, restore, reorder, annotation save) shows: existing behaviour is kept and the not-found branch is initial-load only.
- Adequacy of the timing-floor value (the 404 path only has to call the same routine; low-severity residual since the callers are already authorized).
- The mid-request deletion race. No application route deletes a `teams` row (grep of `packages/` finds `DELETE FROM teams` only in test cleanup and the seed-data rollback `4_seed_data.sql`); teams are deactivated via `deactivated_at`. This is an observed property of the code, not a schema constraint, so the race is accepted rather than guaranteed away.
- Any new string comparison on `teamId`. The behaviour for an upper-case form of an existing team's id is deliberately unspecified: it follows Postgres `uuid` comparison (case-insensitive, so most likely `200`) and is not pinned by a test. An upper-case id that matches no team is `404`.
- Changing TOPIC-001 (unknown team stays `403`; a regression test is added).
- No alerting or volume monitoring for 404s exists or is added. An authorized caller can probe team existence by design (accepted in the issue).

## Scope (capped at the keep-list, per Rachel's review)

Beyond the 404 itself, the reorder, the screen message, the `team_found` removal and the contract-row fix, the change carries only:

1. `team-not-found-envelope` spec update naming TOPIC-002 explicitly.
2. Cheap guard tests: participant identical 403 (status, headers and body, with `correlationId` and other per-request values normalized; the two audit rows differ only in `team_id`; zero `teams` queries) for existing vs non-existent team, deactivated team `200`, zero-topics team `200`, template team `200`, TOPIC-001 unknown-team `403` regression.
3. The frontend rule that "Team not found." appears only for an envelope with `error.code === "TEAM_NOT_FOUND"`: a one-line condition, not a feature.
4. The TOPIC-001 vs TOPIC-002 contract sentence (one sentence).
5. A test pinning that a failing quiet refetch (404/403/500) keeps the list and an unsaved edit. The existing `fetchAllTopics` never calls `setError` and each caller already reports its own failure inline, so this needs no new code. **Rejected:** the BA's proposed new inline notice ("Could not refresh the topic list...") and Rachel's cap both point away from new UI. If the test reveals that some path does blank the screen, that path is dropped from this change and filed as a follow-up, not fixed here.

Rejected from the reviews: an upper-case-existing-team scenario (a deliberately unspecified non-goal above); a copy of Priya-pass wording changes beyond the one string.

## Acceptance criteria

1. A standing facilitator or application admin requesting a canonical UUID with no `teams` row gets `404`, body equal to `teamNotFoundEnvelope()` (`error.category: "not_found"`, `error.code: "TEAM_NOT_FOUND"`), `Cache-Control: no-store`, after exactly one `applyTimingFloor` call (spy on `applyTimingFloor` and the reply: called once, before send).
2. Check order is non-canonical `404`, shared authorization `403` (audited), role assertion, team-name read `404`, admin arm. A non-canonical id gets `404` for any actor before any query.
3. The 404 writes no `audit_log` row (row count delta 0), emits no audit event of any kind (no `admin.*`, no `topic.*`), and on the admin path runs no membership-role or role-set query. A standing facilitator on a missing team gets 404 (not 403), and a failed team-name read gives the existing 500 with no audit row for both a facilitator and an admin.
4. The `admin.topic_config_accessed` metadata key set and the event key set equal the exact lists in the spec; neither contains `team_found` / `teamFound`; a test fails if either reappears.
5. A standing facilitator on an existing team executes the same multiset of SQL texts as before this change (baseline from task 0.1 quoted in the PR).
6. Guard `200`s: existing team with zero topics (empty lists, real `teamName`), deactivated team, template team (with one admin row for an admin).
7. A participant gets the same `403 NOT_A_FACILITATOR` for an existing and a non-existent team (identical status and headers; identical body after normalizing `correlationId` and any per-request header such as `date`, with the normalization named in the test), each with one `topic.config_list_denied` row, the two rows equal except `team_id`; neither request, nor a member-facilitator's, queries `teams`; `FACILITATOR_IS_TEAM_MEMBER` for a member-facilitator of an existing team is unchanged.
8. TOPIC-001 for an unknown team still answers `403` (regression test).
9. Initial-load `404` with JSON `error.code === "TEAM_NOT_FOUND"` renders exactly "Team not found." (from a literal constant, not the server message; also for a non-canonical id in the URL) in the existing error state (`role="alert"`, "Back to team" link) with no topic list, definition block, write control or network-error text, and no empty team shell rendered first (a loading indicator is acceptable).
10. Any other non-ok initial load (non-JSON 404, JSON 404 with a different code or a non-object `error`, 500) renders "Failed to load topics."; 403 rendering is unchanged.
11. A failing quiet refetch (404/403/500) after a successful load leaves the list and the open annotation edit text intact and does not show a full-screen error (pinned by test; no new UI).
12. Docs and checks: REST API Contract TOPIC-002 404 row and sentence updated (reading `403 -> 404`), `audit-logger.ts` comment fixed, outcome of the `team_found` consumer grep and the external (SIEM, dashboards) consumer check recorded (tasks 0.2, 4.4), cutover noted in the docs, `team-not-found-envelope-structural.test.ts`, lint, test and build pass, and the delta specs are format-checked by hand (the openspec CLI is unavailable in this environment).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `topic-customization-lock`: TOPIC-002 answers an unknown team `404` (unaudited) instead of an empty `200`; the admin audit row loses `team_found`.
- `team-not-found-envelope`: names TOPIC-002 explicitly.
- `topic-management-screen`: adds the not-found state and pins that a failing quiet refetch keeps content.

## Impact

- Backend: `routes/content.ts` (TOPIC-002 handler), `audit-logger.ts` comment; tests in `content.test.ts`, `topic-002-admin-audit-integration.test.ts`, `topic-annotation-integration.test.ts`, and a TOPIC-001 regression.
- Frontend: `TopicManagementPage` (`loadTopics` only; `fetchAllTopics` gains a test, not code).
- Docs: REST API Contract TOPIC-002 row; the three specs above.
- No migration, no new endpoint, no new query. Pinned audit key-set tests change deliberately.

## Open decisions

1. **MERGE GATE (Brian to confirm): audit asymmetry, the 403 is audited (#264), the 404 is not.** An audit row for a non-existent team records access to nothing, and an authorized caller looping random UUIDs could flood `audit_log`. The issue states no audit on 404 and the write routes already do not audit missing-team 404s. This removes the `team_found: false` coverage that #259 added deliberately, and no volume alert exists for 404s. Correction after security review: the flood argument is weak, because the existing 403 denial path already lets any authenticated caller grow `audit_log` with random UUIDs (a named residual, not fixed here). The stronger grounds are signal quality and consistency with the write routes. The gate also covers a stated accepted risk: after this change an admin's failed probes of non-existent teams leave no trace of any kind (no new log line is added; scope cap). Rachel confirmed (no VP-level objection) and Marcus asks that the PR be blocked on this confirmation. Implementation proceeds meanwhile; the PR body will surface it, and the PR is not to be merged until Brian confirms or overrules. If overruled, only the 404 branch changes.
2. **Residuals for Brian to accept or file:** (a) admin probing nonexistent teams leaves no trace; (b) the existing unbounded 403 denial-row growth (#264 path) needs its own follow-up issue (per-actor rate limit or repeat-denial collapsing).
3. **A non-envelope 404 is never labelled "Team not found."** Proceeding on this basis (the parse rule is JSON body with `error.code === "TEAM_NOT_FOUND"`); Brian to confirm.
4. **Pre-ship:** Priya's quick review of the one string and the reused error state. Not a gate that delays the fix (Rachel).
5. **Stale links (non-blocking):** where do stale links come from (handoff links, emails, notifications)? Becomes a filed follow-up issue covering deactivated-team indication and clearing stale remembered team ids; it does not grow #265. Rachel's question (evidence of real users hitting stale links) is open and non-blocking.
6. **Process note (Rachel):** for a change this size the lightweight pipeline is preferred next time; not redone here.
