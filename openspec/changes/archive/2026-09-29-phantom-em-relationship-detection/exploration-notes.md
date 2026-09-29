# Exploration Notes — GitHub Issue #117: Phantom EM Relationship Backfill/Detection Query

**Explored by:** Devon Calloway (Internal Champion / Principal Software Engineer)
**Date:** 2026-09-29 (revised same day to incorporate `explore-review-facilitator.md` and `explore-review-ba.md`)
**Status of the thing this is about:** the owning decision's deadline (2026-09-23) is **six days past due**. Nothing has been built yet. That's the first fact, not the last one.

**Revision note:** Priya Nair (Facilitator) and Marcus Delgado (BA) both reviewed the first pass of these notes. Their feedback is incorporated directly where it sharpens the artifact without requiring a new decision-maker (operator workflow structure, environment sanity check, human-readable output, explicit acceptance conditions). Two items are genuinely not mine to decide and are flagged forward as named open decisions for propose/design rather than resolved here — see §5 and §6. A disposition summary is at §9.

---

## 1. What #117 is actually asking for

Reading the issue text straight: it names two already-made decisions (design.md Decisions H and I, archived `2026-09-16-restrict-team-005-em-promotion`) and asks someone to act on them. It is *not* asking anyone to re-decide the query shape — that was resolved on 2026-09-16 by the Solution Architect, informed by a Full Stack Engineer finding about why a DB trigger doesn't work here. My job in this exploration is narrower than "design a detection system": it's to verify the prior decisions still hold against the real schema and code (they might not — design docs describe intent, not always shipped reality, and this whole change exists *because* a design doc's claim about behavior didn't match the code once), and to figure out what the actual deliverable looks like given the constraint that **nobody in this pipeline, and not even the Solution Architect "in this capacity," has production DB access.**

That last constraint reshapes the task. This is not "run a query and report results." It's "build the query as a correct, safe, re-runnable artifact and hand it to a named human who can actually run it" — closer to writing a rollback script than writing a feature.

## 2. Verifying Decision G/H/I's claims against the real schema — nothing here is inherited on faith

I read the archived design.md's Decisions G/H/I rather than trusting the summary, then checked every factual claim in it against the current migrations and `teams.ts`. This project's whole reason for existing is a case where a design doc's confident description of behavior ("the comment block asserts the dual-check is what happens") didn't match the code. I'm not doing that again on the way *out* of that change.

**`team_memberships`** (`packages/backend/migrations/2_create_tables.sql:26-35`):
```sql
CREATE TABLE team_memberships (
    id, team_id, user_id,
    role membership_role NOT NULL DEFAULT 'participant',
    joined_at, removed_at, removed_by_user_id
);
```
`membership_role` (`migrations/1_create_enums.sql:46-49`) has exactly two values: `participant`, `engineering_manager`. No third state to worry about. A partial unique index (`migrations/7_...:32-34`) guarantees at most one active (`removed_at IS NULL`) row per `(user_id, team_id)`.

**`audit_log`** (`migrations/8_audit_log.sql:27-45`):
```sql
CREATE TABLE audit_log (
    id, actor_user_id UUID NOT NULL, actor_global_role TEXT NOT NULL,
    actor_ip INET,                    -- nullable
    operation TEXT NOT NULL,
    target_user_id UUID, team_id UUID,  -- both nullable
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB
);
```
Confirmed append-only by inspection, not just by the design doc's assertion: there is no UPDATE or DELETE against `audit_log` anywhere in `packages/backend/src/`. Grepped for it. The only thing that ever touches existing rows is the *migration* that created the table (`8_audit_log.sql`'s one-time `role_change_audit` → `audit_log` data migration, itself an INSERT, not an update). Decision I's "append-only by design" claim holds.

**`team.manager_established`** write shape (`teams.ts:1282-1296`, TEAM-006):
```sql
INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation,
                        target_user_id, team_id, metadata)
VALUES (..., 'team.manager_established', engineeringManagerUserId, teamId,
        '{"is_new_association": <bool>}')
```
`target_user_id` = the person *becoming* EM, `team_id` = the team. This is the exact `(user_id, team_id)` pair Decision G's detection query needs to match against `team_memberships.user_id`/`team_id`. Confirmed the join key exists and means what design.md assumes it means.

