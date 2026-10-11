# Champion Sign-off: 208-member-admin-topic-writes

*Devon Calloway, Internal Champion. 2026-10-08.*

**Verdict: PASS WITH RESERVATIONS.**

## Does the change faithfully implement the owner's decision?

Yes. The owner said admins are trusted and are constrained only from facilitating their own team, and chose "no bar, and undo #232". The code does that and nothing more:

- `content.ts`: `evaluateAdminTopicConfigRead`, the deny branch, `admin.topic_config_denied` and the two 403 messages are gone. Every admitted `application_admin` is served, and every read still writes the durable `admin.topic_config_accessed` row. That row now records the raw membership role, so a manager-admin read is visible after the fact.
- The fail-closed guard (`assertTopic002AuthorizedRole`) is kept. A future role cannot reach topic definitions without an audit row.
- `topics.ts` has comment-only changes. The shared standing-facilitator helper has no diff. TOPIC-003..006 already admitted admins, so the `GET 403 / POST 201` split is resolved by bringing the read in line with the writes, and the writes are not widened.
- The scope is limited to topic configuration. The owner's sentence is not turned into a general rule in the specs, and the broader reading is left in 08b as an open item.

## Are the core constraints intact?

- **No-manager rule for sessions:** untouched. No session, live-room, trend or action-item code is in the diff. TOPIC-001 still refuses admins with `admin.session_content_denied`.
- **Facilitator from another team:** untouched for sessions (FR-2.1/2.2) and for facilitator topic reads and writes (`FACILITATOR_IS_TEAM_MEMBER` on TOPIC-002..006). Task 2.18 names a pin for each one.
- **Admins do not participate or facilitate:** untouched (FR-1.3, FR-2.4, #243 D11). TOPIC-007 annotation writes still refuse admins.
- **Simultaneous reveal:** not affected. No vote or reveal code is in the diff.

## Reservations (recorded and accepted, not defects)

1. **R-EXEC-1 is real.** A manager who is also an admin can read the team's definitions and shape the agenda on their own team. The cost is to how the ritual is perceived, and one occurrence is enough to cool a team's candour. It is disclosed honestly in the proposal, the design and 08b, including the weak part: the lookup query has no cadence or owner, and the team and its facilitator see nothing. I would still give #201 (facilitator-visible provenance) more weight.
2. **The admin `topic.*` write rows do not record membership role.** Reads record it and writes do not, so a manager-admin edit is harder to spot than a manager-admin read. This is listed as a security follow-up (S-4 b). It should not be lost.
3. **PR-time obligations are still open (tasks 6.3, 6.4).** The #187 release note line "administrators who manage the team cannot read the team's definitions" is now false. It must be replaced and re-approved by the owner before release. Shipping with the old line would be an undisclosed risk. Today it is disclosed and gated.
4. **The owner's sentence is broad.** If the scope in 08b is not confirmed, the next change could treat session content or participation as covered by it. The open item in 08b and its security-review requirement must hold.
