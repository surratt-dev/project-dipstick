Target: #53 comment

Status update: **partially delivered.** This issue stays open.

The `topic-annotation` change (#TBD PR) ships the management half: storage, the Facilitator-only TOPIC-007 write endpoint, the "Our team's definition" editor on the Topic Management screen, and annotation-bearing SESSION-005/012 payloads read from the session snapshot.

**No participant or facilitator will see a team definition in a live session yet.** That needs #175 (session_topics population) and #57/#56 (session screens). Session-display acceptance criteria have been added to #56, #57, and #62. The issue body has been corrected: the live-session topic view did not "already work".

Definitions are captured after a session, on the Topic Management screen. They cannot be added before a team's first completed session (the customization lock applies), so every team's first session runs the canonical baseline.
