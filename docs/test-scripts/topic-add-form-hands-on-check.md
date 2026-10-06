# Hands-on check: Add Custom Topic form and empty states

**Change:** `topic-add-form-and-empty-state` (#55, PR #196)
**Origin:** pre-ship items H3 (hands-on check), "Copy review" and H4 in `openspec/changes/archive/2026-10-01-topic-add-form-and-empty-state/tasks.md`
**Time:** about 15 minutes for the core check (parts 1–3); about 10 more for the optional parts 4–5
**Who:** ideally someone who facilitates sessions. The point is how it *feels* and *reads* to a facilitator; the automated tests already cover the behaviour.

## What this check is for

The automated suite checks that the form behaves as specified. This check asks the questions the tests can't:

- Can a facilitator add a topic without hesitating over any field?
- Does the duplicate warning steer them to restore an archived topic instead of creating a second one? A duplicate splits that topic's trend history.
- Does any wording suggest something will appear in a session? It must not: #175 means nothing reaches a session yet, and descriptions of custom topics never do (#198).
- Do the empty states make sense, and do they avoid offering actions that can't work?

Record a pass/fail and notes for each step in the [results table](#results) at the end.

---

## Setup

The persona accounts have no teams. `facilitator-001` signs in as a real `facilitator` through the default role map (see `docs/local-development.md`). The SQL below creates four test teams. **No team lists `facilitator-001` as a member**, which the add form requires.

| Team | State | Used for |
|---|---|---|
| Hands-On Check - Main | Unlocked, 11 active defaults, "Pairing" archived | Parts 1–3 |
| Hands-On Check - Empty Locked | Locked (no completed session), no topics | Part 4 |
| Hands-On Check - Empty With Archived | Unlocked, 0 active, 2 archived ("Pipeline", "Technology Stack") | Part 4 |
| Hands-On Check - Empty Unlocked | Unlocked, no topics at all | Part 4 |

### 1. Start the stack

```bash
docker compose up -d --wait postgres redis oidc
npm run db:migrate --workspace=packages/backend
npm run dev
```

The app runs at http://localhost:5173.

### 2. Sign in once as the facilitator

Open http://localhost:5173 and click the **facilitator-001** persona button. You'll land on **/sessions/new**, the facilitator landing page, which confirms the role claim was applied. If you land on `/no-team` instead, the stub's role claim didn't take effect; see `docs/local-development.md`. Signing in also creates the `users` row the setup needs, so run the setup **after** signing in.

### 3. Create the test data

If a previous run left data behind, run the [cleanup](#cleanup) first; the setup isn't re-runnable on top of itself.

```bash
docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE oidc_subject = 'facilitator-001') THEN
    RAISE EXCEPTION 'Sign in once as facilitator-001 before running this script';
  END IF;
END $$;

-- Four test teams. facilitator-001 is deliberately NOT a member of any.
INSERT INTO teams (id, name, created_by_user_id)
SELECT t.id::uuid, t.name, u.id
FROM (VALUES
  ('55555555-0000-4000-8000-000000000001', 'Hands-On Check - Main'),
  ('55555555-0000-4000-8000-000000000002', 'Hands-On Check - Empty Locked'),
  ('55555555-0000-4000-8000-000000000003', 'Hands-On Check - Empty With Archived'),
  ('55555555-0000-4000-8000-000000000004', 'Hands-On Check - Empty Unlocked')
) AS t(id, name)
CROSS JOIN (SELECT id FROM users WHERE oidc_subject = 'facilitator-001') u;

-- Unlock teams 1, 3 and 4 with one completed session each. Team 2 stays locked.
INSERT INTO sessions (team_id, facilitator_id, status, is_first_session, session_number, started_at, completed_at)
SELECT t.id::uuid, u.id, 'complete', true, 1, now() - interval '1 day', now() - interval '1 day'
FROM (VALUES
  ('55555555-0000-4000-8000-000000000001'),
  ('55555555-0000-4000-8000-000000000003'),
  ('55555555-0000-4000-8000-000000000004')
) AS t(id)
CROSS JOIN (SELECT id FROM users WHERE oidc_subject = 'facilitator-001') u;

-- Main team: copy the 12 default topics, the same way team creation does.
INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description)
SELECT '55555555-0000-4000-8000-000000000001', name, prompt, vote_type, display_order, is_default, first_session_description
FROM topics
WHERE team_id = '00000000-0000-0000-0000-000000000001' AND is_default = true;

-- Main team: archive "Pairing" so there's an archived default to collide with.
UPDATE topics t SET status = 'archived', archived_at = now() - interval '1 hour', archived_by = u.id
FROM (SELECT id FROM users WHERE oidc_subject = 'facilitator-001') u
WHERE t.team_id = '55555555-0000-4000-8000-000000000001' AND t.name = 'Pairing';

-- "Empty With Archived" team: two archived defaults, no active topics.
INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description, status, archived_at, archived_by)
SELECT '55555555-0000-4000-8000-000000000003', d.name, d.prompt, d.vote_type, d.display_order, true, d.first_session_description,
       'archived', now() - interval '1 hour', u.id
FROM topics d
CROSS JOIN (SELECT id FROM users WHERE oidc_subject = 'facilitator-001') u
WHERE d.team_id = '00000000-0000-0000-0000-000000000001' AND d.is_default = true AND d.name IN ('Pipeline', 'Technology Stack');

COMMIT;
SQL
```

### 4. Reload

Reload the browser. You should still be on **/sessions/new**: the test teams don't make `facilitator-001` a member of anything. The test teams aren't linked from anywhere a non-member can see, so open them by URL:

| Team | URL |
|---|---|
| Main | http://localhost:5173/team/55555555-0000-4000-8000-000000000001/topics |
| Empty Locked | http://localhost:5173/team/55555555-0000-4000-8000-000000000002/topics |
| Empty With Archived | http://localhost:5173/team/55555555-0000-4000-8000-000000000003/topics |
| Empty Unlocked | http://localhost:5173/team/55555555-0000-4000-8000-000000000004/topics |

---

## Part 1: Add a fresh custom topic (core)

Open the **Main** team URL.

| # | Do | Expect |
|---|---|---|
| 1.1 | Look at the top of the Active Topics section without scrolling. | Heading reads **Active Topics (11)**, with an **Add custom topic** button beside it. No lock notice. |
| 1.2 | Click **Add custom topic**. | An inline form titled **Add custom topic** opens with: **Name (required)**, **Prompt (required)**, **Vote type (required)** (three radio options, **none preselected**), and **Description (optional, shown on this screen only)**. |
| 1.3 | Read the three vote-type options. | Each has a one-line explanation: Finger Voting ("Everyone shows 1 to 4 fingers…"), Roman Voting ("Thumbs up or thumbs down…"), Modified Roman Voting ("Thumbs up, sideways, or down…"). The group's help text says the vote type can't be changed after the topic is created. |
| 1.4 | Click **Submit** with everything empty. | Nothing is sent. Messages appear: "Enter a topic name.", "Enter a prompt.", "Choose a vote type." Focus moves to **Name**. |
| 1.5 | Enter Name `Code Review Turnaround`, Prompt `How quickly do code reviews get done?`, choose **Finger Voting**, leave Description empty. Click **Submit**. | The button briefly reads **Adding…**. Then the form closes and a status message reads: **Added 'Code Review Turnaround' to the end of the list. Use the move buttons to change where it falls.** |
| 1.6 | Look at the list. | Heading now reads **Active Topics (12)**. The new topic is **last**, with a **Custom** tag next to its name. Focus is on the new row. Default topics have no tag. |
| 1.7 | Use the move-up button on the new topic once, then click **Discard** on the order changes. | Moving works on the new topic exactly as on defaults. Nothing about adding interferes with reordering. |

**Ask yourself:** did any field make you hesitate? Was it obvious what "Prompt" means compared with "Name"?

## Part 2: Collide with an archived default (core)

Still on the **Main** team.

| # | Do | Expect |
|---|---|---|
| 2.1 | Click **Add custom topic**. Enter Name `pairing` (lowercase), any prompt, choose any vote type. Click **Submit**. | Nothing is added yet. A warning appears: **This team has an archived topic called 'Pairing'. Restoring it keeps its history in one trend.** It has two buttons: **Show it in Archived topics** and **Add as a new topic anyway**. Matching ignores case and surrounding spaces. |
| 2.2 | Click **Show it in Archived topics**. | The **Archived Topics** section expands and focus moves to the **Pairing** row, which shows when and by whom it was archived. What you typed in the form is still there. |
| 2.3 | Click **Cancel** in the add form. | Because the form has content, it asks **Discard this topic?** with **Discard** and **Keep editing**. Choose **Discard**: the form closes. |
| 2.4 | On the Pairing row, click **Restore** and confirm. | Pairing returns to the active list. Heading count goes up by one. This is the outcome the warning is meant to encourage. |

**Ask yourself:** did the warning steer you towards restoring? Was "Add as a new topic anyway" clearly the second choice without feeling hidden?

## Part 3: Other duplicate cases and copy (core, quick)

Still on the **Main** team. Before 3.2, archive one topic so there's something to match: click **Remove** on **Pipeline** and confirm.

| # | Do | Expect |
|---|---|---|
| 3.1 | Add a topic named `Technology Stack` (it's active). Any prompt and vote type. Submit. | Warning: **This team already has an active topic called 'Technology Stack'. Two topics with the same name or question can confuse people during the vote.** One button: **Add anyway**. Click **Cancel**, then **Discard**. |
| 3.2 | **(H4)** Add a topic with a *different* name, e.g. `Build Confidence`, and Prompt `Confidence in the pipeline` (the archived Pipeline topic's prompt). Submit. | Warning names the archived topic: **This team has an archived topic called 'Pipeline'. …** Click **Show it in Archived topics**. |
| 3.3 | **(H4)** Look at the Pipeline row in Archived Topics. | Archived rows show the **name** and archive details but **not the prompt**. Decide whether a facilitator can tell *why* it matched. See [Decision H4](#decision-h4) below. |
| 3.4 | Type 80+ characters into **Name**. | A counter appears (for example `82 / 100`). The field stops at 100. |
| 3.5 | Read the **Description** label and help text. | Label: **Description (optional, shown on this screen only)**. Help: "Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for your team." |

### Copy review

Read each string as a facilitator would. **The hard rule:** no text may say or imply that a topic, its description or a team definition **will appear in a session**. Flag anything that does, or anything that reads awkwardly.

- [ ] Form title, field labels and help text (parts 1.2, 1.3, 3.5)
- [ ] Validation messages (1.4)
- [ ] Success message (1.5)
- [ ] Archived-duplicate warning and its buttons (2.1)
- [ ] Active-duplicate warning (3.1). Note: "can confuse people during the vote" is general advice, not a promise this topic will be voted on. Confirm it reads that way to you.
- [ ] Discard confirmation (2.3)
- [ ] Empty-state messages (part 4)

### Decision H4

When a new topic matches an archived topic **by prompt only**, the warning names the archived topic, but archived rows don't show their prompt. Pick one, and record it in the results:

- **A. Leave as is.** The name in the warning is enough.
- **B. Show the prompt on archived rows.**
- **C. Reword the warning for prompt-only matches**, for example "…an archived topic, 'Pipeline', with the same question."

## Part 4: Empty states (optional)

These states are rare (see #200 and #184), but the copy must be honest about which actions exist.

| # | Open | Expect |
|---|---|---|
| 4.1 | **Empty Locked** | The first-session lock notice ("Topics cannot be customized until this team completes its first session…"). Below **Active Topics (0)**: **This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics.** **No buttons**, and no Add button by the heading. |
| 4.2 | **Empty With Archived** | **This team has no active topics.** with two buttons: **Show archived topics (2)** and **Add custom topic**. **Show archived topics (2)** expands the Archived section and focuses its toggle. |
| 4.3 | **Empty With Archived**: click **Add custom topic** in the empty state. | The form opens beneath the message. Cancelling an untouched form closes it without asking. |
| 4.4 | **Empty Unlocked** | **This team has no active topics.** with one button: **Add custom topic**. Add one topic. The success message reads **Added '<name>'.** (no move-buttons hint, since it's the only topic). The empty state is replaced by the list. |

**Ask yourself:** does the locked-team message feel like a dead end? It's meant to be honest that there's no in-app fix yet (#200).

## Part 5: Admin view (optional)

Admins can view this screen but can't add topics until #176 is fixed.

1. Sign out, then sign in with the **admin-001** persona. You'll land on `/no-team`; that's the known gap #202. Open the team URLs directly.
2. **Main:** no **Add custom topic** button by the heading.
3. **Empty With Archived:** **This team has no active topics.** with only **Show archived topics (2)**.
4. **Empty Unlocked:** **This team has no active topics. Topics can't be added from this account yet.** with no buttons.

---

## Results

| Part / step | Pass / Fail | Notes |
|---|---|---|
| 1 — Fresh add (1.1–1.7) | | |
| 2 — Archived collision (2.1–2.4) | | |
| 3 — Other duplicates and counters (3.1–3.5) | | |
| Copy review | | Strings to change: |
| **H4 decision** (A / B / C) | | |
| 4 — Empty states (optional) | | |
| 5 — Admin view (optional) | | |

**Tested by:** ______ **Date:** ______ **Commit:** `git rev-parse --short HEAD` → ______

**Outcome:** ☐ Ship ☐ Ship after copy fixes ☐ Don't ship (explain)

Record the outcome on PR #196, and file any copy fixes or the H4 decision as issues or PR commits.

---

## Cleanup

This removes the test teams and everything attached to them. It affects only rows whose team ID starts with `55555555-0000-4000-8000-`.

```bash
docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM audit_log WHERE team_id::text LIKE '55555555-0000-4000-8000-%';
DELETE FROM topics    WHERE team_id::text LIKE '55555555-0000-4000-8000-%';
DELETE FROM sessions  WHERE team_id::text LIKE '55555555-0000-4000-8000-%';
DELETE FROM teams     WHERE id::text      LIKE '55555555-0000-4000-8000-%';
COMMIT;
SQL
```
