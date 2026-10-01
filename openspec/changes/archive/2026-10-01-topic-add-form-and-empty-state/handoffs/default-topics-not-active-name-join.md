# Title: `defaultTopicsNotActive` joins on topic name and breaks when a custom topic shares a default's name

**Type:** defect (latent; sibling of #184 hardening)
**Found in:** exploration for #55 (`exploration-notes.md`, 2.6)

## Body

`GET /api/v1/teams/:teamId/topics/all` (TOPIC-002) computes `defaultTopicsNotActive` in `packages/backend/src/routes/content.ts` (~L640) with:

```
LEFT JOIN topics t ON t.team_id = $1 AND t.name = dt.name
```

There is no uniqueness constraint on `(team_id, name)`, and TOPIC-003 doesn't check names. Once custom topics can be added from the UI (#55), a team can easily end up with a custom topic that shares a default's name. Then:
- If the default is archived and a same-named custom topic is active, the join returns two rows. The archived one survives the filter, so the response says the default is not active while an active topic of that name is on screen.
- If the default is active, a same-named custom topic duplicates the join row.

Separately, the `topicId` returned can fall back to the template team's topic id (`row.team_topic_id ?? row.default_topic_id`, ~L700) for teams that never had that default, and TOPIC-005 would 404 on it.

That fallback is also a low-severity disclosure: any TOPIC-002 caller receives valid topic IDs belonging to the template team (`00000000-…-0001`), which feeds the sentinel-team concern in #188. The fix should stop returning template-team IDs at all, not only make them safe for TOPIC-005 (security design review of #55, D8).

Nothing renders `defaultTopicsNotActive` today, and #55 explicitly does not read it, so this is harmless now. It must be fixed before anything consumes the field (for example a future "restore default set" feature).

### Suggested fix
Restrict the team side of the join to default rows (`AND t.is_default = true`), and decide how to represent defaults the team never had (no team topic id) so a consumer can't send a template id to TOPIC-005.

### Acceptance
- [ ] A same-named custom topic doesn't affect `defaultTopicsNotActive`.
- [ ] No duplicate rows per default.
- [ ] The `topicId` contract for never-had defaults is documented and safe, and no template-team topic ID is returned to any caller.
- [ ] Integration tests cover both collision cases.
