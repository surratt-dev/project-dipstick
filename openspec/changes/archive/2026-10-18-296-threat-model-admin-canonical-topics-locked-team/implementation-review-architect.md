# Implementation review: Solution Architect (Ingrid Sollenberger)

Change: 296-threat-model-admin-canonical-topics-locked-team
Scope: `git diff main -- "requirements/High-Level Architecture.md"` against design.md, proposal.md, pr-notes.md, and packages/backend.

## Verdict

Approve, with one required design.md amendment (finding 1 ruling) and three optional wording nits. No HLA claim contradicts the code I spot-checked.

## Conformance to design.md

- Item (h): programmatically compared with the quoted paragraph in design.md. Identical.
- Item (f): nine bullets, in the same order and content as the nine in design.md. The limiter and #271-reader statements sit in a separate paragraph under (f), as designed, so the reader statement cannot be read as tamper resistance.
- Table: one new row, three cells, appended after "Dependency vulnerability". Text matches the design.md row exactly.
- 8.2: one new bullet under "API Authorization", exact text from design.md ("pins", "five").
- Items (a) to (e) and (g) carry the design.md clauses. (g) is one sentence with the four required elements.
- No hunks in 8.3, 8.4 or existing 8.1 rows. The diff touches only this file.

## Consistency with the rest of the HLA

- Terminology: `application_admin`, `first_session` (once), "customization lock" match the use cases and API contract per pr-notes row 1.16.
- Placement: a new `### 8.1.1` under 8.1 follows the existing `### 8.x` numbering, and the row's pointer to 8.2 resolves.
- Style: 8.1.1 is much denser than the surrounding 8.1 and 8.2 (long lettered bullets, issue numbers, operation names). I accept this. It is a threat-model subsection with a reopen list, and design D2 requires names over numbers.
- 8.3 (Audit Logging) does not promise append-only or immutable logs, so "audit_log is modifiable, no tamper evidence claimed" contradicts nothing there.
- Nits, not blocking:
  - Item (e) packs two "not separately re-accepted" / "recorded as a reopen trigger" clauses into one run-on sentence with semicolons. Splitting it into two sentences would read better. It is the design.md D4 wording, so I leave it.
  - Caveat bullet 3 says "(this endpoint only)" after "absent when the limiter store errors or the audit insert fails". It could be read as scoping only the second clause. Low risk.
  - The 8.1 row lists "Preventive" and "Detective" labels inside a table cell, which is unlike the other rows. Acceptable given the design.

## Code spot-checks (packages/backend/src)

- `routes/topics.ts` imports `isApplicationAdmin` from `auth/role-map.js`.
- The assign-defaults route exists (`POST /api/v1/teams/:teamId/topics/assign-defaults`).
- The audit helpers `recordDenial` and `recordFailure` come from `auth/assign-defaults-audit.js`, and the audit INSERTs carry `actor_ip`, which depends on `trustProxy: 1` in `app.ts`. This supports the `actor_ip` caveat.
- The restore-defaults block reads the team's own `status = 'archived' AND is_default = true` rows and runs an UPDATE. It never reads the template, which supports the finding 1 premise.
- Migrations contain no REVOKE on `audit_log` (grep found only unrelated hits in migrations 5 and 23), consistent with "modifiable by the application database role".
- I did not re-run every pr-notes row. I rely on its rows 1.2 to 1.15 and spot-checked the ones above.

## Ruling on finding 1 (item (d), #218)

Marcus's resolution is correct. Keep #218 in item (d) as a negative clause and do not remove it.

Reasons:
1. The design.md claim that restore-defaults is a template-copy path is factually wrong. It re-activates the team's own archived default rows and never reads the template. The HLA must not carry a false mechanism, so the "trust anchor for all copy paths" statement cannot include #218 as a copier.
2. Naming it as a non-copier is useful. A reader looking at the topic-write surface will ask whether restore-defaults (#218) is a third route from the template to a team. The one clause answers that without enlarging the threat statement.
3. The clause is verified against code (pr-notes 1.11e) and does not overclaim.
4. Check 3.5 only requires #215 and #218 to be present in (d). That is still satisfied, so the check needs no change.

Required amendment: design.md should be edited, because it is declared the source of truth that wins on conflict. A stale design.md would send future reviewers back to a false claim. Amend the (d) content-addition bullet to read, in substance: "The template is the trust anchor for the paths that copy or edit it: team creation (#215), assign-defaults, and the #216 maintenance path. Restore-defaults (#218) re-activates a team's own archived default rows and does not copy template text; say so in a clause." Add a one-line note in "Design review resolution" recording that this was corrected at implementation. Do not touch the 3.5 check.

Related wording point in the HLA: (d) correctly separates "copy" (#215, assign-defaults) from "edit" (#216). Keep that split.

## Other findings from pr-notes

- Finding 2 (template validation stricter than ordinary topic text): correct that (d) states only "validated on write", with no equivalence claim. Leave it as a follow-up and do not widen #296.
- Finding 3 (empty template unreachable through the #216 API): keep the caveat. It describes real behavior for a direct database change or migration, and the design says to keep it. The finding is recorded in pr-notes, which is enough.
- Finding 4 (role freshness, IdP demotion lag up to about 90 minutes): this is not in the HLA. The "role read from the database on each request" claim is true but could imply the role is fresh. The caveat on the stolen long-lived admin session partly covers this. I recommend one clause added to bullet 6 in (f), for example "a role change at the identity provider takes effect only at the next interactive sign-in". It is a small, verified, security-relevant addition. If the team prefers to keep the HLA exactly as designed, flag it to Security instead. Not blocking.
- Finding 7 (assign-defaults lacks the `X-Requested-With` header requirement that the #216 routes have): outside the design scope. Pass it to Security as a follow-up and leave the HLA as is.
- Finding 5 (stale "four" in a test header and a route comment): not a #296 change. The HLA says "five", which matches the test body.

## Items for the orchestrator

1. Amend design.md per the finding 1 ruling (documentation only).
2. Optionally add the role-freshness clause to (f) bullet 6.
3. Sign-off log (tasks section 4) is not started. It is the orchestrator's task.
