# Follow-ups for #214

Recorded at archive, 2026-10-07. Nothing below has been filed or confirmed. Agents do not post to GitHub: a human files the action-item issue (FU-1), confirms H1 and H2, runs H3 and task 10.2, and records the outcomes here or in the PR.

---

## H1. Pre-deploy data check (deploy gate)

**Owner:** Devon Calloway by default. **Awaiting Brian's confirmation** of the owner.

**Body:** Before migration 23 (`23_template_team_not_a_subject.sql`) is deployed to any environment, run the pre-deploy data check there and record the counts in `proposal.md`. Add "H1 counts recorded" as a checklist item in the release step that runs the migration; nothing in the repository or CI enforces this gate.

- If any **non-terminal** template session exists, the deploy **must** run in a maintenance window with no running sessions (design D4). This is mandatory, not advisory.
- If any template `sessions` row exists, file a "Facilitator practice mode" issue linked to #214, labelled for the onboarding backlog and Rachel Okonkwo's review. Otherwise record "no evidence of practice use".
- Post-deploy `pg_constraint` check: in an environment that held template rows, expect `convalidated = false` on up to three tables (`sessions`, `team_memberships`, `join_links`), not only `sessions` (sync review, operational note).

---

## H2. Keep historical template sessions

**Owner:** Brian. **Awaiting confirmation.**

**Body:** The default is to keep historical terminal template sessions and their votes, frozen (the migration clamps facilitator access but deletes nothing). If Brian chooses deletion instead, that becomes a separate data-remediation task, not part of #214.

---

## H3. Champions practice-mode question

**Owner:** Devon Calloway. **Non-blocking:** neither deploy nor archive waits on it.

**Body:** Ask the current champions whether they would have used a rehearsal (practice) mode, and record the answer in `proposal.md`. This happens whatever H1 finds.

---

## FU-1. Action-item routes admit past template facilitators and owners

**Status:** **Not yet filed. Brian to file before merge.** The draft text was expected at the session scratchpad path `fu-issue.md`, but that file was not present when this record was written; the summary below is taken from `tasks.md` (task 8.2 finding) and should be used if the draft cannot be recovered.

**Title (suggested):** Action-item routes still admit past template facilitators and action-item owners (#214 follow-up)

**Body:** `/api/v1/action-items/:id/{status,owner}` admit the item's **owner** and anyone who **ever facilitated** a session for the team, independent of membership. The membership half ignores removed memberships (tested in #214). A past template facilitator, or the owner of a template action item, can therefore still update template action items. Per task 8.2 this is out of #214's scope and needs a separate issue linked to #214.

---

## Task 10.2. End-to-end check not run

**Status:** Not done; left for a human. Record the result in the PR.

**Body:** Manual or Playwright check against a running stack, after confirming the local database has run all migrations (a database with leftover template rows shows the constraints as `NOT VALID`, which is expected):

- (a) As a facilitator with no memberships, open the picker from the team page's "Facilitate another team's session" link and confirm the template is absent.
- (b) Open Topic Management for the template and confirm the canonical-defaults view: heading, tab title and back link.
- (c) With the picker open, make the selected team unavailable and confirm the "This team is no longer available" message and the "Choose another team" button.
- (d) Open an old template join link, logged out and logged in, and confirm the existing invalid-link page with no login detour.
