# Title: No recovery path for a team created with zero topics

**Type:** defect / gap (use case "Assign Default Topic Set to New Team", alternate flow)
**Found in:** exploration for #55 (`exploration-notes.md`, 3.1)

## Body

`POST /api/v1/teams` (`packages/backend/src/routes/facilitator-sessions.ts`, ~L598) provisions topics with:

```
INSERT INTO topics (...) SELECT ... FROM topics
WHERE team_id = '00000000-0000-0000-0000-000000000001' AND is_default = true
```

If the template (`__default_topics__`) team has no default rows, this copies **zero rows and succeeds**. The team and its first (lobby) session are committed with no topics. The use case says this should "log the error and surface a failure state", and that "the session cannot be started until the topic configuration is resolved". Today:
- Nothing fails or logs at creation time.
- The team is locked (first session not complete), so no one can add topics from the UI.
- There is no endpoint that copies the default set onto an existing team, and admins have no tool for it. The only fix is a manual database operation.

#55 ships an honest empty state for this case ("Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics.") but no recovery action.

### To decide
- Should team creation fail (roll back) when zero default topics are copied? That matches the use case's "surface a failure state" most directly and would prevent the state entirely.
- Should there be an admin-only "assign default topics" action for teams that already ended up empty?
- Verify that a session cannot be started for a team with no topics (use case AC: "No session can be started for the team if its topic configuration is missing or incomplete").
- What real support channel, if any, the empty-state copy should name.

### Acceptance
- [ ] A team can't silently be created with zero topics, or there is a documented in-app way to fix one.
- [ ] The #55 empty-state copy is updated to point at whatever recovery exists.
