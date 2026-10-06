# Hands-on check: facilitator entry point to session creation

**Change:** `facilitator-session-entry-point` (#237, PR #250)
**Origin:** task 4.3 and `walkthrough.md` in `openspec/changes/archive/2026-10-06-facilitator-session-entry-point/`
**Time:** about 15 minutes for the core check (parts 1–4); about 5 more for the optional part 5
**Who:** ideally someone who facilitates sessions, since part of the point is how the wording reads to a facilitator. Anyone can run part 4, the end-to-end check.

## What this check is for

The automated suite covers each piece separately: the team page and the picker run against a mocked session and mocked `fetch`, and the server's eligibility query is checked with a mocked database. Nothing runs the whole chain with a real sign-in, a real `/auth/session` and real server-side exclusion. This check does, and asks the questions the tests can't:

- Can a facilitator who has a home team find their way to session creation without typing a URL?
- Is it obvious why their own team isn't in the picker, and does the wording avoid suggesting they're on "every team"?
- Can they get back out of the picker without creating anything?
- Do Engineers and Engineering Managers see nothing new?
- If a facilitator loses the role mid-visit, are they sent back cleanly, with no loop between the team page and the picker? This is the only end-to-end check of that path (spec R8, design D5a).

Record a pass/fail and notes for each step in the [results table](#results) at the end.

> **Local development only.** The setup, part 4 and part 5 write directly to the local database. They bypass the session state machine and write no `audit_log` row. **Never run them against a shared or production database**, and never copy them into `docs/deployment.md` or any runbook.

---

## Setup

The SQL below creates two test teams. Your existing local data is left alone, and the [cleanup](#cleanup) removes only what this check adds.

| Team | Members | Used for |
|---|---|---|
| Entry Point Check - Home | `facilitator-001` (participant), `participant-001` (participant), `manager-001` (engineering_manager) | The home team, which must **not** appear in the picker |
| Entry Point Check - Other | nobody | A team `facilitator-001` can facilitate, which **must** appear in the picker |

### 1. Start the stack

```bash
docker compose up -d --wait postgres redis oidc
npm run db:migrate --workspace=packages/backend
npm run dev
```

The app runs at http://localhost:5173.

### 2. Sign in once as each persona

The setup needs a `users` row for each persona, and signing in creates it. Use a private window per persona, or sign out between them (see "Testing multiple personas at once" in `docs/local-development.md`).

1. Sign in as **facilitator-001**, then do **part 1 now**, before running the setup.
2. Sign in as **participant-001**, then sign out.
3. Sign in as **manager-001**, then sign out.

### 3. Create the test data

If a previous run left data behind, run the [cleanup](#cleanup) first; the setup isn't re-runnable on top of itself.

```bash
docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

DO $$ BEGIN
  IF (SELECT count(*) FROM users
      WHERE oidc_subject IN ('facilitator-001', 'participant-001', 'manager-001')) <> 3 THEN
    RAISE EXCEPTION 'Sign in once as facilitator-001, participant-001 and manager-001 before running this script';
  END IF;
END $$;

INSERT INTO teams (id, name, created_by_user_id)
SELECT t.id::uuid, t.name, u.id
FROM (VALUES
  ('66666666-0000-4000-8000-000000000001', 'Entry Point Check - Home'),
  ('66666666-0000-4000-8000-000000000002', 'Entry Point Check - Other')
) AS t(id, name)
CROSS JOIN (SELECT id FROM users WHERE oidc_subject = 'facilitator-001') u;

-- Home team members. "Other" deliberately has none.
INSERT INTO team_memberships (team_id, user_id, role)
SELECT '66666666-0000-4000-8000-000000000001', u.id, m.role::membership_role
FROM (VALUES
  ('facilitator-001', 'participant'),
  ('participant-001', 'participant'),
  ('manager-001',     'engineering_manager')
) AS m(subject, role)
JOIN users u ON u.oidc_subject = m.subject;

COMMIT;
SQL
```

The test teams start with no sessions, so signing in lands on the team page rather than in an open session.

---

## Part 1: A facilitator with no team (core, run before the setup)

| # | Do | Expect |
|---|---|---|
| 1.1 | Sign in as **facilitator-001** before the setup has run. | You land on **/sessions/new**. At the bottom there's a **Sign out** control and **no** "Go to your team" link. |

If `facilitator-001` already belongs to a team from earlier local work, you'll land on that team instead. Note that in the results and carry on.

## Part 2: A facilitator with a home team (core)

Sign out, then sign in again as **facilitator-001**. The session is re-read on sign-in, so the new membership is picked up.

| # | Do | Expect |
|---|---|---|
| 2.1 | Sign in. | You land on **/team/{Home}**, the same landing as before this change. You're not sent to the picker. |
| 2.2 | Look at the team page. | A **Facilitator** block sits after the "Team" heading and above "Members", separate from the "Topics" link. It has the link **Facilitate another team's session** and the line **You can't facilitate your own team.** |
| 2.3 | Click the link once. | You're on **/sessions/new**, one click after landing. No team is pre-selected. |
| 2.4 | Look at the picker list. | **Entry Point Check - Home** is **absent**. **Entry Point Check - Other** is **listed**. Other local teams you're not on may also appear. Above the list: **Your own team isn't listed. Facilitators run sessions for teams they're not on.** |
| 2.5 | Click **Go to your team** at the bottom. | You're back on **/team/{Home}**. |

Don't confirm a session for **Other**; this check doesn't need one, and the cleanup assumes none was started.

**Ask yourself:** before reading the helper line, did "Facilitate another team's session" make it clear this isn't for the team on screen? Did the picker's explanation stop you thinking your team was missing by mistake?

## Part 3: Non-facilitators see nothing new (core)

| # | Do | Expect |
|---|---|---|
| 3.1 | Sign out. Sign in as **participant-001**. | You land on **/team/{Home}**. There's **no** Facilitator block and no link to `/sessions/new`. |
| 3.2 | Sign out. Sign in as **manager-001**. | Same: **no** Facilitator block and no link to `/sessions/new`. |

## Part 4: Losing the facilitator role mid-visit (core, required)

This is the end-to-end check for spec R8 and design D5a.

1. Sign in as **facilitator-001** and stay on **/team/{Home}** with the Facilitator block showing.
2. **Without reloading the page**, demote the user:
   ```bash
   docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
   UPDATE users SET global_role = 'engineer' WHERE oidc_subject = 'facilitator-001';
   SQL
   ```
3. Click **Facilitate another team's session**.

| # | Expect |
|---|---|
| 4.1 | You end up back on **/team/{Home}**, and the Facilitator block is gone. |
| 4.2 | You don't bounce between the team page and the picker. The address bar settles, and the browser's network tab shows no repeating `eligible-for-session` or `/auth/session` requests. |

Either of two paths gives this outcome, and both count as a pass:
- The app re-reads `/auth/session` when the URL changes, sees the role is gone, and redirects before the picker loads.
- The picker's eligible-teams request is refused (403), the page re-reads the session once, then redirects.

Note which one you saw if you can tell from the network tab.

Reset the role afterwards. A fresh sign-in also re-applies it from the IdP claim.

```bash
docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
UPDATE users SET global_role = 'facilitator' WHERE oidc_subject = 'facilitator-001';
SQL
```

## Part 5: Empty picker (optional)

This hides every team except Home, so the picker has nothing to offer. It marks those teams with a fixed sentinel timestamp, `2000-01-01`, so the reset puts back only what it changed. Teams that were already deactivated are left alone.

```bash
docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
UPDATE teams SET deactivated_at = '2000-01-01 00:00:00+00'
WHERE id <> '66666666-0000-4000-8000-000000000001' AND deactivated_at IS NULL;
SQL
```

| # | Do | Expect |
|---|---|---|
| 5.1 | As **facilitator-001**, go to **/team/{Home}** and click the Facilitator link. | **There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. Don't see the team you're looking for? Create one to get started.** It does **not** say you're on every team, even though Other exists. **Create a new team** is still offered, and **Go to your team** and **Sign out** are at the bottom. |

Reset:

```bash
docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
UPDATE teams SET deactivated_at = NULL WHERE deactivated_at = '2000-01-01 00:00:00+00';
SQL
```

---

## Results

| Part / step | Pass / Fail | Notes |
|---|---|---|
| 1 — No-team facilitator (1.1) | | |
| 2 — Home-team facilitator (2.1–2.5) | | |
| 3 — Participant (3.1) | | |
| 3 — Manager (3.2) | | |
| 4 — Role lost mid-visit (4.1–4.2) | | Path seen: refetch on navigation / 403 then refresh / couldn't tell |
| 5 — Empty picker (optional) | | |
| Copy review | | Strings to change: |

**Tested by:** ______ **Date:** ______ **Commit:** `git rev-parse --short HEAD` → ______

**Outcome:** ☐ Ship ☐ Ship after copy fixes ☐ Don't ship (explain)

Record the outcome on PR #250. If any wording needs to change, keep to the copy rule: name only the membership rule, and never say or imply "every team", "all other teams" or "no other teams". The frontend tests assert the exact strings, so they need updating along with the copy.

---

## Cleanup

This removes the test teams and everything attached to them. It affects only rows whose team ID starts with `66666666-0000-4000-8000-`. If part 4 or part 5 stopped partway, run their resets first.

```bash
docker exec -i project-dipstick-postgres-1 psql -U dipstick -d dipstick -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM audit_log        WHERE team_id::text LIKE '66666666-0000-4000-8000-%';
DELETE FROM join_links       WHERE team_id::text LIKE '66666666-0000-4000-8000-%';
DELETE FROM team_memberships WHERE team_id::text LIKE '66666666-0000-4000-8000-%';
DELETE FROM sessions         WHERE team_id::text LIKE '66666666-0000-4000-8000-%';
DELETE FROM topics           WHERE team_id::text LIKE '66666666-0000-4000-8000-%';
DELETE FROM teams            WHERE id::text      LIKE '66666666-0000-4000-8000-%';
COMMIT;
SQL
```
