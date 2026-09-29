## Context

GitHub issue #117 asks someone to act on two already-made decisions — Decision H (detection query, `openspec/changes/archive/2026-09-16-restrict-team-005-em-promotion/design.md`) and Decision I (historical-annotation companion query) — rather than to re-decide the query shape. That shape was resolved on 2026-09-16 by the Solution Architect (Ingrid Sollenberger), informed by a Full Stack Engineer finding that a DB trigger can't express this because Postgres triggers see row transitions, not which code path originated them, and TEAM-006's own legitimate upsert performs the identical `participant → engineering_manager` row-level transition that TEAM-005 is now blocked from originating.

The constraint that reshapes this work: **no one in this pipeline has production database access**, not even the Solution Architect "in this capacity" (Decision H's own wording). The deliverable is therefore not "run a query and report results" — it's "build the query as a correct, safe, re-runnable artifact and hand it to a named human who can actually run it," closer in spirit to writing a rollback script than shipping a feature.

Schema facts this design depends on, verified against the current migrations and `teams.ts` (not taken on the archived design doc's word — that document's own existence is the result of a prior design doc's claim about behavior not matching shipped code):
- `team_memberships.role` (`membership_role` enum: `participant` | `engineering_manager`) with a partial unique index guaranteeing at most one active row per `(user_id, team_id)` (`migrations/1_create_enums.sql:46-49`, `migrations/7_team_memberships_partial_constraint.sql:32-34`).
- `audit_log` (`migrations/8_audit_log.sql:27-45`) is append-only by inspection: no `UPDATE`/`DELETE` against it exists anywhere in `packages/backend/src/`.
- `team.manager_established` (TEAM-006, `teams.ts:1291-1307`): `target_user_id` = the person becoming EM, `team_id` = the team, `metadata: { is_new_association }`.
- `team.role_changed` (TEAM-005's normal path, `teams.ts:969-985`): `metadata: { from_role, to_role }`.
- `team.role_change_denied` (TEAM-005's post-fix blocked path, `teams.ts:821-847`): metadata-shape-identical to `team.role_changed` (`{ from_role: "participant", to_role: "engineering_manager", http_status: 403 }`) but a different `operation` value — this is the collision the annotation query's `operation` filter must guard against.
- No seed or migration path creates `role = 'engineering_manager'` directly (`migrations/4_seed_data.sql` has no `team_memberships` inserts) — every EM row in any environment went through TEAM-005 (pre- or post-fix) or TEAM-006, so there is no fixture-data population to worry about as a false positive.
- The vulnerable window is 2026-07-06 (TEAM-005 ship, commit `3921578`) through 2026-09-16T20:46:16-04:00 (the fix, commit `2d678a7`, PR #118, confirmed via `git show`). Migration 8's data migration moved every pre-existing `role_change_audit` row into `audit_log` under the same `team.role_changed` operation name before dropping the old table, so one unified `audit_log` query covers the whole window — there is no gap to search across two tables.

**Convention precedent:** `packages/backend/migrations-manual/8_rollback.sql` establishes that this directory exists specifically so `node-pg-migrate` never auto-discovers and runs a one-off ops script (GitHub issue #39 — a rollback script placed in `migrations/` was silently auto-executed on every fresh migrate). Both new scripts follow that same directory placement, numeric-prefix convention, and header-comment style (what it does, how to run it, prerequisites).

## Goals / Non-Goals

**Goals:**
- Ship two source-controlled, reusable, re-runnable SQL scripts implementing Decision H (detection) and Decision I (historical annotation) exactly as specified there, verified against current schema and code rather than re-derived.
- Make the two-step operator workflow — look, then decide to act — a structural property of the file layout, not a convention someone could skip under time pressure.
- Make the annotation script's idempotency a verified property (run twice, second run inserts zero rows), not an inspected-and-assumed one.
- Give the eventual operator (on-call Production Data Engineer) a self-contained artifact: header comments, an environment sanity check, human-readable output, and a named place to record results, so this pipeline doesn't become the help desk for a script that should explain itself.

**Non-Goals:**
- Executing either script against production. No one in this pipeline can — the deliverable is the artifact, not a completed run or a result.
- A remediation or revocation flow for any phantom relationship the detection script finds. Decision H is explicit that this is out of scope; incident response, if needed, happens outside this change.
- A scheduling/cron mechanism. Decision G calls this an on-demand detection control, not continuous automation.
- Re-litigating Decisions A through I of the archived `restrict-team-005-em-promotion` design — those are settled; this change only builds the artifact Decisions G/H/I already specified.

## Decisions

### Decision 1 — Two files, not one, enforcing a structural pause between detect and annotate

The detection query (Decision H/G) and the annotation query (Decision I) are two separate files — `8_phantom_em_detect.sql` and `8_phantom_em_annotate.sql` — each invoked as its own `psql -f` command, rather than one file containing both queries delineated by section-header comments.

**Alternative considered:** a single `.sql` file with both queries under section headers, reusing the archived change's Decision-C-style "deliverable boundary" framing. Rejected: a single file executed via `psql -f` runs top to bottom in one pass — a section-header comment documents the boundary between build and execute but does nothing to enforce a pause between them. The annotation half is a write against an append-only audit table; an operator should see the detection query's result on their screen before choosing, as a second and separate action, to run the write. Two files make that pause structural: the annotation step requires its own explicit, separately-typed invocation. This is the same "the human decides, the software doesn't decide for them" property this project already applies elsewhere (e.g., the no-manager-participation rule), just showing up in an operator's terminal instead of a session UI.

### Decision 2 — Both scripts open with an environment sanity check

Both files' first executable statement is `SELECT current_database() AS database, inet_server_addr() AS host, now() AS checked_at;`, preceded by a `-- STOP:` comment. This catches an operator pointed at the wrong environment (a stale exported `DATABASE_URL`) before either query does anything else — cheap to add, and nothing else in either script would catch this class of mistake.

### Decision 3 — Detection query joins to human-readable identifiers

The detection query joins `team_memberships` through to `users.email` and `teams.name`, rather than returning bare UUIDs. Decision H's deliverable ("checked, N found, here's who was notified") requires knowing who was affected without a follow-up lookup — a UUID-only result would force the operator to run a second query before they could act on the first.

### Decision 4 — Detection query scope: active memberships only, and the `operation` join key

Query shape (Decision G/H):
```sql
SELECT u.email, t.name AS team_name, tm.user_id, tm.team_id, tm.joined_at
FROM team_memberships tm
JOIN users u ON u.id = tm.user_id
JOIN teams t ON t.id = tm.team_id
LEFT JOIN audit_log al ON al.operation = 'team.manager_established'
                       AND al.target_user_id = tm.user_id
                       AND al.team_id = tm.team_id
WHERE tm.role = 'engineering_manager'
  AND tm.removed_at IS NULL
  AND al.id IS NULL
```

**Acceptance condition (stated explicitly, not left as an inference from the `WHERE` clause):** a removed membership row (`removed_at IS NOT NULL`) with no backing audit entry is not flagged, since it grants no current access. This is a refinement on Decision H's literal wording, adopted because a removed row cannot be a live phantom grant.

**Known limitation (inherited from Decision G/H, not this change's to fix):** the join keys purely on `(user_id, team_id)`, so it cannot distinguish "this row's EM status was legitimately established once and never disturbed" from "this row was legitimately established, later demoted, then illegitimately re-promoted" — `team_memberships` has no role-change history, only a mutated-in-place current row. A "0 found" result means no pair-level gap exists today; it does not mean every current EM row's provenance is provably legitimate back through every role transition. This is Decision G/H's query shape verbatim from the archived change; re-deriving or improving it is explicitly out of this change's scope — the detect script's header comment states this limitation plainly (task 2.1) so a future reader doesn't over-read a clean result.

### Decision 5 — Annotation query: explicit `operation` filter, with the reason inline

Query shape (Decision I):
```sql
-- Without this filter, blocked TEAM-005 attempts (operation =
-- 'team.role_change_denied') -- same metadata shape, different operation --
-- get misclassified as completed phantom promotions.
WHERE al.operation = 'team.role_changed'
  AND al.metadata->>'from_role' = 'participant'
  AND al.metadata->>'to_role' = 'engineering_manager'
  AND al.timestamp < '2026-09-16T20:46:16-04:00'
```

This predicate and its inline comment are load-bearing, not stylistic: TEAM-005's post-fix blocked path (`teams.ts:821-847`) writes `team.role_change_denied` rows with an identical `metadata` shape. Omitting the `operation` filter — e.g. in a future "simplification" of the `WHERE` clause — would silently pull in every blocked promotion attempt after 2026-09-16 and annotate them as completed historical promotions, manufacturing phantom annotations on the exact table this change exists to make trustworthy. The comment exists so a future editor runs into the reason before they run into the bug.

**Acceptance condition:** Query 1's and Query 2's result counts are not expected to match, and a mismatch is not a bug. A user can be phantom-promoted via the closed bypass (appears in Query 2's historical record) and later demoted before today (their live `team_memberships` row is `participant`, so Query 1 correctly does not flag them). Decision I still wants the historical row annotated regardless of current membership state. Both scripts must run regardless of what the other finds.

### Decision 6 — Idempotency guard and unambiguous re-run confirmation

The annotation `INSERT` is guarded by `WHERE NOT EXISTS` against an annotation row already referencing the same original `audit_log.id`:
```sql
INSERT INTO audit_log (actor_user_id, actor_global_role, operation, target_user_id, team_id, metadata)
SELECT
  :'operator_user_id'::uuid, 'system:production_data_engineer',
  'team.manager_established_retroactive_annotation',
  al.target_user_id, al.team_id,
  jsonb_build_object(
    'annotated_audit_log_id', al.id,
    'annotated_timestamp', al.timestamp,
    'note', 'This team.role_changed event is now understood to represent an ' ||
            'EM-establishment event predating the restrict-team-005-em-promotion fix (#109).'
  )
FROM audit_log al
WHERE al.operation = 'team.role_changed'
  AND al.metadata->>'from_role' = 'participant'
  AND al.metadata->>'to_role' = 'engineering_manager'
  AND al.timestamp < '2026-09-16T20:46:16-04:00'
  AND NOT EXISTS (
    SELECT 1 FROM audit_log ann
    WHERE ann.operation = 'team.manager_established_retroactive_annotation'
      AND ann.metadata->>'annotated_audit_log_id' = al.id::text
  );
```
(`:'operator_user_id'` uses psql's quoted-literal substitution form, per Decision 8 — see there for the mandatory-parameter guard and invocation string. `actor_global_role` is hardcoded as the literal `'system:production_data_engineer'` directly in the `INSERT` rather than substituted — corrected here, and in Decision 8 point 4's invocation string below, by a security implementation-review fast-follow, 2026-09-29: an operator-supplied `-v` parameter for a value Decision 8 itself calls "fixed" left room for a mistyped or stale invocation to write a different value into this audit column, which a hardcoded literal closes structurally rather than by operator discipline. The bare, unquoted `:operator_user_id` form that appeared in an earlier draft of this query also does not work as SQL and has likewise been corrected here.)

The `INSERT ... SELECT` is wrapped to report a labeled count rather than relying on `psql`'s default `INSERT 0 0` line, which looks identical whether it means "already done" or "silently matched nothing":
```sql
WITH inserted AS ( <the INSERT above> RETURNING id )
SELECT count(*) AS new_annotations_inserted FROM inserted;
```

**Why no partial-write handling is needed:** this is a single `INSERT ... SELECT` statement, not a per-row loop — Postgres executes it atomically regardless of explicit transaction wrapping. A failure mid-statement aborts the entire statement; there is no state where some matching rows got annotated and others didn't. Combined with the `NOT EXISTS` guard, the operator's response to any failure is the same either way: re-run the script.

**Verification method (acceptance condition, not left implicit):** before this script is handed to the Production Data Engineer, it must be run twice in sequence against a non-production copy of the schema or fixture data reproducing the phantom-relationship shape, confirming the second run inserts zero rows. "The `WHERE NOT EXISTS` clause looks right on inspection" is not the bar. Query 1 needs no equivalent test — it is a `SELECT` and re-run safety is trivial — stated here so no one builds guard logic around it by mistaken analogy with Query 2.

### Decision 7 — Result-recording template

`openspec/changes/phantom-em-relationship-detection/query-result.md` is a template file (not a dashboard, per Decision H's own "a short written record" framing) with fields for: run date, environment confirmed, operator, Query 1 row count and rows if non-zero, Query 2 row count, and notification recipient/channel if Query 1 found anything. Named explicitly so the Production Data Engineer doesn't have to invent a format under time pressure — the same failure mode that let this whole deadline slip once already. The template also carries Decision 9's fixed notification sentence verbatim, so the operator has it in hand rather than having to find and re-read this document under time pressure.

### Decision 8 — Actor identity for script-generated audit rows

`actor_user_id` = the operator's own `users.id` (their real application account), supplied as a mandatory `psql` variable with no default: `-v operator_user_id=<uuid>`. `actor_global_role` = the fixed literal `'system:production_data_engineer'`, hardcoded directly in the `INSERT` rather than supplied as a parameter (security implementation-review fast-follow, 2026-09-29 — see the note under Decision 6).

Both scripts (detect needs no parameters and is unaffected; annotate is the one that writes) enforce this mechanically rather than by convention:

**1. Existence guard, before any other statement runs**, so a missing parameter produces a clear refusal instead of a confusing syntax error or a silently-empty substitution:
```sql
\if :{?operator_user_id}
\else
  \echo ERROR: operator_user_id is required. Invoke with -v operator_user_id=<uuid>.
  \quit
\endif
```

**2. Quoted-literal substitution for the one remaining parameter**, never the bare form: `:'operator_user_id'::uuid`, not `:operator_user_id`. Bare `:name` substitutes raw, unquoted text — for a UUID literal that either errors outright or behaves in a way that's harder to reason about than a quoted literal Postgres then casts. `actor_global_role` is no longer a parameter at all (see the Decision 6 note) — it is hardcoded as a literal directly in the `INSERT`, which removes the substitution-form question for that value entirely. (This corrects Decision 6's `INSERT` as originally drafted, which used the bare form for both values — see the note there.)

**3. An identity-echo sanity check, after the environment check (Decision 2) and before the `INSERT`**, so a typo'd or stale-but-well-formed UUID is caught visibly rather than inserted silently — `audit_log.actor_user_id` is deliberately not a foreign key (records must stay stable even if the referenced user is later deactivated), so Postgres will not catch a wrong-but-valid UUID on its own:
```sql
-- STOP: confirm this is you before proceeding. If no row comes back,
-- :operator_user_id is wrong -- stop and fix it before running the INSERT below.
SELECT id, email FROM users WHERE id = :'operator_user_id';
```

**4. The exact, copy-pasteable invocation in the annotate script's header comment** — the header transcribes this, it does not require the operator or a future editor to derive it:
```
dotenv -e ../../.env -- psql "$DATABASE_URL" \
  -v operator_user_id='<your users.id UUID>' \
  -v ON_ERROR_STOP=1 \
  -f migrations-manual/8_phantom_em_annotate.sql
```
(`actor_global_role` is not an invocation parameter — see the note above; it is hardcoded in the script itself.)

**Statement order in the annotate script** (a judgment call, since neither review specified ordering): `\if` existence guard → environment sanity check (Decision 2) → identity-echo check → guarded `INSERT` (Decision 6). Fail fast on the cheapest check first; confirm environment before confirming identity, consistent with Decision 2 already being the first executable statement in both scripts.

**Rationale:** A sentinel/system UUID answers "was this the app or a script," not "which human" — for a change whose purpose is audit-trail integrity, "which human" is the point. A control that's silently optional is a control that's silently absent under time pressure, which is the same failure category this change lineage exists to close, one level removed: a script-generated audit row with no real operator identity behind it is no better for incident reconstruction than the phantom rows this change exists to find.

**Alternative considered:** a fixed sentinel/system-user UUID. Rejected for the reason above — it erases the "which human" information this decision exists to preserve, and `actor_user_id` is `NOT NULL` by schema regardless, so a sentinel buys no simplicity a mandatory real parameter doesn't already provide.

**Decided by:** Ingrid Sollenberger (Solution Architect), 2026-09-29 — adopting the mandatory-parameter-plus-quoted-literal resolution both the Full Stack Engineer (Marcus Oyelaran) and Security (Tomás Ferreira) design reviews converged on independently, plus the Security review's identity-echo addition.

### Decision 9 — Notification recipient and channel if phantom relationships are found

If Query 1 (detection) finds any phantom relationships, the operator notifies **Rachel Okonkwo, VP of Engineering** — the Executive Stakeholder for this change and for the archived `restrict-team-005-em-promotion` change — directly, by email or an equivalent out-of-band human channel, sent by hand. No automated transport is built for this.

The sentence to send is fixed, not phrased fresh by the operator under time pressure, and it is carried into the artifacts the operator actually uses — `query-result.md` (Decision 7) and the annotate script's header — not left as a design-doc-only boundary:

> Query 1 flagged N phantom EM relationship(s) in `<environment>` as of `<timestamp>`. This is a notification, not a request for action — no remediation has been taken and none is authorized by this message.

**Rationale:** Decision H's original deliverable shape ("checked, N found, here's who was notified") was Rachel's own ask as Executive Stakeholder on the archived change — she is the correct default recipient because this is her open item to close, not a new party being pulled in. No Slack/PagerDuty/email transport exists anywhere in this codebase to automate this (`emitAuditEvent`'s structured-log transport is an operational log stream, not a human notification channel, and is correctly untouched here); building one for a detection control this change's own Non-Goals call on-demand, not continuous, would be scope creep against Decision H's "no remediation program" boundary. A manual, human-sent notification is actually more consistent with "escalation, not remediation" than new alerting infrastructure would be. Fixing the literal sentence and placing it in the artifact the operator uses in the moment — not only in this document — guards against the same failure mode that let the original 2026-09-23 deadline slip silently: a boundary that's correct on paper and undocumented at the point someone actually acts.

**Decided by:** Ingrid Sollenberger (Solution Architect), 2026-09-29 — adopting the resolution proposed by the Security design review (Tomás Ferreira).

## Risks / Trade-offs

- **[Risk]** The 2026-09-16T20:46:16-04:00 cutoff is *merge* time, not confirmed *deploy* time. If deploy lagged merge, a handful of legitimate post-merge-pre-deploy promotions via the not-yet-live fix could theoretically exist in the boundary window and get incorrectly annotated as pre-fix phantom promotions. → **Mitigation:** this boundary is almost certainly empty in practice (merge-to-deploy lag on this scale of change is typically minutes to hours, not enough to produce a real promotion in that window), and the comment in the annotate script states this assumption explicitly rather than silently. Not worth a deploy-timestamp lookup for a boundary this unlikely to be non-empty — flagged rather than engineered around.
- **[Risk]** A script-generated `audit_log` row has no natural application actor. Left unresolved by design, whoever writes the actual `psql` invocation could default to something silently wrong (a placeholder UUID, a vague role string) — repeating, one level removed, the exact "quietly not meaning what it claims to mean" failure category this whole change lineage exists to close. → **Mitigation:** resolved by Decision 8 (mandatory real operator `users.id`, quoted-literal substitution, identity-echo check).
- **[Trade-off]** This change ships no execution and no result. The named deadline (2026-09-23) has already passed with nothing built; shipping the artifact now does not itself close Decision H/I — a human still has to run it. → **Mitigation:** Migration Plan below sets a new, explicit execution deadline, naming the gap in tasks.md rather than assuming merge equals completion (the same assumption that let the first deadline slip silently).
- **[Risk]** "Who gets notified if phantom relationships are found" is undefined. An unscoped answer risks quietly expanding into remediation work this change explicitly excludes. → **Mitigation:** resolved by Decision 9 (Rachel Okonkwo, direct human channel, fixed escalation-not-remediation sentence).

## Migration Plan

There is no database migration in this change — deliberately: these scripts are excluded from `node-pg-migrate` discovery by directory placement (`migrations-manual/`, not `migrations/`), the same convention `8_rollback.sql` already established for exactly this reason (GitHub issue #39).

Deployment steps:
1. Merge this change, landing both scripts and the `query-result.md` template.
2. Hand the scripts to the on-call Production Data Engineer (Decision H's named owner).
3. The Production Data Engineer runs `8_phantom_em_detect.sql` first, reviews its output, then separately runs `8_phantom_em_annotate.sql`, and records both results in `query-result.md`.
4. If Query 1 finds phantom relationships, Rachel Okonkwo (Decision 9) is notified with the fixed sentence in Decision 9/`query-result.md` — escalation only, not authorization to remediate.

**New execution deadline:** tasks.md should set this explicitly (e.g., "N business days after this change merges") rather than leaving execution to happen "eventually" — the exact gap that let the original 2026-09-23 deadline pass silently once already.

**Rollback:** not applicable in the schema-migration sense — there is no schema change. If `8_phantom_em_annotate.sql` is ever found to have a defect after being run, the append-only invariant means the fix is a new, corrective annotation row referencing the erroneous one, never an edit or delete of what was already written.

## Open Questions

None remain. Both questions carried forward from exploration-notes.md §5 and §6 / proposal.md — what populates `audit_log.actor_user_id`/`actor_global_role` for a script-generated row, and who is notified if phantom relationships are found — are resolved above as Decision 8 and Decision 9 respectively, each by the Solution Architect at design review, following the same pattern the archived `restrict-team-005-em-promotion` design.md used for its own then-open questions (Decisions B, E, F, G, H, I).