**`team.role_changed`** write shape (`teams.ts:958-974`, TEAM-005 — the normal, non-blocked path):
```sql
INSERT INTO audit_log (..., operation, target_user_id, team_id, metadata)
VALUES (..., 'team.role_changed', subjectUserId, teamId,
        '{"from_role": <role>, "to_role": <role>}')
```

**Important thing I caught that the design doc doesn't spell out explicitly enough to be safe against a sloppy implementation:** TEAM-005's *blocked* path (the new code from the #109 fix itself, `teams.ts:827-845`) writes a **different but metadata-shape-identical** row:
```sql
operation = 'team.role_change_denied'
metadata = '{"from_role": "participant", "to_role": "engineering_manager", "http_status": 403}'
```
A query for Decision I's historical-mislabeling companion that filters on `metadata->>'from_role' = 'participant' AND metadata->>'to_role' = 'engineering_manager'` **without also filtering `operation = 'team.role_changed'`** will silently pull in every *blocked* promotion attempt from after 2026-09-16 and misclassify them as historical mislabeled promotions that need annotating — i.e., manufacture phantom annotations for promotions that never actually happened, on a table whose entire point is being trustworthy. This is exactly the kind of thing I care most about: an audit-integrity fix that introduces a *new* audit-integrity bug because the two operations happen to share a metadata shape. The `operation` filter has to be explicit and load-bearing in the query, not implied.

Priya's review flagged this as exactly the category of risk that has to survive past exploration prose into the shipped artifact itself, not just into this document. Agreed without qualification: the `operation = 'team.role_changed'` predicate in the actual script must carry an inline SQL comment stating *why* it's there ("without this filter, blocked TEAM-005 attempts — same metadata shape, different operation — get misclassified as completed phantom promotions"), so a future editor who goes looking to "simplify" the WHERE clause runs into the reason before they run into the bug.

**Ship-date cutoff for "predating this change's ship date" (Decision I):** the #109 fix (this whole change) merged as PR #118, commit `2d678a7`, **2026-09-16T20:46:16-04:00**. That's the concrete cutoff Decision I's historical query needs — I pulled it from git rather than approximating "around 2026-09-16." Worth a caveat in the eventual script header: this is *merge* time, not confirmed production *deploy* time; if deploy lagged merge, a handful of legitimate post-merge-pre-deploy promotions via the not-yet-live fix could theoretically exist in the boundary window. Given this is a data-engineer-run one-off, a comment flagging the assumption is enough — not worth over-engineering a deploy-timestamp lookup for a boundary that's probably empty anyway.

**No seed-data or migration path creates `role = 'engineering_manager'` directly** (checked `4_seed_data.sql` — no `team_memberships` inserts at all). Every EM row in any environment either went through TEAM-005 (pre- or post-fix) or TEAM-006. Good — it means Decision H's detection query has no "legitimate but audit-log-silent" population to accidentally flag as a false positive from fixture/seed data.

**Timeline sanity check on the vulnerable window:** TEAM-005 shipped 2026-07-06 (`3921578`), one day *before* `audit_log` existed (migration 8, 2026-07-07) and TEAM-006 shipped the same day audit_log did (`9536d32`, 2026-07-07T12:46). So the phantom-relationship window is real and bounded: **2026-07-06 through 2026-09-16T20:46**, roughly ten weeks. Pre-migration-8 TEAM-005 writes went to `role_change_audit`, but migration 8's data migration (`8_audit_log.sql:64-96`) moved every row into `audit_log` under the same `team.role_changed` operation name before dropping the old table — so there's no gap in the audit trail to search across two tables. One unified `audit_log` query covers the whole window.

## 3. The two queries are not one query — and they answer different questions

Decision H's detection query and Decision I's "companion" query look related but scan different populations and answer different questions. Worth being explicit about this before anyone writes code, because conflating them would silently narrow the search.

Priya's review pushed on something I'd under-specified: "not one query" needs to mean not one *operator action*, not just not one SELECT/INSERT. If both queries live in a single script that runs straight through on one invocation, the operator commits an audit-log write before they've had any chance to look at what the detection query found — that's a real safety gap for a script whose second half writes to an append-only table, and it's a five-minute fix. So the deliverable is **two separate files, run as two separate, deliberately-invoked commands** — not one file with two SELECT/INSERT blocks back to back, and not two logically-separate queries that happen to share an invocation:

- `packages/backend/migrations-manual/8_phantom_em_detect.sql` — Query 1 only. Read-only. Safe to run any number of times, any time, by anyone with read access.
- `packages/backend/migrations-manual/8_phantom_em_annotate.sql` — Query 2 only. Guarded INSERT (§4). Run *after* reading Query 1's output, as a second, separate command.

I'm diverging here from one specific suggestion in the BA's review — he floated a single `.sql` file with both queries delineated by section-header comments, reusing the deliverable-boundary framing from Decision C. That framing is right for *documenting* the boundary between build and execute; it's the wrong shape for *enforcing* the pause between look and act. A single file executed via `psql -f` runs top to bottom in one pass — nothing about section-header comments stops that. Two files means the annotation step requires its own explicit `psql -f 8_phantom_em_annotate.sql` invocation, typed after the operator has already seen Query 1's result on their screen. That's the structural version of "the facilitator calls it, not the software" applied to a lone operator at a prompt — the same property Devon's own persona cares about elsewhere in this project, just showing up in a script instead of a session. Everything else about the BA's file-naming suggestion (numeric prefix matching the `migrations-manual/` convention already confirmed via `8_rollback.sql`, a header comment naming exactly what each file does and how to run it, referencing Decision H/G and Decision I respectively) is adopted as-is, just split across two files instead of one.

**Both files' first executable statement, before touching any other table, is an environment sanity check** — printing the current database name and host so the operator can eyeball-confirm they're pointed at the intended environment before either query runs, rather than trusting a `DATABASE_URL` they exported earlier in the day:

```sql
-- STOP: confirm this is the environment you intend to query/write against.
SELECT current_database() AS database, inet_server_addr() AS host, now() AS checked_at;
```

This is a direct incorporation of Priya's Question 1. Cheap to add, and the asymmetry she named is real: nothing else in either script would catch a wrong-environment run before it did its damage.

```
Query 1 (Decision H) — CURRENT-STATE detection  [8_phantom_em_detect.sql]
  "Which team_memberships rows, right now, say engineering_manager
   with no team.manager_established audit entry backing them up?"

  SELECT u.email, t.name AS team_name, tm.user_id, tm.team_id, tm.joined_at
  FROM team_memberships tm
  JOIN users u ON u.id = tm.user_id
  JOIN teams t ON t.id = tm.team_id
  LEFT JOIN audit_log al ON al.operation = 'team.manager_established'
                         AND al.target_user_id = tm.user_id
                         AND al.team_id = tm.team_id
  WHERE tm.role = 'engineering_manager'
    AND tm.removed_at IS NULL          -- see acceptance condition below
    AND al.id IS NULL

  → answers: "is anyone WRONGLY an EM right now via the closed bypass?"
  → this is what Decision H's "checked, nothing found / N found" deliverable is about
  → this is the ongoing detection control (Decision G) — re-run anytime, read-only,
    naturally idempotent (it's a SELECT)

Query 2 (Decision I) — HISTORICAL audit-log annotation  [8_phantom_em_annotate.sql]
  "Which audit_log rows, ever, record a participant→EM promotion that
   happened via the old TEAM-005 bypass before the fix shipped?"

  audit_log
    WHERE operation = 'team.role_changed'      <- MUST be explicit (see §2)
      AND metadata->>'from_role' = 'participant'
      AND metadata->>'to_role' = 'engineering_manager'
      AND timestamp < '2026-09-16T20:46:16-04:00'

  → answers: "which past events need the retroactive annotation?"
  → INSERT one team.manager_established_retroactive_annotation row per match
  → NOT naturally idempotent (see §4) — this is the one that needs care
```

Query 1 now joins through to `users.email` and `teams.name` rather than returning bare UUIDs — direct incorporation of Priya's Question 2. Decision H's deliverable includes "who was notified," and notifying someone requires knowing who they are without a follow-up lookup.

**Acceptance conditions, stated explicitly rather than left as inferences from the SQL** (per the BA's review — these are the two places where a reader diffing the shipped script against the archived decision text could otherwise mistake a deliberate refinement for scope drift or a bug):

- *Query 1 considers only active memberships (`removed_at IS NULL`). A removed membership row with no backing audit entry is not flagged, since it grants no current access.* This is a refinement on Decision H's literal wording (which doesn't mention `removed_at`), and it's the correct one — but it needs to be stated as a decided condition, not discovered by inspection.
- *Query 1's and Query 2's result counts are not expected to match, and a mismatch between them is not a bug.* A user can be phantom-promoted via the closed bypass (→ shows in Query 2, the historical record) and later demoted before today (→ their `team_memberships` row is `participant` now, so Query 1 correctly does not flag them — there's no live phantom grant to detect). Decision I still wants that historical row annotated regardless of current membership state; it's correcting the historical record, not just the rows with live consequences. Both queries must run regardless of what the other finds — Query 2's population is not a subset of Query 1's.

## 4. Idempotency — the risk I'd actually block on

Query 1 is a SELECT. Run it a hundred times, nothing changes. Fine.

Query 2 is an INSERT. Decision H/I's owner is a human running a manual script against production, quite possibly more than once — to double check the count, because the first run's terminal output scrolled off, because they want to re-verify before writing the "checked, N found" report. **If the INSERT isn't guarded, every re-run duplicates every annotation.** That's not a cosmetic problem: it directly undermines the exact property Decision I was written to protect ("an incident responder needs to trust that a row... is what was actually written then"). A duplicate annotation for the same original row is a second kind of audit-log noise this change would be introducing while fixing the first kind.

The guard is straightforward given the schema — the annotation's own metadata should carry a reference to the original row's `id`, and the INSERT should be a `WHERE NOT EXISTS` against that reference, keyed on the *annotation* operation name plus the referenced id, e.g. (sketch, not final — this is exploration, not the shipped script):

```sql
INSERT INTO audit_log (actor_user_id, actor_global_role, operation, target_user_id, team_id, metadata)
SELECT
  :operator_user_id, 'system:production_data_engineer',
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

Re-running this after a successful first pass inserts zero rows. That's the property that matters — not the exact SQL, which belongs to whoever writes the actual script at apply time.

**Acceptance condition (verification method stated explicitly, per the BA's review):** running `8_phantom_em_annotate.sql` twice in sequence against the same data must produce zero additional rows on the second run. This must be verified against a non-production copy of the schema, or fixture data reproducing the phantom-relationship shape, before the script is handed to the Production Data Engineer — "the WHERE NOT EXISTS clause looks right on inspection" is not the bar; "someone ran it twice and watched the second run insert nothing" is. Nobody in this pipeline has production access, so this verification happens against a substitute environment, the same way Decision C named its own verification method explicitly rather than leaving it implicit. Query 1's re-run safety, by contrast, is trivial (it's a SELECT) and needs no equivalent test — worth saying plainly so no one builds guard logic around it by mistaken analogy with Query 2.

**The confirmation the operator sees on a re-run has to be unambiguous, not a bare tally** — this is Priya's Suggested Addition, and it's a real distinction: `psql`'s default `INSERT 0 0` line looks identical whether it means "confirmed already done" or "something silently didn't match." The script should report a labeled count instead of relying on that default line, e.g.:

```sql
WITH inserted AS (
  INSERT INTO audit_log (...)
  SELECT ...
  FROM audit_log al
  WHERE ...
  AND NOT EXISTS (...)
  RETURNING id
)
SELECT count(*) AS new_annotations_inserted FROM inserted;
```

A labeled `new_annotations_inserted | 0` result reads unambiguously as "already up to date." A labeled `new_annotations_inserted | 3` reads unambiguously as "did something." Neither looks like silent failure, which a bare `INSERT 0 0` can.

**On Priya's Question 4 (partial-write risk if the INSERT fails partway through):** it doesn't apply here in the way the question is framed, and it's worth stating why rather than leaving that unaddressed. Query 2 is a single `INSERT ... SELECT` statement, not a loop issuing one INSERT per matching row — Postgres executes a single statement atomically regardless of explicit transaction wrapping. A failure mid-statement (a constraint violation, a killed connection, a statement timeout) aborts the entire statement; there is no state where 3 of 5 matching rows got annotated and 2 didn't. Combined with the idempotency guard, the operator's action on any failure is the same either way: re-run the script. No investigation branch is needed for "did this half-finish," because it structurally can't.

## 5. The `actor_user_id` / `actor_global_role` problem — a real open question, not a detail

`audit_log.actor_user_id` is `UUID NOT NULL`. For every existing write, that's a logged-in application user acting through the API. This script has no request, no session, no application actor — it's a human with a `psql` prompt. Two live questions I don't think should be silently resolved by whoever writes the script:

1. **Whose `user_id` goes in `actor_user_id`?** The Production Data Engineer's own `users.id`, if they have an application account? A sentinel/system UUID? The schema comment (`8_audit_log.sql:29-30`) explicitly says these fields are "not FKs, so records remain stable" — meaning nothing *stops* a non-existent UUID from being inserted, but that's exactly the kind of silent laxity that let the original #109 bug ship (a code path technically working while quietly not meaning what it claims to mean). I'd want a real UUID that traces to a real, identifiable operator — the equivalent of a signature, not a placeholder.
2. **What goes in `actor_global_role`?** It's `TEXT`, not the `user_role` enum, so it's not constrained to `'engineer' | 'senior_engineer' | ...` — free text is allowed. I'd lean toward something self-describing like `'system:production_data_engineer'` specifically *because* it's visibly distinguishable from every other actor_global_role value the table has ever held, so a future auditor scanning `audit_log` for anomalies sees at a glance that this row came from an out-of-band manual process, not the application. That's a design opinion worth carrying into the proposal stage, not something to leave as an implicit default.

This wants a named decision at propose/design time — it's small in code size but not small in what it says about the record.

**Flagged forward as an explicit open decision (Decision J, owner: Solution Architect, same pattern as Decisions A through I) — not resolved here.** The BA's review is right that naming this as open isn't the same as making it buildable, and right that it isn't mine to decide unilaterally. What I can do in exploration is hand propose/design a decision they can resolve without re-deriving the problem, including the shape one reviewer has already argued for so it doesn't get lost:

- **`actor_user_id`:** a candidate resolution, carried forward for the Solution Architect to confirm or override — require the operator's own `users.id` (their real application account), captured as a mandatory script parameter with no default. Not a sentinel/system UUID: a sentinel answers "was this the app or a script," not "which human," and for a fix whose entire purpose is audit-trail integrity, "which human" is the point. The acceptance condition this implies: the script must fail, or refuse to run, if this parameter isn't supplied — no silent fallback.
- **`actor_global_role`:** a candidate resolution, likewise carried forward for confirmation — a fixed literal constant decided once at design time, e.g. `'system:production_data_engineer'`, distinguishable at a glance from every other value this column has ever held. Not "something self-describing, implementer's choice" — one string, decided once, documented in the design doc as the source of truth.
- Whichever exact values the Solution Architect confirms, they must land in each script's header as a literal, copy-pasteable instruction — the actual UUID-finding steps or the actual constant string — not a description the operator has to interpret. First run, no side conversation required.

I'm naming a candidate shape rather than leaving this as an empty placeholder, because an unshaped "TBD" is exactly the kind of open item that turns into a Slack message to me later — but the decision itself, and the authority to fix the literal value, belongs to whoever holds the Solution Architect role at propose/design time, not to exploration.

## 6. What the deliverable actually is (and isn't)

Given no one in this pipeline has production access:

**Is:**
- Two reusable, re-runnable SQL scripts, source-controlled at `packages/backend/migrations-manual/` (confirmed convention via `8_rollback.sql`'s header: this directory exists specifically so `node-pg-migrate` never auto-discovers and runs one-off ops scripts — verified against `db:migrate`'s node-pg-migrate behavior via that file's own header, which cites GitHub issue #39 for why this matters):
  - `8_phantom_em_detect.sql` — Query 1 / Decision H / Decision G, read-only.
  - `8_phantom_em_annotate.sql` — Query 2 / Decision I, idempotency-guarded INSERT.
  Named as two files rather than one, structurally, so the annotation step is never an accidental consequence of running the detection step (§3) — this is a direct incorporation of the Facilitator's review, and a deliberate divergence from the BA's single-file suggestion for the reason given in §3. Same header-comment convention for both: how to run it, prerequisites, exactly what it does and doesn't do, plus the environment sanity check as each file's first statement (§3).
- **Acceptance criterion (verification method: code review, not a runtime test) for the build/execute boundary**, reusing Decision C's own "does this exist" pattern per the BA's review: neither script contains an UPDATE or DELETE statement against `team_memberships`, and neither script contains a code path that revokes, modifies, or notifies automatically. This is a checkable statement, not a description to take on faith.
- A named place to record the result, so it survives a handoff between whoever runs the scripts and whoever needs to know what they found — this was unnamed in the prior pass of these notes, and both reviewers independently flagged that gap. Recommendation: a template file in this change's directory, `openspec/changes/phantom-em-relationship-detection/query-result.md`, with fields for: run date, environment confirmed (from the sanity check), operator, Query 1 row count (and the human-readable rows themselves if non-zero), Query 2 row count, and notification recipient/channel if Query 1 found anything (see below). "A short written record, not a dashboard" (Decision H's own phrasing) still needs a filename and a field list, or the Production Data Engineer invents a format under time pressure — exactly the outcome this pipeline exists to prevent.
- Explicit output the on-call Production Data Engineer can act on without needing this pipeline to explain anything further (this is my own standing concern — I don't want to become the help desk for a script that should be self-explanatory).

**Is not:**
- An executed result. Nobody here can run it against production. The deliverable is the loaded gun on the table, not the fired shot.
- A remediation/revocation flow. Decision H is explicit: "no remediation program is scoped here beyond" the checked/found record. If Query 1 finds phantom relationships, what happens to them is incident response, out of this change's scope, per the archived design doc's own boundary.
- A retry/scheduling mechanism. Decision G calls this a detection control meant to be re-run "on-demand," not a cron job — nothing here suggests building automation to run it continuously. That would be new scope no one asked for.

**Flagged forward as an explicit open decision (owner: Solution Architect or Executive Stakeholder — not mine to assign unilaterally) — "who was notified" is presently undefined, and that's a real gap, not a stylistic one.** Decision H's deliverable shape, quoted from the Executive Stakeholder, is "checked, nothing found" or "checked, N found, here's who was notified." Nothing in Decision H, Decision I, or the prior pass of this exploration names who gets notified, by what channel, or whether notifying is itself in scope here versus something the Production Data Engineer improvises. The BA's review is right to flag this as the one plausible crack for scope creep in a change that is otherwise careful, everywhere else, about the remediation boundary: an unscoped "I found it, so I told someone, who asked me to also fix it" is exactly the kind of one-bad-afternoon drift Decision H's own "no remediation program" line is trying to prevent. This needs, at propose/design time:
- A named recipient or channel (the BA's own lean — whoever holds the Executive Stakeholder role for this change, since they're the one who asked for this deliverable shape — is a reasonable default to confirm, not to assume).
- An explicit sentence carried into the proposal: notification is escalation, not remediation, and does not itself authorize the operator to revoke or modify the flagged row. I'm not naming the recipient myself; I'm naming the fact that a recipient must be named, and the boundary that whatever notification happens must respect, before this ships.

## 7. The overdue deadline — naming it rather than quietly absorbing it

Worth citing the lineage explicitly, per Priya's own review of these notes: this isn't the first time the phantom-EM remediation question has been raised as something that shouldn't fall through the crack. Her review of the archived #109 exploration notes (`explore-review-facilitator.md` in that change, her Question 1) already asked for exactly this — a phantom-EM remediation/backfill question "recorded rather than falling through the crack between explore and implementation." Decision H and tasks.md 6.4 were the archived change's answer to that ask. #117 is that mechanism firing, six days late. The continuity matters because it means this change isn't a new idea surfacing — it's a previously-identified risk finally getting the artifact it was always going to need.

2026-09-23 was one week from the 2026-09-16 decision, per the Executive Stakeholder's explicit same-sprint ask. Today is 2026-09-29. **The deadline has already passed with nothing built** — not "run late," but the underlying artifact this pipeline is now producing didn't exist yet when the deadline arrived. Two things I want on record before this moves further:

- The proposal stage should carry the actual date this work is happening (2026-09-29) and state plainly that the original 2026-09-23 target was missed, rather than writing a proposal that reads as if it's still inside the original window. A stakeholder who was told "closed out within the same sprint" deserves an honest status, not a document that quietly reframes the timeline.
- The named owner (on-call Production Data Engineer) still needs to actually execute this once the script exists — that's a *second* deadline this pipeline should set explicitly (e.g., "within N days of the script landing"), not assume happens automatically once the artifact is merged. tasks.md 6.4 in the archived change already flagged this exact risk: "if archiving happens before 2026-09-23, the pending query execution should be tracked as an explicit follow-up item rather than silently dropped when this change closes." That's precisely what happened — the change archived, the deadline passed, and #117 is that follow-up finally surfacing. Good that it did; the mechanism worked, six days late.

## 8. Devon's take

This is a small, mechanically well-specified piece of work — the hard thinking already happened in the archived design doc, correctly. My value-add here is exactly what I'd insist on for any change touching the audit trail: **verify the schema claims are still true, catch the one place a correctness bug could hide in plain sight** (the `operation` filter — §2), and make sure the artifact is safe to hand to someone who might run it more than once (§4) without that person needing to call me to ask what happens if they do.

The append-only invariant is not a style preference I'm applying here — it's the same category of thing as the no-manager-participation rule elsewhere in this system: once you accept "just this once" for rewriting history, exceptions become norms. Decision I already got this right (annotate, never rewrite); my job in this exploration was to make sure the *implementation* of that decision doesn't accidentally violate it through a re-run, an ambiguous actor field, or a metadata-shape collision with an unrelated operation.

One thing I will *not* be the one to decide: whose UUID goes in `actor_user_id` for a script-generated row (§5). That's a real decision with a real owner, and it should be named as one at propose/design time rather than defaulted into the script by whoever happens to write it first.

## 9. Disposition of explore-stage review feedback

**Incorporated directly** (things exploration itself could just state or structure, without needing a decision-maker beyond this stage):
- Two-step, structurally-enforced operator workflow — split into two files (§3, §6), not one script with two SELECT/INSERT blocks. (Facilitator)
- Environment sanity check as the first statement in both files (§3). (Facilitator)
- Human-readable output — Query 1 joins to `users`/`teams` (§3). (Facilitator)
- Unambiguous re-run confirmation via a labeled count instead of a bare INSERT tally (§4). (Facilitator)
- Explicit, verifiable idempotency acceptance test with a stated verification method (§4). (BA)
- Non-reconciliation fact and the `removed_at IS NULL` refinement, converted from implicit SQL choices into stated acceptance conditions (§3). (BA)
- Deliverable boundary converted into a Decision-C-style checkable acceptance criterion; exact filenames named (§6). (BA)
- Named result-record location and field list — `query-result.md` template in this change's directory (§6). (Facilitator + BA, same gap independently flagged by both)
- Inline SQL comment requirement for the `operation` filter, so the reason survives into the shipped artifact (§2). (Facilitator)
- Continuity citation to Priya's archived #109 review (§7). (Facilitator)
- Clarification that Query 2's single-statement atomicity makes partial-write failure structurally impossible, answering Priya's Question 4 directly rather than leaving it open. (Facilitator)

**Flagged forward as named open decisions for propose/design, not resolved here** (both explicitly identified by their own reviewer as belonging to the Solution Architect, or, in the second case, the Solution Architect/Executive Stakeholder):
- `actor_user_id` / `actor_global_role` as a named Decision J, with a candidate shape carried forward for confirmation (§5). (BA)
- The "who was notified" recipient/channel, and the explicit escalation-not-remediation boundary around it (§6). (BA, new finding)

**Declined, with rationale:**
- The BA's specific suggestion of a single `.sql` file with both queries delineated by section-header comments (§3, §6). His file-naming and header-convention reasoning is adopted; the single-file structure is not, because it doesn't give the operator a forced pause between seeing Query 1's result and choosing to run Query 2 — the exact structural gap the Facilitator's review identified as close to non-negotiable. Two files with one convention each accomplishes both reviewers' goals at once; one file accomplishes only the BA's.
