# Walkthrough: facilitator session entry point (#237)

**Written by:** Marcus Oyelaran (implementer), task 4.2.
**Executed by:** a human, against a running local stack and IdP (task 4.3). The implementer has not run it.
**Covers:** spec R1, R2, R3, R4, R6, R7, R8 (end to end), R9 and R10 in a real browser, with real `/auth/session` and real server-side exclusion.

> **Local development only.** Steps 3, 6a and 8 write directly to the local database. They bypass the session state machine and write no `audit_log` row. **Never run them against a shared or production database**, and never copy them into `docs/deployment.md` or any runbook (design D6, security review S-8).

## Preconditions

- A **fresh `docker compose` volume**: no active teams other than the ones created below. If you reuse a volume, step 6 may list extra teams, and step 6a has to deactivate them too.
  ```
  docker compose down -v
  docker compose up -d
  npm run db:migrate -w packages/backend
  ```
- `npm run dev` at the repo root (backend and frontend).
- The local IdP personas, password `password` (see `docs/local-development.md`):
  - `facilitator-001` (Sam Facilitator, role claim `facilitator`)
  - `participant-001` (no role claim, so `engineer`)
  - `manager-001` (role claim `engineering_manager`)
- Use a private window or sign out between personas.

## Steps

1. **Sign in as `facilitator-001`.** With no memberships, you land on `/sessions/new` (via `/no-team`'s facilitator carve-out).
   - Expected: the picker shows **Sign out** at the bottom, and there is **no** "Go to your team" link.
2. **Create the home team.** Choose **Create a new team** and name it `Home`. You land on the readiness view. **Copy the join link.**
3. **Local cleanup (design D6). Local development only, never against a shared or production database.** This bypasses the state machine and writes no audit row. It frees `Home` from the open `lobby` session its creation started, so that redeeming the join link lands on the team view and not the session.
   ```
   docker compose exec postgres psql -U dipstick -d dipstick \
     -c "UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE team_id = (SELECT id FROM teams WHERE name = 'Home') AND status NOT IN ('complete','abandoned');"
   ```
4. **Create a second team.** Go back to `/sessions/new`, choose **Create a new team** and name it `Other`. This gives the picker a populated list later. Its `lobby` session can stay open, because `facilitator-001` is not a member of `Other`.
5. **Join `Home` as its member.** Sign out. Open the `Home` join link and sign in as `facilitator-001`.
   - Expected: you land on `/team/{Home}`.
   - **If the link is not redeemable after step 3, record what you saw in the results table and stop. Do not work around it** (tasks review A7).
6. **Follow the entry point.**
   - On `/team/{Home}`, a **Facilitator** block appears after the "Team" heading and above "Members". It is separate from the "Topics" link.
   - The link reads "Facilitate another team's session", with the helper line "You can't facilitate your own team."
   - Click it once. You are on `/sessions/new` (R1: one click after landing).
   - In the picker: `Home` is **absent**, `Other` is **listed**, and the copy "Your own team isn't listed. Facilitators run sessions for teams they're not on." is shown above the list.
   - Click **Go to your team**. You return to `/team/{Home}`.

   6a. *(Optional, empty state.)* Locally, in psql, deactivate `Other` (and any other non-`Home` team if the volume was not fresh):
   ```
   docker compose exec postgres psql -U dipstick -d dipstick \
     -c "UPDATE teams SET deactivated_at = now() WHERE name <> 'Home' AND deactivated_at IS NULL;"
   ```
   Reload `/sessions/new`. Expected: "There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. Don't see the team you're looking for? Create one to get started." It does **not** say you are on every team, even though `Other` exists. **Create a new team** is still offered. Reset afterwards:
   ```
   docker compose exec postgres psql -U dipstick -d dipstick \
     -c "UPDATE teams SET deactivated_at = NULL WHERE name <> 'Home';"
   ```
7. **Non-facilitators see nothing.** Sign out. Redeem the `Home` join link as `participant-001`, then (after signing out) separately as `manager-001`.
   - Expected for both: on `/team/{Home}` there is **no** Facilitator block and no link to `/sessions/new` (R3, R4).
8. **(Required; R8 end to end, design D5a.)** Sign in as `facilitator-001` and stay on `/team/{Home}` with the Facilitator block showing. **Without reloading the page**, demote the user locally:
   ```
   docker compose exec postgres psql -U dipstick -d dipstick \
     -c "UPDATE users SET global_role = 'engineer' WHERE oidc_subject = 'facilitator-001';"
   ```
   Then click the Facilitator link.
   - Expected: the picker's eligible-teams request is refused (403). The page re-fetches the session once and sends you back to `/team/{Home}`, and the Facilitator block is gone. You should not loop between the team view and the picker.
   - Reset afterwards (a fresh sign-in also re-maps the role from the IdP claim):
   ```
   docker compose exec postgres psql -U dipstick -d dipstick \
     -c "UPDATE users SET global_role = 'facilitator' WHERE oidc_subject = 'facilitator-001';"
   ```

## Results

| Step | Expected | Observed | Pass/Fail |
|---|---|---|---|
| 1 | Lands on `/sessions/new`; Sign out shown; no "Go to your team" | | |
| 2 | `Home` created; readiness view; join link copied | | |
| 3 | `UPDATE 1` (the `Home` lobby session abandoned) | | |
| 4 | `Other` created | | |
| 5 | Join link redeemable; lands on `/team/{Home}` | | |
| 6 | Facilitator block above Members; one click to picker; `Home` absent, `Other` listed; exclusion copy shown; "Go to your team" returns to `/team/{Home}` | | |
| 6a (optional) | Empty-state copy makes no "every team" claim; Create a new team offered | | |
| 7 (`participant-001`) | No Facilitator block on `/team/{Home}` | | |
| 7 (`manager-001`) | No Facilitator block on `/team/{Home}` | | |
| 8 | After demotion, following the link returns to `/team/{Home}` and the block is gone; no loop | | |
